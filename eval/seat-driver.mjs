// One seat (p0) driven by a pluggable per-step decision, every other seat (and the rest of p0's turn) by the guide.
// Shared by the fixed-seed head-to-head (eval/advised.mjs: advisor or distilled student) and the distillation data
// generator (distill/datagen-worker.mjs: teacher labels on the positions a mixed teacher/student policy reaches).
//   decide(m, ps, step) → { action, deviated, record }: `record` is pushed to the game's decisions; a non-deviating
//   step ends the advised part of the turn and the guide finishes it.
import { makeMatch, errorsOf } from './engine.mjs';
import { installGuide } from '../guides/policy.mjs';
import { capture, toJSON } from '../advisor/state.mjs';
import { traceBattles, outcomeOf, finishTurn } from '../advisor/rollout.mjs';
import { applyAction } from '../advisor/actions.mjs';
import { checkLineup, poolEval, applySteps } from '../advisor/lineup.mjs';

// Deviate from the guide only when the paired advantage clears z standard errors (guards against max-of-noise).
export function choose(res, z, margin = .05) {
  const best = res.recommendation, guide = res.candidates.find(c => c.action.type === 'guide');
  if (!guide || best === guide || best.guideFirst) return { action: { type: 'guide' }, deviated: false };
  if (res.rollouts === 0) return best.modelUtil > guide.modelUtil + margin ? { action: best.action, deviated: true } : { action: { type: 'guide' }, deviated: false };
  const adv = best.vsGuide;
  if (!adv || adv.se == null || adv.mean <= Math.max(.005, z * adv.se)) return { action: { type: 'guide' }, deviated: false };
  return { action: best.action, deviated: true };
}

// lineup: before p0 presses Ready, the lineup check (advisor/lineup.mjs) runs on its final board (needs `pool`).
export async function playSeat(seed, { spec, steps, fromRound = 1, decide, lineup = false, pool = null }) {
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
    const release = lineup ? holdReady(ps) : null;
    let asked = true;
    try { await economyTurn(m, ps, { seed, steps, fromRound, decide, decisions }); } finally { if (release) asked = release(); }
    if (!asked) throw Error(`seed ${seed} R${m.round}: p0's turn never asked for Ready`);
    if (lineup) {
      // teammates finish their prep first (their boards and 联防 enter the whole-round re-check); p0 stays not ready
      const r0 = m.round;
      m.sched.runUntil(() => m.alivePlayers().every(p => p === ps || p.ready) || m.phase !== 'PREP' || m.round !== r0, { maxSteps: 5e6 });
      if (m.phase !== 'PREP' || m.round !== r0) throw Error(`seed ${seed} R${r0}: prep ended while p0 waited for its lineup check`);
      const st = capture(m), res = await checkLineup(st, { playerId: 'p0', evalMany: poolEval(pool, toJSON(st), `${seed}:${m.round}:lineup`) });
      if (res.recommend) applySteps(ps, res.steps, res.best);
      decisions.push({ round: m.round, lineup: true, deviated: res.recommend, label: res.steps.map(x => x.what).join(' + ') || '站位不动', kind: res.kind,
        gain: res.gain, recheck: res.recheck, evals: res.evals, ms: res.ms });
      ps.resolveTemp();
      const rd = ps.setReady(true);
      if (!rd.ok) throw Error(`seed ${seed} R${m.round}: ready refused after the lineup check ${JSON.stringify(rd)}`);
    }
    if (!ps.ready) throw Error(`seed ${seed} R${m.round}: p0 not ready after its turn`);
    m.maybeEndPrep();
  }
  const s = m.lastResultMsg, o = { ...outcomeOf(m, s, battles), engineErrors: errorsOf(m) }; m.dispose();
  return { ...o, decisions };
}
// p0's buy / sell / level part of the turn: up to `steps` decided actions, then the guide finishes the turn.
async function economyTurn(m, ps, { seed, steps, fromRound, decide, decisions }) {
  let done = false;
  if (m.round >= fromRound) for (let step = 0; step < steps && !done; step++) {
    const pick = await decide(m, ps, step);
    decisions.push(pick.record);
    if (!pick.deviated) break;
    const f = finishTurnOrApply(m, ps, pick.action);
    if (f === 'done') done = true;
  }
  if (!done && !ps.ready) { const f = finishTurn(m, ps, { type: 'guide' }); if (!f.ok) throw Error(`seed ${seed}: guide turn failed ${JSON.stringify(f.reply)}`); }
}
// p0's Ready is held back while its turn runs (guide / terminal action) so the lineup check sees the board it would
// fight with; the returned release() restores the handler and says whether the turn asked for Ready.
// (non-enumerable: state capture during the turn must not see it)
function holdReady(ps) {
  let wanted = false;
  Object.defineProperty(ps, 'setReady', { configurable: true, writable: true, enumerable: false,
    value: function (on) { if (on === true) { wanted = true; return { ok: true }; } return Object.getPrototypeOf(this).setReady.call(this, on); } });
  return () => { delete ps.setReady; return wanted; };
}
// A terminal action ends the turn; a non-terminal one is applied and the seat is asked again.
function finishTurnOrApply(m, ps, action) {
  if (['end', 'move', 'bench', 'rotate'].includes(action.type)) { const f = finishTurn(m, ps, action); if (!f.ok) throw Error(`terminal action failed ${JSON.stringify(f.reply)}`); return 'done'; }
  const r = { buy: () => ps.buy(action.slot), reward: () => ps.pickReward(action.idx), level: () => ps.levelUp(), refresh: () => ps.refresh(), freeze: () => ps.freeze(),
    sell: () => ps.sell(action.uid), equip: () => ps.equip(action.uid, action.target), macro: () => applyAction(m, ps, action) }[action.type]();
  if (!r?.ok) throw Error(`advised action refused by engine: ${action.label} ${JSON.stringify(r)}`);
  return 'again';
}
