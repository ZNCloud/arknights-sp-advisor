// Battles of the owner's own board, independent of the teammates (the record holds nothing about them):
//   ownerBossFight — the owner alone on the boss field (the engine's solo `_s` template, the owner's half 'L'), against a
//   pool far larger than one player's share (bloodPoint × 1), so the fight measures how fast THIS board burns the
//   leader: game seconds to deal one player's share, and the share dealt within the visible countdown (levelMaxPlayTime,
//   120 real s = 240 game s) and before the overtime drain (150 real s = 300 game s). A co-op team clears the pool when
//   every seat deals its share in time, so "share within the countdown" is the owner's part of a win.
import { createRng, deriveSeed } from '../eval/engine.mjs';
const W = await import(new URL('../../engine/server/match/waves.js', import.meta.url));
const FA = await import(new URL('../../engine/server/match/finalAssault.js', import.meta.url));
const { GEO } = await import(new URL('../../engine/shared/constants.js', import.meta.url));

export function ownerBossFight(m, ps, { bossId, hidden = false, seed = 1, maxGs = null, round = m.round } = {}) {
  const gd = m.gd;
  const wave = W.buildBossWave(gd, createRng(deriveSeed(seed, `boss-wave:${round}`)), m.factions, round, { bossId, solo: true });
  const share = FA.bossPoolHp(gd, bossId, 1);
  const pool = new FA.SharedBossPool(share * 20);
  const spawns = wave.spawns.map(s => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
  const input = ps.battleInput({ side: 'L', colOffset: 0 });
  input.lpForBoss = 999;
  const ev = { input, kind: hidden ? 'hidden' : 'boss', round, spawns, routes: wave.routes, side: null };
  m.dispatch(ps, 'onBattleStart', ev);
  const levelGs = (gd.bossLevelTime(round) || 120) * gd.combatTimeScale, overGs = gd.bossOvertimeAfterReal * gd.combatTimeScale;
  const limit = maxGs ?? overGs;
  const b = m.newBattle({ seed: deriveSeed(seed, `owner-boss:${round}`), kind: hidden ? 'hidden' : 'boss', modeId: m.modeId, round, stageId: m.stageId,
    rect: { ...GEO.BOSS_RECT }, timeLimit: Infinity, players: [ev.input || input], spawns: m._sanitizeSpawns(spawns), routes: wave.routes, sharedBoss: pool,
    flags: { layerGainsEnabled: false, ...gd.dp, enemyScale: gd.enemyScale(round) }, fieldId: 'owner-boss', enemyOverrides: wave.overrides, waveId: wave.templateId, bossId });
  let tShare = null, atLevel = null, lpLost = 0;
  try { b.on('enemyLeak', (ctx) => { lpLost += Number(ctx?.enemy?.lpr ?? ctx?.enemy?.def?.lpr ?? 1) || 1; }, { priority: -1000, owner: 'match' }); } catch { /* optional */ }
  const dealt = () => pool.byPlayer.get(ps.playerId) || 0;
  while (!b.finished) {
    b.step();
    if (tShare == null && dealt() >= share) tShare = b.time;
    if (atLevel == null && b.time >= levelGs) atLevel = dealt();
    if (b.time >= limit) { b.forceEnd('forced'); break; }
  }
  const total = dealt();
  return { bossId, template: wave.templateId, share, timeToShareGs: tShare != null ? +tShare.toFixed(1) : null,
    shareAtCountdown: +((atLevel ?? total) / share).toFixed(3), shareAtOvertime: +(total / share).toFixed(3), leakLp: lpLost, errors: b.errors?.length || 0 };
}
