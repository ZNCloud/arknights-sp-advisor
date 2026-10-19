import { parentPort } from 'node:worker_threads';
import { makeMatch, runToEnd, errorsOf, createRng, deriveSeed } from '../eval/engine.mjs';
import { installGuide, guidePrep } from '../guides/policy.mjs';
import { traceBattles, outcomeOf } from './rollout.mjs';
import { listActions, applyAction } from './actions.mjs';
import { seatFeatures } from './features.mjs';
import { tableFeatures } from './features-table.mjs';
const r3 = v => v.map(x => Math.round(x * 1000) / 1000);
import { COMBOS, placeCombo } from '../eval/combos.mjs';

function play({ seed, spec, policy }) {
  const m = makeMatch(seed, 4); installGuide(m, spec);
  const battles = traceBattles(m), rng = createRng(deriveSeed(seed, 'datagen')), rows = [];
  const injectOn = r => policy.inject && r >= policy.injectFrom;
  m.scheduleBotPrep = function (ps) {
    const round = this.round;
    this.later(0, () => {
      if (this.phase !== 'PREP' || this.round !== round || !ps.alive || ps.ready) return;
      if (injectOn(round)) { placeCombo(this, ps, COMBOS[policy.inject]); ps.resolveTemp(); if (!ps.setReady(true).ok) throw Error('inject ready'); return; }
      // B4: bias towards changed operators — buy a favoured chess from the shop when affordable (70%).
      if (policy.favor?.length && rng() < .7) for (let i = 0; i < 2; i++) {
        const slot = ps.shop.slots.findIndex(s => s?.kind === 'chess' && !s.sold && policy.favor.includes(this.gd.baseIdOf(s.id)) && ps.priceOf(s) <= ps.funds);
        if (slot < 0 || ps.hand.every(Boolean)) break;
        ps.buy(slot);
      }
      if (policy.eps && rng() < policy.eps) {
        const k = 1 + rng.int(3);
        for (let i = 0; i < k; i++) {
          const acts = listActions(this, ps).filter(a => !['guide', 'end', 'move', 'bench', 'rotate'].includes(a.type));
          if (!acts.length) break;
          applyAction(this, ps, rng.pick(acts)); // engine refusals are legal no-ops here (random exploration)
        }
        if (rng() < .3) { ps.resolveTemp(); if (ps.setReady(true).ok) return; }
      }
      guidePrep(this, ps);
    });
  };
  const end = m.endPrep;
  m.endPrep = function (...a) {
    for (const ps of this.alivePlayers()) rows.push({ seed, round: this.round, seat: ps.playerId, spec: spec.id, eps: policy.eps || 0, favor: policy.favor?.length ? 1 : 0, inject: injectOn(this.round) ? policy.inject : null, x: seatFeatures(this, ps), ...(policy.table ? { t: r3(tableFeatures(this, ps)) } : {}) });
    return end.apply(this, a);
  };
  m.start();
  const s = runToEnd(m), errors = errorsOf(m);
  if (errors.match || errors.sim || errors.meta || errors.log.length) throw Error(`datagen engine errors seed ${seed}`);
  const outcome = outcomeOf(m, s, battles); m.dispose();
  for (const r of rows) Object.assign(r, { win: outcome.win ? 1 : 0, hidden: outcome.hidden ? 1 : 0, utility: outcome.utility, r14Dmg: outcome.r14Dmg, lastRound: outcome.lastRound });
  return { rows, outcome };
}
parentPort.on('message', task => {
  try { parentPort.postMessage({ result: play(task) }); } catch (e) { parentPort.postMessage({ error: `seed ${task.seed}: ${e.stack || e}` }); }
});
