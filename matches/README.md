# matches/ —— 真实对局的过程记录（复盘用）

这里是**真人打的对局**逐回合快照，一行一回合（JSONL），由 `overlay.mjs` 的 `recordTurn()` 从客户端
`store.get('match')` 里读出来追加到 `records/<日期>.jsonl`，再拷到这里留档。

和 `samples/` 的区别：

| | 来源 | 用途 |
|---|---|---|
| `samples/` | 引擎 `tools/matchrun.mjs` 跑 bot，20 seeds 一臂 | 复现模型结论 |
| `matches/` | 客户端里真人打的一局，每回合一行 | 复盘「当时顾问说了什么、我买了什么、结果怎样」 |

客户端自己不保存过程（只把终局结果写进 localStorage 的 `sp.match-history.v1`），所以过程是这个仓库独有的。

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
| `shop` | 商店未售出的格子：`id` / `price` / `frozen` |
| `advice` | 当时模型给的结论（`advice.kind` 的口径：buy / level / refresh / wait） |
| `pick` | 当时推荐的那一格 |
| `terminal` | 当时的输出终端 |
| `boss` | 本局 BOSS 与破甲通道 k |
| `stats` | 服务端统计：dmgDealt / bossDamage / kills / leaks / gold / refreshes / merges / itemsEquipped |

## 注意

- 这些文件是**某一时刻的快照**：`records/` 在 `.gitignore` 里，还在被 overlay 持续追加；这里拷出来的是留档版本。
- 不含账号、昵称或任何令牌：字段全部来自对局视图本身。
