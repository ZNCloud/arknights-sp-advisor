// Derive the owner's net prep actions of one round from two recorded snapshots (start of PREP → the board that
// fought) and replay them through the engine's own handlers (levelUp / buy / sell / equip), so the engine judges the
// legality and the economy. What the record cannot place (a copy that was not in the opening shop: a refresh, a merge
// reward, a 机变 card, the band) is granted with acquireChess / acquireItem and listed as such.
import { engineId } from './force.mjs';

const isItem = id => id.startsWith('chess_item');
const ms = a => { const o = {}; for (const x of a) o[x] = (o[x] || 0) + 1; return o; };

export function copiesByBase(gd, row) {
  const o = {};
  for (const id of [...(row.board || []).map(b => b.id), ...(row.hand || [])]) {
    if (isItem(id)) continue;
    const eid = engineId(id), base = gd.baseIdOf(eid);
    o[base] = (o[base] || 0) + (gd.isGolden(eid) ? gd.mergeCount(base) : 1);
  }
  return o;
}
export function itemsOf(row) {
  return [...(row.hand || []).filter(isItem), ...(row.board || []).flatMap(b => (b.items || []).map(i => i.id))];
}

export function deriveTurn(gd, start, end) {
  const a = { levelUps: Math.max(0, end.level - start.level), buys: [], extra: [], sells: [], itemBuys: [], itemExtra: [], itemGone: [], eliteAppeared: [] };
  const s = copiesByBase(gd, start), e = copiesByBase(gd, end);
  const shopChess = (start.shop || []).filter(x => !isItem(x.id)).map(x => engineId(x.id));
  const used = new Set();
  for (const base of new Set([...Object.keys(s), ...Object.keys(e)])) {
    const d = (e[base] || 0) - (s[base] || 0);
    if (d > 0) {
      let left = d;
      shopChess.forEach((id, i) => { if (left > 0 && !used.has(i) && gd.baseIdOf(id) === base && !gd.isGolden(id)) { used.add(i); a.buys.push({ id, shopIdx: i }); left--; } });
      // a whole elite that was never assembled from copies (band / 博士投影 / reward): record it as an elite gain
      const goldenId = gd.goldenIdOf(base), need = gd.mergeCount(base);
      const endGold = [...(end.board || []).map(b => b.id), ...(end.hand || [])].filter(x => engineId(x) === goldenId).length;
      const startGold = [...(start.board || []).map(b => b.id), ...(start.hand || [])].filter(x => engineId(x) === goldenId).length;
      if (endGold > startGold && left >= need && (s[base] || 0) + (d - left) < need) { a.eliteAppeared.push({ id: goldenId }); left -= need; }
      for (; left > 0; left--) a.extra.push({ id: base });
    } else if (d < 0) a.sells.push({ base, copies: -d });
  }
  const si = ms(itemsOf(start)), ei = ms(itemsOf(end));
  const shopItems = (start.shop || []).filter(x => isItem(x.id)).map(x => x.id);
  const usedI = new Set();
  for (const id of new Set([...Object.keys(si), ...Object.keys(ei)])) {
    const d = (ei[id] || 0) - (si[id] || 0);
    if (d > 0) {
      let left = d;
      shopItems.forEach((x, i) => { if (left > 0 && !usedI.has(i) && x === id) { usedI.add(i); a.itemBuys.push({ id, shopIdx: i }); left--; } });
      for (; left > 0; left--) a.itemExtra.push({ id });
    } else if (d < 0) for (let k = 0; k < -d; k++) a.itemGone.push({ id });
  }
  return a;
}

const freeHand = ps => ps.hand.findIndex(x => !x);
function chessPieces(ps) {
  const out = [];
  for (const [key, p] of ps.board) if (p.kind === 'chess') out.push({ p, key });
  for (const p of [...ps.hand, ...ps.temp]) if (p?.kind === 'chess') out.push({ p, key: null });
  return out;
}

// Replay the derived turn on the forced start state. Returns { log, refused, fundsLeft, spentKnown }.
export function replayTurn(m, ps, start, end, turn) {
  const log = [], refused = [];
  const f0 = ps.funds;
  const call = (label, fn) => { const r = fn(); if (r && r.ok === false || r?.error) { refused.push(`${label}: ${r.error || JSON.stringify(r)}`); return false; } log.push(label); return true; };
  // 1. upgrades first (the owner's order is unknown; an upgrade price only falls over time, so first is the cheapest it got)
  for (let i = 0; i < turn.levelUps; i++) call(`升级 ${ps.shop.level}→${ps.shop.level + 1}（${ps.shop.upgradePrice} 金）`, () => ps.levelUp());
  // 2. sells: hand copies first, then board; an elite only when copies are not enough
  for (const s of turn.sells) {
    let left = s.copies;
    const cands = chessPieces(ps).filter(x => ps.gd.baseIdOf(x.p.id) === s.base)
      .sort((a, b) => (ps.gd.isGolden(a.p.id) - ps.gd.isGolden(b.p.id)) || ((a.key ? 1 : 0) - (b.key ? 1 : 0)));
    for (const c of cands) {
      if (left <= 0) break;
      const w = ps.gd.isGolden(c.p.id) ? ps.gd.mergeCount(s.base) : 1;
      if (w > left && cands.some(o => o !== c && !ps.gd.isGolden(o.p.id))) continue;
      if (call(`卖 ${ps.gd.chess(c.p.id)?.name || c.p.id}`, () => ps.sell(c.p.uid))) left -= w;
    }
    if (left > 0) refused.push(`卖 ${s.base}: 还差 ${left} 份找不到`);
  }
  // 3. buys from the opening shop (slot indexes shift as nothing is removed: sold slots stay as sold)
  for (const b of turn.buys) {
    const idx = ps.shop.slots.findIndex((x, i) => x && !x.sold && x.kind === 'chess' && x.id === b.id);
    call(`买 ${ps.gd.chess(b.id)?.name}（商店，${ps.shop.slots[idx] ? ps.priceOf(ps.shop.slots[idx]) : '?'} 金）`, () => idx >= 0 ? ps.buy(idx) : { error: 'NOT_IN_SHOP' });
  }
  for (const b of turn.itemBuys) {
    const idx = ps.shop.slots.findIndex(x => x && !x.sold && x.kind === 'item' && x.id === b.id);
    call(`买装备 ${ps.gd.item(b.id)?.name}`, () => idx >= 0 ? ps.buy(idx) : { error: 'NOT_IN_SHOP' });
  }
  const fundsAfterKnown = ps.funds;
  // 4. gains the record cannot attribute to the opening shop
  for (const x of turn.eliteAppeared) { const p = ps.acquireChess(x.id, { source: 'replay' }); (p ? log : refused).push(`得到精锐 ${ps.gd.chess(x.id)?.name}（非开局商店：band/奖励/投影）`); }
  for (const x of turn.extra) { const p = ps.acquireChess(x.id, { source: 'replay' }); (p ? log : refused).push(`得到 ${ps.gd.chess(x.id)?.name}（非开局商店：刷新/合成奖励/机变）`); }
  for (const x of turn.itemExtra) { const p = ps.acquireItem(x.id, { source: 'replay', displayed: true }); (p ? log : refused).push(`得到装备 ${ps.gd.item(x.id)?.name}（非开局商店）`); }
  // 5. equipment: for every recorded carrier, equip the recorded items from the hand
  const placed = new Set();
  for (const b of end.board || []) {
    for (const it of b.items || []) {
      const carrier = chessPieces(ps).find(x => !placed.has(x.p.uid) && x.p.id === engineId(b.id) && !(x.p.items || []).some(i => i.id === it.id) && (x.p.items || []).length < 2);
      const already = chessPieces(ps).find(x => x.p.id === engineId(b.id) && (x.p.items || []).some(i => i.id === it.id));
      if (already) continue;
      const item = [...ps.hand, ...ps.temp].find(x => x?.kind === 'item' && x.id === it.id);
      if (!carrier || !item) { refused.push(`装备 ${ps.gd.item(it.id)?.name} → ${ps.gd.chess(engineId(b.id))?.name}: ${!carrier ? '找不到持有人' : '手里没有这件'}`); continue; }
      call(`装备 ${ps.gd.item(it.id)?.name} → ${ps.gd.chess(carrier.p.id)?.name}`, () => ps.equip(item.uid, carrier.p.uid));
    }
  }
  return { log, refused, fundsStart: f0, fundsAfterKnown, fundsLeft: ps.funds };
}

// Move pieces to the recorded tiles through g.move (legality, deploy cap and swaps are the engine's). A hand piece
// whose tile is free while the board is full swaps in for an unplanned board piece first; board pieces then move /
// swap to their own tiles; several passes settle swap chains.
export function replayLayout(ps, end) {
  const refused = [];
  const want = (end.board || []).filter(b => b.at);
  const pieces = chessPieces(ps);
  const taken = new Set(), plan = [];
  for (const b of want) {
    const items = (b.items || []).map(i => i.id).sort().join('+');
    const c = pieces.find(x => !taken.has(x.p.uid) && x.p.id === engineId(b.id) && (x.p.items || []).map(i => i.id).sort().join('+') === items)
      || pieces.find(x => !taken.has(x.p.uid) && x.p.id === engineId(b.id));
    if (!c) { refused.push(`上场 ${b.id}@${b.at}: 找不到这张牌`); continue; }
    taken.add(c.p.uid); plan.push({ p: c.p, row: b.at[0], col: b.at[1], dir: b.dir || 'RIGHT' });
  }
  const at = x => ps.find(x.p.uid)?.key === `${x.row},${x.col}`;
  let last = {};
  for (let pass = 0; pass < 6; pass++) {
    last = {};
    for (const x of plan) {
      if (at(x)) { if ((x.p.dir || 'RIGHT') !== x.dir) { const r = ps.move(x.p.uid, { area: 'board', row: x.row, col: x.col }, x.dir); if (!r?.ok) last[x.p.uid] = `转向 ${r?.error}`; } continue; }
      let r = ps.move(x.p.uid, { area: 'board', row: x.row, col: x.col }, x.dir);
      if (r?.error === 'BOARD_FULL') {
        // swap in over an unplanned board piece, then retry on a later pass
        const u = [...ps.board].find(([, p]) => p.kind === 'chess' && !taken.has(p.uid));
        if (u) { const [ur, uc] = u[0].split(',').map(Number); r = ps.move(x.p.uid, { area: 'board', row: ur, col: uc }, x.dir); }
      }
      if (!r?.ok) last[x.p.uid] = `${ps.gd.chess(x.p.id)?.name} → ${x.row},${x.col} ${x.dir}: ${r?.error}`;
    }
    if (plan.every(x => at(x) && (x.p.dir || 'RIGHT') === x.dir)) break;
  }
  for (const [, p] of [...ps.board]) {
    if (p.kind !== 'chess' || taken.has(p.uid)) continue;
    const r = freeHand(ps) >= 0 ? ps.move(p.uid, { area: 'hand', idx: freeHand(ps) }) : { error: 'HAND_FULL' };
    if (!r?.ok) refused.push(`下场 ${ps.gd.chess(p.id)?.name}: ${r?.error}`);
  }
  for (const x of plan) if (!at(x) || (x.p.dir || 'RIGHT') !== x.dir) refused.push(`站位 ${last[x.p.uid] || ps.gd.chess(x.p.id)?.name + ' 未到位'}`);
  return refused;
}
