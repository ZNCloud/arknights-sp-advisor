# PRIOR-ART —— 「卫戍协议：盟约」及同构玩法的既有形式化模型调研

> 调研日期：2026-10-18 · 手段：web_search 多轮（中英文）+ GitHub REST API 核实 star/语言/pushed_at + 本地仓库代码阅读。
> 原则：star 数与语言均来自 GitHub API 实测；未查到的写在 §5，不补空。

---

## 1. 直接相关的社区分析（卫戍协议：盟约）

**最重要的发现：这个玩法的「数学骨架」已经以开源代码 + 逐盟约公式文档的形式存在，而且就在本地。**

| # | 来源 | 结论（一句话） | 可信度评注 |
|---|---|---|---|
| 1 | [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)（★1592 / JavaScript / pushed 2026-10-18） | 「卫戍协议：盟约」的非官方同人复刻：浏览器自走棋 + 塔防，单人/1–4 人联机；**仓库内含 23 个盟约的完整公式表**（`data/bonds.json` 85KB，带 `formulas` 字段）、`docs/research/02-bonds.md`（199KB 逐盟约逐层公式 + 数据来源与 `[ASSUMED]` 标注）、`docs/SIM.md`（212KB） | **最高**。是可执行代码，不是攻略。**本地已存在于 `D:\CodeProject\Stronghold-Protocol`**，我们 MODEL-SPEC 引用的 `server/sim/damage.js`、`MIN_DAMAGE_RATIO=0.05`、`config: bossOvertimeAfter=150`、`data/chess.json` 全部出自这里 → 本项目是该引擎之上的顾问层 |
| 2 | [gitcode 博客：盟约（Bonds）全量规则研究](https://blog.gitcode.com/7ee15f6d74f7bbde7b3f16a9adbf0c87.html) | 23 个盟约的激活条件、层数体系、逐盟约公式详解；含 `weight`（多数 10，投资人/调和/协防/绝技为 0）用于随机禁用盟约集合 D 的抽取权重 | 中高，但**二手**：内容是 #1 的 `docs/research/02-bonds.md` 的镜像/摘编。可直接读原件，不必引它 |
| 3 | [NGA：[卫戍协议] 二期各核心盟约个人运营思路](https://ngabbs.com/read.php?tid=45613829) | 核心盟约的运营思路（升本节奏、抓人顺序），是**经验性定性判断**，没有期望值计算 | 中。NGA 对自动化 GET/HEAD 返回 **403**，本次仅凭搜索索引摘要与标题，**未验证正文** |
| 4 | [NGA：玛恩纳的卫戍协议特质非常强](https://ngabbs.com/read.php?tid=46371835) | 单个干员特质的强度判断，属于点状结论 | 中低（同 #3 的 403 限制） |
| 5 | [B站：【卫戍协议:盟约】叠层机制讲解 + 无脑运营思路](https://www.bilibili.com/video/av115571932795429/)（HTTP 200 实测可达） | 把「叠层」讲成可复制的操作流程；价值在于确认「层数 L 是主决策变量」这一共识 | 中。视频无公式，但与本项目认为 layer 是核心状态量的判断一致 |
| 6 | [TapTap：卫戌协议似乎有某种特殊的概率提升机制](https://www.taptap.cn/moment/784597996619694174) | 玩家**从体感上察觉到了 PRD（伪随机保底）**，但没给出公式 | 中低结论、高价值线索：与 `bonds.json` 的 `"prdStep":"0.00139"`（siracusa，n=720 保底）互证 |
| 7 | [知乎：明日方舟《卫戍协议》有哪些技巧？如何快速叠层？](https://www.zhihu.com/question/1977044202639603451/answer/2032838562916382613) | 叠层技巧汇总，经验性 | 中低（经验帖） |
| 8 | [9game：卫戍协议无限叠层攻略](https://www.9game.cn/mrfz/11565373.html) · [维多利亚体系运营](https://a.9game.cn/mrfz/11806134.html) | 「无限叠层」作为一种上限存在 → 说明层数 L 的收益函数在高端区**未被封顶**（对应 `caps:"none"`） | 低（内容农场，但结论与 `bonds.json` 的 `caps` 字段一致） |
| 9 | [PTT：[閒聊] 衛戍協議：盟約 電表倒轉](https://www.pttweb.cc/bbs/Arknights/M.1782640398.A.207) | 「電表倒轉」= 经济循环被打成正反馈（refresh→层数→金币→refresh） | 中低，但点出了**正反馈经济回路**的存在，这是本项目 `miraShip` `goldPayouts:"20*floor(L/100)"` 那类设计的玩法后果 |

**小结（第 1 类）**：没有任何学术论文或「数学模型」贴；但 #1 的代码 + `formulas` 字段已经是**事实上的形式化**，且层级到「公式字符串可解析」的程度。社区侧只有定性攻略。

---

## 2. 同构玩法的可借用模型

### 2.1 Auto chess / Auto battler（经济 + 池子 + 阵容）

| 来源 | 可借用的公式 / 结构 |
|---|---|
| **[ACM：Reinforcement Probability Modeling and Machine Learning-Based Estimation in Teamfight Tactics](https://dl.acm.org/doi/10.1145/3783779.3783793)** | **最直接可搬的一篇**。用「r 费卡在池中被临时占用的数量 `S_r`」和「目标张数」建立刷新概率模型，即 `P(命中) = (left_target) / (Σ_{tier≤L} left_tier)` 的占用修正形式。这正是本项目「刷 vs 升」期望计算缺的那一块：把 `S_r`（对手/自己已占用的 copies）作为状态变量显式建模。 |
| [有限牌库条件下自走棋式商店刷新问题的概率建模与策略优化](https://enterscholar.com/uploads/short-url/t3We9uIZta9M68yHGBJjnPJlszd.pdf)（中文预印本 PDF） | 有限牌库 + 刷新策略的**动态规划/策略优化**框架，含「何时停止刷新」的阈值型最优策略。可借：把「继续刷到目标 vs 停手」写成 `E[cost|continue]` 与 `E[value|stop]` 的比较，即本项目 §3.3 判定树的期望值版本。 |
| [Liquipedia：Dota 2 Random Distribution (PRD)](https://liquipedia.net/dota2/Random_Distribution) | 伪随机保底的**闭式**：第 n 次尝试成功率 `P(n) = C·n`，`C = 1/n̄`，期望尝试次数 `n̄`。可直接代入本项目 siracusa 的 `prdStep 0.00139` / n=720、indom `min(1, 0.18+0.004L)` 的等效保底次数。 |
| [自走棋的经济与平衡（gd-proto 9.2）](https://plumephp.com/gd-proto-09-2-autobattler-economy-balance/) · [《自走棋》设计拆解（gameres）](http://bbs.gameres.com/forum.php?mod=viewthread&tid=841302) | 经济曲线的**设计侧**结构：利息/连胜连败/回合收入三分解 + 「50 回合内总资产曲线」的采样画法。只有定性结论，无闭式；可借的是**曲线的自变量选择**（回合数 vs 累计投入），不是公式。 |

### 2.2 塔防 + 经济双循环（LP / IP 建模）

| 来源 | 可借用的公式 / 结构 |
|---|---|
| **[Wiley ITOR：Modeling Bloons Tower Defense as a temporal two-dimensional knapsack problem with irregular shapes and side constraints: integer programming–based approaches](https://onlinelibrary.wiley.com/doi/10.1111/itor.70238)** | **最贴近「塔防 + 经济」的形式化**：把塔防布局写成**时序二维背包**（每回合预算 = 容量，塔 = 带不规则形状/射程的物品），用 IP 求「每回合买什么」。可借：把本项目「R10→R14 手牌预算」写成同一族的 `max Σ v_i x_i s.t. Σ cost_i x_i ≤ budget_r`，并用「时间维」表达「早买比晚买值钱」的折扣因子。 |
| [TU/e 硕士论文（ILP 塔防策略验证）](https://research.tue.nl/files/372344006/Thesis_BDS_Jacub_Malinowski.pdf) | 用 ILP 导出的策略与人类策略对照，验证 ILP 策略的可行性与上限差距。可借：**「ILP 上界 vs 实测胜率」的对照方法论**——正是本项目链 A/B/C 想做的事的学术版。 |
| [Charles University 论文（塔的伤害/射程/出现频率平衡曲线）](https://dspace.cuni.cz/bitstream/handle/20.500.11956/192911/130401300.pdf) | 「射程 `r_t` 越大 → 单点伤害应越低、出现频率越低」的定量关系。可借：本项目通道评分里「远距离 vs 近距离」的权重不应拍脑袋，而应满足这条单调性约束。 |
| [West Games：Tower Defense Wave HP Scaling Calculator](https://west-games.com/tower-defense-wave-hp-scaling-calculator/) · [Construct 论坛：Scaling Enemy Difficulty per wave](https://www.construct.net/en/forum/construct-2/how-do-i-18/scaling-enemy-difficulty-per-67572) | 敌方 HP 曲线的**实践公式族**（线性 / 指数 / 分段）。是工程经验，**不是定理**。见 §5 说明：没有找到「必须指数增长」的定理式结论。 |

### 2.3 POMDP / RL / 求解器

| 来源 | 可借用的结构 |
|---|---|
| **[silverlight6/TFTMuZeroAgent](https://github.com/silverlight6/TFTMuZeroAgent)**（★229 / Python / pushed 2026-10-17） | MuZero 式「representation → dynamics → prediction」+ MCTS 的完整骨架，针对 TFT。可借：**动作空间设计**（买/刷/升/卖/锁 = 5 类离散动作 + 槽位掩码）与「不确定性下的重规划」结构；其状态里显式含金币、等级、池子剩余，可直接映射到本项目 `state.json`。 |
| **[alexdriedger/sapai-gym](https://github.com/alexdriedger/sapai-gym)**（★16 / Python / pushed 2022-08） | Super Auto Pets 的 OpenAI Gym 环境：把「商店阶段（经济+池子）」和「战斗阶段（自动结算）」拆成两层 env。可借：**双层 env 接口形状**——本项目的「备战回合」与「BOSS 回合」正好是同构的两层，env 拆分方式可直接照搬（observation/action/reward 的三段契约）。 |
| [LUT 学士论文：Design and implementation of an Intelligent Agent for Auto Battler Games Using Reinforcement Learning](https://lutpub.lut.fi/bitstream/handle/10024/167789/BachelorThesis_Wenyue_Zhang.pdf) | Auto battler 的 RL agent 设计：状态离散化 + 动作掩码 + reward shaping（含「经济效率」项）。可借：**reward 分解为「战力增量 / 经济效率 / 血量」三项**的思路，对应本项目「抓分 / 金币 / LP」的三目标。 |
| [bluo999/HS-Battlegrounds-Sim](https://github.com/bluo999/HS-Battlegrounds-Sim)（★1 / Python / 2019，WIP） | 炉石战棋**战斗阶段**的蒙特卡洛模拟器，输出近似「胜/平比例」。可借：**用 MC 而非解析式求「胜率」**的工程范式——当盘面复杂到写不出闭式时，本项目链 A 的 `--profile` 采样就是同一手段。 |

---

## 3. 可复用开源项目表

> star / 语言 / 最后 push 均来自 GitHub REST API 实测（2026-10-18）。

| 仓库 | ★ | 语言 | 能借什么 |
|---|---|---|---|
| [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) | 1592 | JavaScript | **本项目的事实上游**（本地 `D:\CodeProject\Stronghold-Protocol`）。可直接借：**池子概率** `server/match/pool.js`（`roll()` copy-weighted、`tierShares(maxTier)` 阶级占比、`rollItem()`、`poolCopies{1:12,2:14,3:18,4:16,5:8,6:5}`）；**经济** `server/match/player/economy.js`（`refresh()`/`levelUp()`/`_openLevelSlots()`，`refreshPrice=1`、`shopSlots{1:{chess:3,item:1}…6:{chess:5,item:1}}`、`upgradeBase(level)`）；**合成期望**（`pieces.js`/`acquire.js` 的 `poolCopies` 攒 3 合 1 与 `take/give` 回池）；**盟约公式** `data/bonds.json` 的 `formulas`/`bb`/`layerMilestones`/`countMode`；**模拟器框架** `public/dev/simcheck/`（core.js 13KB + ui.js 15KB，浏览器内自走棋模拟校验）与 `server/sim/ai.js`（62KB bot） |
| [silverlight6/TFTMuZeroAgent](https://github.com/silverlight6/TFTMuZeroAgent) | 229 | Python | MCTS + learned model 的 autobattler agent 骨架；动作掩码设计 |
| [XzJoshZ/abstract-brawl](https://github.com/XzJoshZ/abstract-brawl) | 72 | JavaScript | 「横版格斗 + 回合战 + 自走棋」混合体的完整实现，可看多模式共用一套棋子/经济层的分层方式 |
| [pumpkye/AutoChess](https://github.com/pumpkye/AutoChess) | 37 | TypeScript | 自走棋**战斗模拟**（给双方阵容 → 出结果），目标是探索平衡性；可借「用模拟反推数值平衡」的接口形状 |
| [alexdriedger/sapai-gym](https://github.com/alexdriedger/sapai-gym) | 16 | Python | Gym 环境：商店阶段 / 战斗阶段双层拆分（本项目备战回合 / BOSS 回合同构） |
| [StarscapeTFT/TFTCalculator](https://github.com/StarscapeTFT/TFTCalculator) | 6 | C# | 交互式「某等级刷到某单位」概率计算器：把池子占用 → 单槽概率 → n 次刷新的累积概率的可视化链路 |
| [bluekayn/bluekayn.github.io](https://github.com/bluekayn/bluekayn.github.io) | 1 | JavaScript | TFT 刷新概率计算器（网页版，逻辑简单可直接读） |
| [bluo999/HS-Battlegrounds-Sim](https://github.com/bluo999/HS-Battlegrounds-Sim) | 1 | Python | 战斗阶段 MC 模拟 → 胜/平比例（WIP，只能借范式） |
| [seanemoon/shaco.gg](https://github.com/seanemoon/shaco.gg) · [paullee18/tft-probability-calculator](https://github.com/paullee18/tft-probability-calculator) · [respecthub/tftprobcalc](https://github.com/respecthub/tftprobcalc) | 0 / 0 / 0 | JS / C++ / HTML | 同上，规模小，仅作公式对照 |

**没有找到**：GitHub 搜索 `autochess pool odds`、`auto battler probability`、`battle simulator economy tower defense` 的 `total_count` 均为 **0** ——即除 `Stronghold-Protocol` 本身外，**没有单一仓库同时覆盖「经济 + 池子 + 塔防 + 盟约层数」这四件套**。

---

## 4. 结论：哪些已有现成骨架可直接搬，哪些必须自己推

### 4.1 可直接搬（有骨架，不要再自造）

1. **池子抽取概率 → 直接读 `Pool`，不要重推**
   `pool.js` 的 `roll(rng,{maxTier,extra})` 是 **copy-weighted**：每个槽位在「所有 `tier ≤ shop.level` 且 `left > 0`」的剩余副本上均匀抽一张。因此单槽命中目标干员集合 `T` 的概率就是
   `P_slot = Σ_{c∈T} left_c / Σ_{tier≤L} left_tier`，且 `tierShares(maxTier)` **已经把这个分母算好了**。
   参数也别手抄：`poolCopies = {1:12, 2:14, 3:18, 4:16, 5:8, 6:5}`，`shopSlots = {1:{3,1}, 2:{4,1}, 3:{4,1}, 4:{5,1}, 5:{5,1}, 6:{5,1}}`，`refreshPrice = 1`（`gamedata.js:29/30/42`）。
   本项目 §3.3 的 `upgradeValue` 里第一项 `Δslots(ℓ) · p_slot · v_unit` 的 `Δslots(ℓ)` 应**直接取 `gd.shopSlots` 的差值**（3→4 是 +1，4→5 是 +1，5→6 是 0），而不是估。

2. **层数收益 → 已是 `base + perStack·L` 的可解析族，直接读 `bonds.json` 的 `formulas`**
   每个盟约自带 `formulas` 字符串，形如：
   - `preciShip`: `atkMultiplier:"1.10 + 0.012*L"`, `defPenetrateRatio(3):0.3`
   - `swiftShip`: `p:"min(1, 0.20 + 0.0035*L)"`, `reaches100%AtL:229`
   - `indomShip`: `p:"min(1, 0.18 + 0.004*L)"`, `reaches100%AtL:205`
   - `skillfulShip`: `aspd:"10 + L"`；`raidShip`: `atkHpMultiplier:"1.25 + 0.01*L"`
   - `kazimierzShip`: `atkCap:"0.50 + 0.01*L"`；`miraShip`: `goldPayouts:"20*floor(L/100)"`
   - `suntShip`: `spCostMul:"floor(sp*0.7)"`；`siracusaShip`: `aspd:"25+0.8*L"`, `procDamage:"5000+50*L"`, `prdStep:"0.00139"`
   → 结论：**层数→属性是「线性 `base + perStack·L` + `min(1,·)` 截断 + `L≥整数阈值` 的阶梯 milestone」三件套**。信号也在数据里：`thresholds`、`countMode`（`BOARD` / `BOARD_AND_DECK`）、`noStack`、`layerMilestones:[{layer,mode,effect}]`、`caps:"none"`。**我们的模型应该解析 `bb`（blackboard）参数表，而不是从攻略里抄数。**

3. **升本价格与经济动作 → 读 `economy.js` / `gamedata.js`，不要另立参数**
   `upgradeBase(level)`（`gamedata.js:377`，内部 `upgradePrices()`）、`shopSlots(level)`（`:383`，带 `Math.min(chess,8)` / `Math.min(item,4)` 上限与 mode 覆盖）、`refresh()` 的 `freeRefreshes` 优先扣减、`_openLevelSlots()` 的「新层级格子开出来是空的不抽卡」——这些是**引擎硬约束**，我们 `params.json` 里若有同名参数就是重复真值源，应删掉并改为读引擎。

4. **伤害管线 / 破甲线 → 本项目 §1.1–§1.2 已经是对的口径，此处无需再找先例**
   `mitigate()`、`MIN_DAMAGE_RATIO = 0.05`、`BOSS_HIT_LIMIT = 300000`（是「整体取消」不是截断）、`COMBAT_TIME_SCALE = 2`（`Battle` 内部游戏秒 vs 外部真实秒）。破甲线 `A > DEF/0.95 = 1.0526·DEF`（无精）与 `A > 0.7·DEF/0.95 = 0.7368·DEF`（精 3）是本作 `mitigate` 的代数推论，**社区与文献都没有，但推导只有一行，属于已解决**。

5. **PRD 伪随机 → 有闭式可套**
   `siracusaShip` 的 `prdStep:0.00139`、`n=720` 保底，与 Dota PRD 的 `P(n)=C·n`、`C=1/n̄` 同族（[Liquipedia](https://liquipedia.net/dota2/Random_Distribution)）。→ 期望触发次数可直接写 `E[procs] = Σ_n min(1, C·n)`，不必为每个盟约重新做蒙特卡洛。

### 4.2 必须自己推（没有先例，或先例不可用）

1. **`W = 150 + LP₀ − Σ(lpr_i·leak_i)` 这条「LP ↔ 时间」兑换率**
   文献里的塔防经济模型（Bloons 的时序二维背包 / ILP）是**静态预算分配**：预算是给定的，没有「多活几秒 = 多打伤害」这一维。本作的 `DPS_req = pool_eff / W` 用 LP 购买击杀窗口，是**三元兑换（LP → 秒 → DPS）**，派生量 `∂DPS_req/∂LP = −pool_eff / W²`（SPEC 已写，LP 15→45 对应 `W 165→195`、`DPS_req −18.2%`）**没有可对照验证的外部先例**。只能靠链 A/B 的实测自己钉。

2. **`pool_eff = pool · [(1−a) + a/m]` 这个「分段减伤 → 等效血量池」变换**
   把 BOSS 的阶段 `damage_resistance`（如 `Madness.damage_resistance 0.6` → `m=0.4`、`boss_1` 的 `hp_ratio 0.2 / damage_scale 0.5`）折算成 pool 的乘子，使 boss_7 的 `pool_eff = 1.75×pool = 7.00M`。文献侧 TD 建模用的是**单一 wave-HP 曲线变量**，没有「分段减伤→等效池」的映射。本作 boss_6 又是另一种（改面板 DEF×2/RES+45 而非乘子），需要按两条路径分别调和 —— **必须自己推，且必须单测（SPEC 链 D）**。

3. **「必须指数增长」——没有找到定理**
   检索到的最好结果是实践性工具（[west-games HP scaling calculator](https://west-games.com/tower-defense-wave-hp-scaling-calculator/)）与论坛经验（[construct.net](https://www.construct.net/en/forum/construct-2/how-do-i-18/scaling-enemy-difficulty-per-67572)），都是「怎么调曲线」而非「为什么必须指数」。→ 我们的「战力曲线 vs BOSS 血量曲线交叉点」分析**无可引用定理**，必须按 R10→R14 逐回合自己算，并在文档里明确标注「本条为本项目推导，无外部依据」。

4. **双循环的联合最优（升 / 刷 / 买）**
   ACM 的 TFT 论文只做**刷新概率**；Bloons 的 IP 只做**布局背包**；两者都不做「花金 → 层数 L → ATK 乘区 → 是否过破甲线」这条跨层链条。本作的特殊之处是层数 `L` 既能被「刷新」驱动（siracusa/安洁莉娜/拉普兰德），又能被「部署/击杀」驱动（kazimierz/raid），于是**金币与层数不是同一条因果链**。
   → `upgradeValue` 的第二项 `ΔtierShare(ℓ) · n_active · v_tier`（`v_tier ≈ 6`）在文献里**只有定性讨论**，必须自己标定；第三项 `v_L6 ≈ 40` 同理。

5. **顾问的「建议」型输出没有现成骨架**
   `sapai-gym` / `TFTMuZeroAgent` 输出的是**动作**，且 observation 是对手公开盘面；本项目是 1–4 人合作 + BOSS AI，输出是自然语言建议。可借的只有**结构**（state encoder → 动作掩码 over `{buy, refresh, levelUp, sell, freeze}` → value head），**reward shaping 不可搬**（它们的 reward 是「本局排名」，我们的目标是「过 BOSS 率」）。

---

## 5. 未能查到的部分（检索过，没有结果）

1. **「卫戍协议：盟约」的任何学术论文 / 形式化数学模型** —— 未找到。检索了 `卫戍协议 数学`、`卫戍协议 层数 收益`、`arknights 卫戍协议 simulator`、中文/英文/繁中各组合。存在的只有：开源复刻（`Stronghold-Protocol`）及其派生博客。**没有「模型」，但有「实现 + 逐条公式」**——这是本文档最重要的判断。
2. **以「数学 / 期望值 / LP」为口径的中文定量分析帖（NGA / 贴吧 / B站专栏 / 知乎）** —— 未找到。找到的全是「运营思路 / 叠层攻略」类的**定性经验帖**。另需注意：**NGA 对自动化 GET/HEAD 返回 403**，本次无法验证正文，仅依据搜索索引的标题与摘要，可能有遗漏的定量贴。
3. **「战力必须指数增长」的定理式 / 可引用 publication** —— 未找到。只有 scaling 工具与论坛经验。
4. **Hearthstone Battlegrounds 的 solver 论文** —— 未找到。只有一个 ★1 的 WIP 工程 demo（`HS-Battlegrounds-Sim`），无论文。
5. **「卫戍协议」官方公布的商店阶级概率表** —— 未找到。社区/引擎用的是 **copy-weighted**（剩余副本数加权）推导，不是官方百分比表。**因此本项目不应假设存在「固定阶级概率表」这种参数**（`tierShares()` 是算出来的，不是配置的）。
6. **单一仓库同时覆盖「经济 + 池子 + 塔防 + 盟约层数」** —— 未找到（GH 搜索 `total_count=0` 的三组 query 见 §3）。唯一例外是 `Stronghold-Protocol` 自身。
7. **自走棋「合成期望」的公开闭式公式** —— 未找到独立文献。只在本项目上游的 `pieces.js` / `acquire.js`（`poolCopies` 攒 3 合 1、`take/give` 回池）里以代码形式存在。因此『合成期望』这一项也归入「有代码骨架、无文献」。

---

## 6. 总结（≤300 字）

**三条最关键发现：**

1. **「卫戍协议：盟约」的数学模型已经存在，而且就是我们的上游。** `sganggs/Stronghold-Protocol`（★1592，JavaScript）是非官方复刻，仓库内 `data/bonds.json` 的每个盟约都带 `formulas` 字符串（如 `"min(1, 0.18+0.004*L)"`、`"atkMultiplier":"1.10+0.012*L"`、`reaches100%AtL:205`）与 `bb` 黑板参数。层数收益族 = 线性 + `min(1,·)` 截断 + milestone 阶梯。**我们应解析它，而不是从攻略抄数。** 本地已在 `D:\CodeProject\Stronghold-Protocol`。

2. **池子/经济/伤害的骨架全部现成，只有三处必须自己推。** `pool.js` 的 copy-weighted `roll()` + `tierShares()` 直接给出 `P_slot`；`economy.js` 给出 `refreshPrice=1`、`shopSlots` 差值（即 `Δslots(ℓ)`）、`upgradeBase`。外部的 ACM TFT 论文给了池子占用 `S_r` 的显式建模，Liquipedia 给了 PRD 闭式 `P(n)=C·n`。**必须自推的只有：`W=150+LP₀−Σ(lpr·leak)` 的 LP↔时间兑换率、`pool_eff=pool·[(1−a)+a/m]` 的分段减伤折算、以及 `v_tier≈6`/`v_L6≈40` 的标定。**

3. **「必须指数增长」没有定理可引，社区也没有定量分析。** 检索不到任何卫戍协议的学术模型，中文侧全是定性攻略（且 NGA 返回 403 无法验证正文）。所有「交叉点分析」必须自己逐回合算，并在文档中标注为无外部依据的本项目推导。
