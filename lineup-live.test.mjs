// node --test advisor-dev/lineup-live.test.mjs — the overlay side of the lineup check (lineup-live.mjs) against a stub
// host (no engine): the board must stand still before a check starts, a result belongs to the board it was made for,
// less than 10 s of prep left gives the round up (「站位检查超时」) and its late answer is not shown, and every failure is
// shown in the box.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LiveLineup, lineupLine } from './lineup-live.mjs';

// stub host: answers 'prepare' at once, 'check' after `delay` ms with a fixed result (or an error for an 'err' stage)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lineup-live-test-'));
const stub = path.join(dir, 'host.mjs');
fs.writeFileSync(stub, `import { parentPort, workerData } from 'node:worker_threads';
parentPort.on('message', (m) => {
  if (m.type === 'cancel') return;
  if (m.type === 'prepare') return parentPort.postMessage(m.view.stageId === 'bad' ? { type: 'error', id: m.id, error: 'stage bad is not in the engine data' } : { type: 'prepared', id: m.id, ms: 1 });
  setTimeout(() => parentPort.postMessage(m.view.stageId === 'err' ? { type: 'error', id: m.id, error: 'no engine pick of R5 previews as the client' }
    : { type: 'result', id: m.id, res: { kind: 'normal', round: m.view.round, recommend: true, gain: { mean: 2, se: 0.3, n: 24 }, evals: 9, ms: 5, buildMs: 1, notes: [],
      recheck: { metric: 'own', lpWeight: 1, current: { loss: 3, layers: 1 }, best: { loss: 1, layers: 1 } }, steps: [{ what: '折桠 从 11,6 挪到 9,3', kind: 'move' }] } }), workerData.delay ?? 30);
});
`);
const wait = ms => new Promise(r => setTimeout(r, ms));
const view = (o = {}) => ({ phase: 'PREP', round: 5, deadline: 100000, serverNow: 0, stageId: 's', me: { alive: true, lp: 20, level: 4, bandId: null,
  board: [{ kind: 'chess', id: 'a', row: 11, col: 6 }], hand: [], temp: [], bonds: [], effects: [], nextEnemies: [] }, ...o });
async function settle(L, v, n = 20) { let f; for (let i = 0; i < n; i++) { f = L.step(v); if (f && ['done', 'error', 'timeout'].includes(f.state)) return f; await wait(15); } return f; }

test('a check starts once the board stood still, and its result is one plain line', async () => {
  const L = new LiveLineup({ threads: 1, settleMs: 60, host: new URL(`file://${stub}`) });
  const v = view();
  const f0 = L.step(v);
  assert.equal(f0.state, 'running');            // the round's scaffold is being prepared
  const f = await settle(L, v);
  assert.equal(f.state, 'done');
  assert.equal(f.text, '站位建议：折桠 从 11,6 挪到 9,3——预计少掉 2.0 滴血（3.0 → 1.0）（复核 24 场）。');
  await L.close();
});

test('a result made for an older board is marked outdated and the new board is checked', async () => {
  const L = new LiveLineup({ threads: 1, settleMs: 40, host: new URL(`file://${stub}`) });
  await settle(L, view());
  const moved = view({ me: { ...view().me, board: [{ kind: 'chess', id: 'a', row: 9, col: 3 }] } });
  const f = L.step(moved);
  assert.equal(f.state, 'outdated');
  assert.match(f.text, /^（棋盘动过，正在按新站位重算）/);
  assert.equal((await settle(L, moved, 40)).state, 'done');
  await L.close();
});

test('less than 10 s of prep left: the round is given up and its late answer is not shown', async () => {
  let t = 0;
  const L = new LiveLineup({ threads: 1, settleMs: 0, host: new URL(`file://${stub}`), now: () => t });
  const v = view({ deadline: 30000 });
  L.step(v); await wait(50); L.step(v);          // prepared → the check is sent
  assert.equal(L.job?.type, 'check');
  t = 21000;                                     // 9 s left
  const f = L.step(v);
  assert.equal(f.state, 'timeout');
  assert.equal(f.text, '站位检查超时（第 5 回合放弃，下回合再算）。');
  await wait(80);                                // the check's answer arrives
  assert.equal(L.step(v).state, 'timeout');
  assert.equal(L.job, null);
  await L.close();
});

test('failures are shown: a position the engine refuses, a round it cannot set up, a host that cannot start', async () => {
  const L = new LiveLineup({ threads: 1, settleMs: 0, host: new URL(`file://${stub}`) });
  assert.match((await settle(L, view({ stageId: 'err' }))).text, /^站位检查出错：no engine pick of R5/);
  const B = new LiveLineup({ threads: 1, settleMs: 0, host: new URL(`file://${stub}`) });
  const fb = await settle(B, view({ stageId: 'bad' }));
  assert.match(fb.text, /^站位检查出错：stage bad/);
  await wait(30); assert.equal(B.step(view({ stageId: 'bad' })).state, 'error'); assert.equal(B.job, null);   // no retry this round
  const C = new LiveLineup({ threads: 1, settleMs: 0, host: new URL(`file://${path.join(dir, 'missing.mjs')}`) });
  C.step(view()); await wait(150);
  assert.match(C.step(view()).text, /^站位检查没开起来：/);
  await Promise.all([L.close(), B.close(), C.close()]);
});

test('lineupLine: no change / not significant / boss round', () => {
  const base = { kind: 'normal', round: 7, recommend: false, steps: [], gain: null, recheck: null };
  assert.equal(lineupLine(base), '站位检查（第 7 回合）：现在这样站就行，没找到更好的摆法。');
  assert.equal(lineupLine({ ...base, steps: [{ what: 'X（10,4）改朝上' }] }), '站位检查（第 7 回合）：试过「X（10,4）改朝上」，复核下来不够稳，照现在站。');
  assert.equal(lineupLine({ kind: 'boss', round: 14, recommend: true, steps: [{ what: '换下 A，换上 B（9,7）' }], gain: { n: 16 },
    recheck: { current: { share: 0.41 }, best: { share: 0.55 } } }), '站位建议（BOSS 回合）：换下 A，换上 B（9,7）——自己那份 BOSS 血预计 0.41 → 0.55 份（复核 16 场）。');
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
