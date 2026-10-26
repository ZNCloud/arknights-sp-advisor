// node --test advisor-dev/test/overlay-lineup.test.mjs — with the switch back to g06 (--g06), everything the overlay
// writes is byte-for-byte what it wrote before the lineup check and 规则 A existed: state.json after every tick, the
// log and the match records, on the frames of test/fixtures/overlay-frames.jsonl (lobby, three PREP rounds of a
// recorded game incl. R14, a battle). The golden output (test/fixtures/overlay-off.golden.json) was made by the
// overlay.mjs of master dfd5b6c under the same harness (test/overlay-harness.mjs: scripted client, frozen clock).
// (sprlruleA_1345: 站位检查和规则 A 现在默认都开，--g06 是唯一的退回开关，所以这条「默认开」测试改成跑 --g06。)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOverlay } from './overlay-harness.mjs';

const fx = (f) => new URL(`./fixtures/${f}`, import.meta.url);
const frames = fs.readFileSync(fx('overlay-frames.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('--g06: state.json, log and records are byte-identical to the overlay before the lineup check and 规则 A', async () => {
  const golden = JSON.parse(fs.readFileSync(fx('overlay-off.golden.json'), 'utf8'));
  const r = await runOverlay({ frames, args: ['--watch', '--log', '--interval', '20', '--g06'] });
  assert.equal(r.transcript.length, golden.transcript.length);
  r.transcript.forEach((t, i) => assert.equal(t.state, golden.transcript[i].state, `state.json after tick ${i} (${t.frame})`));
  assert.equal(r.stdout, golden.stdout);
  assert.deepEqual(r.records, golden.records);
  assert.ok(r.transcript.every((t) => t.state === undefined || !JSON.parse(t.state).lineup), 'no lineup field under --g06');
});
