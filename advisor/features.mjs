// Position features for the learned value model (evaluator v2). One implementation, used by data generation
// (advisor/datagen.mjs) and by the scorer (advisor/model.mjs). Seat-centric + team aggregates; all public-state.
import { features as searchFeatures } from '../search/core.mjs';

let schema = null;
export function featureNames(gd) {
  if (schema) return schema;
  const bonds = gd.bondIds;
  const names = ['round', 'lp', 'funds', 'level', 'deployCap', 'boardN', 'handN', 'ownedN', 'tierSum', 'tierMax', 'goldenN', 'goldenTierSum', 'itemsN',
    'material', 'air', 'heal', 'pairs', 'layersTotal', 'activeLayers', 'econLayers', 'teamLp', 'aliveN', 'teamLayers', 'teamActiveLayers',
    'teamLevelMean', 'teamFundsSum', 'teamMaterial', 'teamGolden', 'hiddenLayerSum', 'roundsToBoss', 'upgradePrice'];
  for (const b of bonds) names.push(`tier:${b}`, `lay:${b}`, `cnt:${b}`);
  for (const b of bonds) names.push(`teamTier:${b}`);
  schema = { names, bonds };
  return schema;
}
function seatRaw(m, ps) {
  const owned = ps.allChess(), board = [...ps.board.values()].filter(p => p.kind === 'chess'), gd = ps.gd;
  const tiers = owned.map(p => gd.tierOf(p.id)), golden = owned.filter(p => gd.isGolden(p.id));
  const sf = searchFeatures(m, ps, null);
  const cnt = {};
  for (const p of board) for (const b of gd.chess(p.id)?.bonds || []) cnt[b] = (cnt[b] || 0) + 1;
  return { ps, owned, board, tiers, golden, sf, cnt };
}
export function seatFeatures(m, ps) {
  const { names, bonds } = featureNames(m.gd), gd = m.gd;
  const me = seatRaw(m, ps), team = m.order.filter(p => p.alive).map(p => p === ps ? me : seatRaw(m, p));
  const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
  const v = [m.round, ps.lp, ps.funds, ps.shop.level, ps.deployCap, me.board.length, ps.hand.filter(Boolean).length, me.owned.length,
    sum(me.tiers, x => x), Math.max(0, ...me.tiers), me.golden.length, sum(me.golden, p => gd.tierOf(p.id)), me.sf.items,
    me.sf.material, me.sf.air, me.sf.heal, me.sf.pairs, me.sf.layers, me.sf.activeLayers, me.sf.economicLayers,
    typeof m.teamLp === 'number' ? m.teamLp : sum(team, t => t.ps.lp), team.length, sum(team, t => t.sf.layers), sum(team, t => t.sf.activeLayers),
    sum(team, t => t.ps.shop.level) / Math.max(1, team.length), sum(team, t => t.ps.funds), sum(team, t => t.sf.material), sum(team, t => t.golden.length),
    m.hiddenLayerSum || 0, Math.max(0, gd.bossRound - m.round), ps.shop.upgradePrice ?? 0];
  for (const b of bonds) v.push(ps.bonds[b]?.active ? (ps.bonds[b].tier || 1) : 0, ps.layers[b] || 0, me.cnt[b] || 0);
  for (const b of bonds) v.push(sum(team, t => t.ps.bonds[b]?.active ? (t.ps.bonds[b].tier || 1) : 0));
  if (v.length !== names.length) throw Error(`feature length ${v.length} != ${names.length}`);
  return v.map(x => Number.isFinite(x) ? x : 0);
}
