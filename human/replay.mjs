// Forced replay of a recorded human match in the engine (task sphind_2254 M3 step 1).
// The record has no random state, so the engine is ALIGNED to it instead of reproducing its draws:
//   * setup: the stage is the only one of the mode on which every recorded tile is legal (stage scan, `stageScan`),
//     the R14 boss is the recorded one, the band is the one the record's start LP and free gains point to (`ALIGN`);
//     teammates are engine bots (the record holds nothing about them);
//   * every PREP: the owner seat is forced onto the recorded start snapshot (shop / hand / board / items / funds / LP /
//     level / layers), the owner's net turn is replayed through the engine handlers, compared with the recorded battle
//     board, and the battle board is then forced to the record;
//   * every normal battle: the round's enemy pick is unknown, so the engine's own distribution of picks for that round
//     (from 400 setups) is enumerated and the battle is run for each; the replay keeps the most common pick whose
//     settle LP equals the record and reports how much of the prior agrees.
import { makeMatch, createRng, deriveSeed } from '../eval/engine.mjs';
import { capture, restore } from '../advisor/state.mjs';
import { loadSegment, roundsOf, bondsOf, GAMES } from './record.mjs';
import { forceSeat, diffSeat, engineId, STAND_INS } from './force.mjs';
import { deriveTurn, replayTurn, replayLayout } from './ownerturn.mjs';
import { ownerBossFight } from '../advisor/battle.mjs';
import { pickPrior, roundOutcome } from '../advisor/field.mjs';

const W = await import(new URL('../../engine/server/match/waves.js', import.meta.url));
const { SharedPool } = await import(new URL('../../engine/server/match/pool.js', import.meta.url));

export const ALIGN = {
  game1: { stage: 'act2autochess_m02', boss: 'boss_3', band: 'band_paganini' },
  game2: { stage: 'act2autochess_m03', boss: 'boss_5', band: 'band_kirara' },
};

export function loadGame(name, root = new URL('../', import.meta.url).pathname) {
  const G = GAMES[name];
  const rows = loadSegment(root + G.file, G.first, G.last);
  return { name, ...G, ...ALIGN[name], rows, rounds: roundsOf(rows) };
}

// Bans: a match bans `core` + `addon` bonds; a chess is out of the pool when ALL its bonds are banned. A bond is surely
// live when the record shows it counted on the board (bonds field) or shows a chess whose every bond would otherwise
// be banned. The bans are drawn greedily (deterministic order) among the other bonds so that no recorded chess ends
// up banned; any shortfall is reported.
export function alignBans(m, game) {
  const gd = m.gd, live = new Set(), chessSeen = new Set();
  for (const r of game.rows) {
    for (const s of r.bonds || []) { const [id, rest] = s.split(':'); if (Number(rest.split('/')[0]) > 0) live.add(id); }
    for (const id of [...r.board.map(b => b.id), ...r.hand, ...r.shop.map(s => s.id)]) if (!id.startsWith('chess_item')) chessSeen.add(gd.baseIdOf(engineId(id)));
  }
  const staticOff = new Set(m.staticInactiveBonds);
  const { core: nCore, addon: nAddon } = gd.bans(gd.difficulty);
  const eligible = gd.bondIds.filter(b => { const x = gd.bond(b); return x && Number(x.weight) > 0 && !gd.modeInactiveBonds.has(b); }).sort();
  const D = new Set();
  const ok = (cand) => [...chessSeen].every(base => { const bs = gd.chess(base)?.bonds || []; return !(bs.length && bs.every(b => cand.has(b) || staticOff.has(b))); });
  for (const [want, isCore] of [[nCore, true], [nAddon, false]]) {
    let n = 0;
    for (const b of eligible) {
      if (n >= want || live.has(b) || !!gd.bond(b).isCore !== isCore) continue;
      const cand = new Set([...D, b]);
      if (ok(cand)) { D.add(b); n++; }
    }
  }
  const drawn = [...D].sort();
  const off = new Set([...drawn, ...staticOff]);
  const banned = [];
  for (const id of gd.visibleChess) { const bs = gd.chess(id).bonds || []; if (bs.length && bs.every(b => off.has(b))) banned.push(id); }
  m.disabledBonds = drawn; m.bannedChess = banned;
  m.pool = new SharedPool(gd, { banned });
  return { drawn, live: [...live].sort(), want: nCore + nAddon, short: nCore + nAddon - drawn.length, bannedChess: banned.length };
}

export function alignedMatch(game, { seed = 1, players = 4 } = {}) {
  const m = makeMatch(seed, players);
  m.alignBans = alignBans(m, game);
  m.stageId = game.stage; m.stage = m.gd.stage(game.stage); m.bossId = game.boss;
  const bt = m.bandTaken.bind(m); m.bandTaken = (b, pid) => (b === game.band && pid !== 'p0') ? true : bt(b, pid);
  const ab = m._applyBand.bind(m); m._applyBand = (ps, id, o) => ab(ps, ps.playerId === 'p0' ? game.band : id, o);
  return m;
}


function waveFor(m, cand) {
  return W.buildNormalWave(m.gd, createRng(1), cand.factions, m.round);
}

export async function replayGame(name, { log = console.log, prior = 400, maxCands = 24, captureEach = null, mirrorTeam = false } = {}) {
  const game = loadGame(name);
  const m = alignedMatch(game);
  const sb = m.scheduleBotPrep;
  m.scheduleBotPrep = function (ps, i) {
    if (ps.playerId !== 'p0') return sb.call(this, ps, i);
    const round = this.round;
    this.later(0, () => { if (this.phase === 'PREP' && this.round === round && ps.alive && !ps.ready) this._awaitOwner = ps; });
  };
  m.start();
  const out = { game: name, seed: m.seed, bans: m.alignBans, stage: m.stageId, boss: m.bossId, hiddenBoss: m.hiddenBossId, standIns: STAND_INS, rounds: [] };
  for (const R of game.rounds) {
    m.sched.runUntil(() => m._awaitOwner || m.phase === 'RESULT', { maxSteps: 5e6 });
    if (m.phase === 'RESULT') { out.rounds.push({ round: R.round, error: 'engine match ended early' }); break; }
    const ps = m._awaitOwner; m._awaitOwner = null;
    if (m.round !== R.round) throw Error(`round drift: engine R${m.round}, record R${R.round}`);
    // teammates first (their preps are queued callbacks): run until every other alive seat is ready
    m.sched.runUntil(() => m.alivePlayers().every(p => p === ps || p.ready) || m.phase !== 'PREP', { maxSteps: 5e6 });
    const row = { round: R.round, gaps: R.gaps, lines: [R.start?.line, R.end?.line], engineBefore: { lp: ps.lp, funds: ps.funds, level: ps.shop.level } };
    row.lpCarried = { engine: ps.lp, record: R.lpBefore, match: ps.lp === R.lpBefore };
    const f = forceSeat(m, ps, R.start);
    if (captureEach) captureEach(R.round, capture(m), 'start');
    if (row.engineBefore.level !== R.start.level) ps.shop.upgradePrice = m.gd.upgradeBase(R.start.level) ?? 0;
    row.forceStart = { notes: f.notes, bondFix: f.bondFix, upgradePrice: ps.shop.upgradePrice };
    const turn = deriveTurn(m.gd, R.start, R.end);
    const rep = replayTurn(m, ps, R.start, R.end, turn);
    const lay = replayLayout(ps, R.end);
    row.turn = { derived: turn, log: rep.log, refused: [...rep.refused, ...lay], funds: { start: rep.fundsStart, afterShopActions: rep.fundsAfterKnown, left: rep.fundsLeft } };
    const pre = diffSeat(ps, R.end);
    row.diffAfterReplay = pre;
    const fe = forceSeat(m, ps, R.end, { shop: false, funds: false });
    ps.funds = 0;
    row.forceEnd = { notes: fe.notes, bondFix: fe.bondFix, diff: diffSeat(ps, R.end) };
    row.bounties = ps.bounties.map(b => b.card?.id || b.id);
    row.effects = ps.effects.map(e => e.name || e.id);
    const isBoss = R.round >= m.gd.bossRound;
    // BOSS rounds: 4 seats share one pool and one team LP, and the record holds nothing about the teammates (nor which
    // hidden leader came in R15). Like the enemy pick of a normal round, these unknowns are ALIGNED: teammate stand-ins
    // (k of them field the owner's own battle board, the rest stay engine bots) × the hidden leader are tried in order
    // (strongest team first, hidden leaders by weight) and the first configuration whose settle LP equals the record is
    // kept; every tried configuration is reported.
    // cfg = { seats: n teammates in the fight, mirrored: k of them field the owner's board }: alive engine bots keep
    // their own boards for the n − k non-mirrored seats; seats beyond the alive ones are eliminated seats brought back
    // as mirrors (the record does not say how many teammates were still alive)
    const mirrorInto = (mm, cfg) => {
      const alive = mm.alivePlayers().filter(p => p.playerId !== 'p0'), dead = mm.order.filter(p => p.playerId !== 'p0' && !p.alive && !p.left);
      const revive = Math.max(0, cfg.seats - alive.length);
      for (const p of dead.slice(0, revive)) { p.alive = true; p.eliminatedRound = null; }
      if (revive) { mm.bossPairs = null; mm.bossWaves = null; }
      const mates = [...dead.slice(0, revive), ...alive];
      for (const tm of mates.slice(0, cfg.mirrored)) { forceSeat(mm, tm, R.end, { shop: false, funds: false }); tm.lp = R.lpBefore; tm.ready = true; }
      for (const tm of mates.slice(cfg.seats)) { tm.alive = false; }   // fewer seats than alive bots: not used (never chosen below)
      // R15 continues the R14 team LP; the owner's recorded LP is forced, so the team pool is re-opened from the seats'
      // LP (otherwise an R14 the engine could not align would leak into R15 and fake a match there)
      if (R.round === mm.gd.hiddenRound) { for (const p of mm.alivePlayers()) p.lpAtFinal = p.lp; mm.teamLp = mm.alivePlayers().reduce((a, p) => a + p.lp, 0); }
      // the record reached the Hidden Core, so the real team's activated layers passed the co-op threshold
      if (R.round === mm.gd.bossRound && game.rounds.some(x => x.round === mm.gd.hiddenRound)) {
        const thr = mm.gd.hiddenCore.multi, sum = mm.alivePlayers().reduce((a, p) => a + p.activatedLayers(), 0);
        if (sum <= thr) {
          const tm = mm.alivePlayers().find(p => p.playerId !== 'p0'), top = tm && Object.entries(tm.bonds).filter(([, b]) => b.active).sort((a, b) => (b[1].layers || 0) - (a[1].layers || 0))[0];
          if (top) { tm.layers[top[0]] = (tm.layers[top[0]] || 0) + (thr + 1 - sum); tm.recompute(); }
          return { threshold: thr, teamLayers: sum, addedTo: top?.[0], added: thr + 1 - sum };
        }
      }
      return null;
    };
    let bossCfg = null, seedOverrideBoss = null;
    if (isBoss && mirrorTeam && m.phase === 'PREP') {
      const st0 = capture(m), hiddenR = R.round === m.gd.hiddenRound;
      const aliveMates = m.alivePlayers().length - 1, seatsMax = m.order.length - 1;
      const hiddens = hiddenR ? Object.entries(m.gd.mode.hiddenBossWeights || {}).sort((a, b) => b[1] - a[1]).map(([id]) => id) : [null];
      // fewest changes first: the alive teammates as they are, then eliminated seats brought back; within a size, the
      // strongest (most mirrored) team first. A bot seat must be an alive bot.
      const cfgs = [];
      for (let n = Math.max(1, aliveMates); n <= seatsMax; n++) for (let k = n; k >= Math.max(0, n - aliveMates); k--) cfgs.push({ seats: n, mirrored: k });
      const tried = [];
      // the fight's own random stream is unknown too: the match seed's battle streams, then 24 variants
      const seeds = [null, ...Array.from({ length: 24 }, (_, i) => (m.seed + 104729 * (i + 1)) >>> 0)];
      outer: for (const seed of seeds) for (const cfg of cfgs) for (const h of hiddens) {
        const mm = restore(st0, { rngMode: 'exact' });
        for (const [i, p] of mm.order.entries()) if (st0.seats[i].ready) p.ready = true;
        mirrorInto(mm, cfg);
        if (h && h !== mm.hiddenBossId) { mm.hiddenBossId = h; mm.bossWaves = null; }   // the R15 field was planned at round start
        if (seed != null) mm.seed = seed;
        const p0 = mm.players.get('p0'); p0.resolveTemp(); p0.ready = false; p0.setReady(true);
        const r0 = mm.round;
        mm.sched.runUntil(() => (mm.round > r0 && mm.phase !== 'SETTLE') || mm.phase === 'RESULT', { maxSteps: 5e7 });
        const t = { ...cfg, hidden: h, seed, lp: p0.lp, reachedNext: mm.round > r0, result: mm.phase === 'RESULT' ? { victory: !!mm.lastResultMsg?.victory, hiddenCleared: !!mm.lastResultMsg?.hiddenCleared } : null };
        mm.dispose(); tried.push(t);
        const nextNeeded = game.rounds.some(x => x.round === r0 + 1);
        if (t.lp === R.lpAfter && (!nextNeeded || t.reachedNext)) { bossCfg = t; break outer; }
      }
      row.bossAlign = { tried, chosen: bossCfg };
    }
    if (isBoss && mirrorTeam) {
      const cfg = bossCfg || { seats: Math.max(1, m.alivePlayers().length - 1), mirrored: Math.max(1, m.alivePlayers().length - 1) };
      const hs = mirrorInto(m, cfg);
      if (hs) row.hiddenStandIn = hs;
      if (bossCfg?.hidden && bossCfg.hidden !== m.hiddenBossId) { m.hiddenBossId = bossCfg.hidden; m.bossWaves = null; }
      if (bossCfg?.seed != null) seedOverrideBoss = bossCfg.seed;
    }
    if (isBoss && m.phase === 'PREP') {
      const st = capture(m), hidden = R.round === m.gd.hiddenRound;
      const bosses = hidden ? Object.keys(m.gd.mode.hiddenBossWeights || {}) : [m.bossId];
      row.ownerBoss = bosses.map(bossId => { const mm = restore(st, { rngMode: 'exact' }); const r = ownerBossFight(mm, mm.players.get('p0'), { bossId, hidden }); mm.dispose(); return r; });
    }
    if (captureEach && m.phase === 'PREP') captureEach(R.round, capture(m), 'end');
    let seedOverride = null;
    if (!isBoss && m.phase === 'PREP') {
      const state = capture(m);
      const all = pickPrior(m.gd, R.round, prior);
      const tested = [];
      const test = (c, seed = null) => { const o = roundOutcome(state, null, { wave: waveFor(m, c), battleSeed: seed }); const t = { pick: c.pick, w: c.w, seed, cand: c, ...o }; tested.push(t); return t; };
      // the prior's distribution of the owner's LP change (top picks), then the first pick that reproduces the record
      for (const c of all.slice(0, maxCands)) test(c);
      let hit = tested.find(t => t.lp === R.lpAfter);
      for (const c of all.slice(maxCands)) { if (hit) break; const t = test(c); if (t.lp === R.lpAfter) hit = t; }
      // still none: the battle's own random stream (deriveSeed(match seed, round, seat)) is unknown too — vary it
      for (let k = 1; !hit && k <= 12; k++) for (const c of all.slice(0, 6)) { const t = test(c, (m.seed + 7919 * k) >>> 0); if (t.lp === R.lpAfter) { hit = t; break; } }
      const top = tested.slice(0, Math.min(maxCands, all.length));
      row.wave = { priorPicks: all.length, testedPicks: tested.length, priorCovered: +top.reduce((a, t) => a + t.w, 0).toFixed(3),
        matchingPriorMass: +top.filter(t => t.lp === R.lpAfter && t.seed == null).reduce((a, t) => a + t.w, 0).toFixed(3),
        lpDist: top.reduce((o, t) => { const k = t.lp - R.lpBefore; o[k] = +((o[k] || 0) + t.w).toFixed(3); return o; }, {}),
        chosen: hit ? { pick: hit.pick, w: hit.w, rank: all.indexOf(hit.cand) + 1, battleSeedVaried: hit.seed != null } : null, forced: !!hit };
      const chosen = hit ? hit.cand : all[0];
      if (chosen) m.wave = waveFor(m, chosen);
      if (hit?.seed != null) seedOverride = hit.seed;
    }
    const seed0 = m.seed;
    if (seedOverride != null) m.seed = seedOverride;
    if (seedOverrideBoss != null) m.seed = seedOverrideBoss;
    ps.resolveTemp();
    const rd = ps.setReady(true);
    if (!rd.ok) row.readyRefused = rd;
    // run to the next round's start (or the end) and read the settle LP
    const r0 = m.round;
    let res = null;
    m.sched.runUntil(() => { if (m.lastResults?.get?.('p0')) res = m.lastResults.get('p0'); return (m.round > r0 && m.phase !== 'SETTLE') || m.phase === 'RESULT'; }, { maxSteps: 5e6 });
    m.seed = seed0;
    row.settle = { engineLp: ps.lp, recordLp: R.lpAfter, match: ps.lp === R.lpAfter, leaks: res?.leaked?.length ?? null, layerGains: res?.layerGains || null,
      recordLayersNext: null, bossDamage: isBoss ? (m.bossPool ? { max: m.bossPool.maxHp, hp: m.bossPool.hp, byPlayer: m.bossPool.byPlayer ? Object.fromEntries(Object.entries(m.bossPool.byPlayer)) : null } : null) : undefined };
    out.rounds.push(row);
    log(`R${R.round} lp ${R.lpBefore}→${R.lpAfter} engine ${ps.lp} ${row.settle.match ? 'OK' : 'MISMATCH'}${row.bossAlign ? ` boss-align ${row.bossAlign.chosen ? `teammates ${row.bossAlign.chosen.seats} mirrored ${row.bossAlign.chosen.mirrored}${row.bossAlign.chosen.seed != null ? ' battle-seed varied' : ''}${row.bossAlign.chosen.hidden ? ' hidden ' + row.bossAlign.chosen.hidden : ''}` : 'none'} (${row.bossAlign.tried.length} tried)` : ''}${row.wave ? ` wave prior-mass-agreeing ${row.wave.matchingPriorMass} chosen-rank ${row.wave.chosen?.rank ?? '-'}${row.wave.chosen?.battleSeedVaried ? ' (battle seed varied)' : ''} tested ${row.wave.testedPicks}` : ''} refused ${row.turn.refused.length} diffAfterReplay ${pre.length}`);
  }
  out.result = m.lastResultMsg ? { victory: m.lastResultMsg.victory, reason: m.lastResultMsg.reason, hiddenReached: m.lastResultMsg.hiddenReached, hiddenCleared: m.lastResultMsg.hiddenCleared, teamLp: m.lastResultMsg.teamLp } : { phase: m.phase, round: m.round };
  m.dispose();
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { writeFileSync } = await import('node:fs');
  const name = process.argv[2] || 'game1', outFile = process.argv[3];
  const t = performance.now();
  const posDir = process.argv[4];
  const { mkdirSync } = await import('node:fs');
  const { toJSON } = await import('../advisor/state.mjs');
  if (posDir) mkdirSync(posDir, { recursive: true });
  const r = await replayGame(name, { prior: +(process.argv[5] || 400), maxCands: +(process.argv[6] || 24), mirrorTeam: process.argv[7] === 'mirror',
    captureEach: posDir ? (round, st, tag) => writeFileSync(`${posDir}/${name}-r${String(round).padStart(2, '0')}-${tag}.json`, toJSON(st)) : null });
  r.ms = Math.round(performance.now() - t);
  if (outFile) writeFileSync(outFile, JSON.stringify(r, null, 1));
  console.log(JSON.stringify(r.result), 'ms', r.ms);
}
