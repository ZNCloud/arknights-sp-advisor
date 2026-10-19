// Owner-shadow continuation: after a deviation, later preps of the owner seat imitate the owner's recorded plan as far
// as the actual cards allow — reach the recorded 调度中心 level, buy toward the recorded lineup (board + hand of the
// battle row) and items, refresh with at most the owner's own unexplained spend of that round, take merge rewards that
// are on the plan, equip the recorded items on the recorded carriers, stand the recorded operators on their recorded
// tiles; whatever the plan cannot supply is filled by the engine bot's own lineup / item / layout heuristics.
import { buyScoreOf, itemTarget, planLayout } from '../eval/engine.mjs';
import { copiesByBase, itemsOf } from './ownerturn.mjs';
import { engineId } from './force.mjs';

const freeHand = ps => ps.hand.findIndex(x => !x);
const chessOwned = ps => {
  const out = [];
  for (const [key, p] of ps.board) if (p.kind === 'chess') out.push({ p, key });
  for (const p of [...ps.hand, ...ps.temp]) if (p?.kind === 'chess') out.push({ p, key: null });
  return out;
};
function copiesOwned(ps) {
  const o = {};
  for (const { p } of chessOwned(ps)) { const b = ps.gd.baseIdOf(p.id); o[b] = (o[b] || 0) + (ps.gd.isGolden(p.id) ? ps.gd.mergeCount(b) : 1); }
  return o;
}

// plan for round t: { level, copies (target copies by base), items (multiset), board (recorded battle board), keep (bases of rounds ≥ t), budget }
export function planOf(gd, rounds, t, budgets = {}) {
  const R = rounds.find(x => x.round === t);
  if (!R?.end) return null;
  const keep = new Set();
  for (const X of rounds) if (X.round >= t && X.end) for (const b of Object.keys(copiesByBase(gd, X.end))) keep.add(b);
  const items = {};
  for (const id of itemsOf(R.end)) items[id] = (items[id] || 0) + 1;
  return { round: t, level: R.end.level, copies: copiesByBase(gd, R.end), items, board: R.end.board || [], keep, budget: budgets[t] ?? 0 };
}

function wantChess(ps, plan, id) {
  const gd = ps.gd, b = gd.baseIdOf(id);
  if (!plan.keep.has(b)) return false;
  const have = copiesOwned(ps)[b] || 0, want = plan.copies[b] || 0;
  return have < Math.max(want, 1) || ps.completesChessMerge(id);
}
function wantItem(ps, plan, id) {
  const have = [...ps.hand, ...ps.temp].filter(x => x?.kind === 'item' && x.id === id).length
    + [...ps.board.values()].flatMap(p => p.items || []).filter(i => i.id === id).length;
  return have < (plan.items[id] || 0);
}
function buyPass(ps, plan) {
  let n = 0;
  for (let i = 0; i < ps.shop.slots.length; i++) {
    const s = ps.shop.slots[i];
    if (!s || s.sold || ps.priceOf(s) > ps.funds || freeHand(ps) < 0) continue;
    if (s.kind === 'chess' ? wantChess(ps, plan, s.id) : wantItem(ps, plan, s.id)) { if (ps.buy(i)?.ok) n++; }
  }
  return n;
}
function takeRewards(m, ps, plan) {
  for (let k = 0; k < 6 && ps.offers[0]; k++) {
    const o = ps.offers[0];
    let best = -1, bv = -1e9;
    o.slots.forEach((s, i) => { if (s.sold || (s.price || 0) > ps.funds) return;
      const v = s.kind === 'chess' ? (plan.keep.has(ps.gd.baseIdOf(s.id)) ? 100 : 0) + buyScoreOf(m, ps, s.id) : ps.gd.tierOf(s.id) + (plan.items[s.id] ? 100 : 0);
      if (v > bv) { bv = v; best = i; } });
    if (best < 0 || freeHand(ps) < 0 || !ps.pickReward(best)?.ok) break;
  }
}

export function shadowTurn(m, ps, plan, { log = null } = {}) {
  const gd = ps.gd;
  if (!plan) return;
  while (ps.shop.level < plan.level && ps.shop.level < gd.maxShopLevel && ps.funds >= ps.shop.upgradePrice) if (!ps.levelUp()?.ok) break;
  takeRewards(m, ps, plan);
  buyPass(ps, plan);
  let spent = 0;
  const price = () => (ps.shop.freeRefreshes > 0 ? 0 : gd.refreshPrice);
  const missing = () => Object.entries(plan.copies).some(([b, c]) => (copiesOwned(ps)[b] || 0) < c);
  for (let k = 0; k < 40 && missing() && spent + price() <= Math.max(plan.budget, 0) && ps.funds >= price() && freeHand(ps) >= 0; k++) {
    const p = price();
    if (!ps.refresh()?.ok) break;
    spent += p; buyPass(ps, plan); takeRewards(m, ps, plan);
  }
  // sell off-plan chess in the hand (never on the plan of this or a later recorded round)
  for (const p of [...ps.hand, ...ps.temp]) if (p?.kind === 'chess' && !plan.keep.has(gd.baseIdOf(p.id))) ps.sell(p.uid);
  // equipment: recorded carrier first, then the bot's item heuristic for leftovers
  const owned = () => chessOwned(ps);
  for (const b of plan.board) for (const it of b.items || []) {
    const base = gd.baseIdOf(engineId(b.id));
    const carrier = owned().filter(x => gd.baseIdOf(x.p.id) === base).sort((a, c) => gd.isGolden(c.p.id) - gd.isGolden(a.p.id))[0];
    const item = [...ps.hand, ...ps.temp].find(x => x?.kind === 'item' && x.id === it.id);
    if (carrier && item && (carrier.p.items || []).length < 2) ps.equip(item.uid, carrier.p.uid);
  }
  layout(m, ps, plan);
  for (const it of [...ps.hand, ...ps.temp].filter(x => x?.kind === 'item')) {
    const t = itemTarget(m, ps, it);
    if (t && (t.items || []).length < 2 && [...ps.board.values()].includes(t)) ps.equip(it.uid, t.uid);
  }
}

// Recorded operators on their recorded tiles (same id, else same base), the rest of the deploy cap by the bot planner.
export function layout(m, ps, plan) {
  const gd = ps.gd, used = new Set(), want = [];
  for (const b of plan.board) {
    if (!b.at) continue;
    const id = engineId(b.id), base = gd.baseIdOf(id);
    const c = chessOwned(ps).find(x => !used.has(x.p.uid) && x.p.id === id) || chessOwned(ps).find(x => !used.has(x.p.uid) && gd.baseIdOf(x.p.id) === base);
    if (!c) continue;
    used.add(c.p.uid); want.push({ p: c.p, row: b.at[0], col: b.at[1], dir: b.dir || 'RIGHT' });
  }
  // bench everything not wanted (hand room permitting), then move wanted pieces (swaps settle over passes)
  for (const [, p] of [...ps.board]) if (p.kind === 'chess' && !used.has(p.uid) && freeHand(ps) >= 0) ps.move(p.uid, { area: 'hand', idx: freeHand(ps) });
  for (let pass = 0; pass < 4; pass++) for (const x of want) {
    if (ps.find(x.p.uid)?.key === `${x.row},${x.col}`) continue;
    let r = ps.move(x.p.uid, { area: 'board', row: x.row, col: x.col }, x.dir);
    if (r?.error === 'BOARD_FULL') { const u = [...ps.board].find(([, p]) => p.kind === 'chess' && !used.has(p.uid)); if (u) { const [ur, uc] = u[0].split(',').map(Number); ps.move(x.p.uid, { area: 'board', row: ur, col: uc }, x.dir); } }
  }
  // fill the remaining deploy cap with the best other hand chess on planner tiles
  const deployed = () => [...ps.board.values()].filter(p => p.kind === 'chess').length;
  const extras = [...ps.hand, ...ps.temp].filter(p => p?.kind === 'chess' && !used.has(p.uid)).sort((a, b) => buyScoreOf(m, ps, b.id) - buyScoreOf(m, ps, a.id));
  for (const p of extras) {
    if (deployed() >= ps.deployCap) break;
    const set = [...ps.board.values()].filter(x => x.kind === 'chess');
    const key = planLayout(m, ps, [...set, p]).get(p.uid);
    if (!key) continue;
    const [row, col] = key.split(',').map(Number);
    if (ps.board.has(key)) continue;
    ps.move(p.uid, { area: 'board', row, col }, 'RIGHT');
  }
}

// Install the shadow on seat p0 of a (restored) match for every prep from round `from` on. Teammates stay engine bots.
export function installShadow(m, rounds, budgets, { from, playerId = 'p0', onPrep = null } = {}) {
  const sb = m.scheduleBotPrep;
  m.scheduleBotPrep = function (ps, i) {
    if (ps.playerId !== playerId || this.round < from) return sb.call(this, ps, i);
    const round = this.round;
    this.later(0, () => {
      if (this.phase !== 'PREP' || this.round !== round || !ps.alive || ps.ready) return;
      if (onPrep && onPrep(this, ps) === 'stop') return;   // the hook played (or ended) this prep itself
      try { shadowTurn(this, ps, planOf(this.gd, rounds, round, budgets)); } catch (e) { this.reportError('shadow', e); }
      ps.resolveTemp(); ps.setReady(true);
    });
  };
}
