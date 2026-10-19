// Layout / lineup hill-climb and equipment re-targeting on recorded battle boards (see fieldeval.mjs for the scores).
import { readFileSync } from 'node:fs';
import { createRng, arrange } from '../eval/engine.mjs';
import { restore, fromJSON } from '../advisor/state.mjs';
import { layoutOf, applyLayout, applyItems, itemsOf, legalTiles, normalScore, bossScore, priorFor } from './fieldeval.mjs';

const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
const posOf = (posDir, game, round) => fromJSON(readFileSync(`${posDir}/${game}-r${String(round).padStart(2, '0')}-end.json`, 'utf8'));
const alignedPickOf = (rep, round) => rep.rounds.find(x => x.round === round)?.wave?.chosen?.pick || null;
const HIDDEN = { boss_8: 50, boss_9: 40, boss_10: 40 };

export function scorer(st, rep, round, { K = 10, seeds = 6 } = {}) {
  const m = restore(st, { rngMode: 'exact' }); const gd = m.gd, bossId = m.bossId; m.dispose();
  if (round === gd.bossRound) return { kind: 'boss', f: (mut) => bossScore(st, mut, { bosses: [{ id: bossId, w: 1 }], round, hidden: false, seeds }) };
  if (round === gd.hiddenRound) return { kind: 'boss', f: (mut) => bossScore(st, mut, { bosses: Object.entries(HIDDEN).map(([id, w]) => ({ id, w })), round, hidden: true, seeds: Math.max(2, seeds >> 1) }) };
  const prior = priorFor(st, K), alignedPick = alignedPickOf(rep, round);
  return { kind: 'normal', f: (mut) => normalScore(st, mut, { alignedPick, prior }) };
}
// lower is better: [primary, secondary]
export function keyOf(kind, objective, s) {
  if (!s) return [Infinity, Infinity];
  if (kind === 'boss') return [-s.share, -s.shareOt];
  return objective === 'B' ? [s.B, s.A] : [s.A, s.B];
}
const less = (a, b) => a[0] < b[0] - 1e-9 || (Math.abs(a[0] - b[0]) <= 1e-9 && a[1] < b[1] - 1e-9);

export function layoutSearch({ posDir, game, round, rep, objective = 'A', budget = 200, sample = 40, seed = 1, K = 10, items: moveItems = null }) {
  const st = posOf(posDir, game, round);
  const sc = scorer(st, rep, round, { K });
  const m = restore(st, { rngMode: 'exact' }), ps = m.players.get('p0');
  const owner = layoutOf(ps), ownerItems = itemsOf(ps);
  const itemName = new Map(); for (const p of [...ps.board.values(), ...ps.hand]) for (const it of p?.items || []) itemName.set(it.uid, ps.gd.item(it.id)?.name || it.id);
  const allowItems = moveItems ?? (sc.kind === 'boss');
  const pieces = new Map(); for (const p of [...ps.board.values(), ...ps.hand]) if (p?.kind === 'chess') pieces.set(p.uid, p);
  const legal = new Map([...pieces].map(([u, p]) => [u, new Set(legalTiles(ps, p).map(t => t.join(',')))]));
  const name = u => ps.gd.chess(pieces.get(u)?.id)?.name || u;
  // the engine AI's own lineup + tiles for the same cards (with its battle rehearsal)
  let ai = null;
  let aiError = null;
  { const m2 = restore(st, { rngMode: 'exact' }); const p2 = m2.players.get('p0'); try { arrange(m2, p2, { final: true }); ai = layoutOf(p2); } catch (e) { ai = null; aiError = String(e?.message || e); } m2.dispose(); }
  const cap = ps.deployCap; m.dispose();
  const evalL = (L, I = null) => sc.f((mm, pp) => applyItems(pp, I) && applyLayout(pp, L));
  const res = { game, round, kind: sc.kind, objective, aiError, owner: { layout: owner, items: ownerItems, score: evalL(owner) }, ai: ai ? { layout: ai, items: ownerItems, score: evalL(ai) } : null, evals: 2 };
  let cur = res.owner, curK = keyOf(sc.kind, objective, cur.score);
  if (res.ai && less(keyOf(sc.kind, objective, res.ai.score), curK)) { cur = res.ai; curK = keyOf(sc.kind, objective, cur.score); }
  const rng = createRng(seed * 7919 + round);
  const neighbor = (L, I) => {
    if (allowItems && rng() < 0.35) {
      // move / swap one item between deployed carriers
      const N = Object.fromEntries(Object.entries(I).map(([k, v]) => [k, [...v]]));
      const dep = L.map(x => String(x.uid));
      const holders = Object.keys(N).filter(k => N[k].length && dep.includes(k));
      if (!holders.length) return null;
      const a = holders[Math.floor(rng() * holders.length)], ia = Math.floor(rng() * N[a].length), it = N[a][ia];
      const b = dep[Math.floor(rng() * dep.length)]; if (b === a) return null;
      N[b] ||= [];
      if (N[b].length < 2) { N[a].splice(ia, 1); N[b].push(it); return { L, I: N, what: `${itemName.get(it)} 从 ${name(+a)} 改给 ${name(+b)}` }; }
      const ib = Math.floor(rng() * N[b].length), jt = N[b][ib];
      N[a][ia] = jt; N[b][ib] = it; return { L, I: N, what: `${itemName.get(it)}(${name(+a)}) 与 ${itemName.get(jt)}(${name(+b)}) 对换` };
    }
    const r = neighborL(L); return r ? { ...r, I } : null;
  };
  const neighborL = (L) => {
    const occ = new Map(L.map((x, i) => [`${x.row},${x.col}`, i]));
    const bench = [...pieces.keys()].filter(u => !L.some(x => x.uid === u));
    const k = Math.floor(rng() * 5), i = Math.floor(rng() * L.length), x = L[i];
    const N = L.map(y => ({ ...y }));
    if (k === 0 && L.length > 1) { const j = Math.floor(rng() * L.length); if (j === i) return null; const y = L[j];
      if (!legal.get(x.uid).has(`${y.row},${y.col}`) || !legal.get(y.uid).has(`${x.row},${x.col}`)) return null;
      N[i] = { ...x, row: y.row, col: y.col }; N[j] = { ...y, row: x.row, col: x.col }; return { L: N, what: `对调 ${name(x.uid)} 与 ${name(y.uid)}` }; }
    if (k === 1) { const tiles = [...legal.get(x.uid)].filter(t => !occ.has(t)); if (!tiles.length) return null; const t = tiles[Math.floor(rng() * tiles.length)].split(',').map(Number);
      N[i] = { ...x, row: t[0], col: t[1] }; return { L: N, what: `${name(x.uid)} 挪到 ${t}` }; }
    if (k === 2) { const d = DIRS[Math.floor(rng() * 4)]; if (d === x.dir) return null; N[i] = { ...x, dir: d }; return { L: N, what: `${name(x.uid)} 朝 ${d}` }; }
    if (k === 3 && bench.length) { const u = bench[Math.floor(rng() * bench.length)]; if (!legal.get(u).has(`${x.row},${x.col}`)) return null;
      N[i] = { uid: u, row: x.row, col: x.col, dir: x.dir }; return { L: N, what: `${name(u)} 换下 ${name(x.uid)}` }; }
    if (k === 4 && bench.length && L.length < cap) { const u = bench[Math.floor(rng() * bench.length)]; const tiles = [...legal.get(u)].filter(t => !occ.has(t)); if (!tiles.length) return null;
      const t = tiles[Math.floor(rng() * tiles.length)].split(',').map(Number); N.push({ uid: u, row: t[0], col: t[1], dir: 'RIGHT' }); return { L: N, what: `加上 ${name(u)} 到 ${t}` }; }
    return null;
  };
  const steps = [];
  while (res.evals < budget) {
    let best = null, bestK = curK;
    for (let s = 0, tries = 0; s < sample && tries < sample * 6 && res.evals < budget; tries++) {
      const n = neighbor(cur.layout, cur.items || ownerItems); if (!n) continue; s++;
      const score = evalL(n.L, n.I); res.evals++;
      const k = keyOf(sc.kind, objective, score);
      if (less(k, bestK)) { best = { layout: n.L, items: n.I, score, what: n.what }; bestK = k; }
    }
    if (!best) break;
    steps.push({ what: best.what, score: best.score }); cur = best; curK = bestK;
  }
  res.best = { layout: cur.layout, items: cur.items || ownerItems, score: cur.score, steps, from: cur === res.owner ? 'owner' : undefined };
  // re-score owner / AI / best with more fight seeds (boss) so the reported gap is not the search's own noise
  if (sc.kind === 'boss') {
    const sc2 = scorer(st, rep, round, { K, seeds: 16 });
    const ev2 = (L, I) => sc2.f((mm, pp) => applyItems(pp, I) && applyLayout(pp, L));
    res.recheck = { owner: ev2(owner, ownerItems), best: ev2(cur.layout, cur.items || ownerItems), ai: ai ? ev2(ai, ownerItems) : null };
  }
  res.names = Object.fromEntries([...pieces].map(([u, p]) => [u, p.id]));
  return res;
}

// Equipment re-targeting: item `uid` (record uid) that first appeared on carrier `fromId` in round `round`; for every
// later recorded battle board that still shows it there, move it to a carrier of base `toBase` (when deployed with a
// free slot) and score that round. Returns per-round scores (null when the move does not apply that round).
export function itemAlt({ posDir, game, rep, rounds, itemUid, itemId, toBase, K = 8 }) {
  const out = [];
  for (const R of rounds) {
    const recCarrier = (R.end.board || []).find(b => (b.items || []).some(i => i.uid === itemUid));
    if (!recCarrier) { out.push({ round: R.round, applies: false, why: 'item no longer on the board (merged / gone)' }); continue; }
    const st = posOf(posDir, game, R.round), sc = scorer(st, rep, R.round, { K, seeds: 4 });
    const mut = toBase == null ? null : (m, ps) => {
      const chess = [...ps.board.values()].filter(p => p.kind === 'chess');
      const from = chess.find(p => p.recId === recCarrier.id || p.id === recCarrier.id.replace('chess_char_4_27', 'chess_char_4_12'));
      const it = from?.items?.find(i => i.id === itemId);
      const to = chess.filter(p => ps.gd.baseIdOf(p.id) === toBase && p !== from).sort((a, b) => ps.gd.isGolden(b.id) - ps.gd.isGolden(a.id))[0];
      if (!from || !it || !to || (to.items || []).length >= 2) return false;
      from.items = from.items.filter(x => x !== it); to.items = [...(to.items || []), it]; ps.recompute(); return true;
    };
    const s = sc.f(mut);
    out.push({ round: R.round, applies: !!s, kind: sc.kind, score: s });
  }
  return out;
}
