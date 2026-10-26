// advisor-dev/lineup-live.mjs — the lineup check (站位检查, advisor/lineup.mjs) in the desktop overlay: off unless
// overlay.mjs runs with --lineup. Every overlay tick in a PREP it reads the client's own view of the seat
// (advisor/live-view.mjs, over the same debugger connection), and once the board has stood still for `settleMs` it has
// the lineup host (advisor/lineup-host.mjs, a worker thread with its own rollout pool) check that board. The result goes
// into the box as one more line of advice — advice only: nothing is ever sent to the client.
//   * a round's scaffold (the slow part of the engine position) is built as soon as its PREP shows up;
//   * the board changes while a check runs → the running check finishes, its result is shown as outdated and the new
//     board is checked next;
//   * less than `marginMs` of the prep left and no result → the round is given up: 「站位检查超时」, nothing else waits;
//   * anything the check cannot do (engine missing, a client position the engine cannot rebuild) is shown, never hidden.
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { lineupViewOf } from './advisor/live-view.mjs';

export const defaultThreads = () => Math.max(1, Math.min(16, availableParallelism() - 2));
const VIEW = `(${lineupViewOf.toString()})(((globalThis.__SP__ && globalThis.__SP__.store && globalThis.__SP__.store.get()) || {}).match)`;
const HOST = new URL('./advisor/lineup-host.mjs', import.meta.url);

// What the check depends on (two views with the same key give the same check): the seat, its effects and the round's enemies.
export const positionKeyOf = v => JSON.stringify([v.round, v.stageId, v.me.lp, v.me.level, v.me.bandId, v.me.board, v.me.hand, v.me.temp, v.me.bonds,
  v.me.effects, v.me.nextEnemies]);

const f1 = x => (Math.round(x * 10) / 10).toFixed(1);
const f2 = x => (Math.round(x * 100) / 100).toFixed(2);

// One line of plain language for a finished check (the box's nl line; lineup.mjs describe() is the long form).
export function lineupLine(r) {
  if (!r.steps.length) return `站位检查（第 ${r.round} 回合）：现在这样站就行，没找到更好的摆法。`;
  const what = r.steps.map(s => s.what).join('，再');
  if (!r.recommend) return `站位检查（第 ${r.round} 回合）：试过「${what}」，复核下来不够稳，照现在站。`;
  const c = r.recheck.current, b = r.recheck.best, n = r.gain.n;
  if (r.kind !== 'normal') return `站位建议（BOSS 回合）：${what}——自己那份 BOSS 血预计 ${f2(c.share)} → ${f2(b.share)} 份（复核 ${n} 场）。`;
  const lp = c.loss - b.loss, lay = b.layers - c.layers;
  const lpText = lp > 0.05 ? `预计少掉 ${f1(lp)} 滴血（${f1(c.loss)} → ${f1(b.loss)}）` : lp < -0.05 ? `多掉 ${f1(-lp)} 滴血（${f1(c.loss)} → ${f1(b.loss)}）` : '掉血差不多';
  const layText = Math.abs(lay) >= 0.05 ? `，这一仗${lay > 0 ? '多' : '少'}拿 ${f1(Math.abs(lay))} 层` : '';
  return `站位建议：${what}——${lpText}${layText}（复核 ${n} 场）。`;
}

export class LiveLineup {
  constructor({ threads = defaultThreads(), settleMs = 1500, marginMs = 10000, log = () => {}, host = HOST, now = () => Date.now() } = {}) {
    if (!(Number.isInteger(threads) && threads >= 1)) throw Error(`--lineup-threads must be a whole number ≥ 1, got ${threads}`);
    Object.assign(this, { threads, settleMs, marginMs, log, hostUrl: host, now });
    this.worker = null; this.job = null; this.seq = 0;
    this.round = null; this.key = null; this.keySince = 0; this.deadline = null; this.clock = null;
    this.result = null;          // { key, round, state: 'done' | 'error' | 'timeout', res?, error? }
    this.hostError = null;       // the host could not start (engine missing, …): shown, the overlay goes on without it
    this.prepared = null;        // round whose scaffold is built
  }

  _host() {
    if (this.worker) return this.worker;
    const w = new Worker(this.hostUrl, { workerData: { threads: this.threads } });
    w.on('message', msg => this._reply(msg));
    w.on('error', e => { this.hostError = String(e?.message || e); this.log(`站位检查宿主出错：${this.hostError}`); this._drop(w); });
    w.on('exit', code => { if (this.worker === w) { if (code !== 0 && !this.hostError) this.hostError = `宿主线程退出 ${code}`; this._drop(w); } });
    this.worker = w;
    return w;
  }
  _drop(w) { if (this.worker === w) { this.worker = null; this.job = null; } }
  _send(type, view, key) {
    const id = ++this.seq;
    this.job = { id, type, key, round: view.round, since: this.now(), cancelAt: null };
    this._host().postMessage({ type, id, view });
  }
  _reply(msg) {
    const job = this.job;
    if (!job || msg.id !== job.id) return;
    this.job = null;
    if (msg.type === 'prepared') { this.prepared = job.round; this.log(`站位检查：第 ${job.round} 回合的引擎局面准备好（${(msg.ms / 1000).toFixed(1)} 秒）`); return; }
    if (job.cancelAt) return;   // given up (timeout / round over): its late answer is not shown
    if (job.type === 'prepare') { this.result = { key: null, round: job.round, state: 'error', error: msg.error }; return; }
    this.result = msg.type === 'result' ? { key: job.key, round: job.round, state: 'done', res: msg.res, ms: this.now() - job.since }
      : { key: job.key, round: job.round, state: 'error', error: msg.error };
    if (msg.type === 'result') this.log(`站位检查 R${job.round}：${lineupLine(msg.res)}（${((this.now() - job.since) / 1000).toFixed(1)} 秒，局面 ${msg.res.buildMs} 毫秒，${msg.res.evals} 次评估）${msg.res.notes.length ? ' 注：' + msg.res.notes.join('；') : ''}`);
    else this.log(`站位检查 R${job.round} 出错：${msg.error}`);
  }
  _cancel(why) {
    const job = this.job;
    if (!job || job.cancelAt) return;
    job.cancelAt = this.now();
    if (job.type === 'check') this.worker?.postMessage({ type: 'cancel', id: job.id });
    this.log(`站位检查 R${job.round}：放弃（${why}）`);
  }

  // One overlay tick. `view` = lineupViewOf of this moment (null: not readable). Returns the box fragment or null.
  step(view) {
    const now = this.now();
    // a cancelled check that never answers (a stuck pool): the host is replaced
    if (this.job?.cancelAt && now - this.job.cancelAt > 30000) { this.log('站位检查：宿主不响应，重启'); const w = this.worker; this._drop(w); w?.terminate(); }
    if (this.hostError) return { state: 'error', text: `站位检查没开起来：${this.hostError.slice(0, 120)}` };
    if (!view || view.phase !== 'PREP' || !view.me || !view.me.alive) {
      if (this.job && this.job.type === 'check') this._cancel('休整期结束');
      return null;
    }
    if (view.round !== this.round) { this.round = view.round; this.deadline = null; this.clock = null; this.key = null; this.result = null; }
    // the prep deadline in local time: re-anchored whenever the server sends a new (deadline, serverNow) pair
    if (view.deadline != null && view.serverNow != null) {
      const clock = `${view.deadline}|${view.serverNow}`;
      if (clock !== this.clock) { this.clock = clock; this.deadline = now + (view.deadline - view.serverNow); }
    }
    const left = this.deadline == null ? Infinity : this.deadline - now;
    const key = positionKeyOf(view);
    if (key !== this.key) { this.key = key; this.keySince = now; }
    const mine = this.result?.round === view.round ? this.result : null;
    const timedOut = mine?.state === 'timeout', unbuildable = mine?.state === 'error' && mine.key === null;   // this round is given up
    if (this.job) {
      if (this.job.type === 'check' && !this.job.cancelAt && left < this.marginMs) {
        this._cancel(`休整期只剩 ${Math.max(0, Math.round(left / 1000))} 秒`);
        this.result = { key: this.job.key, round: view.round, state: 'timeout' };
      }
    } else if (timedOut || unbuildable) {
      // nothing more this round
    } else if (this.prepared !== view.round) {
      this._send('prepare', view, null);
    } else if (this.result?.key !== key) {
      if (left < this.marginMs) this.result = { key, round: view.round, state: 'timeout' };
      else if (now - this.keySince >= this.settleMs) this._send('check', view, key);
    }
    return this.fragment(view.round, key, now);
  }

  fragment(round, key, now = this.now()) {
    const r = this.result?.round === round ? this.result : null;
    const running = this.job && !this.job.cancelAt && this.job.round === round ? this.job : null;
    if (r?.state === 'timeout') return { state: 'timeout', round, text: `站位检查超时（第 ${round} 回合放弃，下回合再算）。` };
    if (r?.state === 'error' && (r.key === key || r.key === null)) return { state: 'error', round, text: `站位检查出错：${String(r.error).slice(0, 120)}` };
    if (r?.state === 'done') {
      const res = r.res, fresh = r.key === key;
      const out = { state: fresh ? 'done' : 'outdated', round, recommend: res.recommend, kind: res.kind, steps: res.steps.map(s => s.what),
        gain: res.gain, recheck: res.recheck, ms: r.ms, evals: res.evals, notes: res.notes, text: lineupLine(res) };
      // 棋盘示意图（sprlui_1825 的「additional 窗口」）要画的原料：谁站哪（uid@row,col,dir）、建议挪到哪、
      // uid→干员 id 的表——名字由 overlay.mjs 的 boardDiagramOf 用插件核心的 nameOf 解析（这里不碰插件核心）。
      if (Array.isArray(res.current)) out.board = { current: res.current, best: res.best, names: res.names };
      if (!fresh) out.text = `（棋盘动过，正在按新站位重算）${out.text}`;
      return out;
    }
    // the text stays the same while it runs (the overlay logs every change of the box text)
    if (running) return { state: 'running', round, elapsedMs: now - running.since, text: `站位检查：第 ${round} 回合在算…` };
    return { state: 'waiting', round, text: null };
  }

  // The overlay's hook: read the view (PREP only), advance, and put the result into the box (one more nl line).
  async attach(box, snap, cdp) {
    let view = null;
    if (snap && snap.ok && snap.phase === 'PREP') {
      try { view = await cdp.evaluate(VIEW); } catch (e) { view = null; this.log(`站位检查：读局面失败 ${String(e.message || e).slice(0, 90)}`); }
    }
    const frag = this.step(view);
    if (!frag) return box;
    box.lineup = frag;
    if (frag.text && Array.isArray(box.nl) && !box.text) box.nl = [...box.nl, frag.text];
    return box;
  }

  async close() { const w = this.worker; this.worker = null; this.job = null; if (w) await w.terminate(); }
}
