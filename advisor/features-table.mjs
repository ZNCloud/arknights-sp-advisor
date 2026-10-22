// A. 局面表（固定格式数字向量，TABLE_VERSION 管格式）。单位以**属性**编码（阶/精锐/价格/盟约多热/攻防血/攻速/
// 射程格数/伤害类型/阻挡/对空/技能倍率/站位/装备），干员编号不进向量——数值改了输入跟着变。
// 槽位：场上 10（按强度排序）、手牌 6、商店 5；盟约逐个（人数/档位/层数/叠层速度）；队友 3；boss 公开属性。
// 目标（胜率、R13 层、R15 伤害、存活回合）不进输入。
import { layersAt } from '../model/stacking.mjs';

export const TABLE_VERSION = 1;
const BOARD = 10, HAND = 6, SHOP = 5, MATES = 3;
const DMG = ['phys', 'arts', 'heal'];
let cache = null;

function unitNames(prefix, bonds) {
  return ['present', 'tier', 'golden', 'price', 'atk', 'def', 'hp', 'res', 'bat', 'aspd', 'range', 'block', 'fly', 'ranged',
    ...DMG.map(d => `dmg_${d}`), 'skillAtk', 'skillTimes', 'skillSp', 'row', 'col', 'items', 'itemTier', 'copies',
    ...bonds.map(b => `b_${b}`)].map(n => `${prefix}.${n}`);
}
export function tableNames(gd) {
  if (cache) return cache;
  const bonds = gd.bondIds, names = ['round', 'roundsToBoss', 'lp', 'funds', 'level', 'upgradePrice', 'refreshPrice', 'freeRefreshes', 'deployCap',
    'teamLp', 'aliveN', 'hiddenLayerSum', 'creditedKills', 'boss.hp', 'boss.atk', 'boss.def', 'boss.res', 'shopFrozen'];
  for (let i = 0; i < BOARD; i++) names.push(...unitNames(`board${i}`, bonds));
  for (let i = 0; i < HAND; i++) names.push(...unitNames(`hand${i}`, bonds));
  for (let i = 0; i < SHOP; i++) names.push(...unitNames(`shop${i}`, bonds));
  for (const b of bonds) names.push(`bond.${b}.count`, `bond.${b}.tier`, `bond.${b}.active`, `bond.${b}.layers`, `bond.${b}.pace`, `bond.${b}.projR13`);
  // selfN: the seat's own block (everything before the teammates) — the distilled student (distill/features.mjs) reuses
  // it and swaps the teammate block for public-only teammate state.
  const selfN = names.length;
  for (let i = 0; i < MATES; i++) names.push(...['alive', 'lp', 'level', 'funds', 'strength', 'mainTier', 'mainLayers', 'golden'].map(n => `mate${i}.${n}`));
  cache = { names, selfN, bonds, version: TABLE_VERSION };
  return cache;
}
function unit(gd, ps, id, piece, loc, bonds) {
  const c = gd.chess(id);
  if (!c) return null;
  const st = c.stats || {}, bb = c.skill?.bb || {};
  const skillAtk = Math.max(0, ...Object.entries(bb).filter(([k]) => /atk_scale|atk$/.test(k)).map(([, v]) => +v || 0));
  const items = piece?.items || [], [row, col] = loc ? loc.split(',').map(Number) : [0, 0];
  const copies = ps.allChess().filter(p => gd.baseIdOf(p.id) === gd.baseIdOf(id)).length;
  return [1, gd.tierOf(id), gd.isGolden(id) ? 1 : 0, c.price || 0, st.atk || 0, st.def || 0, st.maxHp || 0, st.res || 0, st.bat || 0, st.aspd || 0,
    (c.rangeGrid || []).length, st.blockCnt || 0, c.canHitFly ? 1 : 0, c.position === 'RANGED' ? 1 : 0, ...DMG.map(d => c.dmgType === d ? 1 : 0),
    skillAtk, +bb['attack@times'] || 0, c.skill?.spCost || 0, row, col, items.length, items.reduce((s, it) => s + (gd.tierOf(it.id) || 0), 0), copies,
    ...bonds.map(b => (c.bonds || []).includes(b) ? 1 : 0)];
}
const strength = (gd, p) => gd.tierOf(p.id) * 3 + (gd.isGolden(p.id) ? 6 : 0) + (p.items?.length || 0) * 2;
export function tableFeatures(m, ps) {
  const v = [...tableSelf(m, ps), ...tableMates(m, ps)];
  if (v.length !== tableNames(m.gd).names.length) throw Error(`table length ${v.length} != ${tableNames(m.gd).names.length}`);
  return v;
}
// The seat's own block: round / economy / boss, board, hand, shop, bonds (tableNames().selfN values).
export function tableSelf(m, ps) {
  const gd = m.gd, { selfN, bonds } = tableNames(gd), width = unitNames('x', bonds).length, v = [];
  const boss = gd.boss(m.round === gd.hiddenRound ? m.hiddenBossId : m.bossId), be = gd.enemy(boss?.enemyKey)?.stats || {};
  v.push(m.round, Math.max(0, gd.bossRound - m.round), ps.lp, ps.funds, ps.shop.level, ps.shop.upgradePrice ?? 0, gd.refreshPrice, ps.shop.freeRefreshes || 0, ps.deployCap,
    typeof m.teamLp === 'number' ? m.teamLp : 0, m.alivePlayers().length, m.hiddenLayerSum || 0, ps.creditedKills || 0, be.maxHp || 0, be.atk || 0, be.def || 0, be.res || 0, ps.shop.frozen ? 1 : 0);
  const pad = (rows, n) => { for (let i = 0; i < n; i++) v.push(...(rows[i] || new Array(width).fill(0))); };
  const board = [...ps.board.entries()].filter(([, p]) => p.kind === 'chess').sort((a, b) => strength(gd, b[1]) - strength(gd, a[1]));
  pad(board.map(([k, p]) => unit(gd, ps, p.id, p, k, bonds)).filter(Boolean), BOARD);
  const hand = [...ps.hand, ...ps.temp].filter(p => p?.kind === 'chess').sort((a, b) => strength(gd, b) - strength(gd, a));
  pad(hand.map(p => unit(gd, ps, p.id, p, null, bonds)).filter(Boolean), HAND);
  pad(ps.shop.slots.filter(s => s?.kind === 'chess').map(s => s.sold ? null : unit(gd, ps, s.id, null, null, bonds)).map(r => r || new Array(width).fill(0)), SHOP);
  const r = Math.max(1, m.round), ref = layersAt('natural_g06', r);
  for (const b of bonds) {
    const st = ps.bonds[b] || {}, L = ps.layers[b] || 0;
    // Pace vs the natural-opening stacking curve (model/stacking.mjs) and a power-law projection to R13.
    v.push(st.count || 0, st.tier || 0, st.active ? 1 : 0, L, ref > 0 ? L / ref : 0, L * Math.pow(13 / r, 1.5));
  }
  if (v.length !== selfN) throw Error(`table self length ${v.length} != ${selfN}`);
  return v.map(x => Number.isFinite(x) ? x : 0);
}
// Teammates in seat order (simulator view: includes their funds and full boards, which a live client does not see).
function tableMates(m, ps) {
  const gd = m.gd, v = [];
  const mates = m.order.filter(p => p !== ps);
  for (let i = 0; i < MATES; i++) {
    const q = mates[i];
    if (!q) { v.push(0, 0, 0, 0, 0, 0, 0, 0); continue; }
    const main = Object.entries(q.layers || {}).sort((a, b) => b[1] - a[1])[0];
    v.push(q.alive ? 1 : 0, q.lp, q.shop.level, q.funds, q.allChess().reduce((s, p) => s + strength(gd, p), 0),
      main ? (q.bonds[main[0]]?.tier || 0) : 0, main ? main[1] : 0, q.allChess().filter(p => gd.isGolden(p.id)).length);
  }
  return v.map(x => Number.isFinite(x) ? x : 0);
}
