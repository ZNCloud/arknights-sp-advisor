// Writes docs/distill-features.md: every dimension of the student input (distill/features.mjs) with its meaning.
//   node sp-advisor/distill/features-doc.mjs            (rerun after changing features.mjs / features-table.mjs)
import { writeFileSync } from 'node:fs';
import { makeMatch } from '../eval/engine.mjs';
import { studentNames, FEATURE_VERSION } from './features.mjs';

const SCALAR = {
  round: '当前回合', roundsToBoss: '离 BOSS 回合（R14）还有几回合', lp: '自己的血（LP）', funds: '自己的钱', level: '商店（调度中心）等级',
  upgradePrice: '升下一级要多少钱', refreshPrice: '刷新一次多少钱', freeRefreshes: '剩余免费刷新次数', deployCap: '能上场几个',
  teamLp: '队伍共享 LP', aliveN: '还活着的人数', hiddenLayerSum: '隐藏 BOSS 用的全队层数累计', creditedKills: '自己的击杀数',
  'boss.hp': '本回合 BOSS（R15 起是隐藏 BOSS）最大血量', 'boss.atk': 'BOSS 攻击', 'boss.def': 'BOSS 防御', 'boss.res': 'BOSS 法抗', shopFrozen: '商店是否冻结（1/0）',
};
const UNIT = {
  present: '这个格子有没有干员（1/0）', tier: '阶（费用档）', golden: '是否精锐（合成过）', price: '原价', atk: '攻击', def: '防御', hp: '最大血量',
  res: '法抗', bat: '攻击间隔', aspd: '攻速', range: '攻击范围格数', block: '阻挡数', fly: '能否打飞行（1/0）', ranged: '远程位（1/0）',
  dmg_phys: '物理伤害（1/0）', dmg_arts: '法术伤害（1/0）', dmg_heal: '治疗（1/0）', skillAtk: '技能攻击倍率', skillTimes: '技能连击次数', skillSp: '技能费用（SP）',
  row: '站位行（场上才有）', col: '站位列', items: '装备件数', itemTier: '装备阶之和', copies: '自己一共有几张同名（含精锐）', b_: '属于盟约 <名字>（1/0）',
};
const BOND = { count: '在场人数（盟约计数）', tier: '激活档位', active: '是否激活（1/0）', layers: '层数', pace: '层数 ÷ 自然开局同回合的参考层数（快慢）', projR13: '按幂律外推到 R13 的层数' };
const MATE = { present: '这个座位有人（1/0）', alive: '活着（1/0）', lp: '血', level: '商店等级', board: '上场人数', layersTotal: '所有盟约层数之和', mainLayers: '层数最多的那条盟约的层数' };

function meaning(n) {
  if (SCALAR[n]) return SCALAR[n];
  let m;
  if ((m = n.match(/^(board|hand|shop)(\d+)\.(.+)$/))) {
    const where = { board: '场上第', hand: '手牌第', shop: '商店第' }[m[1]] + (+m[2] + 1) + (m[1] === 'board' ? '强' : m[1] === 'hand' ? '强' : '格');
    return `${where}：${m[3].startsWith('b_') ? UNIT.b_.replace('<名字>', m[3].slice(2)) : UNIT[m[3]]}`;
  }
  if ((m = n.match(/^bond\.(.+)\.(\w+)$/))) return `自己的盟约 ${m[1]}：${BOND[m[2]]}`;
  if ((m = n.match(/^boss\.(boss_\d+)$/))) return `R14 BOSS 是 ${m[1]}（1/0）`;
  if ((m = n.match(/^hidden\.(boss_\d+)$/))) return `隐藏 BOSS 是 ${m[1]}（只在 R15 揭晓后为 1）`;
  if ((m = n.match(/^mate\+(\d)\.(\w+)$/))) return `下家第 ${m[1]} 位队友（公开）：${MATE[m[2]]}`;
  if ((m = n.match(/^mate\+(\d)\.(.+)\.(count|layers)$/))) return `下家第 ${m[1]} 位队友（公开）：盟约 ${m[2]} 的${m[3] === 'count' ? '在场人数' : '层数'}`;
  throw Error(`no meaning for feature ${n}`);
}

const m = makeMatch(1, 4), { names, selfN, bosses, bonds } = studentNames(m.gd); m.dispose();
const lines = [`# 学生网络的输入（FEATURE_VERSION ${FEATURE_VERSION}，${names.length} 维）`, '',
  '本文件由 `node distill/features-doc.mjs` 生成，改了 `distill/features.mjs` 或 `advisor/features-table.mjs` 就重新生成。', '',
  '## 分块', '', '| 维度 | 块 | 说明 |', '|---|---|---|',
  `| 0–${selfN - 1} | 自己 | \`advisor/features-table.mjs\` 的 tableSelf：回合、经济、当前 BOSS 属性；场上 10 格、手牌 6 格（都按强度从高到低排）、商店 5 格，每格一组干员属性；每条盟约 6 个数 |`,
  `| ${selfN}–${selfN + 2 * bosses.length - 1} | BOSS 是谁 | R14 BOSS 独热 ${bosses.length} 维 + 隐藏 BOSS 独热 ${bosses.length} 维（R15 揭晓前全 0，和顾问推演的约定一样） |`,
  `| ${selfN + 2 * bosses.length}–${names.length - 1} | 三个队友 | 按座位顺序的下家 1、2、3，**只用公开视图**（m.publicView().players，真人客户端也看得到的）：每人 7 个数 + 每条盟约（${bonds.length} 条）的在场人数和层数。不含队友的钱、手牌、商店 |`,
  '', '干员属性只用数值（阶、攻防血、射程……），不用干员编号，所以游戏数值改了输入会跟着变。', '',
  '## 每一维', '', '| # | 名字 | 含义 |', '|---|---|---|', ...names.map((n, i) => `| ${i} | \`${n}\` | ${meaning(n)} |`), ''];
writeFileSync(new URL('../docs/distill-features.md', import.meta.url), lines.join('\n'));
console.log(`docs/distill-features.md: ${names.length} dims`);
