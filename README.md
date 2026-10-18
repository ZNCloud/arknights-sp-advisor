# sp-advisor —— 《卫戍协议：盟约》ABYSS 决策模型与抓取顾问

给 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)（《卫戍协议：盟约》的粉丝重制版，GPL-3.0-or-later）
做的一套**离线可复现**的决策模型 + 游戏内抓取顾问插件 + 实验工具。

> **本仓库不含引擎代码、`data/*.json` 或任何游戏美术/音频资源。** 引擎需自行从上游获取，见「复现」。

## 这个仓库有什么

| 目录 | 内容 |
|---|---|
| `model/` | 数学模型与全部结论：`params.json`（47 条带类型标记的证据）、`bosstable.json`（逐 BOSS 参数 + 通道系数）、`MODEL-SPEC.md`、`REPORT-FINAL.md`、`SAMPLES-ALL.md`、`POSTMORTEM-ROUND1-2.md`、`DIAGNOSIS-R7.md`、`FEASIBILITY-80.md`、`STRATEGY-CARDS.md`、`PRIOR-ART.md` |
| `routes/` | 路线/档位/小盟约表；`_stack.gen.json` 由 `gen-tables.mjs` 从引擎研究文档**生成**（61 触发器 / 47 放大器） |
| `lab/` | 实验工具：`soloarm`（配对差）、`bossarm`（BOSS 掉血%）、`paired`、`dose`（处理强度）、`inspect`（逐回合层数/精锐/装备）、`diagnose`（高低掉血分组 + 秩相关）、`feasible`（可行性反解） |
| `samples/` | 各实验臂 20 seeds 的原始 `matchrun --json` 输出 |
| `plugin/` | 游戏内顾问（UI 插件，`hud.right` 槽）：抓谁 / 配谁 / 下步 / 冻否 / 组谁 |
| `overlay.mjs` / `box.ps1` / `launch.ps1` | 桌面小框（通过 Chrome DevTools Protocol 读客户端私有视图，只读、不发任何对局意图） |

## 核心结论（都有测量数据支撑）

1. **不存在「团队通道」**：盟约层数按座位独立计算，跨座位唯一聚合是共享 BOSS 血池；四人强行同路线配对差 **−6.5pp**。
2. **排序类改动全部无效**：通道 focus −1.92pp、终端集中 −2.13pp、精锐激进 −1.49pp、层数权重 +0.19pp、动作预算 +1.17pp（均 20 seeds 同种子配对）。
3. **阈值不 binding**：把刷新上限/买满阈值/配对上限全放开，R13 总层数与 baseline 完全相同（246）——每回合能买多少张由引擎固定的收入曲线与牌价决定。
4. **bot 侧天花板**：solo ABYSS 中位打掉 **19.63%** BOSS 池子，160+ 局 **0 胜**。
5. **打死 BOSS 的算术缺口**：需要约 5× 提升；乘区上限 = 精锐 2.36× × 装备（`equipPerChess=2`）1.14× × 层数（500 vs 200）1.89× ≈ 5.08×。
   ⇒ 「精锐 + 2 件装备 + 450~500 层」才够；6 本 BOSS 里 5 本可行，「萨米的意志」（需求 DPS 42k）不可行。

## 复现

### 依赖
- Node.js ≥ 20
- 引擎：`git clone --depth 1 https://github.com/sganggs/Stronghold-Protocol.git`
- 引擎初始化：`npm ci --ignore-scripts`（部分工具还需 `node tools/vendor.mjs`）

### 单臂测量（solo ABYSS，20 seeds，主指标 BOSS 掉血%）

```powershell
# 在引擎目录内执行；把 sp-advisor 放在同级目录
node tools/matchrun.mjs --mode solo --difficulty ABYSS --seeds 20 --rehearsal 1 --lp 45 --json |
  Out-File -Encoding utf8 ..\sp-advisor\samples\arm.json

# 与 baseline 做同种子配对（先跑一份 baseline 存为 solo-A-baseline.json）
node ..\sp-advisor\lab\soloarm.mjs ..\sp-advisor\samples\solo-A-baseline.json ..\sp-advisor\samples\arm.json
```

### 逐回合诊断

```powershell
node ..\sp-advisor\lab\inspect.mjs --difficulty ABYSS --seed 6 --lp 45
# 输出：R / 等级 / 上阵 / 精锐 / 装备 / 总层数 / 最强盟约 / LP / dmg
node ..\sp-advisor\lab\diagnose.mjs ..\sp-advisor\samples\solo-A-baseline.json
# 输出：高掉血 vs 低掉血两组的量对比 + 秩相关
```

### 可行性反解

```powershell
node ..\sp-advisor\lab\feasible.mjs
# 输出：每本 BOSS × 每条路线，达到「打死」所需的最小 层数 + 装备件数
```

### 实验开关（均在 `server/match/bot.js`，**默认全关**，不影响默认行为）

```powershell
$env:SP_LAB_FOCUS="sargonShip"   # 强制核心盟约
$env:SP_LAB_FOCUS_BOSS="1"       # 按本局 BOSS 的通道 k 最高盟约自动 focus
$env:SP_LAB_EQUIP_CARRY="1"      # 装备只喂 ATK 最高的输出
$env:SP_LAB_LAYER_BONUS="8"      # 按「获得时给层」加价
```

> 这些开关是在引擎仓库里加的 env 补丁（默认值等于原行为）。若要使用，需要把它们应用到你的引擎 checkout（见 `model/REPORT-FINAL.md` §4.2）。

### 顾问（游戏内）
```powershell
# 在引擎仓库：检查与打包
node tools/plugin.mjs check pick-advisor --strict   # 期望 0 problem 0 warning
node tools/plugin.mjs pack pick-advisor --zip
# 把 plugin/ 目录放进服务器的 plugins/，玩家在「设置 → 插件」里开启
```

### 桌面小框（可选）
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\launch.ps1
```
需要客户端以 `--remote-debugging-port=9222` 启动（只读读取 `store.get().match`，不发送任何对局意图）。

## 许可

- 本仓库的**代码与文档**：MIT
- 引擎与游戏数据：遵循上游 `Stronghold-Protocol` 的 GPL-3.0-or-later，本仓库不再分发
- 本仓库不含任何游戏美术、音频或官方数据表
