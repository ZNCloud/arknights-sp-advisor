// Force one seat of a live engine Match onto a recorded snapshot (overlay recordTurn row): board (tile, facing, elite,
// equipment), hand, shop, funds, LP, 调度中心 level, bond layers — with the shared pool's copy accounting kept exact
// (every removed chess returns its copies, every placed one takes them). Recorded bond COUNTS are the client's truth:
// where the engine counts differently (变形同构体 grants, an operator the engine data lacks) the difference goes into
// the engine's own per-bond count bonus and is reported, never hidden.
import { bondsOf } from './record.mjs';

// Operators the client had and this engine checkout lacks → the engine stand-in used in their place (reported).
export const STAND_INS = { chess_char_4_27_a: 'chess_char_4_12_a', chess_char_4_27_b: 'chess_char_4_12_b' };
export const engineId = id => STAND_INS[id] || id;

const HAND = 10;

export function allPieces(ps) {
  const out = [];
  for (const [key, p] of ps.board) out.push({ area: 'board', key, piece: p });
  ps.hand.forEach((p, i) => p && out.push({ area: 'hand', idx: i, piece: p }));
  ps.temp.forEach((p, i) => p && out.push({ area: 'temp', idx: i, piece: p }));
  return out;
}

export function clearSeat(ps) {
  for (const { piece } of allPieces(ps)) {
    if (piece.kind === 'chess') ps.returnCopies(piece);
    piece.items = piece.kind === 'chess' ? [] : piece.items;
  }
  ps.board.clear();
  ps.hand.fill(null);
  ps.temp.fill(null);
  ps._tempDue?.clear?.();
}

export function newChess(ps, id) {
  const gd = ps.gd, eid = engineId(id);
  if (!gd.chess(eid)) throw Error(`force: chess ${id} not in engine data and no stand-in`);
  const base = gd.baseIdOf(eid), need = gd.isGolden(eid) ? gd.goldenCopies : 1;
  const taken = ps.poolOf(base).take(base, need, { overdraw: true });
  return ps.newPiece('chess', eid, { poolCopies: taken, recId: id });
}
export function newItem(ps, id) {
  if (!ps.gd.item(id)) throw Error(`force: item ${id} not in engine data`);
  return ps.newPiece('item', id);
}

// Place a recorded board + hand. Returns notes for anything the engine refuses (illegal tile, cap).
export function setPieces(ps, row) {
  const notes = [];
  clearSeat(ps);
  for (const b of row.board || []) {
    const p = newChess(ps, b.id);
    p.dir = b.dir || 'RIGHT';
    p.items = (b.items || []).map(it => newItem(ps, it.id));
    if (!b.at) { notes.push(`board ${b.id} has no tile in the record → hand`); stowHand(ps, p, notes); continue; }
    const [r, c] = b.at;
    ps._deployMap = null; ps._deployField = undefined;
    if (!ps._legal(p, r, c)) notes.push(`tile ${r},${c} illegal for ${b.id} on this engine field (placed anyway)`);
    ps.board.set(`${r},${c}`, p);
  }
  for (const id of row.hand || []) {
    const p = id.startsWith('chess_item') ? newItem(ps, id) : newChess(ps, id);
    stowHand(ps, p, notes);
  }
  return notes;
}
function stowHand(ps, p, notes) {
  const i = ps.hand.findIndex(x => !x);
  if (i >= 0) { ps.hand[i] = p; return; }
  const t = ps.temp.findIndex(x => !x);
  if (t >= 0) { ps.temp[t] = p; notes.push(`hand full: ${p.id} → temp`); return; }
  notes.push(`hand and temp full: ${p.id} dropped`);
  if (p.kind === 'chess') ps.returnCopies(p);
}

// Shop: recorded unsold slots (in order; the record dropped sold slots before slot numbers were logged).
export function setShop(ps, row) {
  const notes = [];
  const slots = [];
  for (const s of row.shop || []) {
    const kind = s.id.startsWith('chess_item') ? 'item' : 'chess';
    const id = kind === 'chess' ? engineId(s.id) : s.id;
    const basePrice = kind === 'chess' ? ps.gd.chessPrice(id) : ps.gd.itemPrice(id);
    if (basePrice !== s.price) notes.push(`shop ${s.id}: recorded price ${s.price}, engine base ${basePrice}`);
    slots.push({ kind, id, basePrice, frozen: !!s.frozen, sold: false, recPrice: s.price });
  }
  const chess = slots.filter(s => s.kind === 'chess'), items = slots.filter(s => s.kind === 'item');
  ps.shop.slots = [...chess, ...items];
  ps.shop.layout = { chess: chess.length, item: items.length };
  ps.shop.frozen = slots.some(s => s.frozen);
  return notes;
}

export function setLayers(ps, row) {
  const rec = bondsOf(row);
  for (const k of Object.keys(ps.layers)) if (!(k in rec)) ps.layers[k] = 0;
  for (const [id, b] of Object.entries(rec)) if (ps.gd.bond(id)) ps.layers[id] = b.layers;
}

// Align engine bond counts to the recorded ones through bondCountBonus; returns the per-bond corrections.
export function alignBondCounts(ps, row) {
  ps.bondCountBonus = {};
  ps.recompute();
  const rec = bondsOf(row), fix = {};
  for (const id of new Set([...Object.keys(rec), ...Object.keys(ps.bonds)])) {
    if (!ps.gd.bond(id)) continue;
    const want = rec[id]?.count ?? 0, have = ps.bonds[id]?.count ?? 0;
    if (want !== have) fix[id] = want - have;
  }
  if (Object.keys(fix).length) { ps.bondCountBonus = { ...fix }; ps.recompute(); }
  return fix;
}

export function forceSeat(m, ps, row, { shop = true, funds = true, lp = true } = {}) {
  const notes = [];
  if (lp) ps.lp = row.lp;
  if (funds) ps.funds = row.funds;
  if (ps.shop.level !== row.level) { ps.shop.level = row.level; }
  notes.push(...setPieces(ps, row));
  if (shop) notes.push(...setShop(ps, row));
  setLayers(ps, row);
  const fix = alignBondCounts(ps, row);
  ps.offers = [];
  ps.dirty?.();
  return { notes, bondFix: fix };
}

// Compare the engine seat with a recorded row. Returns a list of human-readable differences (empty = identical).
export function diffSeat(ps, row, { shop = false } = {}) {
  const d = [];
  const key = b => `${engineId(b.id)}@${b.at ? b.at.join(',') : '-'}:${b.dir || 'RIGHT'}[${(b.items || []).map(i => i.id).sort().join('+')}]`;
  const eng = [...ps.board].filter(([, p]) => p.kind === 'chess').map(([k, p]) => `${p.id}@${k}:${p.dir || 'RIGHT'}[${(p.items || []).map(i => i.id).sort().join('+')}]`).sort();
  const rec = (row.board || []).map(key).sort();
  const onlyE = eng.filter(x => !rec.includes(x)), onlyR = rec.filter(x => !eng.includes(x));
  if (onlyE.length || onlyR.length) d.push(`board: engine-only ${JSON.stringify(onlyE)} record-only ${JSON.stringify(onlyR)}`);
  const ms = a => { const o = {}; for (const x of a) o[x] = (o[x] || 0) + 1; return o; };
  const eh = ms([...ps.hand, ...ps.temp].filter(Boolean).filter(p => p.kind !== 'token').map(p => p.id)), rh = ms((row.hand || []).map(engineId));
  const hd = [];
  for (const k of new Set([...Object.keys(eh), ...Object.keys(rh)])) if ((eh[k] || 0) !== (rh[k] || 0)) hd.push(`${k} engine ${eh[k] || 0} record ${rh[k] || 0}`);
  if (hd.length) d.push(`hand: ${hd.join('; ')}`);
  if (ps.shop.level !== row.level) d.push(`level: engine ${ps.shop.level} record ${row.level}`);
  if (ps.lp !== row.lp) d.push(`lp: engine ${ps.lp} record ${row.lp}`);
  const rb = bondsOf(row);
  for (const id of new Set([...Object.keys(rb), ...Object.keys(ps.bonds)])) {
    const e = ps.bonds[id]?.count ?? 0, r = rb[id]?.count ?? 0;
    if (e !== r && ps.gd.bond(id)) d.push(`bond ${id} count engine ${e} record ${r}`);
  }
  return d;
}
