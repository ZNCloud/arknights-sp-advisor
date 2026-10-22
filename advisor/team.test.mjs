// node --test sp-advisor/advisor/team.test.mjs  (from <root>, engine at <root>/engine)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matesOf, resultOf, tracksOf, rateMatch, pickLine, teamSpec, observedLine } from './team.mjs';
import { learnTempo } from './learn-team.mjs';
import { playTeam } from '../eval/teamplay-worker.mjs';

const base = JSON.parse(readFileSync('guides/g06_final.json', 'utf8'));
const profiles = JSON.parse(readFileSync(new URL('../eval/team-profiles.json', import.meta.url), 'utf8'));

test('matesOf: everyone but me, mode-off bonds dropped, overlay field names', () => {
  const players = [
    { playerId: 'a', seat: 0, name: 'A', shopLevel: 3, boardCount: 5, lp: 30, bonds: [{ bondId: 'x', count: 2, layers: 9 }] },
    { playerId: 'b', seat: 1, name: 'B', shopLevel: 4, boardCount: 6, lp: 20, isBot: true, bonds: [{ bondId: 'y', count: 3, layers: 40 }, { bondId: 'z', count: 1, layers: 0, off: true }] },
  ];
  assert.deepEqual(matesOf(players, 'a'), [{ name: 'B', seat: 1, isBot: true, alive: true, lp: 20, level: 4, board: 6, status: null, bandId: null, bonds: ['y:3/40'] }]);
});

test('self-play record → 4 seats with result; team view keeps p0 off the teammates\' lines', () => {
  const g = playTeam({ seed: 3001, base, seats: { p0: 'teamview', p1: 'g06', p2: 'g06', p3: 'g06' }, profiles, lines: 'mates' });
  const t = tracksOf(g.rows);
  assert.equal(t.seats.length, 4);
  assert.ok(t.hasMates && t.result);
  assert.deepEqual(t.seats.map((s) => s.seat).sort(), [0, 1, 2, 3]);
  for (const s of t.seats) assert.ok(s.result && s.result.seat === s.seat);
  assert.ok(!['p1', 'p2', 'p3'].some((p) => g.routes[p] === g.routes.p0));
  const rated = rateMatch(t, null);
  const dO = rated.map((r) => r.dO);
  assert.ok(Math.abs(dO.reduce((a, b) => a + b, 0)) < 1e-9);    // relative to the table: sums to 0
});

test('pickLine: a learned line only when > 2 SE ahead of the default, never a taken line', () => {
  const prof = (gap) => ({ lines: { overall: { a: { A: 0, se: 0.01, n: 100 }, b: { A: gap, se: 0.01, n: 100 } },
    byBoss: { B: [{ line: 'b', A: gap, se: 0.01, n: 50 }, { line: 'a', A: 0, se: 0.01, n: 50 }] } } });
  assert.equal(pickLine(prof(0.02), { bossId: 'B', avail: ['a', 'b'], taken: [], fallback: 'a' }), 'a');   // 0.02 < 2·√2·0.01
  assert.equal(pickLine(prof(0.05), { bossId: 'B', avail: ['a', 'b'], taken: [], fallback: 'a' }), 'b');
  assert.equal(pickLine(prof(0.05), { bossId: 'B', avail: ['a', 'b'], taken: ['b'], fallback: 'a' }), 'a');
  assert.equal(pickLine(null, { bossId: 'B', avail: ['a', 'b'], taken: ['a'], fallback: 'a' }), 'b');
});

test('teamSpec: visible lines kept, a teammate ahead of the base tempo keeps its offset', () => {
  const ps = (playerId, level, bonds) => ({ playerId, alive: true, shop: { level }, bonds });
  const m = { round: 6, bossId: 'B', disabledBonds: [], staticInactiveBonds: [], gd: { bondIds: Object.keys(base.recipes), maxShopLevel: 6 },
    order: [ps('p0', 3, {}), ps('p1', 4, { yanShip: { count: 3, layers: 20 } }), ps('p2', 3, { kjeragShip: { count: 2, layers: 0 } }), ps('p3', 3, {})] };
  const s = teamSpec(base, m, 'p0');
  assert.equal(s.seats.p1.route, 'yanShip');
  assert.equal(s.seats.p2.route, 'kjeragShip');
  assert.equal(s.seats.p1.levelTargets[7], Math.min(6, base.levelTargets[7] + 1));
  assert.ok(!s.seats.p3);
  assert.ok(!['yanShip', 'kjeragShip'].includes(s.seats.p0.route));
  assert.equal(observedLine([{ bondId: 'yanShip', count: 1, layers: 0 }], new Set(['yanShip'])), null);   // one member, no layers: not a line yet
});

test('teamSpec: a bond disabled this match is nobody\'s line (members on the board, or a known draft line)', () => {
  const ps = (playerId, level, bonds) => ({ playerId, alive: true, shop: { level }, bonds });
  const m = { round: 6, bossId: 'B', disabledBonds: ['sargonShip'], staticInactiveBonds: ['egirShip'], gd: { bondIds: Object.keys(base.recipes), maxShopLevel: 6 },
    order: [ps('p0', 3, { sargonShip: { count: 3, layers: 0 } }), ps('p1', 3, { sargonShip: { count: 4, layers: 0 }, kjeragShip: { count: 2, layers: 0 } }),
      ps('p2', 3, { egirShip: { count: 3, layers: 0 } }), ps('p3', 3, {})] };
  const s = teamSpec(base, m, 'p0', null, { lines: { p3: 'sargonShip' } });
  const off = ['sargonShip', 'egirShip'];
  for (const pid of ['p0', 'p1', 'p2', 'p3']) assert.ok(!off.includes(s.seats[pid]?.route), `${pid} routed to a disabled bond: ${s.seats[pid]?.route}`);
  assert.equal(s.seats.p1.route, 'kjeragShip');                     // its open line, not the bigger disabled one
  assert.ok(!s.seats.p2 && !s.seats.p3);                            // no open line seen: left to the guide's assignment
  assert.equal(s.seats.p0.route, 'yanShip');                        // the advised seat picks among open lines (coreOrder, minus kjeragShip taken)
});

test('learnTempo: a significant lower level later also caps the rounds before it', () => {
  const S = [];
  for (let i = 0; i < 60; i++) { S.push({ round: 3, level: 3, w: 0 }, { round: 3, level: 2, w: 0 }); S.push({ round: 4, level: 2, w: 1 + (i % 3) * 0.1 }, { round: 4, level: 3, w: -1 - (i % 3) * 0.1 }); }
  const { learned } = learnTempo(S, [1, 1, 1, 3, 3, 3]);
  assert.deepEqual(learned.slice(1, 5), [1, 1, 2, 2]);
});

// overlay.mjs reads the client store through the SNAPSHOT expression (evaluated in the game page). Feed it a store built
// from the engine's own messages (main.js: store.match.{public, private, field, result} = the message minus `t`), so
// the teammate fields the overlay records — scouted board, boss partner, m.result, stats — are checked on real views.
test('overlay SNAPSHOT on the engine\'s own views: scout board, stats, m.result → resultOf', async () => {
  const { makeMatch, runToEnd } = await import('../eval/engine.mjs');
  const { installGuide } = await import('../guides/policy.mjs');
  const src = readFileSync(new URL('../overlay.mjs', import.meta.url), 'utf8');
  const SNAPSHOT = /const SNAPSHOT = `([\s\S]*?\}\)\(\))`;/.exec(src)[1];
  const msg = ({ t, ...rest }) => rest;   // main.js payload()
  const snapOf = (root) => { globalThis.__SP__ = { store: { get: () => root } }; try { return (0, eval)(SNAPSHOT); } finally { delete globalThis.__SP__; } };
  const m = makeMatch(3035, 4);
  installGuide(m, base);
  m.start();
  m.sched.runUntil(() => m.round === 6 && m.phase === 'PREP', { maxSteps: 5e6 });
  const me = m.players.get('p0'), mate = m.players.get('p1');
  const snap = snapOf({ me: { playerId: 'p0' }, match: { public: msg(m.publicView()), private: msg(me.privateView()), field: msg(m.prepFieldMeta(mate)) } });
  assert.equal(snap.ok, true);
  assert.equal(snap.brief.players.length, 4);
  assert.equal(snap.scout.playerId, 'p1');
  assert.equal(snap.scout.units.filter((u) => u.area === 'board').length, [...mate.board.values()].filter((p) => p.kind === 'chess').length);
  assert.ok(snap.priv.stats && Number.isFinite(snap.priv.stats.gold));
  assert.equal(matesOf(snap.brief.players, 'p0').length, 3);
  const s = runToEnd(m);
  const end = snapOf({ me: { playerId: 'p0' }, match: { public: msg(m.publicView()), private: msg(me.privateView()), result: msg(s) } });
  const res = resultOf(end.result, m.bossPool ? m.bossPool.maxHp : null);
  assert.equal(res.players.length, 4);
  for (const p of res.players) assert.ok(p.stats && Number.isFinite(p.stats.bossDamage) && Number.isFinite(p.stats.lpLost));
  assert.deepEqual(res.players.map((p) => p.seat).sort(), [0, 1, 2, 3]);
  m.dispose();
});
