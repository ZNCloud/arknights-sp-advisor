// lab/bossarm.mjs — read one or more `tools/matchrun.mjs --json` dumps and report the R14 boss-damage metric.
// usage: node lab/bossarm.mjs <label> <file...>
// Primary metric: % of the shared R14 boss pool removed by the end of the round.
//   bossPool.max = bloodPoint[boss] × (players alive when the fight starts) — see finalAssault.js bossPoolHp — so the
//   raw HP is NOT comparable across arms; the absolute damage (max − hp) is reported next to it.
//   A seed whose match ended before R14 contributes 0 % (it never got to burn the boss).
// Secondary: team LP entering the boss round = Σ lp over the seats still alive on the R13 settle row.
import { readFileSync } from 'node:fs';

const [label, ...files] = process.argv.slice(2);
if (!label || !files.length) {
  console.error('usage: node lab/bossarm.mjs <label> <file...>');
  process.exit(2);
}

const med = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function load(f) {
  const b = readFileSync(f);
  let t;
  if (b[0] === 0xff && b[1] === 0xfe) t = b.toString('utf16le').slice(1); // PowerShell 5.1 `>` writes UTF-16LE
  else { t = b.toString('utf8'); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); }
  return JSON.parse(t);
}

const teamLpOf = (row) => (row ? Object.values(row.players).filter((p) => p.alive).reduce((a, p) => a + (p.lp || 0), 0) : null);
const aliveOf = (row) => (row ? Object.values(row.players).filter((p) => p.alive).length : 0);

const rows = [];
for (const f of files) {
  for (const r of load(f)) {
    const rounds = Array.isArray(r.rounds) ? r.rounds : [];
    const bossRow = rounds.find((x) => x.boss);
    const r13 = rounds.find((x) => x.round === 13);
    const last = rounds.length ? rounds[rounds.length - 1].round : 0;
    const boss = bossRow ? bossRow.boss : null;
    const dmg = boss ? boss.max - boss.hp : 0;
    const pct = boss && boss.max ? (dmg / boss.max) * 100 : 0;
    rows.push({
      seed: r.seed, stage: r.stageId, bossId: r.bossId,
      reachedBoss: !!boss, bossHp: boss ? boss.hp : null, bossMax: boss ? boss.max : null, dmg, pct,
      teamLp13: r13 ? teamLpOf(r13) : null, alive13: aliveOf(r13), aliveBoss: aliveOf(bossRow),
      lastRound: last, victory: !!r.victory, roundsPassed: r.roundsPassed, reason: r.reason,
    });
  }
}

const pcts = rows.map((x) => x.pct);
const pctsBoss = rows.filter((x) => x.reachedBoss).map((x) => x.pct);
const dmgs = rows.map((x) => x.dmg);
const dmgsBoss = rows.filter((x) => x.reachedBoss).map((x) => x.dmg);
const lps = rows.map((x) => x.teamLp13).filter((v) => v != null);
const f2 = (v) => (v == null ? '-' : v.toFixed(2));
const f0 = (v) => (v == null ? '-' : Math.round(v).toString());

console.log(`=== ${label} ===  seeds ${rows.length}`);
for (const x of rows) {
  const bossTxt = x.reachedBoss
    ? `${x.bossId} ${x.bossHp}/${x.bossMax}  dmg ${f2(x.pct)}%  (abs ${x.dmg})  alive@R13 ${x.alive13}`
    : `BOSS NOT REACHED  dmg 0.00%`;
  console.log(`  seed ${String(x.seed).padStart(3)}  ${bossTxt}  teamLP@R13 ${x.teamLp13 ?? '-'}  rounds ${x.roundsPassed}  last R${x.lastRound}  ${x.reason}${x.victory ? ' WIN' : ''}`);
}
console.log(`  N=${rows.length}  reachedBoss=${pctsBoss.length}`);
console.log(`  dmg%  (missing=0)  median ${f2(med(pcts))}  mean ${f2(mean(pcts))}  min ${f2(Math.min(...pcts))}  max ${f2(Math.max(...pcts))}`);
console.log(`  dmg%  (boss only)  median ${f2(med(pctsBoss))}  mean ${f2(mean(pctsBoss))}  n=${pctsBoss.length}`);
console.log(`  abs dmg (missing=0) median ${f0(med(dmgs))}  mean ${f0(mean(dmgs))}`);
console.log(`  abs dmg (boss only) median ${f0(med(dmgsBoss))}  mean ${f0(mean(dmgsBoss))}  n=${dmgsBoss.length}`);
console.log(`  teamLP@R13  median ${f2(med(lps))}  mean ${f2(mean(lps))}  n=${lps.length}  (a seed with no R13 row died earlier)`);
console.log(`  alive seats @R13: median ${med(rows.map((x) => x.alive13))}  mean ${f2(mean(rows.map((x) => x.alive13)))}`);
console.log(`  roundsPassed median ${med(rows.map((x) => x.roundsPassed))}  mean ${f2(mean(rows.map((x) => x.roundsPassed)))}  wins ${rows.filter((x) => x.victory).length}/${rows.length}`);
