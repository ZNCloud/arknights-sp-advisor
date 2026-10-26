// Worker thread of the overlay's lineup check (lineup-live.mjs): owns the rollout pool, builds the live position
// (advisor/live.mjs) and runs the lineup check (advisor/lineup.mjs) off the overlay's own thread, so the other advice
// keeps updating while it runs. One job at a time (the overlay sends the next one after the reply):
//   { type: 'prepare', id, view }  build the round's scaffold (once per round; the slow part of the position)
//   { type: 'check', id, view }    position + checkLineup → { type: 'result', id, res } / { type: 'error', id, error }
//   { type: 'cancel', id }         the running check stops at its next batch (→ { type: 'cancelled', id })
import { parentPort, workerData } from 'node:worker_threads';
import { RolloutPool } from './pool.mjs';
import { toJSON } from './state.mjs';
import { scaffoldOf, scaffoldKey, positionOf } from './live.mjs';
import { checkLineup, poolEval, searchBoardAsync } from './lineup.mjs';

const pool = new RolloutPool(workerData.threads);
const cancelled = new Set();
let scaffold = null, scaffoldFor = null;

function scaffoldOfView(view) {
  const key = scaffoldKey(view);
  if (key !== scaffoldFor) { scaffold = null; scaffoldFor = null; scaffold = scaffoldOf(view); scaffoldFor = key; }   // a throw leaves no stale scaffold
  return scaffold;
}

async function check(id, view) {
  const t0 = performance.now();
  const sc = scaffoldOfView(view);
  const { st, notes } = positionOf(view, { scaffold: sc });
  const buildMs = Math.round(performance.now() - t0);
  const run = poolEval(pool, toJSON(st), `live:${id}`);
  const evalMany = (lists, opts) => { if (cancelled.has(id)) throw Error('cancelled'); return run(lists, opts); };
  // --board (sprluse_1910): the engine board search (placement + item carriers, advisor/lineup.mjs boardSearch)
  // instead of the greedy lineup check. Not wired into the board-diagram current/best/names shape yet (§ below).
  if (workerData.slopes) return { ...boardResult(await searchBoardAsync(st, evalMany, { playerId: 'p0', slopes: workerData.slopes })), buildMs, notes };
  const res = await checkLineup(st, { playerId: 'p0', evalMany, recheckMetric: 'own' });
  // current/best/names (sprlui_1825): the board diagram in the desktop box's additional window needs the actual
  // layouts (uid@row,col,dir), not just the step descriptions — checkLineup already computes them, this just stops
  // throwing them away before the postMessage back to the overlay thread.
  return { kind: res.kind, round: res.round, recommend: res.recommend, gain: res.gain, recheck: res.recheck, evals: res.evals,
    steps: res.steps.map(s => ({ what: s.what, kind: s.kind })), ms: res.ms, buildMs, notes,
    current: res.current, best: res.best, names: res.names };
}

// --board (overlay): the engine board search's result in the lineup check's result shape, so lineupLine shows it the
// same way. Its gain is the search's own paired score over the same fights (no separate re-check: the search already
// scores every candidate on the starting board's fight seeds).
function boardResult(r) {
  const gain = r.best && r.start ? { mean: r.best.value - r.start.value, se: null, n: r.best.samples?.length || 0 } : null;
  const recheck = r.best && r.start ? { metric: 'own', current: { loss: r.start.loss, layers: r.start.layers }, best: { loss: r.best.loss, layers: r.best.layers } } : null;
  return { kind: r.kind, round: r.round, recommend: r.steps.length > 0, gain, recheck, evals: r.evals, ms: r.ms,
    steps: r.steps.map(s => ({ what: s.what, kind: s.kind })) };
}

parentPort.on('message', async (msg) => {
  if (msg.type === 'cancel') { cancelled.add(msg.id); return; }
  try {
    if (msg.type === 'prepare') { const t0 = performance.now(); scaffoldOfView(msg.view); parentPort.postMessage({ type: 'prepared', id: msg.id, ms: Math.round(performance.now() - t0) }); return; }
    if (msg.type !== 'check') throw Error(`lineup host: unknown message ${msg.type}`);
    const res = await check(msg.id, msg.view);
    parentPort.postMessage(cancelled.has(msg.id) ? { type: 'cancelled', id: msg.id } : { type: 'result', id: msg.id, res });
  } catch (e) {
    parentPort.postMessage(cancelled.has(msg.id) ? { type: 'cancelled', id: msg.id } : { type: 'error', id: msg.id, error: String(e?.message || e) });
  } finally { cancelled.delete(msg.id); }
});
