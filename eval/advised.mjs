// Head-to-head: seat p0 plays by the advisor, all other seats (and the baseline p0) play the guide.
// Usage: node sp-advisor/eval/advised.mjs --seeds 1001-1010 --guide guides/g06_final.json --out results/m1.json
//        [--K 8 --N 6 --N2 6 --steps 2 --workers 46 --mode advised|baseline|both --z 1] [--lineup 1]
//   --lineup 1: before p0 presses Ready, the lineup check (advisor/lineup.mjs) runs on its final board and its steps are
//   played when recommended. `--steps 0 --lineup 1` = guide economy + lineup check.
//   --student <student.json>: p0's economy steps come from the distilled student (distill/student.mjs, exported by
//   distill/train.py) instead of advise(); same game loop, same guide for the rest of the turn.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { makeMatch, runToEnd, errorsOf } from './engine.mjs';
import { installGuide } from '../guides/policy.mjs';
import { capture } from '../advisor/state.mjs';
import { advise, modelScorer } from '../advisor/advise.mjs';
import { RolloutPool } from '../advisor/pool.mjs';
import { traceBattles, outcomeOf } from '../advisor/rollout.mjs';
import { playSeat, choose } from './seat-driver.mjs';

const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) { if (!args[i].startsWith('--')) throw Error('Expected --flag'); opt[args[i].slice(2)] = args[++i]; }
const seeds = (opt.seeds || '1001-1010').split(',').flatMap(r => { const [a, b] = r.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
const spec = JSON.parse(readFileSync(opt.guide || 'guides/g06_final.json', 'utf8'));
const cfg = { K: +(opt.K || 8), N: +(opt.N ?? 6), N2: +(opt.N2 || 6), steps: +(opt.steps ?? 2), z: +(opt.z ?? 1), fromRound: +(opt.fromRound || 1), margin: +(opt.margin ?? .05), lineup: opt.lineup === '1' }; // model-only deviation margin (0.05: 50-seed test kept wins, 0.01 lost them)
const mode = opt.mode || 'both';
const modelDir = opt.model || null; // v2: value-model pre-filter, rollouts only for its top K
const team = opt.team ? { profile: JSON.parse(readFileSync(opt.team, 'utf8')) } : null; // advisor/team.mjs team view (+ learned profile)

function baseline(seed) {
  const m = makeMatch(seed, 4); installGuide(m, spec); const battles = traceBattles(m);
  m.start(); const s = runToEnd(m); const o = { ...outcomeOf(m, s, battles), engineErrors: errorsOf(m) }; m.dispose(); return o;
}
// The advisor's step: rank by advise(), deviate from the guide only past the z-SE gate (choose).
const advisorDecide = (seed, pool) => async (m, ps, step) => {
  const res = await advise(capture(m), { playerId: 'p0', spec, pool, K: cfg.K, N: cfg.N, N2: cfg.N2, seed: seed * 100 + m.round * 7 + step,
    scorer: modelDir ? modelScorer({ pool, spec, modelDir }) : null, allowStale: opt.allowStale === '1', team });
  const pick = choose(res, cfg.z, cfg.margin);
  return { ...pick, record: { round: m.round, step, deviated: pick.deviated, label: pick.deviated ? pick.action.label : '按guide', best: res.recommendation.label,
    bestVsGuide: res.recommendation.vsGuide, bestModelU: res.recommendation.modelUtil, guideModelU: res.candidates.find(c => c.action.type === 'guide')?.modelUtil, ms: Math.round(res.ms), rollouts: res.rollouts, engineErrorRollouts: res.engineErrorRollouts || 0, top: res.candidates.slice(0, 4).map(c => [c.label, c.utility != null ? +c.utility.toFixed(3) : null, c.winRate ?? null, c.modelUtil != null ? +c.modelUtil.toFixed(3) : null]) } };
};
const studentLib = opt.student ? await import('../distill/student.mjs') : null, student = studentLib ? studentLib.loadStudent(opt.student) : null;
const advised = (seed, pool) => playSeat(seed, { spec, steps: cfg.steps, fromRound: cfg.fromRound, lineup: cfg.lineup, pool,
  decide: student ? studentLib.studentDecide(student, { margin: cfg.margin }) : advisorDecide(seed, pool) });

// The pool runs the advisor's rollouts and the lineup check; a student without the lineup check needs none.
const pool = mode === 'baseline' || (student && !cfg.lineup) ? null : new RolloutPool(+(opt.workers || 46));
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
const summary = { config: cfg, model: modelDir, modelStatus: modelDir ? (await import('../advisor/meta.mjs')).modelStatus(modelDir).reason : null, allowStale: opt.allowStale === '1', team: opt.team || null, ...(student ? { student: opt.student, studentMeta: student.meta } : {}), guide: spec.id, seeds, baseline: agg('baseline'), advised: agg('advised'), wallSec: (Date.now() - t0) / 1000 };
console.log(JSON.stringify(summary, null, 1));
if (opt.out) { mkdirSync(dirname(opt.out), { recursive: true }); writeFileSync(opt.out, JSON.stringify({ summary, rows }, null, 1)); }
