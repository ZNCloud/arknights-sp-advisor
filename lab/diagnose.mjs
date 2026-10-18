// advisor-dev/lab/diagnose.mjs — 诊断：为什么有的种子能打掉 20~40% BOSS 血、有的只有 5%？
//
// 只读已有的 matchrun --json 输出，不跑模拟。看每回合的 level / units / leaks / bonds 名词数，
// 找「高掉血」与「低掉血」两组在哪个量上分叉。
//
//   node lab/diagnose.mjs samples/solo-A-baseline.json [更多文件...]

import fs from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) { console.error('用法: node lab/diagnose.mjs <json...>'); process.exit(1); }

const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));

function rowsOf(run) {
  const last = (run.rounds || [])[run.rounds.length - 1] || {};
  const boss = last.boss || null;
  const dmg = boss && boss.max ? (1 - boss.hp / boss.max) * 100 : 0;
  const at = (round) => {
    const r = (run.rounds || []).find((x) => x.round === round);
    const p = r && r.players ? Object.values(r.players)[0] : null;
    return p || null;
  };
  const bonds = (p) => (p && p.bonds ? String(p.bonds).split(/\s+/).filter(Boolean).length : 0);
  const r13 = at(13), r12 = at(12), r10 = at(10);
  return {
    seed: run.seed, dmg, victory: !!run.victory, rounds: run.roundsPassed, reached: !!boss,
    lvl13: r13?.level ?? null, unit13: r13?.units ?? null, bonds13: bonds(r13),
    lvl12: r12?.level ?? null, unit12: r12?.units ?? null,
    lvl10: r10?.level ?? null, unit10: r10?.units ?? null,
    leakSum: (run.rounds || []).reduce((s, x) => s + (Object.values(x.players || {})[0]?.leaks || 0), 0),
  };
}

const med = (a) => { const b = a.filter((x) => x !== null && x !== undefined).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };

for (const f of files) {
  const runs = load(f);
  const rows = runs.map(rowsOf);
  const reached = rows.filter((r) => r.reached);
  const high = reached.filter((r) => r.dmg >= 20);
  const low = reached.filter((r) => r.dmg < 10);
  console.log(`\n=== ${f} ===  n=${rows.length} 到R14=${reached.length}  高掉血(≥20%)=${high.length}  低掉血(<10%)=${low.length}`);
  const show = (name, g) => {
    if (!g.length) return console.log(`  ${name}: (空)`);
    console.log(`  ${name}: dmg 中位 ${med(g.map((r) => r.dmg)).toFixed(1)}% · ` +
      `L10 ${med(g.map((r) => r.lvl10))} · L12 ${med(g.map((r) => r.lvl12))} · L13 ${med(g.map((r) => r.lvl13))} · ` +
      `单位 R12 ${med(g.map((r) => r.unit12))} / R13 ${med(g.map((r) => r.unit13))} · ` +
      `盟约数 R13 ${med(g.map((r) => r.bonds13))} · 漏怪 ${med(g.map((r) => r.leakSum))}`);
  };
  show('高掉血', high);
  show('低掉血', low);
  show('全部到R14', reached);
  // 相关性粗测：dmg vs 各量（同序号配对，Spearman 近似用秩差）
  const corr = (xs, ys) => {
    const pairs = xs.map((x, i) => [x, ys[i]]).filter(([a, b]) => a !== null && b !== null);
    if (pairs.length < 4) return null;
    const rank = (arr) => { const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const r = new Array(arr.length); idx.forEach(([, i], k) => { r[i] = k; }); return r; };
    const rx = rank(pairs.map((p) => p[0])), ry = rank(pairs.map((p) => p[1]));
    const n = pairs.length, mx = (n - 1) / 2;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - mx; num += a * b; dx += a * a; dy += b * b; }
    return num / Math.sqrt(dx * dy || 1);
  };
  for (const [name, key] of [['L13', 'lvl13'], ['单位R13', 'unit13'], ['盟约数R13', 'bonds13'], ['漏怪总和', 'leakSum'], ['L12', 'lvl12']]) {
    const c = corr(reached.map((r) => r[key]), reached.map((r) => r.dmg));
    console.log(`  相关(dmg vs ${name}) = ${c === null ? 'n/a' : c.toFixed(2)}`);
  }
}
