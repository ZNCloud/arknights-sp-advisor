// Advisor entry: position → ranked candidate actions with estimated win rate, utility and confidence.
// v1 = pure rollouts with common random numbers; v2 adds a learned value model as the pre-filter (scorer option).
import { createHash } from 'node:crypto';
import { deriveSeed } from '../eval/engine.mjs';
import { wilson } from '../eval/stats.mjs';
import { installGuide, guidePrep } from '../guides/policy.mjs';
import { restore, toJSON } from './state.mjs';
import { listActions, prune, sameAction } from './actions.mjs';
import { modelStatus, staleBudget } from './meta.mjs';
import { teamSpec, teamSummary } from './team.mjs';

const mean = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const CHANGING = new Set(['buy', 'reward', 'level', 'refresh', 'sell', 'equip', 'cycle_sell', 'level_before_merge', 'sell_space', 'sell_board_space']);
// v2 pre-filter: score every legal action with the value model (mean over sample seeds), keep the top `K` by
// model utility plus the guide reference and the guide's own first action.
export function modelScorer({ pool, spec, modelDir, samples = 2 }) {
  return Object.assign(async (state, playerId, all, { K, guideFirst: gf, stateJSON, stateKey }) => {
    const scored = await Promise.all(all.map(async a => {
      const outs = await Promise.all(Array.from({ length: samples }, (_, i) => pool.run({ kind: 'score', stateJSON, stateKey, playerId, action: a, sampleSeed: 7919 + i, spec, modelDir })));
      const ok = outs.filter(o => !o.illegal);
      return { ...a, modelUtil: ok.length ? mean(ok.map(o => o.util)) : -Infinity, modelWin: ok.length ? mean(ok.map(o => o.win)) : 0 };
    }));
    const ranked = scored.filter(a => Number.isFinite(a.modelUtil)).sort((x, y) => y.modelUtil - x.modelUtil);
    const keep = ranked.slice(0, K);
    for (const a of ranked) if ((a.type === 'guide' || a.type === 'macro' || (gf && sameAction(a, gf))) && !keep.includes(a)) keep.push(a); // multi-step plans are always rolled out
    return { keep, scored: ranked };
  }, { modelDir });
}

// What the continuation policy would do first in this position (so the guide's own move is always a candidate).
export function guideFirst(state, playerId, spec, cands) {
  const m = restore(state, { rngMode: 'exact' });
  installGuide(m, spec);
  const ps = m.players.get(playerId);
  try { guidePrep(m, ps); } catch (e) { if (!/guide cannot ready/.test(e.message)) throw e; } // its actions before the failed Ready still count
  const first = m.guideActions.find(a => a.player === playerId && CHANGING.has(a.type) && a.ok);
  m.dispose();
  if (!first) return null;
  const type = first.type === 'level_before_merge' ? 'level' : first.type.startsWith('sell') ? 'sell' : first.type === 'cycle_sell' ? 'sell' : first.type;
  return cands.find(c => c.type === type && (c.id == null || first.id == null || c.id === first.id)) || null;
}

const sd = a => { const mu = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / Math.max(1, a.length - 1)); };

export async function advise(state, { playerId = 'p0', spec, pool, K = 8, N = 8, stage2 = 3, N2 = 8, seed = 1, scorer = null, allowStale = false, team = null, log = () => {} } = {}) {
  const t0 = performance.now();
  // Team view (advisor/team.mjs teamSpec): the continuation keeps every seat on the line it is visibly playing and each
  // teammate at its observed tempo; the advised seat plays the profile learned from whoever played better.
  // `team` = { profile } (models/team-profile.json, may be null = team view without the learned profile).
  let teamView = null;
  if (team) {
    const m0 = restore(state, { rngMode: 'exact' });
    spec = teamSpec(spec, m0, playerId, team.profile || null);
    teamView = teamSummary(m0, playerId, spec, team.profile || null);
    m0.dispose();
  }
  // B2: a model trained on another game version is not trusted — fall back to wider pure rollouts and say so.
  let modelNote = null;
  if (scorer?.modelDir) {
    const st = modelStatus(scorer.modelDir);
    modelNote = st.reason;
    if (st.stale && !allowStale) { scorer = null; ({ K, N, N2 } = staleBudget({ K, N, N2 })); log(st.reason); }
  }
  const stateJSON = toJSON(state), stateKey = createHash('sha1').update(stateJSON).digest('hex').slice(0, 16);
  const live = restore(state, { rngMode: 'exact' }), ps = live.players.get(playerId);
  if (!ps?.alive) throw Error(`seat ${playerId} not alive`);
  const all = listActions(live, ps);
  const gf = guideFirst(state, playerId, spec, all);
  let cands, modelTable = null;
  if (scorer) { const r = await scorer(state, playerId, all, { K, guideFirst: gf, stateJSON, stateKey }); cands = r.keep; modelTable = r.scored.map(a => ({ label: a.label, modelUtil: a.modelUtil, modelWin: a.modelWin })); }
  else cands = prune(all, K, gf ? [gf] : []);
  live.dispose();
  if (N === 0) {
    // Model-only mode (fast): no rollouts, rank by the value model; needs a scorer.
    if (!modelTable) throw Error('N=0 (model-only) needs a value-model scorer');
    const ranked = cands.map(a => ({ action: a, label: a.label, modelUtil: a.modelUtil, modelWin: a.modelWin, guideFirst: !!(gf && sameAction(a, gf)) })).sort((x, y) => y.modelUtil - x.modelUtil);
    return { recommendation: ranked[0], candidates: ranked, illegal: [], modelTable, modelStatus: modelNote, candidatesConsidered: all.length, rollouts: 0, ms: performance.now() - t0, method: 'value model only', continuation: spec.id, ...(teamView ? { team: teamView } : {}) };
  }
  const sampleSeeds = Array.from({ length: N + N2 }, (_, i) => deriveSeed(seed, `${stateKey}:s${i}`));
  const rows = cands.map(a => ({ action: a, outcomes: [], invalid: [], guideFirst: !!(gf && sameAction(a, gf)) }));
  const runFor = (row, seeds) => Promise.all(seeds.map(sampleSeed => pool.run({ stateJSON, stateKey, playerId, action: row.action, sampleSeed, spec })
    .then(o => { if (o.invalid) { row.invalid.push(o.engineErrors); return; } row.outcomes.push({ ...o, sampleSeed }); })));
  // Stage 1: every candidate gets N rollouts on the same sample seeds (common random numbers).
  await Promise.all(rows.map(r => runFor(r, sampleSeeds.slice(0, N))));
  const legal = rows.filter(r => r.outcomes.length && !r.outcomes.some(o => o.illegal));
  const score = r => mean(r.outcomes.map(o => o.utility));
  // Stage 2: the top few get N2 more samples.
  const top = [...legal].sort((a, b) => score(b) - score(a)).slice(0, stage2);
  if (N2 > 0) await Promise.all(top.map(r => runFor(r, sampleSeeds.slice(N, N + N2))));
  const ref = legal.find(r => r.action.type === 'guide');
  const result = legal.map(r => {
    const u = r.outcomes.map(o => o.utility), wins = r.outcomes.filter(o => o.win).length, n = r.outcomes.length;
    // Paired difference vs the guide continuation on identical sample seeds.
    let adv = null;
    if (ref && r !== ref) {
      const d = r.outcomes.map(o => { const g = ref.outcomes.find(x => x.sampleSeed === o.sampleSeed); return g ? o.utility - g.utility : null; }).filter(x => x != null);
      adv = { mean: mean(d), se: d.length > 1 ? sd(d) / Math.sqrt(d.length) : null, n: d.length };
    }
    return { action: r.action, label: r.action.label, n, winRate: wins / n, winCI95: wilson(wins, n), utility: mean(u), utilitySE: n > 1 ? sd(u) / Math.sqrt(n) : null,
      r14Dmg: mean(r.outcomes.map(o => o.r14Dmg)), reachR14: mean(r.outcomes.map(o => o.lastRound >= 14 ? 1 : 0)), meanLastRound: mean(r.outcomes.map(o => o.lastRound)),
      vsGuide: adv, engineErrorRollouts: r.invalid.length, guideFirst: r.guideFirst, prior: r.action.prior, modelUtil: r.action.modelUtil, modelWin: r.action.modelWin, rolloutMs: mean(r.outcomes.map(o => o.ms)) };
  }).sort((a, b) => b.utility - a.utility);
  const illegal = rows.filter(r => r.outcomes.some(o => o.illegal)).map(r => ({ label: r.action.label, reply: r.outcomes.find(o => o.illegal).reply }));
  return { recommendation: result[0], candidates: result, illegal, modelTable, modelStatus: modelNote, candidatesConsidered: all.length, rollouts: rows.reduce((s, r) => s + r.outcomes.length, 0), engineErrorRollouts: rows.reduce((s, r) => s + r.invalid.length, 0),
    ms: performance.now() - t0, method: scorer ? 'value-model prefilter + rollouts' : 'heuristic top-K + rollouts (CRN)', continuation: spec.id, ...(teamView ? { team: teamView } : {}) };
}
