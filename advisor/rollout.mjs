// Evaluator v1 primitive: from a captured position, apply one candidate action for the advised seat, let the
// continuation policy (a guide spec) play the rest of that turn and every later turn for all seats, run the exact
// engine to the end, and report the outcome. Synchronous; runs inside pool workers.
import { runToEnd, errorsOf } from '../eval/engine.mjs';
import { installGuide, guidePrep } from '../guides/policy.mjs';
import { restore } from './state.mjs';
import { applyAction, TERMINAL } from './actions.mjs';

export function outcomeOf(m, summary, battles) {
  const r14 = battles.find(b => b.round === m.gd.bossRound), r15 = battles.find(b => b.round === m.gd.hiddenRound);
  const win = !!summary.victory, hidden = !!summary.hiddenCleared;
  const r14Dmg = r14 ? r14.damageFraction : 0, lastRound = m.round;
  return { win, hidden, r14Dmg, r15Dmg: r15 ? r15.damageFraction : 0, lastRound, reason: summary.reason, utility: utility({ win, hidden, r14Dmg, lastRound }) };
}
// Ranking utility. A win dominates; among losses, deeper survival and more R14 boss damage are better.
// (Natural openings almost never win, so pure win-rate would leave every candidate tied at 0.)
export function utility({ win, hidden, r14Dmg, lastRound }) {
  if (win) return 1 + (hidden ? .25 : 0);
  return .5 * Math.min(1, (lastRound - 1) / 13) + .45 * r14Dmg;
}
export function traceBattles(m) {
  const battles = [], orig = m._finishFinal;
  m._finishFinal = function (hidden, resultOf) {
    battles.push({ round: this.round, hidden, damageFraction: 1 - this.bossPool.hp / this.bossPool.maxHp });
    return orig.call(this, hidden, resultOf);
  };
  return battles;
}
// Play the advised seat's remaining turn: action, then guide (non-terminal) or ready (terminal / 'end').
export function finishTurn(m, ps, action) {
  const r = applyAction(m, ps, action);
  if (!r?.ok) return { ok: false, reply: r };
  if (action.type !== 'end' && !TERMINAL.has(action.type)) guidePrep(m, ps);
  else { ps.resolveTemp(); const rd = ps.setReady(true); if (!rd.ok) return { ok: false, reply: rd }; }
  return { ok: true };
}
export function runRollout(state, { playerId, action, sampleSeed, spec }) {
  const t = performance.now();
  const m = restore(state, { rngMode: 'resample', sampleSeed });
  installGuide(m, spec);
  const battles = traceBattles(m), ps = m.players.get(playerId);
  if (!ps || !ps.alive) throw Error(`advised seat ${playerId} not alive`);
  const fin = finishTurn(m, ps, action);
  if (!fin.ok) { m.dispose(); return { illegal: true, reply: fin.reply }; }
  for (const p of m.alivePlayers()) if (p !== ps && !p.ready) m.scheduleBotPrep(p);
  m.maybeEndPrep();
  const summary = runToEnd(m), errors = errorsOf(m);
  if (errors.match || errors.sim || errors.meta || errors.log.length) throw Error(`rollout engine errors ${JSON.stringify(errors).slice(0, 300)}`);
  const out = { ...outcomeOf(m, summary, battles), ms: performance.now() - t };
  m.dispose();
  return out;
}
