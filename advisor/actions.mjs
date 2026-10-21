// Candidate action generation for one seat in PREP: every action goes through the engine's public PlayerState
// handlers, so legality is the engine's. Priors are cheap heuristics used only to prune to top-K per family.
import { buyScoreOf, itemTarget, planLayout } from '../eval/engine.mjs';

// Terminal actions end the seat's turn right after them (a layout tweak is the last thing you do);
// non-terminal ones are followed by the continuation policy for the rest of the turn.
export const TERMINAL = new Set(['end', 'move', 'bench', 'rotate']);
const nm = (ps, id) => ps.gd.chess(id)?.name || ps.gd.item(id)?.name || id;
const freeHand = ps => ps.hand.findIndex(x => !x);
const boardChess = ps => [...ps.board.entries()].filter(([, p]) => p.kind === 'chess');

export function listActions(m, ps) {
  const out = [{ type: 'guide', family: 'guide', prior: 1e3, label: '按现有打法(guide)打完本回合' },
    { type: 'end', family: 'end', prior: 0, label: '直接结束回合(存钱)' }];
  const add = (a) => out.push(a);
  // Multi-step plans for bad spots (single actions rarely move a lost position): all-in roll, all-in level.
  if (ps.funds >= 2) add({ type: 'macro', family: 'macro', name: 'roll', prior: 5, label: '宏：梭哈刷新（刷到钱≤1，见合精锐/高分就买）' });
  if (ps.shop.level < m.gd.maxShopLevel && ps.funds >= ps.shop.upgradePrice) add({ type: 'macro', family: 'macro', name: 'level', prior: 5, label: '宏：能升就升（商店升到钱不够为止）' });
  const hasRoom = freeHand(ps) >= 0;
  ps.shop.slots.forEach((s, slot) => {
    if (!s || s.sold || ps.priceOf(s) > ps.funds || !hasRoom) return;
    const merge = s.kind === 'chess' && ps.completesChessMerge(s.id);
    const prior = s.kind === 'chess' ? buyScoreOf(m, ps, s.id) + (merge ? 40 : 0) : 6 + ps.gd.tierOf(s.id) * 3;
    add({ type: 'buy', family: 'buy', slot, id: s.id, price: ps.priceOf(s), prior, label: `买 ${nm(ps, s.id)}(槽${slot},${ps.priceOf(s)}金${merge ? ',合精锐' : ''})` });
  });
  if (ps.offers[0] && hasRoom) ps.offers[0].slots.forEach((s, idx) => {
    if (s.sold || (s.price || 0) > ps.funds) return;
    add({ type: 'reward', family: 'reward', idx, id: s.id, prior: 20 + (s.kind === 'chess' ? buyScoreOf(m, ps, s.id) * .2 : ps.gd.tierOf(s.id)), label: `选奖励 ${nm(ps, s.id)}` });
  });
  if (ps.shop.level < m.gd.maxShopLevel && ps.funds >= ps.shop.upgradePrice)
    add({ type: 'level', family: 'level', prior: 8, label: `升级商店 ${ps.shop.level}→${ps.shop.level + 1}(${ps.shop.upgradePrice}金)` });
  if (ps.shop.freeRefreshes > 0 || ps.funds >= m.gd.refreshPrice)
    add({ type: 'refresh', family: 'refresh', prior: 3, label: `刷新商店(${ps.shop.freeRefreshes > 0 ? '免费' : m.gd.refreshPrice + '金'})` });
  add({ type: 'freeze', family: 'freeze', prior: -1, label: ps.shop.frozen ? '解冻商店' : '冻结商店' });
  for (const p of [...ps.hand, ...ps.temp].filter(x => x?.kind === 'chess'))
    add({ type: 'sell', family: 'sell', uid: p.uid, id: p.id, prior: -buyScoreOf(m, ps, p.id) * .1 - ps.gd.tierOf(p.id), label: `卖 ${nm(ps, p.id)}(手牌)` });
  for (const [, p] of boardChess(ps))
    add({ type: 'sell', family: 'sell', uid: p.uid, id: p.id, prior: -5 - ps.gd.tierOf(p.id) * 2, label: `卖 ${nm(ps, p.id)}(场上)` });
  for (const it of [...ps.hand, ...ps.temp].filter(x => x?.kind === 'item')) {
    const t = itemTarget(m, ps, it);
    for (const [, p] of boardChess(ps)) if ((p.items?.length || 0) < 2)
      add({ type: 'equip', family: 'equip', uid: it.uid, target: p.uid, id: it.id, prior: (t && t.uid === p.uid ? 15 : 2) + ps.gd.tierOf(p.id), label: `给 ${nm(ps, p.id)} 装 ${nm(ps, it.id)}` });
  }
  // Layout: deploy each hand chess onto the tile the engine planner gives it; bench each deployed chess;
  // re-orient deployed chess. All terminal.
  const deployed = boardChess(ps).map(([, p]) => p);
  for (const p of ps.hand.filter(x => x?.kind === 'chess')) {
    const room = deployed.length < ps.deployCap, set = room ? [...deployed, p] : deployed;
    if (!room) continue;
    const key = planLayout(m, ps, set).get(p.uid);
    if (!key) continue;
    const [row, col] = key.split(',').map(Number);
    add({ type: 'move', family: 'layout', uid: p.uid, id: p.id, row, col, dir: 'RIGHT', prior: buyScoreOf(m, ps, p.id) * .1, label: `上场 ${nm(ps, p.id)} → (${row},${col})` });
  }
  for (const p of deployed) {
    if (freeHand(ps) >= 0) add({ type: 'bench', family: 'layout', uid: p.uid, id: p.id, prior: -4, label: `下场 ${nm(ps, p.id)}` });
    for (const dir of ['UP', 'RIGHT', 'DOWN', 'LEFT']) if (dir !== (p.dir || 'RIGHT'))
      add({ type: 'rotate', family: 'layout', uid: p.uid, id: p.id, dir, prior: -6, label: `${nm(ps, p.id)} 转向 ${dir}` });
  }
  return out;
}

// Family quotas keep every kind of action represented before top-K by prior.
const QUOTA = { guide: 1, end: 1, macro: 2, buy: 3, reward: 1, level: 1, refresh: 1, sell: 1, equip: 1, layout: 1, freeze: 0 };
export function prune(actions, k, extra = []) {
  const byFam = {};
  for (const a of [...actions].sort((x, y) => y.prior - x.prior)) (byFam[a.family] ||= []).push(a);
  const picked = [];
  for (const [fam, q] of Object.entries(QUOTA)) picked.push(...(byFam[fam] || []).slice(0, q));
  for (const a of extra) if (!picked.some(p => sameAction(p, a))) picked.unshift(a);
  const rest = actions.filter(a => !picked.includes(a)).sort((x, y) => y.prior - x.prior);
  return [...picked, ...rest].slice(0, Math.max(k, extra.length + 2));
}
export function sameAction(a, b) {
  const key = x => JSON.stringify([x.type, x.slot, x.idx, x.uid, x.target, x.row, x.col, x.dir]);
  return key(a) === key(b);
}

// Apply on a (restored) match. Returns the engine reply; a failed engine reply is reported, never swallowed.
export function applyAction(m, ps, a) {
  switch (a.type) {
    case 'guide': case 'end': return { ok: true };
    case 'buy': return ps.buy(a.slot);
    case 'reward': return ps.pickReward(a.idx);
    case 'level': return ps.levelUp();
    case 'refresh': return ps.refresh();
    case 'freeze': return ps.freeze();
    case 'sell': return ps.sell(a.uid);
    case 'equip': return ps.equip(a.uid, a.target);
    case 'move': return ps.move(a.uid, { area: 'board', row: a.row, col: a.col }, a.dir);
    case 'bench': return ps.move(a.uid, { area: 'hand', idx: freeHand(ps) });
    case 'rotate': { const loc = ps.find(a.uid); if (!loc?.key) return { error: 'NOT_ON_BOARD' };
      const [row, col] = loc.key.split(',').map(Number); return ps.move(a.uid, { area: 'board', row, col }, a.dir); }
    case 'macro': return runMacro(m, ps, a.name);
    default: throw Error(`unknown action ${a.type}`);
  }
}

// Exploration / a sloppy seat: 1–3 random legal economy actions (an engine refusal is a legal no-op here).
export function randomEconomy(m, ps, rng) {
  const k = 1 + rng.int(3);
  for (let i = 0; i < k; i++) {
    const acts = listActions(m, ps).filter(a => !['guide', 'end', 'move', 'bench', 'rotate'].includes(a.type));
    if (!acts.length) break;
    applyAction(m, ps, rng.pick(acts));
  }
}

function runMacro(m, ps, name) {
  if (name === 'level') { let n = 0; while (ps.shop.level < m.gd.maxShopLevel && ps.funds >= ps.shop.upgradePrice && ps.levelUp()?.ok) n++; return n ? { ok: true } : { error: 'CANNOT_LEVEL' }; }
  if (name !== 'roll') throw Error(`unknown macro ${name}`);
  for (let i = 0; i < 30 && ps.funds >= 1; i++) {
    let best = -1, bv = 12;
    ps.shop.slots.forEach((s, slot) => {
      if (!s || s.sold || s.kind !== 'chess' || ps.priceOf(s) > ps.funds || freeHand(ps) < 0) return;
      const v = buyScoreOf(m, ps, s.id) + (ps.completesChessMerge(s.id) ? 40 : 0);
      if (v > bv) { bv = v; best = slot; }
    });
    if (best >= 0) { if (!ps.buy(best)?.ok) break; continue; }
    if (ps.funds < (ps.shop.freeRefreshes > 0 ? 0 : m.gd.refreshPrice) + 1 || !ps.refresh()?.ok) break;
  }
  return { ok: true };
}
