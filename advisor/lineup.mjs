// Lineup check (换人 / 对调 / 挪位 / 转向) for a seat about to press Ready: from its current board + hand, every
// single-step change is scored by fighting this round's battle on the seat's own field (advisor/field.mjs), the best
// improving change is taken greedily (≤ maxSteps), and the final board is re-scored against the current board on fresh
// battle seeds; it is recommended only when that paired gain clears z standard errors.
//   normal round: the enemies are the round's own wave (the prep preview shows it exactly) → mean LP charge of the
//     seat's own field over battle seeds the player cannot know; ties broken by mean leaks.
//   boss round (R14) / hidden round (R15): the seat's share of one player's boss pool within the countdown (solo boss
//     field), the hidden round averaged over the mode's hidden-boss weights.
// Guard: a change may not lower the tier of a bond that holds layers (layer stacking is a later-round effect the single
// battle does not see).
import { restore } from './state.mjs';
import { layoutOf, applyLayout, legalTiles, waveLoss, bossScore, battleSeedsOf } from './field.mjs';

const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
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

// Score of one layout. `tag` picks the battle seeds (search and re-check never share seeds). Higher `value` is better.
export function scoreLayout(st, layout, { kind, round, hidden, bosses, playerId = 'p0', tag = 'search', seeds = 4 }) {
  const mutate = layout ? (m, ps) => applyLayout(ps, layout) : null;
  if (kind === 'normal') {
    const s = waveLoss(st, mutate, { battleSeeds: battleSeedsOf(`${tag}:${round}`, seeds), playerId });
    return s && { value: -s.loss - s.leaks * 1e-3, loss: s.loss, leaks: s.leaks, samples: s.losses.map(x => -x) };
  }
  const s = bossScore(st, mutate, { bosses, round, hidden, seeds, seedBase: tag === 'search' ? 100 : 5000, playerId });
  if (!s) return null;
  // per-seed weighted share (same seeds for every layout → paired comparisons)
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

// Replay recommended steps on a live seat through the engine's move handler. A refused move or a board that does not end
// as `expect` (when given) throws: the advice is never applied half-way silently.
export function applySteps(ps, steps, expect = null) {
  for (const s of steps) {
    const o = s.op;
    const piece = o.from ? ps.board.get(o.from) : [...ps.hand, ...ps.temp].find(p => p?.kind === 'chess' && p.id === o.id);
    if (!piece || piece.id !== o.id) throw Error(`lineup step "${s.what}": no ${o.id} at ${o.from ?? 'hand'}`);
    const r = ps.move(piece.uid, { area: 'board', row: o.row, col: o.col }, o.dir);
    if (!r?.ok) throw Error(`lineup step "${s.what}" refused by the engine: ${JSON.stringify(r)}`);
  }
  if (expect) {
    const key = L => L.map(x => `${x.uid}@${x.row},${x.col}:${x.dir}`).sort().join('|');
    if (key(layoutOf(ps)) !== key(expect)) throw Error(`lineup steps did not produce the checked board: ${key(layoutOf(ps))} vs ${key(expect)}`);
  }
}

// Bond guard: tiers of the bonds that hold layers, for a layout (null when the engine refuses the layout). Bonds count
// who is deployed (board + hand together are unchanged by any change here), so the result is cached by the deployed set.
function layeredTiers(st, L, playerId, cache = new Map()) {
  const key = L ? L.map(x => x.uid).sort((a, b) => a - b).join(',') : '';
  if (cache.has(key)) return cache.get(key);
  const v = layeredTiersOf(st, L, playerId);
  cache.set(key, v);
  return v;
}
function layeredTiersOf(st, L, playerId) {
  const m = restore(st, { rngMode: 'exact' });
  try {
    const ps = m.players.get(playerId);
    if (L && !applyLayout(ps, L)) return null;
    const o = {};
    for (const [id, b] of Object.entries(ps.bonds || {})) if ((b.layers || 0) > 0) o[id] = b.tier || 0;
    return o;
  } finally { m.dispose(); }
}
const keepsLayeredTiers = (before, after) => after && Object.entries(before).every(([id, t]) => (after[id] || 0) >= t);

const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const se = a => { const mu = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / (a.length - 1) / a.length) : null; };

/**
 * Lineup check. `evalMany(layouts, opts)` scores a batch of layouts (a worker pool in production, inline in tests) and
 * returns scoreLayout results in order. Returns { kind, steps: [...], current, best, gain: { mean, se, n }, recommend }.
 */
export async function checkLineup(st, { playerId = 'p0', evalMany, maxSteps = 3, seeds = null, recheckSeeds = null, z = 2, minGain = null, log = () => {} } = {}) {
  const t0 = performance.now();
  const fk = fieldKind(st, playerId);
  seeds ??= 4;
  recheckSeeds ??= fk.kind === 'normal' ? 24 : 16;
  minGain ??= fk.kind === 'normal' ? 0.5 : 0.03;   // ≥ half an LP / ≥ 3 % of one share
  const m = restore(st, { rngMode: 'exact' }), ps = m.players.get(playerId);
  const pieces = new Map(); for (const p of [...ps.board.values(), ...ps.hand]) if (p?.kind === 'chess') pieces.set(p.uid, p);
  const ctx = { pieces, cap: ps.deployCap, legal: new Map([...pieces].map(([u, p]) => [u, new Set(legalTiles(ps, p).map(t => t.join(',')))])),
    name: u => ps.gd.chess(pieces.get(u)?.id)?.name || String(u) };
  const current = layoutOf(ps);
  m.dispose();
  const opts = { ...fk, playerId, seeds, tag: 'search' };
  const tierCache = new Map(), before = layeredTiers(st, null, playerId, tierCache);
  let [curScore] = await evalMany([current], opts);
  let cur = current, evals = 1;
  const steps = [];
  for (let s = 0; s < maxSteps; s++) {
    if (fk.kind === 'normal' && curScore.loss === 0 && curScore.leaks === 0) break;   // nothing left to save
    const cands = neighbours(ctx, cur).filter(n => keepsLayeredTiers(before, layeredTiers(st, n.L, playerId, tierCache)));
    const scores = await evalMany(cands.map(n => n.L), opts);
    evals += cands.length;
    let best = null;
    cands.forEach((n, i) => { if (scores[i] && (!best || scores[i].value > best.score.value)) best = { ...n, score: scores[i] }; });
    if (!best || best.score.value <= curScore.value + 1e-9) break;
    steps.push({ what: best.what, kind: best.kind, op: best.op, score: best.score });
    log(`step ${s + 1}: ${best.what} ${curScore.value.toFixed(3)} → ${best.score.value.toFixed(3)} (${cands.length} candidates)`);
    cur = best.L; curScore = best.score;
  }
  // independent re-check on fresh seeds: the search's own max-of-noise is not reported as gain
  let gain = null, recheck = null;
  if (steps.length) {
    const ro = { ...opts, seeds: recheckSeeds, tag: 'recheck' };
    const [a, b] = await evalMany([current, cur], ro);
    const d = b.samples.map((x, i) => x - a.samples[i]);
    gain = { mean: mean(d), se: se(d), n: d.length };
    recheck = { current: a, best: b };
  }
  const recommend = !!gain && gain.mean >= minGain && gain.se != null && gain.mean > z * gain.se;
  return { kind: fk.kind, round: fk.round, current, best: cur, steps, gain, recheck, recommend, evals, ms: Math.round(performance.now() - t0),
    names: Object.fromEntries([...pieces].map(([u, p]) => [u, p.id])) };
}

// Batch scorers for checkLineup: inline (tests, single-threaded tools) or on the rollout pool (advisor/worker.mjs 'field').
export const inlineEval = st => async (layouts, opts) => layouts.map(L => scoreLayout(st, L, opts));
export const poolEval = (pool, stateJSON, stateKey) => (layouts, opts) =>
  Promise.all(layouts.map(layout => pool.run({ kind: 'field', stateJSON, stateKey, layout, opts })));
