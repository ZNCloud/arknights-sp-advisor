# 蒸馏框架：让推演顾问教一个小网络

## 一句话
推演顾问很准但很慢（一步 12–53 秒）。这里搭了一套流程：让顾问当老师，在自对局里给每个决策打分；拿这些分训练一个小网络（约 80 万参数），之后一步决策只要几毫秒。真正的训练很吃 CPU，所以做成**只在机器空闲时自动跑**，有人要用机器就存档让出，下次接着跑。

## 文件
| 文件 | 干什么 |
|---|---|
| `distill/datagen.mjs` | 造数据：p0 按老师 / 学生混着打（DAgger），每个决策点都请顾问打分，一行一个决策 |
| `distill/vocab.mjs` | 动作表：结束回合、照 guide 打完、宏（梭哈刷新 / 能升就升）、升级、刷新、冻结、买第 0–7 格、选奖励第 0–3 个。卖、装备、站位不在表里，由 guide 做 |
| `distill/features.mjs` | 把局面编成 1343 维向量；每一维的含义见 `docs/distill-features.md`（由 `node distill/features-doc.mjs` 生成） |
| `distill/model.py` | 网络：MLP（默认 512-256，约 83 万参数）；可选小 Transformer（每个干员格子当一个元素） |
| `distill/train.py` | 训练：软标签蒸馏 + 行为克隆，能断点续训，忙时存档退出 |
| `distill/student.mjs` | 学生网络的 JS 推理（读 `train.py` 导出的 JSON），加载时自检与 PyTorch 输出一致 |
| `distill/idle.py` | 空闲判断：显卡、CPU 负载、内存、别的重活、docker、时段 |
| `distill/run.py` | 总流程：造数据 → 训练 → DAgger 几轮 → 固定种子评测；每步记进度，断了接着跑 |
| `distill/idle-run.sh` | 给 cron / systemd timer 调的入口：包内存上限、低优先级，忙就不跑 |
| `distill/systemd/` | timer 模板（**没装**） |
| `distill/configs/smoke.json` / `full.json` | 冒烟 / 正式的参数 |
| `eval/seat-driver.mjs` | 「p0 由谁决策、其余照 guide」的对局循环；`eval/advised.mjs`（顾问评测）和造数据共用这一份 |

## 准备环境
目录摆法和仓里其他脚本一样：仓库旁边放 `engine/`（引擎检出）和 `guides/`（`g06_final.json` 等）。
```
uv venv venv && uv pip install --python venv/bin/python torch numpy     # 只有训练要 torch；造数据和评测只要 Node
```
数据、断点、学生网络、日志都写在配置里的 `work_dir`（默认在仓库外面的 `../data/...`），**不进仓库**（`.gitignore` 已排除）。

## 冒烟（几分钟，全链路）
```
venv/bin/python sp-advisor/distill/run.py --config sp-advisor/distill/configs/smoke.json --ignore-idle
```
`--ignore-idle` 表示不管机器忙不忙都跑（手动试的时候用）。也可以一步一步跑：`--stage datagen:0`、`train:0`、`datagen:1`、`train:1`、`eval`；`--stage status` 看做到哪了。

## 正式流程（`run.py --stage auto`）
1. `datagen:0`：老师自己打（beta=1）。默认老师是**估胜模型**：每个合法动作一次打分，一个决策几秒，适合大批量预训练。
2. `train:0`：从头训。
3. `datagen:k`（k=1,2,3）：**DAgger**：学生按概率 1-beta 自己走（beta 每轮减半），顾问在学生走到的局面上补标签。`full.json` 从这一轮起换成**推演顾问**当老师（准但贵，只给前 K 个候选打分）。
4. `train:k`：接着上一轮的断点，在所有数据上再训 `finetune_steps` 步。
5. `eval`：学生接进 `eval/advised.mjs --student`，在固定种子上和「只照 guide 打」配对比较；配置里 `eval.reference` 可以加完整顾问已有的结果文件（同种子），一起比。

### 学的是什么
- 每个决策点存：局面向量、哪些动作合法、老师给每个动作的效用分、老师最后选了什么、看队友的顾问让这个座位走哪条线、这局最后的效用。
- 损失：①预测每个动作的效用分（软标签，不只学第一名）；②和老师的打分分布对齐（KL）；③老师实际的选择（辅助）；④选线（辅助）；⑤整局结果（辅助）。前 6 回合的样本权重减半，那几回合老师的标签噪声最大。
- 学生怎么出手：合法动作里效用最高的那个，比「照 guide」高出 0.05 才偏离 guide（和顾问只靠估胜模型时的规则一样）。

### 评测
```
node sp-advisor/eval/advised.mjs --seeds 5001-5150 --mode both --guide guides/g06_final.json --student <work_dir>/students/iter3.json --out results/student.json
python3 sp-advisor/eval/report/compare50.py --common "guide=results/student.json:baseline" "student=results/student.json:advised" "advisor=<完整顾问的结果文件,逗号分隔>:advised"
```
输出每档的胜局、进 R14、效用，以及两两配对：效用差 ± 标准误（带 p 值）、胜局 McNemar p 值。造数据的种子会自动避开 2001–2050、3001–3800、5001–5200、50000–61200（评测和别的训练用过的段），撞上直接报错。

## 空闲开关
### 怎么判断「闲」
`distill/idle.py`，阈值在配置的 `idle` 段，任何一条不满足就算忙，并写出原因：
- 显卡：别的进程占显存超过 2 GB，或者有别的进程在用而且占用率超过 20%（自己的进程不算）；
- CPU：1 分钟负载扣掉自己的 worker 后，每核超过 0.5（`full.json` 是 0.4）；
- 内存：可用不到 32 GB；
- 别的重活：进程命令行里有 `blender`、`ffmpeg`、`eval/advised.mjs`、`eval/teamplay`、`advisor/datagen.mjs`、`docker run`、`render`；
- docker：有名字带 `test`、`smoke`、`render`、`qa` 的容器在跑；
- 时段：`allowed_hours` 可以限定只在比如 `["00-09","20-24"]` 跑（默认不限）。
开跑前连查 3 次（间隔 20 秒）都闲才开；跑的过程中每 60 秒再查一次。变忙了：造数据停掉（已经打完的局保留），训练存断点，退出码 75，原因写进日志。下次再触发就从断点接着跑。

### 看日志
- `<work_dir>/logs/idle.log`：每次检查的结论、原因、负载/显存数字；
- `<work_dir>/logs/run.log`：哪一步开始、结束、暂停（为什么）、没开跑（为什么）；
- `<work_dir>/logs/train-*.log`、`datagen-*.log`：各步的原始输出；
- 手动查一次：`python3 sp-advisor/distill/idle.py --config <配置>`（闲 = 退出码 0，忙 = 1，并打印原因）。

### 怎么挂（**现在没挂，由秘书定**）
二选一：
- **cron**（每 30 分钟试一次）：
  ```
  */30 * * * * <仓库>/distill/idle-run.sh <配置.json> <venv>/bin/python >> <work_dir>/logs/cron.log 2>&1
  ```
- **systemd user timer**：把 `distill/systemd/sp-distill.service` 和 `.timer` 拷到 `~/.config/systemd/user/`，改掉里面的 `CHANGE-ME` 路径，然后
  `systemctl --user daemon-reload && systemctl --user enable --now sp-distill.timer`。停用：`systemctl --user disable --now sp-distill.timer`。

`idle-run.sh` 会把整个流程放进 `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0`（`DISTILL_MEMORY_MAX` 可改上限），CPU 权重调低、`nice 10`；同一个 `work_dir` 同时只会跑一份（锁文件）。忙的时候退出码 75 会被当成正常结束。

## 真正训练要多少
按冒烟实测（机器有别的活，负载 40–100）：
- 估胜模型当老师：约 19 秒一局（24 线程），每局约 11 个决策。`full.json` 第 0 轮 1000 局 ≈ 5–8 小时（16–24 线程）。
- 推演顾问当老师：一个决策 12–53 秒（16 线程，见 arkml 报告附录 A）。每轮 150 局 ≈ 1800 个决策 ≈ 15 小时；3 轮 ≈ 45 小时。
- 训练：MLP（83 万参数）在 4090 上几分钟（冒烟 600 步约 4 秒）。
- 评测 150 个种子：学生一步几毫秒，整轮约 30–40 分钟（单线程，主要是引擎模拟）。
- 合计：约 50 小时的空闲 CPU（16 线程），GPU 只要几分钟。分几个晚上跑完。

## 已知限制
- 站位不在动作表里，学生的站位照 guide；顾问的站位检查（`--lineup 1`）可以照样叠在学生上面评测。
- 选线头已经训练、会报准确率，但对局里还没用它改 p0 的线（p0 的线仍由 guide 分配，和现在评测完整顾问时一样）。
- 小 Transformer 只能在 Python 里训练；JS 评测只认 MLP，遇到 Transformer 会直接报错，不会悄悄换成别的。
- 冒烟的学生只见过约 300 个决策，在 10 个种子上一次都没偏离 guide，和 guide 打平。这是正常的，效果要等正式训练。
