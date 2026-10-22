// node --test sp-advisor/distill/distill.test.mjs   (needs the engine checkout next to sp-advisor, like the other tests)
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from '../eval/engine.mjs';
import { listActions } from '../advisor/actions.mjs';
import { tableNames, tableSelf } from '../advisor/features-table.mjs';
import { VOCAB, GUIDE, vocabIndex, legalByIndex } from './vocab.mjs';
import { studentFeatures, studentNames } from './features.mjs';
import { forward } from './student.mjs';

function prepMatch(seed = 4242) {
  const m = makeMatch(seed, 4);
  m.start(); m.sched.runUntil(() => m.phase === 'PREP', { maxSteps: 1e6 });
  return m;
}

test('vocab: every vocabulary action maps to its own slot, layout / sell / equip stay outside', () => {
  assert.equal(vocabIndex({ type: 'guide' }), GUIDE);
  assert.equal(VOCAB[vocabIndex({ type: 'buy', slot: 3 })], 'buy:3');
  assert.equal(VOCAB[vocabIndex({ type: 'reward', idx: 1 })], 'reward:1');
  assert.equal(VOCAB[vocabIndex({ type: 'macro', name: 'roll' })], 'macro:roll');
  for (const type of ['move', 'bench', 'rotate', 'sell', 'equip']) assert.equal(vocabIndex({ type }), -1);
  const m = prepMatch(), acts = listActions(m, m.players.get('p0')), legal = legalByIndex(acts);
  assert.ok(legal.has(GUIDE) && legal.size >= 3);
  for (const [i, a] of legal) assert.equal(vocabIndex(a), i);
  m.dispose();
});

test('features: named, own block = tableSelf, teammates from the public view only', () => {
  const m = prepMatch(), ps = m.players.get('p0'), { names, selfN } = studentNames(m.gd);
  const x = studentFeatures(m, ps);
  assert.equal(x.length, names.length);
  assert.equal(new Set(names).size, names.length, 'feature names are unique');
  assert.deepEqual(x.slice(0, selfN), tableSelf(m, ps));
  assert.equal(selfN, tableNames(m.gd).selfN);
  // a teammate's funds and hand are not public: changing them must not move the student's input
  const q = m.players.get('p1'), funds = q.funds;
  q.funds += 37;
  assert.deepEqual(studentFeatures(m, ps), x);
  q.funds = funds;
  // a teammate's LP is public: it must
  q.lp -= 5;
  const y = studentFeatures(m, ps), at = names.indexOf('mate+1.lp');
  assert.equal(y[at], x[at] - 5);
  m.dispose();
});

test('datagen refuses seeds of the fixed eval / training ranges', async () => {
  const { checkSeeds, parseSeeds } = await import('./datagen.mjs');
  assert.doesNotThrow(() => checkSeeds(parseSeeds('100001-100040')));
  assert.throws(() => checkSeeds(parseSeeds('5100-5101')), /reserved/);
  assert.throws(() => checkSeeds(parseSeeds('99990-100000,60500')), /reserved/);
});

test('student forward: standardise + clip, ReLU trunk, three heads', () => {
  const s = { norm: { mean: [0, 1], std: [1, 0.5], clip: 10 }, trunk: [{ W: [[1, -1], [0.5, 0.5]], b: [0, 0] }],
    heads: { q: { W: [[1, 0], [0, 1]], b: [0, 0.1] }, line: { W: [[1, 1]], b: [0] }, value: { W: [[0, 1]], b: [0.5] } } };
  // x = [2, 1001] → z = [2, clip(2000) = 10] → h = relu([2-10, 1+5]) = [0, 6]
  const o = forward(s, [2, 1001]);
  assert.deepEqual(o.q, [0, 6.1]);
  assert.deepEqual(o.line, [6]);
  assert.equal(o.value, 6.5);
});
