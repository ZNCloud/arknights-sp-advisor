// node --test advisor/redact.test.mjs — record de-identification: names/ids gone, seats and team numbers unchanged.
// Fixtures are made up (fake names, fake ids); never paste real records here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { redactRow, redactRows } from './redact.mjs';
import { splitMatches, tracksOf, rateMatch } from './team.mjs';

const ME = '测试甲', BOB = 'alice', CAT = '测试丙', DOG = 'bot·丁';
const ID = { [ME]: 'p_0123456789', [BOB]: 'p_abcdef0123', [CAT]: 'p_00000000aa', [DOG]: 'p_ffffff0001' };
const SEAT = { [ME]: 0, [BOB]: 1, [CAT]: 2, [DOG]: 3 };
const mate = (n, round) => ({ name: n, seat: SEAT[n], isBot: n === DOG, alive: true, lp: 40 - round, level: 1 + (round >> 1),
  board: Math.min(9, round + SEAT[n]), status: 'acting', bandId: null, bonds: [`yanShip:${SEAT[n] + 1}/${round * SEAT[n]}`] });
const row = (round, phase, extra = {}) => ({
  at: `2026-01-01T00:00:${String(round).padStart(2, '0')}Z`, phase, round, mode: 'mode_x', funds: 5, lp: 40 - round, level: 2,
  bonds: [`sargonShip:3/${round * 2}`], board: [{ id: 'c1', golden: false, tier: 1, items: [], at: [0, 1], dir: 'R' }], hand: [], shop: [],
  mates: [BOB, CAT, DOG].map((n) => mate(n, round)), self: { seat: 0 }, mateBoards: { 1: [{ id: 'c2', row: 0, col: 0 }] },
  result: null, teamLp: 30, bossHp: null, advice: '抓 c1', pick: null, terminal: null, boss: null, stats: null, ...extra,
});
const result = () => ({ victory: false, roundsPassed: 4, hiddenCleared: false, reason: 'lp', bossId: 'boss_a', bossMax: 1000,
  players: [ME, BOB, CAT, DOG].map((n) => ({ playerId: ID[n], seat: SEAT[n], name: n, isBot: n === DOG, alive: n !== CAT,
    roundsPassed: 4, eliminatedRound: n === CAT ? 3 : null, lp: 10, lineup: [], bonds: ['yanShip:3/9'],
    stats: { bossDamage: 100 * (SEAT[n] + 1), dmgDealt: 5, kills: 1, leaks: 0, lpLost: 30, activatedLayers: 9, merges: 1, gold: 20 } })) });
const game = () => [row(0, 'INFO_CHECK'), ...[1, 2, 3, 4].flatMap((r) => [row(r, 'PREP'), row(r, 'COMBAT')]), row(4, 'RESULT', { result: result() })];
const rows = () => [...game(), ...game()];
const originals = [ME, BOB, CAT, DOG, ...Object.values(ID)];

// the parsers' output with every name / key / playerId dropped: what must not change under redaction
const strip = (v) => (Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' && !(v instanceof Map)
  ? Object.fromEntries(Object.entries(v).filter(([k]) => !['name', 'key', 'playerId', 'mate'].includes(k)).map(([k, x]) => [k, strip(x)])) : v);

test('redactRow: mates and result players → seat labels, the input untouched', () => {
  const r = row(4, 'RESULT', { result: result() });
  const before = JSON.stringify(r);
  const out = redactRow(r);
  assert.equal(JSON.stringify(r), before);
  assert.deepEqual(out.mates.map((m) => [m.name, m.seat]), [['座位1', 1], ['座位2', 2], ['座位3', 3]]);
  assert.deepEqual(out.result.players.map((p) => [p.name, p.playerId, p.seat]),
    [['座位0', 'seat0', 0], ['座位1', 'seat1', 1], ['座位2', 'seat2', 2], ['座位3', 'seat3', 3]]);
  const text = JSON.stringify(out);
  for (const o of originals) assert.ok(!text.includes(o));
  assert.deepEqual(out.mateBoards, r.mateBoards);
  assert.deepEqual(redactRow(row(2, 'PREP')).result, null);   // a row without result
});

test('fail loud: a name/id with no seat and no table entry throws; a table entry places it', () => {
  const r = row(2, 'PREP');
  delete r.mates[0].seat;
  assert.throws(() => redactRow(r), /no seat/);
  assert.equal(redactRow(r, new Map([[BOB, 1]])).mates[0].name, '座位1');
  assert.throws(() => redactRow(row(2, 'PREP', { scoutId: ID[BOB] })), /account id/);   // an id in a field nobody knows
  assert.equal(redactRow(row(2, 'PREP', { scoutId: ID[BOB] }), new Map([[ID[BOB], 1]])).scoutId, 'seat1');
  // an error never carries the value
  try { redactRow(r); } catch (e) { assert.ok(!originals.some((o) => e.message.includes(o))); }
  // a name repeated inside free text cannot be redacted by field: it must throw rather than pass through
  assert.throws(() => redactRow(row(2, 'PREP', { advice: `跟 ${BOB} 抢牌` })), /survives/);
});

test('redactRows: per-match seat table, whole-file check, counts', () => {
  const rs = rows();
  rs[3].mates[1] = { ...rs[3].mates[1] };
  delete rs[3].mates[1].seat;                         // placed by the other rows of its match
  const { rows: out, names, ids } = redactRows(rs);
  assert.equal(out.length, rs.length);
  assert.equal(out[3].mates[1].name, '座位2');
  assert.equal(names, rs.reduce((n, r) => n + r.mates.length + (r.result ? r.result.players.length : 0), 0));
  assert.equal(ids, 8);
  const text = JSON.stringify(out);
  for (const o of originals) assert.ok(!text.includes(o));
  // a name only ever seen without a seat cannot be placed
  const lone = rows();
  lone.forEach((r) => { r.mates = r.mates.map((m) => (m.name === CAT ? { ...m, seat: undefined } : m)); if (r.result) r.result.players = r.result.players.filter((p) => p.name !== CAT); });
  assert.throws(() => redactRows(lone), /no seat/);
});

test('team.mjs on redacted == original apart from names (splitMatches, tracksOf, rateMatch)', () => {
  const rs = rows(), red = redactRows(rs).rows;
  const a = splitMatches(rs), b = splitMatches(red);
  assert.equal(a.length, 2);
  assert.equal(b.length, a.length);
  for (let i = 0; i < a.length; i++) {
    assert.equal(b[i].rows.length, a[i].rows.length);
    const ta = tracksOf(a[i].rows), tb = tracksOf(b[i].rows);
    assert.deepEqual(strip(tb), strip(ta));
    assert.deepEqual(tb.seats.map((s) => s.result && s.result.seat), ta.seats.map((s) => s.result && s.result.seat));
    assert.deepEqual(tb.seats.filter((s) => !s.self).map((s) => s.name), ['座位1', '座位2', '座位3']);
    assert.deepEqual(strip(rateMatch(tb, null)), strip(rateMatch(ta, null)));
  }
});
