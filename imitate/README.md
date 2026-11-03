# imitate/ —— 从 owner 的真人局学「每回合怎么摆、升不升、买哪张」（模仿学习的小模型）

推演顾问（`advisor/`）准但慢，而且只会照电脑打法往后打。这里训一个小 transformer，直接学 owner 自己在每个准备阶段做了什么，
给顾问当**候选生成器**：先由它给出 3–5 个「owner 多半会这么做」的候选，再交给引擎（`advisor/lineup.mjs` 等）去复核。
它**不当裁判**：模仿出来的「像 owner」不等于胜率高，评判仍然交给引擎。

数据只有几十局，所以这一版的重点是把流水线做成「新录像一上传，重跑两条命令就重训、重评估」，数字照实记账。

## 模块

| 文件 | 作用 |
|---|---|
| `records.py` | 数据源 → 统一的「决策点」记录。`.spdemo`：每回合一条（上一场开打时的棋盘 → 这一场开打时的棋盘、调度中心升没升）；overlay 记录（`matches/*.jsonl`）：每个「商店时段」一条（一次刷新或者回合开始到下一次刷新，商店里少掉的牌 = 买了），回合的第一个时段同时带上阵容和升级标签。源里没有的字段一律留空（`None`），不猜。 |
| `tokens.py` | 决策点 → 定长 179 个 token（全局 / 自己 / 3 个队友 / 12 格棋盘 / 6 格商店 / 9 格手牌 / 金币）。所有来源共用这一份编码，以后官方客户端的识别结果也填成同一种记录、走同一个编码。词表从引擎的 `data/*.json` 生成，训练好的模型把自己的词表存进 checkpoint。 |
| `dataset.py` | 扫仓库里所有录像和 overlay 记录 → `decisions.jsonl` + `manifest.json`。同一局在 `demos/raw/` 和 `matches/` 里都有时按录像的对局 id 去重。**分折只看对局 id 的哈希**：加新局不会把老局挪到别的折。 |
| `model.py` | 网络：token 嵌入 + 2 层 transformer（d=128，约 46 万参数），三个头：阵容（每个干员在不在下一场的棋盘上）、升级（这个准备阶段升不升）、买牌（商店每一格买不买）。 |
| `train.py` | 按局分折交叉验证（每折 3 个模型种子，和分折的随机性分开）+ 全量训练出 `final.pt`；每轮记训练 / 留出的 loss 曲线；同一折上同时算两个查表基线。`--only-fold/--only-seed` 分开跑、`--stage merge` 合并，用来在共享机器上限制并发。 |
| `evaluate.py` | 指标和查表基线（只用训练折拟合）。 |
| `predict.py` | 推理接口：一行一条决策点记录进去，一行一条建议出来（见下）。 |
| `report.py` | `eval.json` → `docs/imitate/` 里的表和精简 JSON（不含机器路径）。 |
| `test_imitate.py` | 单测：`python3 -m unittest imitate/test_imitate.py`（不需要引擎；装了 torch 时多测一个前向）。 |
| `configs/` | `default.json`（固定 60 轮，取最后一轮）、`early-metric.json`（每个头在内部验证局上按排序指标挑轮数）、`smoke.json`（几秒钟的冒烟）。 |

## 跑法

目录布局同仓库 README：`<root>/engine` 是引擎（只读它的 `data/*.json`），`<root>/sp-advisor` 是本仓。训练需要 `torch`（CPU 版就够），数据和模型写在仓库外面。

```bash
cd <root>/sp-advisor
python3 imitate/dataset.py --repo . --engine-data ../engine/data --out ../data/imitate/decisions.jsonl
python3 imitate/train.py --data ../data/imitate/decisions.jsonl --engine-data ../engine/data \
    --config imitate/configs/default.json --out ../data/imitate/run --stage cv,final
python3 imitate/report.py --run default=../data/imitate/run/eval.json --final ../data/imitate/run/eval.json \
    --md docs/imitate/eval-<日期>.md --json docs/imitate/eval-<日期>.json
# 想限制并发：每个（折, 种子）单独跑，再合并
python3 imitate/train.py ... --only-fold 0 --only-seed 0      # 写 <out>/cv_fold0_s0.json
python3 imitate/train.py ... --stage merge                    # 缺任何一个（折, 种子）直接报错
# 学习曲线：每折只用前 k 局训练
python3 imitate/train.py ... --stage cv --train-games 8
```

**加数据重训**：新的 `.spdemo` 进 `demos/raw/`、新的 overlay 记录进 `matches/` 以后，重跑上面三条命令就行。老局的折不变，所以前后两次的数字可以逐局对比。

## 推理接口

```bash
python3 imitate/predict.py --ckpt ../data/imitate/run/final.pt --engine-data ../engine/data --k 5 < records.jsonl
```

输入：`records.py` 里的决策点记录（`round / mode / boss / band / factions / teamLp / pub / mates / board_prev / shop / hand / funds`），读不到的填 `null`。
输出（每条一行）：

```json
{"round": 11,
 "add": [{"base": "chess_char_4_09_a", "name": "水月", "p": 0.59}, ...],
 "keep": [{"slot": 1, "id": "chess_char_4_21_a", "p": 0.38}, ...],
 "level_up": 0.85,
 "buy": [{"slot": 0, "id": "chess_char_3_06_a", "p": 0.41}, ...]}
```

- `add`：还不在棋盘上、模型认为 owner 这一场会摆上去的前 k 个干员（买 / 从手牌上场的目标）；
- `keep`：棋盘上每个单位留在下一场的概率（低 = 想卖或换下）；
- `level_up`：这个准备阶段升调度中心的概率；
- `buy`：商店每一格买的概率（记录里没有商店时为空）。

overlay 要接它时，把 `state.json` 里已经有的字段按这个格式填一条就行；官方客户端的识别器同理。模型只在 owner 打过的局面附近有意义。

## 怎么评（防止自己骗自己）

- **按局分折**：同一局的回合不会同时出现在训练和测试里；折由对局 id 的哈希决定，模型种子另取（1000、1001、1002）。
- **对照**：同一折上拟合两个查表基线：阵容 = 按策略统计「新上了谁」的频率；升级 = 按「回合 × 调度中心等级」统计的升级频率；买牌 = 按「手上已有几张同名 × 价格」统计的购买率。网络要稳定超过查表才算学到了东西。
- **指标**：阵容 = 新上的干员落在模型前 5 / 前 10 的比例、「留谁」AUC；升级 = AUC、Brier；买牌 = 每格 AUC、分最高的那格真买了的比例。
- `docs/imitate/eval-*.md` 是每次的数字。

## 已知限制

1. `.spdemo` 没有商店、手牌、金币（服务器不广播），所以买牌头只能从 overlay 记录学（目前 9 局）。
2. overlay 的买牌标签来自快照差：两次快照之间先买后刷新的那张牌，会被记成「没买」。早期记录（10-18、10-19）快照稀，噪声更大。
3. `matches/2026-10-24.json`、`2026-10-25.json` 是每回合一条的摘要，没有棋盘，这一版没用上。
4. 阵容头预测的是下一场整个棋盘，概率普遍偏低（没校准），只适合排序。
5. 训练时的轮数是事先定的配置，`default.json` 是在两套配置里按交叉验证结果选出来的，交叉验证的数字因此略偏乐观。
