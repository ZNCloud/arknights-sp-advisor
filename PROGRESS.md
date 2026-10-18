# PROGRESS — 卫戍协议 ABYSS 决策模型（截至目标阻塞 + 可行性反解）

本文件记录项目当前状态，便于中断后继续。所有结论都能追溯到本仓库内的文件或命令。

## 1. 已完成的交付

| 类别 | 文件 | 说明 |
|---|---|---|
| 测量报告 | `model/REPORT-FINAL.md` | 测量协议、8 个策略臂裁决、可复现命令、交付索引 |
| 全部样本 | `model/SAMPLES-ALL.md` | 三批离线实验 + 两局真实对局的账（§1–§11） |
| 复盘 | `model/POSTMORTEM-ROUND1-2.md` | 统计功效、指标选错、归因不干净三条教训 |
| 诊断 | `model/DIAGNOSIS-R7.md` | 高/低掉血两组逐回合对比，指出「层数压在哪条通道」是二阶效应 |
| 可行性反解 | `model/FEASIBILITY-80.md` | 「打死 BOSS 需要什么」的算术（含一次自我纠错：`equipPerChess=2`） |
| 策略卡 | `model/STRATEGY-CARDS.md` | 8 张人类可执行卡（开局 / 前 8 回合 / 6 vs 9 人 / 终端 / 对空 / 小盟约 / 资金 / 读顾问） |
| 模型参数 | `model/params.json` | 47 条带类型标记的证据（E/T/S/I）+ `_ceiling` |
| 逐 BOSS 表 | `model/bosstable.json` | 池子 / DEF / RES / lpr / 需求 DPS / 8 路线 × BOSS 通道 k |
| 同类先例 | `model/PRIOR-ART.md` | 仓库自带研究文档、ACM TFT 论文、Bloons TD 背包模型 |
| 顾问插件 | `plugin/`（来自 `Stronghold-Protocol/plugins/pick-advisor/`） | UI 插件，`check --strict` 0/0 |
| 实验工具 | `lab/*.mjs` | bossarm / paired / dose / soloarm / diagnose / inspect / feasible / gen-tables |
| 原始样本 | `samples/*.json` | 各臂 20 seeds 的 matchrun 输出 |

## 2. 关键结论（按证据强度）

1. **不存在团队通道**：盟约层数按座位独立（`PlayerState.js:207/252`），跨座位唯一聚合是共享 BOSS 血池；四人同路线配对差 −6.5pp。
2. **排序类改动全部无效**：通道 focus(−1.92)、终端集中(−2.13)、精锐激进(−1.49)、层数权重(+0.19)、动作预算(+1.17)。
3. **阈值不 binding**：放开刷新上限/买满阈值/配对上限后，R13 总层数与 baseline 完全相同（246）——每回合能买多少张由引擎固定收入决定。
4. **弱正向线索**：把层数导向 k 最高盟约（萨尔贡）= 均值 +2.5pp、R13 LP +2，但中位不变、两组种子都 <+8pp 判据。
5. **bot 侧天花板**：solo ABYSS 中位打掉 19.63% BOSS 池子，160+ 局 0 胜。
6. **5× 缺口的算术来源**（`equipPerChess=2` 修正后）：精锐 2.36× × 装备 ≤2 件 1.14× × 层数 500vs200 1.89× ≈ 5.08×。
   即「精锐 + 2 件装备 + 450~500 层」才够；6 本 BOSS 里 5 本可行，「萨米的意志」（42k）不可行。

## 3. 未完成 / 下一步

- [ ] **盘面注入实验**：构造「层数最大化」盘面（投资人 3 + 助力 2 + 小满 + 山 + 号角/调香师），注入引擎跑 R14，
      测人类能达到的层数上限（决定 450–500 层是否现实）。成本远低于整局 20 seeds。
- [ ] 顾问硬目标提示：把「本局需要 450–500 层 / 精锐 / 2 件装备」做成实时缺口显示。
- [ ] 池子占用的信念建模（ACM TFT 论文的 `S_r` 参数化）。

## 4. 复现（离线引擎，不需客户端）

```powershell
# 1) 取引擎（本仓库不含引擎与游戏资源，需单独获取）
git clone --depth 1 https://github.com/sganggs/Stronghold-Protocol.git
cd Stronghold-Protocol; npm ci --ignore-scripts; node tools/vendor.mjs

# 2) 单臂测量（solo ABYSS，20 seeds）
node tools/matchrun.mjs --mode solo --difficulty ABYSS --seeds 20 --rehearsal 1 --lp 45 --json |
  Out-File -Encoding utf8 ..\sp-advisor\samples\arm.json

# 3) 与 baseline 做同种子配对
node ..\sp-advisor\lab\soloarm.mjs ..\sp-advisor\samples\solo-A-baseline.json ..\sp-advisor\samples\arm.json

# 4) 逐回合细节（层数/精锐/装备/BOSS）
node ..\sp-advisor\lab\inspect.mjs --difficulty ABYSS --seed 6 --lp 45

# 5) 可行性反解
node ..\sp-advisor\lab\feasible.mjs

# 6) 实验开关（默认全关）
$env:SP_LAB_FOCUS="sargonShip"; $env:SP_LAB_FOCUS_BOSS="1"
$env:SP_LAB_EQUIP_CARRY="1";    $env:SP_LAB_LAYER_BONUS="8"
```

## 5. 环境事实（复现时需要知道）

- 引擎：`sganggs/Stronghold-Protocol`（GPL-3.0-or-later），本仓库**不包含**引擎代码、`data/*.json` 与任何游戏资源。
- 难度：`ABYSS`（`mode_multi_abyss`），14 回合，R14 打 BOSS，`--lp 45`，`--rehearsal 1`。
- BOSS 血池 = `bloodPoint × 进入 BOSS 战的存活座位数` ⇒ 跨组比较只能用百分比。
- 结算行 `teamLp` 在 BOSS 回合恒为 0，R13 团队 LP 需自己从 R13 结算行求和。
