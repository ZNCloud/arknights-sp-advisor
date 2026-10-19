// sp-advisor/model/stacking.mjs — 叠层曲线模型（spcurve_1446 实测校准，2026-10-19）。
//
// 数据源：引擎 garrison 层数引擎（engine/server/sim/content/garrisons/battle.js：
//   *_consume_ammo 每耗 N 发弹 → 层数、*_addition_cnt 魔王放大、*_useskill/_selfkillenemy 等）
// + 本车 6 组合 × 3 seeds × 4p 实测（REPORT_spcurve_1446.md；results/fit.json）。
// 模型：每玩家回合 r 的（拉特兰+远见）层数 L(r) = k·r^a，最小二乘拟合（对数空间），
//   la_* 组合最大误差 ≤15%；ex_warf 曲线后段受「每场战斗至多 N 次」cap 压平，幂律仅
//   前 10 回合可用（maxErr 43%，用的时候只在 r ≤ 10 信任它）。
// 魔王（garrison_59，站 REMOTE 位对身前一格 garrison 层数增益 +1/+2）：k 7.85 vs 6.46
//   （≈ +21% 层速率），R15 掉血 +26.5pt（95.6% vs 69.1%，s1015）。
// 装备对曲线影响小（+4% 层）但对胜负关键：s1015 la_full 91.2% → la_items 100%（胜）。
// 本车 spcurve2_1527（2026-10-19）：s1004/1007 等「坏局」R14 卡 60-79% → 拉+谢混编（la_mix*）全部
//   更弱（R15 52-73%，0/3 胜）——混编稀释 garrison 触发频次，不值得。真正破关的是纯谢拉格冻结流：
//   kj_items 7/7 seeds 100% 通关（含 la 打不过的 s1004/s1007），R15 曲线 k=23.2 a=1.27（计 kjeragShip 层），
//   初雪（garrison_28 范围冻结+叠层）+ 圣聆初雪 + 灵知 + 耶拉 + 银灰 + 锏，圣聆带不融冰+之泪双件套
//   （寒冷/冻结敌人吃 100% atk 法伤/s）。层数只有拉特兰一半（r13 394 vs 858）但控制换输出稳赢。
// 自然开局（g06_la_natural guide, 50 seeds×4p, 无注入）：0/50 通关、r14K 2%、p50 第 11 回合淘汰；
//   每玩家 r13 层数 laterano+visi ≈14.6、kjerag ≈29.9 —— 注入组合比自然开局高 ~30-80× 层，
//   所以 la_items R13 858 vs 自然 14.6；advisor 评估注入方案时不得与自然曲线混用同一尺度。
// 穷局（能天使+华法琳+送葬人+圣约送葬人，4 子）：叠层速率 ≈ 满编拉特兰的 ~80%（r13
//   634 vs 735 层——层数不小！），但独立 R14 boss 只打 17%（DPS 不足），只能当层数支撑件。
// 打空 R15 门槛 ≈192k DPS（spr15cap_0213 实测）；la_items 实测 ~192-203k DPS，2/3 seeds 打空。
// 本车 spcurve3_1612（2026-10-19）：自然开局凑冻结流（g07_kj_natural guide, 31 seeds×4p, 无注入）：
//   0/31 凑齐（4产+1终+kj激活），0/31 R14 击杀，p50 第 9 回合淘汰（R8-9 占 17/31）；
//   kj 席 r13 层 101-233（k=2.51 a=1.403，p0 席），只有注入 kj_items r13 394 的 26-59%，
//   更致命的是圣聆初雪（6*终端）终局在板率 0/31、双件套只有 9/31 装上——
//   卡点=钱：guide 全程 funds≤1，6* 在 R8 淘汰潮前既刷不到也买不起。
//   改进方向（已写进 guide 评估）：两装备(不融冰/之泪)靠奖励位白拿有效（9/31），但终端 6*
//   必须给 kj 席专项经济（如 visiAllDiscount/invest 让给 kj 席或 reservation 换多席 kj），
//   否则冻结流自然开局没有可用窗口。

export const STACKING_COMBOS = {
  la_full:       { k: 7.85, a: 1.77, rMax: 14, note: '拉特兰6(送葬人/能天使/莫斯提马/圣约送葬人/蕾缪安/塑心)+魔王+华法琳；R15 95.6%均, 1/3胜' },
  la_no_mowang:  { k: 6.46, a: 1.81, rMax: 14, note: '同上去魔王；R15 69.1%均, 1/3胜' },
  la_items:      { k: 7.76, a: 1.79, rMax: 14, note: 'la_full+圣约送葬人[谢拉格不融冰_b+有限加速器_b]；R15 100%均, 2/3胜（WIN）' },
  la_yuanse:     { k: 6.67, a: 1.80, rMax: 14, note: '无魔王, 送葬人[源石溶剂_b]（owner「老爷爷+源石药剂」）；R15 62.0%均, 1/3胜——弱于纯 no_mowang' },
  kj_items:      { k: 23.19, a: 1.269, rMax: 14, note: '谢拉格冻结流（spcurve2_1527）：初雪/圣聆初雪/灵知/耶拉/银灰/锏，圣聆[不融冰_b+之泪_b]双件套；层数计 kjeragShip；7/7 seeds 100% 通关含坏局 s1004/s1007' },
  la_mix:        { k: 5.33, a: 1.512, rMax: 14, note: '拉特兰5+魔王+华法琳+维娜：混编稀释触发，R15 52.7%均 0/3 胜——不要混编' },
  natural_g06:   { k: 0.21, a: 1.516, rMax: 13, note: '自然开局基线（g06_la_natural guide, 50 seeds）：每玩家 laterano+visi+kjerag r13≈55 层, k=0.21 a=1.516, 0/50 通关; 仅作 advisor 下界参照' },
  natural_g07:   { k: 2.51, a: 1.403, rMax: 13, note: '自然开局谢拉格冻结流（g07_kj_natural guide, 31 seeds, spcurve3_1612）：kj席 k=2.51 a=1.403, r13 101-233 层=注入 kj 的 26-59%; 0/31 凑齐、0/31 过 R14、圣聆初雪 0/31 在板——钱不够刷不到 6* 终端, 仅作下界参照' },
  ex_warf:       { k: 1.65, a: 2.32, rMax: 10, note: '穷局4子（r>10 受 cap 压平, r13 实测448）；独立过不了 R14, 只作层数支撑' },
};

/** 组合在第 r 回合的每玩家（拉特兰+远见）期望层数；r 超出可信域返回外推值（调用方自慎）。 */
export function layersAt(tag, r) {
  const c = STACKING_COMBOS[tag];
  if (!c) return 0;
  return c.k * Math.pow(r, c.a);
}

/** /3 seeds 过 R14 的实测数（层数够 ≠ 过 R14：R14 是组合 DPS 硬门槛）。 */
export const CAN_CLEAR_R14 = { la_full: 2, la_items: 2, la_no_mowang: 1, la_yuanse: 1, ex_warf: 0 };

/** R15 期望 DPS（近似：150s 窗 + teamLP 每秒排 1；打空门槛 ≈192k/s）。 */
export function r15Dps(poolDamage, teamLp) {
  const dur = 150 + Math.max(0, teamLp || 0);
  return poolDamage / dur;
}
