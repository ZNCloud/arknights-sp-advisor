# 用户历史样本分析（`sp.match-history.v1`）+ 一条被算术否定的假设

## 1. 数据来源与可用字段

客户端 localStorage `sp.match-history.v1` 保存每局结果，**每个玩家带 `stats`**：

```json
{"dmgDealt":14630297,"kills":357,"leaks":12,"gold":176,"refreshes":44,
 "merges":9,"itemsEquipped":44,"bossDamage":6583673,"activatedLayers":533,
 "lpLost":0,"perfectRounds":11}
```

这比 lineup 信息量大得多：`bossDamage` 可以直接当输出终端的验证指标，`leaks/lpLost` 是生存指标，
`refreshes/merges/itemsEquipped` 是操作量与决策质量的代理指标。

## 2. 两局实测（同一批 4 位玩家）

### 22:11（victory=true）

| seat | 玩家 | band | dmgDealt | bossDamage | kills | leaks | LP |
|---|---|---|---|---|---|---|---|
| **2** | 大漏特漏 | `band_chiave` | **26.47M** | **15.65M** | 440 | 34 | 12 |
| 0 | 问了吗 | `band_jesica` | 20.21M | 14.33M | 385 | **87** | 8 |
| 3 | mmfish#6111 | `band_clementia` | 16.22M | 5.23M | **468** | 53 | 12 |
| 1 | Cloud（用户） | `band_damaztic` | 15.59M | 9.58M | 392 | 52 | **15** |

### 22:59（victory=false，全灭）

| seat | 玩家 | band | dmgDealt | bossDamage | leaks | 备注 |
|---|---|---|---|---|---|---|
| 0 | 问了吗 | `band_jesica` | 14.63M | 6.58M | 12 | |
| 1 | Cloud | `band_qalaisa` | 7.93M | 1.66M | 7 | |
| 2 | 大漏特漏 | `band_duyaoy` | 5.56M | 0.40M | 27 | |
| 3 | mmfish#6111 | `band_clementia` | 2.10M | **0** | **101** | 终局阵容 0 人 |

## 3. 三条可用的观察

1. **bossDamage 与 leaks 不相关**：漏怪 87 / 34 / 52 / 53 对应的 BOSS 伤害是 14.33 / 15.65 / 9.58 / 5.23M。
   「少漏怪」不是拿 BOSS 伤害的充分条件，模型里把 LP 当硬约束、把漏怪一律当失分是过度惩罚。
2. **续航位是条件策略**：同一个 mmfish 用同一套「阿戈尔+克莱门莎」，第一局 16.22M / boss 5.23M / 通关，
   第二局 2.10M / boss 0 / 漏 101 / 全灭。队友有输出时他是补位，队友打不出来时他连自己都保不住。
3. **策略（band）与输出的关系不稳定**：输出最高的两局分别来自 `band_chiave` 与 `band_jesica`，
   都是「非主流输出策略」，说明**策略不是决定项，盘面构成才是**。

## 4. 一条被我自己的算术否定的假设（记录在此，避免重复）

**假设**：叙拉古靠「每击 3% 概率造成 5000+50L 固定值伤害」绕过硬甲，因此实测打出 15.65M BOSS 伤害，
模型应该给 k 矩阵加一条 `fixed` 通道。

**算术检查**（`data/bonds.json` siracusaShip 的 bb：`prob=0.03, base_damage=5000, damage_per_stack=50,
base_attack_speed=25+0.8L`）：

| 层数 L | 攻速 | 每次 proc | 固定值 DPS | 165s 窗口总伤害 |
|---|---|---|---|---|
| 60 | ×1.73 | 8000 | 415 | 0.07M |
| 100 | ×2.05 | 10000 | 615 | 0.10M |
| 150 | ×2.45 | 12500 | 919 | 0.15M |

而 boss_3 的需求 DPS ≈ 24k，实测 BOSS 伤害 15.65M。**固定值 proc 最多贡献 0.15M，差两个数量级。**

**结论**：`fixed` 通道**不是**解释该局的机制，不该加进 k 矩阵（至少不该按这个量级加）。
下一步要解释这 15.65M，得看真正的伤害构成（物理/法系面板叠加、目标的 DEF/RES 是否被其它效果削减、
以及 6 人档与装备加成后的实际 ATK），而不是猜一个通道。

## 5. 对模型的净修正（只保留有数据支持的）

- `bossDamage` 应作为**主验证指标**纳入采样脚本（现在 `lab/bossarm.mjs` 用的是 BOSS 掉血%，两者都在用，需统一口径）
- LP/漏怪的定价要放宽：`lpr=2` 的对局里，前期漏怪是可以用输出透支的（只有 `lpr=30` 的 boss_5 例外）
- `roleOf` 的续航位判定必须加「队友输出是否足够」的条件，否则会把人骗进一个注定崩的位

---
原始数据：本机客户端 localStorage；采样脚本：`advisor-dev/lab/bossarm.mjs`（掉血%）与本次新增的 stats 口径
