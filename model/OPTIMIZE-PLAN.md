# OPTIMIZE-PLAN —— 第三轮单变量优化（通道 / 终端集中 / 破甲 / 奥术）

> 测量协议（POSTMORTEM §4，四选一不得违反）：
> 1. 主指标用连续量（R14 BOSS 掉血% / R13 团队 LP / 每回合漏怪），**不用二值胜负**。
> 2. **seeds < 20 不下结论**；每个 arm 单变量；同种子配对比较。
> 3. 每臂先跑「荒谬值」接线体检（开关=极端值必须改变输出），确认开关真的接上。
> 4. 样本不足（<20 或无位移）时**不改 params.json**，只记录方向。

已排除的上一轮结论：coop 四人同线「团队通道叠加」已被 `samples/round3-ch1.md` 证伪（20 seeds，掉血中位 4.40%→2.72%），原因是共享牌池争抢，不是通道本身。本轮只测 **solo 单座位**。

---

## 1. 单座位通道匹配（solo 法系 focus vs 默认四散）

- **假设**：solo ABYSS 下，把 bot 的核心盟约 focus 强制为法系核心盟约（`victoriaShip`，arts 占 60%），使盘面伤害类型匹配高防 BOSS 的低 RES（§1.5：高防 BOSS 上 arts `k≈0.97` vs 物理 `0.06~0.17`），R14 BOSS 掉血%中位数 ≥ 默认四散盘的 1.5×。coop 版因抢牌池证伪，solo 无共享牌池争抢，是未测的干净场景。
- **改哪个变量/公式**：`server/match/bot.js:415-419` `bondPlan().focus` → 用现成 env `SP_LAB_FOCUS=victoriaShip` 全局强制 focus。**无需 patch，单变量。**
- **验证命令**（`matchrun` 从 `D:\CodeProject\Stronghold-Protocol` 跑；读数脚本从 `D:\CodeProject` 跑）：
  ```powershell
  # A 对照（默认四散）
  Remove-Item Env:SP_LAB_FOCUS -ErrorAction SilentlyContinue
  node tools/matchrun.mjs --mode solo --difficulty ABYSS --seeds 20 --rehearsal 1 --lp 45 --json | Out-File -FilePath D:\CodeProject\advisor-dev\samples\ch2-1A-baseline.json -Encoding utf8
  # B 处理（法系 focus）
  $env:SP_LAB_FOCUS='victoriaShip'
  node tools/matchrun.mjs --mode solo --difficulty ABYSS --seeds 20 --rehearsal 1 --lp 45 --json | Out-File -FilePath D:\CodeProject\advisor-dev\samples\ch2-1B-victoria.json -Encoding utf8
  # 连续指标读数
  node advisor-dev/lab/bossarm.mjs 1A advisor-dev/samples/ch2-1A-baseline.json
  node advisor-dev/lab/bossarm.mjs 1B advisor-dev/samples/ch2-1B-victoria.json
  node advisor-dev/lab/paired.mjs 1A advisor-dev/samples/ch2-1A-baseline.json 1B advisor-dev/samples/ch2-1B-victoria.json
  node advisor-dev/lab/dose.mjs 维多利亚 advisor-dev/samples/ch2-1B-victoria.json   # 接线体检：focus 真投递
  ```
- **连续指标**：主 = `bossarm` 的 `dmg% (missing=0) median`（R14 BOSS 掉血%）；次 = `teamLP@R13 median`；漏怪 = json `rounds[].players[].leaks`（逐回合）。
- **seeds**：20（两臂同种子配对）。
- **成功阈值**：B 的 `dmg% 中位(missing=0)` ≥ 1.5× A，且 `paired.mjs` `B−A` 配对均值 ≥ +8 pp，且 `teamLP@R13` 中位下降 <30%。
- **失败后怎么改**：solo 也不升 → 接受 §1.5 口径警告「k 是相对排序、不决定绝对 DPS」，`mainChannel` argmax 单独不足以抬绝对 DPS；转向支撑通道（建议 3/4 精准/奥术）。**不改** `bosstable.json` 的 `bossPayoff`。

## 2. 终端集中（装备只喂 ATK 最高的主 C vs 按 pieceValue 撒）

- **假设**：装备从「按 `pieceValue` 撒给所有 dealer（每人≤2 件，最终铺到 ~8 个 dealer）」改成「全部优先给 ATK 最高的主 C（先满 2 件，再下一个）」能提高 R14 BOSS 掉血%。依据：`victoriaShip`「装备=伤害」（每件 +50% ATK），撒给非主 C 是稀释（§2.5）。
- **改哪个变量/公式**：`server/match/bot.js:1959-1965` `itemTarget()` 的 dealer 排序键，从 `byVal(deployed)`（`pieceValue` = power+items+armorFit）改为 `chessRec().stats.atk` 降序（纯最高 ATK 主 C 优先）。加开关 `SP_LAB_EQUIP_CARRY=1`（幂等 patch，默认 0 = 现状）。
- **验证命令**：
  ```powershell
  node tools/matchrun.mjs --mode solo --difficulty ABYSS --seeds 20 --rehearsal 1 --lp 45 --json | Out-File -FilePath D:\CodeProject\advisor-dev\samples\ch2-2A-baseline.json -Encoding utf8
  $env:SP_LAB_EQUIP_CARRY='1'
  node tools/matchrun.mjs --mode solo --difficulty ABYSS --seeds 20 --rehearsal 1 --lp 45 --json | Out-File -FilePath D:\CodeProject\advisor-dev\samples\ch2-2B-equipcarry.json -Encoding utf8
  node advisor-dev/lab/bossarm.mjs 2A advisor-dev/samples/ch2-2A-baseline.json
  node advisor-dev/lab/bossarm.mjs 2B advisor-dev/samples/ch2-2B-equipcarry.json
  node advisor-dev/lab/paired.mjs 2A advisor-dev/samples/ch2-2A-baseline.json 2B advisor-dev/samples/ch2-2B-equipcarry.json
  ```
  （接线体检：`SP_LAB_EQUIP_CARRY=99999` 荒谬值必须让输出剧变，否则先修接线。）
- **连续指标**：同建议 1（`dmg% missing=0 median` / `teamLP@R13 median` / `rounds[].players[].leaks`）。
- **seeds**：20。
- **成功阈值**：B 的 `dmg% 中位(missing=0)` ≥ 1.4× A，或 `paired` 均值 ≥ +5 pp，且 `teamLP@R13` 下降 <30%。
- **失败后怎么改**：说明 `equipPerChess=2` 的硬上限下「集中 vs 撒」不构成瓶颈 → 回滚开关，**不改** `routes/_matchup.json` 的 `equipBias`（那是 advisor 口径，不是 bot 口径）。

## 3. 精准3 破甲（钉 boss_6 半血 DEF 2060 测穿透收益）

- **假设**：3 名精准成员在场（30% DEF/RES 穿透）显著抬高 boss_6（半血 DEF 1030→2060、RES 20→65）的输出。解析 §1.2：精准3 把 RES 65→45.5（arts `k` 0.35→0.545，+56%）；但物理主 C 仍需 ATK>1518 才过线——从未端到端测过。
- **改哪个变量/公式**：`tools/balance.mjs` `planBoard()` 的 `chosen` 成员构成 → 加 `--preci3` 选项强制塞入 3 名精准成员（`preciShip` 非核心、默认不进场）；`lab/bossprobe.mjs` 透传该 flag。单变量 = 「3 精准在场 vs 无」，profile 恒定。
- **验证命令**（钉死 bossId，profile 恒定，只改 preci3）：
  ```powershell
  node advisor-dev/lab/bossprobe.mjs --boss boss_6 --profile 1.0,2.0 --samples 20 --lp 15 --json
  node advisor-dev/lab/bossprobe.mjs --boss boss_6 --profile 1.0,2.0 --samples 20 --lp 15 --preci3 --json
  ```
- **连续指标**：主 = `ratio150` 均值与 `ratio150Min`（150s 内打掉血池比例 = BOSS 掉血%，连续 0~1）；victory 仅作参考。R13 LP / 漏怪在 bossprobe 单场无此量，确认收益后接 `matchrun`（建议 1 口径）复验道中存活。
- **seeds**：20（每 boss 每 profile 20 样本）。
- **成功阈值**：同 profile 下 `--preci3` 的 `ratio150` 均值 ≥ 1.25× 无精准，且 `ratio150Min` 右移（尾部不再打不动）。
- **失败后怎么改**：若 preci3 对物理主 C 无效（§1.2：物理仍需 ATK>1518 才过线）→ 破甲必须「精准3 + 层数 ATK 乘区」组合，下一轮把 ATK 乘区当第二变量。**不改** `channels.preciDefPierce=0.3`（引擎系数）。

## 4. 奥术3 法伤乘区（钉高抗 BOSS 测 arcane3）

- **假设**：3 名奥术成员在场（`arcaneShip`：法伤承伤 ×(1.2+0.01L)，3 名档 目标 HP<50% 再 ×1.4）是法系最大乘区，显著抬高抗 BOSS（boss_2 RES60 / boss_3 RES50 / boss_6 半血 RES65）输出。§3.5：奥术层边际全表最陡。
- **改哪个变量/公式**：`tools/balance.mjs` `planBoard()` 加 `--arcane3`（强制 3 名奥术成员 / 奥术层）；`lab/bossprobe.mjs` 透传。
- **验证命令**：
  ```powershell
  node advisor-dev/lab/bossprobe.mjs --boss boss_2,boss_3,boss_6 --profile 1.0,2.0 --samples 20 --lp 15 --json
  node advisor-dev/lab/bossprobe.mjs --boss boss_2,boss_3,boss_6 --profile 1.0,2.0 --samples 20 --lp 15 --arcane3 --json
  ```
- **连续指标**：`ratio150` 均值 / `ratio150Min`（BOSS 掉血%，连续）。
- **seeds**：20（每 boss 每 profile）。
- **成功阈值**：同 profile 同 boss 下 `--arcane3` 的 `ratio150` 均值 ≥ 1.3× 无奥术。
- **失败后怎么改**：若增益 <1.3× → 反解校准 `u_arts`（技能覆盖率，§2.3：`u = ratio150_measured / ratio150_model`），**不改** `channels.arcaneMagicTakenBase/PerLayer/LowHpScale`（引擎系数）。

---

## 顺序与最大杠杆

- 执行顺序：**1 → 3 → 4 → 2**（先证「通道」这一决定项，再证两个支撑通道，最后证装备分配）。
- **最大杠杆 = 建议 1（通道匹配）**：§1.5 的 k 矩阵在高防 BOSS 上是 16× 的相对差距（法系 0.97 vs 物理 0.06），是「盘面追平却杀不掉 BOSS」的唯一机制解；其余三项是它的乘区/补充。


---

## 执行记录（2026-10-18）

- **建议 1（通道匹配）已执行并否决**：coop 版 `SP_LAB_FOCUS_BY_SEAT=victoriaShip×4`，20 seeds，BOSS 掉血% 中位 4.40%→2.72%（0.62×），配对 −6.5pp；
  solo 版 `SP_LAB_FOCUS=victoriaShip`，20 seeds，中位 19.63%→7.96%，配对 −1.92pp。两向皆负。
  **结论：通道匹配不是杠杆，模型中心假设需改写。**
- 剩余候选按原优先级顺延：建议 2（终端集中）→ 建议 3（精准 3 破甲）→ 建议 4（奥术 3 法伤乘区）。
  注意建议 2 需要先在 `bot.js:1959-1965` 增加 `SP_LAB_EQUIP_CARRY`（默认 0 = 现状）。
- 新增可用基线：solo ABYSS 的 bot 在 R14 平均打掉 BOSS 约 20% 血（中位 19.63%），需求差距约 5 倍。


- **建议 2（终端集中）已执行并否决**：`SP_LAB_EQUIP_CARRY=1`（新增，默认 0），solo 20 seeds，
  BOSS 掉血% 中位 19.63%→17.15%，配对 −2.13pp；但 R13 存活 LP 14→19。收益落在存活，不在输出。
- 两个"显然杠杆"（通道匹配、终端集中）双向否证 → 下一步改为**诊断优先**（`lab/inspect.mjs` 找分叉量），
  并用 `bossprobe --preci3/--arcane3` 做与策略解耦的乘区测量。
