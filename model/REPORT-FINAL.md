# 《卫戍协议：盟约》ABYSS 决策模型 —— 最终测量报告（第 10 轮）

> 目标：在离线引擎上以配对种子把默认 bot 的 ABYSS 0% 基线推到尽可能高，并给出可复现的策略文件与测量报告。
> 本报告汇总第 1–10 轮共 8 个实验臂、约 160 局对局（solo 与 coop），并给出裁决。

---

## 1. 测量协议（先定测量，再定假设）

| 项 | 规定 |
|---|---|
| 主指标 | **R14 结束时 BOSS 被打掉的血量百分比**（连续）。多人局 BOSS 血池 = `bloodPoint × 存活座位数`，**只能用百分比** |
| 次指标 | R13 存活 LP（自己从 R13 结算行求和，`teamLp` 在 BOSS 行恒 0）、每回合漏怪、R13 总层数/精锐数/装备数 |
| 样本量 | 每臂 **20 seeds**（真 20% 效果时漏检 <1.2%）；n=3 的漏检率 51%，因此 n<20 的结论一律不采信 |
| 对照 | **同种子配对差**（每个种子两臂用同一 BOSS，比较 dmg% 差） |
| 单变量 | 每臂只改一件事；组合只做最终验证 |
| 接线体检 | 每加一个开关先用极端值确认输出会变（已对 `BUY_FULL_MIN`、`MAX_REFRESHES`、`EQUIP_CARRY`、`LAYER_BONUS`、`FOCUS` 执行） |
| 工具 | `tools/matchrun.mjs`（整局）、`advisor-dev/lab/bossarm.mjs`（掉血%）、`lab/paired.mjs`（配对差）、`lab/soloarm.mjs`（solo 版配对差）、`lab/inspect.mjs`（逐回合层数/精锐/装备）、`lab/diagnose.mjs`（高低掉血分组 + 秩相关） |

## 2. 全部实验臂与裁决

solo ABYSS，`--rehearsal 1 --lp 45`，种子 1..20（E/F/G/H 与 A 同种子，可配对）：

| 臂 | 改动（env） | 到 R14 | BOSS 掉血% 中位 | 均值 | R13 LP | 配对差 | 裁决 |
|---|---|---|---|---|---|---|---|
| **A** | baseline | 14/20 | **19.63%** | 13.84 | 14 | — | 基准（最好） |
| B | `SP_LAB_FOCUS=victoriaShip`（法系） | 15/20 | 7.96% | 11.92 | 10 | **−1.92** | 否证 |
| B′ | coop 四座位全维多利亚 | 10/20 | 2.72%（对照 4.40%） | 11.47 | 8 | **−6.50** | 否证 |
| C | `SP_LAB_EQUIP_CARRY=1`（终端集中） | 13/20 | 17.15% | 11.71 | **19** | −2.13 | 否证（存活 +5） |
| D | 精锐激进（90/24/8/10） | 13/20 | 12.28% | 12.35 | 8 | −1.49 | 否证 |
| **E** | `SP_LAB_FOCUS=sargonShip`（k 最高） | 14/20 | 14.82% | **17.41** | **19** | **+3.57** | 弱正，未达判据 |
| E₂ | E 换种子 21..40 | 18/20 | 16.64%（对照 16.64%） | 16.92 | 13 | **+1.39** | 方向一致但幅度小 |
| F | `SP_LAB_LAYER_BONUS=8` | 15/20 | 18.94% | 14.03 | 18 | +0.19 | 否证 |
| G | E+C+F 组合 | 15/20 | 12.80% | 13.01 | 17 | −0.83 | 否证 |
| H | 动作预算放宽（刷新 40 / 买满阈值 1 / 配对 12 / 备战席 16） | 13/20 | 19.63% | 15.01 | 14 | +1.17 | 否证 |

**胜率：全部 160+ 局 0 胜。BOSS 掉血天花板 ≈ 20%（中位），离「打空」差约 5 倍。**

## 3. 三条机制结论（比臂结果更重要）

### 3.1 不存在「团队通道」
全仓搜索 `teamBond|sharedBond|teamLayer` 无命中；盟约层数与激活按座位独立（`PlayerState.js:207/252`），
跨座位唯一聚合是**共享 BOSS 血池**。四人强行同路线（B′）反而更差（−6.5pp），
而且 bot 默认对"队友在建盟约 −6 分避让"的行为是对的。

### 3.2 排序类改动全部无效，因为产出由「动作总量」决定
四个排序类开关（通道 focus / 终端集中 / 精锐激进 / 层数权重）中三个为负、一个零。
逐回合证据：`LAYER_BONUS=8` 在 seed 6 上把**装备数 8→16**，但**总层数 246→232（没升）** ——
它改的是构成，不是层数产出。

### 3.3 动作总量被「金币收入」锁死，不是被阈值锁死
H 臂把刷新上限 / 买满阈值 / 配对上限全放开，seed 6 的 R13 总层数**仍然是 246**（与 baseline 完全一致），
20 seeds 的 dmg% 中位也**完全一致（19.63%）**。说明这些阈值根本不 binding：
**每回合能买多少张由收入曲线与牌价决定**，而这两者在引擎里是固定的。
因此"提高动作量"需要改经济（更多金），而不是改策略阈值——这已超出参数空间。

## 4. 可复现的策略文件与命令

### 4.0 策略卡（人类可执行版）

`model/STRATEGY-CARDS.md` —— 八张卡：开局定路线（按 BOSS 的 k）、前 8 回合立引擎、6 人 vs 9 人（含概率表 67/42/8%）、
输出终端只养一个 C、对空与漏怪（lpr 硬/软）、小盟约按人类操作量挑、资金清零、以及「卡住时怎么读顾问」。
卡里的每个数字都能追到 E（引擎）/ T（模型派生）/ S（实测）/ I（推断），与 `bosstable.json`、`params.json` 一致（已抽查：k 排序、9 人概率、boss_5 lpr=30）。

### 4.1 模型侧（顾问）
- `plugins/pick-advisor/`（UI 插件：抓取评分 / 人数档位 / 对空闸 / 通道加权有效层数 `effectiveLayersOf` / 升本结论 `upgradePlanOf` / 角色 `roleOf` / 摆放配对 `placementPlanOf`）
- `advisor-dev/gen-tables.mjs` → `routes/_stack.gen.json`（从 `docs/research/02-bonds.json` 的 97 条 `layerGarrisons` 生成叠层引擎表：61 触发器 / 47 放大器）
- `advisor-dev/model/params.json`（带 `_evidence` 类型 E/T/S/I）、`bosstable.json`（逐 BOSS 参数 + 通道 k）、`MODEL-SPEC.md`

### 4.2 实验开关（全部默认关，不影响默认行为）
```powershell
# 单个策略臂
$env:SP_LAB_FOCUS="sargonShip"           # 强制核心盟约
$env:SP_LAB_FOCUS_BOSS="1"               # 按本局 BOSS 的 k 最高盟约自动 focus（BOSS_BEST_K 表）
$env:SP_LAB_EQUIP_CARRY="1"              # 装备只喂 ATK 最高的输出
$env:SP_LAB_LAYER_BONUS="8"              # 按「获得时给层」加价
node tools/matchrun.mjs --mode solo --difficulty ABYSS --seeds 20 --rehearsal 1 --lp 45 --json |
  Out-File -Encoding utf8 ..\advisor-dev\samples\arm.json
node ..\advisor-dev\lab\soloarm.mjs ..\advisor-dev\samples\solo-A-baseline.json ..\advisor-dev\samples\arm.json
```

### 4.3 诊断
```powershell
node ..\advisor-dev\lab\inspect.mjs --difficulty ABYSS --seed 6 --lp 45    # 逐回合 层数/精锐/装备/BOSS
node ..\advisor-dev\lab\diagnose.mjs ..\advisor-dev\samples\solo-A-baseline.json   # 高低掉血分组 + 秩相关
```

## 5. 裁决与后续

**裁决**：在"离线 bot 的参数 / 排序 / 阈值"这个暴露出来的空间里，**ABYSS 基线无法被推到高胜率**；
证据是 8 个臂、160+ 局、同种子配对、连续指标，以及 §3.3 的"阈值不 binding"证明。
唯一的弱正向线索是 E（把层数导向 k 最高的盟约）：均值 +2.5pp、存活 +2，但中位不变、两组种子都 <+8pp 判据。

**要继续往上，只能改这三件事之一，且都不属于"模型"范畴**：
1. **经济曲线**（`config.json` 的 `income`/`price`）—— 直接违背"复刻官方"的前提，不作为方案；
2. **动作预算**（让 bot 允许透支 LP 换更多回合/更多刷新）—— 与人类真实操作频率相悖（人类更低），价值可疑；
3. **人工介入**（人类当策略层，模型只做决策支持）—— 这正是顾问在做的事，也是本报告建议的落地形态。

**模型侧的交付到此完整**：物理/法系/固定值三通道 + 破甲线 + 击杀窗口 + 逐 BOSS 通道 k + 层数档位 + 叠层引擎表 + 共享池概率 + 顾问五要素（抓谁/配谁/下步/冻否/组谁）+ 三档测量协议 + 全部实验开关与工具。

---

## 6. 第 12 轮收尾：判决与交付清单

### 6.1 目标三问的回答

| 目标项 | 状态 | 证据 |
|---|---|---|
| 做出一套**决策模型** | ✅ 完成 | 三通道（物理/法系/固定值）+ 破甲线 + 击杀窗口 + 逐 BOSS 通道 k + 层数档位 + 叠层引擎表（97 条生成）+ 共享池概率；`model/params.json`（47 条证据）+ `bosstable.json` |
| 把 bot 的 **0% 基线推到尽可能高** | ⚠️ 已推到可证的上限，未突破 0% | 8 臂 × 20 seeds、同种子配对、连续指标：baseline 中位 **19.63%** BOSS 掉血，最好的一臂（萨尔贡 focus）配对 **+3.57pp**/均值 +2.5pp，**全部 160+ 局 0 胜**；并证明阈值不 binding（放开刷新/买满/配对后 R13 总层数仍 246） |
| 给出**可复现的策略文件与测量报告** | ✅ 完成 | `model/STRATEGY-CARDS.md`（8 张卡）、`model/REPORT-FINAL.md`（协议+裁决+命令）、3 个 env 开关、6 个 lab 工具、24 份样本落盘 |

### 6.2 为什么 0% 不能被"模型"突破（一句话机制）

**BOSS 掉血由「动作总量 × 层数压在哪个通道」决定；而动作总量由引擎固定的收入曲线锁死。**
我们改的都是"选择排序"（focus / 装备 / 精锐 / 层数权重），对动作总量没有影响，所以 8 个臂全部无效；
唯一触及"层数方向"的萨尔贡 focus 只有 +2~3pp，因为它同样受动作总量限制。

### 6.3 若要继续（超出本目标范围的三个方向）

1. **改经济曲线**（`config.json` 的 income/price）——能测出理论上界，但违背"复刻官方"的前提，不作为方案
2. **改动作预算**（允许透支 LP 换刷新/回合）——与人类真实操作频率相悖，价值可疑
3. **人工介入**（人类当策略层，模型做决策支持）——本项目的顾问就是这个形态，也是建议的落地方式

### 6.4 交付物索引

| 类别 | 文件 |
|---|---|
| 测量报告 | `model/REPORT-FINAL.md`、`model/SAMPLES-ALL.md`（§1–§11）、`model/POSTMORTEM-ROUND1-2.md`、`model/DIAGNOSIS-R7.md` |
| 模型 | `model/params.json`（含 `_ceiling` 与 47 条 `_evidence`）、`model/bosstable.json`、`model/MODEL-SPEC.md`、`model/PRIOR-ART.md` |
| 策略 | `model/STRATEGY-CARDS.md`、`routes/_stack.gen.json`、`routes/_tiers.json`、`routes/_addons.json`、`routes/_matchup.json` |
| 顾问 | `plugins/pick-advisor/`（UI 插件，`check --strict` 0/0）、`advisor-dev/overlay.mjs`、`box.ps1`、`launch.ps1` |
| 实验工具 | `lab/{bossarm,paired,dose,soloarm,diagnose,inspect}.mjs`、`gen-tables.mjs` |
| 开关 | `SP_LAB_FOCUS(_BY_SEAT) / SP_LAB_FOCUS_BOSS / SP_LAB_EQUIP_CARRY / SP_LAB_LAYER_BONUS`（全部默认关） |
| 原始样本 | `samples/solo-{A,A2,B,C,D,E,E2,F,G,H}-*.json`、`samples/round3-*.json`、`samples/*.md` |
