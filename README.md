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

### 默认开关一览（sprldef_2055：权重建议和站位建议统一改成默认开）

下面这些建议**现在都默认开着**，启动不用加任何参数。一个总开关退回最早的样子，其余开关各退一样：

| 建议 | 默认 | 单独关掉 | 说明 |
|---|---|---|---|
| 规则 A（卖线外牌凑钱） | 开 | 没有单独开关，见 `--g06` | 商店凑不够钱时，建议卖掉这条线用不上的牌 |
| 站位检查（本节下方详述） | 开 | 没有单独开关，见 `--g06` | 每个休整期多一行站位建议 |
| 引擎摆位 + 道具分配搜索（`--board`，原来是手动开） | **开（sprldef_2055 起）** | `--no-board` | 站位检查从「人试出来的贪心规则」换成引擎自己搜几种摆法/道具分配比掉血和拿层，退回后是旧的贪心规则 `checkLineup` |
| 盟约轴心权重打分 | 开 | `--no-axis` | 商店/道具沾到当前轴心的副羁绊会加分 |
| 商店卡片 / 刷新 / 冻结按钮的分数标注（含「买★」高亮） | 开 | `--no-badges` | 画在真实客户端 DOM 旁边的浮层，不碰游戏自己的节点 |
| additional 窗口（小框旁边弹出的 PowerShell 窗）的站位棋盘示意图（箭头=建议挪位，虚线圈=新上场） | 开 | `--no-badges`（和分数标注共用，sprldef_2055 补：此前没真的跟着这个开关走） | 跟着站位检查的结果画，没有建议时只画当前站位 |
| 启动时「现在开着哪些建议」的一行说明 | 开 | 见 `--g06` 下全关时的文案 | 写进 `state.json` 的 `features` 字段，小框顶部显示（不进 stdout/日志，不影响任何回归金样本） |

- **一次性全关**：加 `--g06`（最早的退回开关，一次顶上面所有的 `--no-*`）。
- **只关某一样**：`--no-board`（退回贪心规则站位）、`--no-axis`（退回轴心权重之前）、`--no-badges`（退回标注和棋盘图之前）；几个可以一起加，比如 `node overlay.mjs --watch --no-board --no-badges`。
- 旧的 `--lineup`/`--board` 显式开关继续可以加，不会报错，只是现在不加也是一样的效果（已经是默认行为）。

### 站位检查
每个休整期里，小框多一行站位建议：「把 X 从 r,c 挪到 r,c / 换下 X 换上 Y——预计少掉几滴血、多拿几层」（BOSS 回合说「自己那份 BOSS 血多打几成」）；默认开着引擎摆位 + 道具分配搜索时，这行建议来自引擎真实搜索出来的几种摆法/装备分配里最好的一种，`--no-board` 退回最早的「人试出来的」贪心规则。
只给建议，不替你操作。坐标就是对局记录 `board[].at` 的 `[行, 列]`。

- **需要引擎**：和 `eval/` 工具一样读本目录同级的 `..\engine`（上游 Stronghold-Protocol 的 checkout，`npm ci --ignore-scripts`）。找不到时小框显示「站位检查没开起来：…」，其余建议照常。
- **线程**：默认 `min(16, 核数 − 2)`，可用 `--lineup-threads <n>` 改。在一个单独的工作线程里跑，不卡别的建议；棋盘停手 1.5 秒后开算，你又动了棋盘就按新站位重算；休整期剩不到 10 秒还没算完就放弃这一回合，显示「站位检查超时」。引擎摆位搜索比贪心规则多跑几次模拟，单次决策仍在 2 秒量级（冷启动时线程池第一次建立要多等几秒，只发生一次）。
- **怎么算的**：`advisor/live.mjs` 把客户端里的局面（盘面 / 手牌 / 装备 / 召唤物 / 盟约层数 / 悬赏 / 本回合的怪）还原成引擎局面，再跑 `advisor/lineup.mjs` 的检查（只看你自己这块场地；队友的棋盘客户端拿不到）。本回合的怪按客户端的预告对上引擎的那一波，对不上就报错、不猜。自选编队的局面引擎还原不了，会直接说。

## 许可

- 本仓库的**代码与文档**：MIT
- 引擎与游戏数据：遵循上游 `Stronghold-Protocol` 的 GPL-3.0-or-later，本仓库不再分发
- 本仓库不含任何游戏美术、音频或官方数据表

## 应用到引擎（复现实验开关必需）

本仓库的 `patches/bot-lab-switches.patch` 是对引擎 `server/match/bot.js` 的全部改动（新增 4 个 env 开关，**默认值等于原行为**）：

```powershell
cd Stronghold-Protocol
git apply ..\sp-advisor\patches\bot-lab-switches.patch
git diff --stat          # 应当只有 server/match/bot.js
```

开关一览（全部默认关）：

| 开关 | 作用 |
|---|---|
| `SP_LAB_FOCUS=<bondId>` | 强制核心盟约（原有实验开关） |
| `SP_LAB_FOCUS_BOSS=1` | 按本局 `public.bossId` 的通道 k 最高盟约自动 focus（`BOSS_BEST_K` 表由 `model/bosstable.json` 推导） |
| `SP_LAB_EQUIP_CARRY=1` | 战斗类装备只喂 ATK 最高的输出（终端集中） |
| `SP_LAB_LAYER_BONUS=<n>` | 按「获得时给层」的引擎真值给牌加价 |

不应用补丁也能跑 `lab/` 里的分析和 `balance.mjs` 的 profile 测量，只是无法复现依赖这些开关的实验臂。

## 在另一台电脑上继续

```powershell
# 1) 引擎（上游，GPL-3.0-or-later）
git clone --depth 1 https://github.com/sganggs/Stronghold-Protocol.git
cd Stronghold-Protocol; npm ci --ignore-scripts; node tools/vendor.mjs

# 2) 本仓库（与本目录同级）
git clone https://github.com/ZNCloud/arknights-sp-advisor.git

# 3) 应用实验开关（可选）
git apply ../arknights-sp-advisor/patches/bot-lab-switches.patch

# 4) 冒烟验证（约 1 分钟）
node tools/matchrun.mjs --mode solo --difficulty ABYSS --seeds 1 --rehearsal 1 --lp 45
#    期望看到 `rounds passed: ...` 与 `wins 0/1`

# 5) 单臂测量（20 seeds，约 6–10 分钟）
node tools/matchrun.mjs --mode solo --difficulty ABYSS --seeds 20 --rehearsal 1 --lp 45 --json |
  Out-File -Encoding utf8 ../arknights-sp-advisor/samples/arm.json
node ../arknights-sp-advisor/lab/soloarm.mjs ../arknights-sp-advisor/samples/solo-A-baseline.json ../arknights-sp-advisor/samples/arm.json
```

**环境事实**：Node ≥ 20；`--lp 45`；`--rehearsal 1`；难度 `ABYSS` 对应 `mode_multi_abyss`（14 回合，R14 打 BOSS）；
BOSS 血池 = `bloodPoint × 进入 BOSS 战的存活座位数`，**跨组比较只能用百分比**；结算行 `teamLp` 在 BOSS 回合恒为 0。
