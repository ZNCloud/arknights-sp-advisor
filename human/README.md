# human/ —— 真人局灌回引擎 + 事后诸葛亮（task sphind_2254）

把 `matches/` 里 owner 打的真人局逐回合灌回引擎，复现每回合的局面和结算血量；在复现出来的每个局面上，
比较 owner 当时的做法和其它做法（信息公平 A / 已知未来 B 两种口径）；并把这些局面接进顾问的评测。

## 模块

| 文件 | 作用 |
|---|---|
| `record.mjs` | 读一段记录（`GAMES` 里登记了 10-18 / 10-19 两局），按回合切成「开局快照 / 战斗棋盘 / 结算血量」，缺行照实标出。 |
| `force.mjs` | 把引擎里一个座位强制成记录快照（商店 / 手牌 / 棋盘站位朝向 / 装备 / 金币 / 血量 / 等级 / 盟约层数，卡池份数照实归还和取出）；盟约人数和记录不一样的地方用引擎自带的人数补正对齐并返回；`diffSeat` 逐项比对。`STAND_INS`：客户端有、引擎没有的干员的替身。 |
| `ownerturn.mjs` | 比较两张快照推出 owner 这回合的净操作（升级 / 开局商店买入 / 卖出 / 非开局商店得到 / 装备 / 站位），并用引擎接口（`levelUp / buy / sell / equip / move`）重放，引擎拒绝的照录。 |
| `replay.mjs` | 复现主程序：开局对齐（地图由站位合法性反推、禁用盟约只取记录里没出现过的、BOSS / band 按记录），每回合强制开局 → 重放 → 比对 → 强制战斗棋盘 → 在引擎这一回合的敌人分布里找与记录结算血量一致的那一波。可选把每回合存档写盘（`advisor/state.mjs` 格式）。 |
| `shadow.mjs` | 「owner 影子打法」：后续回合尽量照 owner 记录里的目标（等级 / 阵容 / 装备 / 站位）去打，牌不够时用引擎 AI 的启发式补位。A 口径的续打策略。 |
| `candidates.mjs` | 一个准备回合的整回合替代打法：owner 实际 / 照计划重抽刷新 / 剩钱全升级 / 剩钱全刷新 / AI 选人摆位 / AI 分新装备 / AI 托管 / 顾问 guide / 旧顾问建议一步 / owner 实际 + 新顾问站位检查（`lineup`）/ 新顾问 v3 经济门槛（`advisor_v3`）。 |
| `hindsight.mjs` + `hind-run.mjs` + `hind-worker.mjs` | 经济路线推演：从某回合开局存档出发换一种打法，之后续打到 R14，量 owner 自己的掉血、R14 / R15 单人份额；共同随机数配对。 |
| `fieldsearch.mjs` + `field-run.mjs` + `field-worker.mjs`（打分在 `advisor/field.mjs`，单人打 BOSS 在 `advisor/battle.mjs`，顾问的站位检查用同一份） | 单场战斗事后最优：同一批牌的上场阵容 / 站位 / 朝向爬山搜索（普通回合最小化漏怪，BOSS 回合最大化单人份额，可选重分装备），以及「这件装备当初给另一个人」对之后每一仗的影响。 |
| `pairverify.mjs` / `variant.mjs` / `normvariant.mjs` / `itempair.mjs` / `unitdmg.mjs` | 复核：搜索出的 BOSS 回合最优棋盘在双人场（搭档 = owner 同一块棋盘镜像）多种子重打；手写单步改动（换人 / 挪位 / 转向 / 装备换人）的打分；逐个干员伤害拆分。 |
| `accept.mjs` + `accept-set.json` | 验收集：重建两局 60 个存档，断言普通回合结算血量全对、存档 sha256 与清单一致（`--write` 重写清单）。 |
| `replay_md.py`、`report/` | 把复现 / 推演 / 搜索结果渲染成 `docs/human/` 里的表。 |

顾问评测：`eval/human-advice.mjs`（每个真人局面跑一次 `advisor/advise.mjs`，与 owner 实际、当时小框原话并排；
「owner 也做了这件事」只表示清单有交集），之后用 `hind-run.mjs --cands owner,shadow,advisor` 在同一套推演里给顾问建议打分。

## 跑法（docker node:22，引擎只读挂在 `<root>/engine`，见 `advisor/run-node.example.sh`）

```bash
# 1. 复现（每局 2.5–3 分钟），存档写到 positions/
node sp-advisor/human/replay.mjs game1 results/replay-game1.json positions 400 24 mirror
node sp-advisor/human/replay.mjs game2 results/replay-game2.json positions 400 24 mirror
python3 sp-advisor/human/replay_md.py results > replay.md
# 2. 经济路线（A 口径）
node sp-advisor/human/hind-run.mjs game1 results/replay-game1.json positions results/econ-A-game1.json --rounds 1-15 --cands owner,shadow,levelmax,rollmax,ai_turn,guide --modes A --N 12 --workers 60
# 3. 单场战斗（B 口径 + 期望）
node sp-advisor/human/field-run.mjs game1 results/replay-game1.json positions results/field-game1.json --workers 40
# 4. 顾问在真人局面上的建议，再进推演打分
node sp-advisor/eval/human-advice.mjs --positions positions --out results/advice.json --K 4 --N 6 --N2 6 --workers 48
SP_ADVICE=results/advice.json node sp-advisor/human/hind-run.mjs game1 results/replay-game1.json positions results/advice-A-game1.json --cands owner,shadow,advisor --modes A --N 24
```

## 口径与局限（详见 `docs/human/`）

- 记录没有随机数、敌人、队友：地图 / 禁用盟约 / band / 敌人波次 / BOSS 回合的队友配置与隐藏 BOSS 都是「对齐」出来的（取第一个能打出记录结算血量的配置），对齐方法和每回合的一致率都写在复现表里。两局 30/30 回合结算血量与记录一致。
- BOSS 回合由 4 人共同决定，记录没有队友；主指标一律用 owner 自己的场（单人份额、自己场漏怪）。
- 引擎（0.3.2-dev）里 owner 的中后期阵容比真实局更容易漏怪：A 口径的掉血绝对值偏高，只比较同一批随机未来上的差。
- B 口径钉死了后续商店，所以「早升级」在 B 里没有收益可言；升级 / 刷新这类经济决策只在 A 口径里比。
