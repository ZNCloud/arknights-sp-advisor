// Diagnostic combo injection (moved from spcurve2/3 curve.mjs so it has one home in the repo). Free, fixed rosters
// placed through the engine's public methods (newPiece/move/equip). Results from injected games are NEVER natural
// win rates; they are used as labelled positive examples for the value model and as ceiling references.
import { arrange } from './engine.mjs';

export const COMBOS = {};
COMBOS.la_full = [
  { id: 'chess_char_5_01_a', want: [12, 5], dir: 'RIGHT' }, { id: 'chess_char_5_09_a', want: [11, 5], dir: 'DOWN' },
  { id: 'chess_char_4_02_a', want: [11, 4] }, { id: 'chess_char_3_01_a', want: [11, 3] }, { id: 'chess_char_2_01_a', want: [10, 4] },
  { id: 'chess_char_6_01_a', want: [12, 4] }, { id: 'chess_char_6_09_a', want: [12, 3] }, { id: 'chess_char_5_04_a', want: [10, 3], dir: 'DOWN' }];
COMBOS.la_items = COMBOS.la_full.map(x => x.id === 'chess_char_5_01_a' ? { ...x, items: ['chess_item_5_02_e_b', 'chess_item_4_03_e_b'] } : { ...x });
COMBOS.la_mix = [
  { id: 'chess_char_5_01_a', want: [12, 5], dir: 'RIGHT', items: ['chess_item_5_02_e_b', 'chess_item_4_03_e_b'] }, { id: 'chess_char_5_09_a', want: [11, 5], dir: 'DOWN' },
  { id: 'chess_char_4_02_a', want: [11, 4] }, { id: 'chess_char_3_01_a', want: [11, 3], items: ['chess_item_4_03_e_b'] }, { id: 'chess_char_2_01_a', want: [10, 4] },
  { id: 'chess_char_6_01_a', want: [12, 4] }, { id: 'chess_char_6_07_a', want: [10, 3] }, { id: 'chess_char_5_04_a', want: [10, 5], dir: 'DOWN' }];
COMBOS.kj_items = [
  { id: 'chess_char_3_14_a', want: [11, 4] }, { id: 'chess_char_6_02_a', want: [12, 4], items: ['chess_item_5_02_e_b', 'chess_item_6_06_e_b'] },
  { id: 'chess_char_4_13_a', want: [11, 3], items: ['chess_item_5_02_e_b'] }, { id: 'chess_char_5_14_a', want: [12, 3], items: ['chess_item_5_02_e_b'] },
  { id: 'chess_char_6_19_a', want: [11, 5] }, { id: 'chess_char_4_03_a', want: [12, 5] }];

const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
// Replace the seat's roster with `roster` (layers persist). `pad` restores the diagnostic floor (funds 60 / LP 40).
export function placeCombo(m, ps, roster, { pad = true } = {}) {
  const gd = m.gd;
  ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.effects = [];
  ps.shop.level = Math.max(ps.shop.level, 9);
  const legal = [];
  for (let r = 9; r <= 12; r++) for (let c = 2; c <= 10; c++) legal.push([r, c]);
  const pieces = [];
  for (const spec of roster) {
    const piece = ps.newPiece('chess', gd.goldenIdOf(spec.id) || spec.id);
    ps.hand[ps.hand.findIndex(x => !x)] = piece; ps.recompute(); pieces.push([spec, piece]);
  }
  // Terrain may evict a placed piece on recompute: re-place until stable.
  for (let pass = 0; pass < 6; pass++) {
    let any = false;
    for (const [spec, piece] of pieces) {
      const loc = ps.find(piece.uid);
      if (!loc || loc.area === 'board') continue;
      const ranked = legal.filter(([r, c]) => !ps.board.has(`${r},${c}`) && ps._legal(piece, r, c)).sort((a, b) => dist(a, spec.want) - dist(b, spec.want));
      if (ranked.length && ps.move(piece.uid, { area: 'board', row: ranked[0][0], col: ranked[0][1] }, spec.dir || 'RIGHT')?.ok) any = true;
    }
    if (!any) break;
  }
  for (const [spec, piece] of pieces) for (const iid of spec.items || []) {
    if ((piece.items || []).length >= 2) break;
    const it = ps.newPiece('item', iid);
    if (!ps.hand.some((x, i) => !x && (ps.hand[i] = it, true))) ps.temp.push(it);
    const r = ps.equip(it.uid, piece.uid);
    if (!r?.ok) throw Error(`equip failed ${iid} -> ${spec.id}: ${JSON.stringify(r)}`);
  }
  if (pad) { ps.funds = 60; ps.lp = 40; }
  ps.recompute(); arrange(m, ps, { final: true }); ps.recompute();
}
