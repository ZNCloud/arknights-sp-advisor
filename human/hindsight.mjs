// 事后诸葛亮 rollouts (task sphind_2254 M3 step 2). One rollout: restore the forced START of recorded round r, play one
// candidate turn for the owner seat, continue every later prep with the owner-shadow (teammates: engine bots), stop at
// the R14 prep and measure the owner's own board: LP entering R14, Σ activated layers, the solo boss fight against the
// R14 leader and against each hidden leader (R15 measured with the R14 board).
//   mode 'A' (信息公平): the future is drawn fresh — the enemy schedule of later rounds, shops, refreshes, 机变 cards.
//   mode 'B' (已知未来): later rounds open with the recorded opening shop (cards above the seat's level re-rolled) and the
//     enemy pick the replay aligned for that round; refreshes / 机变 stay random (the record cannot show them).
import { readFileSync } from 'node:fs';
import { createRng, deriveSeed } from '../eval/engine.mjs';
import { restore, fromJSON, capture } from '../advisor/state.mjs';
import { loadGame } from './replay.mjs';
import { setShop, forceSeat, engineId, diffSeat } from './force.mjs';
import { deriveTurn, replayTurn, replayLayout } from './ownerturn.mjs';
import { installShadow, shadowTurn, planOf } from './shadow.mjs';
import { CANDIDATES } from './candidates.mjs';
import { ownerBossFight } from './battle.mjs';
const W = await import(new URL('../../engine/server/match/waves.js', import.meta.url));

const games = new Map(), replays = new Map();
const FIGHTS = +(process.env.SP_FIGHTS || 4), TRACE = process.env.SP_TRACE === '1';
export function gameOf(name) { if (!games.has(name)) games.set(name, loadGame(name)); return games.get(name); }
export function replayOf(path) { if (!replays.has(path)) replays.set(path, JSON.parse(readFileSync(path, 'utf8'))); return replays.get(path); }
export function budgetsOf(rep) { const o = {}; for (const r of rep.rounds) if (r.turn) o[r.round] = Math.max(0, r.turn.funds.left); return o; }

function pinnedFactions(m, rep) {
  const base = m.factions;
  const picks = [...(base.schedule?.picks || [])];
  for (const r of rep.rounds) if (r.wave?.chosen?.pick) picks[r.round] = r.wave.chosen.pick;
  const f = [...base];
  Object.defineProperty(f, 'schedule', { value: Object.freeze({ typeSlots: base.schedule?.typeSlots || [], picks }), enumerable: false });
  return f;
}

// The owner seat's shop rolls (round start, refresh) draw from a stream of their own: a deviation that refreshes more or
// less must not reshuffle the teammates' shops (they share m.rngShop), which would change the future for reasons that
// have nothing to do with the decision under test.
function ownShopStream(m, ps, rng) {
  for (const k of ['_rollChessSlot', '_rollItemSlot']) {
    const orig = ps[k];
    Object.defineProperty(ps, k, { enumerable: false, configurable: true, writable: true,
      value: function (...a) { const g = m.rngShop; m.rngShop = rng; try { return orig.apply(this, a); } finally { m.rngShop = g; } } });
  }
}

// Same cards (board + hand, tiles, items) and level as a recorded row — LP and funds are not compared.
function sameAsRecord(ps, row) {
  const key = (id, at, dir, items) => `${engineId(id)}@${at}:${dir || 'RIGHT'}[${items.sort().join('+')}]`;
  const eng = [...ps.board].filter(([, p]) => p.kind === 'chess').map(([k, p]) => key(p.id, k, p.dir, (p.items || []).map(i => i.id))).sort().join('|');
  const rec = (row.board || []).map(b => key(b.id, b.at?.join(','), b.dir, (b.items || []).map(i => i.id))).sort().join('|');
  const hand = [...ps.hand, ...ps.temp].filter(p => p && p.kind !== 'token').map(p => p.id).sort().join('|');
  return eng === rec && hand === (row.hand || []).map(engineId).sort().join('|') && ps.shop.level === row.level;
}

// The owner's recorded round t on the current state. Not deviated (the `owner` line) → exactly the recorded battle
// board (what the replay showed the engine accepts). Deviated → the recorded change from the previous battle board to
// this one (the owner's buys / sells / finds, the gains between rounds — 机变, band, rewards —, equips and tiles)
// replayed through the handlers; upgrades only up to the recorded level.
export function ownerDelta(m, ps, Rt, prevEnd, deviated) {
  if (!deviated) { forceSeat(m, ps, Rt.end, { shop: false, funds: false, lp: false }); ps.funds = 0; return; }
  const from = { ...(prevEnd || Rt.start), shop: Rt.start.shop, level: Rt.start.level };
  const t = deriveTurn(ps.gd, from, Rt.end);
  t.levelUps = Math.max(0, Rt.end.level - ps.shop.level);
  replayTurn(m, ps, from, Rt.end, t);
  replayLayout(ps, Rt.end);
  standInBonus(ps);
}
// The client operator the engine lacks (4_27: 不屈 / 阿戈尔 / 迅捷) fields as 歌蕾蒂娅 (阿戈尔): its two missing bonds are
// counted through the engine's own count bonus while it stands on the board.
function standInBonus(ps) {
  const n = [...ps.board.values()].filter(p => p.kind === 'chess' && p.recId && /chess_char_4_27_/.test(p.recId)).length;
  ps.bondCountBonus = n ? { indomShip: n, swiftShip: n } : {};
  ps.recompute();
}

// R15 without fighting R14 in the engine (the team result there depends on teammates the record does not show): the
// owner seat gets the recorded R15 opening funds and shop (B) or a fresh roll (A) and plays the R15 prep.
function pseudoHiddenPrep(m, ps, game, mode, cont) {
  const R15 = game.rounds.find(x => x.round === m.gd.hiddenRound);
  if (!R15?.start) return false;
  ps.ready = false;
  ps.funds = R15.start.funds;
  if (mode === 'B') setShop(ps, R15.start); else ps.rollShop();
  cont(m, ps, m.gd.hiddenRound);
  return true;
}

// The owner's own board at the boss prep: LP loss so far, layers, solo fights against the R14 leader and (after the R15
// prep, `toHidden`) each hidden leader.
function evalFinal(m, ps, seed, toHidden) {
  // each solo fight is random (crits, targeting): FIGHTS seeds per board, averaged
  const run = (st, bossId, hidden, round) => {
    const fs = [];
    for (let k = 0; k < FIGHTS; k++) { const mm = restore(st, { rngMode: 'exact' }); try { fs.push(ownerBossFight(mm, mm.players.get(ps.playerId), { bossId, hidden, round, seed: seed * 10 + k })); } finally { mm.dispose(); } }
    const avg = f => +(fs.reduce((a, x) => a + f(x), 0) / fs.length).toFixed(3);
    const tt = fs.map(x => x.timeToShareGs).filter(x => x != null);
    return { bossId, share: fs[0].share, shareAtCountdown: avg(x => x.shareAtCountdown), shareAtOvertime: avg(x => x.shareAtOvertime),
      pClearCountdown: avg(x => x.shareAtCountdown >= 1 ? 1 : 0), pClearOvertime: avg(x => x.shareAtOvertime >= 1 ? 1 : 0),
      timeToShareGs: tt.length ? +(tt.reduce((a, b) => a + b, 0) / tt.length).toFixed(1) : null, leakLp: avg(x => x.leakLp), fights: fs.length };
  };
  const out = { lp: ps.lp, alive: ps.alive, layers: ps.activatedLayers(), level: ps.shop.level };
  out.board14 = [...ps.board.entries()].filter(([, p]) => p.kind === 'chess').map(([k, p]) => `${p.id}@${k}${(p.items || []).length ? '[' + p.items.map(i => i.id).join('+') + ']' : ''}`);
  if (m.round <= m.gd.bossRound) {
    const st = capture(m);
    out.r14 = run(st, m.bossId, false, m.gd.bossRound);
    if (toHidden) toHidden(ps);
  }
  const st15 = capture(m);
  out.r15 = {};
  for (const h of Object.keys(m.gd.mode.hiddenBossWeights || {})) out.r15[h] = run(st15, h, true, m.gd.hiddenRound);
  out.board15 = [...ps.board.entries()].filter(([, p]) => p.kind === 'chess').map(([k, p]) => `${p.id}@${k}${(p.items || []).length ? '[' + p.items.map(i => i.id).join('+') + ']' : ''}`);
  return out;
}

export function runHind({ game: name, replayPath, stateJSON, round, cand, mode, sampleSeed }) {
  const t0 = performance.now();
  const game = gameOf(name), rep = replayOf(replayPath), budgets = budgetsOf(rep);
  const st = fromJSON(stateJSON);
  // B: the one recorded future — the replay's own random streams continue (teammates, 机变 draws, bounties); A: fresh.
  const m = restore(st, mode === 'B' ? { rngMode: 'exact' } : { rngMode: 'resample', sampleSeed });
  for (const [i, p] of m.order.entries()) if (p.playerId !== 'p0' && st.seats[i].ready) p.ready = true;
  // this round's enemies are the aligned ones in both modes (the prep shows them); later rounds: A fresh, B aligned
  const pinned = pinnedFactions(m, rep);
  if (round < m.gd.bossRound && rep.rounds.find(x => x.round === round)?.wave?.chosen) m.wave = W.buildNormalWave(m.gd, createRng(1), pinned, round);
  if (mode === 'A') {
    const fresh = W.setupMatchWaves(m.gd, createRng(deriveSeed(sampleSeed, 'A-waves')));
    m.factions = fresh.factions;
  } else m.factions = pinned;
  const ps = m.players.get('p0');
  ownShopStream(m, ps, createRng(deriveSeed(sampleSeed, 'p0-shop')));
  // LP as a running loss counter: the engine bleeds the owner's real boards more than the real match did (replay
  // report), so a rollout must not end at a death that the real match never came near; the loss is reported instead.
  const LP0 = 1000, lpRec = ps.lp;
  ps.lp = LP0;
  const R = game.rounds.find(x => x.round === round);
  const ctx = { plan: planOf(m.gd, game.rounds, round, budgets), game: name, round };
  let result = null;
  const trace = [];
  // later preps: A → the owner-shadow (fresh shops); B → the owner's own recorded turn of that round replayed on top of
  // the deviated state (same opening shop, same finds, same equips and tiles; upgrades only up to the recorded level)
  const deviated = cand !== 'owner';
  const cont = (mm, p, t) => {
    const Rt = game.rounds.find(x => x.round === t), prev = game.rounds.find(x => x.round === t - 1);
    if (!Rt?.end) return;
    if (mode === 'B') {
      if (TRACE) trace.push({ t, phase: 'start', lp: p.lp, diffStart: diffSeat(p, prev?.end || Rt.start).filter(x => !x.startsWith('lp')) });
      ownerDelta(mm, p, Rt, prev?.end, deviated);
      // a deviated line may now lack copies the owner had: it keeps the owner's own cash use (the owner's refresh money
      // went into the finds it just received) and may spend only what it saved beyond that on topping up the plan
      if (deviated) {
        const spare = p.funds - (budgets[t] || 0);
        if (spare > 0) { const keep = p.funds; p.funds = spare; shadowTurn(mm, p, { ...planOf(mm.gd, game.rounds, t, budgets), budget: spare }); p.funds = Math.max(0, keep - (spare - p.funds)); }
      }
    }
    else shadowTurn(mm, p, planOf(mm.gd, game.rounds, t, budgets));
    if (TRACE) trace.push({ t, phase: 'end', funds: p.funds, diffEnd: diffSeat(p, Rt.end).filter(x => !x.startsWith('lp')) });
  };
  installShadow(m, game.rounds, budgets, { from: round + 1, onPrep: (mm, p) => {
    const Rt = game.rounds.find(x => x.round === mm.round);
    if (mode === 'B' && Rt?.start) {
      setShop(p, Rt.start); p.funds = Rt.start.funds;
      p.shop.slots = p.shop.slots.map(s => (s && s.kind === 'chess' && p.gd.tierOf(s.id) > p.shop.level) ? p._rollChessSlot() : s);
    }
    if (mm.round >= mm.gd.bossRound) {
      cont(mm, p, mm.round);
      result = evalFinal(mm, p, sampleSeed, (q) => pseudoHiddenPrep(mm, q, game, mode, cont));
      return 'stop';
    }
    cont(mm, p, mm.round);
    p.resolveTemp(); p.setReady(true);
    return 'stop';
  } });
  CANDIDATES[cand].apply(m, ps, R, ctx);
  if (round === m.gd.bossRound) result = evalFinal(m, ps, sampleSeed, (q) => pseudoHiddenPrep(m, q, game, mode, cont));
  else if (round >= m.gd.hiddenRound) result = evalFinal(m, ps, sampleSeed, null);
  else m.sched.runUntil(() => result || m.phase === 'RESULT' || !ps.alive, { maxSteps: 5e6 });
  if (!result) result = { lp: ps.alive ? ps.lp : 0, alive: ps.alive, endedIn: `R${m.round} ${m.phase}` };
  if (TRACE) result.trace = trace;
  result.lpLoss = LP0 - result.lp; result.lpStart = lpRec; result.lpEnd = Math.max(0, lpRec - result.lpLoss); delete result.lp;
  const errs = (m.errorCount || 0) + (m.simErrors || 0) + (m.dispatcher?.errors || 0);
  m.dispose();
  return { game: name, round, cand, mode, sampleSeed, ...result, engineErrors: errs, ms: Math.round(performance.now() - t0) };
}
