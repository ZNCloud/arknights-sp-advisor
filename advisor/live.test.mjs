// node --test sp-advisor/advisor/live.test.mjs — the live position (advisor/live.mjs) is the client's position: on engine
// self-play, where the engine's own publicView / privateView play the client, the position rebuilt from that view
// scores every board the same as the true position, battle seed for battle seed (bounties, summons and a boss round
// included). A preview the engine cannot match refuses the position.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeMatch } from '../eval/engine.mjs';
import { installGuide } from '../guides/policy.mjs';
import { capture, restore } from './state.mjs';
import { layoutOf, legalTiles } from './field.mjs';
import { scoreSteps, fieldKind, neighbours } from './lineup.mjs';
import { lineupViewOf } from './live-view.mjs';
import { positionOf, scaffoldOf } from './live.mjs';

const spec = JSON.parse(readFileSync(new URL('../../guides/g06_final.json', import.meta.url), 'utf8'));

// p0 ready at round R of a guide game: the true capture and the client's view of it (JSON round trip = what the
// debugger hands over)
function prepAt(seed, R) {
  const m = makeMatch(seed, 4); installGuide(m, spec); m.start();
  m.sched.runUntil(() => (m.round >= R && m.phase === 'PREP' && m.alivePlayers().every(p => p.ready)) || m.phase === 'RESULT', { maxSteps: 5e7 });
  assert.equal(m.round, R, `seed ${seed} reaches R${R}`);
  const p0 = m.players.get('p0');
  const out = { st: capture(m), view: lineupViewOf(JSON.parse(JSON.stringify({ public: m.publicView(), private: p0.privateView() }))),
    bounties: p0.bounties.length, summons: [...p0.board.values()].filter(p => p.kind === 'token').length };
  m.dispose();
  return out;
}
// the current board and a spread of single-step changes, scored on both positions over the same battle seeds
function sameScores(st, built) {
  const m = restore(st, { rngMode: 'exact' }), ps = m.players.get('p0');
  const pieces = new Map(); for (const p of [...ps.board.values(), ...ps.hand]) if (p?.kind === 'chess') pieces.set(p.uid, p);
  const ctx = { pieces, cap: ps.deployCap, legal: new Map([...pieces].map(([u, p]) => [u, new Set(legalTiles(ps, p).map(t => t.join(',')))])), name: String };
  const cands = neighbours(ctx, layoutOf(ps)); m.dispose();
  const lists = [[], ...cands.filter((_, i) => i % Math.max(1, Math.floor(cands.length / 4)) === 0).slice(0, 4).map(n => [{ what: n.what, op: n.op }])];
  const opts = { ...fieldKind(st), seeds: 3, tag: 'live-test', metric: 'own' };
  for (const l of lists) {
    const a = scoreSteps(st, l, opts), b = scoreSteps(built, l.map(x => ({ ...x, op: { ...x.op, uid: -1 } })), opts);   // other uids: hand pieces by id
    assert.deepEqual(b?.samples, a?.samples, l[0]?.what || 'current board');
  }
}

test('normal round with a bounty: the rebuilt position fights like the true one', () => {
  const { st, view, bounties } = prepAt(7001, 3);
  assert.ok(bounties > 0, 'seed 7001 R3 has a bounty (the case this test is for)');
  sameScores(st, positionOf(view).st);
});

test('normal round with a summon on the board', () => {
  const { st, view, summons } = prepAt(7002, 7);
  assert.ok(summons > 0, 'seed 7002 R7 has a summon on the board');
  sameScores(st, positionOf(view).st);
});

test('boss round (R14): escorts matched from the preview', () => {
  const { st, view } = prepAt(7003, 14);
  sameScores(st, positionOf(view).st);
});

test('hidden round (R15): the scaffold enters the Hidden Core as the engine does', () => {
  // the true match enters R15 the same way (bots rarely win R14): only the position-building is under test here
  const m = makeMatch(7003, 4); installGuide(m, spec); m.start();
  m.sched.runUntil(() => (m.round === 14 && m.phase === 'PREP' && m.alivePlayers().every(p => p.ready)) || m.phase === 'RESULT', { maxSteps: 5e7 });
  m.hiddenReached = true; m.bossPool = null; m.startRound(15);
  m.sched.runUntil(() => (m.round === 15 && m.phase === 'PREP' && m.alivePlayers().every(p => p.ready)) || m.phase === 'RESULT', { maxSteps: 5e7 });
  assert.equal(m.round, 15);
  const st = capture(m), view = lineupViewOf(JSON.parse(JSON.stringify({ public: m.publicView(), private: m.players.get('p0').privateView() })));
  m.dispose();
  sameScores(st, positionOf(view).st);
});

test('a preview the engine cannot match refuses the position; one scaffold serves every board of the round', () => {
  const { view } = prepAt(7001, 5);
  const scaffold = scaffoldOf(view);
  assert.ok(positionOf(view, { scaffold }).st);
  const bad = structuredClone(view);
  bad.me.nextEnemies = bad.me.nextEnemies.map(e => ({ ...e, count: e.count + 7 }));
  assert.throws(() => positionOf(bad, { scaffold }), /no engine pick of R5 previews as the client's enemies/);
  assert.throws(() => positionOf({ ...view, me: { ...view.me, diy: ['x'] } }, { scaffold }), /自选编队/);
});
