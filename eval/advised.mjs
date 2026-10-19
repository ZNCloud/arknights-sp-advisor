// Head-to-head: seat p0 plays by the advisor, all other seats (and the baseline p0) play the guide.
// Usage: node sp-advisor/eval/advised.mjs --seeds 1001-1010 --guide guides/g06_final.json --out results/m1.json
//        [--K 8 --N 6 --N2 6 --steps 2 --workers 46 --mode advised|baseline|both --z 1]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { makeMatch, runToEnd, errorsOf } from './engine.mjs';
import { installGuide, guidePrep } from '../guides/policy.mjs';
import { capture } from '../advisor/state.mjs';
import { advise, modelScorer } from '../advisor/advise.mjs';
import { RolloutPool } from '../advisor/pool.mjs';
import { traceBattles, outcomeOf, finishTurn } from '../advisor/rollout.mjs';
import { applyAction } from '../advisor/actions.mjs';

const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) { if (!args[i].startsWith('--')) throw Error('Expected --flag'); opt[args[i].slice(2)] = args[++i]; }
const seeds = (opt.seeds || '1001-1010').split(',').flatMap(r => { const [a, b] = r.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
const spec = JSON.parse(readFileSync(opt.guide || 'guides/g06_final.json', 'utf8'));
const cfg = { K: +(opt.K || 8), N: +(opt.N ?? 6), N2: +(opt.N2 || 6), steps: +(opt.steps || 2), z: +(opt.z ?? 1), fromRound: +(opt.fromRound || 1), margin: +(opt.margin ?? .05) }; // model-only deviation margin (0.05: 50-seed test kept wins, 0.01 lost them)
const mode = opt.mode || 'both';
const modelDir = opt.model || null; // v2: value-model pre-filter, rollouts only for its top K

function baseline(seed) {
  const m = makeMatch(seed, 4); installGuide(m, spec); const battles = traceBattles(m);
  m.start(); const s = runToEnd(m); const o = { ...outcomeOf(m, s, battles), engineErrors: errorsOf(m) }; m.dispose(); return o;
}
// Deviate from the guide only when the paired advantage clears z standard errors (guards against max-of-noise).
export function choose(res, z, margin = .05) {
  const best = res.recommendation, guide = res.candidates.find(c => c.action.type === 'guide');
  if (!guide || best === guide || best.guideFirst) return { action: { type: 'guide' }, deviated: false };
  if (res.rollouts === 0) return best.modelUtil > guide.modelUtil + margin ? { action: best.action, deviated: true } : { action: { type: 'guide' }, deviated: false };
  const adv = best.vsGuide;
  if (!adv || adv.se == null || adv.mean <= Math.max(.005, z * adv.se)) return { action: { type: 'guide' }, deviated: false };
  return { action: best.action, deviated: true };
}
async function advised(seed, pool) {
  const m = makeMatch(seed, 4); installGuide(m, spec); const battles = traceBattles(m), decisions = [];
  const sb = m.scheduleBotPrep;
  m.scheduleBotPrep = function (ps) {
    if (ps.playerId !== 'p0') return sb.call(this, ps);
    const round = this.round;
    this.later(0, () => { if (this.phase === 'PREP' && this.round === round && ps.alive && !ps.ready) this._awaitAdvice = ps; });
  };
  m.start();
  for (;;) {
    m.sched.runUntil(() => m._awaitAdvice || m.phase === 'RESULT', { maxSteps: 5e6 });
    if (m.phase === 'RESULT') break;
    const ps = m._awaitAdvice; m._awaitAdvice = null;
    let done = false;
    if (m.round >= cfg.fromRound) for (let step = 0; step < cfg.steps && !done; step++) {
      const res = await advise(capture(m), { playerId: 'p0', spec, pool, K: cfg.K, N: cfg.N, N2: cfg.N2, seed: seed * 100 + m.round * 7 + step,
        scorer: modelDir ? modelScorer({ pool, spec, modelDir }) : null, allowStale: opt.allowStale === '1' });
      const pick = choose(res, cfg.z, cfg.margin);
      decisions.push({ round: m.round, step, deviated: pick.deviated, label: pick.deviated ? pick.action.label : '按guide', best: res.recommendation.label,
        bestVsGuide: res.recommendation.vsGuide, bestModelU: res.recommendation.modelUtil, guideModelU: res.candidates.find(c => c.action.type === 'guide')?.modelUtil, ms: Math.round(res.ms), rollouts: res.rollouts, engineErrorRollouts: res.engineErrorRollouts || 0, top: res.candidates.slice(0, 4).map(c => [c.label, c.utility != null ? +c.utility.toFixed(3) : null, c.winRate ?? null, c.modelUtil != null ? +c.modelUtil.toFixed(3) : null]) });
      if (!pick.deviated) break;
      const f = finishTurnOrApply(m, ps, pick.action);
      if (f === 'done') done = true;
    }
    if (!done && !ps.ready) { const f = finishTurn(m, ps, { type: 'guide' }); if (!f.ok) throw Error(`seed ${seed}: guide turn failed ${JSON.stringify(f.reply)}`); }
    if (!ps.ready) throw Error(`seed ${seed} R${m.round}: p0 not ready after its turn`);
    m.maybeEndPrep();
  }
  const s = m.lastResultMsg, o = { ...outcomeOf(m, s, battles), engineErrors: errorsOf(m) }; m.dispose();
  return { ...o, decisions };
}
// A terminal action ends the turn; a non-terminal one is applied and the seat is asked again.
function finishTurnOrApply(m, ps, action) {
  if (['end', 'move', 'bench', 'rotate'].includes(action.type)) { const f = finishTurn(m, ps, action); if (!f.ok) throw Error(`terminal action failed ${JSON.stringify(f.reply)}`); return 'done'; }
  const r = { buy: () => ps.buy(action.slot), reward: () => ps.pickReward(action.idx), level: () => ps.levelUp(), refresh: () => ps.refresh(), freeze: () => ps.freeze(),
    sell: () => ps.sell(action.uid), equip: () => ps.equip(action.uid, action.target), macro: () => applyAction(m, ps, action) }[action.type]();
  if (!r?.ok) throw Error(`advised action refused by engine: ${action.label} ${JSON.stringify(r)}`);
  return 'again';
}

const pool = mode === 'baseline' ? null : new RolloutPool(+(opt.workers || 46));
const t0 = Date.now();
const rows = await Promise.all(seeds.map(async seed => {
  const row = { seed };
  if (mode !== 'advised') row.baseline = baseline(seed);
  if (mode !== 'baseline') row.advised = await advised(seed, pool);
  const b = row.baseline, a = row.advised;
  console.log(`seed ${seed}: baseline ${b ? `${b.reason} R${b.lastRound} r14=${(b.r14Dmg * 100).toFixed(0)}% U=${b.utility.toFixed(3)}` : '-'} | advised ${a ? `${a.reason} R${a.lastRound} r14=${(a.r14Dmg * 100).toFixed(0)}% U=${a.utility.toFixed(3)} dev=${a.decisions.filter(d => d.deviated).length}/${a.decisions.length}` : '-'} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  return row;
}));
if (pool) await pool.close();
const agg = k => { const xs = rows.map(r => r[k]).filter(Boolean); if (!xs.length) return null; const n = xs.length, m = f => xs.reduce((s, x) => s + f(x), 0) / n;
  return { n, winRate: m(x => x.win ? 1 : 0), hiddenRate: m(x => x.hidden ? 1 : 0), reachR14: m(x => x.lastRound >= 14 ? 1 : 0), meanR14Dmg: m(x => x.r14Dmg), meanLastRound: m(x => x.lastRound), meanUtility: m(x => x.utility) }; };
const summary = { config: cfg, model: modelDir, modelStatus: modelDir ? (await import('../advisor/meta.mjs')).modelStatus(modelDir).reason : null, allowStale: opt.allowStale === '1', guide: spec.id, seeds, baseline: agg('baseline'), advised: agg('advised'), wallSec: (Date.now() - t0) / 1000 };
console.log(JSON.stringify(summary, null, 1));
if (opt.out) { mkdirSync(dirname(opt.out), { recursive: true }); writeFileSync(opt.out, JSON.stringify({ summary, rows }, null, 1)); }
