// node --test test/overlay-board.test.mjs — the engine board search (--board, advisor/lineup.mjs boardSearch,
// sprluse_1910/sprlpush3_2245) is now the default (sprldef_2055); --no-board reverts the lineup check to the old
// greedy checkLineup, byte-identical to the overlay before --board existed. Golden sample
// test/fixtures/overlay-board.golden.json is master 61f85a0's overlay.mjs (no --board; --board didn't exist yet as a
// default) under the same harness/frames, with badges kept (prove nothing else moved) and the async lineup fragment
// stripped (same method as test/overlay-axis.test.mjs / test/overlay-badges.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOverlay, withoutLineup } from './overlay-harness.mjs';

const fx = (f) => new URL(`./fixtures/${f}`, import.meta.url);
const frames = fs.readFileSync(fx('overlay-frames.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const golden = JSON.parse(fs.readFileSync(fx('overlay-board.golden.json'), 'utf8'));
const ARGS = ['--watch', '--log', '--interval', '20'];

test('--no-board: state.json, log and records are byte-identical to the overlay before --board existed (61f85a0, no --board)', async () => {
  const r = withoutLineup(await runOverlay({ frames, args: [...ARGS, '--no-board'] }), { keepBadge: true });
  assert.equal(r.transcript.length, golden.transcript.length);
  r.transcript.forEach((t, i) => assert.equal(t.state, golden.transcript[i].state, `state.json after tick ${i} (${t.frame})`));
  assert.equal(r.stdout, golden.stdout);
  assert.deepEqual(r.records, golden.records);
});

test('default (no args): rule A, lineup check, axis weight, badges, board diagram and the engine board search are all on', async () => {
  const r = withoutLineup(await runOverlay({ frames, args: ARGS }), { keepBadge: true, keepFeatures: true });
  const states = r.transcript.filter((t) => t.state !== undefined).map((t) => JSON.parse(t.state)).filter((s) => s.features);
  assert.ok(states.length > 0, 'at least one state (PREP, has a private view) carries a features summary');
  for (const s of states) {
    assert.equal(s.features.ruleA, true);
    assert.equal(s.features.lineup, true);
    assert.equal(s.features.axis, true);
    assert.equal(s.features.badges, true);
    assert.equal(s.features.boardDiagram, true);
    assert.equal(s.features.board, true);
    assert.match(s.features.text, /规则A/);
    assert.match(s.features.text, /引擎摆位搜索/);
  }
});

test('--no-axis --no-badges --no-board: features reports exactly what is left on (rule A + the lineup check), and board/axis/badges all read false', async () => {
  const r = withoutLineup(await runOverlay({ frames, args: [...ARGS, '--no-axis', '--no-badges', '--no-board'] }), { keepFeatures: true });
  const states = r.transcript.filter((t) => t.state !== undefined).map((t) => JSON.parse(t.state));
  const withFeatures = states.filter((s) => s.features);
  assert.ok(withFeatures.length > 0);
  for (const s of withFeatures) {
    assert.equal(s.features.ruleA, true);
    assert.equal(s.features.lineup, true);
    assert.equal(s.features.axis, false);
    assert.equal(s.features.badges, false);
    assert.equal(s.features.boardDiagram, false);
    assert.equal(s.features.board, false);
  }
});

test('--g06: features reports everything off (the oldest baseline)', async () => {
  const r = withoutLineup(await runOverlay({ frames, args: [...ARGS, '--g06'] }), { keepFeatures: true });
  const states = r.transcript.filter((t) => t.state !== undefined).map((t) => JSON.parse(t.state));
  const withFeatures = states.filter((s) => s.features);
  assert.ok(withFeatures.length > 0);
  for (const s of withFeatures) {
    assert.equal(s.features.ruleA, false);
    assert.equal(s.features.lineup, false);
    assert.equal(s.features.axis, false);
    assert.equal(s.features.badges, false);
    assert.equal(s.features.boardDiagram, false);
    assert.equal(s.features.board, false);
    assert.match(s.features.text, /已退回最早默认/);
  }
});
