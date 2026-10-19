import { parentPort } from 'node:worker_threads';
import { runHind } from './hindsight.mjs';
parentPort.on('message', (task) => {
  try { parentPort.postMessage({ result: runHind(task) }); } catch (e) { parentPort.postMessage({ error: `${task.game} R${task.round} ${task.cand} ${task.mode} s${task.sampleSeed}: ${e.stack || e}` }); }
});
