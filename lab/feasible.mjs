// advisor-dev/lab/feasible.mjs — 反解「打死 R14 BOSS」需要的最小堆叠组合
//
// 思路：bot 实测只打掉约 20% 池子（samples/solo-A-baseline.json，solo 20 seeds 中位 19.63%），
// 说明它当前的等效 DPS ≈ needDps × 0.20。要打死就是把它抬到 1.0，即需要 5× 的提升。
// 5× 只能由少数几个乘区提供，且全部有引擎系数：
//   精锐   ≈ ×2（精英形态）
//   层数   炎 攻 = 1.23 + 0.009·L（L 从 0 开始）
//   装备   维多利亚 6 人档：普通装备 +50%/件、金装 +80%/件
//   通道   bosstable.json 的 k（本局 BOSS × 本路线）
// 输出：每本 BOSS 的「5× 达成组合」，以及当前盘面的差距。
//
//   node lab/feasible.mjs                 # 打印表
//   node lab/feasible.mjs --json --out model/feasibility.json

import fs from 'node:fs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const outAt = args.indexOf('--out');

const bt = JSON.parse(fs.readFileSync('model/bosstable.json', 'utf8').replace(/^\uFEFF/, ''));
const BOT_FRACTION = 0.20;            // 实测：bot 在 R14 平均打掉约 20% 池子

// 乘区（引擎系数）。注意：这里算的是「相对 bot 当前主 C」的**增量比**，不是绝对值。
// bot 的典型主 C：非精锐、约 1.5 件装备、R13 层数约 200 层。要打死 BOSS 需要把这个主 C 抬 5 倍。
const ELITE = 2.36;                                  // 精锐：refAtkEliteMax 1362 / refAtkElite 577 = 2.36×（引擎参数）
const EQUIP_PER_CHESS = 2;                           // config.economy.equipPerChess = 2 —— 一个人最多带 2 件
const BASE = { elite: 1, items: 1.5, layers: 200 };  // bot 当前主 C 的典型档位
const layerMult = (L) => 1.23 + 0.009 * L;           // 炎：攻 = 0.23 + 0.009L
const itemMult = (n) => 1 + 0.5 * Math.min(n, EQUIP_PER_CHESS);   // 维多利亚：普通装备 +50%/件，人最多 2 件

const routes = [
  { id: 'yanShip', name: '炎', channel: 'arts', layer: layerMult },
  { id: 'victoriaShip', name: '维多利亚', channel: 'arts', layer: layerMult },
  { id: 'sargonShip', name: '萨尔贡', channel: 'mixed', layer: (L) => 1 + 0.12 * Math.min(25, Math.floor(L / 10)) },  // 攻速叠层：每层 +12%，上限 25 层
  { id: 'lateranoShip', name: '拉特兰', channel: 'phys', layer: (L) => 1 + (0.05 + 0.015 * L) },  // 弹药加成
  { id: 'kjeragShip', name: '谢拉格', channel: 'mixed', layer: (L) => 1.35 + 0.01 * L },
];

const rows = [];
for (const boss of bt.rows) {
  const need = boss.dpsNeeded;
  const target = need;                                  // 100% 池子
  const current = need * BOT_FRACTION;                   // bot 的等效 DPS
  const needMult = target / current;                     // ≈ 5×
  for (const r of routes) {
    const pay = bt.payoff[boss.bossId] && bt.payoff[boss.bossId][r.id];
    if (!pay) continue;
    const k = pay.k || 1;
    // 找最小 (L, items) 使「相对 bot 当前主 C」的增量比 ≥ needMult
    let best = null;
    for (let L = BASE.layers; L <= 600 && !best; L += 25) {
      for (let items = 0; items <= EQUIP_PER_CHESS; items++) {
        const ratio = (ELITE / BASE.elite) * (r.layer(L) / r.layer(BASE.layers)) * (itemMult(items) / itemMult(BASE.items));
        if (ratio >= needMult) { best = { L, items, ratio: +ratio.toFixed(2) }; break; }
      }
    }
    rows.push({
      boss: boss.bossId, bossName: boss.name, route: r.name, channel: pay.c, k,
      needDps: need, needMult: +needMult.toFixed(2),
      min: best, reachable: !!best,
    });
  }
}

if (asJson) {
  const json = JSON.stringify({ botFraction: BOT_FRACTION, elite: ELITE, rows }, null, 1);
  if (outAt > 0) { fs.writeFileSync(args[outAt + 1], json + '\n'); console.log('written', args[outAt + 1]); }
  else console.log(json);
} else {
  console.log(`bot 实测打掉 ${BOT_FRACTION * 100}% 池子 ⇒ 需要 ×${(1 / BOT_FRACTION).toFixed(1)} 提升才打死\n`);
  const byBoss = {};
  for (const r of rows) (byBoss[r.boss] = byBoss[r.boss] || []).push(r);
  for (const [boss, list] of Object.entries(byBoss)) {
    const b = list[0];
    console.log(`\n${boss} ${b.bossName} · 需求 DPS ${b.needDps} · 需要 ${b.needMult}×`);
    for (const r of list) {
      const m = r.min;
      console.log(`  ${r.route.padEnd(5)} k=${String(r.k).padEnd(5)} ${m ? `→ 层 ${String(m.L).padStart(3)} + 装备 ${m.items} 件（增量 ${m.ratio}×）` : '→ 堆不出来'}`);
    }
  }
}
