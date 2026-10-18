// advisor-dev/lab/soloarm.mjs — 对比两个 solo arm 的连续指标（BOSS 掉血% / R13 LP / 漏怪）
//   node lab/soloarm.mjs samples/solo-A-baseline.json samples/solo-B-victoria.json
import fs from 'node:fs';

const [fa, fb] = process.argv.slice(2);
const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const arms = [[fa, load(fa)], [fb, load(fb)]];

function stat(runs) {
  const rows = runs.map((r) => {
    const last = (r.rounds || [])[r.rounds.length - 1] || {};
    const me = (last.players && Object.values(last.players)[0]) || {};
    const boss = last.boss || null;
    const dmgPct = boss && boss.max ? (1 - boss.hp / boss.max) * 100 : 0;
    const r13 = (r.rounds || []).find((x) => x.round === 13);
    const p13 = r13 && r13.players ? Object.values(r13.players)[0] : {};
    return { seed: r.seed, victory: !!r.victory, rounds: r.roundsPassed, bossId: r.bossId,
      dmgPct, lpR13: p13.lp ?? null, leakSum: (r.rounds || []).reduce((s, x) => s + (Object.values(x.players || {})[0]?.leaks || 0), 0),
      reached14: !!boss };
  });
  const bs = rows.filter((x) => x.reached14).map((x) => x.dmgPct).sort((a, b) => a - b);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const med = (a) => (a.length ? a[Math.floor(a.length / 2)] : 0);
  return { rows, reached: bs.length, medDmg: med(bs), avgDmg: avg(rows.map((x) => x.dmgPct)),
    medLp13: med(rows.map((x) => x.lpR13 ?? 0).sort((a, b) => a - b)), wins: rows.filter((x) => x.victory).length, n: rows.length };
}

const [sA, sB] = arms.map(([, runs]) => stat(runs));
for (const [name, s] of [[fa, sA], [fb, sB]]) {
  console.log(name, `n=${s.n} 到R14 ${s.reached} 胜 ${s.wins} BOSS掉血% 中位 ${s.medDmg.toFixed(2)} 均值 ${s.avgDmg.toFixed(2)} R13 LP 中位 ${s.medLp13}`);
}
// 配对：同 seed 差
const bySeed = new Map(sB.rows.map((r) => [r.seed, r]));
const diffs = sA.rows.filter((r) => bySeed.has(r.seed)).map((r) => bySeed.get(r.seed).dmgPct - r.dmgPct);
const mean = diffs.reduce((a, b) => a + b, 0) / Math.max(1, diffs.length);
console.log(`配对差（B-A）：n=${diffs.length} 均值 ${mean.toFixed(2)}pp，正差 ${diffs.filter((d) => d > 0).length}/${diffs.length}`);
