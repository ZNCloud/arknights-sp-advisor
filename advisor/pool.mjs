// worker_threads pool. Each worker loads the engine once; a job is one message (rollout, self-play game, ...).
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { contentPatch } from '../eval/content.mjs';

export class RolloutPool {
  constructor(size = Math.max(1, Math.min(48, availableParallelism() - 2)), script = new URL('./worker.mjs', import.meta.url)) {
    this.size = size; this.idle = []; this.queue = []; this.workers = [];
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./boot.mjs', import.meta.url), { workerData: { script: String(script), patch: contentPatch()?.path || null } });
      w.on('message', (msg) => { const { resolve, reject } = w.job; w.job = null; msg.error ? reject(Error(msg.error)) : resolve(msg.result); this._next(w); });
      w.on('error', (e) => { if (w.job) w.job.reject(e); w.job = null; });
      this.workers.push(w); this.idle.push(w);
    }
  }
  run(task) { return new Promise((resolve, reject) => { this.queue.push({ task, resolve, reject }); this._pump(); }); }
  _pump() { while (this.idle.length && this.queue.length) { const w = this.idle.pop(), j = this.queue.shift(); w.job = j; w.postMessage(j.task); } }
  _next(w) { this.idle.push(w); this._pump(); }
  async close() { await Promise.all(this.workers.map(w => w.terminate())); }
}
