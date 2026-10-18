# MODEL-SPEC v1 —— BOSS 回合盘面重建 + 顾问实时决策（可实施规格）

> 目标：把 `lab/REPORT.md` 的实验结论收敛成**能直接写进代码**的公式、阈值、判定树与伪代码。
> 配套机器可读参数表：`advisor-dev/model/params.json`（本文所有常数都在里面，代码只读它）。
> 校准数据：`advisor-dev/model/bosstable.json`（由 `lab/bosstable.mjs` 从引擎系数算出的 BOSS×通道系数表）。
> 本轮新增的两个实验工具：`lab/bossprobe.mjs`（钉死 bossId 测「这种盘面能不能杀它」）、`lab/bosstable.mjs`（从 bb 系数算通道矩阵）。

证据等级标记，全文统一：

| 标记 | 含义 |
|---|---|
| **【实测】** | REPORT.md 的数字，或本轮实测（命令、种子、样本数都写在原地） |
| **【引擎系数】** | 来自 `data/bonds.json` 的 `bb` 键 / `data/enemies.json` 的 talents / `server/` 代码位置 |
| **【推断】** | 由前两者推导，未直接测；给出可证伪条件 |

---

## 0. 记号与数据源

```
B      = BOSS 记录（data/bosses.json[bossId]）          pool = B.bloodPoint[difficulty]
e      = BOSS 单位记录（data/enemies.json[B.enemyKey]）  DEF = e.stats.def, RES = e.stats.res
L_ρ    = 盟约 ρ 的层数（ps.layers[ρ]，BOND_LAYER_CAP=999 封顶）        【引擎系数】
L^c    = 核心盟约层数，L^a = 附加盟约层数（合格曲线分开给：见 §2.4）
A      = 单个干员的有效攻击力（基础 ATK × ATK 乘区）
p      = 精准无视比例（3 名在场 = 0.3，否则 0）                        【引擎系数】
m      = BOSS 阶段后的「受到伤害」乘子                                  【引擎系数】
W      = 击杀窗口（真实秒）
F(·)   = 盘面可用性判定（§2.7）
```

数据源与刷新方式（顾问侧热更新已支撑前 5 个，见 REPORT §8）：

| 文件 | 用途 | 谁读 |
|---|---|---|
| `routes/_bosses.json` | DEF/RES/lpr/tags/bloodPoint（人工摘要，权威值见下） | `open-brief.mjs` |
| `Stronghold-Protocol/data/bosses.json` | `lpr`、`bloodPoint`、`enemyKey`、`escortsByTemplate` | 本规格（权威） |
| `Stronghold-Protocol/data/enemies.json` | BOSS 的 `stats.def/res/atk`、`talents.bb`（阶段数值） | `lab/bosstable.mjs` |
| `Stronghold-Protocol/data/bonds.json` | 23 盟约的 `bb` 系数 | `lab/bosstable.mjs`、插件内核 |
| `routes/_matchup.json` | 路线画像、`needs`、`policy`、`bountyModel` | `open-brief.mjs` |
| `advisor-dev/model/params.json` | **本规格的全部阈值/权重** | 所有 advisor 代码 |

---

## 1. BOSS 回合的可计算基线

### 1.1 伤害管线（唯一口径，不许在别处重写）

```js
// 【引擎系数】server/sim/damage.js:189 mitigate()，server/sim/constants.js:68 MIN_DAMAGE_RATIO
const MIN = 0.05;
function mitigate(amount, type, target, ign = {}) {
  if (type === 'phys') {
    const D = Math.max(0, target.def * (1 - (ign.defIgnorePct || 0)) - (ign.defIgnoreFlat || 0));
    return Math.max(amount - D, MIN * amount);          // ← 5% 保底
  }
  if (type === 'arts') {
    const R = Math.max(0, target.res * (1 - (ign.resIgnorePct || 0)) - (ign.resIgnoreFlat || 0));
    return Math.max(amount * (1 - Math.min(100, R) / 100), MIN * amount);
  }
  return amount;                                        // true / elemental(另算 elementRes)
}
```

三条硬约束，任何 BOSS 决策都不能违反：

1. **单次命中 ≥ 300000 被整体取消，不是截断**【引擎系数 `shared/constants.js BOSS_HIT_LIMIT`，`damage.js:220 leaderHitCancelled`】。
   → 「攒一个大数字」在 BOSS 回合是负收益；真伤/爆发型单段必须控制在 30 万以下（≥30 万 = 0 伤害，连 HP 都不掉）。
2. **战斗 1 真实秒 = 2 游戏秒**【引擎系数 `gamedata.js COMBAT_TIME_SCALE=2`】。所有外部时间（150 秒起扣血、报告里的 killTime）都是**真实秒**，`Battle` 内部是游戏秒。
3. **阶段乘子在 mitigate 之后**：`m` 是 `physTakenMul/artsTakenMul`（乘在已减防的伤害上），`defMul/resFlat` 是改 BOSS 面板（进入 mitigate）。

### 1.2 破甲线 / 抗性线（判定阈值，可直接写 if）

```
k_phys(A, DEF, p) = max(1 - DEF·(1-p)/A, 0.05)
k_arts(A, RES, p, M) = max(1 - min(100, RES·(1-p))/100, 0.05) · M        M = 奥术乘区
```

**物理脱离 5% 保底的条件**（`k_phys > 0.05` ⟺ 有效伤 > 保底）：

```
无精准： A > DEF / 0.95 = 1.0526 · DEF
精准 3： A > 0.7·DEF / 0.95 = 0.7368 · DEF
```

阈值表（`lab/bosstable.mjs` 现算，`REF_ATK = 577` 是精锐 T5/T6 主 C 的**基础** ATK 中位数【引擎系数 `data/chess.json` 统计】）：

| BOSS | DEF | 半血后 DEF | 无精准需 ATK > | 精准 3 需 ATK > | 精锐基础 ATK 中位 577 → 需 ATK 乘区 |
|---|---|---|---|---|---|
| boss_3 | 700 | 700 | 737 | 516 | ×1.28 |
| boss_5 | 600 | 600 | 632 | 442 | ×1.10 |
| boss_4 | 500 | 500 | 527 | 368 | ×0.91（基础就够）|
| boss_7 | 800 | 800 | 842 | 589 | ×1.46 |
| boss_1 | 1000 | 1000 | 1053 | 737 | ×1.83 |
| boss_6 | 1030 | **2060** | 1085 → **2168** | 759 → **1518** | ×1.88 → **×3.76** |
| boss_2 | 1100 | 1100 | 1158 | 811 | ×2.01 |

**结论 1（决定性）**：32 名 T5/T6 主 C 的基础 ATK 中位只有 **577**、最大 **1362**（`data/chess.json` 精锐记录统计），而 boss_1 / boss_6 / boss_2 的破甲线是 **1053 / 1085 / 1158**。
→ **纯物理路线在 ABYSS 的 3 个高防 BOSS 上，基础状态只吃 5% 保底；必须靠「层数 ATK 乘区」或「精准 3」把自己抬过破甲线。**
→ boss_6 半血后 DEF 翻倍到 2060：**除非 ATK > 1518（带精准）**，否则物理在 boss_6 的下半场等于 0 输出。这条是 REPORT「boss_6 ratio150 只有 0.83」的机制解释。

**抗性线**（`k_arts`，M=1 时）：

| RES | 20 | 25 | 40 | 50 | 60 | 65( boss_6 半血) |
|---|---|---|---|---|---|---|
| k_arts | 0.80 | 0.75 | 0.60 | 0.50 | 0.40 | 0.35 |
| 精准 3（RES×0.7） | 0.86 | 0.83 | 0.72 | 0.65 | 0.58 | 0.545 |

### 1.3 击杀窗口与需求 DPS（本文最重要的一个公式）

BOSS 回合不是「打死」而是「**在队伍 LP 耗尽前把共享血池清零**」。血池清零 → 胜；BOSS 本体漏 → 立刻扣 `lpr`（boss_5 = 30，其余 2）→ 直接死。

```
W = 150 + LP₀ − Σᵢ (lprᵢ · leakᵢ)            [真实秒]        【引擎系数 config: bossOvertimeAfter=150, drain=1/s】
DPS_req = pool_eff / W
pool_eff = pool · [ (1−a) + a/m ]            a = atHpRatio（阶段触发时的 HP 比例），m = 阶段后承伤乘子
```
- boss_7：`a=0.5, m=0.4` → `pool_eff = (0.5 + 1.25)·pool = 1.75·pool = 7.00M`【引擎系数 `Madness.damage_resistance 0.6`】
- boss_1：`a=0.2, m=0.5` → `pool_eff = (0.8 + 0.4)·pool = 1.20·pool = 4.32M`【引擎系数 `1.hp_ratio 0.2 / 1.damage_scale 0.5`】
- boss_6：不是乘子而是面板（DEF×2/RES+45）→ 用 §1.2 的 `k_phys/k_arts` 两段调和平均算，见 `bosstable.json`
- 漏怪期望 `escortLeakExpect`：`lpr ≥ 30` 的 BOSS 按 0（一个都不能漏）；其余按 2（REPORT §4 的合格阵容 R12 漏 6.75 个的 P50，折算到 BOSS 回合的护卫）【推断】。调用方可传实测值覆盖。

逐 BOSS 数值（ABYSS 单人，`pool = bloodPoint.ABYSS × 1`【引擎系数 `finalAssault.perPlayer:true`, solo 份额 1】）：

| BOSS | pool | DEF→半血 | RES→半血 | lpr | 阶段 | pool_eff | W(LP15) | DPS_req(LP15) | DPS_req(LP45) |
|---|---|---|---|---|---|---|---|---|---|
| boss_1 假想敌：胄 | 3.60M | 1000 | 25 | 2 | 20% 后物法×0.5 | 4.32M | 165 | **26.2k** | 22.2k |
| boss_2 假想敌：铳 | 3.00M | 1100 | 60 | 2 | — | 3.00M | 165 | **18.2k** | 15.4k |
| boss_3 假想敌：管 | 4.00M | 700 | 50 | 2 | — | 4.00M | 165 | **24.2k** | 20.5k |
| boss_4 盐风主教 | 4.20M | 500 | 50 | 1 | — | 4.20M | 165 | **25.5k** | 21.5k |
| boss_5 卢西恩 | 3.00M | 600 | 40 | **30** | 未阻挡时闪避 0.4 | 3.00M | 165（1 漏即死） | **18.2k** | 15.4k |
| boss_6 帝国余晖 | 3.98M | 1030→2060 | 20→65 | 2 | 50% 后 DEF×2/RES+45 | 3.98M（面板变） | 165 | **24.1k** | 20.4k |
| boss_7 萨米的意志 | 4.00M | 800 | 40 | 2 | 50% 后物法×0.4 | **7.00M** | 165 | **42.4k** | 35.9k |

**LP 是 DPS 的替代品**（可交易的资源）：

```
∂DPS_req/∂LP = −pool_eff / W²
LP 15 → 45：W 165 → 195，DPS_req 降 18.2%
```
【实测】`balance.mjs --mode solo --difficulty ABYSS --rounds 14 --boss-only --boss-samples 43 --seed 1`：
profile 1.0 加 `--boss-lp 45` 把 R14 单体胜率从 **0.442 → 0.535**（+9.3pp），profile 1.4 从 **0.512 → 0.674**（+16.2pp）。
逐 BOSS 看，LP 45 **只救「本来就差一点」的局**：
- profile 1.0 + LP45：只有 boss_6 从 0.25 → 0.75，其余 BOSS 一个没动；
- profile 1.4 + LP45：boss_1 0.875→1.000、boss_2 0.333→0.667、boss_3 0.167→0.500、boss_5 0.636→0.727、boss_6 0.500→0.625；
- **boss_7 两档都是 0.000%**（缺的是 1.75× 的输出强度，不是时间）。

> 决策含义：**「歌利亚 = 45 LP」不是兜底，是 18% 的输出窗口**。实测折价：profile 1.0 + LP45 ≈ profile 1.4；profile 1.4 + LP45 ≈ profile 2.0 的 0.9 倍。
> 所以它的价值是「**profile +0.4~0.7**」。但对半血减伤 BOSS 完全没有替代作用 —— **不能拿 LP 去抵输出缺口**，只能抵「差一点」。

### 1.4 触发「通道正确性」的四个 BOSS 类别

判定只用 `m.public.bossId` 读出的四个标量（`params.json → rebuild.*Threshold`）：

| 类别 | 判定式 | 命中 BOSS | 机制后果 |
|---|---|---|---|
| **高防** | `DEF ≥ 1000` | boss_1(1000) boss_6(1030) boss_2(1100) | 物理吃 5% 保底；必须法伤/精准/真伤 |
| **高抗** | `RES ≥ 50` | boss_2(60) boss_3(50) boss_4(50) | 法伤效率 ≤ 0.5；必须精准 3 或奥术 3 |
| **半血减伤** | `m_phys < 1 且 m_arts < 1` | boss_7(0.4) boss_1(0.5，仅在 20% 后) | 有效血池 ×1.2~1.75；真伤/元素不受影响 |
| **禁漏（lpr 致命）** | `lpr ≥ 30` | boss_5(30) | 本体漏 1 个 = 直接判负；且未阻挡时**闪避 0.4**，物法再 ×0.6 |
| （附加）**穿阻挡** | `tags ∋ 穿阻挡` | boss_5 | 阻挡/再部署循环不可依赖；靠真伤与复活 |
| （附加）**召唤物/点名** | `tags ∋ 点名` 或 desc 含「召唤」 | boss_3 boss_5 boss_10 | 有召唤物的路线（炎佑）替他吃仇恨 |

### 1.5 通道有效系数矩阵（路线 × BOSS）

`lab/bosstable.mjs` 用 §1.1/§1.2 的公式 + `bonds.json` 的 bb 系数 + 各路线名册的实际伤害类型算出来的 `k`
（L^c=130 / L^a=75；含 ATK 乘区与攻速乘区；两段血池取调和平均 `2k₁k₂/(k₁+k₂)`，阶段乘子乘在第二段上）：

```
k              yan   victoria     kjerag     sargon  kazimierz   laterano   siracusa       egir
boss_1         0.97       0.97       0.97       3.90       0.17       0.07       0.06       0.03
boss_2         0.78       0.78       0.78       3.12       0.27       0.05       0.12       0.05
boss_3         0.97       0.97       0.97       3.90       0.53       0.39       0.12       0.05
boss_4         0.97       0.97       0.97       3.90       0.67       0.57       0.31       0.13
boss_5         1.17       1.17       1.17       4.68       0.36       0.29       0.07       0.03
boss_6         0.95       0.95       0.95       3.80       0.09       0.07       0.12       0.05
boss_7         0.67       0.67       0.67       2.67       0.19       0.12       0.05       0.02

（叠加 3 名精准后：法系再吃 RES×0.7，物理再吃 DEF×0.7）
boss_1         1.32       1.32       1.32       5.30       0.27       0.20       0.06       0.03
boss_2         1.13       1.13       1.13       4.52       0.49       0.33       0.12       0.05
boss_3         1.27       1.27       1.27       5.07       0.67       0.57       0.34       0.15
boss_4         1.27       1.27       1.27       5.07       0.77       0.70       0.90       0.39
boss_5         1.40       1.40       1.40       5.62       0.43       0.38       0.37       0.16
boss_6         1.58       1.58       1.58       6.31       0.09       0.09       0.12       0.05
boss_7         1.01       1.01       1.01       4.03       0.25       0.21       0.05       0.02
```

顾问代码查的是同一套数的**通道类**版本（`bosstable.json → bossPayoff`，取该类里最好的路线）：

| boss | arts | artsArcane(精准+奥术3) | phys | physPreci | sargon(25 栈) | needDps(poolEff/165) |
|---|---|---|---|---|---|---|
| boss_1 | 0.975 | 1.325 | 0.167 | 0.267 | 3.900 | 26.2k |
| boss_2 | 0.780 | 1.131 | 0.267 | 0.487 | 3.120 | 18.2k |
| boss_3 | 0.975 | 1.268 | 0.533 | 0.673 | 3.900 | 24.2k |
| boss_4 | 0.975 | 1.268 | 0.667 | 0.901 | 3.900 | 25.5k |
| boss_5 | 1.170 | 1.404 | 0.360 | 0.432 | 4.680 | 18.2k（还要 ÷0.6 抵闪避） |
| boss_6 | 0.950 | 1.577 | 0.115 | 0.115 | 3.798 | 24.1k |
| boss_7 | 0.669 | 1.008 | 0.187 | 0.251 | 2.674 | 42.4k |

口径警告（必须写进代码注释）：**`k` 是「同盘面换通道」的相对系数，不是绝对 DPS**。绝对 DPS 只能由引擎测（`ratio150`）。技能倍率、召唤物、DoT、元素伤害都折叠在实测值里，公式只负责排序与破甲判定。

**结论 2**：法系三兄弟（炎 / 维多利亚 / 谢拉格，名册主 C 是 arts）在 7 个非隐藏 BOSS 上 **0.67~1.17**，加精准后 **1.01~1.58**；
四条物理路线（卡西米尔 / 拉特兰 / 叙拉古 / 阿戈尔）**0.02~0.67**，加精准后 **0.09~0.90**（0.90 只有一例：boss_4 的叙拉古，因为 boss_4 的 DEF 只有 500）。
→ **这正是 REPORT §10.3「二本叙拉古把盘面追平合格曲线（精锐 5 / 装备 10 / 层 257）却仍杀不掉 BOSS」的机制答案**：它把「数量」追平了，把「通道」选错了。叙拉古对 boss_1 的 `k = 0.06`，即使层数翻倍也只有 0.12，而法系是 0.97。

**结论 3**：萨尔贡的 `k` 全场最高（2.67~5.30），来源是 25 栈的 `+12 ASPD×25 = +300 ASPD` 与 `+0.12 ATK×25 = +300% ATK`【引擎系数 `sargonShip.bb.max_buff_stack_cnt=25 / base_attack_speed=12 / base_atk=0.12`】。代价是**要 6 名在场 + 25 栈维持**（栈持续时间 `5+0.22L` 秒，L=130 → 33.6 秒），所以必须写成 `k_eff = k_sargon · u`，`u` = 栈维持率（§3.2 `A_eff` 的 `u_arts/u_phys` 同一套估计）。`u < 0.28` 时萨尔贡就不如法系 + 精准。

### 1.6 真伤与元素：天花板是多少（别把它当主通道）

| 通道 | 公式 | L=130 | L=358 | L=999 | 说明 |
|---|---|---|---|---|---|
| 叙拉古命中真伤 | `proc = 5000 + 50·L`，PRD `p_n = 0.00139·n`（共享计数，n=720 必出） | 24.8k/proc → **≈1.9k DPS** | ≈3.3k DPS | ≈5.6k DPS | 【引擎系数】期望尝试数 `E[N]≈1.2533/√0.00139 = 33.6`【推断】；6 名成员、攻速 `25+0.8L` |
| 卡西米尔阻挡真伤 | 阻挡时每 2 s 对半径 0.8 内 `120%·ATK` 真伤 | ≈2.7k DPS | ≈7k DPS | ≈19k DPS | 需要**真的挡住 BOSS**；boss_5 穿阻挡 → 该通道对 boss_5 无效 |
| 卡西米尔非阻挡 | 每次普攻附加 `30%·ATK` 真伤 | ≈0.7k DPS | — | — | |
| 元素伤害（损伤） | `mitigate('elemental')` 用 `elementRes`；boss_7 的 `elementRes=0`【引擎系数】 | 可用来源少 | | | 妮芙/塑心/伊芙利特等；**不受 boss_7 的 0.4 乘子影响**（buff 只写 `physTakenMul/artsTakenMul`） |

**结论 4**：真伤通道在 L=999 封顶也只有 **5.6~19k DPS**，而 boss_7 需要 42.4k、boss_1 需要 26.2k。
→ **「靠真伤绕过半血减伤」在数学上不足以独立击杀**，只能作为**补充**：叙拉古 proc 约占需求的 **8~13%**（L=130~999），
卡西米尔阻挡真伤理论上可达 **~45%**（19k/42.4k），但它要求「真的把 BOSS 挡住 120 秒」，而 boss_5 穿阻挡、boss_6 远程 —— 实际只有 boss_1/boss_3/boss_7 可行，且必须与法系主通道叠加。
REPORT §4「走真伤」的方向对，量级不够。
→ 可证伪条件：若有盘面只用真伤（零物理/法术）在 165 s 内清空 boss_7 的 7.0M 有效血池，则本结论被推翻。

---

## 2. BOSS 回合盘面重建策略（核心）

### 2.1 输入 / 输出契约

**输入（全部是真实存在的字段，写明来源）**

```ts
type RebuildInput = {
  bossId: string;                    // m.public.bossId            —— 第 1 回合即已知
  hiddenBossId: string | null;       // m.public.hiddenBossId      —— 隐藏核心才用
  modeId: string; difficulty: string;// m.public.modeId / difficulty
  round: number;                     // m.public.round
  bossRound: number;                 // m.public.bossRound（=14）
  lp: number;                        // m.private.lp               —— 决定 W
  funds: number;                     // m.private.funds
  shop: { level, upgradePrice, refreshPrice, slots[] };  // m.private.shop
  hand: Piece[]; board: Piece[];     // m.private.hand / board（{kind,id,golden,tier,items[{id}],row,col,dir}）
  bonds: { bondId, count, tier, layers, active }[];      // m.private.bonds
  nextEnemies: { enemyKey, count, fly, elite, boss }[];  // m.private.nextEnemies（BOSS 回合 = BOSS + 护卫）
  bandId: string;                    // m.private.bandId
  deployCap: number;                 // m.private.deployCap（=8）
}
```

**输出（每个休整期一条，`bossplan` 字段挂在 state.json 上）**

```ts
type BossPlan = {
  boss: { id, name, pool, def, res, lpr, tags, dpsNeeded, windowS };
  diagnosis: {                       // 判定树走出来的结论
    classes: ('highDef'|'highRes'|'halfDamage'|'noLeak'|'pierceBlock')[];
    mainChannel: 'arts'|'artsArcane'|'physPreci'|'true'|'mixed';
    supportChannels: string[];       // 例如 ['arcane3','preci3','siracusaProc']
    mustHave: { blockers?: n, antiAir?: n, healers?: n, revive?: bool, control?: bool };
    verdict: 'winnable'|'tight'|'unwinnable';   // §2.7
    gap: { elites, items, layers, lp };         // 与 §2.4 目标的差
  };
  actions: Action[];                 // 本回合要做的动作，按优先级排序，≤6 条
  keep: string[]; sell: string[];    // 留 / 卖 的 pieceId 集合
  equipTargets: { baseId, itemKind }[];  // 装备给谁
  place: { baseId, row, col, dir, why }[];   // 站位方向
}
type Action =
  | { op:'buy',  slot: number, why: string }
  | { op:'refreshes', n: number, why: string }
  | { op:'level', why: string }
  | { op:'merge', baseId: string, why: string }        // 先买齐第 3 张
  | { op:'sell', uid: number, why: string }
  | { op:'equip', uid: number, itemUid: number, why: string }
  | { op:'place', uid: number, row: number, col: number, dir: 'LEFT'|'RIGHT', why: string }
  | { op:'freeze', slot: number, why: string }
  | { op:'none', why: string };                        // 忍住攒金（也是一种动作）
```

### 2.2 判定树（主算法，可直接实现）

```js
// advisor-dev/bossplan.mjs —— 伪代码，行号即实现顺序
export function planBoss(inp, P /* params.json */) {
  const B  = P.bosses[inp.bossId];
  const lp = inp.lp;
  const W  = P.engine.bossOvertimeAfterReal + lp - escortLeakExpect(inp);   // §2.6 给 escortLeakExpect
  const poolEff = B.pool * (B.poolEffMultiplier ?? 1);
  const dpsNeeded = poolEff / W;

  // ── ① 分类 ───────────────────────────────────────────────────────────────
  const classes = [];
  if (B.def >= P.rebuild.defHighThreshold) classes.push('highDef');
  if (B.res >= P.rebuild.resHighThreshold) classes.push('highRes');
  if (B.phase.physTakenMul < 1 && B.phase.artsTakenMul < 1) classes.push('halfDamage');
  if (B.lpr >= P.rebuild.lprCriticalThreshold) classes.push('noLeak');
  if (B.tags.includes('穿阻挡')) classes.push('pierceBlock');

  // ── ② 主通道：按 §1.5 的 k 矩阵 + 当前盘面实际能凑的通道取 argmax ─────────
  const cands = ['arts','artsArcane','physPreci','true'];
  const score = {};
  for (const c of cands) score[c] = channelScore(c, inp, B, P);   // §2.3
  let main = argmax(score);
  // 硬否决（§1.2 破甲线）：物理在 3 个高防 BOSS 上除非过线否则不许当主通道
  if (main === 'physPreci' && B.def >= P.rebuild.defHighThreshold
      && A_eff(inp) * (1 - 0.05) < B.def * (1 - P.channels.preciDefPierce)) main = 'artsArcane';

  // ── ③ 附加件（supportChannels）：按类别与 k 的边际收益排序 ───────────────
  const support = [];
  if (classes.includes('highDef') || classes.includes('highRes')) {
    support.push('preci3');                      // 精准 3：DEF/RES 各无视 30%，边际最大
  }
  if (main === 'arts' || main === 'artsArcane') support.push('arcane3');   // 奥术 3：法伤承伤 ×1.4
  if (classes.includes('halfDamage')) support.push('trueChannel');          // 真伤补足 8~25%
  if (classes.includes('noLeak')) support.push('airAndBlock');              // 护卫漏 = 扣 LP = 窗口变短

  // ── ④ 必须件（人数/职能下限）─────────────────────────────────────────────
  const mustHave = {
    blockers: 2,                                  // 永远要 2 个挡位接护卫；boss_5 例外（见下）
    antiAir: inp.nextEnemies.filter(e => e.fly).reduce((n,e)=>n+e.count,0) >= 3 ? 2 : 1,
    healers: inp.round >= 10 ? 1 : 0,
    revive: classes.includes('pierceBlock') || B.def >= 1000,   // 埃芒加德/阿戈尔复活额度
    control: classes.includes('pierceBlock') ? 'freeze-or-revive' : null,   // boss_5 免疫冻结 → 只剩复活
  };
  if (classes.includes('pierceBlock')) mustHave.blockers = 1;   // 穿阻挡的 BOSS 不靠挡，留 1 个挡护卫即可

  // ── ⑤ 可赢性判定（§2.7）─────────────────────────────────────────────────
  const verdict = judge(inp, B, dpsNeeded, P);

  // ── ⑥ 生成动作序列（§2.4 的回合表 + §2.5/§2.6 的规则）──────────────────
  const actions = actionsFor(inp, { B, main, support, mustHave, verdict }, P);
  return { boss: {...}, diagnosis: { classes, mainChannel: main, supportChannels: support, mustHave, verdict, gap: gapOf(inp,P) }, actions, keep, sell, equipTargets, place };
}
```

### 2.3 通道评分（取代「专属优先」）

```js
// 通道 c 的分数 = 该通道在「当前盘面能配出的最好形态」下的相对产出（与 §1.5 的 k 矩阵同源）
function channelScore(c, inp, B, P) {
  const L = layersOf(inp);                              // { core, addon }
  const A = A_eff(inp);                                 // 见下方定义
  const p = (c === 'physPreci' || c === 'artsPreci') ? P.channels.preciDefPierce : 0;
  const M = P.channels.arcaneMagicTakenBase + P.channels.arcaneMagicTakenPerLayer * L.addon;   // 奥术乘区
  const DEF1 = B.def,                  DEF2 = B.def * B.phase.defMul;         // 半血前 / 半血后
  const RES1 = B.res,                  RES2 = B.res + B.phase.resFlat;
  const kP = (D) => Math.max(1 - D * (1 - p) / A, P.engine.minDamageRatio);
  const kA = (R) => Math.max(1 - Math.min(100, R * (1 - p)) / 100, P.engine.minDamageRatio);
  const ev = 1 - (B.evadeWhenUnblocked ?? 0);                                  // boss_5：未被阻挡时闪避
  const half = B.phase.atHpRatio < 1;                                          // 有两段血池？
  const blend = (k1, k2) => (half && k1 > 0 && k2 > 0 ? (2 * k1 * k2) / (k1 + k2) : k1);  // 用时之和 = 调和平均

  switch (c) {
    case 'arts':        return blend(kA(RES1) * M,
                                     kA(RES2) * M * B.phase.artsTakenMul) * artsUptime(inp);
    case 'artsArcane':  return blend(kA(RES1) * M,
                                     kA(RES2) * M * P.channels.arcaneLowHpScale * B.phase.artsTakenMul) * artsUptime(inp);
    case 'artsPreci':   return blend(kA(RES1) * M,
                                     kA(RES2) * M * P.channels.arcaneLowHpScale * B.phase.artsTakenMul) * artsUptime(inp);
    case 'physPreci':   return blend(kP(DEF1) * B.phase.physTakenMul * ev,
                                     kP(DEF2) * B.phase.physTakenMul * ev) * physUptime(inp);
    case 'true':        return 1;                    // 真伤不吃 DEF/RES/闪避/承伤乘子（只受 30 万单段上限约束）
    default:            return 0;
  }
}
```
实现要点（每条都能落到字段）：

- `A_eff` = 盘面主 C 的有效攻击力：
  ```
  A_eff = max over board(主 C) of  baseAtk(op) × bondAtkMul(op, L_core) × (op.golden ? 1 : 0.85)
  bondAtkMul: 炎 1.23+0.009L ｜ 维多利亚 1.25+0.008L ｜ 谢拉格 1.25（对冻结目标 1.35+0.01L，BOSS 免疫冻结时失效）
              萨尔贡 1+0.12·stacks（≤25）｜ 卡西米尔 1+min(0.2·deploys, 0.5+0.01L) ｜ 拉特兰 1+min(2.0, 0.04·已耗弹)
              叙拉古 1（无 ATK 乘区，乘区在攻速 25+0.8L）｜ 阿戈尔 1（无 ATK 乘区）        【引擎系数 bonds.json】
  ```
- `artsUptime/physUptime` = 「主 C 的技能覆盖率」估计：`min(1, Σ(技能持续)/技能CD)`，先用 O(1) 保守常数
  `u_arts = 0.45`、`u_phys = 0.55`【推断】；校准方法：同一盘面下用 `ratio150` 反解 `u = ratio150_measured / ratio150_model`。
  萨尔贡的栈维持率 `u_sargon` 等同此处理（它比别家更敏感，因为 25 栈掉了就没有乘区）。
- **硬否决**（不参与 argmax）：`BOSS 免疫冻结` 时谢拉格的寒冷替换乘区 `(1.35+0.01L)` 归零 → `kjerag` 的 `k` 只剩 `1.25`。检验：`enemies.json[boss].stats.immunities.frozen === true`（boss_1/boss_3/boss_5/boss_7 都是 true）。

### 2.4 R10 → R14 动作序列（时间表 + 预算）

坐标系：`tools/balance.mjs CURVES`（合格曲线，R13：精锐 6 / 装备 8 / 核心层 130 / 附加层 75）【引擎系数】。
收入：`income[r] = min(3+r, 12)`【引擎系数 `config.economy.income`】→ R10-R13 每回合约 12-13 金，R10→R13 合计 ≈ **50 金**。
棋价 `T3-T4 = 3 金`、`T5-T6 = 4 金`；刷新 1 金；升级价 R10→L6 = 13 金【引擎系数 `economy.chessPrice` / `modes[mode].upgradePrices`】。

| 回合 | 目标（精锐/装备/核心层） | 必做 | 禁止 | 判定分支 |
|---|---|---|---|---|
| **R9**（锁盟约） | 精锐 3.5 / 装备 5 / 95 | 选定唯一的**输出核心盟约** ρ；把非 ρ 的核心干员列入待卖 | 再买第二条核心盟约的成员 | 若 `bannedChess` 已把 ρ 打残（<6 人）→ 提前走 §3.6 拐弯 |
| **R10** | 4 / 5.5 / 80 | ① 全买 ρ 的第 5-6 名**不同**成员（喂满阈值）② 卖 2 个非 ρ 核心干员（卖价 1 金/个）③ 装备给**主 C**（`equipPerChess=2`） | 升本（L5→L6 的 13 金延到 R12） | 若 `verdict === 'unwinnable'` 且 `gap.lp > 20` → 转「保 LP 打法」（不追精英，只补对空与前排） |
| **R11** | 4.5 / 6 / 95 | ① 补齐 `mustHave.blockers=2` ② 开始凑第 3 张**主 C**（`mergeCount=3`）③ 买进 1 件 T≥5 装备 | 不要为了第二条盟约的层数买人 | 若 `main === 'artsArcane'` → 追加符 2-3 名**奥术**成员（`arcane3` 要 3 名不同） |
| **R12**（断层回合） | 5 / 7 / 110 | ① 升 L6（13 金）② 装备集中到主 C（现在应 6-7 件）③ **血线**：核对 `nextEnemies` 的飞行/精英数，补 1 个对空 | 不要在 R12 把钱花光去刷 —— R12 的敌人血量是 R8 的 **1.44 倍**（单人 ABYSS `enemyScale[12].hp=2.488 / [8]=1.728`）【引擎系数】 | 【实测 REPORT §7】默认 bot R12 漏 19 个：`leaks ≥ 8` 触发 `warn.r12LeakWarn`，优先补前排而不是精英 |
| **R13** | 6 / 8 / 130 | ① 把 §2.2 的 `supportChannels` 全部落实到盘面（精准 3 / 奥术 3 / 真伤件）② 补齐奶位 1 ③ 卖掉所有非 ρ 成员，空出位置给对空 | 不要再用「未来的层数」换当下的战力 —— R13 是最后一个能改盘面的回合 | 若 `gap.elites ≥ 2` → 放弃精英，改走「多一个功能位」（对空/控制/复活） |
| **R14**（BOSS 备战） | 6.5 / 9 / 150 | ① 只做 3 件事：装备换手、站位、卖掉多余件换 1 张能补缺的牌 ② 冻结（`freeze`）留到需要的牌 ③ 站位按 §2.6 | 不要升本（R14 没有下一回合） | 若 `lpr ≥ 30` → 站位强制 `frontPriority = blocker-and-respawn`（宁可少输出也不许漏） |

**BOSS 目标（能否赢的分界线）**：`精锐 8 / 装备 16 / 核心层 300 / 附加层 180` = 合格曲线 ×2。
【实测 REPORT §10.1 + 本轮】profile 2.0（≈ 曲线 ×2）的 R14 **总体**胜率只有 0.744，逐 BOSS 0.50~1.00（boss_7 0.50、boss_6 0.625、boss_3 0.667、boss_2 0.833、boss_1 1.00）；profile 3.0 总体 0.884，逐 BOSS 仍 0.50~1.00。
命令：`balance.mjs --mode solo --difficulty ABYSS --rounds 14 --boss-only --boss-samples 43 --profile {1,1.4,2,3}` → 总体 victory **0.442 / 0.512 / 0.744 / 0.884**（逐 BOSS 见 §5 表）。
→ **「精锐 6 / 装备 8」只是「不死在道中」，不是「能杀 BOSS」。**

> 注意 profile 的天花板：`planBoard` 里精锐数被 `chosen.length`（=8）与装备被 `chosen.length×2`（=16）截断
> 【引擎系数 `tools/balance.mjs:208, 225`】→ **profile ≥ 1.24 后精锐恒为 8，profile ≥ 1.78 后装备恒为 16**，
> 再往上只有层数在涨（核心层 150×p 封顶 999）。这是 §6「上限」的核心约束。

### 2.5 装备分配规则（可执行）

```
for each item（按 tier 降序）:
   候选 = board 上的干员，按 score 排序
   score(op) = 3·isCarrier(op) + 2·isGolden(op) + tier(op) + bossChannelBonus(op) - items(op).length
   isCarrier(op)  = op.dmgType ∈ 主通道的伤害类型
   bossChannelBonus: 主通道 phys/arts 时 +2；维多利亚本家 +3（装备=伤害：6 人档每件 +50%/+80%）【引擎系数 victoriaShip.bb.atk_normal_equip=0.5 / atk_golden_equip=0.3】
   硬约束：每个干员 ≤ equipPerChess(=2) 件
```
- **维多利亚**：装备优先给**带 6 人档**的核心成员（`k` 从 1.25 变 (1.25+0.008L) × (1+0.5·件数)）。
- **阿戈尔**：`equipBias = 0.3`（`routes/_matchup.json`），装备只给乌尔比安/斯卡蒂这类面板主 C，不撒。
- **BOSS 回合的特殊件**：`博士投影`/`突变细胞` 这类「变精锐/升阶」的装备必须在 **R13 之前**用掉（R14 用了也来不及合成）；`寻呼模块`（梓兰/杰西卡送的）留到**缺 1 个不同成员时**开。

### 2.6 站位规则（BOSS 回合专用）

分两层：`placeFor`（普通站位，沿用插件内核已有的 `placeOf`）+ `bossPlaceOverride`（只改 BOSS 回合的四人）。

```js
function placeFor(op, inp, P) {
  if (isHealer(op))                            return { band:'mid',  why:'奶位·中排覆盖' };
  if (op.position === 'MELEE' || op.blockCnt > 1)
                                               return { band:'front', dir:'RIGHT', why:`前排挡路（挡${op.blockCnt}）` };
  if (op.canHitFly)                            return { band:'high', why:'后排出力（高台）· 对空' };
  return { band:'high', why:'后排出力（高台）' };
}

/** BOSS 回合的覆盖规则：先按上面排，再按类别调整（改的是"谁上前排、主 C 放哪、朝哪边"，不改人数） */
function bossPlaceOverride(op, inp, plan) {
  const out = [];
  if (plan.classes.includes('pierceBlock')) {              // boss_5：穿阻挡 + 闪避 0.4
    // 前排只留"死得起"的：有复活额度（不屈 3 名档 / 埃芒加德）或高 HP 坦克；不指望他们活到 150 s
    if (!(hasReviveQuota(op) || op.maxHp >= 2200)) out.push({ op, band:'high', why:'穿阻挡 BOSS：前排只留死得起的' });
  }
  if (plan.classes.includes('noLeak')) {
    // 本体漏 = 直接判负 → 对空与挡位优先于输出位
    if (op.canHitFly && plan.air.gap > 0) out.push({ op, band:'high', why:'0 漏优先：吃掉飞行护卫' });
  }
  if (plan.B.def >= 1000 || plan.classes.includes('halfDamage')) {
    // 保主 C：主 C 放到离 BOSS 进场点最远、且仍在射程内的格子；坦克放它外侧
    out.push({ op: plan.mainCarry, band:'safe', why:'主 C 远离 BOSS 攻击范围' });
  }
  // 朝向：主 C 一律朝 BOSS 来的方向
  out.push({ dir: inp.bossApproachFrom === 'left' ? 'RIGHT' : 'LEFT' });
  return out;
}
```
- **朝向**：BOSS 从 `m.private.nextEnemies[].start` 进场（`boss:true` 的那一条带 `start`），主 C 的 `dir` 要朝着它。
- **boss_5 专项**：`penetrate.def_penetrate = 0.4`（无视 40% 防御）+ `atk 1500` + `穿阻挡`【引擎系数】→
  单次伤害 = `1500 − 0.6·DEF`：对 DEF 557（星熊）是 **1166/击、HP 2849 只能挨 2 下**；对 DEF 379（灰毫）是 1272/击。
  → **结论：boss_5 不许靠前排活**（引擎里没有 def ≥ 2500 的干员），靠「复活额度 + 远程输出 + 0 漏」。
  埃芒加德（前 3 个被击倒立刻复活，`band_ermengard.bb.max_respawn_cnt=3`）在这种场景的期望收益最高【引擎系数】。
- **免疫冻结**（`enemies.json[boss].stats.immunities.frozen`）→ 控场位不能是「冻结」（谢拉格/初雪），只能是晕眩/复活。

### 2.7 可赢性判定（该不该放弃输出、改保命）

```js
function judge(inp, B, dpsNeeded, P) {
  const have = estDps(inp);                        // 盘面 k × 盘面质量（§2.3 + §3.2），非黑箱
  const ratio = have / dpsNeeded;                  // 输出余量
  const lpOk = inp.lp >= P.rebuild.minLpForBoss;   // W 是否够长
  if (ratio >= 1.15 && lpOk) return 'winnable';    // 有余量：按 §2.4 正常推进
  if (ratio >= 0.85)         return 'tight';       // 缺口 ≤15%：靠站位、不漏怪、补 LP 能补上
  if (ratio <  0.85 && !lpOk) return 'unwinnable'; // 输出与窗口双缺
  return 'unwinnable';                             // ratio < 0.85 且 LP 够也不行：缺口 > 15%
}
```
`unwinnable` 时的动作切换（这是「不放弃但仍然诚实」的分支）：

```
① 不再为 BOSS 换盘面（省下的 30-50 金换不回 15% 输出）
② 优先保 LP：对空位、前排、减伤、复活（目的是多活 1-2 回合，拿回合分）
③ 报告里写明缺口：gap = { dps: 1 - ratio, elites, layers, bestChannel }
```
【实测】支持这个分支：`balance.mjs` profile 1.0 逐 BOSS `ratio150` 里 boss_7 = 0.390（远低于 0.909 的 LP15 胜线）→ 该局无论怎么站位都赢不了，硬追只会连回合分也丢掉。

---

## 3. 顾问的实时决策模型（每回合输出）

### 3.1 输出结构（`state.json` 增字段，小框只显示前 3 行）

```json
{
  "round": 11, "funds": 14, "lp": 33, "level": 5,
  "main": { "bondId": "victoriaShip", "count": 5, "next": 6, "layers": 96, "k": 1.19 },
  "boss": { "id": "boss_6", "mainChannel": "artsArcane", "support": ["preci3"], "dpsNeeded": 24121, "verdict": "tight", "gap": { "elites": 2, "items": 3, "layers": 34, "lp": 18 } },
  "pick":  { "slot": 2, "name": "号角", "price": 4, "score": 78, "why": ["本家 +1（5→6）", "Boss 通道匹配（法系副 C）"] },
  "alts":  [ { "slot": 0, "name": "薄绿", "score": 71 }, { "slot": 4, "name": "烛煌", "score": 66 } ],
  "move":  { "kind": "buy", "text": "抓 号角（槽位 3）" },
  "level": { "recommend": false, "why": "13 金升本会断掉第 6 个维多利亚（差 4 金）" },
  "refresh": { "recommend": false, "why": "本回合还有 ≥40 分的格子" },
  "bounty": [ { "name": "「猎手」", "score": 12, "why": "报酬 8·金币 6" } ],
  "pivot": { "active": false, "reason": "层数份额 0.41 < 0.60" },
  "place": [ { "name": "号角", "band": "front", "dir": "RIGHT", "why": "前排挡路（挡3）" } ],
  "warn": ["对空 1/2（本波 5 只飞行）"]
}
```

### 3.2 抓谁：`scoreSlot` v2（唯一评分函数，替代 `open-brief` 的 road×gate 与插件的 `scoreSlot`）

```js
function scoreSlot(slot, ctx, P) {
  const w = P.advisor.scoreSlot;
  let s = 0; const why = [];
  if (slot.kind === 'item') {
    // 装备：tier × 路线 equipBias × BOSS 通道匹配（维多利亚/萨尔贡吃装备）
    const bias = routePolicy(route).equipBias ?? 0.5;
    s = (16 + slot.tier * 5) * (0.6 + bias);
    if (bossMainChannel.startsWith('arts') && route === 'victoriaShip') { s += w.wBossFit * 0.6; why.push('装备=伤害（本家吃满）'); }
    if (slot.price > funds) s -= Math.abs(w.penNoFunds);
    return { score: s, why, ... };
  }
  // ── 干员 ─────────────────────────────────────────────────────────────────
  const onRoute = bondsOf(slot.id).includes(route);
  const next = nextThreshold(route, progress.count);
  if (onRoute) {
    if (next !== null) { s += w.wRoute;                       why.push(`${bondName(route)} +1（${count}→${count+1}）`); }
    else               { s += w.wRouteCapped;                 why.push(`${bondName(route)} 已满`); }
  } else { s += w.penOffBond;                                 why.push('不搭路线'); }

  if (isKeyOp(slot.id, route)) { s += w.wKey;                 why.push('关键干员'); }

  const copies = held[baseOf(slot.id)] || 0, need = mergeOf(baseOf(slot.id));   // need = 3（mergeCount）
  if (copies >= need)      { s += w.wCopyExcess;  why.push('已精锐·多余'); }
  else if (copies === need-1) { s += w.wCopyLast; why.push('差 1 张精锐'); }
  else if (copies > 0)     { s += w.wCopyPartial; why.push(`已有 ${copies} 张`); }
  else                     { s += w.wCopyFirst; }

  s += Math.max(0, tierOf(slot.id) - 1) * w.wTierPerLevel;

  // ★ 新增：BOSS 通道匹配（§1.5 的 k 矩阵）—— 这是把「盘面追平却杀不掉 BOSS」修掉的那一项
  const fit = bossFit(slot.id, ctx);        // ∈ [-1, 1]
  if (fit) { s += w.wBossFit * fit; why.push(fit > 0 ? `Boss 通道 +${Math.round(w.wBossFit*fit)}` : `Boss 通道 −${Math.round(-w.wBossFit*fit)}`); }

  // 对空闸：飞行占比 ≥ 0.35 且场上对空缺口 > 0 时，能打飞的白送分
  if (ctx.air.hot && ctx.air.gap > 0 && canHitFlyOf(slot.id)) { s += w.wAir; why.push(`对空（本波 ${ctx.air.fly} 只飞行）`); }
  // 前排闸：挡位不够时，能挡的加分
  if (ctx.blockers.gap > 0 && isBlockerOf(slot.id)) { s += w.wBlockerGap; why.push('补前排挡位'); }

  if (slot.price > funds) { s -= Math.abs(w.penNoFunds); why.push('资金不够'); }
  else if (funds - slot.price < 4) { s += w.penThinFunds; why.push('买完很紧'); }
  return { score: Math.max(0, Math.round(s)), why, ... };
}

// ★ bossFit：把 §1.5 的 bossPayoff 表变成逐格分值（读表，不做浮点）
function bossFit(id, ctx) {
  const ch = damageClassOf(id, ctx.route);        // 'arts' | 'artsArcane' | 'phys' | 'physPreci' | 'true' | null
  if (!ch) return 0;
  const row = bosstable.bossPayoff[ctx.bossId];
  const k = row[ch] * (ch === 'artsArcane' && ctx.route === 'sargonShip' ? (ctx.sargonUptime ?? 1) : 1);
  const best = Math.max(row.arts, row.artsArcane, row.phys, row.physPreci);
  return Math.max(-1, Math.min(1, (k - 0.5 * best) / (0.5 * best)));   // best 得 +1，best 的一半得 0，远低于 best 得 −1
}
```

**`damageClassOf` 的判定（无歧义版）**：

```js
function damageClassOf(id, route) {
  const c = chess(id);
  if (isHealer(c) || c.attackKind === 'none') return null;         // 奶/无攻击：不参与通道评分
  if (c.dmgType === 'arts')  return c.bonds.includes('arcaneShip') || route === 'victoriaShip' ? 'artsArcane' : 'arts';
  if (c.dmgType === 'phys')  return hasPreci3Possible(route) ? 'physPreci' : 'phys';
  return null;
}
```

**每个决策特征 ↔ 真实字段（写代码时照这张表取数，不许自己造）**

| 特征 | 来自 | 取值 |
|---|---|---|
| `ctx.bossId` / `bossRound` | `m.public.bossId` / `m.public.bossRound` | 第 1 回合就有 |
| `ctx.route` | 玩家选择（`route.json` / 插件 storage）→ 否则 `api.autoRoute(priv, stuck, banned)` | 核心盟约 id |
| `ctx.funds` / `lp` | `m.private.funds` / `m.private.lp` | |
| `slot.kind` / `slot.id` / `slot.price` / `slot.frozen` | `m.private.shop.slots[i]` | `sold` 的先剔掉 |
| `shop.level` / `upgradePrice` / `refreshPrice` / `freeRe` | `m.private.shop.*` | |
| `held[base]` | `m.private.board[] + m.private.hand[] + m.private.temp[]` 里同 `baseId` 的件数（`api.heldCounts`） | 含精锐 |
| `progress.count` / `next` | `m.private.bonds[]` 里 `bondId===route` 的 `count`，阈值 `thresholds`（`full:true` 时才有） | `countsHand` 的盟约要把手牌算进 |
| `layers.core` / `layers.addon` | `m.private.bonds[]` 的 `layers` | 核心与附加分开取 |
| `ctx.air` | `m.private.nextEnemies[]` 的 `fly × count` vs `board` 上 `canHitFly` 的件数 | `flyShare ≥ 0.35` 为 hot |
| `ctx.blockers` | `board` 上 `blockCnt>0 && position==='MELEE'` 的件数 | 目标 2 |
| `isKeyOp` | `routes/_matchup.json.routes[route].keyOps` 与 `chess.name` 对齐 | 现有 `api.isKeyOp` |
| `equipBias` / `levelCap` / `needs` | `routes/_matchup.json.routes[route].policy / needs` | 热更新文件 |
| `bandUsage` | `routes/_matchup.json.bandUsage[m.private.bandId]` | 一句话机制提醒 |
| `bossPayoff` | `model/bosstable.json → bossPayoff[bossId]` | 生成物 |
| 悬赏卡 | `m.private.personalChoice.cards[]`（`name/payout/coin/tier/rounds/enemyKey`） | `payout:'perfect'` 特殊 |
| 队友在抢什么 | `m.public.players[].bonds[]` 的 `count` | 拐弯与「避让」共用 |
| 本波漏了多少 | `m.private.stats.leaks`（累计） | 配合 `m.public.players[].pendingLp` 判血线 |
| 排行榜/席位 | `m.public.players[].seat / alive / lp` | 多人时判断谁该让牌 |

**备选 1/2/3 的输出规则**（`alts`）：

```
主选 = argmax score
备选 = 按 score 降序，取与主选**不同 baseId** 的前 2 个，且 score ≥ max(buyThreshold.weak, 0.7·score主选)
若三者的 score 差 ≤ 5 → 全部并列输出（避免虚假精度，ARCHITECTURE §G「top 候选差值未分辨时显示并列」）
```

### 3.3 该升还是该刷（含期望值）

```
upgradeValue (level ℓ → ℓ+1) =
      Δslots(ℓ) · p_slot · v_unit            // 每格多 1 个棋位：v_unit ≈ 主选 score 的均值（≈45）
    + ΔtierShare(ℓ) · n_active · v_tier      // 高本刷新概率变化，v_tier ≈ 6
    + (ℓ+1 === 6 ? v_L6 : 0)                 // L6 解锁 5 个棋位 + 最高阶装备，v_L6 ≈ 40
```
判定：

```
if (level < levelCap(route, round) && funds ≥ price + levelPolicy.fundsBufferForLevel)  → 升
else if (bestSlotScore ≥ buyThreshold.strong && bestSlotScore > price)                  → 买
else if (bestSlotScore ≥ buyThreshold.weak)                                             → 可以买
else if (funds ≥ refreshPrice + 2 && refreshesLeft > 0)                                 → 刷
else                                                                                     → 等（攒金）
```
`levelCap` 取自 `routes/_matchup.json` 的 `policy.levelCap`（叙拉古 2 本到 R8、维多利亚 3 本到 R6 …），
R10 之后一律以 `bossPhaseLevelFloor = 6` 覆盖（BOSS 备战必须满本）。
【实测支撑】REPORT §7「升级节奏 +1档/+2档/慢升级/卡L4 全部 0/6」——单改升级节奏无效；有效的是**「升级 + 通道」组合**。所以 `levelCap` 只在 §2.4 的时间表内生效。

### 3.4 悬赏 / 机变卡

```js
scoreBounty(card) = payout + coin·coinWeight + tier·tierWeight − rounds·perRoundCost
                    − (isBossEnemy ? bossPenalty : 0) − (elite ? elitePenalty : 0)
// params: coinWeight 0.5, tierWeight 4, perRoundCost 3, bossPenalty 25, elitePenalty 10（沿用 routes/_matchup.json bountyModel）
接受条件：scoreBounty ≥ minAcceptScore(=0) 且 rounds ≤ 2 且（LP ≥ 15 或 payout ≥ 5）
```
BOSS 回合（R14）**一律不接高难度悬赏**：BOSS 回合的漏怪价是 `lpr` 倍，把「多打 2 个精英」的风险乘 15 倍（boss_5）。
BOSS 回合**唯一值得接**的是「金币/免费刷新」类（`payout === 'perfect'` 或 `coin > 0` 且不增敌人）。

### 3.5 拐弯（玩家偏离建议时）

玩家不是照建议走的。顾问必须跟随实况，但**不能每个 tick 都变**（会抖）。

**触发条件（全部满足才拐）**

```js
const own = bonds.filter(b => isCore(b.bondId) && b.layers >= P.advisor.pivot.minLayers)   // ≥20 层，排除偶然
                  .sort(by layers desc);
const share = own[0].layers / sum(activeBonds.layers);        // 层数份额
pivotTo = own[0].bondId;
if (pivotTo !== route
    && share >= P.advisor.pivot.minShare                       // 0.60
    && progressOf(pivotTo).count >= thresholdsOf(pivotTo)[0]   // 已经到第一档，不是空想
    && round <= P.advisor.pivot.lastPivotRound                 // ≤9（R10 之后重建窗口已锁定）
    && pivotsUsed < P.advisor.pivot.maxPivots)                 // 最多拐 1 次
  → 拐弯（下一回合起把 route 换成 pivotTo）
```

**切换代价（必须显式算，否则拐弯会亏）**

```
pivotCost = Σ_{board ∪ hand 上不在 pivotTo 的干员} price(base) · (1 + piecesValueFactor·bankedCopies)
          + Σ_{已装备在要卖掉的干员上的装备} 2·tier          // 装备不能卖（itemSellable=false），只能弃
          + (层数损失) L(recommended) · λ_layer                // λ_layer = 该盟约每层对 k 的边际（见下）
acceptPivot ⟺ scoreRoute(pivotTo) − scoreRoute(current) ≥ pivotCost
```
`λ_layer` 的算法：`∂k/∂L`。
- 炎：`k ∝ (1.23+0.009L)` → dk/dL = 0.009·A/DEF 量级
- 维多利亚：`(1.25+0.008L)`
- 叙拉古：攻速 `25+0.8L` → 命中数线性增长，`dk/dL = 0.8/100 × k/命中数`
- 奥术：`M = 1.2+0.01L` → **每层 +1% 法伤承伤**，这是全表最陡的一条（`dk/dL = 0.01·k_arts`）
→ 【推断】**奥术层的边际最高，拐弯时最该保留的是奥术层**。可证伪：固定盘面只改 `layers.arcaneShip`（0/50/100）用 `balance.mjs --layers` 口径测 `ratio150` 非线性增长。

**拐弯后的输出**：不重排所有建议，只改 `route`、`main`、`ranking` 三项，并在小框打一行 `已跟随你的实况：X`（避免玩家以为顾问失忆）。

---

## 4. 参数表（= `advisor-dev/model/params.json`，代码直接读）

字段全量见 `params.json`（含 `_evidence` 逐条依据）；**生成的系数表**在 `bosstable.json`（`rows` = 逐 BOSS 参数，`payoff` = 路线×BOSS，`bossPayoff` = 通道类×BOSS）。
分工：**手写常数 → `params.json`；从引擎数据算出来的表 → `bosstable.json`（重跑 `lab/bosstable.mjs --json --out` 覆盖，不手改）**。核心段摘录：

| 路径 | 值 | 依据 |
|---|---|---|
| `engine.minDamageRatio` | `0.05` | 【引擎系数】`server/sim/constants.js:68` |
| `engine.bossHitLimit` | `300000` | 【引擎系数】`shared/constants.js`（≥30 万单段被整体取消） |
| `engine.bondLayerCap` | `999` | 【引擎系数】`shared/constants.js BOND_LAYER_CAP` |
| `engine.combatTimeScale` | `2` | 【引擎系数】`gamedata.js COMBAT_TIME_SCALE` |
| `engine.bossOvertimeAfterReal` | `150` | 【引擎系数】`config.bossOvertimeAfter` |
| `engine.bossOvertimeDrainPerSec` | `1` | 【引擎系数】`config.bossOvertimeDrainPerSec` |
| `engine.deployCap` / `equipPerChess` / `mergeCount` | `8` / `2` / `3` | 【引擎系数】`config.economy` |
| `engine.refAtkElite` | `577` | 【引擎系数】`data/chess.json` 精锐 T5/T6 主 C 基础 ATK 中位 |
| `channels.preciDefPierce` / `preciResPierce` | `0.3` / `0.3` | 【引擎系数】`bonds.json preciShip.bb.power_def_penetrate / power_magic_resist_penetrate` |
| `channels.arcaneMagicTakenBase` / `PerLayer` / `LowHpScale` | `1.2` / `0.01` / `1.4` | 【引擎系数】`arcaneShip.bb.base_damage_scale / damage_scale_per_stack / power_weak_scale` |
| `channels.siracusaProcBase` / `PerLayer` / `PrdStep` | `5000` / `50` / `0.00139` | 【引擎系数】`siracusaShip.bb.base_damage / damage_per_stack`，`spec.prdStep` |
| `channels.siracusaExpectedAttempts` | `33.6` | 【推断】PRD 期望 `1.2533/√c` |
| `channels.kazimierzBlockTrueScale` / `Interval` | `1.2` / `2` | 【引擎系数】`kazimierzShip.bb.damage_atk_scale / damage_interval` |
| `bosses.boss_7.phase.physTakenMul` | `0.4` | 【引擎系数】`enemies.json enemy_9033_acdeer talents Madness.damage_resistance=0.6` |
| `bosses.boss_7.poolEffMultiplier` | `1.75` | 【推断】`0.5P + 0.5P/0.4` |
| `bosses.boss_6.phase.defMul` / `resFlat` | `2` / `45` | 【引擎系数】`enemy_9032_aclionk talents advance.def=1 / advance.magic_resistance=45` |
| `bosses.boss_5.evadeWhenUnblocked` | `0.4` | 【引擎系数】`enemy_2016_csphtm talents evade.prob=0.4` |
| `bosses.boss_5.lpr` | `30` | 【引擎系数】`data/bosses.json boss_5.lpr` |
| `rebuild.defHighThreshold` / `resHighThreshold` / `lprCriticalThreshold` | `1000` / `50` / `30` | 【引擎系数】逐 BOSS 面板 + 【实测】REPORT §3 血池伤害比 |
| `rebuild.targets.R13` | `elites 6 / items 8 / core 130 / addon 75` | 【引擎系数】`tools/balance.mjs CURVES` |
| `rebuild.bossWinTargets` | `elites 8 / items 16 / core 300 / addon 180` | 【实测】REPORT §10.1 §10.3 + 本轮 profile 扫描 |
| `advisor.scoreSlot.*` | 见 `params.json` | 【引擎系数】沿用插件内核 `scoreSlot` 现有量纲；`wBossFit=40` 为本规格新增 |
| `advisor.levelPolicy.routeCaps` | 见 `routes/_matchup.json policy.levelCap` | 【引擎系数】 |
| `advisor.bounty.*` | `0.5 / 4 / 3 / 25 / 10` | 【引擎系数】`routes/_matchup.json bountyModel` |
| `advisor.pivot.*` | `minLayers 20 / minShare 0.6 / confirmRounds 2 / lastPivotRound 9 / maxPivots 1` | 【推断】见 §3.5 |

读取方式（不改现有工程结构）：

```js
// open-brief.mjs / overlay.mjs（Node 侧）
const P = JSON.parse(await fs.readFile(path.join(here,'model','params.json'),'utf8'));
// 插件内核（iframe 内无 fetch）：打包时把 params.json 的内容并进 index.html 的 #sp-data 块
//   core-loader.mjs 的 DATA 已经这么干了，加一个 P 字段即可：const P = DATA.params;
```

---

## 5. 验证计划（三条链，各自有预期数字与失败判据）

### 链 A —— 先证明「这样的盘面能杀 BOSS」（用 `--profile` 造任意强度盘面）

```bash
# A1 逐 BOSS 定向（推荐：钉死 bossId，曲线干净）
node advisor-dev/lab/bossprobe.mjs --boss all --profile 1.0,2.0,5.0 --samples 6 --lp 15
# A2 随机 BOSS 复现 REPORT（43 样本/档，才够覆盖 boss_7 的 2/43）
node tools/balance.mjs --mode solo --difficulty ABYSS --rounds 14 --boss-only --boss-samples 43 --profile 1.0 --seed 1 --json
node tools/balance.mjs --mode solo --difficulty ABYSS --rounds 14 --boss-only --boss-samples 43 --profile 2.0 --seed 1 --json
```

**本轮已测得的基线（这就是预期数字；命令完全一样，必须能复现到 ±0.1）**：

| profile | R14 总体 victory | boss_1 | boss_2 | boss_3 | boss_4 | boss_5 | boss_6 | boss_7 |
|---|---|---|---|---|---|---|---|---|
| 1.0 | **0.442** | 0.750 | 0.500 | 0.167 | 0.500 | 0.545 | 0.250 | **0.000** |
| 1.4 | **0.512** | 0.875 | 0.333 | 0.167 | 0.500 | 0.636 | 0.500 | **0.000** |
| 2.0 | **0.744** | 1.000 | 0.833 | 0.667 | 0.500 | 0.727 | 0.625 | 0.500 |
| 3.0 | **0.884** | 1.000 | 1.000 | 0.833 | 1.000 | 0.909 | 0.750 | 0.500 |

（`--boss-samples 43 --seed 1`，ABYSS solo R14。注意这与 REPORT §10.1「profile 2.0 → 100%」**不一致**：REPORT 用的是 8 样本，boss_7 在 8 样本里只出现 1-2 次，抽样误差掩盖了它的 50%。以 43 样本为准。）
原始输出（可直接 `require` 复算）：`lab/abyss-boss-p{100,140,200,300}.json`、`lab/abyss-boss-p{100,140}-lp45.json`。

定向曲线（`bossprobe --samples 6 --lp 15`，种子 `1001,1008,…`）：

| boss | p1.0 ratio150 / victory | p2.0 | p5.0 | ratio150 min@5.0 |
|---|---|---|---|---|
| boss_1 | 0.77 / 33% | 0.85 / 67% | 0.92 / 83% | 0.49 |
| boss_2 | 0.68 / 50% | 0.83 / 67% | 0.89 / 83% | 0.32 |
| boss_3 | 0.56 / 17% | 0.87 / 83% | 0.87 / 83% | 0.24 |
| boss_5 | 0.68 / 50% | 0.85 / 67% | 0.91 / 83% | 0.45 |
| boss_6 | 0.55 / 17% | 0.90 / 67% | 0.97 / 83% | 0.81 |
| boss_7 | 0.53 / 0%（1.4 档 33%，2.0 档 50%，3.0 档 50%） | 0.73 / 50% | 0.87 / **83%** | **0.28** |

**链 A 的失败判据**：若 profile 5.0 的 `ratio150Min` 仍 < 0.5（现在 boss_7 = 0.28），说明**瓶颈是通道错配而不是强度**——
这正是本规格 §2.3 存在的理由；此时不许再用 profile 换胜率，必须靠 `mainChannel` 选择。

> `bossprobe` 的 `dpsNeeded` 是 `pool/W`（不含阶段乘子的血池放大）；含有效血池的值在 `bosstable.json rows[].dpsNeeded`（§1.3 的表）。

### 链 B —— 再证明「策略能产出这样的盘面」（`matchrun.mjs` 真实 Match）

```bash
# B1 盘面诊断（逐回合 精锐/装备/层数，对照 §2.4 的时间表）
node advisor-dev/lab/inspect.mjs --difficulty ABYSS --seed 1 --lp 45
# B2 带策略参数的整局
node tools/matchrun.mjs --mode solo --difficulty ABYSS --seeds 12 --lp 45 --json
#   策略参数用 lab/policies.json 的 commit-late / siracusa-twolevel 两组做对照
```

**预期数字**

| 指标 | 现状【实测 REPORT §10.2/§10.3】 | 本规格的目标 | 失败判据 |
|---|---|---|---|
| R13 精锐 | 2 | **≥6** | < 5 |
| R13 装备 | 8 | ≥8 | < 7 |
| R13 Σ层 | 266 | ≥ 280（核心 130 + 附加 75×2） | < 250 |
| R12 漏怪 | 19 | ≤ 8 | > 12 |
| R14 到达率 | 6/6（LP60 时） | 6/6 | < 5/6 |
| 盘面**通道**正确 | 未测（bot 不选通道） | 主通道 = §2.3 argmax | 出现「法系 BOSS 上物理主 C 占 3 席」 |

**链 B 的关键新指标（必须加进 `inspect.mjs`）**：`k_board`（盘面通道系数）

```js
k_board = Σ_{board 主 C} (贡献占比 × k(boss, damageClassOf(op)))
// 目标：R13 起 k_board ≥ 0.85（即：盘面上 ≥85% 的输出走的是对的那个通道）
// 现状（默认 bot 摊在 3-4 条盟约）：预期 k_board ≈ 0.3-0.5
```

### 链 C —— 端到端（30 种子）

```bash
node tools/matchrun.mjs --mode solo --difficulty ABYSS --seeds 30 --lp 45
```

**预测**：`胜率 ∈ [0.40, 0.65]`。
依据：盘面追平合格曲线（profile ≈1.0）时 BOSS 单体胜率 0.442；把通道修正到位（`k_board` 0.4 → 0.85，等于 §1.5 里从「叙拉古 0.06」换到「法系 0.97」，约 profile +1 档）→ 预期落在 profile 1.4-2.0 的 0.512-0.744 区间，扣掉 R12 血线损失，取 0.40-0.65。

**链 C 的失败判据（可证伪，写进代码注释）**：
- 若 `k_board ≥ 0.85` 且 `精英 ≥ 6` 但胜率 < 0.30 → **§1.5 的通道矩阵错了**（公式与引擎不符），必须先跑 A1 用同种子配对复验。
- 若 30 局里 `R12 漏怪中位数 > 12` → 决策模型对「血线」的权重不够，`wAir/wBlockerGap` 要上调，与通道无关。

### 链 D —— 机制断言（两条最容易错、最值得单测）

1. **30 万上限**：构造一个单段 ≥300k 的真伤（`--layers` 把叙拉古层数拉到 999 → proc = 5.5 万，还不够；用卡西米尔阻挡真伤 × 层数）观察 `fx hitCap` 且 BOSS 血池不变。断言：`hitCap` 事件出现时 `pool.hp` 不减。
2. **5% 保底**：固定盘面只改 `layers.preciShip`（0 vs 40 → 精准是否到 3 名档），在 boss_1 上测 `ratio150`。预期：精准 3 档 → `ratio150` 至少 +25%（物理部分从 `k=0.17` 到 `0.27`，即 +59% 物理输出）。

---

## 6. 上限：ABYSS 单人能不能到 100%

**结论：不能到 1.00；可证的上限是 0.90 左右，卡点是 boss_6 与 boss_7，不是「盘面还不够强」。**

先看可赢的真值条件（§1.3）：`ratio150 ≥ 150/W`，ABYSS 单人 R14 是 `W = 165 s（LP15）→ ratio150_req = 0.909`、`W = 195 s（LP45）→ 0.769`。

再看「盘面强度」的三个硬天花板（这不是调参问题，是数值结构）：

1. **精锐上限 = 8**（`deployCap`），**装备上限 = 16**（`2 × deployCap`）【引擎系数 `tools/balance.mjs:208/225` 的截断】。
   → profile ≥ **1.24** 后精锐恒为 8，≥ **1.78** 后装备恒为 16，**再往上这两个旋钮没有任何效果**。
2. **层数上限 = 999**（`BOND_LAYER_CAP`）。合格曲线 R14 核心层 150 → profile 到 **6.66** 就到顶；附加层 90×p 要 p = 11.1。
   → 所以「把盘面堆到极限」= profile ≈ 6.7~11，仅此而已。
3. 实测阶梯（`--boss-samples 43`）：profile **1.0 / 1.4 / 2.0 / 3.0** → R14 总体 victory **0.442 / 0.512 / 0.744 / 0.884**。

**关键观测（决定了上限的形状）**：把 `ratio150` 的平均值与最小值放在一起看，尾部不是「差一点」，而是「完全打不动」：

| profile | boss_7 ratio150 平均 | 最小 | boss_6 平均 | 最小 | boss_5 平均 | 最小 |
|---|---|---|---|---|---|---|
| 2.0 | 0.73 | **0.24** | 0.90 | 0.59 | 0.85 | 0.32 |
| 5.0 | 0.87 | **0.28** | 0.97 | 0.81 | 0.91 | 0.45 |

profile 5.0 的 boss_7：**5/6 的样本在 76 真实秒内打穿血池（等效 ≈ 7.0M/76 ≈ 92k 有效 DPS，远超 42.4k 的需求）**，剩下 1/6 只打到 28%（≈7.5k DPS）。
**同一档强度、同一条曲线，结果差 12 倍 —— 差的是伤害通道，不是数量。** 这 1/6 就是「物理盘 vs DEF800×0.4」那类错配。

于是

```
P(win) = P(通道正确) × P(强度够 | 通道正确)
```

- `P(通道正确)` 正是本规格 §2.3 要解决的那一项（随机盘面 ≈ 0.83，见 profile 5.0 的 victory；本规格目标推到 ~1）。
- `P(强度够 | 通道正确)` 在 profile ≥ 2.0 时已被实测证明很高（打穿的样本余量 2 倍以上）。

**那么上限就是两个 BOSS 的封顶**（用实测的每 BOSS 最高值算，其余取 1.0，按 `data/bosses.json` 的 weight 加权：

```
weight  boss   实测最高 victory（样本档）
6       boss_1 1.000（p2.0 / p3.0，n=8）
6       boss_2 1.000（p3.0，n=6）
6       boss_3 0.833（p3.0，n=6）
5       boss_4 1.000（p3.0，n=2）
10      boss_5 0.909（p3.0，n=11）
5       boss_6 0.750（p3.0，n=8）      ← 卡点
5       boss_7 0.500（p3.0，n=2）/ 0.833（p5.0，n=6）  ← 卡点

加权 = (6·1.0 + 6·1.0 + 6·0.833 + 5·1.0 + 10·0.909 + 5·0.75 + 5·0.833) / 43
     = (6 + 6 + 5 + 5 + 9.09 + 3.75 + 4.17) / 43 = 39.0 / 43 ≈ 0.907
```

**所以 ABYSS 单人 R14 的可达上限 ≈ 0.90（R14 那一场），端到端（含 R12 血线）≈ 0.80-0.88。不是 1.00。**

两个卡点为什么封顶：

| 卡点 | 机制 | 封顶证据 | 为什么决策模型救不了 |
|---|---|---|---|
| **boss_6** | 半血后 DEF 1030→**2060**、RES 20→**65** | p3.0 仍只有 0.750（n=8） | 物理需 ATK > 2168（带精准 > 1518），等于要求 ATK 乘区 ×3.76 且同时满足 3 名精准；法系则要扛 RES 65（k=0.35） |
| **boss_7** | 半血后物法 **×0.4**（有效血池 ×1.75，需 42.4k DPS） | p3.0 0.500（n=2）、p5.0 0.833（n=6），**任何档位都没到 1.0** | 真伤通道封顶只有 5.6~19k DPS（§1.6），补不满 42.4k |
| （次卡点）**boss_5** | lpr 30 + 未阻挡闪避 0.4 + 穿阻挡 | p3.0 0.909（n=11），非 1.0 | 本体漏 1 次就直接判负，`P(本体零漏) < 1` 是结构性的 |

**想再往上，只有三条真实路径，而且都不是决策模型能做主的**：
1. 抽到好 BOSS（boss_4/boss_1 而不是 boss_7）——RNG。`bossId` 第 1 回合已知，模型能做的是**第 1 回合就告诉玩家「这局的上限是多少」**（把上面的表读出来即可）；
2. 队伍 LP 抬到 ≥45（歌利亚 / 前中期少漏）——实测 +9~16pp，**但对 boss_7 无效**（0% → 0%）；
3. 引擎/规则变更（例如把 `Madness.damage_resistance` 从 0.6 调低、或把 boss_6 的 `advance.def` 从 1 降到 0.5）——超出玩家能力边界，写在这里只是为了说明「100% 不是靠打得好能达到的」。

> 一句诚实的总结：**这套引擎 + 这套数值下，ABYSS 单人满通的数学上限是 0.90（R14 场），端到端 0.80-0.88。
> 说 100% 的人，要么没跑够样本（8 样本时 boss_7 只出现 1-2 次），要么把「通道」当成了「强度」。**

---

## 附录 A：实现顺序（严格按此推进，每步都能被链 A/B 验证）

| # | 文件 | 内容 | 验收 |
|---|---|---|---|
| 1 | `advisor-dev/model/params.json` | 本规格全部常数（**已完成**） | `node -e "require('./advisor-dev/model/params.json')"` 无异常 |
| 2 | `advisor-dev/model/bosstable.json` | BOSS×通道系数表（**已完成**，由 `lab/bosstable.mjs --json --out` 生成） | 重跑生成器逐字节一致 |
| 3 | `advisor-dev/lab/bossprobe.mjs` | 钉 bossId 测强度曲线（**已完成**） | §5 链 A 的表可复现 |
| 4 | `advisor-dev/lab/bosstable.mjs` | 从 `bonds.json`/`enemies.json` 算 k 矩阵（**已完成**） | `--json` 输出与 §1.5 的数字一致 |
| 5 | `advisor-dev/bossplan.mjs` | §2.2 判定树 + §2.4 时间表 + §2.5/2.6 规则 | 对 7 个 BOSS × 3 种盘面快照输出合法 `BossPlan`（单测） |
| 6 | 插件内核 `index.html` 的 `// <CORE>` 段 | `scoreSlot` v2（加 `wBossFit`）+ `alts` + `pivot` | `lab/test-brief.mjs` 与 `demo-state.mjs` 仍通过 |
| 7 | `open-brief.mjs` | 用 `params.json` 替换硬编码常数；`scoreRoute` 的 `gate` 换成 §2.3 的 k | 三个 demo 局面的排序与本文 §1.5 一致 |
| 8 | `lab/inspect.mjs` | 增加 `k_board` 与 §2.4 目标的逐回合对照 | 链 B 表能直接打出来 |

## 附录 B：本文与既有架构的关系

- `model/ARCHITECTURE.md` 的 §A（POMDP 形式化）、§B（三种率）**不变**，本文是其 §C/§D 的一个**可实施特例**：
  把「资源→输出转换」在 BOSS 回合具体化为 §1.5 的 k 矩阵，把「40 条策略的事件核」在顾问侧具体化为 §3.2 的 `scoreSlot` v2。
- 本文**推翻** ARCHITECTURE §0 表格里没有列到的第 4 条隐式假设：*「盘面强度够就能过 BOSS」*。
  证据：profile 5.0（精锐 8 / 装备 16 双饱和）仍只有 83%，`ratio150Min` 低到 0.24-0.28 —— **通道选错时，强度不救**。
- 本文与 `lab/REPORT.md` 的冲突只在两处，均已标明：§10.1 的「profile 2.0 → 100%」（43 样本实测为 0.744）；§4.1 的「走真伤」需要降级为「真伤只能补 8-25%」。
