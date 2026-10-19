// Worker bootstrap: install the parent's content patch (if any) before the worker module imports the engine.
import { workerData } from 'node:worker_threads';
if (workerData?.patch) await (await import('../eval/content.mjs')).installPatch(workerData.patch);
await import(workerData.script);
