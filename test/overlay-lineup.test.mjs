// node --test advisor-dev/test/overlay-lineup.test.mjs — with the lineup check off (no --lineup), everything the overlay
// writes is byte-for-byte what it wrote before the check existed: state.json after every tick, the log and the match
// records, on the frames of test/fixtures/overlay-frames.jsonl (lobby, three PREP rounds of a recorded game incl. R14,
// a battle). The golden output (test/fixtures/overlay-off.golden.json) was made by the overlay.mjs of master dfd5b6c
// under the same harness (test/overlay-harness.mjs: scripted client, frozen clock).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOverlay } from './overlay-harness.mjs';

const fx = (f) => new URL(`./fixtures/${f}`, import.meta.url);
const frames = fs.readFileSync(fx('overlay-frames.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('lineup off: state.json, log and records are byte-identical to the overlay before the lineup check', async () => {
  const golden = JSON.parse(fs.readFileSync(fx('overlay-off.golden.json'), 'utf8'));
  const r = await runOverlay({ frames });
  assert.equal(r.transcript.length, golden.transcript.length);
  r.transcript.forEach((t, i) => assert.equal(t.state, golden.transcript[i].state, `state.json after tick ${i} (${t.frame})`));
  assert.equal(r.stdout, golden.stdout);
  assert.deepEqual(r.records, golden.records);
  assert.ok(r.transcript.every((t) => t.state === undefined || !JSON.parse(t.state).lineup), 'no lineup field when off');
});
