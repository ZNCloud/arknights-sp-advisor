// B4 acceptance for a retrained model under the CURRENT game version (run through eval/with-patch.mjs for a patch).
//  1. calibration: on hold-out self-play rows of this version, predicted win ≈ actual win (|Δ| ≤ 0.03, AUC ≥ 0.7);
//  2. play: N-seed advised (model-only) with the new model not worse than with the old one (reads two advised.mjs outputs);
//  3. direction: on real positions where a changed operator is buyable, the value of "buy it" relative to "guide"
//     moves in the direction of the change (buff → up) from old model to new model.
// Usage: node sp-advisor/advisor/accept.mjs --old sp-advisor/models --new models-cand --holdout data/h.jsonl
//        --play-old results/a.json --play-new results/b.json --favor chess_char_3_01_a --dir up --out results/accept.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadTrees, predict } from './model.mjs';
import { makeMatch, runToEnd } from '../eval/engine.mjs';
import { installGuide } from '../guides/policy.mjs';
import { capture } from './state.mjs';
import { modelScorer } from './advise.mjs';
import { listActions } from './actions.mjs';
import { restore } from './state.mjs';
import { RolloutPool } from './pool.mjs';

const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) opt[args[i].replace(/^--/, '')] = args[++i];
const meta = d => existsSync(`${d}/meta.json`) ? JSON.parse(readFileSync(`${d}/meta.json`, 'utf8')) : { featureSet: 'x' };
const load = d => ({ win: loadTrees(`${d}/value-win.json`), util: loadTrees(`${d}/value-util.json`), featureSet: meta(d).featureSet || 'x' });
const OLD = load(opt.old), NEW = load(opt.new), res = { old: opt.old, new: opt.new };
const auc = (y, p) => { const o = p.map((v, i) => [v, y[i]]).sort((a, b) => a[0] - b[0]); let n1 = 0, r = 0; o.forEach(([, yy], i) => { if (yy) { n1++; r += i + 1; } }); const n0 = o.length - n1; return n1 && n0 ? (r - n1 * (n1 + 1) / 2) / (n1 * n0) : null; };
// 1. calibration
{
  const rows = readFileSync(opt.holdout, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => !r.inject);
  const one = (M) => { const p = rows.map(r => predict(M.win, M.featureSet === 't' ? r.t : r.x)), y = rows.map(r => r.win);
    return { n: rows.length, meanPred: p.reduce((a, b) => a + b, 0) / p.length, actual: y.reduce((a, b) => a + b, 0) / y.length, auc: auc(y, p) }; };
  res.calibration = { new: one(NEW), old: one(OLD) };
  const c = res.calibration.new; res.calibration.pass = Math.abs(c.meanPred - c.actual) <= .03 && (c.auc ?? 0) >= .7;
}
// 2. play comparison
if (opt['play-old'] && opt['play-new']) {
  const a = JSON.parse(readFileSync(opt['play-old'], 'utf8')).summary.advised, b = JSON.parse(readFileSync(opt['play-new'], 'utf8')).summary.advised;
  res.play = { old: a, new: b, pass: b.meanUtility >= a.meanUtility - .01 && b.winRate >= a.winRate - .02 };
}
// 3. direction on real positions
{
  const favor = (opt.favor || '').split(',').filter(Boolean), spec = JSON.parse(readFileSync(opt.guide || 'guides/g06_la_natural.json', 'utf8'));
  const states = [];
  for (let seed = +(opt.dirSeed || 3001); states.length < +(opt.positions || 12) && seed < 3200; seed++) {
    const m = makeMatch(seed, 4); installGuide(m, spec); let got = false;
    const sb = m.scheduleBotPrep;
    m.scheduleBotPrep = function (ps) {
      if (!got && ps.playerId === 'p0' && ps.shop.slots.some(s => s?.kind === 'chess' && !s.sold && favor.includes(this.gd.baseIdOf(s.id)) && ps.priceOf(s) <= ps.funds) && ps.hand.some(x => !x)) { states.push(capture(this)); got = true; }
      return sb.call(this, ps);
    };
    m.start(); runToEnd(m); m.dispose();
  }
  const pool = new RolloutPool(+(opt.workers || 16)), rows = [];
  for (const st of states) {
    const live = restore(st, { rngMode: 'exact' }), ps = live.players.get('p0');
    const acts = listActions(live, ps).filter(a => a.type === 'guide' || (a.type === 'buy' && favor.includes(live.gd.baseIdOf(a.id))));
    live.dispose();
    const delta = async dir => { const r = await modelScorer({ pool, spec, modelDir: dir })(st, 'p0', acts, { K: 99, stateJSON: (await import('./state.mjs')).toJSON(st), stateKey: `${dir}:${st.match.round}:${st.seed}` });
      const g = r.scored.find(a => a.type === 'guide'), b = r.scored.find(a => a.type === 'buy'); return b && g ? b.modelUtil - g.modelUtil : null; };
    rows.push({ seed: st.seed, round: st.match.round, oldDelta: await delta(opt.old), newDelta: await delta(opt.new) });
  }
  await pool.close();
  const ok = rows.filter(r => r.oldDelta != null && r.newDelta != null), up = ok.filter(r => r.newDelta > r.oldDelta).length;
  const mean = k => ok.reduce((s, r) => s + r[k], 0) / Math.max(1, ok.length);
  res.direction = { positions: ok.length, meanOldDelta: mean('oldDelta'), meanNewDelta: mean('newDelta'), movedUp: up, rows,
    pass: ok.length > 0 && (opt.dir === 'down' ? mean('newDelta') < mean('oldDelta') : mean('newDelta') > mean('oldDelta')) };
}
res.pass = [res.calibration.pass, res.play ? res.play.pass : true, res.direction.pass].every(Boolean);
console.log(JSON.stringify({ calibration: res.calibration, play: res.play && { old: res.play.old.meanUtility, new: res.play.new.meanUtility, pass: res.play.pass }, direction: { ...res.direction, rows: undefined }, pass: res.pass }, null, 1));
if (opt.out) writeFileSync(opt.out, JSON.stringify(res, null, 1));
