// lab/paired.mjs — paired comparison of two `matchrun --json` dumps over the same seed range.
// usage: node lab/paired.mjs <labelA> <fileA> <labelB> <fileB>
// Reports the per-seed % of the R14 boss pool removed in both arms, the paired differences, a sign test, and the
// same subset restricted to the seeds where BOTH arms reached the boss AND faced the same boss id.
import { readFileSync } from 'node:fs';

const [la, fa, lb, fb] = process.argv.slice(2);
if (!fa || !fb) {
  console.error('usage: node lab/paired.mjs <labelA> <fileA> <labelB> <fileB>');
  process.exit(2);
}

function load(f) {
  const b = readFileSync(f);
  let t;
  if (b[0] === 0xff && b[1] === 0xfe) t = b.toString('utf16le').slice(1);
  else { t = b.toString('utf8'); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); }
  return JSON.parse(t);
}
const med = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f2 = (v) => (v == null ? '-' : v.toFixed(2));

function arm(f) {
  const out = new Map();
  for (const r of load(f)) {
    const rounds = r.rounds || [];
    const bossRow = rounds.find((x) => x.boss);
    const r13 = rounds.find((x) => x.round === 13);
    const boss = bossRow ? bossRow.boss : null;
    out.set(r.seed, {
      pct: boss && boss.max ? ((boss.max - boss.hp) / boss.max) * 100 : 0,
      abs: boss ? boss.max - boss.hp : 0,
      bossId: r.bossId, reached: !!boss,
      teamLp13: r13 ? Object.values(r13.players).filter((p) => p.alive).reduce((a, p) => a + (p.lp || 0), 0) : null,
    });
  }
  return out;
}

const A = arm(fa);
const B = arm(fb);
const seeds = [...A.keys()].filter((s) => B.has(s)).sort((x, y) => x - y);

console.log(`A = ${la}   B = ${lb}   paired seeds ${seeds.length}`);
console.log('  seed    A dmg%   B dmg%    diff(B-A)   A bossId  B bossId  sameBoss');
const diffs = [];
const sameBossDiffs = [];
for (const s of seeds) {
  const a = A.get(s);
  const b = B.get(s);
  const d = b.pct - a.pct;
  diffs.push(d);
  const same = a.bossId === b.bossId;
  if (same && a.reached && b.reached) sameBossDiffs.push(d);
  console.log(`  ${String(s).padStart(4)}   ${f2(a.pct).padStart(7)}   ${f2(b.pct).padStart(7)}   ${(d >= 0 ? '+' : '') + f2(d)}`.padEnd(40)
    + `   ${String(a.bossId).padEnd(8)}  ${String(b.bossId).padEnd(8)}  ${same ? 'yes' : 'no'}`);
}
const wins = diffs.filter((d) => d > 0).length;
const losses = diffs.filter((d) => d < 0).length;
console.log(`  paired diff over all ${diffs.length} seeds: mean ${f2(mean(diffs))}  median ${f2(med(diffs))}  B better ${wins} / worse ${losses} / tie ${diffs.length - wins - losses}`);
console.log(`  paired diff on the ${sameBossDiffs.length} seeds where BOTH arms reached the boss and faced the same boss: mean ${f2(mean(sameBossDiffs))}  median ${f2(med(sameBossDiffs))}`);
console.log(`  A dmg% median ${f2(med([...A.values()].map((x) => x.pct)))}  ·  B dmg% median ${f2(med([...B.values()].map((x) => x.pct)))}   (missing = 0 convention)`);
const lpA = [...A.values()].map((x) => x.teamLp13).filter((v) => v != null);
const lpB = [...B.values()].map((x) => x.teamLp13).filter((v) => v != null);
console.log(`  teamLP@R13  A median ${f2(med(lpA))} (n=${lpA.length})  ·  B median ${f2(med(lpB))} (n=${lpB.length})`);
