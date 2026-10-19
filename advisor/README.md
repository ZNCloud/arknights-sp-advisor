# 卫戍协议「胜率最高」建议器（advisor）

给定**任意局面**（存档 JSON），列出当前座位所有合法动作（买 / 卖 / 上场 / 下场 / 转向 / 装备 / 升级 / 刷新 / 冻结 / 选奖励 / 结束回合 / 按 guide 打完本回合），给每个候选动作估计**胜率（Wilson 95% 区间）**、效用值、R14 伤害、活到 R14 的概率，以及**与「按 guide 打完」在同一组随机未来上的配对差**（置信度）。

## 模块

| 文件 | 作用 |
|---|---|
| `state.mjs` | 局面接口：`capture(m)` 抓 PREP 局面 → `toJSON` 存档 → `fromJSON` + `restore()` 恢复成可继续模拟的 Match。`rngMode:'exact'` 精确续跑（已验证：存档→JSON→恢复后逐回合与原局一致），`'resample'` 采样独立未来（推演用，不偷看真实随机数；R15 隐藏 boss 未揭晓前按公开权重重采样）。|
| `actions.mjs` | 合法动作生成 + 便宜先验 + 按家族配额剪枝到 top-K（每类动作至少保留代表）。所有动作走引擎公开 handler，合法性由引擎判。|
| `rollout.mjs` | 评估器 v1 原语：恢复局面 → 执行候选动作 → 本回合剩余由 guide 打完（站位/下场/转向/结束 视为本回合最后一步）→ 全队后续按 guide → 引擎跑到终局。|
| `advise.mjs` | 两阶段推演：所有候选 N 次（共同随机数），前 3 名再加 N2 次；可选 v2 估胜模型预筛（`modelScorer`）。|
| `features.mjs` / `model.mjs` / `train.py` / `datagen*.mjs` | 评估器 v2：自对局特征 → LightGBM（胜/效用两模型）→ JSON 树在 JS 里实时推理。|
| `pool.mjs` / `worker.mjs` | worker_threads 池。|

## 用法（目录布局同仓库 README：`<root>/engine` 为引擎、`<root>/sp-advisor` 为本仓；docker node:22，见 `run-node.example.sh`）

```bash
# 从某种子的 guide 对局里存第 10 回合开始时的局面
node sp-advisor/advisor/cli.mjs save --seed 1004 --round 10 --out positions/s1004-r10.json
# 给建议（v1 纯推演）
node sp-advisor/advisor/cli.mjs advise --state positions/s1004-r10.json --K 8 --N 8 --N2 8 --workers 32
# 给建议（v2 模型预筛全部合法动作 + 前 K 推演细算）
node sp-advisor/advisor/cli.mjs advise --state positions/s1004-r10.json --model sp-advisor/models --K 4 --N 8 --N2 8
# 「按建议打」vs guide 对比
node sp-advisor/eval/advised.mjs --seeds 1001-1010 --K 8 --N 6 --N2 6 --steps 2 --workers 46 --out results/m1.json
```

## 每步要多久（实测，本机 32–46 线程）

- 单次推演（R10 → 终局）单线程 5–8 s；早期回合更长。
- v1：K=8、N=8+N2=8 → 88 次推演，s1004 R10 实测 **58 s**（32 线程，docker 限 24 核）；K=8、N=6+6 → 66 次约 **20–60 s**。
- 预算公式：`耗时 ≈ (K·N + 3·N2) × 单次推演秒数 / 线程数`。

## 置信度与「偏离 guide」规则

候选间用同一组采样种子（共同随机数），报告配对差 `vsGuide = mean ± se`。对局评估里只有 `mean > max(0.005, z·se)`（默认 z=1）才偏离 guide，防止「8 个噪声估计取最大」的选择偏差。

## 效用（排序用）

胜 = 1（R15 隐藏通关 +0.25）；败 = 0.5·(到达回合−1)/13 + 0.45·R14 伤害比例。自然开局胜率低，单看胜率候选间常常全是 0，所以败局按「活多久、打掉 boss 多少」细分。**报告里的胜率是真实对局结果计数，不是效用。**

## M2 增补（2026-10-19）

### 估胜模型（评估器 v2）
- 数据：`datagen.mjs` 自对局，打法混合 g06 / g07 / g06_la 三份 guide × 随机扰动 eps∈{0,.1,.25,.4} + 15% 注入局（拉特兰/冻结流，标注为诊断正例）。每份数据带版本戳 `<file>.meta.json`。
- 两套输入：`features.mjs`（聚合 123 维，默认 `models/`）与 `features-table.mjs`（局面表 1188 维，TABLE_VERSION=1，属性编码，`models-table/`）。
- 训练：`train.py`（LightGBM，按种子 seed%5 切验证集）→ `stamp.mjs` 写 `meta.json`（数据指纹、引擎 commit、特征集）。
- 用法：`advise --model sp-advisor/models`（模型给全部合法动作打分 → 前 K + guide + 宏动作推演细算）；`advised.mjs --N 0` 为纯模型快速模式（偏离阈值 `--margin`，默认 0.05）。
- 宏动作：`宏：梭哈刷新`、`宏：能升就升`（多步打法，坏局用）。

### 游戏更新后对齐
| 步骤 | 命令 |
|---|---|
| B1 数据指纹 | `eval/version.mjs dataHash()`：data/*.json（不含 assets.json、i18n/）+ 引擎 commit (+内存补丁) 的 sha256 |
| B2 过期降级 | 自动：`advisor/meta.mjs` 比对 `models/meta.json`；不符 → 输出「模型待更新：…」，不用模型预筛，K+4、N×2 |
| B3 改动清单 | `node sp-advisor/tools/datadiff.mjs <旧引擎目录> <新引擎目录> [--json out.json]` |
| B4 一键补训 | `PATCH=… FAVOR=<改动干员> PY=<python 包装> sp-advisor/tools/retrain.sh <候选目录>`：造数据 → 训练 → 打戳 → 三条验收（校准、对局不退步、改动干员估值方向）→ 通过才换上 |
| B5 内存补丁 | `node sp-advisor/eval/with-patch.mjs <patch.json> <脚本> …`：用引擎自带 `applyPatches`/`setData` 装内容集，引擎 data 不写；worker 线程同样装上 |

### 引擎错误
采样未来里引擎自己报错（如 sim「hook nesting deeper than 32」）时，该次推演标记无效、不计入统计，并在输出 `engineErrorRollouts` 里计数；自对局同理丢弃该局并计数。
