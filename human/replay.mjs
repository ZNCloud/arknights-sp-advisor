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
import { ownerBossFight } from './battle.mjs';

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

// The engine's prior over round r's enemy pick: N setups → distinct picks with their frequency.
export function pickPrior(gd, r, n = 400) {
  const byKey = new Map();
  for (let k = 1; k <= n; k++) {
    const setup = W.setupMatchWaves(gd, createRng(deriveSeed(k, 'prior-setup')));
    const p = setup.picks[r];
    if (!p) continue;
    const key = JSON.stringify([p.type, p.key, p.normal, p.elite]);
    const e = byKey.get(key) || { key, pick: p, factions: setup.factions, n: 0 };
    e.n++; byKey.set(key, e);
  }
  return [...byKey.values()].sort((a, b) => b.n - a.n).map(e => ({ ...e, w: e.n / n }));
}

function waveFor(m, cand) {
  return W.buildNormalWave(m.gd, createRng(1), cand.factions, m.round);
}

// From a PREP capture with the owner's battle board in place: the owner's settle LP and own-field result under `wave`.
function battleOutcome(state, wave, seed = null) {
  const m = restore(state, { rngMode: 'exact' });
  if (wave) m.wave = wave;
  if (seed != null) m.seed = seed;
  const ps = m.players.get('p0');
  // restore() un-readies every seat; the teammates were ready when the state was captured
  for (const [i, p] of m.order.entries()) if (p !== ps && state.seats[i].ready) p.ready = true;
  ps.resolveTemp(); ps.setReady(true);
  const r0 = m.round;
  let res = null;
  m.sched.runUntil(() => { if (m.lastResults?.get?.('p0')) res = m.lastResults.get('p0'); return (m.round > r0 && m.phase !== 'SETTLE') || m.phase === 'RESULT'; }, { maxSteps: 5e6 });
  if (m.round === r0 && m.phase !== 'RESULT') throw Error(`battleOutcome: stuck in R${r0} ${m.phase}`);
  const out = { lp: ps.lp, alive: ps.alive, leaks: res?.leaked?.length ?? res?.leaks ?? null, layerGains: res?.layerGains || null, unite: !!m.unitePlan };
  m.dispose();
  return out;
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
    if (isBoss && mirrorTeam) {
      // teammate stand-in: every alive teammate fields the owner's battle board (the record holds nothing about them)
      for (const tm of m.alivePlayers()) if (tm !== ps) { forceSeat(m, tm, R.end, { shop: false, funds: false }); tm.lp = R.lpBefore; tm.ready = true; }
      // the record reached the Hidden Core, so the real team's activated layers passed the co-op threshold; the stand-in
      // teammates get exactly the missing layers on their strongest active bond (reported)
      if (R.round === m.gd.bossRound && game.rounds.some(x => x.round === m.gd.hiddenRound)) {
        const thr = m.gd.hiddenCore.multi, sum = m.alivePlayers().reduce((a, p) => a + p.activatedLayers(), 0);
        if (sum <= thr) {
          const tm = m.alivePlayers().find(p => p !== ps), top = Object.entries(tm.bonds).filter(([, b]) => b.active).sort((a, b) => (b[1].layers || 0) - (a[1].layers || 0))[0];
          if (top) { tm.layers[top[0]] = (tm.layers[top[0]] || 0) + (thr + 1 - sum); tm.recompute(); }
          row.hiddenStandIn = { threshold: thr, teamLayersMirrored: sum, addedTo: top?.[0], added: thr + 1 - sum };
        }
      }
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
      const test = (c, seed = null) => { const o = battleOutcome(state, waveFor(m, c), seed); const t = { pick: c.pick, w: c.w, seed, cand: c, ...o }; tested.push(t); return t; };
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
    log(`R${R.round} lp ${R.lpBefore}→${R.lpAfter} engine ${ps.lp} ${row.settle.match ? 'OK' : 'MISMATCH'}${row.wave ? ` wave prior-mass-agreeing ${row.wave.matchingPriorMass} chosen-rank ${row.wave.chosen?.rank ?? '-'}${row.wave.chosen?.battleSeedVaried ? ' (battle seed varied)' : ''} tested ${row.wave.testedPicks}` : ''} refused ${row.turn.refused.length} diffAfterReplay ${pre.length}`);
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
