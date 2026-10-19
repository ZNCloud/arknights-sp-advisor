// node --test sp-advisor/advisor/state.test.mjs — position save/restore must replay the real game exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeMatch, runToEnd, stateRow } from '../eval/engine.mjs';
import { installGuide } from '../guides/policy.mjs';
import { capture, restore, toJSON, fromJSON, clone } from './state.mjs';

const spec = JSON.parse(readFileSync(new URL('../../guides/g06_final.json', import.meta.url), 'utf8'));
const rows = m => { const out = []; runToEnd(m, { onPhase: mm => { if (mm.phase === 'SETTLE') out.push(JSON.stringify([mm.round, stateRow(mm).map(p => [p.lp, p.funds, p.board.map(b => b.id + b.cell).join()])])); } }); return out; };

test('clone keeps non-enumerable array properties (m.factions.schedule)', () => {
  const a = [1, 2]; Object.defineProperty(a, 'schedule', { value: { picks: [3] }, enumerable: false });
  const b = clone(a), c = fromJSON(toJSON({ a }));
  assert.deepEqual(b.schedule, { picks: [3] }); assert.equal(Object.keys(b).includes('schedule'), false);
  assert.deepEqual(c.a.schedule, { picks: [3] });
});
test('exact restore through JSON replays the live game round by round', () => {
  const R = 6, m = makeMatch(1004, 4); installGuide(m, spec); let snap = null;
  const sb = m.scheduleBotPrep; m.scheduleBotPrep = function (ps) { if (this.round === R && !snap) snap = toJSON(capture(this)); return sb.call(this, ps); };
  m.start(); const live = rows(m).filter(r => JSON.parse(r)[0] >= R);
  const f = restore(fromJSON(snap), { rngMode: 'exact' }); installGuide(f, spec);
  for (const p of f.alivePlayers()) f.scheduleBotPrep(p); f.maybeEndPrep();
  assert.deepEqual(rows(f), live);
});
