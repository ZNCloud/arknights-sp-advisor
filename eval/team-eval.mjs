// Before / after on the same seeds (eval/teamplay.mjs output, one file per arm): team result, the advised seat p0's
// own outcome, and — on the matches where a teammate out-played p0 in the reference arm — whether p0 now plays more
// like that teammate (tempo distance) and does better.
// Usage: node sp-advisor/eval/team-eval.mjs --arms before=results/a.jsonl,after=results/b.jsonl --ref before
//        [--control teamview] [--profile sp-advisor/models/team-profile.json] [--json out.json]
// The subset is picked on the reference arm, where p0 did worse than a teammate — p0 had a bad draw there, so every
// other arm looks better on it (regression to the mean). --control names an arm not used for the pick: the subset
// differences against it are the fair ones.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { tracksOf, rateMatch } from '../advisor/team.mjs';

const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) { if (!args[i].startsWith('--')) throw Error('Expected --flag'); opt[args[i].slice(2)] = args[++i]; }
const arms = Object.fromEntries(opt.arms.split(',').map((x) => x.split('=')));
const ref = opt.ref || Object.keys(arms)[0], control = opt.control || null;
if (control && (!arms[control] || control === ref)) throw Error(`--control must be an arm other than the reference: ${control}`);
const profile = opt.profile ? JSON.parse(readFileSync(opt.profile, 'utf8')) : null;
const model = profile ? profile.valueModel : null;

const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const se = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) / a.length); };
const binom = (k, n) => { let c = 1, p = 0; for (let i = 0; i <= n; i++) { if (i > 0) c = c * (n - i + 1) / i; if (i <= k) p += c; } return p / 2 ** n; };
const mcnemar = (b, c) => (b + c ? Math.min(1, 2 * binom(Math.min(b, c), b + c)) : 1);

function load(f) {
  const out = new Map();
  for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const g = JSON.parse(line), t = tracksOf(g.rows), rated = rateMatch(t, model);
    const seat = (n) => t.seats.find((s) => s.seat === n), r0 = rated.find((r) => r.seat === 0);
    const levels = (s) => Object.fromEntries(s.rounds.filter((q) => q.prep && q.prep.alive).map((q) => [q.round, q.prep.level]));
    const lines = g.routes || {};
    out.set(g.seed, {
      seed: g.seed, win: g.outcome.win, U: g.outcome.utility, lastRound: g.outcome.lastRound, r14: g.outcome.r14Dmg,
      O: Object.fromEntries(rated.map((r) => [r.seat, r.O])), levels: Object.fromEntries(t.seats.map((s) => [s.seat, levels(s)])),
      lines, collide: Object.entries(lines).some(([pid, l]) => pid !== 'p0' && l === lines.p0), p0O: r0 ? r0.O : null, seats: g.seats,
    });
  }
  return out;
}
const data = Object.fromEntries(Object.entries(arms).map(([k, f]) => [k, load(f)]));
const seeds = [...data[ref].keys()].filter((s) => Object.values(data).every((d) => d.has(s))).sort((a, b) => a - b);
const tempoDist = (a, b) => { const r = Object.keys(a).filter((k) => b[k] != null && +k <= 14); return r.length ? mean(r.map((k) => Math.abs(a[k] - b[k]))) : null; };

const summary = {};
for (const [k, d] of Object.entries(data)) {
  const g = seeds.map((s) => d.get(s)), R = seeds.map((s) => data[ref].get(s));
  const dU = g.map((x, i) => x.U - R[i].U), dO = g.map((x, i) => x.p0O - R[i].p0O);
  const b = g.filter((x, i) => x.win && !R[i].win).length, c = g.filter((x, i) => !x.win && R[i].win).length;
  summary[k] = { n: seeds.length, wins: g.filter((x) => x.win).length, reachR14: g.filter((x) => x.lastRound >= 14).length, meanLastRound: +mean(g.map((x) => x.lastRound)).toFixed(3),
    meanU: +mean(g.map((x) => x.U)).toFixed(4), p0O: +mean(g.map((x) => x.p0O)).toFixed(4), collisions: g.filter((x) => x.collide).length,
    vsRef: k === ref ? null : { dU: +mean(dU).toFixed(4), seU: +se(dU).toFixed(4), dP0O: +mean(dO).toFixed(4), seP0O: +se(dO).toFixed(4), winsGained: b, winsLost: c, mcnemarP: +mcnemar(b, c).toFixed(4),
      better: dU.filter((x) => x > 1e-9).length, worse: dU.filter((x) => x < -1e-9).length } };
}
// matches where, in the reference arm, some teammate's seat outcome beat p0's: does p0 move towards that teammate?
const sub = seeds.filter((s) => { const R = data[ref].get(s); return [1, 2, 3].some((n) => R.O[n] != null && R.O[n] > R.p0O); });
const subset = { n: sub.length, of: seeds.length, arms: {} };
for (const [k, d] of Object.entries(data)) {
  const dist = [], dU = [], dO = [];
  for (const s of sub) {
    const R = data[ref].get(s), x = d.get(s);
    const best = [1, 2, 3].filter((n) => R.O[n] != null).sort((a, b) => R.O[b] - R.O[a])[0];
    const dd = tempoDist(x.levels[0] || {}, R.levels[best] || {}); if (dd != null) dist.push(dd);
    dU.push(x.U - R.U); dO.push(x.p0O - R.p0O);
  }
  const vsControl = control && k !== control && k !== ref ? (() => {
    const u = sub.map((s) => d.get(s).U - data[control].get(s).U), o = sub.map((s) => d.get(s).p0O - data[control].get(s).p0O);
    return { dU: +mean(u).toFixed(4), seU: +se(u).toFixed(4), dP0O: +mean(o).toFixed(4), seP0O: +se(o).toFixed(4) };
  })() : null;
  subset.arms[k] = { vsControl, tempoDistToBetterMate: +mean(dist).toFixed(4), seDist: se(dist) != null ? +se(dist).toFixed(4) : null, wins: sub.filter((s) => d.get(s).win).length,
    meanU: +mean(sub.map((s) => d.get(s).U)).toFixed(4), p0O: +mean(sub.map((s) => d.get(s).p0O)).toFixed(4),
    vsRef: k === ref ? null : { dU: +mean(dU).toFixed(4), seU: +se(dU).toFixed(4), dP0O: +mean(dO).toFixed(4), seP0O: +se(dO).toFixed(4) } };
}
// the same subset split by the better teammate's play profile (self-play knows it): which profiles out-played p0, and
// per arm the tempo distance to that profile's seat
const byMate = {};
for (const s of sub) {
  const R = data[ref].get(s), best = [1, 2, 3].filter((n) => R.O[n] != null).sort((a, b) => R.O[b] - R.O[a])[0], prof = R.seats?.[`p${best}`] ?? '?';
  const e = (byMate[prof] ||= { n: 0, dist: Object.fromEntries(Object.keys(data).map((k) => [k, []])) }); e.n++;
  for (const [k, d] of Object.entries(data)) { const dd = tempoDist(d.get(s).levels[0] || {}, R.levels[best] || {}); if (dd != null) e.dist[k].push(dd); }
}
subset.byBetterMate = Object.fromEntries(Object.entries(byMate).sort((a, b) => b[1].n - a[1].n).map(([p, e]) => [p, { n: e.n, tempoDist: Object.fromEntries(Object.entries(e.dist).map(([k, v]) => [k, +mean(v).toFixed(3)])) }]));
const out = { ref, control, arms, profile: opt.profile || null, seeds: [seeds[0], seeds.at(-1)], summary, subsetMateBetter: subset };
console.log(`seeds ${seeds.length} (${seeds[0]}–${seeds.at(-1)}), reference arm: ${ref}`);
console.log('arm'.padEnd(14) + 'wins  R14  lastR   U       p0 O    collide  ΔU vs ref        Δp0 O vs ref     wins +/− (McNemar p)');
for (const [k, v] of Object.entries(summary)) console.log(`${k.padEnd(14)}${String(v.wins).padEnd(6)}${String(v.reachR14).padEnd(5)}${v.meanLastRound.toFixed(2).padEnd(8)}${v.meanU.toFixed(3).padEnd(8)}${v.p0O.toFixed(3).padEnd(8)}${String(v.collisions).padEnd(9)}${v.vsRef ? `${v.vsRef.dU >= 0 ? '+' : ''}${v.vsRef.dU.toFixed(3)}±${v.vsRef.seU.toFixed(3)}`.padEnd(17) + `${v.vsRef.dP0O >= 0 ? '+' : ''}${v.vsRef.dP0O.toFixed(3)}±${v.vsRef.seP0O.toFixed(3)}`.padEnd(17) + `+${v.vsRef.winsGained} −${v.vsRef.winsLost} (p=${v.vsRef.mcnemarP})` : '—'}`);
console.log(`teammate out-played p0 in ${ref}: ${subset.n}/${subset.of} matches`);
for (const [k, v] of Object.entries(subset.arms)) console.log(`  ${k.padEnd(12)} tempo distance to that teammate ${v.tempoDistToBetterMate.toFixed(3)}${v.seDist != null ? `±${v.seDist.toFixed(3)}` : ''}  wins ${v.wins}  U ${v.meanU.toFixed(3)}  p0 O ${v.p0O.toFixed(3)}${v.vsRef ? `  ΔU ${v.vsRef.dU >= 0 ? '+' : ''}${v.vsRef.dU.toFixed(3)}±${v.vsRef.seU.toFixed(3)}  Δp0 O ${v.vsRef.dP0O >= 0 ? '+' : ''}${v.vsRef.dP0O.toFixed(3)}±${v.vsRef.seP0O.toFixed(3)}` : ''}${v.vsControl ? `  vs ${control}: ΔU ${v.vsControl.dU >= 0 ? '+' : ''}${v.vsControl.dU.toFixed(3)}±${v.vsControl.seU.toFixed(3)}  Δp0 O ${v.vsControl.dP0O >= 0 ? '+' : ''}${v.vsControl.dP0O.toFixed(3)}±${v.vsControl.seP0O.toFixed(3)}` : ''}`);
console.log(`  by the better teammate's profile (n; tempo distance per arm): ${Object.entries(subset.byBetterMate).map(([p, e]) => `${p} ${e.n} [${Object.entries(e.tempoDist).map(([k, v]) => `${k} ${v}`).join(', ')}]`).join('; ')}`);
if (opt.json) { mkdirSync(dirname(opt.json), { recursive: true }); writeFileSync(opt.json, JSON.stringify(out, null, 1)); }
