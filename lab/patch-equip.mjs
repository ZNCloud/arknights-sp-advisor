// advisor-dev/lab/patch-equip.mjs — 给每条路线加「装备权重」与「悬赏估值参数」，幂等。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, '..', 'routes', '_matchup.json');
const j = JSON.parse(fs.readFileSync(file, 'utf8'));

// 装备对每条路线的边际价值（0-1）：维多利亚「装备=伤害」最高；阿戈尔吃的是干员面板，装备边际低
const EQUIP_BIAS = {
  victoriaShip: 1.0,
  lateranoShip: 0.6,
  kazimierzShip: 0.55,
  kjeragShip: 0.5,
  siracusaShip: 0.5,
  yanShip: 0.45,
  sargonShip: 0.45,
  egirShip: 0.3,
};

let n = 0;
for (const [bondId, bias] of Object.entries(EQUIP_BIAS)) {
  const r = j.routes[bondId];
  if (!r) continue;
  r.policy = r.policy || {};
  if (r.policy.equipBias !== bias) { r.policy.equipBias = bias; n += 1; }
}
j.equipNote = 'equipBias = 这条路线买装备的边际价值（0-1）。维多利亚「每件装备 +50%/进阶 +80% 攻击」最高；阿戈尔吃干员面板与吞噬，装备边际最低。';

// 悬赏（机变）估值参数：收益 vs 风险的换算
j.bountyModel = {
  note: '悬赏估值：score = payout + coin*0.5 + tier*4 − rounds*3 − 难度惩罚。参数可调。',
  perRoundCost: 3,
  coinWeight: 0.5,
  tierWeight: 4,
  bossPenalty: 25,
  elitePenalty: 10,
};

fs.writeFileSync(file, JSON.stringify(j, null, 2));
console.log(`equipBias 写入 ${n} 条；bountyModel 已写`);
