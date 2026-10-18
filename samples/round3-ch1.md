# Round 3 · Chapter 1 — 四人同走一条法系路线，团队通道是否叠加？

日期：2026-10-18 · 引擎仓库 `D:\CodeProject\Stronghold-Protocol` · 产物目录 `D:\CodeProject\advisor-dev`
最高难度 ABYSS（`mode_multi_abyss`，14 回合，R14 = BOSS），co-op 4 座位，全 bot。

待验证假设：**多人局里四个人走同一条法系路线，团队通道会叠加，从而显著提高 R14 BOSS 被打掉的血量。**

---

## 0. 结论先行

**未观测到叠加。** 判据（处理组 BOSS 掉血中位数 ≥ 对照 1.5 倍）明确不成立：处理组的中位数只有对照的 **0.62 倍**。

| 组 | 处理 | R14 BOSS 掉血 % 中位数（未达 R14 记 0） | R13 团队 LP 中位数 |
|---|---|---|---|
| A 对照 | 无 | **4.40 %** | **19.0** |
| B 处理（同路线） | 四座位强制同一核心盟约 `victoriaShip`（维多利亚，法系占比最高的核心盟约） | **2.72 %** | **8.0** |

四座位被压到同一条路线后，BOSS 掉血与团队 LP 都是**下降**而不是上升。强化版（锁死盟约，95 % 的存活座位真的建起了同一条盟约）也没能把 BOSS 打得更狠。

---

## 1. 钩子勘察（步骤 1）

### 1.1 `server/match/bot.js` 里可用的 `SP_LAB_*` 钩子

`Select-String -Path server/match/bot.js -Pattern "SP_LAB"` 结果（节选，行号为当前 HEAD）：

| 行 | 钩子 | 作用 |
|---|---|---|
| 106 | `SP_LAB_FOCUS_MEMBER` | 阵容评估里每个"本家"成员的加权（默认 4） |
| 108 | `SP_LAB_ARMOR_WEIGHT` | 护甲适配（DEF/RES 通过率）权重 |
| 110 | `SP_LAB_BUY_FULL_MIN` | 满场后买入的最低评分（低于它就改成刷新） |
| 116/117 | `SP_LAB_MERGE_HIT` / `SP_LAB_PAIR_HIT` | 精锐/对子的估值 |
| 119/121/123 | `SP_LAB_MAX_PAIRS` / `SP_LAB_MAX_REFRESHES` / `SP_LAB_BENCH_BUDGET` | 备战区与刷新预算 |
| 125 | `SP_LAB_LEVEL_TARGET` | 逐回合调度中心目标等级 |
| 155 | `SP_LAB_BAND` | 强制 band（策略卡）选择 |
| 161 | `SP_LAB_BAND_BOOST` | 给某些 band 加权 ×8 |
| **416** | **`SP_LAB_FOCUS_BY_SEAT`** | **按座位强制 bondPlan 的 focus（核心盟约）——`seatFocus = bySeat[ps.seat]`** |
| 418 | `SP_LAB_FOCUS` | 全局强制 focus |
| 435 | `SP_LAB_KEEP_ALL` | 所有已持有 base 都当 keeper |
| 441/485 | `SP_LAB_COMMIT` + `SP_LAB_COMMIT_FROM` / `_W` / `_PEN` | 锁死一条盟约（其它盟约吸引力大幅削弱） |

**结论：存在 per-seat 路线钩子 `SP_LAB_FOCUS_BY_SEAT`（bot.js:416-419），所以本次不需要走"弱化版"。**
它直接改 `bondPlan()` 返回的 `focus`，即"这个座位这一整局围绕哪条核心盟约买卖/留牌/上阵"——正是"走哪条路线"的开关。

约束（bot.js:419）：forced focus 必须 `bond.isCore === true` 且不在 `gd.modeInactiveBonds`。
`mode_multi_abyss` 的 `inactiveBondIds` 为空，8 条核心盟约全部可用。

### 1.2 为什么选 `victoriaShip`（维多利亚）作为"法系路线"

`data/chess.json` 按 `bonds` 字段统计各核心盟约成员的 `dmgType`（`arts` / `phys` / `heal`）：

| 核心盟约 | 名称 | 成员数 | arts | phys | heal | 法系占比 |
|---|---|---|---|---|---|---|
| **victoriaShip** | **维多利亚** | 10 | **6** | 3 | 1 | **60 %** ← 最高 |
| siracusaShip | 叙拉古 | 11 | 5 | 6 | 0 | 45 % |
| sargonShip | 萨尔贡 | 12 | 5 | 6 | 1 | 42 % |
| kjeragShip | 谢拉格 | 12 | 5 | 6 | 1 | 42 % |
| yanShip | 炎 | 11 | 4 | 5 | 2 | 36 % |
| lateranoShip | 拉特兰 | 11 | 2 | 9 | 0 | 18 % |
| egirShip | 阿戈尔 | 9 | 1 | 7 | 1 | 11 % |
| kazimierzShip | 卡西米尔 | 10 | 0 | 10 | 0 | 0 % |

注：真正的"法术增伤"盟约是 `arcaneShip`（奥术），但它是 **非核心**（`isCore: false`），
`SP_LAB_FOCUS_BY_SEAT` 的守卫（bot.js:419）只接受 `isCore` 盟约，所以**无法**把奥术选为 focus。
因此"法系路线"取核心盟约里法系占比最高的 `victoriaShip`；其盟约效果本身也是"携带装备的【维多利亚】干员造成的伤害提升"（伤害提升对法术伤害同样生效）。
稳健性补充组 D 用第二名的 `kjeragShip`（谢拉格，"造成的伤害提升"，任务提示中列出的三条之一）。

### 1.3 `tools/matchrun.mjs` 参数与 BOSS 血量输出

`--mode coop --players 4 --difficulty ABYSS --seeds N --rehearsal 1 --lp 45 --json`

- `--players` co-op 座位数（1..4）；`--seeds N` 从 `--seed`（默认 1）连跑 N 个种子；`--lp N` 覆盖起始 LP（45 = band 最大初始 LP）；
- `--rehearsal N` 每次备战用真实 sim 排练 N 套布局（1 = 关掉大部分排练，跑得快，且两组一致）；
- `--json` 打印每 seed 的逐回合结构（matchrun.mjs:194-198）。BOSS 血量在 `rounds[].boss = {hp, max}`（matchrun.mjs:148），
  只在 BOSS 回合产生；人读文本输出里是 `boss <hp>/<max>`（matchrun.mjs:181）。

### 1.4 ⚠ BOSS 血池会随存活人数缩放 —— 所以主指标必须是百分比

`server/match/finalAssault.js:12-18, 79-88`：R14 的 BOSS 是**共享血池**，
`bossPool.max = bloodPoint[bossId] × 进入 BOSS 战时的存活玩家数`。实测反推 `bloodPoint`：

| bossId | 观测 (hp/max, 存活) | bloodPoint |
|---|---|---|
| boss_2 / boss_5 | 6000000/2、9000000/3、12000000/4 | 3 000 000 |
| boss_1 | 14400000/4、7200000/2 | 3 600 000 |
| boss_3 | 16000000/4、8000000/2 | 4 000 000 |
| boss_4 | 4200000/1、8400000/2 | 4 200 000 |
| boss_7 | 4000000/1 | 4 000 000 |

（任务背景里举的 `boss 2789572/3000000` 就是 boss_2/boss_5 血池、1 个存活座位的情形。）

**推论：绝对 HP 在两条臂之间不可比**（存活人数不同池子就不同）。因此：
- **主指标 = 被打掉的血池百分比** `(max − hp) / max`；
- 附报绝对伤害 `max − hp` 作为参考，但不用于判据；
- "R13 团队 LP"：`row.teamLp` 只在 BOSS 回合行出现，且是**战斗后**的值（实测恒为 0，无信息）。
  这里改用 **R13 结算行上 `alive` 座位的 LP 之和** = 团队带着多少血进入 BOSS 回合。

---

## 2. 接线体检（步骤 4 — 先做，通过了才继续）

3 次单 seed（seed 1）跑，全部 4 座位 / ABYSS / rehearsal 1 / lp 45。

### W0 基线（同时用来测单次耗时）

```
node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 1 --rehearsal 1 --lp 45 --json > D:\CodeProject\advisor-dev\samples\_tmp_wire0.json
```

耗时 17.9 s。读出的关键行：

```
R13  ai_0:lp0/D ai_1:lp4/A ai_2:lp13/A ai_3:lp0/D        (alive 2，teamLP@R13 = 17)
R14  ai_1:lp0/A ai_2:lp0/A  · teamLp 0 · boss 4488875/6000000   → 掉血 25.19 %
```

### W1 荒谬值 —— `SP_LAB_BUY_FULL_MIN=99999`（满场后永远不买，只会刷新）

```
$env:SP_LAB_BUY_FULL_MIN='99999'
node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 1 --rehearsal 1 --lp 45 --json | Out-File -FilePath D:\CodeProject\advisor-dev\samples\_tmp_wireA.json -Encoding utf8
```

输出尾部（原始 stdout，最后 8 行）：

```
        }
       }
      ],
      "errors": 0,
      "simErrors": 0,
      "metaErrors": 0
     }
    ]
```

读出的关键行 —— **行为剧变**：`roundsPassed 12`（基线 13）、`reason eliminated`、最后一行是 **R11**、
`L5`（基线 L6）、4 个座位 `u0`（一个干员都没上）→ 死在第 11 回合，**根本没到 R14，BOSS 掉血 0 %**。
→ **钩子确实在生效**（否则结果会和基线完全一样）。

### W2 —— 本次真正要用的 `SP_LAB_FOCUS_BY_SEAT`

```
$env:SP_LAB_FOCUS_BY_SEAT='victoriaShip,victoriaShip,victoriaShip,victoriaShip'
node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 1 --rehearsal 1 --lp 45 --json | Out-File -FilePath D:\CodeProject\advisor-dev\samples\_tmp_wireB.json -Encoding utf8
```

输出尾部同上（`--json` 的 stdout 就是一段 JSON，尾部固定是这几行）。

读出的关键行 —— **per-seat 钩子确实改到了路线**（对比 public bond strip）：

```
W0 基线  R14 bonds: ai_0=(空) ;; ai_1=萨尔贡 拉特兰 精准2 迅捷 奥术 绝技 ;; ai_2=拉特兰 精准2 迅捷 坚守2 奇迹 独行 绝技 ;; ai_3=(空)
W2 处理  R14 bonds: ai_0=维多利亚 谢拉格 精准 奥术2 独行 绝技 ;; ai_1=(空) ;; ai_2=(空) ;; ai_3=维多利亚 谢拉格 精准 迅捷 助力 独行 绝技
```

→ **`SP_LAB_FOCUS_BY_SEAT` 生效，且是按座位生效的。接线体检通过，可以继续跑批量。**

---

## 3. 实验设计（单变量）

共同固定参数（两臂完全相同）：`--mode coop --players 4 --difficulty ABYSS --seeds 20 --rehearsal 1 --lp 45 --json`，
种子 1..20（两臂用**同一批种子**，做配对比较）。

| 组 | 唯一差别 | 说明 |
|---|---|---|
| **A 对照** | 不加任何 env | bot 默认行为：`bondPlan()` 会主动**避开队友已在建的盟约**（bot.js:372-373、398-399 的 `−6 when a teammate already builds it`），所以四座位天然走**不同**路线 |
| **B 处理** | `SP_LAB_FOCUS_BY_SEAT=victoriaShip,victoriaShip,victoriaShip,victoriaShip` | 四个座位全部强制同一核心盟约（法系） |
| C 补充（强化版） | B + `SP_LAB_COMMIT=1` | 额外锁死盟约（两个变量，**不算主判据**，只用来确认"路线真的同了会不会有变化"） |
| D 补充（换一条法系） | `SP_LAB_FOCUS_BY_SEAT=kjeragShip×4` | 稳健性：换第二名法系盟约，结论是否只是 `victoriaShip` 特例 |

样本量：每臂 **20 seeds**（达到 ≥20 的要求）。单臂实测约 6–7 分钟（未超过 8 分钟上限），无需降级到 10 seeds。

---

## 4. 跑批命令 + 输出尾部

### A 对照

```
cd D:\CodeProject\Stronghold-Protocol
Remove-Item Env:SP_LAB_FOCUS_BY_SEAT -ErrorAction SilentlyContinue
node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 20 --rehearsal 1 --lp 45 --json | Out-File -FilePath D:\CodeProject\advisor-dev\samples\round3-A-default.json -Encoding utf8
```

原始 stdout 最后 8 行：

```
        }
       }
      ],
      "errors": 0,
      "simErrors": 0,
      "metaErrors": 0
     }
    ]
```

（`--json` 模式下 stdout 就是整段 JSON，尾部固定是这几行、不含数值；真正可读的尾部是下面 `lab/bossarm.mjs` 的逐 seed 表。）

### B 处理

```
cd D:\CodeProject\Stronghold-Protocol
$env:SP_LAB_FOCUS_BY_SEAT='victoriaShip,victoriaShip,victoriaShip,victoriaShip'
node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 20 --rehearsal 1 --lp 45 --json | Out-File -FilePath D:\CodeProject\advisor-dev\samples\round3-B-victoria-x4.json -Encoding utf8
```

原始 stdout 最后 8 行：与 A 完全相同（同上）。

### C 补充 / D 补充

```
# C
$env:SP_LAB_FOCUS_BY_SEAT='victoriaShip,victoriaShip,victoriaShip,victoriaShip'; $env:SP_LAB_COMMIT='1'
node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 20 --rehearsal 1 --lp 45 --json | Out-File -FilePath D:\CodeProject\advisor-dev\samples\round3-C-victoria-x4-commit.json -Encoding utf8
# D
$env:SP_LAB_FOCUS_BY_SEAT='kjeragShip,kjeragShip,kjeragShip,kjeragShip'
node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 20 --rehearsal 1 --lp 45 --json | Out-File -FilePath D:\CodeProject\advisor-dev\samples\round3-D-kjerag-x4.json -Encoding utf8
```

### 逐 seed 读数（`node lab/bossarm.mjs <label> <json>`）

`lab/bossarm.mjs` 是本轮新增的取数脚本：读 `--json` 转储，抽 `rounds[].boss`、R13 存活座位的 LP 之和、`roundsPassed`。

A 对照：

```
=== A: default (control) ===  seeds 20
  seed   1  boss_5 4488875/6000000  dmg 25.19%  (abs 1511125)  alive@R13 2  teamLP@R13 17  rounds 13  last R14  defeat
  seed   2  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 -  rounds 9  last R10  eliminated
  seed   3  boss_3 8915763/16000000  dmg 44.28%  (abs 7084237)  alive@R13 4  teamLP@R13 39  rounds 13  last R14  defeat
  seed   4  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 0  rounds 12  last R13  eliminated
  seed   5  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 -  rounds 11  last R12  eliminated
  seed   6  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 0  rounds 12  last R13  eliminated
  seed   7  boss_1 2512555/14400000  dmg 82.55%  (abs 11887445)  alive@R13 4  teamLP@R13 72  rounds 13  last R14  defeat
  seed   8  boss_1 2948096/3600000  dmg 18.11%  (abs 651904)  alive@R13 1  teamLP@R13 19  rounds 13  last R14  defeat
  seed   9  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 -  rounds 11  last R12  eliminated
  seed  10  boss_5 2705221/3000000  dmg 9.83%  (abs 294779)  alive@R13 1  teamLP@R13 9  rounds 13  last R14  defeat
  seed  11  boss_5 10942994/12000000  dmg 8.81%  (abs 1057006)  alive@R13 4  teamLP@R13 34  rounds 13  last R14  defeat
  seed  12  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 -  rounds 11  last R12  eliminated
  seed  13  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 0  rounds 12  last R13  eliminated
  seed  14  boss_5 3218479/6000000  dmg 46.36%  (abs 2781521)  alive@R13 2  teamLP@R13 19  rounds 13  last R14  defeat
  seed  15  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 -  rounds 8  last R9  eliminated
  seed  16  boss_2 3965573/6000000  dmg 33.91%  (abs 2034427)  alive@R13 2  teamLP@R13 20  rounds 13  last R14  defeat
  seed  17  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 -  rounds 11  last R12  eliminated
  seed  18  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 -  rounds 11  last R12  eliminated
  seed  19  boss_2 3234268/6000000  dmg 46.10%  (abs 2765732)  alive@R13 2  teamLP@R13 26  rounds 13  last R14  defeat
  seed  20  boss_2 3348997/6000000  dmg 44.18%  (abs 2651003)  alive@R13 2  teamLP@R13 17  rounds 13  last R14  defeat
  N=20  reachedBoss=10
  dmg%  (missing=0)  median 4.40  mean 17.97  min 0.00  max 82.55
  dmg%  (boss only)  median 39.05  mean 35.93  n=10
  abs dmg (missing=0) median 147390  mean 1635959
  abs dmg (boss only) median 2342715  mean 3271918  n=10
  teamLP@R13  median 19.00  mean 20.92  n=13  (a seed with no R13 row died earlier)
  alive seats @R13: median 0.5  mean 1.20
  roundsPassed median 12.5  mean 11.90  wins 0/20
```

B 处理：

```
=== B: FOCUS_BY_SEAT=victoriaShip x4 ===  seeds 20
  seed   1  boss_5 4608924/6000000  dmg 23.18%  (abs 1391076)  alive@R13 2  teamLP@R13 25  rounds 13  last R14  defeat
  seed   2  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 -  rounds 10  last R11  eliminated
  seed   3  boss_3 4211904/8000000  dmg 47.35%  (abs 3788096)  alive@R13 2  teamLP@R13 15  rounds 13  last R14  defeat
  seed   4  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 0  rounds 12  last R13  eliminated
  seed   5  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 0  rounds 12  last R13  eliminated
  seed   6  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 -  rounds 11  last R12  eliminated
  seed   7  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 0  rounds 12  last R13  eliminated
  seed   8  boss_1 5564991/7200000  dmg 22.71%  (abs 1635009)  alive@R13 2  teamLP@R13 10  rounds 13  last R14  defeat
  seed   9  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 -  rounds 11  last R12  eliminated
  seed  10  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 -  rounds 11  last R12  eliminated
  seed  11  boss_5 7585627/12000000  dmg 36.79%  (abs 4414373)  alive@R13 4  teamLP@R13 90  rounds 13  last R14  defeat
  seed  12  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 0  rounds 12  last R13  eliminated
  seed  13  boss_4 3971215/4200000  dmg 5.45%  (abs 228785)  alive@R13 1  teamLP@R13 22  rounds 13  last R14  defeat
  seed  14  boss_5 2429373/3000000  dmg 19.02%  (abs 570627)  alive@R13 1  teamLP@R13 4  rounds 13  last R14  defeat
  seed  15  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 -  rounds 8  last R9  eliminated
  seed  16  boss_2 4992906/6000000  dmg 16.78%  (abs 1007094)  alive@R13 2  teamLP@R13 26  rounds 13  last R14  defeat
  seed  17  BOSS NOT REACHED  dmg 0.00%  teamLP@R13 -  rounds 11  last R12  eliminated
  seed  18  boss_7 3237374/4000000  dmg 19.07%  (abs 762626)  alive@R13 1  teamLP@R13 2  rounds 13  last R14  defeat
  seed  19  boss_2 5137518/6000000  dmg 14.37%  (abs 862482)  alive@R13 2  teamLP@R13 6  rounds 13  last R14  defeat
  seed  20  boss_2 4524239/6000000  dmg 24.60%  (abs 1475761)  alive@R13 2  teamLP@R13 11  rounds 13  last R14  defeat
  N=20  reachedBoss=10
  dmg%  (missing=0)  median 2.72  mean 11.47  min 0.00  max 47.35
  dmg%  (boss only)  median 20.89  mean 22.93  n=10
  abs dmg (missing=0) median 114393  mean 806796
  abs dmg (boss only) median 1199085  mean 1613593  n=10
  teamLP@R13  median 8.00  mean 15.07  n=14  (a seed with no R13 row died earlier)
  alive seats @R13: median 0.5  mean 0.95
  roundsPassed median 12.5  mean 12.00  wins 0/20
```

---

## 5. 指标表（步骤 3）

主指标 = R14 结束时 BOSS 血池被打掉的百分比。**未到 R14 的 seed 记 0 %**（它确实没对 BOSS 造成任何伤害），
同时也给出"只看打到 BOSS 的 seed"的口径，避免"到达率"掩盖"输出"。

| 组 | env | N | 到达 R14 | **掉血% 中位数（未到记0）** | 掉血% 均值 | 掉血% 中位数（仅到 R14） | 绝对伤害中位数（未到记0） | **R13 团队 LP 中位数** | 到达回合中位数 | 胜利 |
|---|---|---|---|---|---|---|---|---|---|---|
| **A 对照** | — | 20 | 10 | **4.40 %** | 17.97 % | 39.05 % (n=10) | 147 390 | **19.0** (n=13) | 12.5 | 0/20 |
| **B 处理（维多利亚×4）** | `SP_LAB_FOCUS_BY_SEAT=victoriaShip×4` | 20 | 10 | **2.72 %** | 11.47 % | 20.89 % (n=10) | 114 393 | **8.0** (n=14) | 12.5 | 0/20 |
| C 强化（+锁盟约） | 上一行 + `SP_LAB_COMMIT=1` | 20 | 8 | 0.00 % | 14.23 % | 31.59 % (n=8) | 0 | 6.0 (n=13) | 12 | 1/20 |
| D 补充（谢拉格×4） | `SP_LAB_FOCUS_BY_SEAT=kjeragShip×4` | 20 | 9 | 0.00 % | 15.50 % | 35.92 % (n=9) | 0 | 12.0 (n=15) | 12 | 0/20 |

**判据检验：B/A 的中位数比值 = 2.72 / 4.40 = 0.62×，远低于 1.5×。→ 未观测到叠加。**

C、D 的"未到记 0"中位数为 0，是因为到达率更低（8/20、9/20），不是"打到 BOSS 时一点都打不动"；
看"仅到 R14"一列：A 39.05 % > D 35.92 % > C 31.59 % > B 20.89 %。对照仍然最高。

### 配对比较（同一批 20 个种子；`node lab/paired.mjs`）

20 个种子里两臂抽到的 `bossId` **全部相同**（配对干净，BOSS 种类由种子决定，不受 env 影响）。

| 比较 | 20 seed 平均配对差 (B−A) | 配对中位数 | B 更好 / 更差 / 平手 | 仅"两臂都到 R14 且同一 BOSS"子集 |
|---|---|---|---|---|
| B − A | **−6.50 pp** | 0.00 pp | 5 / 7 / 8 | 8 seeds：平均 **−7.76 pp**、中位 −9.56 pp |
| D − A | **−2.47 pp** | 0.00 pp | 5 / 7 / 8 | 7 seeds：平均 **−6.25 pp**、中位 −5.90 pp |
| C − A | **−3.73 pp** | 0.00 pp | 4 / 8 / 8 | 6 seeds：平均 **−4.29 pp**、中位 −7.61 pp |

三条处理臂的配对平均差**全为负**：处理组不是"没差别"，而是**略差**。

---

## 6. 处理强度检验（"路线真的同了吗"）

只看"结果差"不够 —— 先要确认处理确实被投递了。取每 seed 的 R13 结算行、只看**存活**座位，
统计 public bond strip 上目标盟约的激活率（`node lab/dose.mjs`）：

| 组 | 目标盟约 | 存活座位数 | 该盟约激活的座位 | 激活率 | 二阶以上 |
|---|---|---|---|---|---|
| A 对照 | 维多利亚 | 24 | 3 | 13 % | 0 |
| **B 处理** | 维多利亚 | 19 | 10 | **53 %** | 0 |
| C 强化 | 维多利亚 | 19 | 18 | **95 %** | 3 |
| A 对照 | 谢拉格 | 24 | 6 | 25 % | 1 |
| D 补充 | 谢拉格 | 24 | 20 | **83 %** | 1 |

→ 处理确实投递了：从 13 % 抬到 53 %（B），强化版抬到 **95 %**（C）。
**在"四个座位几乎全部真的走了同一条盟约"（95 %）的情况下，BOSS 掉血仍然没有变好**（中位 0 %、均值 14.23 % vs 对照 17.97 %）。
这排除了"钩子没生效 / 路线没真的统一"的解释。

注：C 出现过 1 次胜利（seed 3，`boss_3 0/8000000` → 100 %），说明同路线存在**偶发**上限，但 1/20 不改变中位数与均值的结论，不足以支持"显著提高"。

---

## 7. 机制层面：引擎里根本没有"团队通道"

- 盟约层数与激活是**每个座位独立**的：`PlayerState.layers = {}`、`recompute()` 里的 `computeBonds(this.gd, this)`（`server/match/PlayerState.js:206-252`）。
  没有任何把 A 座位的层数/激活写进 B 座位的代码路径（全仓 `teamBond|sharedBond|teamLayer|通道` 无命中）。
- 跨座位唯一的聚合是**共享 BOSS 血池**：`finalAssault.js` 顶部注释「one pool shared by every boss field」
  + 官方提示「所有人将一起对敌方领袖造成伤害」。也就是说"四个人的伤害叠在同一个池子上"**本来就是设计如此**，
  不需要任何"通道叠加"机制；四个人各打各的池子也会相加。
- 因此本实验实际测的是：**四座位走同一条路线，对每个座位自身输出/存活的影响**。实测偏负。
  与代码一致的解释：共享牌池被四个座位同时抢同一条盟约的成员（`bondPlan` 默认在 bot.js:398-399 主动给"队友已在建的盟约" −6 分，
  正是为了避开这种争抢），同路线把这条自我修正关掉后，人均成型更慢更差。

---

## 8. 结论

1. **用了真钩子，不是弱化版**：`SP_LAB_FOCUS_BY_SEAT`（bot.js:416-419）可以按座位指定核心盟约；
   "法系路线"取 `victoriaShip`（维多利亚，核心盟约里 arts 成员占比最高 60 %）。奥术 `arcaneShip` 因 `isCore:false` 无法被该钩子选中，这是本次的一个数据层面的限制，已记录。
2. **接线体检通过**：荒谬值 `SP_LAB_BUY_FULL_MIN=99999` 把局面从"活到 R14"打成"R11 全灭"，per-seat focus 钩子把 bond strip 从"无维多利亚"改成"维多利亚…"。
3. **未观测到叠加**：A 掉血中位 4.40 %、R13 团队 LP 中位 19.0；B 掉血中位 2.72 %、R13 团队 LP 中位 8.0。
   比值 0.62× ≪ 1.5× 判据。配对平均差 −6.50 pp（仅同 BOSS 且都到 R14 的子集 −7.76 pp）。
4. **强化版与换一条法系也没有正效应**：C（锁盟约，95 % 存活座位同路线）掉血中位 0 %、均值 14.23 %；
   D（谢拉格×4）掉血中位 0 %、均值 15.50 %。三条处理臂的配对平均差全为负。
5. **唯一反例**：C 的 seed 3 拿到了 1 次胜利（BOSS 100 %），但 1/20，不足以支撑"显著提高"。

**一句话：在 ABYSS 4 人局里把四个座位压到同一条法系核心盟约后，R14 BOSS 被打掉的血量没有提高，中位数反而从 4.40 % 降到 2.72 %；"团队通道叠加"这个说法在引擎里既没有代码支撑，也没有观测到效应。**

---

## 9. 局限（诚实记录）

- 20 seeds/臂，"未到 R14 记 0 %"的口径下中位数落在 0–4 % 之间，噪声不小；结论的**方向**（不增反减）在三种处理、两种盟约、配对与非配对口径下都一致，但没有做置信区间/显著性检验。
- 钩子只能选**核心**盟约，真正的"法系盟约"奥术（`arcaneShip`）无法作为 focus，所以严格说测的是"四人同走一条**核心**盟约（其中法系成员占比最高的那条）"，不是"四人同走奥术"。
- `--rehearsal 1` 是为了控制耗时的选择（两组一致），不是最优布局；更高的 rehearsal 可能整体抬高掉血量，但不影响两臂的可比性。
- R14 之前全灭的 seed（A 10 个、B 10 个、C 12 个、D 11 个）在"未到记 0"里权重很大；"仅到 R14"一列已作为补充口径给出。

## 10. 本轮新增的一个读数工具（可复用）

- `advisor-dev/lab/bossarm.mjs` —— `node lab/bossarm.mjs <label> <matchrun --json 转储...>`，输出逐 seed 的 BOSS 掉血 %/绝对伤害/R13 生存座位 LP 之和，以及中位数、均值。
- `advisor-dev/lab/paired.mjs` —— `node lab/paired.mjs <labelA> <fileA> <labelB> <fileB>`，同种子配对差、符号计数、"两臂都到 BOSS 且同 BOSS"子集。
- `advisor-dev/lab/dose.mjs` —— `node lab/dose.mjs <盟约名> <转储...>`，处理强度检验（存活座位里目标盟约的激活率）。
