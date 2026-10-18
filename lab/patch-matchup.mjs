// advisor-dev/lab/patch-matchup.mjs — 给路线画像补「流派政策」与「策略用法」，幂等。
//   node advisor-dev/lab/patch-matchup.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, '..', 'routes', '_matchup.json');
const j = JSON.parse(fs.readFileSync(file, 'utf8'));

// 每条路线的运营政策：升级上限（到第几回合为止压在几级）、刷新优先级、合精锐优先级
const POLICY = {
  siracusaShip: {
    levelCap: { level: 2, untilRound: 8 },   // 二本流：2 本停到 8 回合
    refresh: 1.0, merge: 0.9,
    note: '二本叙：2 回合升 2 后长时间停在 2 本，靠「刷新」叠层（拉普兰德每次首次主动刷新 +4），9 回合前后再升本',
  },
  yanShip: {
    levelCap: { level: 4, untilRound: 6 },
    refresh: 0.9, merge: 0.7,
    note: '炎：靠「获得时」叠层，买人比升级重要；升本要跟在关键干员之后',
  },
  kjeragShip: {
    levelCap: { level: 4, untilRound: 7 },
    refresh: 0.7, merge: 0.8,
    note: '谢拉格：先叠灵巧/迅捷做底，7 回合前必须拿到灵知',
  },
  victoriaShip: {
    levelCap: { level: 3, untilRound: 6 },
    refresh: 0.6, merge: 0.8,
    note: '维多利亚：装备=伤害，升本只为拿高阶装备与主C；前期别在 2 本、4 本久留',
  },
  kazimierzShip: {
    levelCap: { level: 4, untilRound: 7 },
    refresh: 0.7, merge: 0.7,
    note: '卡西米尔：靠「部署次数」叠层，远牙+再部署是引擎',
  },
  egirShip: {
    levelCap: { level: 4, untilRound: 5 },
    refresh: 0.6, merge: 0.8,
    note: '阿戈尔：5 人即满配，7 回合升 5 本；层数只加血，输出靠吃高本卡与外援转职',
  },
  lateranoShip: {
    levelCap: { level: 4, untilRound: 7 },
    refresh: 0.7, merge: 0.8,
    note: '拉特兰：6 名不同干员才成型，前期先开 3 人档',
  },
  sargonShip: {
    levelCap: { level: 4, untilRound: 6 },
    refresh: 0.85, merge: 0.6,
    note: '萨尔贡：靠开技能次数叠层，要 5 本才刷得出异客/佩佩',
  },
};

// 「按长处触发策略」：策略的机制怎么用才不浪费
const BAND_USAGE = {
  band_duyaoy: '杜遥夜：每回合前 2 次主动刷新会锁出炎干员 → 把这 2 次留到钱够买时再用，别先刷光',
  band_orchid: '梓兰：每次刷新必出 2 名同名并冻结其一 → 刷对子时收益最大',
  band_justin: '小贾斯汀：1/4/7/10 回合给储蓄罐（1~6 金）→ 第 4/7/10 回合前把钱花到 5 以下更划算',
  band_cannot: '坎诺特：留 ≥5 金每回合 +1 且资金可继承 → 别把钱花光',
  band_sarkazb: '歌利亚：起始 45 血 → 用血量换中期投资（敢停本、敢放血）',
  band_ermengard: '埃芒加德：前 3 个被击倒的干员立刻复活 → 站位可以更激进',
  band_bldsk: '华法琳：开战时每个不同等阶 1 名干员所属盟约 +2 层 → 覆盖的等阶越多越赚',
  band_yu: '余：第 8 回合仅 1 个激活盟约 +36 层、否则各 +12 层 → 单核流派吃满',
};

let n = 0;
for (const [bondId, policy] of Object.entries(POLICY)) {
  if (!j.routes[bondId]) continue;
  if (JSON.stringify(j.routes[bondId].policy) !== JSON.stringify(policy)) {
    j.routes[bondId].policy = policy;
    n += 1;
  }
}
j.bandUsage = { ...(j.bandUsage || {}), ...BAND_USAGE };
j.policyNote = 'policy = 该流派的运营政策（levelCap/refresh/merge）供顾问判断「该升还是该刷」；bandUsage = 策略机制的正确用法（按长处触发）。';

fs.writeFileSync(file, JSON.stringify(j, null, 2));
console.log(`已写入 policy（${n} 处更新）与 bandUsage（${Object.keys(BAND_USAGE).length} 条）→ ${file}`);
