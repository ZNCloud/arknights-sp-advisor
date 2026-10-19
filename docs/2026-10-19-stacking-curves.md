# 2026-10-19 叠层曲线三轮实验记录

## spcurve_1446

WIN_FOUND

# REPORT spcurve_1446 — 各家叠层曲线 + 装备触发配合

- 车目录：`<work>/spcurve_1446/`；引擎 = spg06c_0053 同 checkout（docker node:22，`run-node.sh`）
- 开工 2026-10-19 14:45:53（`date` 实测，run.log 首行）；收工见 run.log 末行
- 全部对局产物：`results/<combo>-s<seed>.json`（24 局，每行都有文件）；曲线图 `results/curve_layers.png`、`results/r15_damage.png`
- 组合局全部为**诊断注入**（免费固定阵容 + LP/资金垫底，走引擎公开方法 newPiece/move/equip，`curve.mjs` 头注注明）；自然基线曲线复用 spg06c_0053 `base3-leaktiles-p4.json`（50 seeds，自然打法，未重跑）

## 0. 大白话结论

1. **叠层的核心不在盟约本身，在「驻防干员」（garrison）**：盟约只决定层数加成怎么算，真正每回合+几层的是驻防干员的战斗触发（消耗弹药/击杀/开技能/冻结/部署五类）。引擎实现全在 `engine/server/sim/content/garrisons/battle.js`。
2. **拉特兰的叠层核心 = 弹药消耗**：莫斯提马（周围4格的人每耗6发弹→拉特兰+1/+2，**无每场cap**）+ 圣约送葬人（自己每耗7发→拉特兰+7/+14、远见+3/+6，每场至多7次）+ 魔王（层数增益源站它身前一格→每次增益再+1/+2）。能天使/送葬人/蕾缪安是弹药机枪源。owner 点名的「莫斯提马+圣葬+魔王」正是全引擎最陡的曲线。
3. **最猛曲线 = la_items（拉特兰6人 + 魔王 + 华法琳 + 圣约送葬人带不融冰+加速器）**：R13 每玩家层数 847 层（自然基线只有 ~90），R15 实测 **~192–203k DPS，2/3 seeds 打空 28.8M 血池 = 赢**。上一车结论「要层数×3+全精锐才能打空」被打破：不用层数注入，靠组合叠层就能到 192k 门槛。
4. **没魔王也行但掉一档**：无魔王同阵容 R15 平均 69%（s1015 38% vs 有魔王 91%）；魔王值 ≈ +21% 叠层速率 / R15 +26.5pt。
5. **「老爷爷+源石药剂」实测不如不加**：送葬人带源石溶剂（每秒流失60血）在 s1015 反而 24% vs 38%（无源石溶剂）——挂了掉的 DPS 换不来叠层，判负组合。
6. **能天使+华法琳穷局**：4 个子也能叠到 R13 ~448 层（满编的 ~53–60%），但独立打不穿 R14 boss（只有 17%），只能当**层数支撑件**，不是独立答案。
7. **圣葬+不融冰+加速器确认有效**：不融冰/加速器对曲线本身影响小（+4% 层），但 s1015 上 91.2%→100%（差的就是这点攻速）。s1004 是坏局：所有拉特兰组合都卡在 R14 boss（60–79% 打不死），层数 4141 也救不了——R14 是组合 DPS 硬门槛，不是层数门槛。

## 1. 各阵营叠层机制（代码位置）

引擎三层结构：
- 盟约激活/层数持久：`engine/server/match/bondsMeta.js`（computeBonds:101，activatedLayers:181，BOND_LAYER_CAP=999 见 `shared/constants.js` layerGainRoom；R14 冻结 hiddenLayerSum `match/match/prep.js:175`）
- 战斗内叠层触发（garrison）：`engine/server/sim/content/garrisons/battle.js` —— 事件注册 `:244` useskill、`:252` selfkillenemy、`:266` selfdead、`:288` consume_ammo、`:313` onstart(deploy)、`:336` addition_cnt（魔王）
- **boss 战（R14/R15）不叠层**：`sim/content/support/index.js:321-332`（`flags.layerGainsEnabled`）——叠层全靠 R1–R13，R15 只吃存量，这就是为什么曲线斜率=胜负。

数据在 `engine/data/garrisons.json`（249 条，owners 指到 chess id）。各家「叠层核心」：

| 阵营 | 驱动 | 核心驻防干员（garrison id） | 频率/cap |
|---|---|---|---|
| 拉特兰 | **耗弹** | 莫斯提马 `_22`（周围4格每6发+1/+2，**无cap**）；圣约送葬人 `_23/_55`（每7发→拉+7/+14、远见+3/+6，cap 7次/场）；蕾缪安 `_24`（每10发同排3人→拉/精准+2）；送葬人 `_138`（首杀+3/6） | 无cap/7次 |
| 拉特兰放大件 | — | 魔王 `_59`（增益源在身前一格→每次额外+1/+2）；华法琳 `_72`（身前一格干员开技能→所属盟约+1/2，cap 7/14） | — |
| 谢拉格 | **冻结** | 初雪 `_28/_29`（范围内敌人进冻结 50/60%→+1/2，无每场cap）；装备不融冰 `_5_02`（12/20% 攻击施加寒冷→冻结源） | 无cap |
| 萨尔贡 | **开技能** | 莎草 `_42`(+5/10 首次)、菲莱 `_43`(+6/12 每次)、百炼嘉维尔 `_128`(+9/18 每次)、缇缇 `_125`(睡眠/晕眩+1/2 cap 24/48) | 每次 |
| 维多利亚 | 弱（战斗侧） | 风笛 `_50`（前3杀+2/4）；主要靠获得时 `_35`(+5/10) | 少 |
| 阿戈尔 | **击杀** | 斯卡蒂 `_38`（每2杀+1/2）、海霓 `_131`（首杀+3/6）、幽灵鲨 `_46`/归溟 `_40`（被击倒+3/6、+5/10） | 每杀 |
| 叙拉古 | 击杀 | 伺夜 `_152/153`（前3杀+2/4）、荒芜拉普兰德 `_118`（杀敌+2） | 每杀 |
| 卡西米尔 | **部署** | 砾 `_75/_143`、远牙 `_148`、瑕光 `_106`、锏 `_155`（部署时+层数，cap 12–100） | 每次 |
| 通用 | **prep 收尾** | 助力 deputShip `sim/content/bonds/addon/meta.js:99-108`：prep 结束时所有 active 盟约 +layer（tier2 更多）——跨盟约全体叠层 | 每回合 |

装备对触发频率的作用（`data/items.json`）：
- 有限加速器 `_4_03`：每次攻击攻速+1/2（≤60层）→ 直接加快耗弹频率 → 拉特兰曲线变陡（圣约送葬人/能天使最优）
- 谢拉格不融冰 `_5_02`：12/20% 攻击施加寒冷 → 冻结源（喂初雪+耶拉冈德之泪）
- 源石溶剂 `_1_05`：ATK+40/60% 但每秒流失 60 HP —— 实测**负收益**（见 §0.5）

盟约侧战斗加成只 gate 在 active（`sim/content/bonds/addon/battle.js` 头注；core 侧 `core.js:16-17` 拉特兰 tier2 每发弹全成员 ATK+，与叠层构成复利：层→弹药起始量→更多耗弹→更多层+更多ATK）。

## 2. 叠层曲线（横轴回合，纵轴每玩家层数，4p 均值）

图：`results/curve_layers.png`。自然基线 vs 组合（拉特兰+远见层合计）：

| 回合 | 自然基线(g06_final,50s) 拉特兰 | la_full 注入 | la_items 注入 | no_mowang | ex_warf |
|---|---|---|---|---|---|
| R5  | 0.0 | 132 | 134 | 110 | 78 |
| R8  | 1.7 | 288 | 295 | 269 | 254 |
| R10 | 5.9 | 462 | 475 | 433 | 376 |
| R13 | 14.2 | 812 | 847 | 734 | 448 |

- 自然开局拉特兰 13 回合只叠到 **14 层/人**（而且多半来自买驻防干员的「获得时」）；组合注入到 **847 层/人**，≈ **60×**。hiddenLayerSum 对比：自然最好 1658（上一车）vs la_items 4032（本车，同 seed 1015）。
- 曲线形状：超线性（拟合 L(r)=k·r^a，a≈1.77–1.81，maxErr ≤15%，`results/fit.json`）——耗弹→ATK→杀得快→更多怪次→更多耗弹的复利。
- 魔王：k 7.85 vs 6.46（+21% 速率）；装备：+4% 层但 s1015 差 8.8pt R15 掉血时是关键一击。

## 3. 对局结果表（R1–R15 全程，诊断注入，4p；文件 results/<combo>-s<seed>.json）

| combo | seed | R14 破? | 进 R15? | R15 掉血 | 胜? | hiddenLayerSum | 近似DPS |
|---|---|---|---|---|---|---|---|
| la_full | 1015 | ✓ | ✓ | 91.2% | 否 | 3956 | ~175k |
| la_full | 1049 | ✓ | ✓ | 100% | **是** | 4174 | ~203k |
| la_full | 1004 | ✗(60.2%) | ✗ | — | 否 | 3905 | — |
| **la_items** | **1015** | ✓ | ✓ | **100%** | **是** | 4032 | ~192k |
| **la_items** | **1049** | ✓ | ✓ | **100%** | **是** | 4174 | ~203k |
| la_items | 1004 | ✗(78.3%) | ✗ | — | 否 | 4210 | — |
| la_items_plus(再加源石溶剂/能天使加速器) | 1015/1049 | ✓ | ✓ | 100%/100% | **是/是** | 3776/4046 | — |
| la_items_plus2(4人全加速器) | 1015/1049 | ✓ | ✓ | 100%/100% | **是/是** | — | — |
| la_no_mowang | 1015 | ✓ | ✓ | 38.3% | 否 | 3396 | — |
| la_no_mowang | 1049 | ✓ | ✓ | 100% | **是** | 3868 | — |
| la_yuanse(老爷爷+源石溶剂) | 1015 | ✓ | ✓ | 24.0% | 否 | 3386 | — |
| la_yuanse | 1049 | ✓ | ✓ | 100% | **是** | 4034 | — |
| ex_warf / ex_warf_acc | 3 seeds | ✗(17.3%) | ✗ | — | 否 | 1344–2224 | — |
| 自然基线（上一车,同引擎50seeds） | — | 2/50 | 1/50 | 21.1%(s1015) | 0/50 | 1658 | ~66k 天花板 |

- 近似DPS = 掉血×28.8M / (150s + teamLP)（overtime 每秒排1 LP，bossRounds.js:494-505）；打空门槛 192k（spr15cap_0213 实测）——la_items 正好压线过。
- s1004 边界：所有拉特兰组合 R14 boss 卡 60–79%，再加装备/加攻速无效（79% 不动）——R14 boss 窗口内组合 DPS 硬上限，层数 4141 无用。坏局需要换阵容结构（如补高练度非拉特兰输出位），本车未解。

## 4. 数学模型改动（sp-advisor）

- 新增 `sp-advisor/model/stacking.mjs`（纯数据模块，零依赖，node 直测通过）：
  - `STACKING_COMBOS`：5 组合的 L(r)=k·r^a 拟合参数（本车 24 局最小二乘，results/fit.json）+ `layersAt(tag,r)`
  - `CAN_CLEAR_R14`：层数够 ≠ 过 R14 的实测判据（R14=DPS 门槛）
  - `r15Dps(poolDamage, teamLp)`：R15 近似 DPS（含 overtime 排空）
  - 模型内写明魔王 +21%、装备 +4%层/胜负关键、ex_warf 只可 r≤10 信任（cap 压平）等校准注记
- 未改任何既有评估路径（advice/search 不受影响）；接入点建议：`search/core.mjs` decide 的阵容评分里对驻防干员组合（拉特兰耗弹组+魔王）加 `layersAt` 曲线项——本车只交模型与校准，未动评分器（改评分需要重跑回归，超出本车时间盒）。

## 5. 卫戍与合规

- 全部只写本车目录 `<work>/spcurve_1446/`；宿主无 /tmp 写入；docker 跑引擎（run-node.sh，user 映射非 root）
- run.log grep（FAIL/MISMATCH/NaN/Error/NOT FOUND）= 0 命中（15:08:23 复查）
- 组合局 injection:true + note 标注诊断注入，与自然基线分开引用
- CodeKG 考古说明：本任务主体是对 data/garrisons.json（数据表）+ garrisons/battle.js 的全量机制清点，属「全表扫描」型查询，CodeKG 语义检索不覆盖数据文件；机制定位用 grep 走的 garrisons/battle.js 单文件精读（516 行）+ bondsMeta/core.js 精读，未做大规模代码 grep。

## 6. 下一段可续派的活

1. **s1004 类坏局的 R14 破门**：la_items 78% 卡 R14 boss，试「拉特兰组合 + 2 高练度他盟约输出位」混编（引擎允许，注入框架现成 curve.mjs）。
2. **自然开局逼近 la_items 曲线**：g06_final 的买人策略改为优先拿拉特兰耗弹组+魔王（guide 变体），验证不注入能叠到多少——上一车差距主因就是没人拿驻防组。
3. **谢拉格冻结曲线**：初雪(_28/29)+不融冰+耶拉冈德之泪的 kjerag 曲线本车只做了机制清点未跑对局（owner 点名里它是第二顺位）。
4. **接入评分器**：stacking.mjs 接进 search/core.mjs 阵容评分 + 50-seed 回归。

## spcurve2_1527

# REPORT — spcurve2_1527（卫戍协议叠层曲线 · 第二轮）

**判定：WIN_INJECTED_ONLY**（首行判定词见上）
时间：2026-10-19 15:23 开工 ~ 18:4x 收工。工作目录 `<work>/spcurve2_1527/`（独立车目录，未改 spcurve_1446 原件）。

## 0. 结论一览

| 任务 | 结果 |
|---|---|
| ① 自然开局（无注入）逼近拉特兰曲线 | **未达标**：g06_la_natural guide 50 seeds×4p → 0/50 通关、r14K 2%、p50 第 11 回合淘汰；每玩家 r13 层数 laterano+visi≈14.6 / kjerag≈29.9，与注入 la_items（r13≈858）差 ~30–80× |
| ② 破 s1004 第 14 关 boss | **达成（注入）**：谢拉格冻结流 kj_items 在 s1004 **R14 100% 击杀 + R15 100% 通关**（拉特兰系最高只到 78.5%） |
| ③ 量谢拉格冻结流曲线 | 7 seeds（1004/1005/1007/1011/1013/1015/1049）**7/7 全胜、R15 全部 100%**；曲线 L(r)=23.19·r^1.269（kjeragShip 口径），r13 均值 394 层 |
| ④ 写进 sp-advisor | `sp-advisor/model/stacking.mjs` 新增 `kj_items` / `la_mix` / `natural_g06` 三条 + 头注数据源更新；`results/fit.json` 重算（7 组合） |

## 1. 核心发现：谢拉格冻结流全面强于拉特兰叠层（注入口径）

7 seeds 正面对比（诊断注入、4p）：

| combo | R14 击杀 | R15 通关 | 层均值(r13) | 曲线 k·r^a |
|---|---|---|---|---|
| **kj_items 谢拉格冻结流** | **7/7** | **7/7 (100%)** | 394 | 23.19·r^1.269 |
| la_items 拉特兰+装备 | 5/7 | 3/7 (87.7% 均) | 858 | 15.63·r^1.403 |
| la_mix/mix2/mix3/mix4 混编 | 仅 s1049 过 | 0/3 每 | 516–728 | a≈1.46–1.65 |

- 失败 seed：la_items s1004 r14=78.5%、s1007 r14=46.0%；s1011 R15 只 57.1%。**kj_items 在这些坏局全部 100%**。
- 冻结流配置：初雪 `chess_char_3_14_a`（garrison_28：范围内冻结 50% 概率 +1/2 层）+ 圣聆初雪 `chess_char_6_02_a`（带**谢拉格不融冰_b + 耶拉冈德之泪_b 双件套**：对寒冷/冻结敌人 30%→100% atk 法伤/s）+ 灵知 `chess_char_4_13_a` + 耶拉 `chess_char_4_03_a` + 凛御银灰 `chess_char_5_14_a` + 锏 `chess_char_6_19_a`。
- 机制解释：拉特兰流是「层数→爆发 DPS」（r13 层数 2.2× 于冻结流但 R15 看运气）；冻结流层数低但**冻结控制让 boss 常年停在寒冰判定里吃 100% atk 真伤/s**，对 seed 的地图/随局方差免疫 → 7/7 稳定。
- **混编不可取**：拉特兰5+维娜/拉普兰德/锏等（la_mix*）全部弱于纯拉特兰——混编稀释了 garrison 触发频次（曲线 a 从 1.40 降到 1.46–1.65 的同时 k 掉一个量级）。owner 的「拉特兰+2 高练度」方向在本引擎实测不成立，破关应整队换冻结流。

## 2. 修掉的引擎事实（本车新确认）

- `deployCap` 由 `shop.level` 决定（`engine/server/match/player/basics.js:30`，`gamedata.js:36`）——注入脚本必须先 `ps.shop.level=9` 再落位，否则 cap=4 只放得下一半。
- 换局地形变化会置 `_legalityStale`，下一次 `recompute()` 走 `_evictIllegal()`（`basics.js:279`）把站在不再合法格上的子静默撤回手牌；`_liftOutOfRange`（`placement.js:118`）只管 token。注入框架加了 6 轮补位 pass 后 6/6 子稳定在板（此前 kj 局只有 4/6）。
- 魔王/华法琳的 `sourceInFront` 邻接（`garrisons/battle.js`）：整体搬家修邻接会破坏 DPS 站位（s1004 la_items 从 78.5% 掉到 60%），只做「已贴合时修朝向」才是对的。
- 自然开局连 boss_7 常规关都过不去（0/50 genericVictory，43 局 `eliminated`/6 局 `defeat`/1 局 `victory`）——自然策略上限远低于注入，两层曲线**不能混用同一尺度**。

## 3. 产物清单

- `curve.mjs`：注入框架（本车独立副本）——shop.level 前置、_legal 过滤落位、6 轮 evict 补位 pass、贴合修向 pairFix。
- `guides/g06_la_natural.json`：自然开局 guide（g06_final 改版：拉特兰 coreOrder 优先、魔王/华法琳 producers、蕾缪安/新约能天使/圣葬 terminals）+ `sp-advisor/guides/policy.mjs:79` 加 3 组邻接 pairs。
- `results/`：`la_items/kj_items/la_mix{,2,3,4}-s{seed}.json` ×7 seeds、`la-natural-p4.json`（50 seeds）、`fit.json`（7 组合幂律拟合）、`curve_layers.png`、`r15_damage.png`。
- `analyze2.py`：本车曲线分析（自然基线表 + 组合曲线 + 拟合 + 两张图）。
- `sp-advisor/model/stacking.mjs`：新增 `kj_items {k:23.19, a:1.269}`、`la_mix`、`natural_g06 {k:0.21, a:1.516}`（自然基线拟合）+ 头注。

## 4. CodeKG 考古（硬要求，真实命令与输出）

```
$ cd <work>/ckg_race/distill
$ python3 query.py text "garrison 魔王 叠层" --limit 3
[query] meta: repo=dcc source_commit=c50d70f95dbf source_ref=mirror/HEAD build_time_utc=2026-10-18T20:21:28Z
[query] meta: repo=serving source_commit=8db8dacfa732 source_ref=mirror/HEAD build_time_utc=2026-10-18T20:21:28Z
[query] meta: repo=MemoryCore source_commit=e9a82935b527 source_ref=mirror/HEAD build_time_utc=2026-10-18T20:21:28Z
[query] meta: repo=mblend source_commit=7337e0d995af source_ref=mirror/HEAD build_time_utc=2026-10-18T20:21:28Z
[query] meta: repo=muse-webapp source_commit=9a10fd896bd8 source_ref=rest/tarball build_time_utc=2026-10-18T20:21:28Z
$ python3 sqlq.py "SELECT repo,path,name FROM defs WHERE name LIKE '%garrison%' OR name LIKE '%deployCap%' LIMIT 5"
repo  path  name
(0 rows)
```

**负面结论（真实发现）**：CodeKG 七仓（meshyd/webapp/dcc/serving/MemoryCore/mblend/muse-webapp，index build 2026-10-18T20:21:28Z，defs 195,494 条）**不含卫戍协议引擎仓**，`garrison`/`sourceInFront`/`deployCap` 全部 0 命中。本报告所有引擎事实（§2 的 file:line）来自直接读源码 `spcurve2_1527/engine/server/...`。建议：若后续 sp 选题常态化，把引擎仓加进 `repos.tsv` 蒸馏清单。

## 5. 局限与下一步

- 自然开局 0/50 是 guide 策略的上限，不代表人类玩家；若要真逼近，需 RL/搜索式出牌而非固定 guide。
- 曲线拟合用的注入局把 board 清空重摆，胜负判定（r14K/r15）可信，但早期回合经济路径与真实对局不同——自然与注入之间没有中间态实验。
- 谢拉格流尚未试「冻结流+拉特兰装备位」的 8 人混合（deployCap=8 下 kj 6 人 + 2 空），可能是下一步涨分点。

## spcurve3_1612

# REPORT — spcurve3_1612（卫戍协议第三轮：自然开局凑谢拉格冻结流）

NO_NATURAL_WIN

时间（全部取自 `date '+%F %T'` 真实输出，run.log 留痕）：开工 2026-10-19 16:09:46；smoke 3 seeds 完成 16:16:21；31 seeds 完成 16:16:45；收工 16:20:40。工作目录 `<work>/spcurve3_1612/`（复制 spcurve2_1527 的 curve.mjs/engine/sp-advisor/run-node.sh，未改原件；run-node.sh 的 cd 路径已改为本车）。

## 0. 大白话结论

自然开局凑不出谢拉格冻结流，31 个种子 0/31 凑齐、0/31 过 R14。不是站位问题，是**穷**：
- 钱常年 ≤1（guide 全程 funds p50=1），一半局在第 8 回合就被淘汰潮带走（R8 淘汰 11/31，p50 淘汰回合 = 9）；
- 核心 6* 终端**圣聆初雪在 30/31 局里从头到尾没进过商店**（剩下 1 局 s1004 见到买了，第 11 回合还是死了，装备一件没装上）；
- 最好的一局 s1015 苟到第 13 回合，凑出 4 产（耶拉/初雪/灵知/凛御银灰）+ 凛御银灰终端 + 2 张不融冰，r13 层 233——也只有注入 kj_items（r13≈394，且是 4 人各摆满编）的零头。

**判定：NO_NATURAL_WIN**（0/31 凑齐、0/31 R14 击杀、0/31 进 hidden；下界置信 95% CI [0, 0.110]）。

## 1. 逐种子表（31 seeds × 4p，g07_kj_natural guide，无注入）

| seed | 结局 | 淘汰回合 | 凑齐回合 | r13 层(kj席) | r14 伤 | 终局 产/终/装备 |
|---|---|---|---|---|---|---|
| 1015 | eliminated | 13 | - | 233 | - | 4/1(凛御银灰)/2件(不融冰×2) |
| 1027 | eliminated | 13 | - | 101 | - | 3/0/2 |
| 1003 | eliminated | 12 | - | - | - | 2/0/0 |
| 1022 | eliminated | 12 | - | - | - | 3/0/1 |
| 1004 | defeat | 11 | - | - | 28.9% | 2/1(圣聆初雪)/0 |
| 1023/1026 | eliminated | 11 | - | - | - | 0-3/1/1 |
| 1009/1018/1024/1025/1031 | eliminated | 10 | - | - | - | 0-3/0-1/0-1 |
| 1001/1005/1006/1014/1020/1029 | eliminated | 9 | - | - | - | 0-2/0/0 |
| 1002/1007-1008/1010-1013/1016-1017/1021/1028 | eliminated | 8 | - | - | - | 0-3/0/0-1 |
| 1019/1030 | eliminated | 7 | - | - | - | 2/0/1 |

- 凑齐口径 = 4 产（初雪/灵知/耶拉/凛御银灰）+ ≥1 终端（圣聆初雪/锏）同时在板 + kjeragShip 激活：**0/31**。
- 两件套（不融冰 chess_item_5_02_e_b + 耶拉冈德之泪 chess_item_6_06_e_b）：**不融冰 9/31 局经奖励位拿到**（定向加权生效），耶拉冈德之泪 0/31（商店/奖励里没刷出来过）。
- 注入对比（同图 `results/nat_vs_inject.png`）：kj_items 注入 7 seeds 7/7 R14 100% 击杀、R15 100% 通关；自然 g07 同 seed（1004/1005/1007/1011/1013/1015/1049）全部未活到 R14。

## 2. 卡在哪（逐条归因）

1. **没刷到（主因）**：圣聆初雪 6* 30/31 局从未出现在商店——p0 商店等级到死只有 4-5 级（levelTargets 抬级要钱），6* 根本不在池。耶拉冈德之泪同理 0/31。
2. **钱不够（次因，且互为因果）**：淘汰局 funds 终值 0-1；自然经济（cycle/投资）引擎 seat 不在 kj 席（style=general 无 econSeat），kj 席花钱买 4 产已经掏空。
3. **站位被撤：本车未观察到**。guide 每轮 arrangeGuide 重摆 + pairTraits 新增 ['初雪','圣聆初雪']/['灵知','圣聆初雪'] 邻接，未出现 _evictIllegal 掉子案例（自然局换地形本来就少活过 R10）。
4. 结构性差距：hiddenLayerSum=Σ 全队 activatedLayers（prep.js:175），注入局是 4 人各摆满编 kj（层 2000-4000），自然局只有 1 个 kj 席 + reservation 把谢拉格子锁给 p0——就算不穷也差 4 倍身位。

## 3. 改进建议（已写进 sp-advisor 评估）

`sp-advisor/model/stacking.mjs` 新增 `natural_g07 {k:2.51, a:1.403}`（kj 席幂律拟合，r13 91.7 层期望，267 样本）+ 头注卡点分析。建议原文：

> 两装备靠奖励位白拿有效（9/31），但终端 6* 必须给 kj 席专项经济——把 visiAllDiscount/invest 让给 kj 席、或 reservation 放开多席 kj（每席自刷自买），否则冻结流自然开局没有可用窗口。

副产品：policy.mjs（本车副本）加了两处可复用钩子——`spec.itemIds` 商店定向加权（+40）与定向穿戴（优先 route terminals）。

## 4. CodeKG 考古（硬要求）

```
$ cd <work>/ckg_race/distill
$ python3 query.py like "%hiddenLayerSum%" --limit 5
（仅 meta 行：dcc/serving/MemoryCore/mblend/muse-webapp 7 仓索引 2026-10-18T20:21:28Z，0 命中）
$ python3 query.py text "kjerag freeze garrison" --limit 3
（仅 meta 行，0 命中）
```

与第二轮结论一致：CodeKG 七仓不含卫戍协议引擎仓；本报告引擎事实来自直接读 `spcurve3_1612/engine/server/match/…`（hiddenLayerSum=Match.js:504/bossRounds.js:558/prep.js:175）。

## 5. 产物清单

- `guides/g07_kj_natural.json`：自然开局冻结流 guide（kjeragShip 优先 + itemIds 定向两装备）。
- `sp-advisor/guides/policy.mjs`：itemIds 商店/穿戴定向钩子 + 冻结源邻接 pair ×2。
- `results/kj-natural-p4.json`（31 seeds 原始）、`kj-nat-smoke.json`（3 seeds smoke）、`kj-nat-summary.json`（逐 seed 摘要）、`nat_vs_inject.png`（自然 vs 注入层曲线 + R14 伤柱图）、`kj_items-s*.json`+`fit.json`（自 spcurve2 复制供画图）。
- `analyze3.py`：逐 seed 凑齐/淘汰/层数提取 + 拟合 + 出图。
- `run.log`：全部真实输出含时间戳。

## 6. 下一段可续派的活

1. **多席 kj 实验**：reservation 放开 2-2 分席（两席各刷谢拉格子），看层 sum 能否翻倍逼近 hidden 门槛（hiddenEligible 的 layerSum 门槛值可先读 bossRounds.js:558）。
2. **kj 席经济专项**：economy.cycle 让 p0 兼 kj 席（style 改 'cycle'），验证「钱」假设是否唯一卡点。
3. **无 6* 下位替代**：圣聆初雪刷不到时用 锏/凛御银灰 终端 + 不融冰 的自然流上限（s1015 已苟到 R13，值得单独扫 50 seeds）。

容器已随 run-node.sh `--rm` 自毁（docker ps 无残留）。

