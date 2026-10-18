// advisor-dev/lab/bosstable.mjs — 从引擎系数算出「Boss × 伤害通道」的有效系数表（MODEL-SPEC.md §1 的数值来源）。
//
// 所有常数从 data/bonds.json（bb）、data/enemies.json（boss 的 def/res/黑board）、data/config.json 读，不手抄。
//
//   node advisor-dev/lab/bosstable.mjs                       # 打印表（markdown）
//   node advisor-dev/lab/bosstable.mjs --json                # 机器可读
//   node advisor-dev/lab/bosstable.mjs --layer 130 --atk 1385
//
// 有效系数 k 的定义（伤害管线，见 server/sim/damage.js mitigate()）：
//   phys : dmg = max(ATK − DEF·(1−pi), 0.05·ATK)
//   arts : dmg = max(ATK · (1 − min(100, RES·(1−pi))/100), 0.05·ATK) × magicTakenMul
//   true : dmg = ATK
// 两段血池（BOSS 半血前后）合成：k_eff = 2·k1·k2/(k1+k2)（调和平均 = 1/(0.5/k1 + 0.5/k2)，即两段血池的用时之和）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..', 'Stronghold-Protocol');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const bonds = readJson(path.join(repo, 'data', 'bonds.json'));
const enemies = readJson(path.join(repo, 'data', 'enemies.json'));
const bosses = readJson(path.join(repo, 'data', 'bosses.json'));
const config = readJson(path.join(repo, 'data', 'config.json'));

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const asJson = args.includes('--json');

const MIN_DAMAGE_RATIO = 0.05;             // server/sim/constants.js
const BOSS_HIT_LIMIT = 300000;             // shared/constants.js
const COMBAT_TIME_SCALE = 2;               // gamedata COMBAT_TIME_SCALE
const OVERTIME_AFTER_REAL = config.bossOvertimeAfter ?? 150;
const OVERTIME_DRAIN = config.bossOvertimeDrainPerSec ?? 1;

const LAYER = Number(flag('--layer', '130'));       // 合格曲线 coreLayers R13 = 130
const ADDON_LAYER = Number(flag('--addon-layer', '75')); // 合格曲线 addonLayers R13 = 75
const ATK = Number(flag('--atk', '0'));            // 0 = 用 577 × 各盟约的 ATK 乘区现算
const LP = Number(flag('--lp', '15'));

const bd = (id) => (bonds[id] && bonds[id].bb) || {};

/** 各核心盟约在层数 L 时的 ATK 乘区（bb 键名见 bonds.json）。 */
const ATK_MUL = {
  yanShip: (L) => 1 + (bd('yanShip').base_atk ?? 0.23) + (bd('yanShip').atk_per_stack ?? 0.009) * L,
  victoriaShip: (L, items = 6) => (bd('victoriaShip').base_damage_scale ?? 1.25) + (bd('victoriaShip').damage_scale_per_stack ?? 0.008) * L,
  kjeragShip: (L, cold = false) => (cold ? (bd('kjeragShip').base_ex_damage_scale ?? 1.35) + (bd('kjeragShip').ex_damage_scale_per_stack ?? 0.01) * L : (bd('kjeragShip').base_damage_scale ?? 1.25)),
  sargonShip: (L, stacks = 25) => 1 + (bd('sargonShip').base_atk ?? 0.12) * stacks,
  kazimierzShip: (L, deploys = 8) => 1 + Math.min(0.2 * deploys, (bd('kazimierzShip').base_max_atk_when_born ?? 0.5) + (bd('kazimierzShip').max_atk_when_born_per_stack ?? 0.01) * L),
  lateranoShip: (L, consumed = 25) => 1 + Math.min((bd('lateranoShip').max_atk_for_consume ?? 2), (bd('lateranoShip').atk_per_consume ?? 0.04) * consumed),
  siracusaShip: () => 1,
  egirShip: () => 1,
};

/** 攻速乘区（对「单位时间命中次数」生效，等价于输出乘区）。 */
const ASPD_MUL = {
  siracusaShip: (L) => (100 + (bd('siracusaShip').base_attack_speed ?? 25) + (bd('siracusaShip').attack_speed_per_stack ?? 0.8) * L) / 100,
  sargonShip: () => (100 + 12 * 25) / 100,
};

const ARCANE_MUL = (L, lowHp = false) => (bd('arcaneShip').base_damage_scale ?? 1.2) + (bd('arcaneShip').damage_scale_per_stack ?? 0.01) * L;
const ARCANE_LOW_HP = (L) => ARCANE_MUL(L) * (bd('arcaneShip').power_weak_scale ?? 1.4);
const PRECI_PIERCE = bd('preciShip').power_def_penetrate ?? 0.3;
const PRECI_RES = bd('preciShip').power_magic_resist_penetrate ?? 0.3;

const REF_ATK = 577;   // 精锐 T5/T6 主 C 基础 ATK 中位数（data/chess.json golden 记录）

const phys = (A, D, pi = 0) => Math.max(A - D * (1 - pi), MIN_DAMAGE_RATIO * A) / A;
const arts = (A, R, pi = 0, mul = 1) => Math.max(1 - Math.min(100, R * (1 - pi)) / 100, MIN_DAMAGE_RATIO) * mul;
const harm = (k1, k2) => (k1 > 0 && k2 > 0 ? (2 * k1 * k2) / (k1 + k2) : 0);

/** BOSS 阶段修改：[血池比例 f, ...] —— 来源见每个 boss 的注释（enemies.json talents / bosses.js kit）。 */
const PHASE = {
  boss_1: { f: 0.2, physTakenMul: 0.5, artsTakenMul: 0.5, note: 'enemies.json 1.hp_ratio 0.2 / 1.damage_scale 0.5（bosses.js kitHelm）' },
  boss_2: { f: 1, note: '无减伤（talents 只有 3.atk_scale 冲锋）' },
  boss_3: { f: 1, note: '无减伤（talents: 1.hp_ratio 0.5 是召唤间隔，不是减伤）' },
  boss_4: { f: 1, note: '无减伤' },
  boss_5: { f: 1, physTakenMul: 0.6, artsTakenMul: 0.6, note: 'talents evade.prob 0.4（未被阻挡时闪避物理/法术）；真伤不吃闪避' },
  boss_6: { f: 0.5, defPct: 1, resFlat: 45, note: 'talents advance.hp_ratio 0.5 / advance.def 1 / advance.magic_resistance 45' },
  boss_7: { f: 0.5, physTakenMul: 0.4, artsTakenMul: 0.4, note: 'talents Madness.damage_resistance 0.6 → 受物法 ×0.4；真伤/元素不乘' },
};

const rows = [];
for (const id of Object.keys(bosses)) {
  const b = bosses[id];
  if (b.hidden) continue;
  const e = enemies[b.enemyKey];
  if (!e) continue;
  const D = e.stats.def;
  const R = e.stats.res;
  const pool = b.bloodPoint.ABYSS;
  const ph = PHASE[id] || { f: 1 };
  const d2 = ph.defPct ? D * (1 + ph.defPct) : D;
  const r2 = ph.resFlat ? R + ph.resFlat : R;
  const f = ph.f ?? 1;
  const physMul = ph.physTakenMul ?? 1, artsMul = ph.artsTakenMul ?? 1;

  const ch = {};
  for (const [bond, fn] of Object.entries(ATK_MUL)) {
    const mul = fn(LAYER);
    const a = ATK > 0 ? ATK : REF_ATK * mul;
    const as = ASPD_MUL[bond] ? ASPD_MUL[bond](LAYER) : 1;
    const arc = ARCANE_MUL(ADDON_LAYER), arc3 = ARCANE_LOW_HP(ADDON_LAYER);
    // 两段血池：半血前用基础面板，半血后用阶段面板 + 阶段乘子（physTakenMul/artsTakenMul 乘在 mitigate 之后）
    const physK = (pi) => {
      const k1 = phys(a, D, pi) * physMul;
      const k2 = f < 1 ? phys(a, d2, pi) * physMul : k1;
      return harm(k1, k2) * as;
    };
    const artsK = (pi, lowMul) => {
      const k1 = arts(a, R, pi, arc);
      const k2 = f < 1 ? arts(a, r2, pi, lowMul) * artsMul : k1;
      return harm(k1, k2) * as;
    };
    ch[bond] = {
      atkMul: +mul.toFixed(2), aspdMul: +as.toFixed(2), atkEff: Math.round(a),
      phys: +physK(0).toFixed(3),
      physPreci: +physK(PRECI_PIERCE).toFixed(3),
      arts: +artsK(0, arc).toFixed(3),                    // 只有奥术 2 档（半血后不吃 3 档的 ×1.4）
      artsPreci: +artsK(PRECI_RES, arc3).toFixed(3),      // 3 名精准 + 奥术 3 档
      true: 1,
    };
  }
  // 真伤通道（叙拉古 proc / 卡西米尔阻挡）：不吃 DEF/RES/减伤/闪避
  const sir = bd('siracusaShip');
  const procDmg = (sir.base_damage ?? 5000) + (sir.damage_per_stack ?? 50) * LAYER;
  const prdStep = 0.00139;
  const eAttempts = 1.2533 / Math.sqrt(prdStep);                 // PRD p_n = c·n 的期望尝试数
  const instancesPerSec = 6 * (ASPD_MUL.siracusaShip(LAYER)) / 2.5; // 6 名叙拉古：攻速乘区 / 平均攻击间隔 2.5 s
  const sirDps = (instancesPerSec / eAttempts) * procDmg;
  const kazi = bd('kazimierzShip');
  const kaziDps = (kazi.damage_atk_scale ?? 1.2) * REF_ATK * ATK_MUL.kazimierzShip(LAYER) * ((kazi.power_bond_char_cnt ?? 6) - 3) / (kazi.damage_interval ?? 2);

  const window = OVERTIME_AFTER_REAL + LP;         // 0 漏怪的真实击杀窗口（秒）
  // 有效血池：阶段后承伤乘子 m 让「最后 a 份血」变贵 → pool_eff = pool·[(1−a) + a/m]
  const a = f < 1 ? (ph.atHpRatio ?? f) : 1;
  // 只有「真阶段」（a<1）的承伤乘子才抬高有效血池；boss_5 的 0.6 是全程闪避（=输出打折），不算血池
  const mTaken = a < 1 ? Math.min(physMul, artsMul) : 1;
  const poolEff = Math.round(pool * ((1 - a) + (mTaken > 0 ? a / mTaken : a)));
  rows.push({
    bossId: id, name: b.name, pool, poolEff, def: D, res: R, lpr: b.lpr,
    defHalf: d2, resHalf: r2, phase: f, atHpRatio: a, windowRealS: window,
    dpsNeeded: Math.round(poolEff / window),
    evadeMul: f < 1 ? null : physMul,
    physTakenMul: physMul, artsTakenMul: artsMul,
    channels: ch,
    trueChannelDps: { siracusa: Math.round(sirDps), kazimierz: Math.round(kaziDps) },
    note: ph.note,
  });
}

/** 每条核心盟约在 BOSS 回合实际能吃到的伤害通道（来源：data/chess.json 的成员工种/dmgType 名册）。
 *  mixed = 名册里既有法系主 C 也有物理主 C，BOSS 回合按较高的那条算（站得下的前提下）。 */
const ROUTE_CHANNEL = {
  yanShip: 'arts',            // 夕 / 烛煌 / 惊蛰 / 小满
  victoriaShip: 'arts',       // 薄绿 / 烛煌 / 维娜 / 焰影苇草
  kjeragShip: 'mixed',        // 圣聆初雪 / 灵知 / 初雪 / 耶拉 vs 银灰 / 雪猎 / 锏
  sargonShip: 'mixed',        // 异客 / 至简 / 卡涅利安 vs 佩佩
  kazimierzShip: 'phys',      // 远牙 / 耀骑士临光 / 锏 / 灰毫
  lateranoShip: 'phys',       // 空弦 / 能天使 / 蕾缪安 / 送葬人
  siracusaShip: 'phys',       // 拉普兰德 / 忍冬 / 伺夜（+ 真伤 proc）
  egirShip: 'phys',           // 乌尔比安 / 斯卡蒂 / 归溟幽灵鲨 / 深巡
};
const payoff = {};
for (const r of rows) {
  payoff[r.bossId] = {};
  for (const [route, chans] of Object.entries(ROUTE_CHANNEL)) {
    const c = r.channels[route];
    const pick = (k) => (chans === 'arts' ? k.arts : chans === 'phys' ? k.phys : Math.max(k.arts, k.phys));
    const pickP = (k) => (chans === 'arts' ? k.artsPreci : chans === 'phys' ? k.physPreci : Math.max(k.artsPreci, k.physPreci));
    payoff[r.bossId][route] = {
      channel: chans, k: +pick(c).toFixed(2), kPreci: +pickP(c).toFixed(2),
      trueDps: r.trueChannelDps,
      needDps: r.dpsNeeded, share: +(pick(c) * REF_ATK / r.dpsNeeded).toFixed(3),
    };
  }
}

/** 顾问代码直接查的「BOSS × 通道类」表：每个通道类取该通道下**最合适的路线**的 k。
 *  通道类 = advisor 在 scoreSlot v2 里给单个干员打的标签（见 MODEL-SPEC §3.2 damageClassOf）。
 *  萨尔贡单独一行：它的乘区要 6 名在场 + 25 栈维持，不能与常规法系混为一谈。 */
const ARTS_ROUTES = ['yanShip', 'victoriaShip', 'kjeragShip'];
const PHYS_ROUTES = ['kazimierzShip', 'lateranoShip', 'siracusaShip', 'egirShip'];
const bossPayoff = {};
for (const r of rows) {
  const maxOf = (routes, field) => +Math.max(...routes.map((x) => r.channels[x][field])).toFixed(3);
  bossPayoff[r.bossId] = {
    arts: maxOf(ARTS_ROUTES, 'arts'),
    artsArcane: maxOf(ARTS_ROUTES, 'artsPreci'),
    phys: maxOf(PHYS_ROUTES, 'phys'),
    physPreci: maxOf(PHYS_ROUTES, 'physPreci'),
    sargon: +Math.max(r.channels.sargonShip.arts, r.channels.sargonShip.phys).toFixed(3),
    sargonStacksRequired: 25,
    true: 1,                       // 真伤不吃 DEF/RES/闪避/承伤乘子；绝对量另由 §1.6 的 DPS 上限约束
    trueDpsCeiling: Math.max(r.trueChannelDps.siracusa, r.trueChannelDps.kazimierz),
    needDps: r.dpsNeeded,
  };
}

if (asJson) {
  const out = JSON.stringify({ layer: LAYER, addonLayer: ADDON_LAYER, refAtk: REF_ATK, minDamageRatio: MIN_DAMAGE_RATIO, bossHitLimit: BOSS_HIT_LIMIT, combatTimeScale: COMBAT_TIME_SCALE, lp: LP, rows, payoff, bossPayoff }, null, 1);
  const outFile = flag('--out', null);
  if (outFile) { fs.writeFileSync(outFile, out, 'utf8'); console.error(`wrote ${outFile}`); } else console.log(out);
} else {
  console.log(`\n# Boss × 通道 有效系数（L=${LAYER} / 附加层 ${ADDON_LAYER} / 参考 ATK ${REF_ATK} / LP ${LP}）\n`);
  console.log('| boss | pool | DEF | RES | lpr | 半血后 | 窗口(s) | 需 DPS | ' + Object.keys(rows[0].channels).map((k) => k.replace('Ship', '')).join(' | ') + ' |');
  console.log('|' + '---|'.repeat(9 + Object.keys(rows[0].channels).length));
  for (const r of rows) {
    const cells = Object.entries(r.channels).map(([, c]) => Math.max(c.phys, c.arts).toFixed(2));
    console.log(`| ${r.bossId} | ${(r.pool / 1e6).toFixed(2)}M | ${r.def}${r.defHalf !== r.def ? '→' + r.defHalf : ''} | ${r.res}${r.resHalf !== r.res ? '→' + r.resHalf : ''} | ${r.lpr} | ${r.phase < 1 ? '×' + (r.physTakenMul) : '-'} | ${r.windowRealS} | ${r.dpsNeeded} | ${cells.join(' | ')} |`);
  }
  console.log('\n每个 cell = max(物理系数, 法术系数)（含 ATK 乘区 × 攻速乘区；两段血池调和平均）\n');
  for (const r of rows) {
    console.log(`## ${r.bossId} ${r.name}  — ${r.note}`);
    for (const [bond, c] of Object.entries(r.channels)) {
      console.log(`   ${bond.padEnd(15)} ATK×${String(c.atkMul).padEnd(5)} 攻速×${String(c.aspdMul).padEnd(5)} ATKeff ${String(c.atkEff).padStart(5)} | 物理 ${c.phys.toFixed(2)} 物理+精准 ${c.physPreci.toFixed(2)} 法术 ${c.arts.toFixed(2)} 法术+精准 ${c.artsPreci.toFixed(2)}`);
    }
    console.log(`   真伤通道 DPS: 叙拉古 ${r.trueChannelDps.siracusa} · 卡西米尔 ${r.trueChannelDps.kazimierz} （需求 ${r.dpsNeeded}）\n`);
  }
}
