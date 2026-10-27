# matches/ —— 真实对局的过程记录（复盘用）

这里是**真人打的对局**快照，一行一个事件（JSONL），由 `overlay.mjs` 的 `recordTurn()` 从客户端
`store.get('match')` 里读出来追加到 `records/<日期>.jsonl`，再拷到这里留档。

和 `samples/` 的区别：

| | 来源 | 用途 |
|---|---|---|
| `samples/` | 引擎 `tools/matchrun.mjs` 跑 bot，20 seeds 一臂 | 复现模型结论 |
| `matches/` | 客户端里真人打的一局 | 复盘「当时顾问说了什么、我买了什么、结果怎样」 |

客户端自己不保存过程（只把终局结果写进 localStorage 的 `sp.match-history.v1`），所以过程是这个仓库独有的。

## 什么时候写一行

1. 进入新的「回合 + 阶段」（`ROUND_START` / `PREP` / `COMBAT` / `SETTLE` …）；
2. **同一阶段里经济状态变了**——买了、卖了、刷了、冻了、挪位了、升本了，或者**队友的阵容/等级/LP 变了**。

第 2 条是逐动作粒度。2026-10-19 之前的记录只有第 1 条（一回合里的四次购买被压成一行），
所以那几天的一局其实只有 20 行左右；从 `recordTurn` 改过之后，一局会落 60–100 行。

判断「变了」的指纹是 `recordKeyOf()`：资金 / 等级 / LP / 商店（含槽位号与冻结）/ 上阵（含坐标）/ 手牌 / 盟约人数层数
+ 每个队友的 LP / 调度中心等级 / 上阵人数 / 盟约人数。**队友的层数不进指纹**——层数在战斗里每帧都在涨，进去会把文件写成刷屏。

## 字段

| 字段 | 含义 |
|---|---|
| `at` | 写入时间（ISO） |
| `phase` / `round` | 阶段（INFO_CHECK / BAND_DRAFT / BATTLE_CHECK / PREP / COMBAT …）与回合 |
| `mode` | 模式 id，如 `mode_multi_abyss` |
| `funds` / `lp` / `level` | 金币 / 生命 / 调度中心等级 |
| `bonds` | `盟约id:人数/层数` |
| `board` | 场上干员：`id`、`golden`（精锐）、`tier`、`items`（装备）、`at: [row, col]`、`dir` |
| `hand` | 手牌 id |
| `shop` | 商店未售出的格子：**`slot`（真实槽位号，1 起）**、`id`、`price`、`frozen` |
| `mates` | **队友（不含自己）的公开状态**：`name`/`seat`/`isBot`/`alive`/`lp`/`level`（调度中心）/`board`（上阵人数）/`status`/`bonds`（`盟约id:人数/层数`） |
| `teamLp` / `bossHp` | m.public 的合作进度：队伍 LP、BOSS 血池 `{hp, max}` |
| `advice` | 当时模型给的结论原话（“抓 X（槽位 N）” / “升调度中心 Lv5” / “先刷找 …” / “忍住，攒金”） |
| `pick` | 当时推荐的那一格与评分 |
| `terminal` | 当时的输出终端 |
| `boss` | 本局 BOSS 与破甲通道 k |
| `stats` | 服务端统计：dmgDealt / bossDamage / kills / leaks / gold / refreshes / merges / itemsEquipped |

> `slot` 与 `mates` / `teamLp` / `bossHp` 是后加的：早先的记录把已售出的商店格直接丢掉（槽位号整体前移，和顾问嘴里说的
> 「槽位 3」对不上），也完全没采队友。**2026-10-20 及更早的记录没有队友字段**；从采队友那版 `recordTurn` 之后才有。

队友能看到什么、看不到什么（`m.public.players` 的边界）：**看得到** LP / 调度中心等级 / 上阵人数 / 每个盟约的人数和层数 /
淘汰与在线状态；**看不到**他买了哪张牌、手牌、钱、站位（服务端不公开这些）。所以「他怎么玩的」只能从上面那几列反推。

## 复盘

```powershell
node lab\replay.mjs                 # 四局全量：每拍「顾问说什么 / 你做了什么 / 差在哪」
node lab\replay.mjs --only-x        # 只看和顾问不一致的拍
node lab\replay.mjs --json          # 机器可读
```

它能反推出买/卖/刷/冻/升本/挪位，名字用 `plugin/ui/index.html` 里内嵌的 `sp-data` 翻译成中文。
逐动作记录到位之后，一拍的粒度就是「一次操作」，价格也能从商店里对上，不再出现“价不详”。

## 注意

- `records/` 在 `.gitignore` 里，还在被 overlay 持续追加；这里是拷出来的留档版本（每局打完再拷一次）。
- 不含账号、昵称或任何令牌：字段全部来自对局视图本身。

## 整局 demo（`.spdemo`，0.3.2 起游戏自带导出）

游戏页可以导出整局 `.spdemo`（gzip JSON：`m.public` / `m.layer` / `b.start` / `m.unitStats` / `m.result` 的帧序列）。
它**只有公开视图**（没有商店、手牌、资金、站位），但覆盖四家的层数、上阵人数、调度中心等级、LP 与每场战斗的阵容，
所以比 `recordTurn` 的逐动作记录更适合复盘「为什么这局能胡」。

| 文件 | 内容 |
|---|---|
| `2026-10-27-abyss-15r.spdemo` | 整局 demo（已脱敏：昵称 → `座位N`，账号 id → `seatN`，含 battleId 里内嵌的 id） |
| `2026-10-27-abyss-15r.summary.json` | `lab/analyze-demo.mjs` 的结构化输出（四家终局、每回合、层数、战斗阵容） |
| `../model/POSTMORTEM-2026-10-27-ABYSS-15R.md` | 这局的复盘：核心人数 → 层数加速段，以及 BOSS 伤害归属 |

工具：

```powershell
node tools/redact-demo.mjs <in .spdemo|.json> <out .spdemo|.json>   # 昵称/账号 id → 座位，失败就不落盘
node lab/analyze-demo.mjs matches/2026-10-27-abyss-15r.spdemo        # 打印复盘表；--json / --out <file> 给机器读
```

