// node --test advisor/board.test.mjs — the engine board search (advisor/lineup.mjs boardSearch, sprluse_1910): its steps
// (equips included) replay through the engine, the replayed board scores what the search reported, a held item is tried on
// carriers, and the search code names no bond, operator or item.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeMatch, runToEnd } from '../eval/engine.mjs';
import { installGuide } from '../guides/policy.mjs';
import { capture, restore } from './state.mjs';
import { searchBoardSync, replaySteps, scoreSteps, layerValueOf } from './lineup.mjs';

const spec = JSON.parse(readFileSync(new URL('../../guides/g06_final.json', import.meta.url), 'utf8'));
const slopes = { egirShip: 0.05, indomShip: 0.02, skillfulShip: 0.05, raidShip: 0.09, steadShip: 0.04, preciShip: 0.03 };
function boards(seed, rounds, withItem = null) {
  const m = makeMatch(seed, 4); installGuide(m, spec); const out = [];
  const sb = m.scheduleBotPrep;
  m.scheduleBotPrep = function (ps) {
    if (ps.playerId === 'p0' && rounds.includes(this.round) && !out.some(s => s.match.round === this.round)) {
      if (withItem) { const i = ps.hand.findIndex(x => !x); if (i >= 0) ps.hand[i] = ps.newPiece('item', withItem); }
      out.push(capture(this));
    }
    return sb.call(this, ps);
  };
  m.start(); runToEnd(m); m.dispose();
  return out;
}

test('board search steps replay through the engine and score what the search reported', () => {
  let checked = 0;
  for (const st of boards(2025, [5, 8], 'chess_item_1_05_e_a')) {
    if (!st.seats.find(s => s.playerId === 'p0').alive) continue;
    const res = searchBoardSync(st, { slopes });
    if (res.skipped) continue;
    const m = restore(st, { rngMode: 'exact' });
    assert.ok(replaySteps(m.players.get('p0'), res.steps).ok, `R${res.round}: ${res.steps.map(s => s.what).join(' / ')}`);
    m.dispose();
    assert.ok(res.decisions.some(d => d.item === 'chess_item_1_05_e_a' && d.options.length > 0), 'the held item was tried on carriers');
    const again = scoreSteps(st, res.steps, { kind: 'normal', round: res.round, playerId: 'p0', tag: 'board', seeds: 2, layerValue: layerValueOf(slopes, res.round), effRef: res.start.eff });
    if (res.steps.length && res.best.samples.length === 2) assert.deepEqual(again.samples.map(x => +x.toFixed(9)), res.best.samples.map(x => +x.toFixed(9)));
    checked++;
  }
  assert.ok(checked >= 1);
});

test('the board search code names no bond, operator or item', () => {
  const src = readFileSync(new URL('./lineup.mjs', import.meta.url), 'utf8');
  const part = src.slice(src.indexOf('// ── Board search (sprluse_1910)'));
  assert.ok(part.length > 1000);
  assert.doesNotMatch(part, /chess_(char|item)_|['"`][a-z]+Ship['"`]|阿戈尔|不屈|灵巧|砾|溶剂/);
});
