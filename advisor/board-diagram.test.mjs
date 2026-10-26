// node --test advisor/board-diagram.test.mjs — board-diagram.mjs diffs checkLineup's current/best layouts into the
// additional window's units: stay-put, move, and newly-added-from-hand, each with a resolved display name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boardDiagramOf } from './board-diagram.mjs';

const nameOf = (id) => ({ c_tachanka: '坦克手', c_texas: '德克萨斯', c_recruit: '新兵' }[id] || id);

test('null when the lineup check has no board yet (waiting / running / no frag at all)', () => {
  assert.equal(boardDiagramOf(null, nameOf), null);
  assert.equal(boardDiagramOf({ state: 'running' }, nameOf), null);
  assert.equal(boardDiagramOf({ state: 'done' }, nameOf), null);   // no .board at all
});

test('nobody moves: every unit keeps its current tile, `to` is null', () => {
  const frag = { board: {
    current: [{ uid: 1, row: 2, col: 3, dir: 'RIGHT' }, { uid: 2, row: 4, col: 1, dir: 'UP' }],
    best: [{ uid: 1, row: 2, col: 3, dir: 'RIGHT' }, { uid: 2, row: 4, col: 1, dir: 'UP' }],
    names: { 1: 'c_tachanka', 2: 'c_texas' },
  } };
  const d = boardDiagramOf(frag, nameOf);
  assert.deepEqual(d.units, [
    { uid: 1, name: '坦克手', row: 2, col: 3, dir: 'RIGHT', to: null },
    { uid: 2, name: '德克萨斯', row: 4, col: 1, dir: 'UP', to: null },
  ]);
});

test('one unit should move: its `to` names the recommended tile, the other stays null', () => {
  const frag = { board: {
    current: [{ uid: 1, row: 2, col: 3, dir: 'RIGHT' }, { uid: 2, row: 4, col: 1, dir: 'UP' }],
    best: [{ uid: 1, row: 5, col: 0, dir: 'LEFT' }, { uid: 2, row: 4, col: 1, dir: 'UP' }],
    names: { 1: 'c_tachanka', 2: 'c_texas' },
  } };
  const d = boardDiagramOf(frag, nameOf);
  assert.deepEqual(d.units.find((u) => u.uid === 1).to, { row: 5, col: 0, dir: 'LEFT' });
  assert.equal(d.units.find((u) => u.uid === 2).to, null);
});

test('a hand piece the check adds to the board: no current tile, only a `to`, flagged `added`', () => {
  const frag = { board: {
    current: [{ uid: 1, row: 2, col: 3, dir: 'RIGHT' }],
    best: [{ uid: 1, row: 2, col: 3, dir: 'RIGHT' }, { uid: 3, row: 0, col: 0, dir: 'DOWN' }],
    names: { 1: 'c_tachanka', 3: 'c_recruit' },
  } };
  const d = boardDiagramOf(frag, nameOf);
  assert.equal(d.units.length, 2);
  const added = d.units.find((u) => u.uid === 3);
  assert.deepEqual(added, { uid: 3, name: '新兵', row: null, col: null, dir: null, to: { row: 0, col: 0, dir: 'DOWN' }, added: true });
});

test('a rotate-only recommendation (same tile, new facing) still counts as a move', () => {
  const frag = { board: {
    current: [{ uid: 1, row: 2, col: 3, dir: 'RIGHT' }],
    best: [{ uid: 1, row: 2, col: 3, dir: 'LEFT' }],
    names: { 1: 'c_tachanka' },
  } };
  const d = boardDiagramOf(frag, nameOf);
  assert.deepEqual(d.units[0].to, { row: 2, col: 3, dir: 'LEFT' });
});

test('no id for a uid (names table missing it): falls back to the uid itself, never throws', () => {
  const frag = { board: { current: [{ uid: 9, row: 0, col: 0, dir: 'UP' }], best: [{ uid: 9, row: 0, col: 0, dir: 'UP' }], names: {} } };
  const d = boardDiagramOf(frag, nameOf);
  assert.equal(d.units[0].name, '9');
});
