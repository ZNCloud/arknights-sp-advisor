// node --test sp-advisor/advisor/lineup.test.mjs — every lineup candidate is one engine move: replayed through
// PlayerState.move it either produces exactly the board the check scored or is refused (never a different board).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeMatch, runToEnd } from '../eval/engine.mjs';
import { installGuide } from '../guides/policy.mjs';
import { capture, restore } from './state.mjs';
import { layoutOf, legalTiles } from './field.mjs';
import { neighbours, replaySteps } from './lineup.mjs';

const spec = JSON.parse(readFileSync(new URL('../../guides/g06_final.json', import.meta.url), 'utf8'));

// p0's boards at the start of some preps of a guide game (seed 2025 is the self-play game where a scored move was once
// refused by the engine: a summon stood on the target tile)
function boards(seed, rounds) {
  const m = makeMatch(seed, 4); installGuide(m, spec); const out = [];
  const sb = m.scheduleBotPrep;
  m.scheduleBotPrep = function (ps) { if (ps.playerId === 'p0' && rounds.includes(this.round) && !out.some(s => s.match.round === this.round)) out.push(capture(this)); return sb.call(this, ps); };
  m.start(); runToEnd(m); m.dispose();
  return out;
}
const key = L => L.map(x => `${x.uid}@${x.row},${x.col}:${x.dir}`).sort().join('|');

test('lineup candidates replay through the engine to the board that was scored, or are refused', () => {
  let accepted = 0, refused = 0;
  for (const st of boards(2025, [6, 9, 12])) {
    const m = restore(st, { rngMode: 'exact' }), ps = m.players.get('p0');
    if (!ps.alive) { m.dispose(); continue; }
    const pieces = new Map(); for (const p of [...ps.board.values(), ...ps.hand]) if (p?.kind === 'chess') pieces.set(p.uid, p);
    const ctx = { pieces, cap: ps.deployCap, legal: new Map([...pieces].map(([u, p]) => [u, new Set(legalTiles(ps, p).map(t => t.join(',')))])), name: String };
    const cands = neighbours(ctx, layoutOf(ps));
    m.dispose();
    for (const n of cands) {
      const mm = restore(st, { rngMode: 'exact' }), pp = mm.players.get('p0');
      const r = replaySteps(pp, [{ what: n.what, op: n.op }]);
      if (r.ok) { accepted++; assert.equal(key(layoutOf(pp)), key(n.L), `${n.what} (round ${st.match.round})`); } else refused++;
      mm.dispose();
    }
  }
  assert.ok(accepted > 100, `too few candidates exercised (${accepted})`);
});
