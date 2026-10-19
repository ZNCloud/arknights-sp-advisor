import { parentPort } from 'node:worker_threads';
import { fromJSON } from './state.mjs';
import { runRollout } from './rollout.mjs';
import { loadTrees, scoreAction } from './model.mjs';
let cacheKey = null, cacheState = null, models = null, modelKey = null;
parentPort.on('message', async (task) => {
  try {
    // The same position is sent for every candidate × sample; parse it once per worker.
    if (task.stateKey !== cacheKey) { cacheState = fromJSON(task.stateJSON); cacheKey = task.stateKey; }
    if (task.kind === 'score') {
      if (modelKey !== task.modelDir) { models = { win: loadTrees(`${task.modelDir}/value-win.json`), util: loadTrees(`${task.modelDir}/value-util.json`) }; modelKey = task.modelDir; }
      parentPort.postMessage({ result: await scoreAction(cacheState, { ...task, models }) });
    } else parentPort.postMessage({ result: runRollout(cacheState, task) });
  } catch (e) { parentPort.postMessage({ error: e.stack || String(e) }); }
});
