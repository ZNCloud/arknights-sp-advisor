// Learn from whoever played better (own seat and teammates alike), on public data only.
//
//   1. Public value model V_r (advisor/team.mjs): per round, a ridge regression of the seat outcome O on the seat's
//      public state at the end of PREP. Fitted on self-play (real matches are too few), checked on held-out seeds.
//   2. Rate every seat of every match: dO = O − the table's mean (result), adv_r = (V_{r+1} − V_r) − the table's mean
//      gain that round (key-round gain).
//   3. Every seat-round is a decision sample with a signed weight
//          w = ½ · dO / sd(dO) + ½ · adv_r / sd(adv)
//      (> 0: the seat out-played its table — learn from it; < 0: a counter-example).
//   4. What is learned (both are public decisions, so a teammate's count exactly like the own seat's):
//      tempo  — per round, A(ℓ) = mean w of the samples standing at 调度中心 level ℓ; the learned target is the best ℓ
//               when it beats the base target's A by > 2 SE (else the base target stays);
//      lines  — per boss, A(line) = mean dO of the seats whose main stack was that core line (a whole-match decision,
//               so the outcome part only), shrunk to the line's all-boss mean (k = 20 pseudo-samples).
//   --weights flat: every sample w = 1 (imitate everyone — ablation); --weights anti: w → −w (learn from the worse).
// Usage: node sp-advisor/advisor/learn-team.mjs --games results/team-train.jsonl[,more.jsonl] [--records sp-advisor/matches/*.jsonl]
//        --out sp-advisor/models/team-profile.json [--guide guides/g06_final.json] [--weights signed|flat|anti]
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { makeMatch } from '../eval/engine.mjs';
import { splitMatches, tracksOf, rateMatch, seatOutcome, publicFeatures, PUBLIC_FEATURES, SEAT_O } from './team.mjs';

const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const se = (a) => (a.length > 1 ? sd(a) / Math.sqrt(a.length) : Infinity);

/** matches from self-play game files ({ seed, rows } per line) and/or overlay record files (rows per line) */
export function loadMatches(gameFiles = [], recordFiles = []) {
  const out = [];
  for (const f of gameFiles) for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const g = JSON.parse(line);
    out.push({ source: 'selfplay', seed: g.seed, seats: g.seats, routes: g.routes || null, rows: g.rows });
  }
  for (const f of recordFiles) {
    const rows = readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    splitMatches(rows).forEach((m, i) => out.push({ source: 'record', file: f.split('/').pop(), index: i, rows: m.rows }));
  }
  return out;
}

/** the seat's main line: the core bond with the most layers at the end (count > 0), else null */
export function lineOf(seatTrack, coreIds) {
  const last = [...seatTrack.rounds].reverse().find((x) => x.end && x.end.bonds.length);
  if (!last) return null;
  const b = last.end.bonds.filter((x) => coreIds.has(x.bondId) && x.count > 0).sort((a, b) => b.layers - a.layers || b.count - a.count)[0];
  return b ? b.bondId : null;
}

// ── ridge regression (standardised features, closed form) ────────────────────────────────────────────────────────
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
export function ridge(X, y, lambda = 1) {
  const d = X[0].length, mu = Array.from({ length: d }, (_, j) => mean(X.map((x) => x[j])));
  const s = Array.from({ length: d }, (_, j) => sd(X.map((x) => x[j])) || 1);
  const Z = X.map((x) => x.map((v, j) => (v - mu[j]) / s[j])), b = mean(y);
  const A = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => Z.reduce((t, z) => t + z[i] * z[j], 0) + (i === j ? lambda : 0)));
  const w = solve(A, Array.from({ length: d }, (_, i) => Z.reduce((t, z, k) => t + z[i] * (y[k] - b), 0)));
  return { b, w, mu, sd: s, n: X.length };
}
const predict = (m, x) => m.b + m.w.reduce((t, w, j) => t + w * (x[j] - m.mu[j]) / m.sd[j], 0);
const r2 = (m, X, y) => { const yb = mean(y); const ss = y.reduce((t, v) => t + (v - yb) ** 2, 0); return ss ? 1 - X.reduce((t, x, i) => t + (y[i] - predict(m, x)) ** 2, 0) / ss : null; };

/** seat outcome O for every seat of a match that carries a result (null otherwise) */
function outcomes(track) {
  if (!track.result) return null;
  const lastRound = Math.max(...track.seats.map((s) => (s.rounds.length ? s.rounds[s.rounds.length - 1].round : 0)));
  return track.seats.map((s) => (s.result ? seatOutcome(s.result, { lastRound, bossMax: track.result.bossMax, seats: track.seats.length }) : null));
}

export function fitValueModel(tracks, { holdout = (t) => false, maxRound = 15 } = {}) {
  const fit = {}, check = {};
  for (let r = 1; r <= maxRound; r++) {
    const tr = { X: [], y: [] }, ho = { X: [], y: [] };
    for (const t of tracks) {
      const O = outcomes(t); if (!O) continue;
      t.seats.forEach((s, i) => {
        const x = s.rounds.find((q) => q.round === r)?.prep;
        if (!x || !x.alive || O[i] == null) return;
        const d = holdout(t) ? ho : tr; d.X.push(publicFeatures(x)); d.y.push(O[i]);
      });
    }
    if (tr.X.length < 30) continue;
    const m = ridge(tr.X, tr.y);
    fit[r] = { ...m, r2: r2(m, tr.X, tr.y) };
    check[r] = { nTrain: tr.X.length, nHoldout: ho.X.length, r2Train: +r2(m, tr.X, tr.y).toFixed(3), r2Holdout: ho.X.length > 10 ? +r2(m, ho.X, ho.y).toFixed(3) : null };
  }
  const rounds = Object.keys(fit).map(Number);
  return { model: { features: PUBLIC_FEATURES, maxRound: Math.max(...rounds), rounds: fit }, check };
}

/** decision samples: one per seat per round with a PREP snapshot, signed weight as in the header */
export function samplesOf(tracks, model, coreIds, weights = 'signed') {
  const raw = [];
  for (const t of tracks) {
    const rated = rateMatch(t, model);
    t.seats.forEach((s, i) => {
      const r = rated[i], line = lineOf(s, coreIds);
      for (const q of s.rounds) if (q.prep && q.prep.alive) raw.push({ match: t.id, seat: s.key, self: s.self, round: q.round, level: q.prep.level, line,
        bossId: t.result?.bossId || null, dO: r.dO, adv: r.gains.get(q.round)?.adv ?? null, profile: t.truth?.[s.seat] ?? null });
    });
  }
  const sdO = sd(raw.filter((x) => x.dO != null).map((x) => x.dO)) || 1, sdA = sd(raw.filter((x) => x.adv != null).map((x) => x.adv)) || 1;
  for (const x of raw) {
    const w = 0.5 * (x.dO ?? 0) / sdO + 0.5 * (x.adv ?? 0) / sdA;
    x.w = weights === 'flat' ? 1 : weights === 'anti' ? -w : w;
  }
  return { samples: raw, scale: { sdO, sdAdv: sdA } };
}

/** tempo: per round, the level whose samples out-played their tables most (vs the base target, > 2 SE) */
export function learnTempo(samples, baseTargets, { minN = 30, z = 2, weights = 'signed' } = {}) {
  const per = [], learned = baseTargets.slice();
  for (let r = 1; r < baseTargets.length; r++) {
    const at = samples.filter((x) => x.round === r);
    if (!at.length) { per.push({ round: r, base: baseTargets[r], learned: baseTargets[r], n: 0 }); continue; }
    const levels = [...new Set(at.map((x) => x.level))].sort((a, b) => a - b);
    const A = Object.fromEntries(levels.map((l) => { const w = at.filter((x) => x.level === l).map((x) => x.w); return [l, { A: +mean(w).toFixed(4), se: +se(w).toFixed(4), n: w.length }]; }));
    let pick = baseTargets[r];
    if (weights === 'flat') {
      // imitate everyone: the most common level
      pick = +Object.entries(A).sort((a, b) => b[1].n - a[1].n)[0][0];
    } else {
      const ok = levels.filter((l) => A[l].n >= minN).sort((a, b) => A[b].A - A[a].A);
      const base = A[baseTargets[r]];
      if (ok.length) {
        const best = ok[0];
        if (!base || base.n < minN) pick = best;
        else if (best !== baseTargets[r] && A[best].A - base.A > z * Math.hypot(A[best].se, base.se)) pick = best;
      }
    }
    learned[r] = pick;
    per.push({ round: r, base: baseTargets[r], learned: pick, A });
  }
  // a level is never given back, so a lower target later caps every earlier one (backward pass: a significant
  // "stay at 4 in R10" also keeps R9 at 4 — a forward max would silently overrule it)
  for (let r = learned.length - 2; r >= 1; r--) learned[r] = Math.min(learned[r], learned[r + 1]);
  per.forEach((p) => { p.learned = learned[p.round]; });
  return { learned, perRound: per };
}

/** lines: per boss, the shrunk mean dO of the seats that stacked each core line (one sample per seat-match) */
export function learnLines(tracks, model, coreIds, { k = 20, weights = 'signed' } = {}) {
  const rows = [];
  for (const t of tracks) {
    if (!t.result) continue;
    const rated = rateMatch(t, model);
    t.seats.forEach((s, i) => { const line = lineOf(s, coreIds); if (line && rated[i].dO != null) rows.push({ boss: t.result.bossId, line, dO: weights === 'anti' ? -rated[i].dO : weights === 'flat' ? 1 : rated[i].dO }); });
  }
  const overall = {};
  for (const line of new Set(rows.map((x) => x.line))) { const v = rows.filter((x) => x.line === line).map((x) => x.dO); overall[line] = { A: mean(v), se: se(v), n: v.length }; }
  const byBoss = {};
  for (const boss of new Set(rows.map((x) => x.boss).filter(Boolean))) {
    byBoss[boss] = Object.keys(overall).map((line) => {
      const v = rows.filter((x) => x.boss === boss && x.line === line).map((x) => x.dO);
      const shrunk = (v.reduce((a, b) => a + b, 0) + k * overall[line].A) / (v.length + k);
      return { line, A: +shrunk.toFixed(4), raw: v.length ? +mean(v).toFixed(4) : null, se: v.length > 1 ? +se(v).toFixed(4) : null, n: v.length };
    }).sort((a, b) => b.A - a.A);
  }
  return { overall: Object.fromEntries(Object.entries(overall).map(([l, o]) => [l, { A: +o.A.toFixed(4), se: +o.se.toFixed(4), n: o.n }])), byBoss, k, samples: rows.length };
}

/** is the rating right? self-play profiles are assigned at random, so the mean dO of a profile is a fair check */
function ratingCheck(tracks, model) {
  const by = {}, pairs = {};
  for (const t of tracks) {
    if (!t.truth || !t.result) continue;
    const rated = rateMatch(t, model);
    // process alone: key-round gains up to the seat's last PREP (the step to the result is left out)
    const proc = rated.map((r) => [...r.gains.values()].filter((g) => !g.terminal).reduce((s, g) => s + g.adv, 0));
    t.seats.forEach((s, i) => {
      const p = t.truth[s.seat]; if (p == null || rated[i].dO == null) return;
      (by[p] ||= { dO: [], proc: [] }).dO.push(rated[i].dO); by[p].proc.push(proc[i]);
    });
    // pairwise: two seats with different profiles in one match — does the outcome rating / the process rating order them like the profiles' true strength (measured separately, all-seat sweeps)?
    t.seats.forEach((a, i) => t.seats.forEach((b, j) => {
      if (j <= i) return; const pa = t.truth[a.seat], pb = t.truth[b.seat]; if (pa == null || pb == null || pa === pb) return;
      const key = [pa, pb].sort().join('|'), flip = key.split('|')[0] !== pa;
      const dO = (rated[i].dO - rated[j].dO) * (flip ? -1 : 1), dp = (proc[i] - proc[j]) * (flip ? -1 : 1);
      const e = (pairs[key] ||= { n: 0, O: [0, 0, 0], proc: [0, 0, 0] }); e.n++;   // [first better, tie, second better]
      e.O[dO > 1e-9 ? 0 : dO < -1e-9 ? 2 : 1]++;
      e.proc[dp > 1e-9 ? 0 : dp < -1e-9 ? 2 : 1]++;
    }));
  }
  return { byProfile: Object.fromEntries(Object.entries(by).map(([p, v]) => [p, { dO: +mean(v.dO).toFixed(4), seDO: +se(v.dO).toFixed(4), proc: +mean(v.proc).toFixed(4), seProc: +se(v.proc).toFixed(4), n: v.dO.length }])), pairs };
}

export function coreIdsOf() {
  const m = makeMatch(1, 4); const ids = m.gd.bondIds.filter((b) => m.gd.bond(b).isCore); m.dispose(); return new Set(ids);
}

/** match records → rated tracks (id, truth = the self-play profile per seat when known) */
export function trackAll(matches) {
  return matches.map((x, i) => {
    const t = tracksOf(x.rows);
    t.id = x.source === 'selfplay' ? `s${x.seed}` : `${x.file}#${x.index}`;
    t.seed = x.seed ?? null; t.source = x.source;
    if (x.seats) t.truth = Object.fromEntries(Object.entries(x.seats).map(([pid, prof]) => [Number(pid.slice(1)), prof]));
    if (x.routes) t.routes = x.routes;
    return t;
  });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = {};
  for (let i = 0; i < args.length; i++) { if (!args[i].startsWith('--')) throw Error('Expected --flag'); opt[args[i].slice(2)] = args[++i]; }
  const games = (opt.games || '').split(',').filter(Boolean), records = (opt.records || '').split(',').filter(Boolean);
  const weights = opt.weights || 'signed';
  const base = JSON.parse(readFileSync(opt.guide || 'guides/g06_final.json', 'utf8'));
  const tracks = trackAll(loadMatches(games, records));
  const sim = tracks.filter((t) => t.source === 'selfplay');
  const coreIds = coreIdsOf();
  // the value model is fitted on self-play; held-out = seed % 5 == 0 for the check, then refitted on all of it
  const { check } = fitValueModel(sim, { holdout: (t) => t.seed % 5 === 0 });
  const { model } = fitValueModel(sim);
  const usable = tracks.filter((t) => t.result && t.seats.length > 1);
  const { samples, scale } = samplesOf(usable, model, coreIds, weights);
  const tempo = learnTempo(samples, base.levelTargets, { weights });
  const lines = learnLines(usable, model, coreIds, { weights });
  const out = {
    version: 1, createdAt: new Date().toISOString(), weights,
    trainedOn: { games, records, matches: tracks.length, usable: usable.length, seats: usable.reduce((s, t) => s + t.seats.length, 0),
      withMates: tracks.filter((t) => t.hasMates).length, sha: createHash('sha1').update([...games, ...records].map((f) => readFileSync(f)).join('')).digest('hex').slice(0, 16) },
    seatOutcome: SEAT_O,
    weightRule: 'w = 0.5*dO/sd(dO) + 0.5*adv/sd(adv); dO = seat outcome - table mean; adv = (V[r+1]-V[r]) - table mean gain',
    scale, valueModel: model, valueModelCheck: check,
    tempo: { base: base.levelTargets, learned: tempo.learned, perRound: tempo.perRound },
    lines,
    ratingCheck: ratingCheck(sim, model),
  };
  mkdirSync(dirname(opt.out), { recursive: true }); writeFileSync(opt.out, JSON.stringify(out, null, 1));
  console.log(`matches ${tracks.length} (usable ${usable.length}, with teammates ${out.trainedOn.withMates}), samples ${samples.length}, weights=${weights}`);
  console.log('value model R² (train / held-out) by round:', Object.entries(check).map(([r, c]) => `R${r} ${c.r2Train}/${c.r2Holdout}`).join(' '));
  console.log('tempo base   ', base.levelTargets.slice(1).join(' '));
  console.log('tempo learned', tempo.learned.slice(1).join(' '));
  console.log('rating by profile (mean dO ± se / process):', JSON.stringify(out.ratingCheck.byProfile));
  console.log('line value (all bosses):', JSON.stringify(lines.overall));
}
