# human/report —— 生成 STEP / docs/human 文档的表格脚本（python3，只读结果文件）

在工作目录（含 `results/`、`sp-advisor/`）里运行：

| 脚本 | 输入 | 输出 |
|---|---|---|
| `econ_agg.py results/econ-A-game1.json` | `hind-run.mjs` 的推演结果 | 每回合 × 打法的均值和配对差（vs owner / vs 同计划重抽） |
| `game_md.py game1 results/econ-A-game1.json results/econ2-A-game1.json` | 推演 + `field-run.mjs` + `advice.json` | 每局附录表（A 口径、B 口径、装备换人、顾问对照） |
| `advice_eval.py` | `advice.json` + 推演 + 单场搜索 | `docs/human/ADVISOR-EVAL.md` 的逐回合表 |
| `ownergrid.py <jsonl> <first> <last> "<回合>=<建议>" …` | 记录 | owner 实际战斗棋盘的文字网格 |
| `boards.py game1 8:B 14:boss:layout` | `field-<game>.json` | owner 摆法 vs 搜索最优摆法网格 |
