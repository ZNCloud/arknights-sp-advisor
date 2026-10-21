// Team view: what the advisor knows about the teammates, and who played better.
//
// One schema for live games and self-play. A record row (overlay.mjs recordTurn, matches/*.jsonl) carries the own
// seat's private view plus `mates` = every teammate's PUBLIC state (m.public.players: LP / 调度中心等级 / 上阵人数 /
// 盟约人数与层数 / 状态). The engine recorder (eval/teamplay-worker.mjs) writes the same rows from the engine's own
// publicView(), so the parser, the seat rating and the learner below never see which side a game came from.
// What is NOT public (and therefore never used here, for teammates or for the own seat): funds, hand, shop, pieces,
// tiles. A teammate's board is only visible while the owner scouts it (m.field 'n:<pid>'), see matches/README.md.
//
// Pure module: no engine import (overlay.mjs on the owner's machine imports it too).

/** "sargonShip:3/19" → { bondId, count, layers } */
export const parseBond = (s) => {
  const m = /^(.+?):(\d+)\/(\d+)$/.exec(String(s));
  return m ? { bondId: m[1], count: +m[2], layers: +m[3] } : null;
};
/** the bond with the most layers among those with members (the seat's main stack) */
export const topBond = (bonds) => (bonds || []).filter((b) => b.count > 0).sort((a, b) => b.layers - a.layers)[0] || null;

/**
 * Teammates' public rows from an m.public.players-shaped list (the client's store or the engine's publicView()):
 * everyone but `myId`. overlay.mjs records exactly this; the engine recorder calls it on publicView().players.
 */
export function matesOf(players, myId) {
  return (players || [])
    .filter((p) => !myId || p.playerId !== myId)
    .map((p) => ({
      name: p.name, seat: p.seat ?? null, isBot: !!p.isBot, alive: p.alive !== false,
      lp: p.lp, level: p.shopLevel, board: p.boardCount, status: p.status || null, bandId: p.bandId || null,
      bonds: (p.bonds || []).filter((b) => !b.off).slice(0, 8).map((b) => `${b.bondId}:${b.count}/${b.layers}`),
    }));
}

/**
 * m.result → the per-player part a rating needs (results.js buildResult: every player's lineup, bonds and stats are in
 * the payload the client receives). `bossMax` = the boss pool's max HP (m.public bossHp.max), null when never fought.
 */
export function resultOf(res, bossMax = null) {
  if (!res || !Array.isArray(res.players)) return null;
  return {
    victory: !!res.victory, roundsPassed: res.roundsPassed ?? null, hiddenCleared: !!res.hiddenCleared, reason: res.reason || null,
    bossId: res.bossId || null, bossMax: Number.isFinite(bossMax) ? bossMax : null,
    players: res.players.map((p) => ({
      playerId: p.playerId, seat: p.seat ?? null, name: p.name, isBot: !!p.isBot, alive: !!p.alive,
      roundsPassed: p.roundsPassed ?? null, eliminatedRound: p.eliminatedRound ?? null, lp: p.lp ?? null,
      lineup: (p.lineup || []).map((u) => ({ id: u.id, golden: !!u.golden, at: [u.row, u.col], items: (u.items || []).length })),
      bonds: (p.bonds || []).slice(0, 4).map((b) => `${b.bondId}:${b.count ?? 0}/${b.layers ?? 0}`),
      stats: p.stats ? {
        bossDamage: p.stats.bossDamage ?? 0, dmgDealt: p.stats.dmgDealt ?? 0, kills: p.stats.kills ?? 0, leaks: p.stats.leaks ?? 0,
        lpLost: p.stats.lpLost ?? 0, activatedLayers: p.stats.activatedLayers ?? 0, merges: p.stats.merges ?? 0, gold: p.stats.gold ?? 0,
      } : null,
    })),
  };
}

/** Record rows → one entry per match (a new match starts at INFO_CHECK / round 0). */
export function splitMatches(rows) {
  const out = [];
  let cur = { rows: [] };
  out.push(cur);
  for (const r of rows) {
    if ((r.phase === 'INFO_CHECK' || (r.round === 0 && r.phase !== 'RESULT')) && cur.rows.length) { cur = { rows: [] }; out.push(cur); }
    cur.rows.push(r);
  }
  return out.filter((m) => m.rows.length > 2);
}

/** a public snapshot of one seat in one row */
const snapOf = (p, row) => {
  const bonds = (p.bonds || []).map((b) => (typeof b === 'string' ? parseBond(b) : b)).filter(Boolean);
  const core = topBond(bonds);
  return {
    round: row.round, phase: row.phase, lp: p.lp, level: p.level, board: p.board, alive: p.alive !== false,
    bonds, core: core ? { id: core.bondId, count: core.count, layers: core.layers } : null,
    layers: bonds.reduce((s, b) => s + (b.layers || 0), 0),
  };
};
/** the own seat's public-equivalent snapshot (chess on the board only, like m.public boardCount) */
const selfOf = (r) => ({
  lp: r.lp, level: r.level, alive: (r.lp ?? 1) > 0, bonds: r.bonds || [],
  board: (r.board || []).filter((x) => !String(x.id).startsWith('token_')).length,
});

/**
 * Every seat's public track through one match: per round the end-of-PREP snapshot (`prep`: the round's decisions are
 * made, LP / layers are those its battle starts with) and the round's last snapshot (`end`). The own seat comes from
 * the record itself, the teammates from `mates` (only in records written after the overlay started sampling them).
 * The match's m.result, when the record carries it (`result`), is attached per seat.
 */
export function tracksOf(rows) {
  const by = new Map();
  const keyOf = (p) => `${p.seat ?? 'me'}|${p.name}`;
  const push = (p, row) => {
    const k = keyOf(p);
    if (!by.has(k)) by.set(k, { key: k, name: p.name, seat: p.seat ?? null, isBot: !!p.isBot, self: !!p.self, prep: new Map(), end: new Map() });
    const e = by.get(k), s = snapOf(p, row);
    e.end.set(row.round, s);
    if (row.phase === 'PREP') e.prep.set(row.round, s);
  };
  let result = null, selfSeat = null;
  for (const r of rows) {
    if (r.self && r.self.seat != null) selfSeat = r.self.seat;
    push({ name: '我', seat: null, self: true, ...selfOf(r) }, r);
    for (const mate of r.mates || []) push(mate, r);
    if (r.result) result = r.result;
  }
  const seats = [...by.values()].map((e) => {
    const rounds = [...new Set([...e.end.keys()])].sort((a, b) => a - b);
    const out = { key: e.key, name: e.name, seat: e.self ? selfSeat : e.seat, isBot: e.isBot, self: e.self,
      rounds: rounds.map((r) => ({ round: r, prep: e.prep.get(r) || null, end: e.end.get(r) })), result: null };
    if (result) out.result = result.players.find((p) => (out.seat != null && p.seat === out.seat) || (!e.self && p.name === e.name)) || null;
    return out;
  }).sort((a, b) => (b.self ? 1 : 0) - (a.self ? 1 : 0) || (a.seat ?? 0) - (b.seat ?? 0));
  return { seats, result, hasMates: rows.some((r) => Array.isArray(r.mates) && r.mates.length > 0), lastRound: rows.reduce((m, r) => Math.max(m, r.round || 0), 0) };
}

// ── who played better ────────────────────────────────────────────────────────────────────────────────────────────
//
// Seat outcome O (same shape as the team utility in advisor/rollout.mjs, restricted to the seat):
//   O = 0.5 · min(1, (survived round − 1) / 13) + 0.45 · min(2, boss share) / 2
// survived round = the round the seat was eliminated in, else the match's last round; boss share = the seat's
// bossDamage ÷ (boss pool ÷ seats) — 1 = it cleared its own share, capped at 2 (a carry counts, an outlier does not
// dominate). The team win is shared by every seat still in, so it does not separate players and is left out.
export const SEAT_O = { survival: 0.5, boss: 0.45, shareCap: 2, rounds: 13 };
export function seatOutcome(p, { lastRound, bossMax, seats }) {
  if (!p) return null;
  const surv = !p.alive && p.eliminatedRound != null ? p.eliminatedRound : lastRound;
  const share = bossMax && seats ? (p.stats?.bossDamage || 0) / (bossMax / seats) : 0;
  return SEAT_O.survival * Math.min(1, Math.max(0, surv - 1) / SEAT_O.rounds) + SEAT_O.boss * Math.min(SEAT_O.shareCap, share) / SEAT_O.shareCap;
}

// Public value model V_r(snapshot) ≈ E[seat outcome O | the seat's public state at the end of PREP of round r]:
// a ridge regression per round on PUBLIC_FEATURES, fitted on self-play seats (advisor/learn-team.mjs). It is what
// turns "关键回合的收益" into a number: the gain of round r = V_{r+1} − V_r, the same yardstick for the own seat and a
// teammate because both are read off public data only.
export const PUBLIC_FEATURES = ['lp', 'level', 'board', 'coreLayers', 'coreCount', 'layers', 'bondsWithMembers'];
export function publicFeatures(s) {
  if (!s) return null;
  return [s.lp ?? 0, s.level ?? 0, s.board ?? 0, s.core ? s.core.layers : 0, s.core ? s.core.count : 0, s.layers ?? 0,
    (s.bonds || []).filter((b) => b.count > 0).length];
}
export function valueOf(model, round, s) {
  const m = model && model.rounds[String(Math.min(round, model.maxRound))];
  const x = publicFeatures(s);
  if (!m || !x || !s.alive) return s && !s.alive ? 0 : null;
  let v = m.b;
  for (let i = 0; i < x.length; i++) v += m.w[i] * (x[i] - m.mu[i]) / m.sd[i];
  return v;
}

/**
 * Rate every seat of one match (needs `tracksOf` output with a result for the outcome part):
 *   outcome  O, and dO = O − mean over the table (positive = played better than the teammates);
 *   process  per round r: v = V_r, gain = V_{r+1} − V_r, adv = gain − the table's mean gain that round
 *            (key-round gains: which rounds the seat pulled ahead / fell behind, on public data alone).
 */
export function rateMatch(track, model) {
  const { seats, result } = track;
  const lastRound = result ? Math.max(...seats.map((s) => s.rounds.length ? s.rounds[s.rounds.length - 1].round : 0)) : track.lastRound;
  const n = seats.length;
  const rated = seats.map((s) => {
    const O = result && s.result ? seatOutcome(s.result, { lastRound, bossMax: result.bossMax, seats: n }) : null;
    const vals = new Map(s.rounds.filter((x) => x.prep).map((x) => [x.round, model ? valueOf(model, x.round, x.prep) : null]));
    return { key: s.key, name: s.name, seat: s.seat, self: s.self, isBot: s.isBot, O, vals };
  });
  const withO = rated.filter((r) => r.O != null);
  const meanO = withO.length ? withO.reduce((a, r) => a + r.O, 0) / withO.length : null;
  for (const r of rated) r.dO = r.O != null && meanO != null ? r.O - meanO : null;
  const rounds = [...new Set(rated.flatMap((r) => [...r.vals.keys()]))].sort((a, b) => a - b);
  for (const r of rated) r.gains = new Map();
  for (const rd of rounds) {
    const g = rated.map((r) => {
      const a = r.vals.get(rd), b = r.vals.get(rd + 1) ?? (r.O != null && !rounds.includes(rd + 1) ? r.O : null);
      return a != null && b != null ? { d: b - a, terminal: !r.vals.has(rd + 1) } : null;
    });
    const ok = g.filter((x) => x != null), mg = ok.length ? ok.reduce((s, x) => s + x.d, 0) / ok.length : 0;
    // terminal = the step from the seat's last PREP to its outcome O (the result, not public play)
    rated.forEach((r, i) => { if (g[i] != null) r.gains.set(rd, { gain: g[i].d, adv: g[i].d - mg, terminal: g[i].terminal }); });
  }
  return rated;
}

/**
 * The teammates as the advisor sees them now (one record row or one engine public view): each one's line (main
 * stack), tempo (调度中心等级), board count, LP — and how the own seat compares. `model` (optional) adds V_r.
 */
export function teamContextOf(self, mates, round, model = null) {
  const me = snapOf({ ...self }, { round, phase: 'PREP' });
  const list = (mates || []).map((p) => ({ name: p.name, seat: p.seat, isBot: !!p.isBot, ...snapOf(p, { round, phase: 'PREP' }) }));
  const v = (s) => (model ? valueOf(model, round, s) : null);
  const meV = v(me);
  const mates_ = list.map((s) => ({ ...s, v: v(s), ahead: model && meV != null && v(s) != null ? v(s) - meV : null }));
  const lines = new Map();
  for (const s of [me, ...list]) if (s.alive && s.core && s.core.layers > 0) lines.set(s.core.id, [...(lines.get(s.core.id) || []), s === me ? '我' : s.name]);
  return { round, me: { ...me, v: meV }, mates: mates_, contested: [...lines.entries()].filter(([, who]) => who.length > 1).map(([id, who]) => ({ bondId: id, who })),
    best: mates_.filter((s) => s.alive && s.ahead != null && s.ahead > 0).sort((a, b) => b.ahead - a.ahead)[0] || null };
}

// ── the advisor's side: who plays which line, at which tempo ─────────────────────────────────────────────────────

/** a seat's line from its public bonds: the core bond (one with a guide recipe) with the most layers, then members */
export function observedLine(bonds, cores) {
  const b = (bonds || []).filter((x) => cores.has(x.bondId) && (x.count > 0 || x.layers > 0)).sort((a, c) => c.layers - a.layers || c.count - a.count)[0];
  return b && (b.layers > 0 || b.count >= 2) ? b.bondId : null;
}

/**
 * The advised seat's line when it has none yet: among the available lines no teammate is on, the one the learned
 * profile rates best against this boss — taken over the default only when ahead by > 2 SE, else `fallback`.
 */
export function pickLine(profile, { bossId, avail, taken, fallback }) {
  const free = avail.filter((l) => !taken.includes(l));
  if (!free.length) return fallback;
  const def = free.includes(fallback) ? fallback : free[0];
  const table = profile && profile.lines ? (profile.lines.byBoss[bossId] || null) : null;
  if (!table) return def;
  const cell = (l) => table.find((x) => x.line === l) || null;
  const seOf = (l) => { const c = cell(l), o = profile.lines.overall[l]; return c && c.se != null && c.n >= 20 ? c.se : o ? o.se : Infinity; };
  const best = free.filter((l) => cell(l)).sort((a, b) => cell(b).A - cell(a).A)[0];
  if (!best || best === def || !cell(def)) return best || def;
  return cell(best).A - cell(def).A > 2 * Math.hypot(seOf(best), seOf(def)) ? best : def;
}

/**
 * Guide spec for the advisor's rollouts with the team in view (guides/policy.mjs spec.seats):
 *   every seat keeps the line it is visibly on (public bonds) — the continuation no longer re-deals the guide's
 *   default lines, which in a real match put the owner and the teammates on lines they are not playing;
 *   a teammate leveling ahead of / behind the base tempo keeps that offset (its observed tempo);
 *   the advised seat plays the learned tempo, and a seat with no line yet takes pickLine().
 * `m` is a restored engine match (read only); `profile` = models/team-profile.json (optional); `lines` = lines known
 * before any bond shows (pid → line: the band each teammate drafted, or a self-play scenario's teammates).
 */
export function teamSpec(spec, m, playerId, profile = null, { lines = {} } = {}) {
  const cores = new Set(Object.keys(spec.recipes)), seats = {};
  const avail = m.gd.bondIds.filter((b) => cores.has(b) && !m.disabledBonds.includes(b) && !m.staticInactiveBonds.includes(b));
  const bondsOf = (ps) => Object.entries(ps.bonds || {}).map(([bondId, b]) => ({ bondId, count: b.count || 0, layers: b.layers || 0 }));
  const taken = [];
  for (const ps of m.order) {
    if (!ps.alive) continue;
    const line = observedLine(bondsOf(ps), cores) || lines[ps.playerId] || null, o = {};
    if (line) { o.route = line; if (ps.playerId !== playerId) taken.push(line); }
    if (ps.playerId !== playerId) {
      const off = ps.shop.level - (spec.levelTargets[m.round] ?? ps.shop.level);
      if (off) o.levelTargets = spec.levelTargets.map((l, r) => (r <= m.round ? l : Math.max(1, Math.min(m.gd.maxShopLevel, l + off))));
    }
    if (Object.keys(o).length) seats[ps.playerId] = o;
  }
  const me = seats[playerId] || {};
  if (profile && profile.tempo) me.levelTargets = profile.tempo.learned;
  if (!me.route) {
    const wanted = [...new Set([...spec.coreOrder, ...avail])].filter((b) => avail.includes(b));
    me.route = pickLine(profile, { bossId: m.bossId, avail, taken, fallback: wanted.find((l) => !taken.includes(l)) || wanted[0] });
  }
  seats[playerId] = me;
  return { ...spec, seats };
}

/** What the advice shows about the team (engine match, public data only): each seat's line / level / LP / layers and
 *  public value V_r, who is ahead, contested lines, and the tempo + line the advised seat is steered to. */
export function teamSummary(m, playerId, spec, profile = null) {
  const pub = m.publicView(), me = pub.players.find((p) => p.playerId === playerId);
  const self = { lp: me.lp, level: me.shopLevel, board: me.boardCount, alive: me.alive, bonds: (me.bonds || []).filter((b) => !b.off).map((b) => `${b.bondId}:${b.count}/${b.layers}`) };
  const ctx = teamContextOf(self, matesOf(pub.players, playerId), m.round, profile ? profile.valueModel : null);
  const seats = spec.seats || {};
  return {
    round: m.round,
    me: { level: ctx.me.level, lp: ctx.me.lp, line: seats[playerId]?.route || null, layers: ctx.me.layers, v: ctx.me.v },
    mates: ctx.mates.map((x) => ({ name: x.name, seat: x.seat, alive: x.alive, level: x.level, lp: x.lp, board: x.board,
      line: x.core ? x.core.id : null, layers: x.layers, v: x.v, ahead: x.ahead })),
    contested: ctx.contested, best: ctx.best ? { name: ctx.best.name, ahead: ctx.best.ahead, level: ctx.best.level, line: ctx.best.core ? ctx.best.core.id : null } : null,
    tempo: profile ? { learnedNext: profile.tempo.learned[m.round + 1] ?? null, learnedNow: profile.tempo.learned[m.round] ?? null, base: spec.levelTargets[m.round] } : null,
  };
}
