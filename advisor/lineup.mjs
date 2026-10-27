// Lineup check (换人 / 对调 / 挪位 / 转向) for a seat about to press Ready: from its current board + hand, every
// single-step change is scored by fighting this round's battle on the seat's own field (advisor/field.mjs), the best
// improving change is taken greedily (≤ maxSteps), and the final board is re-scored against the current board on fresh
// battle seeds; it is recommended only when that paired gain clears z standard errors.
//   normal round: the enemies are the round's own wave (the prep preview shows it exactly). Score per battle seed (the
//     fight's random stream, unknown to the player) = − lpWeight(LP left) · LP lost + LAYER_WEIGHT · bond layers the
//     battle earns (settled after the round; who stands on the board decides them, and they compound into the boss
//     rounds). Search: the seat's own field. Re-check: when every teammate has finished its prep, the whole round is
//     played (all fields, 联防, settle) and the team's LP loss is used — leaks a teammate would have covered anyway are
//     not counted as a gain; otherwise the own field again.
//   boss round (R14) / hidden round (R15): the seat's share of one player's boss pool within the countdown (solo boss
//     field), the hidden round averaged over the mode's hidden-boss weights.
// Guard: a change may not lower the tier of a bond that holds layers.
import { restore } from './state.mjs';
import { layoutOf, legalTiles, waveLoss, bossScore, battleSeedsOf, roundOutcome, othersReady } from './field.mjs';

const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
// Normal-round exchange rate between LP and layers. One layer is worth LAYER_WEIGHT LP when LP_REF LP are left; an LP is
// worth more the less of it is left (lpWeight = LP_REF / LP, clamped). Measured on the owner's games (docs/MODEL.md):
// swaps that saved 2–5 LP but cost 4–8 layers per fight ended the game with less boss damage.
const LAYER_WEIGHT = 0.25, LP_REF = 10;
// Board search (searchBoard) score per battle seed, in LP (× lpWeight like the lineup check):
//   − LP lost + Σ_bond layerValue[bond] · layers the fight earns + EFF_WEIGHT · eff / eff₀ − cost
// layerValue[b] = leaks one more layer of b saves per fight (layer-slope table, the same fixed-board injection for every
// bond) × fights left in the match; eff = damage per second of the fight (DPS × time on the field) over the starting
// board's; cost = HOLD_COST per item kept in the hand (a bench slot; gold is spent before the board is searched).
// EFF_WEIGHT: a board twice as effective is worth half an LP this fight — a tie-break where nothing leaks either way.
const EFF_WEIGHT = 0.5, HOLD_COST = 0.25;
export const lpWeight = lp => Math.min(4, Math.max(0.25, LP_REF / Math.max(1, lp)));
const DIR_CN = { RIGHT: '朝右', LEFT: '朝左', UP: '朝上', DOWN: '朝下' };

// What the scorer needs to know about the position (cheap; computed once in the caller).
export function fieldKind(st, playerId = 'p0') {
  const m = restore(st, { rngMode: 'exact' });
  try {
    const gd = m.gd, ps = m.players.get(playerId);
    if (!ps?.alive) throw Error(`seat ${playerId} not alive`);
    if (m.round === gd.bossRound) return { kind: 'boss', round: m.round, hidden: false, bosses: [{ id: m.bossId, w: 1 }] };
    if (m.round === gd.hiddenRound) return { kind: 'boss', round: m.round, hidden: true, bosses: Object.entries(gd.mode.hiddenBossWeights || {}).map(([id, w]) => ({ id, w })) };
    return { kind: 'normal', round: m.round };
  } finally { m.dispose(); }
}

// Score of the board the moves `steps` make from the position's own board (replayed through the engine's move handler,
// so summons, swaps and tile rules are the game's own; null when the engine refuses a move), over battle seeds
// [seedFrom, seedFrom + seeds) of `tag` (search and re-check never share seeds). Higher `value` is better; `samples` are
// per seed, so two boards scored on the same seeds compare pairwise.
// metric 'own' = the seat's own field, 'round' = the whole round (team LP loss; needs every teammate ready).
export function scoreSteps(st, steps, { kind, round, hidden, bosses, playerId = 'p0', tag = 'search', seeds = 4, seedFrom = 0, metric = 'own', layerValue = null, effRef = 0, cost = 0 }) {
  const mutate = steps.length ? (m, ps) => replaySteps(ps, steps).ok : null;
  if (kind === 'normal') {
    const battleSeeds = battleSeedsOf(`${tag}:${round}`, seedFrom + seeds).slice(seedFrom);
    const lp0 = Object.fromEntries(st.seats.map(x => [x.playerId, x.alive ? x.lp : 0])), w = lpWeight(lp0[playerId]);
    if (metric === 'round') {
      const own = [], team = [], layers = [];
      for (const battleSeed of battleSeeds) {
        const o = roundOutcome(st, mutate, { battleSeed, playerId });
        if (!o) return null;
        own.push(lp0[playerId] - o.seatLp[playerId]);
        team.push(Object.keys(lp0).reduce((a, k) => a + lp0[k] - o.seatLp[k], 0));
        layers.push(Object.values(o.layerGains || {}).reduce((a, n) => a + (Number(n) || 0), 0));
      }
      const samples = team.map((x, i) => -w * x + LAYER_WEIGHT * layers[i]);
      return { value: mean(samples), loss: mean(own), teamLoss: mean(team), layers: mean(layers), samples, ownLoss: own, layerSamples: layers };
    }
    const s = waveLoss(st, mutate, { battleSeeds, playerId });
    if (!s) return null;
    if (layerValue) {
      // board search (searchBoard): every bond's layers at their own value, effective DPS, the candidate's cost
      const samples = searchSamples(s, w, { layerValue, effRef, cost });
      return { value: mean(samples) - s.leaks * 1e-3, loss: s.loss, leaks: s.leaks, layers: s.layers, samples, ownLoss: s.losses, layerSamples: s.layerSamples,
        gains: s.gainSamples, eff: mean(s.effSamples), effSamples: s.effSamples, dmgBy: s.dmgBy };
    }
    const samples = s.losses.map((x, i) => -w * x + LAYER_WEIGHT * s.layerSamples[i]);
    return { value: mean(samples) - s.leaks * 1e-3, loss: s.loss, leaks: s.leaks, layers: s.layers, samples, ownLoss: s.losses, layerSamples: s.layerSamples };
  }
  const s = bossScore(st, mutate, { bosses, round, hidden, seeds, seedBase: (tag === 'search' ? 100 : 5000) + seedFrom, playerId });
  if (!s) return null;
  const wsum = bosses.reduce((a, b) => a + b.w, 0);
  const samples = Array.from({ length: seeds }, (_, k) => bosses.reduce((a, b) => a + b.w * s.per[b.id].cds[k], 0) / wsum);
  return { value: s.share, share: s.share, shareOt: s.shareOt, pClear: s.pClear, samples };
}

// Single-step changes of a layout. Each is one engine move (`op`, PlayerState.move: onto an occupied tile = swap, the
// occupant keeps its facing; a hand operator dropped onto an occupied tile sends the occupant to the hand), so the layout
// here is exactly what the move produces. `op.from` names the piece by where it stands before the move (board tile) or
// by its id in the hand, so a step can be replayed on another copy of the position.
export function neighbours(ctx, L) {
  const { pieces, legal, cap, name } = ctx;
  const out = [], occ = new Set(L.map(x => `${x.row},${x.col}`));
  const bench = [...pieces.keys()].filter(u => !L.some(x => x.uid === u));
  const at = x => `${x.row},${x.col}`;
  const op = (x, row, col, dir, fromKey) => ({ uid: x, id: pieces.get(x).id, from: fromKey, row, col, dir });
  L.forEach((x, i) => {
    for (const u of bench) if (legal.get(u).has(at(x))) {
      const N = L.map(y => ({ ...y })); N[i] = { uid: u, row: x.row, col: x.col, dir: x.dir };
      out.push({ L: N, kind: 'swap', op: op(u, x.row, x.col, x.dir, null), what: `换下 ${name(x.uid)}，换上 ${name(u)}（${at(x)}）` });
    }
    for (let j = i + 1; j < L.length; j++) {
      const y = L[j];
      if (!legal.get(x.uid).has(at(y)) || !legal.get(y.uid).has(at(x))) continue;
      const N = L.map(z => ({ ...z })); N[i] = { ...x, row: y.row, col: y.col }; N[j] = { ...y, row: x.row, col: x.col };
      out.push({ L: N, kind: 'exchange', op: op(x.uid, y.row, y.col, x.dir, at(x)), what: `对调 ${name(x.uid)}（${at(x)}）与 ${name(y.uid)}（${at(y)}）` });
    }
    for (const t of legal.get(x.uid)) if (!occ.has(t)) {
      const [row, col] = t.split(',').map(Number), N = L.map(z => ({ ...z })); N[i] = { ...x, row, col };
      out.push({ L: N, kind: 'move', op: op(x.uid, row, col, x.dir, at(x)), what: `${name(x.uid)} 从 ${at(x)} 挪到 ${t}` });
    }
    for (const d of DIRS) if (d !== x.dir) {
      const N = L.map(z => ({ ...z })); N[i] = { ...x, dir: d };
      out.push({ L: N, kind: 'rotate', op: op(x.uid, x.row, x.col, d, at(x)), what: `${name(x.uid)}（${at(x)}）改${DIR_CN[d]}` });
    }
  });
  if (L.length < cap) for (const u of bench) for (const t of legal.get(u)) if (!occ.has(t)) {
    const [row, col] = t.split(',').map(Number);
    for (const d of DIRS) out.push({ L: [...L.map(z => ({ ...z })), { uid: u, row, col, dir: d }], kind: 'add', op: op(u, row, col, d, null), what: `加上 ${name(u)} 到 ${t}（${DIR_CN[d]}）` });
  }
  return out;
}

// Steps through the engine's move handler: { ok } or { ok: false, error } at the first move the engine refuses. A hand
// piece is the exact one the step was made for (uid; copies of one operator can differ in equipment); only a board
// rebuilt elsewhere (the recorded games' hindsight replays, other uids) falls back to the first copy of the same id.
export function replaySteps(ps, steps) {
  for (const s of steps) {
    if (s.op.equip) {   // board search: an item from the hand onto a carrier (equipped items are locked: equip is final)
      const o = s.op, items = [...ps.hand, ...ps.temp].filter(p => p?.kind === 'item');
      const item = items.find(p => p.uid === o.itemUid && p.id === o.itemId) ?? items.find(p => p.id === o.itemId);
      const carrier = o.from ? ps.board.get(o.from) : null;
      if (!item || !carrier || carrier.id !== o.id) return { ok: false, error: `board step "${s.what}": no ${o.itemId} in hand or no ${o.id} at ${o.from}` };
      const r = ps.equip(item.uid, carrier.uid);
      if (!r?.ok) return { ok: false, error: `board step "${s.what}" refused by the engine: ${JSON.stringify(r)}` };
      continue;
    }
    const o = s.op, hand = [...ps.hand, ...ps.temp].filter(p => p?.kind === 'chess');
    const piece = o.from ? ps.board.get(o.from) : (hand.find(p => p.uid === o.uid && p.id === o.id) ?? hand.find(p => p.id === o.id));
    if (!piece || piece.id !== o.id) return { ok: false, error: `lineup step "${s.what}": no ${o.id} at ${o.from ?? 'hand'}` };
    const r = ps.move(piece.uid, { area: 'board', row: o.row, col: o.col }, o.dir);
    if (!r?.ok) return { ok: false, error: `lineup step "${s.what}" refused by the engine: ${JSON.stringify(r)}` };
  }
  return { ok: true };
}
// Play recommended steps on a live seat. A refused move or a board that does not end as `expect` (when given) throws:
// the advice is never applied half-way silently.
export function applySteps(ps, steps, expect = null) {
  const r = replaySteps(ps, steps);
  if (!r.ok) throw Error(r.error);
  if (expect) {
    const key = L => L.map(x => `${x.uid}@${x.row},${x.col}:${x.dir}`).sort().join('|');
    if (key(layoutOf(ps)) !== key(expect)) throw Error(`lineup steps did not produce the checked board: ${key(layoutOf(ps))} vs ${key(expect)}`);
  }
}

// Bond guard: tiers of the bonds that hold layers after `steps` (null when the engine refuses a move). Bonds count who is
// deployed (board + hand together are unchanged by any change here), so the result is cached by the deployed set `L`.
function layeredTiers(st, L, steps, playerId, cache = new Map()) {
  const key = L.map(x => x.uid).sort((a, b) => a - b).join(',');
  if (cache.has(key)) return cache.get(key);
  const v = layeredTiersOf(st, steps, playerId);
  cache.set(key, v);
  return v;
}
function layeredTiersOf(st, steps, playerId) {
  const m = restore(st, { rngMode: 'exact' });
  try {
    const ps = m.players.get(playerId);
    if (!replaySteps(ps, steps).ok) return null;
    const o = {};
    for (const [id, b] of Object.entries(ps.bonds || {})) if ((b.layers || 0) > 0) o[id] = b.tier || 0;
    return o;
  } finally { m.dispose(); }
}
const keepsLayeredTiers = (before, after) => after && Object.entries(before).every(([id, t]) => (after[id] || 0) >= t);

const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const se = a => { const mu = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / (a.length - 1) / a.length) : null; };

/**
 * Lineup check. `evalMany(stepLists, opts)` scores a batch of candidate boards, each given as the moves that make it
 * from the current board (a worker pool in production, inline in tests), and returns scoreSteps results in order. `recheckMetric` (normal rounds): 'auto' = the whole round when every teammate is
 * ready, else the own field; 'own' / 'round' force one (the recorded human games use 'own': their teammates are engine
 * stand-ins). Returns { kind, steps: [...], current, best, gain: { mean, se, n }, recheck, recommend }.
 */
export async function checkLineup(st, { playerId = 'p0', evalMany, maxSteps = 3, seeds = null, screenSeeds = 2, refine = 12, recheckSeeds = null, z = 2, minGain = null, recheckMetric = 'auto', log = () => {} } = {}) {
  const t0 = performance.now();
  const fk = fieldKind(st, playerId);
  seeds ??= 4;
  recheckSeeds ??= fk.kind === 'normal' ? 24 : 16;
  minGain ??= fk.kind === 'normal' ? 0.5 : 0.03;   // ≥ 0.5 score (half an LP at LP_REF left) / ≥ 3 % of one share
  const m = restore(st, { rngMode: 'exact' }), ps = m.players.get(playerId);
  const pieces = new Map(); for (const p of [...ps.board.values(), ...ps.hand]) if (p?.kind === 'chess') pieces.set(p.uid, p);
  const ctx = { pieces, cap: ps.deployCap, legal: new Map([...pieces].map(([u, p]) => [u, new Set(legalTiles(ps, p).map(t => t.join(',')))])),
    name: u => ps.gd.chess(pieces.get(u)?.id)?.name || String(u) };
  const current = layoutOf(ps);
  m.dispose();
  const opts = { ...fk, playerId, seeds, tag: 'search' };
  const steps = [], tierCache = new Map(), before = layeredTiers(st, current, steps, playerId, tierCache);
  let [curScore] = await evalMany([steps], opts);
  let cur = current, evals = 1;
  const bare = () => steps.map(({ what, op }) => ({ what, op }));   // what a worker needs to replay the moves
  const plus = n => [...bare(), { what: n.what, op: n.op }];
  for (let s = 0; s < maxSteps; s++) {
    const cands = neighbours(ctx, cur).filter(n => keepsLayeredTiers(before, layeredTiers(st, n.L, plus(n), playerId, tierCache)));
    // screen every change on the first `screenSeeds` battle seeds, then score the `refine` best on the rest of `seeds`
    const screen = await evalMany(cands.map(plus), { ...opts, seeds: Math.min(screenSeeds, seeds) });
    const top = cands.map((n, i) => ({ ...n, score: screen[i] })).filter(x => x.score).sort((a, b) => b.score.value - a.score.value).slice(0, refine);
    if (seeds > screenSeeds) {
      const more = await evalMany(top.map(plus), { ...opts, seeds: seeds - screenSeeds, seedFrom: screenSeeds });
      top.forEach((x, i) => { x.score = more[i] ? merged(x.score, more[i]) : null; });
    }
    evals += cands.length + (seeds > screenSeeds ? top.length : 0);
    let best = null;
    for (const x of top) if (x.score && (!best || x.score.value > best.score.value)) best = x;
    if (!best || best.score.value <= curScore.value + 1e-9) break;
    steps.push({ what: best.what, kind: best.kind, op: best.op, score: best.score });
    log(`step ${s + 1}: ${best.what} ${curScore.value.toFixed(3)} → ${best.score.value.toFixed(3)} (${cands.length} candidates)`);
    cur = best.L; curScore = best.score;
  }
  // independent re-check on fresh seeds (one job per seed, so it spreads over the pool): the search's own max-of-noise
  // is not reported as gain
  let gain = null, recheck = null, metric = null;
  if (steps.length) {
    metric = fk.kind !== 'normal' ? 'own' : recheckMetric === 'auto' ? (othersReady(st, playerId) ? 'round' : 'own') : recheckMetric;
    const per = await Promise.all(Array.from({ length: recheckSeeds }, (_, k) => evalMany([[], bare()], { ...opts, metric, seeds: 1, seedFrom: k, tag: 'recheck' })));
    const pick = i => ({ samples: per.map(r => r[i].samples[0]), loss: per.map(r => r[i].ownLoss?.[0]), layers: per.map(r => r[i].layerSamples?.[0]),
      teamLoss: per.map(r => r[i].teamLoss) });
    const a = pick(0), b = pick(1);
    const d = b.samples.map((x, i) => x - a.samples[i]);
    gain = { mean: mean(d), se: se(d), n: d.length };
    recheck = { metric, lpWeight: fk.kind === 'normal' ? lpWeight(st.seats.find(x => x.playerId === playerId).lp) : null,
      current: summary(fk.kind, metric, a), best: summary(fk.kind, metric, b) };
  }
  const recommend = !!gain && gain.mean >= minGain && gain.se != null && gain.mean > z * gain.se;
  return { kind: fk.kind, round: fk.round, current, best: cur, steps, gain, recheck, recommend, evals, ms: Math.round(performance.now() - t0),
    names: Object.fromEntries([...pieces].map(([u, p]) => [u, p.id])) };
}

// Two scoreSteps results on disjoint seeds of the same tag → one result over all of them.
function merged(a, b) {
  const n = a.samples.length, k = b.samples.length, w = (x, y) => (x * n + y * k) / (n + k);
  const out = { samples: [...a.samples, ...b.samples] };
  if (a.share != null) return { ...out, value: mean(out.samples), share: mean(out.samples), shareOt: w(a.shareOt, b.shareOt), pClear: w(a.pClear, b.pClear) };
  const leaks = w(a.leaks ?? 0, b.leaks ?? 0);
  return { ...out, value: mean(out.samples) - leaks * 1e-3, loss: w(a.loss, b.loss), leaks, layers: w(a.layers, b.layers),
    ownLoss: [...a.ownLoss, ...b.ownLoss], layerSamples: [...a.layerSamples, ...b.layerSamples] };
}

// Re-check means in the units the advice is read in: LP lost / layers earned (normal) or share (boss).
function summary(kind, metric, { samples, loss, layers, teamLoss }) {
  if (kind !== 'normal') return { share: mean(samples) };
  return { loss: mean(loss), layers: mean(layers), ...(metric === 'round' ? { teamLoss: mean(teamLoss) } : {}) };
}

// One line of plain language for a checkLineup result (CLI, eval logs).
export function describe(res) {
  if (!res.steps.length) return '站位：没找到更好的，照现在的上场。';
  const g = res.gain, c = res.recheck.current, b = res.recheck.best, f = x => x.toFixed(2);
  const what = res.kind !== 'normal' ? `倒计时内打掉自己那份 BOSS 血 ${f(c.share)} → ${f(b.share)} 份，提升 ${g.mean >= 0 ? '+' : ''}${f(g.mean)}±${f(g.se ?? 0)}`
    : `${res.recheck.metric === 'round' ? `整回合（含联防）全队掉血 ${f(c.teamLoss)} → ${f(b.teamLoss)}，自己` : '自己场'}掉血 ${f(c.loss)} → ${f(b.loss)}，`
      + `这一仗拿层 ${f(c.layers)} → ${f(b.layers)}，净收益 ${g.mean >= 0 ? '+' : ''}${f(g.mean)}±${f(g.se ?? 0)} 分（每少掉 1 血 ${f(res.recheck.lpWeight)} 分，每多拿 1 层 ${LAYER_WEIGHT} 分）`;
  return `${res.recommend ? '★ 建议' : '（不建议：复核提升不够显著）'}：${res.steps.map(x => x.what).join('，然后 ')}｜复核 ${g.n} 场新随机：${what}`;
}

// Batch scorers for checkLineup (a list of step lists → scoreSteps results): inline (tests, single-threaded tools) or on
// the rollout pool (advisor/worker.mjs 'field').
export const inlineEval = st => async (stepLists, opts) => stepLists.map(steps => scoreSteps(st, steps, opts));
export const poolEval = (pool, stateJSON, stateKey) => (stepLists, opts) =>
  Promise.all(stepLists.map(steps => pool.run({ kind: 'field', stateJSON, stateKey, steps, opts })));

// The board search's score of each battle seed of a waveLoss result (see EFF_WEIGHT).
function searchSamples(s, w, { layerValue, effRef = 0, cost = 0 }) {
  return s.losses.map((x, i) => -w * x + w * Object.entries(s.gainSamples[i]).reduce((a, [b, n]) => a + (layerValue[b] || 0) * (Number(n) || 0), 0)
    + w * EFF_WEIGHT * (effRef > 0 ? s.effSamples[i] / effRef : 0) - w * cost);
}
// ── Board search (sprluse_1910): who stands where and which item goes to whom, scored by the engine ──────────────────
// One value function for every bond and every item (scoreSteps with layerValue): no bond, operator or item is named.
// The value of a layer: layerValueOf(slopes, round) = slope (leaks saved per fight per layer, the layer-slope table) ×
// the fights left after this one (layers stay for the rest of the match).
export const layerValueOf = (slopes, round, lastRound = 15) =>
  Object.fromEntries(Object.entries(slopes).map(([b, k]) => [b, Math.max(0, k) * Math.max(0, lastRound - round)]));

// Candidates (pruned so a prep stays affordable; the pruning names no bond / operator / item):
//   items  every unequipped piece of equipment in the hand, one after another: the starting fight's 3 top and 2 lowest
//          damage dealers (if the engine lets them carry it), or keep it in the hand (HOLD_COST);
//   places the starting fight's top damage dealer ("main") and its lowest deployed damage dealer ("low") may trade
//          places with any other deployed operator; a benched operator may take the low one's place. So the main only
//          moves over the tiles the board already holds, and the cheap pieces are the ones that move around it.
// Each candidate is screened on `screenSeeds` battle seeds, the `refine` best get the rest of `seeds`; a change is taken
// when it beats the current board (greedy, ≤ maxSteps placement changes). A generator: yields batches of step lists
// for the caller's evaluator (searchBoardSync / searchBoardAsync), so the bot (inline) and the overlay (pool) share it.
export function* boardSearch(st, { playerId = 'p0', slopes, seeds = 2, screenSeeds = 1, refine = 2, maxSteps = 1, keep = 6, carriers: nCarry = [3, 2], lows: nLow = 1, lastRound = 15, trace = null } = {}) {
  const t0 = performance.now();
  const fk = fieldKind(st, playerId);
  if (fk.kind !== 'normal') return { kind: fk.kind, round: fk.round, steps: [], skipped: 'boss round', evals: 0, ms: 0 };
  const m = restore(st, { rngMode: 'exact' }), ps = m.players.get(playerId);
  const pieces = new Map(); for (const p of [...ps.board.values(), ...ps.hand]) if (p?.kind === 'chess') pieces.set(p.uid, p);
  const ctx = { pieces, cap: ps.deployCap, legal: new Map([...pieces].map(([u, p]) => [u, new Set(legalTiles(ps, p).map(t => t.join(',')))])),
    name: u => ps.gd.chess(pieces.get(u)?.id)?.name || String(u) };
  const items = [...ps.hand, ...ps.temp].filter(p => p?.kind === 'item' && ps.gd.item(p.id)?.itemType === 'EQUIP').map(p => ({ uid: p.uid, id: p.id, name: ps.gd.item(p.id)?.name || p.id }));
  const start = layoutOf(ps);
  m.dispose();
  const layerValue = layerValueOf(slopes, fk.round, lastRound);
  const opts = { ...fk, playerId, seeds, tag: 'board', layerValue };
  let evals = 1;
  const [base] = yield [[[], { ...opts }]];
  if (!base) throw Error(`board search R${fk.round}: the starting board does not fight`);
  opts.effRef = base.eff;
  // the starting board in board-search units: its eff/eff₀ term added to the same fights (no second evaluation)
  const w0 = lpWeight(st.seats.find(x => x.playerId === playerId).lp), effTerm = base.effSamples.map(e => w0 * EFF_WEIGHT * (base.eff > 0 ? e / base.eff : 0));
  const cur0 = { ...base, samples: base.samples.map((x, i) => x + effTerm[i]), value: base.value + mean(effTerm) };
  let cur = cur0, L = start;
  const steps = [], decisions = [];
  const at = x => `${x.row},${x.col}`;
  // items first (who carries what changes who deals the damage the placement step reads)
  const byDmg = start.slice().sort((a, b) => (base.dmgBy?.[b.uid] || 0) - (base.dmgBy?.[a.uid] || 0));
  const carrierSet = new Set([...byDmg.slice(0, nCarry[0]), ...byDmg.slice(-nCarry[1])].map(x => x.uid));
  for (const it of items) {
    const carriers = L.filter(x => carrierSet.has(x.uid)).map(x => ({ x, step: { what: `${it.name} 给 ${ctx.name(x.uid)}（${at(x)}）`, kind: 'equip', op: { equip: true, itemUid: it.uid, itemId: it.id, uid: x.uid, id: pieces.get(x.uid).id, from: at(x) } } }));
    const res = yield carriers.map(c => [[...steps, c.step], opts]);
    evals += carriers.length;
    const hold = { value: cur.value - (cur.samples.length ? HOLD_COST * lpWeight(st.seats.find(s => s.playerId === playerId).lp) : 0) };
    let best = null;
    carriers.forEach((c, i) => { if (res[i] && (!best || res[i].value > best.score.value)) best = { ...c, score: res[i] }; });
    const row = { item: it.id, name: it.name, hold: +hold.value.toFixed(3), options: carriers.map((c, i) => [pieces.get(c.x.uid).id, res[i] ? +res[i].value.toFixed(3) : null]) };
    if (trace) trace({ stage: 'item', base: cur, steps, cands: carriers.map((c, i) => ({ step: c.step, value: res[i] ? res[i].value : null })), hold: hold.value });
    if (best && best.score.value > hold.value) { steps.push(best.step); cur = best.score; row.pick = pieces.get(best.x.uid).id; } else row.pick = 'hold';
    decisions.push(row);
  }
  // placement
  let shortlist = new Set();
  for (let s = 0; s < maxSteps; s++) {
    const dmg = u => cur.dmgBy?.[u] || 0;
    const ranked = L.slice().sort((a, b) => dmg(b.uid) - dmg(a.uid));
    const main = ranked[0], lows = ranked.slice(1).slice(-nLow);
    const movers = [main, ...lows].filter(Boolean);
    const cands = [], seen = new Set();
    for (const n of neighbours(ctx, L)) {
      if (n.kind === 'exchange') {
        const a = n.op.uid, b = L.find(z => z.row === n.op.row && z.col === n.op.col)?.uid;
        if (!movers.some(x => x.uid === a || x.uid === b)) continue;
        n.key = [a, b].sort().join('|'); if (seen.has(n.key)) continue; seen.add(n.key);
        cands.push(n);
      } else if (n.kind === 'swap' && lows.some(x => at(x) === `${n.op.row},${n.op.col}`)) { n.key = `${n.op.uid}>${L.find(z => z.row === n.op.row && z.col === n.op.col)?.uid}`; cands.push(n); }
    }
    // a later step only re-checks the changes that screened best in the first one (`keep`), on the new board
    if (s > 0) { const k = cands.filter(n => shortlist.has(n.key)); cands.length = 0; cands.push(...k); }
    const plus = n => [...steps.map(({ what, op }) => ({ what, op })), { what: n.what, op: n.op }];
    if (!cands.length) break;
    const screen = yield cands.map(n => [plus(n), { ...opts, seeds: Math.min(screenSeeds, seeds) }]);
    evals += cands.length;
    if (trace) trace({ stage: `place${s + 1}`, base: cur, steps, cands: cands.map((n, i) => ({ step: { what: n.what, kind: n.kind, op: n.op }, value: screen[i] ? screen[i].value : null })), seeds: Math.min(screenSeeds, seeds) });
    const ranked1 = cands.map((n, i) => ({ ...n, score: screen[i] })).filter(x => x.score).sort((a, b) => b.score.value - a.score.value);
    if (s === 0) shortlist = new Set(ranked1.slice(0, keep).map(x => x.key));
    const top = ranked1.slice(0, refine);
    if (seeds > screenSeeds && top.length) {
      const more = yield top.map(x => [plus(x), { ...opts, seeds: seeds - screenSeeds, seedFrom: screenSeeds }]);
      evals += top.length;
      top.forEach((x, i) => { x.score = more[i] ? merged(x.score, more[i]) : null; });
    }
    let best = null;
    for (const x of top) if (x.score && (!best || x.score.value > best.score.value)) best = x;
    decisions.push({ place: s + 1, cands: cands.length, cur: +cur.value.toFixed(3), best: best ? +best.score.value.toFixed(3) : null, what: best?.what || null });
    if (!best || best.score.value <= cur.value + 1e-9) break;
    steps.push({ what: best.what, kind: best.kind, op: best.op });
    shortlist.delete(best.key);
    cur = { ...best.score, dmgBy: best.score.dmgBy || cur.dmgBy }; L = best.L;
  }
  // sprldef_2055: layoutStart/names so the caller can build the board diagram the same way checkLineup already does
  // (board-diagram.mjs just wants {current, best, names}) — `start` above is the score summary, `layoutStart` is the
  // actual pre-move layout (`start` the local `const`, untouched by the `L = best.L` reassignment in the loop above).
  return { kind: fk.kind, round: fk.round, steps: steps.map(({ what, kind, op }) => ({ what, kind, op })), start: cur0, best: cur, layout: L, decisions, evals,
    ms: Math.round(performance.now() - t0), layoutStart: start, names: Object.fromEntries([...pieces].map(([u, p]) => [u, p.id])) };
}
// Drivers: the bot's prep is synchronous (inline engine), the overlay's is a pool (async).
export function searchBoardSync(st, o = {}) {
  const g = boardSearch(st, o);
  let r = g.next();
  while (!r.done) r = g.next(r.value.map(([steps, opts]) => scoreSteps(st, steps, opts)));
  return r.value;
}
export async function searchBoardAsync(st, evalMany, o = {}) {
  const g = boardSearch(st, o);
  let r = g.next();
  while (!r.done) r = g.next(await Promise.all(r.value.map(([steps, opts]) => evalMany([steps], opts).then(x => x[0]))));
  return r.value;
}
