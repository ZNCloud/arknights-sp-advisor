// Battle-level hindsight on the owner's own field (no teammates, no 联防 rescue): a board variant is applied directly
// to a restored PREP position (the recorded battle board, positions/<game>-rXX-end.json) and fought.
//   normal round: counted leaks of the owner's own field → LP charge min(10, leaks); under the replay's aligned enemy
//     pick (B, 已知未来) and averaged over the engine's prior of the round's picks (A, 信息公平)
//   boss rounds: ownerBossFight share of one player's pool within the countdown, averaged over fight seeds
import { createRng } from '../eval/engine.mjs';
import { restore } from '../advisor/state.mjs';
import { pickPrior } from './replay.mjs';
import { ownerBossFight } from './battle.mjs';
const W = await import(new URL('../../engine/server/match/waves.js', import.meta.url));

const freeHand = ps => ps.hand.findIndex(x => !x);

// layout = [{ uid, row, col, dir }] deployed pieces; every other chess goes to the hand. Direct placement (legality and
// the deploy cap are checked here, not by g.move: a variant is a target board, not a sequence of moves).
export function layoutOf(ps) {
  return [...ps.board].filter(([, p]) => p.kind === 'chess').map(([k, p]) => { const [row, col] = k.split(',').map(Number); return { uid: p.uid, row, col, dir: p.dir || 'RIGHT' }; });
}
// items = { carrierUid: [itemUid, …] } over the board's equipped items (boss-round search): the same item objects,
// redistributed (≤ 2 per carrier); null keeps every item where it is.
export function itemsOf(ps) {
  const o = {};
  for (const p of [...ps.board.values(), ...ps.hand]) if (p?.kind === 'chess' && (p.items || []).length) o[p.uid] = p.items.map(i => i.uid);
  return o;
}
export function applyItems(ps, items) {
  if (!items) return true;
  const chess = [...ps.board.values(), ...ps.hand].filter(p => p?.kind === 'chess');
  const pool = new Map();
  for (const p of chess) for (const it of p.items || []) pool.set(it.uid, it);
  for (const p of chess) p.items = [];
  for (const [cu, list] of Object.entries(items)) {
    const c = chess.find(p => String(p.uid) === String(cu));
    if (!c || list.length > 2) return false;
    for (const iu of list) { const it = pool.get(iu); if (!it) return false; c.items.push(it); pool.delete(iu); }
  }
  if (pool.size) return false;
  ps.recompute();
  return true;
}
export function applyLayout(ps, layout) {
  const all = new Map();
  for (const [k, p] of [...ps.board]) if (p.kind === 'chess') { all.set(p.uid, p); ps.board.delete(k); }
  for (const [k, p] of [...ps.board]) if (p.kind === 'token') ps.board.delete(k);
  ps.hand.forEach((p, i) => { if (p?.kind === 'chess') { all.set(p.uid, p); ps.hand[i] = null; } });
  if (layout.length > ps.deployCap) return false;
  for (const x of layout) {
    const p = all.get(x.uid);
    if (!p || ps.board.has(`${x.row},${x.col}`)) return false;
    ps._deployMap = null; ps._deployField = undefined;
    if (!ps._legal(p, x.row, x.col)) return false;
    p.dir = x.dir; ps.board.set(`${x.row},${x.col}`, p); all.delete(x.uid);
  }
  for (const p of all.values()) { const i = freeHand(ps); if (i < 0) return false; ps.hand[i] = p; }
  for (const p of [...ps.board.values()]) if (p.kind === 'chess') ps.grantTokensFor?.(p);
  ps.recompute();
  return true;
}
export function legalTiles(ps, piece) {
  const out = [];
  for (let r = 9; r <= 12; r++) for (let c = 2; c <= 10; c++) { ps._deployMap = null; ps._deployField = undefined; if (ps._legal(piece, r, c)) out.push([r, c]); }
  return out;
}

export function waveOf(m, pick) {
  if (!pick) return m.wave;
  const f = []; Object.defineProperty(f, 'schedule', { value: { picks: Object.assign([], { [m.round]: pick }) }, enumerable: false });
  return W.buildNormalWave(m.gd, createRng(1), f, m.round);
}

function ownFight(st, mutate, pick) {
  const m = restore(st, { rngMode: 'exact' });
  try {
    const ps = m.players.get('p0');
    if (mutate && mutate(m, ps) === false) return null;
    m.wave = waveOf(m, pick);
    const b = m.newBattle(m._normalOpts(ps));
    while (!b.finished) b.step();
    const r = b.result().perPlayer?.p0 || {};
    const counted = (r.leaked || []).filter(l => l && l.counted !== false).length;
    return { loss: Math.min(m.gd.lpCapPerRound ?? 10, counted), leaks: counted, killed: r.killed, total: r.total };
  } finally { m.dispose(); }
}

// { B: loss under the aligned pick, A: prior-weighted mean loss over the top-K picks, pA0: prior mass with 0 loss }
export function normalScore(st, mutate, { alignedPick, prior }) {
  const b = ownFight(st, mutate, alignedPick);
  if (!b) return null;
  let wsum = 0, lsum = 0, zero = 0;
  for (const c of prior) { const o = ownFight(st, mutate, c.pick); if (!o) return null; wsum += c.w; lsum += c.w * o.loss; if (o.loss === 0) zero += c.w; }
  return { B: b.loss, A: +(lsum / wsum).toFixed(3), pA0: +(zero / wsum).toFixed(3) };
}

export function bossScore(st, mutate, { bosses, round, hidden, seeds = 4 }) {
  const per = {};
  let wsum = 0, acc = 0, accOt = 0, pClear = 0;
  for (const { id, w } of bosses) {
    const fs = [];
    for (let k = 0; k < seeds; k++) {
      const m = restore(st, { rngMode: 'exact' });
      try { const ps = m.players.get('p0'); if (mutate && mutate(m, ps) === false) return null; fs.push(ownerBossFight(m, ps, { bossId: id, hidden, round, seed: 100 + k })); } finally { m.dispose(); }
    }
    const cd = fs.reduce((a, f) => a + f.shareAtCountdown, 0) / fs.length, ot = fs.reduce((a, f) => a + f.shareAtOvertime, 0) / fs.length;
    const pc = fs.filter(f => f.shareAtCountdown >= 1).length / fs.length;
    per[id] = { cd: +cd.toFixed(3), ot: +ot.toFixed(3), pClear: +pc.toFixed(2) };
    wsum += w; acc += w * cd; accOt += w * ot; pClear += w * pc;
  }
  return { share: +(acc / wsum).toFixed(3), shareOt: +(accOt / wsum).toFixed(3), pClear: +(pClear / wsum).toFixed(3), per };
}

export function priorFor(st, k = 10, n = 400) {
  const m = restore(st, { rngMode: 'exact' });
  try { return pickPrior(m.gd, m.round, n).slice(0, k); } finally { m.dispose(); }
}
