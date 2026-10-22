# 学生网络的输入（FEATURE_VERSION 1，1343 维）

本文件由 `node distill/features-doc.mjs` 生成，改了 `distill/features.mjs` 或 `advisor/features-table.mjs` 就重新生成。

## 分块

| 维度 | 块 | 说明 |
|---|---|---|
| 0–1163 | 自己 | `advisor/features-table.mjs` 的 tableSelf：回合、经济、当前 BOSS 属性；场上 10 格、手牌 6 格（都按强度从高到低排）、商店 5 格，每格一组干员属性；每条盟约 6 个数 |
| 1164–1183 | BOSS 是谁 | R14 BOSS 独热 10 维 + 隐藏 BOSS 独热 10 维（R15 揭晓前全 0，和顾问推演的约定一样） |
| 1184–1342 | 三个队友 | 按座位顺序的下家 1、2、3，**只用公开视图**（m.publicView().players，真人客户端也看得到的）：每人 7 个数 + 每条盟约（23 条）的在场人数和层数。不含队友的钱、手牌、商店 |

干员属性只用数值（阶、攻防血、射程……），不用干员编号，所以游戏数值改了输入会跟着变。

## 每一维

| # | 名字 | 含义 |
|---|---|---|
| 0 | `round` | 当前回合 |
| 1 | `roundsToBoss` | 离 BOSS 回合（R14）还有几回合 |
| 2 | `lp` | 自己的血（LP） |
| 3 | `funds` | 自己的钱 |
| 4 | `level` | 商店（调度中心）等级 |
| 5 | `upgradePrice` | 升下一级要多少钱 |
| 6 | `refreshPrice` | 刷新一次多少钱 |
| 7 | `freeRefreshes` | 剩余免费刷新次数 |
| 8 | `deployCap` | 能上场几个 |
| 9 | `teamLp` | 队伍共享 LP |
| 10 | `aliveN` | 还活着的人数 |
| 11 | `hiddenLayerSum` | 隐藏 BOSS 用的全队层数累计 |
| 12 | `creditedKills` | 自己的击杀数 |
| 13 | `boss.hp` | 本回合 BOSS（R15 起是隐藏 BOSS）最大血量 |
| 14 | `boss.atk` | BOSS 攻击 |
| 15 | `boss.def` | BOSS 防御 |
| 16 | `boss.res` | BOSS 法抗 |
| 17 | `shopFrozen` | 商店是否冻结（1/0） |
| 18 | `board0.present` | 场上第1强：这个格子有没有干员（1/0） |
| 19 | `board0.tier` | 场上第1强：阶（费用档） |
| 20 | `board0.golden` | 场上第1强：是否精锐（合成过） |
| 21 | `board0.price` | 场上第1强：原价 |
| 22 | `board0.atk` | 场上第1强：攻击 |
| 23 | `board0.def` | 场上第1强：防御 |
| 24 | `board0.hp` | 场上第1强：最大血量 |
| 25 | `board0.res` | 场上第1强：法抗 |
| 26 | `board0.bat` | 场上第1强：攻击间隔 |
| 27 | `board0.aspd` | 场上第1强：攻速 |
| 28 | `board0.range` | 场上第1强：攻击范围格数 |
| 29 | `board0.block` | 场上第1强：阻挡数 |
| 30 | `board0.fly` | 场上第1强：能否打飞行（1/0） |
| 31 | `board0.ranged` | 场上第1强：远程位（1/0） |
| 32 | `board0.dmg_phys` | 场上第1强：物理伤害（1/0） |
| 33 | `board0.dmg_arts` | 场上第1强：法术伤害（1/0） |
| 34 | `board0.dmg_heal` | 场上第1强：治疗（1/0） |
| 35 | `board0.skillAtk` | 场上第1强：技能攻击倍率 |
| 36 | `board0.skillTimes` | 场上第1强：技能连击次数 |
| 37 | `board0.skillSp` | 场上第1强：技能费用（SP） |
| 38 | `board0.row` | 场上第1强：站位行（场上才有） |
| 39 | `board0.col` | 场上第1强：站位列 |
| 40 | `board0.items` | 场上第1强：装备件数 |
| 41 | `board0.itemTier` | 场上第1强：装备阶之和 |
| 42 | `board0.copies` | 场上第1强：自己一共有几张同名（含精锐） |
| 43 | `board0.b_yanShip` | 场上第1强：属于盟约 yanShip（1/0） |
| 44 | `board0.b_sargonShip` | 场上第1强：属于盟约 sargonShip（1/0） |
| 45 | `board0.b_victoriaShip` | 场上第1强：属于盟约 victoriaShip（1/0） |
| 46 | `board0.b_kjeragShip` | 场上第1强：属于盟约 kjeragShip（1/0） |
| 47 | `board0.b_lateranoShip` | 场上第1强：属于盟约 lateranoShip（1/0） |
| 48 | `board0.b_egirShip` | 场上第1强：属于盟约 egirShip（1/0） |
| 49 | `board0.b_siracusaShip` | 场上第1强：属于盟约 siracusaShip（1/0） |
| 50 | `board0.b_kazimierzShip` | 场上第1强：属于盟约 kazimierzShip（1/0） |
| 51 | `board0.b_preciShip` | 场上第1强：属于盟约 preciShip（1/0） |
| 52 | `board0.b_swiftShip` | 场上第1强：属于盟约 swiftShip（1/0） |
| 53 | `board0.b_skillfulShip` | 场上第1强：属于盟约 skillfulShip（1/0） |
| 54 | `board0.b_arcaneShip` | 场上第1强：属于盟约 arcaneShip（1/0） |
| 55 | `board0.b_steadShip` | 场上第1强：属于盟约 steadShip（1/0） |
| 56 | `board0.b_deputShip` | 场上第1强：属于盟约 deputShip（1/0） |
| 57 | `board0.b_visiShip` | 场上第1强：属于盟约 visiShip（1/0） |
| 58 | `board0.b_miraShip` | 场上第1强：属于盟约 miraShip（1/0） |
| 59 | `board0.b_investShip` | 场上第1强：属于盟约 investShip（1/0） |
| 60 | `board0.b_raidShip` | 场上第1强：属于盟约 raidShip（1/0） |
| 61 | `board0.b_indomShip` | 场上第1强：属于盟约 indomShip（1/0） |
| 62 | `board0.b_maniShip` | 场上第1强：属于盟约 maniShip（1/0） |
| 63 | `board0.b_emptyShip` | 场上第1强：属于盟约 emptyShip（1/0） |
| 64 | `board0.b_soloShip` | 场上第1强：属于盟约 soloShip（1/0） |
| 65 | `board0.b_suntShip` | 场上第1强：属于盟约 suntShip（1/0） |
| 66 | `board1.present` | 场上第2强：这个格子有没有干员（1/0） |
| 67 | `board1.tier` | 场上第2强：阶（费用档） |
| 68 | `board1.golden` | 场上第2强：是否精锐（合成过） |
| 69 | `board1.price` | 场上第2强：原价 |
| 70 | `board1.atk` | 场上第2强：攻击 |
| 71 | `board1.def` | 场上第2强：防御 |
| 72 | `board1.hp` | 场上第2强：最大血量 |
| 73 | `board1.res` | 场上第2强：法抗 |
| 74 | `board1.bat` | 场上第2强：攻击间隔 |
| 75 | `board1.aspd` | 场上第2强：攻速 |
| 76 | `board1.range` | 场上第2强：攻击范围格数 |
| 77 | `board1.block` | 场上第2强：阻挡数 |
| 78 | `board1.fly` | 场上第2强：能否打飞行（1/0） |
| 79 | `board1.ranged` | 场上第2强：远程位（1/0） |
| 80 | `board1.dmg_phys` | 场上第2强：物理伤害（1/0） |
| 81 | `board1.dmg_arts` | 场上第2强：法术伤害（1/0） |
| 82 | `board1.dmg_heal` | 场上第2强：治疗（1/0） |
| 83 | `board1.skillAtk` | 场上第2强：技能攻击倍率 |
| 84 | `board1.skillTimes` | 场上第2强：技能连击次数 |
| 85 | `board1.skillSp` | 场上第2强：技能费用（SP） |
| 86 | `board1.row` | 场上第2强：站位行（场上才有） |
| 87 | `board1.col` | 场上第2强：站位列 |
| 88 | `board1.items` | 场上第2强：装备件数 |
| 89 | `board1.itemTier` | 场上第2强：装备阶之和 |
| 90 | `board1.copies` | 场上第2强：自己一共有几张同名（含精锐） |
| 91 | `board1.b_yanShip` | 场上第2强：属于盟约 yanShip（1/0） |
| 92 | `board1.b_sargonShip` | 场上第2强：属于盟约 sargonShip（1/0） |
| 93 | `board1.b_victoriaShip` | 场上第2强：属于盟约 victoriaShip（1/0） |
| 94 | `board1.b_kjeragShip` | 场上第2强：属于盟约 kjeragShip（1/0） |
| 95 | `board1.b_lateranoShip` | 场上第2强：属于盟约 lateranoShip（1/0） |
| 96 | `board1.b_egirShip` | 场上第2强：属于盟约 egirShip（1/0） |
| 97 | `board1.b_siracusaShip` | 场上第2强：属于盟约 siracusaShip（1/0） |
| 98 | `board1.b_kazimierzShip` | 场上第2强：属于盟约 kazimierzShip（1/0） |
| 99 | `board1.b_preciShip` | 场上第2强：属于盟约 preciShip（1/0） |
| 100 | `board1.b_swiftShip` | 场上第2强：属于盟约 swiftShip（1/0） |
| 101 | `board1.b_skillfulShip` | 场上第2强：属于盟约 skillfulShip（1/0） |
| 102 | `board1.b_arcaneShip` | 场上第2强：属于盟约 arcaneShip（1/0） |
| 103 | `board1.b_steadShip` | 场上第2强：属于盟约 steadShip（1/0） |
| 104 | `board1.b_deputShip` | 场上第2强：属于盟约 deputShip（1/0） |
| 105 | `board1.b_visiShip` | 场上第2强：属于盟约 visiShip（1/0） |
| 106 | `board1.b_miraShip` | 场上第2强：属于盟约 miraShip（1/0） |
| 107 | `board1.b_investShip` | 场上第2强：属于盟约 investShip（1/0） |
| 108 | `board1.b_raidShip` | 场上第2强：属于盟约 raidShip（1/0） |
| 109 | `board1.b_indomShip` | 场上第2强：属于盟约 indomShip（1/0） |
| 110 | `board1.b_maniShip` | 场上第2强：属于盟约 maniShip（1/0） |
| 111 | `board1.b_emptyShip` | 场上第2强：属于盟约 emptyShip（1/0） |
| 112 | `board1.b_soloShip` | 场上第2强：属于盟约 soloShip（1/0） |
| 113 | `board1.b_suntShip` | 场上第2强：属于盟约 suntShip（1/0） |
| 114 | `board2.present` | 场上第3强：这个格子有没有干员（1/0） |
| 115 | `board2.tier` | 场上第3强：阶（费用档） |
| 116 | `board2.golden` | 场上第3强：是否精锐（合成过） |
| 117 | `board2.price` | 场上第3强：原价 |
| 118 | `board2.atk` | 场上第3强：攻击 |
| 119 | `board2.def` | 场上第3强：防御 |
| 120 | `board2.hp` | 场上第3强：最大血量 |
| 121 | `board2.res` | 场上第3强：法抗 |
| 122 | `board2.bat` | 场上第3强：攻击间隔 |
| 123 | `board2.aspd` | 场上第3强：攻速 |
| 124 | `board2.range` | 场上第3强：攻击范围格数 |
| 125 | `board2.block` | 场上第3强：阻挡数 |
| 126 | `board2.fly` | 场上第3强：能否打飞行（1/0） |
| 127 | `board2.ranged` | 场上第3强：远程位（1/0） |
| 128 | `board2.dmg_phys` | 场上第3强：物理伤害（1/0） |
| 129 | `board2.dmg_arts` | 场上第3强：法术伤害（1/0） |
| 130 | `board2.dmg_heal` | 场上第3强：治疗（1/0） |
| 131 | `board2.skillAtk` | 场上第3强：技能攻击倍率 |
| 132 | `board2.skillTimes` | 场上第3强：技能连击次数 |
| 133 | `board2.skillSp` | 场上第3强：技能费用（SP） |
| 134 | `board2.row` | 场上第3强：站位行（场上才有） |
| 135 | `board2.col` | 场上第3强：站位列 |
| 136 | `board2.items` | 场上第3强：装备件数 |
| 137 | `board2.itemTier` | 场上第3强：装备阶之和 |
| 138 | `board2.copies` | 场上第3强：自己一共有几张同名（含精锐） |
| 139 | `board2.b_yanShip` | 场上第3强：属于盟约 yanShip（1/0） |
| 140 | `board2.b_sargonShip` | 场上第3强：属于盟约 sargonShip（1/0） |
| 141 | `board2.b_victoriaShip` | 场上第3强：属于盟约 victoriaShip（1/0） |
| 142 | `board2.b_kjeragShip` | 场上第3强：属于盟约 kjeragShip（1/0） |
| 143 | `board2.b_lateranoShip` | 场上第3强：属于盟约 lateranoShip（1/0） |
| 144 | `board2.b_egirShip` | 场上第3强：属于盟约 egirShip（1/0） |
| 145 | `board2.b_siracusaShip` | 场上第3强：属于盟约 siracusaShip（1/0） |
| 146 | `board2.b_kazimierzShip` | 场上第3强：属于盟约 kazimierzShip（1/0） |
| 147 | `board2.b_preciShip` | 场上第3强：属于盟约 preciShip（1/0） |
| 148 | `board2.b_swiftShip` | 场上第3强：属于盟约 swiftShip（1/0） |
| 149 | `board2.b_skillfulShip` | 场上第3强：属于盟约 skillfulShip（1/0） |
| 150 | `board2.b_arcaneShip` | 场上第3强：属于盟约 arcaneShip（1/0） |
| 151 | `board2.b_steadShip` | 场上第3强：属于盟约 steadShip（1/0） |
| 152 | `board2.b_deputShip` | 场上第3强：属于盟约 deputShip（1/0） |
| 153 | `board2.b_visiShip` | 场上第3强：属于盟约 visiShip（1/0） |
| 154 | `board2.b_miraShip` | 场上第3强：属于盟约 miraShip（1/0） |
| 155 | `board2.b_investShip` | 场上第3强：属于盟约 investShip（1/0） |
| 156 | `board2.b_raidShip` | 场上第3强：属于盟约 raidShip（1/0） |
| 157 | `board2.b_indomShip` | 场上第3强：属于盟约 indomShip（1/0） |
| 158 | `board2.b_maniShip` | 场上第3强：属于盟约 maniShip（1/0） |
| 159 | `board2.b_emptyShip` | 场上第3强：属于盟约 emptyShip（1/0） |
| 160 | `board2.b_soloShip` | 场上第3强：属于盟约 soloShip（1/0） |
| 161 | `board2.b_suntShip` | 场上第3强：属于盟约 suntShip（1/0） |
| 162 | `board3.present` | 场上第4强：这个格子有没有干员（1/0） |
| 163 | `board3.tier` | 场上第4强：阶（费用档） |
| 164 | `board3.golden` | 场上第4强：是否精锐（合成过） |
| 165 | `board3.price` | 场上第4强：原价 |
| 166 | `board3.atk` | 场上第4强：攻击 |
| 167 | `board3.def` | 场上第4强：防御 |
| 168 | `board3.hp` | 场上第4强：最大血量 |
| 169 | `board3.res` | 场上第4强：法抗 |
| 170 | `board3.bat` | 场上第4强：攻击间隔 |
| 171 | `board3.aspd` | 场上第4强：攻速 |
| 172 | `board3.range` | 场上第4强：攻击范围格数 |
| 173 | `board3.block` | 场上第4强：阻挡数 |
| 174 | `board3.fly` | 场上第4强：能否打飞行（1/0） |
| 175 | `board3.ranged` | 场上第4强：远程位（1/0） |
| 176 | `board3.dmg_phys` | 场上第4强：物理伤害（1/0） |
| 177 | `board3.dmg_arts` | 场上第4强：法术伤害（1/0） |
| 178 | `board3.dmg_heal` | 场上第4强：治疗（1/0） |
| 179 | `board3.skillAtk` | 场上第4强：技能攻击倍率 |
| 180 | `board3.skillTimes` | 场上第4强：技能连击次数 |
| 181 | `board3.skillSp` | 场上第4强：技能费用（SP） |
| 182 | `board3.row` | 场上第4强：站位行（场上才有） |
| 183 | `board3.col` | 场上第4强：站位列 |
| 184 | `board3.items` | 场上第4强：装备件数 |
| 185 | `board3.itemTier` | 场上第4强：装备阶之和 |
| 186 | `board3.copies` | 场上第4强：自己一共有几张同名（含精锐） |
| 187 | `board3.b_yanShip` | 场上第4强：属于盟约 yanShip（1/0） |
| 188 | `board3.b_sargonShip` | 场上第4强：属于盟约 sargonShip（1/0） |
| 189 | `board3.b_victoriaShip` | 场上第4强：属于盟约 victoriaShip（1/0） |
| 190 | `board3.b_kjeragShip` | 场上第4强：属于盟约 kjeragShip（1/0） |
| 191 | `board3.b_lateranoShip` | 场上第4强：属于盟约 lateranoShip（1/0） |
| 192 | `board3.b_egirShip` | 场上第4强：属于盟约 egirShip（1/0） |
| 193 | `board3.b_siracusaShip` | 场上第4强：属于盟约 siracusaShip（1/0） |
| 194 | `board3.b_kazimierzShip` | 场上第4强：属于盟约 kazimierzShip（1/0） |
| 195 | `board3.b_preciShip` | 场上第4强：属于盟约 preciShip（1/0） |
| 196 | `board3.b_swiftShip` | 场上第4强：属于盟约 swiftShip（1/0） |
| 197 | `board3.b_skillfulShip` | 场上第4强：属于盟约 skillfulShip（1/0） |
| 198 | `board3.b_arcaneShip` | 场上第4强：属于盟约 arcaneShip（1/0） |
| 199 | `board3.b_steadShip` | 场上第4强：属于盟约 steadShip（1/0） |
| 200 | `board3.b_deputShip` | 场上第4强：属于盟约 deputShip（1/0） |
| 201 | `board3.b_visiShip` | 场上第4强：属于盟约 visiShip（1/0） |
| 202 | `board3.b_miraShip` | 场上第4强：属于盟约 miraShip（1/0） |
| 203 | `board3.b_investShip` | 场上第4强：属于盟约 investShip（1/0） |
| 204 | `board3.b_raidShip` | 场上第4强：属于盟约 raidShip（1/0） |
| 205 | `board3.b_indomShip` | 场上第4强：属于盟约 indomShip（1/0） |
| 206 | `board3.b_maniShip` | 场上第4强：属于盟约 maniShip（1/0） |
| 207 | `board3.b_emptyShip` | 场上第4强：属于盟约 emptyShip（1/0） |
| 208 | `board3.b_soloShip` | 场上第4强：属于盟约 soloShip（1/0） |
| 209 | `board3.b_suntShip` | 场上第4强：属于盟约 suntShip（1/0） |
| 210 | `board4.present` | 场上第5强：这个格子有没有干员（1/0） |
| 211 | `board4.tier` | 场上第5强：阶（费用档） |
| 212 | `board4.golden` | 场上第5强：是否精锐（合成过） |
| 213 | `board4.price` | 场上第5强：原价 |
| 214 | `board4.atk` | 场上第5强：攻击 |
| 215 | `board4.def` | 场上第5强：防御 |
| 216 | `board4.hp` | 场上第5强：最大血量 |
| 217 | `board4.res` | 场上第5强：法抗 |
| 218 | `board4.bat` | 场上第5强：攻击间隔 |
| 219 | `board4.aspd` | 场上第5强：攻速 |
| 220 | `board4.range` | 场上第5强：攻击范围格数 |
| 221 | `board4.block` | 场上第5强：阻挡数 |
| 222 | `board4.fly` | 场上第5强：能否打飞行（1/0） |
| 223 | `board4.ranged` | 场上第5强：远程位（1/0） |
| 224 | `board4.dmg_phys` | 场上第5强：物理伤害（1/0） |
| 225 | `board4.dmg_arts` | 场上第5强：法术伤害（1/0） |
| 226 | `board4.dmg_heal` | 场上第5强：治疗（1/0） |
| 227 | `board4.skillAtk` | 场上第5强：技能攻击倍率 |
| 228 | `board4.skillTimes` | 场上第5强：技能连击次数 |
| 229 | `board4.skillSp` | 场上第5强：技能费用（SP） |
| 230 | `board4.row` | 场上第5强：站位行（场上才有） |
| 231 | `board4.col` | 场上第5强：站位列 |
| 232 | `board4.items` | 场上第5强：装备件数 |
| 233 | `board4.itemTier` | 场上第5强：装备阶之和 |
| 234 | `board4.copies` | 场上第5强：自己一共有几张同名（含精锐） |
| 235 | `board4.b_yanShip` | 场上第5强：属于盟约 yanShip（1/0） |
| 236 | `board4.b_sargonShip` | 场上第5强：属于盟约 sargonShip（1/0） |
| 237 | `board4.b_victoriaShip` | 场上第5强：属于盟约 victoriaShip（1/0） |
| 238 | `board4.b_kjeragShip` | 场上第5强：属于盟约 kjeragShip（1/0） |
| 239 | `board4.b_lateranoShip` | 场上第5强：属于盟约 lateranoShip（1/0） |
| 240 | `board4.b_egirShip` | 场上第5强：属于盟约 egirShip（1/0） |
| 241 | `board4.b_siracusaShip` | 场上第5强：属于盟约 siracusaShip（1/0） |
| 242 | `board4.b_kazimierzShip` | 场上第5强：属于盟约 kazimierzShip（1/0） |
| 243 | `board4.b_preciShip` | 场上第5强：属于盟约 preciShip（1/0） |
| 244 | `board4.b_swiftShip` | 场上第5强：属于盟约 swiftShip（1/0） |
| 245 | `board4.b_skillfulShip` | 场上第5强：属于盟约 skillfulShip（1/0） |
| 246 | `board4.b_arcaneShip` | 场上第5强：属于盟约 arcaneShip（1/0） |
| 247 | `board4.b_steadShip` | 场上第5强：属于盟约 steadShip（1/0） |
| 248 | `board4.b_deputShip` | 场上第5强：属于盟约 deputShip（1/0） |
| 249 | `board4.b_visiShip` | 场上第5强：属于盟约 visiShip（1/0） |
| 250 | `board4.b_miraShip` | 场上第5强：属于盟约 miraShip（1/0） |
| 251 | `board4.b_investShip` | 场上第5强：属于盟约 investShip（1/0） |
| 252 | `board4.b_raidShip` | 场上第5强：属于盟约 raidShip（1/0） |
| 253 | `board4.b_indomShip` | 场上第5强：属于盟约 indomShip（1/0） |
| 254 | `board4.b_maniShip` | 场上第5强：属于盟约 maniShip（1/0） |
| 255 | `board4.b_emptyShip` | 场上第5强：属于盟约 emptyShip（1/0） |
| 256 | `board4.b_soloShip` | 场上第5强：属于盟约 soloShip（1/0） |
| 257 | `board4.b_suntShip` | 场上第5强：属于盟约 suntShip（1/0） |
| 258 | `board5.present` | 场上第6强：这个格子有没有干员（1/0） |
| 259 | `board5.tier` | 场上第6强：阶（费用档） |
| 260 | `board5.golden` | 场上第6强：是否精锐（合成过） |
| 261 | `board5.price` | 场上第6强：原价 |
| 262 | `board5.atk` | 场上第6强：攻击 |
| 263 | `board5.def` | 场上第6强：防御 |
| 264 | `board5.hp` | 场上第6强：最大血量 |
| 265 | `board5.res` | 场上第6强：法抗 |
| 266 | `board5.bat` | 场上第6强：攻击间隔 |
| 267 | `board5.aspd` | 场上第6强：攻速 |
| 268 | `board5.range` | 场上第6强：攻击范围格数 |
| 269 | `board5.block` | 场上第6强：阻挡数 |
| 270 | `board5.fly` | 场上第6强：能否打飞行（1/0） |
| 271 | `board5.ranged` | 场上第6强：远程位（1/0） |
| 272 | `board5.dmg_phys` | 场上第6强：物理伤害（1/0） |
| 273 | `board5.dmg_arts` | 场上第6强：法术伤害（1/0） |
| 274 | `board5.dmg_heal` | 场上第6强：治疗（1/0） |
| 275 | `board5.skillAtk` | 场上第6强：技能攻击倍率 |
| 276 | `board5.skillTimes` | 场上第6强：技能连击次数 |
| 277 | `board5.skillSp` | 场上第6强：技能费用（SP） |
| 278 | `board5.row` | 场上第6强：站位行（场上才有） |
| 279 | `board5.col` | 场上第6强：站位列 |
| 280 | `board5.items` | 场上第6强：装备件数 |
| 281 | `board5.itemTier` | 场上第6强：装备阶之和 |
| 282 | `board5.copies` | 场上第6强：自己一共有几张同名（含精锐） |
| 283 | `board5.b_yanShip` | 场上第6强：属于盟约 yanShip（1/0） |
| 284 | `board5.b_sargonShip` | 场上第6强：属于盟约 sargonShip（1/0） |
| 285 | `board5.b_victoriaShip` | 场上第6强：属于盟约 victoriaShip（1/0） |
| 286 | `board5.b_kjeragShip` | 场上第6强：属于盟约 kjeragShip（1/0） |
| 287 | `board5.b_lateranoShip` | 场上第6强：属于盟约 lateranoShip（1/0） |
| 288 | `board5.b_egirShip` | 场上第6强：属于盟约 egirShip（1/0） |
| 289 | `board5.b_siracusaShip` | 场上第6强：属于盟约 siracusaShip（1/0） |
| 290 | `board5.b_kazimierzShip` | 场上第6强：属于盟约 kazimierzShip（1/0） |
| 291 | `board5.b_preciShip` | 场上第6强：属于盟约 preciShip（1/0） |
| 292 | `board5.b_swiftShip` | 场上第6强：属于盟约 swiftShip（1/0） |
| 293 | `board5.b_skillfulShip` | 场上第6强：属于盟约 skillfulShip（1/0） |
| 294 | `board5.b_arcaneShip` | 场上第6强：属于盟约 arcaneShip（1/0） |
| 295 | `board5.b_steadShip` | 场上第6强：属于盟约 steadShip（1/0） |
| 296 | `board5.b_deputShip` | 场上第6强：属于盟约 deputShip（1/0） |
| 297 | `board5.b_visiShip` | 场上第6强：属于盟约 visiShip（1/0） |
| 298 | `board5.b_miraShip` | 场上第6强：属于盟约 miraShip（1/0） |
| 299 | `board5.b_investShip` | 场上第6强：属于盟约 investShip（1/0） |
| 300 | `board5.b_raidShip` | 场上第6强：属于盟约 raidShip（1/0） |
| 301 | `board5.b_indomShip` | 场上第6强：属于盟约 indomShip（1/0） |
| 302 | `board5.b_maniShip` | 场上第6强：属于盟约 maniShip（1/0） |
| 303 | `board5.b_emptyShip` | 场上第6强：属于盟约 emptyShip（1/0） |
| 304 | `board5.b_soloShip` | 场上第6强：属于盟约 soloShip（1/0） |
| 305 | `board5.b_suntShip` | 场上第6强：属于盟约 suntShip（1/0） |
| 306 | `board6.present` | 场上第7强：这个格子有没有干员（1/0） |
| 307 | `board6.tier` | 场上第7强：阶（费用档） |
| 308 | `board6.golden` | 场上第7强：是否精锐（合成过） |
| 309 | `board6.price` | 场上第7强：原价 |
| 310 | `board6.atk` | 场上第7强：攻击 |
| 311 | `board6.def` | 场上第7强：防御 |
| 312 | `board6.hp` | 场上第7强：最大血量 |
| 313 | `board6.res` | 场上第7强：法抗 |
| 314 | `board6.bat` | 场上第7强：攻击间隔 |
| 315 | `board6.aspd` | 场上第7强：攻速 |
| 316 | `board6.range` | 场上第7强：攻击范围格数 |
| 317 | `board6.block` | 场上第7强：阻挡数 |
| 318 | `board6.fly` | 场上第7强：能否打飞行（1/0） |
| 319 | `board6.ranged` | 场上第7强：远程位（1/0） |
| 320 | `board6.dmg_phys` | 场上第7强：物理伤害（1/0） |
| 321 | `board6.dmg_arts` | 场上第7强：法术伤害（1/0） |
| 322 | `board6.dmg_heal` | 场上第7强：治疗（1/0） |
| 323 | `board6.skillAtk` | 场上第7强：技能攻击倍率 |
| 324 | `board6.skillTimes` | 场上第7强：技能连击次数 |
| 325 | `board6.skillSp` | 场上第7强：技能费用（SP） |
| 326 | `board6.row` | 场上第7强：站位行（场上才有） |
| 327 | `board6.col` | 场上第7强：站位列 |
| 328 | `board6.items` | 场上第7强：装备件数 |
| 329 | `board6.itemTier` | 场上第7强：装备阶之和 |
| 330 | `board6.copies` | 场上第7强：自己一共有几张同名（含精锐） |
| 331 | `board6.b_yanShip` | 场上第7强：属于盟约 yanShip（1/0） |
| 332 | `board6.b_sargonShip` | 场上第7强：属于盟约 sargonShip（1/0） |
| 333 | `board6.b_victoriaShip` | 场上第7强：属于盟约 victoriaShip（1/0） |
| 334 | `board6.b_kjeragShip` | 场上第7强：属于盟约 kjeragShip（1/0） |
| 335 | `board6.b_lateranoShip` | 场上第7强：属于盟约 lateranoShip（1/0） |
| 336 | `board6.b_egirShip` | 场上第7强：属于盟约 egirShip（1/0） |
| 337 | `board6.b_siracusaShip` | 场上第7强：属于盟约 siracusaShip（1/0） |
| 338 | `board6.b_kazimierzShip` | 场上第7强：属于盟约 kazimierzShip（1/0） |
| 339 | `board6.b_preciShip` | 场上第7强：属于盟约 preciShip（1/0） |
| 340 | `board6.b_swiftShip` | 场上第7强：属于盟约 swiftShip（1/0） |
| 341 | `board6.b_skillfulShip` | 场上第7强：属于盟约 skillfulShip（1/0） |
| 342 | `board6.b_arcaneShip` | 场上第7强：属于盟约 arcaneShip（1/0） |
| 343 | `board6.b_steadShip` | 场上第7强：属于盟约 steadShip（1/0） |
| 344 | `board6.b_deputShip` | 场上第7强：属于盟约 deputShip（1/0） |
| 345 | `board6.b_visiShip` | 场上第7强：属于盟约 visiShip（1/0） |
| 346 | `board6.b_miraShip` | 场上第7强：属于盟约 miraShip（1/0） |
| 347 | `board6.b_investShip` | 场上第7强：属于盟约 investShip（1/0） |
| 348 | `board6.b_raidShip` | 场上第7强：属于盟约 raidShip（1/0） |
| 349 | `board6.b_indomShip` | 场上第7强：属于盟约 indomShip（1/0） |
| 350 | `board6.b_maniShip` | 场上第7强：属于盟约 maniShip（1/0） |
| 351 | `board6.b_emptyShip` | 场上第7强：属于盟约 emptyShip（1/0） |
| 352 | `board6.b_soloShip` | 场上第7强：属于盟约 soloShip（1/0） |
| 353 | `board6.b_suntShip` | 场上第7强：属于盟约 suntShip（1/0） |
| 354 | `board7.present` | 场上第8强：这个格子有没有干员（1/0） |
| 355 | `board7.tier` | 场上第8强：阶（费用档） |
| 356 | `board7.golden` | 场上第8强：是否精锐（合成过） |
| 357 | `board7.price` | 场上第8强：原价 |
| 358 | `board7.atk` | 场上第8强：攻击 |
| 359 | `board7.def` | 场上第8强：防御 |
| 360 | `board7.hp` | 场上第8强：最大血量 |
| 361 | `board7.res` | 场上第8强：法抗 |
| 362 | `board7.bat` | 场上第8强：攻击间隔 |
| 363 | `board7.aspd` | 场上第8强：攻速 |
| 364 | `board7.range` | 场上第8强：攻击范围格数 |
| 365 | `board7.block` | 场上第8强：阻挡数 |
| 366 | `board7.fly` | 场上第8强：能否打飞行（1/0） |
| 367 | `board7.ranged` | 场上第8强：远程位（1/0） |
| 368 | `board7.dmg_phys` | 场上第8强：物理伤害（1/0） |
| 369 | `board7.dmg_arts` | 场上第8强：法术伤害（1/0） |
| 370 | `board7.dmg_heal` | 场上第8强：治疗（1/0） |
| 371 | `board7.skillAtk` | 场上第8强：技能攻击倍率 |
| 372 | `board7.skillTimes` | 场上第8强：技能连击次数 |
| 373 | `board7.skillSp` | 场上第8强：技能费用（SP） |
| 374 | `board7.row` | 场上第8强：站位行（场上才有） |
| 375 | `board7.col` | 场上第8强：站位列 |
| 376 | `board7.items` | 场上第8强：装备件数 |
| 377 | `board7.itemTier` | 场上第8强：装备阶之和 |
| 378 | `board7.copies` | 场上第8强：自己一共有几张同名（含精锐） |
| 379 | `board7.b_yanShip` | 场上第8强：属于盟约 yanShip（1/0） |
| 380 | `board7.b_sargonShip` | 场上第8强：属于盟约 sargonShip（1/0） |
| 381 | `board7.b_victoriaShip` | 场上第8强：属于盟约 victoriaShip（1/0） |
| 382 | `board7.b_kjeragShip` | 场上第8强：属于盟约 kjeragShip（1/0） |
| 383 | `board7.b_lateranoShip` | 场上第8强：属于盟约 lateranoShip（1/0） |
| 384 | `board7.b_egirShip` | 场上第8强：属于盟约 egirShip（1/0） |
| 385 | `board7.b_siracusaShip` | 场上第8强：属于盟约 siracusaShip（1/0） |
| 386 | `board7.b_kazimierzShip` | 场上第8强：属于盟约 kazimierzShip（1/0） |
| 387 | `board7.b_preciShip` | 场上第8强：属于盟约 preciShip（1/0） |
| 388 | `board7.b_swiftShip` | 场上第8强：属于盟约 swiftShip（1/0） |
| 389 | `board7.b_skillfulShip` | 场上第8强：属于盟约 skillfulShip（1/0） |
| 390 | `board7.b_arcaneShip` | 场上第8强：属于盟约 arcaneShip（1/0） |
| 391 | `board7.b_steadShip` | 场上第8强：属于盟约 steadShip（1/0） |
| 392 | `board7.b_deputShip` | 场上第8强：属于盟约 deputShip（1/0） |
| 393 | `board7.b_visiShip` | 场上第8强：属于盟约 visiShip（1/0） |
| 394 | `board7.b_miraShip` | 场上第8强：属于盟约 miraShip（1/0） |
| 395 | `board7.b_investShip` | 场上第8强：属于盟约 investShip（1/0） |
| 396 | `board7.b_raidShip` | 场上第8强：属于盟约 raidShip（1/0） |
| 397 | `board7.b_indomShip` | 场上第8强：属于盟约 indomShip（1/0） |
| 398 | `board7.b_maniShip` | 场上第8强：属于盟约 maniShip（1/0） |
| 399 | `board7.b_emptyShip` | 场上第8强：属于盟约 emptyShip（1/0） |
| 400 | `board7.b_soloShip` | 场上第8强：属于盟约 soloShip（1/0） |
| 401 | `board7.b_suntShip` | 场上第8强：属于盟约 suntShip（1/0） |
| 402 | `board8.present` | 场上第9强：这个格子有没有干员（1/0） |
| 403 | `board8.tier` | 场上第9强：阶（费用档） |
| 404 | `board8.golden` | 场上第9强：是否精锐（合成过） |
| 405 | `board8.price` | 场上第9强：原价 |
| 406 | `board8.atk` | 场上第9强：攻击 |
| 407 | `board8.def` | 场上第9强：防御 |
| 408 | `board8.hp` | 场上第9强：最大血量 |
| 409 | `board8.res` | 场上第9强：法抗 |
| 410 | `board8.bat` | 场上第9强：攻击间隔 |
| 411 | `board8.aspd` | 场上第9强：攻速 |
| 412 | `board8.range` | 场上第9强：攻击范围格数 |
| 413 | `board8.block` | 场上第9强：阻挡数 |
| 414 | `board8.fly` | 场上第9强：能否打飞行（1/0） |
| 415 | `board8.ranged` | 场上第9强：远程位（1/0） |
| 416 | `board8.dmg_phys` | 场上第9强：物理伤害（1/0） |
| 417 | `board8.dmg_arts` | 场上第9强：法术伤害（1/0） |
| 418 | `board8.dmg_heal` | 场上第9强：治疗（1/0） |
| 419 | `board8.skillAtk` | 场上第9强：技能攻击倍率 |
| 420 | `board8.skillTimes` | 场上第9强：技能连击次数 |
| 421 | `board8.skillSp` | 场上第9强：技能费用（SP） |
| 422 | `board8.row` | 场上第9强：站位行（场上才有） |
| 423 | `board8.col` | 场上第9强：站位列 |
| 424 | `board8.items` | 场上第9强：装备件数 |
| 425 | `board8.itemTier` | 场上第9强：装备阶之和 |
| 426 | `board8.copies` | 场上第9强：自己一共有几张同名（含精锐） |
| 427 | `board8.b_yanShip` | 场上第9强：属于盟约 yanShip（1/0） |
| 428 | `board8.b_sargonShip` | 场上第9强：属于盟约 sargonShip（1/0） |
| 429 | `board8.b_victoriaShip` | 场上第9强：属于盟约 victoriaShip（1/0） |
| 430 | `board8.b_kjeragShip` | 场上第9强：属于盟约 kjeragShip（1/0） |
| 431 | `board8.b_lateranoShip` | 场上第9强：属于盟约 lateranoShip（1/0） |
| 432 | `board8.b_egirShip` | 场上第9强：属于盟约 egirShip（1/0） |
| 433 | `board8.b_siracusaShip` | 场上第9强：属于盟约 siracusaShip（1/0） |
| 434 | `board8.b_kazimierzShip` | 场上第9强：属于盟约 kazimierzShip（1/0） |
| 435 | `board8.b_preciShip` | 场上第9强：属于盟约 preciShip（1/0） |
| 436 | `board8.b_swiftShip` | 场上第9强：属于盟约 swiftShip（1/0） |
| 437 | `board8.b_skillfulShip` | 场上第9强：属于盟约 skillfulShip（1/0） |
| 438 | `board8.b_arcaneShip` | 场上第9强：属于盟约 arcaneShip（1/0） |
| 439 | `board8.b_steadShip` | 场上第9强：属于盟约 steadShip（1/0） |
| 440 | `board8.b_deputShip` | 场上第9强：属于盟约 deputShip（1/0） |
| 441 | `board8.b_visiShip` | 场上第9强：属于盟约 visiShip（1/0） |
| 442 | `board8.b_miraShip` | 场上第9强：属于盟约 miraShip（1/0） |
| 443 | `board8.b_investShip` | 场上第9强：属于盟约 investShip（1/0） |
| 444 | `board8.b_raidShip` | 场上第9强：属于盟约 raidShip（1/0） |
| 445 | `board8.b_indomShip` | 场上第9强：属于盟约 indomShip（1/0） |
| 446 | `board8.b_maniShip` | 场上第9强：属于盟约 maniShip（1/0） |
| 447 | `board8.b_emptyShip` | 场上第9强：属于盟约 emptyShip（1/0） |
| 448 | `board8.b_soloShip` | 场上第9强：属于盟约 soloShip（1/0） |
| 449 | `board8.b_suntShip` | 场上第9强：属于盟约 suntShip（1/0） |
| 450 | `board9.present` | 场上第10强：这个格子有没有干员（1/0） |
| 451 | `board9.tier` | 场上第10强：阶（费用档） |
| 452 | `board9.golden` | 场上第10强：是否精锐（合成过） |
| 453 | `board9.price` | 场上第10强：原价 |
| 454 | `board9.atk` | 场上第10强：攻击 |
| 455 | `board9.def` | 场上第10强：防御 |
| 456 | `board9.hp` | 场上第10强：最大血量 |
| 457 | `board9.res` | 场上第10强：法抗 |
| 458 | `board9.bat` | 场上第10强：攻击间隔 |
| 459 | `board9.aspd` | 场上第10强：攻速 |
| 460 | `board9.range` | 场上第10强：攻击范围格数 |
| 461 | `board9.block` | 场上第10强：阻挡数 |
| 462 | `board9.fly` | 场上第10强：能否打飞行（1/0） |
| 463 | `board9.ranged` | 场上第10强：远程位（1/0） |
| 464 | `board9.dmg_phys` | 场上第10强：物理伤害（1/0） |
| 465 | `board9.dmg_arts` | 场上第10强：法术伤害（1/0） |
| 466 | `board9.dmg_heal` | 场上第10强：治疗（1/0） |
| 467 | `board9.skillAtk` | 场上第10强：技能攻击倍率 |
| 468 | `board9.skillTimes` | 场上第10强：技能连击次数 |
| 469 | `board9.skillSp` | 场上第10强：技能费用（SP） |
| 470 | `board9.row` | 场上第10强：站位行（场上才有） |
| 471 | `board9.col` | 场上第10强：站位列 |
| 472 | `board9.items` | 场上第10强：装备件数 |
| 473 | `board9.itemTier` | 场上第10强：装备阶之和 |
| 474 | `board9.copies` | 场上第10强：自己一共有几张同名（含精锐） |
| 475 | `board9.b_yanShip` | 场上第10强：属于盟约 yanShip（1/0） |
| 476 | `board9.b_sargonShip` | 场上第10强：属于盟约 sargonShip（1/0） |
| 477 | `board9.b_victoriaShip` | 场上第10强：属于盟约 victoriaShip（1/0） |
| 478 | `board9.b_kjeragShip` | 场上第10强：属于盟约 kjeragShip（1/0） |
| 479 | `board9.b_lateranoShip` | 场上第10强：属于盟约 lateranoShip（1/0） |
| 480 | `board9.b_egirShip` | 场上第10强：属于盟约 egirShip（1/0） |
| 481 | `board9.b_siracusaShip` | 场上第10强：属于盟约 siracusaShip（1/0） |
| 482 | `board9.b_kazimierzShip` | 场上第10强：属于盟约 kazimierzShip（1/0） |
| 483 | `board9.b_preciShip` | 场上第10强：属于盟约 preciShip（1/0） |
| 484 | `board9.b_swiftShip` | 场上第10强：属于盟约 swiftShip（1/0） |
| 485 | `board9.b_skillfulShip` | 场上第10强：属于盟约 skillfulShip（1/0） |
| 486 | `board9.b_arcaneShip` | 场上第10强：属于盟约 arcaneShip（1/0） |
| 487 | `board9.b_steadShip` | 场上第10强：属于盟约 steadShip（1/0） |
| 488 | `board9.b_deputShip` | 场上第10强：属于盟约 deputShip（1/0） |
| 489 | `board9.b_visiShip` | 场上第10强：属于盟约 visiShip（1/0） |
| 490 | `board9.b_miraShip` | 场上第10强：属于盟约 miraShip（1/0） |
| 491 | `board9.b_investShip` | 场上第10强：属于盟约 investShip（1/0） |
| 492 | `board9.b_raidShip` | 场上第10强：属于盟约 raidShip（1/0） |
| 493 | `board9.b_indomShip` | 场上第10强：属于盟约 indomShip（1/0） |
| 494 | `board9.b_maniShip` | 场上第10强：属于盟约 maniShip（1/0） |
| 495 | `board9.b_emptyShip` | 场上第10强：属于盟约 emptyShip（1/0） |
| 496 | `board9.b_soloShip` | 场上第10强：属于盟约 soloShip（1/0） |
| 497 | `board9.b_suntShip` | 场上第10强：属于盟约 suntShip（1/0） |
| 498 | `hand0.present` | 手牌第1强：这个格子有没有干员（1/0） |
| 499 | `hand0.tier` | 手牌第1强：阶（费用档） |
| 500 | `hand0.golden` | 手牌第1强：是否精锐（合成过） |
| 501 | `hand0.price` | 手牌第1强：原价 |
| 502 | `hand0.atk` | 手牌第1强：攻击 |
| 503 | `hand0.def` | 手牌第1强：防御 |
| 504 | `hand0.hp` | 手牌第1强：最大血量 |
| 505 | `hand0.res` | 手牌第1强：法抗 |
| 506 | `hand0.bat` | 手牌第1强：攻击间隔 |
| 507 | `hand0.aspd` | 手牌第1强：攻速 |
| 508 | `hand0.range` | 手牌第1强：攻击范围格数 |
| 509 | `hand0.block` | 手牌第1强：阻挡数 |
| 510 | `hand0.fly` | 手牌第1强：能否打飞行（1/0） |
| 511 | `hand0.ranged` | 手牌第1强：远程位（1/0） |
| 512 | `hand0.dmg_phys` | 手牌第1强：物理伤害（1/0） |
| 513 | `hand0.dmg_arts` | 手牌第1强：法术伤害（1/0） |
| 514 | `hand0.dmg_heal` | 手牌第1强：治疗（1/0） |
| 515 | `hand0.skillAtk` | 手牌第1强：技能攻击倍率 |
| 516 | `hand0.skillTimes` | 手牌第1强：技能连击次数 |
| 517 | `hand0.skillSp` | 手牌第1强：技能费用（SP） |
| 518 | `hand0.row` | 手牌第1强：站位行（场上才有） |
| 519 | `hand0.col` | 手牌第1强：站位列 |
| 520 | `hand0.items` | 手牌第1强：装备件数 |
| 521 | `hand0.itemTier` | 手牌第1强：装备阶之和 |
| 522 | `hand0.copies` | 手牌第1强：自己一共有几张同名（含精锐） |
| 523 | `hand0.b_yanShip` | 手牌第1强：属于盟约 yanShip（1/0） |
| 524 | `hand0.b_sargonShip` | 手牌第1强：属于盟约 sargonShip（1/0） |
| 525 | `hand0.b_victoriaShip` | 手牌第1强：属于盟约 victoriaShip（1/0） |
| 526 | `hand0.b_kjeragShip` | 手牌第1强：属于盟约 kjeragShip（1/0） |
| 527 | `hand0.b_lateranoShip` | 手牌第1强：属于盟约 lateranoShip（1/0） |
| 528 | `hand0.b_egirShip` | 手牌第1强：属于盟约 egirShip（1/0） |
| 529 | `hand0.b_siracusaShip` | 手牌第1强：属于盟约 siracusaShip（1/0） |
| 530 | `hand0.b_kazimierzShip` | 手牌第1强：属于盟约 kazimierzShip（1/0） |
| 531 | `hand0.b_preciShip` | 手牌第1强：属于盟约 preciShip（1/0） |
| 532 | `hand0.b_swiftShip` | 手牌第1强：属于盟约 swiftShip（1/0） |
| 533 | `hand0.b_skillfulShip` | 手牌第1强：属于盟约 skillfulShip（1/0） |
| 534 | `hand0.b_arcaneShip` | 手牌第1强：属于盟约 arcaneShip（1/0） |
| 535 | `hand0.b_steadShip` | 手牌第1强：属于盟约 steadShip（1/0） |
| 536 | `hand0.b_deputShip` | 手牌第1强：属于盟约 deputShip（1/0） |
| 537 | `hand0.b_visiShip` | 手牌第1强：属于盟约 visiShip（1/0） |
| 538 | `hand0.b_miraShip` | 手牌第1强：属于盟约 miraShip（1/0） |
| 539 | `hand0.b_investShip` | 手牌第1强：属于盟约 investShip（1/0） |
| 540 | `hand0.b_raidShip` | 手牌第1强：属于盟约 raidShip（1/0） |
| 541 | `hand0.b_indomShip` | 手牌第1强：属于盟约 indomShip（1/0） |
| 542 | `hand0.b_maniShip` | 手牌第1强：属于盟约 maniShip（1/0） |
| 543 | `hand0.b_emptyShip` | 手牌第1强：属于盟约 emptyShip（1/0） |
| 544 | `hand0.b_soloShip` | 手牌第1强：属于盟约 soloShip（1/0） |
| 545 | `hand0.b_suntShip` | 手牌第1强：属于盟约 suntShip（1/0） |
| 546 | `hand1.present` | 手牌第2强：这个格子有没有干员（1/0） |
| 547 | `hand1.tier` | 手牌第2强：阶（费用档） |
| 548 | `hand1.golden` | 手牌第2强：是否精锐（合成过） |
| 549 | `hand1.price` | 手牌第2强：原价 |
| 550 | `hand1.atk` | 手牌第2强：攻击 |
| 551 | `hand1.def` | 手牌第2强：防御 |
| 552 | `hand1.hp` | 手牌第2强：最大血量 |
| 553 | `hand1.res` | 手牌第2强：法抗 |
| 554 | `hand1.bat` | 手牌第2强：攻击间隔 |
| 555 | `hand1.aspd` | 手牌第2强：攻速 |
| 556 | `hand1.range` | 手牌第2强：攻击范围格数 |
| 557 | `hand1.block` | 手牌第2强：阻挡数 |
| 558 | `hand1.fly` | 手牌第2强：能否打飞行（1/0） |
| 559 | `hand1.ranged` | 手牌第2强：远程位（1/0） |
| 560 | `hand1.dmg_phys` | 手牌第2强：物理伤害（1/0） |
| 561 | `hand1.dmg_arts` | 手牌第2强：法术伤害（1/0） |
| 562 | `hand1.dmg_heal` | 手牌第2强：治疗（1/0） |
| 563 | `hand1.skillAtk` | 手牌第2强：技能攻击倍率 |
| 564 | `hand1.skillTimes` | 手牌第2强：技能连击次数 |
| 565 | `hand1.skillSp` | 手牌第2强：技能费用（SP） |
| 566 | `hand1.row` | 手牌第2强：站位行（场上才有） |
| 567 | `hand1.col` | 手牌第2强：站位列 |
| 568 | `hand1.items` | 手牌第2强：装备件数 |
| 569 | `hand1.itemTier` | 手牌第2强：装备阶之和 |
| 570 | `hand1.copies` | 手牌第2强：自己一共有几张同名（含精锐） |
| 571 | `hand1.b_yanShip` | 手牌第2强：属于盟约 yanShip（1/0） |
| 572 | `hand1.b_sargonShip` | 手牌第2强：属于盟约 sargonShip（1/0） |
| 573 | `hand1.b_victoriaShip` | 手牌第2强：属于盟约 victoriaShip（1/0） |
| 574 | `hand1.b_kjeragShip` | 手牌第2强：属于盟约 kjeragShip（1/0） |
| 575 | `hand1.b_lateranoShip` | 手牌第2强：属于盟约 lateranoShip（1/0） |
| 576 | `hand1.b_egirShip` | 手牌第2强：属于盟约 egirShip（1/0） |
| 577 | `hand1.b_siracusaShip` | 手牌第2强：属于盟约 siracusaShip（1/0） |
| 578 | `hand1.b_kazimierzShip` | 手牌第2强：属于盟约 kazimierzShip（1/0） |
| 579 | `hand1.b_preciShip` | 手牌第2强：属于盟约 preciShip（1/0） |
| 580 | `hand1.b_swiftShip` | 手牌第2强：属于盟约 swiftShip（1/0） |
| 581 | `hand1.b_skillfulShip` | 手牌第2强：属于盟约 skillfulShip（1/0） |
| 582 | `hand1.b_arcaneShip` | 手牌第2强：属于盟约 arcaneShip（1/0） |
| 583 | `hand1.b_steadShip` | 手牌第2强：属于盟约 steadShip（1/0） |
| 584 | `hand1.b_deputShip` | 手牌第2强：属于盟约 deputShip（1/0） |
| 585 | `hand1.b_visiShip` | 手牌第2强：属于盟约 visiShip（1/0） |
| 586 | `hand1.b_miraShip` | 手牌第2强：属于盟约 miraShip（1/0） |
| 587 | `hand1.b_investShip` | 手牌第2强：属于盟约 investShip（1/0） |
| 588 | `hand1.b_raidShip` | 手牌第2强：属于盟约 raidShip（1/0） |
| 589 | `hand1.b_indomShip` | 手牌第2强：属于盟约 indomShip（1/0） |
| 590 | `hand1.b_maniShip` | 手牌第2强：属于盟约 maniShip（1/0） |
| 591 | `hand1.b_emptyShip` | 手牌第2强：属于盟约 emptyShip（1/0） |
| 592 | `hand1.b_soloShip` | 手牌第2强：属于盟约 soloShip（1/0） |
| 593 | `hand1.b_suntShip` | 手牌第2强：属于盟约 suntShip（1/0） |
| 594 | `hand2.present` | 手牌第3强：这个格子有没有干员（1/0） |
| 595 | `hand2.tier` | 手牌第3强：阶（费用档） |
| 596 | `hand2.golden` | 手牌第3强：是否精锐（合成过） |
| 597 | `hand2.price` | 手牌第3强：原价 |
| 598 | `hand2.atk` | 手牌第3强：攻击 |
| 599 | `hand2.def` | 手牌第3强：防御 |
| 600 | `hand2.hp` | 手牌第3强：最大血量 |
| 601 | `hand2.res` | 手牌第3强：法抗 |
| 602 | `hand2.bat` | 手牌第3强：攻击间隔 |
| 603 | `hand2.aspd` | 手牌第3强：攻速 |
| 604 | `hand2.range` | 手牌第3强：攻击范围格数 |
| 605 | `hand2.block` | 手牌第3强：阻挡数 |
| 606 | `hand2.fly` | 手牌第3强：能否打飞行（1/0） |
| 607 | `hand2.ranged` | 手牌第3强：远程位（1/0） |
| 608 | `hand2.dmg_phys` | 手牌第3强：物理伤害（1/0） |
| 609 | `hand2.dmg_arts` | 手牌第3强：法术伤害（1/0） |
| 610 | `hand2.dmg_heal` | 手牌第3强：治疗（1/0） |
| 611 | `hand2.skillAtk` | 手牌第3强：技能攻击倍率 |
| 612 | `hand2.skillTimes` | 手牌第3强：技能连击次数 |
| 613 | `hand2.skillSp` | 手牌第3强：技能费用（SP） |
| 614 | `hand2.row` | 手牌第3强：站位行（场上才有） |
| 615 | `hand2.col` | 手牌第3强：站位列 |
| 616 | `hand2.items` | 手牌第3强：装备件数 |
| 617 | `hand2.itemTier` | 手牌第3强：装备阶之和 |
| 618 | `hand2.copies` | 手牌第3强：自己一共有几张同名（含精锐） |
| 619 | `hand2.b_yanShip` | 手牌第3强：属于盟约 yanShip（1/0） |
| 620 | `hand2.b_sargonShip` | 手牌第3强：属于盟约 sargonShip（1/0） |
| 621 | `hand2.b_victoriaShip` | 手牌第3强：属于盟约 victoriaShip（1/0） |
| 622 | `hand2.b_kjeragShip` | 手牌第3强：属于盟约 kjeragShip（1/0） |
| 623 | `hand2.b_lateranoShip` | 手牌第3强：属于盟约 lateranoShip（1/0） |
| 624 | `hand2.b_egirShip` | 手牌第3强：属于盟约 egirShip（1/0） |
| 625 | `hand2.b_siracusaShip` | 手牌第3强：属于盟约 siracusaShip（1/0） |
| 626 | `hand2.b_kazimierzShip` | 手牌第3强：属于盟约 kazimierzShip（1/0） |
| 627 | `hand2.b_preciShip` | 手牌第3强：属于盟约 preciShip（1/0） |
| 628 | `hand2.b_swiftShip` | 手牌第3强：属于盟约 swiftShip（1/0） |
| 629 | `hand2.b_skillfulShip` | 手牌第3强：属于盟约 skillfulShip（1/0） |
| 630 | `hand2.b_arcaneShip` | 手牌第3强：属于盟约 arcaneShip（1/0） |
| 631 | `hand2.b_steadShip` | 手牌第3强：属于盟约 steadShip（1/0） |
| 632 | `hand2.b_deputShip` | 手牌第3强：属于盟约 deputShip（1/0） |
| 633 | `hand2.b_visiShip` | 手牌第3强：属于盟约 visiShip（1/0） |
| 634 | `hand2.b_miraShip` | 手牌第3强：属于盟约 miraShip（1/0） |
| 635 | `hand2.b_investShip` | 手牌第3强：属于盟约 investShip（1/0） |
| 636 | `hand2.b_raidShip` | 手牌第3强：属于盟约 raidShip（1/0） |
| 637 | `hand2.b_indomShip` | 手牌第3强：属于盟约 indomShip（1/0） |
| 638 | `hand2.b_maniShip` | 手牌第3强：属于盟约 maniShip（1/0） |
| 639 | `hand2.b_emptyShip` | 手牌第3强：属于盟约 emptyShip（1/0） |
| 640 | `hand2.b_soloShip` | 手牌第3强：属于盟约 soloShip（1/0） |
| 641 | `hand2.b_suntShip` | 手牌第3强：属于盟约 suntShip（1/0） |
| 642 | `hand3.present` | 手牌第4强：这个格子有没有干员（1/0） |
| 643 | `hand3.tier` | 手牌第4强：阶（费用档） |
| 644 | `hand3.golden` | 手牌第4强：是否精锐（合成过） |
| 645 | `hand3.price` | 手牌第4强：原价 |
| 646 | `hand3.atk` | 手牌第4强：攻击 |
| 647 | `hand3.def` | 手牌第4强：防御 |
| 648 | `hand3.hp` | 手牌第4强：最大血量 |
| 649 | `hand3.res` | 手牌第4强：法抗 |
| 650 | `hand3.bat` | 手牌第4强：攻击间隔 |
| 651 | `hand3.aspd` | 手牌第4强：攻速 |
| 652 | `hand3.range` | 手牌第4强：攻击范围格数 |
| 653 | `hand3.block` | 手牌第4强：阻挡数 |
| 654 | `hand3.fly` | 手牌第4强：能否打飞行（1/0） |
| 655 | `hand3.ranged` | 手牌第4强：远程位（1/0） |
| 656 | `hand3.dmg_phys` | 手牌第4强：物理伤害（1/0） |
| 657 | `hand3.dmg_arts` | 手牌第4强：法术伤害（1/0） |
| 658 | `hand3.dmg_heal` | 手牌第4强：治疗（1/0） |
| 659 | `hand3.skillAtk` | 手牌第4强：技能攻击倍率 |
| 660 | `hand3.skillTimes` | 手牌第4强：技能连击次数 |
| 661 | `hand3.skillSp` | 手牌第4强：技能费用（SP） |
| 662 | `hand3.row` | 手牌第4强：站位行（场上才有） |
| 663 | `hand3.col` | 手牌第4强：站位列 |
| 664 | `hand3.items` | 手牌第4强：装备件数 |
| 665 | `hand3.itemTier` | 手牌第4强：装备阶之和 |
| 666 | `hand3.copies` | 手牌第4强：自己一共有几张同名（含精锐） |
| 667 | `hand3.b_yanShip` | 手牌第4强：属于盟约 yanShip（1/0） |
| 668 | `hand3.b_sargonShip` | 手牌第4强：属于盟约 sargonShip（1/0） |
| 669 | `hand3.b_victoriaShip` | 手牌第4强：属于盟约 victoriaShip（1/0） |
| 670 | `hand3.b_kjeragShip` | 手牌第4强：属于盟约 kjeragShip（1/0） |
| 671 | `hand3.b_lateranoShip` | 手牌第4强：属于盟约 lateranoShip（1/0） |
| 672 | `hand3.b_egirShip` | 手牌第4强：属于盟约 egirShip（1/0） |
| 673 | `hand3.b_siracusaShip` | 手牌第4强：属于盟约 siracusaShip（1/0） |
| 674 | `hand3.b_kazimierzShip` | 手牌第4强：属于盟约 kazimierzShip（1/0） |
| 675 | `hand3.b_preciShip` | 手牌第4强：属于盟约 preciShip（1/0） |
| 676 | `hand3.b_swiftShip` | 手牌第4强：属于盟约 swiftShip（1/0） |
| 677 | `hand3.b_skillfulShip` | 手牌第4强：属于盟约 skillfulShip（1/0） |
| 678 | `hand3.b_arcaneShip` | 手牌第4强：属于盟约 arcaneShip（1/0） |
| 679 | `hand3.b_steadShip` | 手牌第4强：属于盟约 steadShip（1/0） |
| 680 | `hand3.b_deputShip` | 手牌第4强：属于盟约 deputShip（1/0） |
| 681 | `hand3.b_visiShip` | 手牌第4强：属于盟约 visiShip（1/0） |
| 682 | `hand3.b_miraShip` | 手牌第4强：属于盟约 miraShip（1/0） |
| 683 | `hand3.b_investShip` | 手牌第4强：属于盟约 investShip（1/0） |
| 684 | `hand3.b_raidShip` | 手牌第4强：属于盟约 raidShip（1/0） |
| 685 | `hand3.b_indomShip` | 手牌第4强：属于盟约 indomShip（1/0） |
| 686 | `hand3.b_maniShip` | 手牌第4强：属于盟约 maniShip（1/0） |
| 687 | `hand3.b_emptyShip` | 手牌第4强：属于盟约 emptyShip（1/0） |
| 688 | `hand3.b_soloShip` | 手牌第4强：属于盟约 soloShip（1/0） |
| 689 | `hand3.b_suntShip` | 手牌第4强：属于盟约 suntShip（1/0） |
| 690 | `hand4.present` | 手牌第5强：这个格子有没有干员（1/0） |
| 691 | `hand4.tier` | 手牌第5强：阶（费用档） |
| 692 | `hand4.golden` | 手牌第5强：是否精锐（合成过） |
| 693 | `hand4.price` | 手牌第5强：原价 |
| 694 | `hand4.atk` | 手牌第5强：攻击 |
| 695 | `hand4.def` | 手牌第5强：防御 |
| 696 | `hand4.hp` | 手牌第5强：最大血量 |
| 697 | `hand4.res` | 手牌第5强：法抗 |
| 698 | `hand4.bat` | 手牌第5强：攻击间隔 |
| 699 | `hand4.aspd` | 手牌第5强：攻速 |
| 700 | `hand4.range` | 手牌第5强：攻击范围格数 |
| 701 | `hand4.block` | 手牌第5强：阻挡数 |
| 702 | `hand4.fly` | 手牌第5强：能否打飞行（1/0） |
| 703 | `hand4.ranged` | 手牌第5强：远程位（1/0） |
| 704 | `hand4.dmg_phys` | 手牌第5强：物理伤害（1/0） |
| 705 | `hand4.dmg_arts` | 手牌第5强：法术伤害（1/0） |
| 706 | `hand4.dmg_heal` | 手牌第5强：治疗（1/0） |
| 707 | `hand4.skillAtk` | 手牌第5强：技能攻击倍率 |
| 708 | `hand4.skillTimes` | 手牌第5强：技能连击次数 |
| 709 | `hand4.skillSp` | 手牌第5强：技能费用（SP） |
| 710 | `hand4.row` | 手牌第5强：站位行（场上才有） |
| 711 | `hand4.col` | 手牌第5强：站位列 |
| 712 | `hand4.items` | 手牌第5强：装备件数 |
| 713 | `hand4.itemTier` | 手牌第5强：装备阶之和 |
| 714 | `hand4.copies` | 手牌第5强：自己一共有几张同名（含精锐） |
| 715 | `hand4.b_yanShip` | 手牌第5强：属于盟约 yanShip（1/0） |
| 716 | `hand4.b_sargonShip` | 手牌第5强：属于盟约 sargonShip（1/0） |
| 717 | `hand4.b_victoriaShip` | 手牌第5强：属于盟约 victoriaShip（1/0） |
| 718 | `hand4.b_kjeragShip` | 手牌第5强：属于盟约 kjeragShip（1/0） |
| 719 | `hand4.b_lateranoShip` | 手牌第5强：属于盟约 lateranoShip（1/0） |
| 720 | `hand4.b_egirShip` | 手牌第5强：属于盟约 egirShip（1/0） |
| 721 | `hand4.b_siracusaShip` | 手牌第5强：属于盟约 siracusaShip（1/0） |
| 722 | `hand4.b_kazimierzShip` | 手牌第5强：属于盟约 kazimierzShip（1/0） |
| 723 | `hand4.b_preciShip` | 手牌第5强：属于盟约 preciShip（1/0） |
| 724 | `hand4.b_swiftShip` | 手牌第5强：属于盟约 swiftShip（1/0） |
| 725 | `hand4.b_skillfulShip` | 手牌第5强：属于盟约 skillfulShip（1/0） |
| 726 | `hand4.b_arcaneShip` | 手牌第5强：属于盟约 arcaneShip（1/0） |
| 727 | `hand4.b_steadShip` | 手牌第5强：属于盟约 steadShip（1/0） |
| 728 | `hand4.b_deputShip` | 手牌第5强：属于盟约 deputShip（1/0） |
| 729 | `hand4.b_visiShip` | 手牌第5强：属于盟约 visiShip（1/0） |
| 730 | `hand4.b_miraShip` | 手牌第5强：属于盟约 miraShip（1/0） |
| 731 | `hand4.b_investShip` | 手牌第5强：属于盟约 investShip（1/0） |
| 732 | `hand4.b_raidShip` | 手牌第5强：属于盟约 raidShip（1/0） |
| 733 | `hand4.b_indomShip` | 手牌第5强：属于盟约 indomShip（1/0） |
| 734 | `hand4.b_maniShip` | 手牌第5强：属于盟约 maniShip（1/0） |
| 735 | `hand4.b_emptyShip` | 手牌第5强：属于盟约 emptyShip（1/0） |
| 736 | `hand4.b_soloShip` | 手牌第5强：属于盟约 soloShip（1/0） |
| 737 | `hand4.b_suntShip` | 手牌第5强：属于盟约 suntShip（1/0） |
| 738 | `hand5.present` | 手牌第6强：这个格子有没有干员（1/0） |
| 739 | `hand5.tier` | 手牌第6强：阶（费用档） |
| 740 | `hand5.golden` | 手牌第6强：是否精锐（合成过） |
| 741 | `hand5.price` | 手牌第6强：原价 |
| 742 | `hand5.atk` | 手牌第6强：攻击 |
| 743 | `hand5.def` | 手牌第6强：防御 |
| 744 | `hand5.hp` | 手牌第6强：最大血量 |
| 745 | `hand5.res` | 手牌第6强：法抗 |
| 746 | `hand5.bat` | 手牌第6强：攻击间隔 |
| 747 | `hand5.aspd` | 手牌第6强：攻速 |
| 748 | `hand5.range` | 手牌第6强：攻击范围格数 |
| 749 | `hand5.block` | 手牌第6强：阻挡数 |
| 750 | `hand5.fly` | 手牌第6强：能否打飞行（1/0） |
| 751 | `hand5.ranged` | 手牌第6强：远程位（1/0） |
| 752 | `hand5.dmg_phys` | 手牌第6强：物理伤害（1/0） |
| 753 | `hand5.dmg_arts` | 手牌第6强：法术伤害（1/0） |
| 754 | `hand5.dmg_heal` | 手牌第6强：治疗（1/0） |
| 755 | `hand5.skillAtk` | 手牌第6强：技能攻击倍率 |
| 756 | `hand5.skillTimes` | 手牌第6强：技能连击次数 |
| 757 | `hand5.skillSp` | 手牌第6强：技能费用（SP） |
| 758 | `hand5.row` | 手牌第6强：站位行（场上才有） |
| 759 | `hand5.col` | 手牌第6强：站位列 |
| 760 | `hand5.items` | 手牌第6强：装备件数 |
| 761 | `hand5.itemTier` | 手牌第6强：装备阶之和 |
| 762 | `hand5.copies` | 手牌第6强：自己一共有几张同名（含精锐） |
| 763 | `hand5.b_yanShip` | 手牌第6强：属于盟约 yanShip（1/0） |
| 764 | `hand5.b_sargonShip` | 手牌第6强：属于盟约 sargonShip（1/0） |
| 765 | `hand5.b_victoriaShip` | 手牌第6强：属于盟约 victoriaShip（1/0） |
| 766 | `hand5.b_kjeragShip` | 手牌第6强：属于盟约 kjeragShip（1/0） |
| 767 | `hand5.b_lateranoShip` | 手牌第6强：属于盟约 lateranoShip（1/0） |
| 768 | `hand5.b_egirShip` | 手牌第6强：属于盟约 egirShip（1/0） |
| 769 | `hand5.b_siracusaShip` | 手牌第6强：属于盟约 siracusaShip（1/0） |
| 770 | `hand5.b_kazimierzShip` | 手牌第6强：属于盟约 kazimierzShip（1/0） |
| 771 | `hand5.b_preciShip` | 手牌第6强：属于盟约 preciShip（1/0） |
| 772 | `hand5.b_swiftShip` | 手牌第6强：属于盟约 swiftShip（1/0） |
| 773 | `hand5.b_skillfulShip` | 手牌第6强：属于盟约 skillfulShip（1/0） |
| 774 | `hand5.b_arcaneShip` | 手牌第6强：属于盟约 arcaneShip（1/0） |
| 775 | `hand5.b_steadShip` | 手牌第6强：属于盟约 steadShip（1/0） |
| 776 | `hand5.b_deputShip` | 手牌第6强：属于盟约 deputShip（1/0） |
| 777 | `hand5.b_visiShip` | 手牌第6强：属于盟约 visiShip（1/0） |
| 778 | `hand5.b_miraShip` | 手牌第6强：属于盟约 miraShip（1/0） |
| 779 | `hand5.b_investShip` | 手牌第6强：属于盟约 investShip（1/0） |
| 780 | `hand5.b_raidShip` | 手牌第6强：属于盟约 raidShip（1/0） |
| 781 | `hand5.b_indomShip` | 手牌第6强：属于盟约 indomShip（1/0） |
| 782 | `hand5.b_maniShip` | 手牌第6强：属于盟约 maniShip（1/0） |
| 783 | `hand5.b_emptyShip` | 手牌第6强：属于盟约 emptyShip（1/0） |
| 784 | `hand5.b_soloShip` | 手牌第6强：属于盟约 soloShip（1/0） |
| 785 | `hand5.b_suntShip` | 手牌第6强：属于盟约 suntShip（1/0） |
| 786 | `shop0.present` | 商店第1格：这个格子有没有干员（1/0） |
| 787 | `shop0.tier` | 商店第1格：阶（费用档） |
| 788 | `shop0.golden` | 商店第1格：是否精锐（合成过） |
| 789 | `shop0.price` | 商店第1格：原价 |
| 790 | `shop0.atk` | 商店第1格：攻击 |
| 791 | `shop0.def` | 商店第1格：防御 |
| 792 | `shop0.hp` | 商店第1格：最大血量 |
| 793 | `shop0.res` | 商店第1格：法抗 |
| 794 | `shop0.bat` | 商店第1格：攻击间隔 |
| 795 | `shop0.aspd` | 商店第1格：攻速 |
| 796 | `shop0.range` | 商店第1格：攻击范围格数 |
| 797 | `shop0.block` | 商店第1格：阻挡数 |
| 798 | `shop0.fly` | 商店第1格：能否打飞行（1/0） |
| 799 | `shop0.ranged` | 商店第1格：远程位（1/0） |
| 800 | `shop0.dmg_phys` | 商店第1格：物理伤害（1/0） |
| 801 | `shop0.dmg_arts` | 商店第1格：法术伤害（1/0） |
| 802 | `shop0.dmg_heal` | 商店第1格：治疗（1/0） |
| 803 | `shop0.skillAtk` | 商店第1格：技能攻击倍率 |
| 804 | `shop0.skillTimes` | 商店第1格：技能连击次数 |
| 805 | `shop0.skillSp` | 商店第1格：技能费用（SP） |
| 806 | `shop0.row` | 商店第1格：站位行（场上才有） |
| 807 | `shop0.col` | 商店第1格：站位列 |
| 808 | `shop0.items` | 商店第1格：装备件数 |
| 809 | `shop0.itemTier` | 商店第1格：装备阶之和 |
| 810 | `shop0.copies` | 商店第1格：自己一共有几张同名（含精锐） |
| 811 | `shop0.b_yanShip` | 商店第1格：属于盟约 yanShip（1/0） |
| 812 | `shop0.b_sargonShip` | 商店第1格：属于盟约 sargonShip（1/0） |
| 813 | `shop0.b_victoriaShip` | 商店第1格：属于盟约 victoriaShip（1/0） |
| 814 | `shop0.b_kjeragShip` | 商店第1格：属于盟约 kjeragShip（1/0） |
| 815 | `shop0.b_lateranoShip` | 商店第1格：属于盟约 lateranoShip（1/0） |
| 816 | `shop0.b_egirShip` | 商店第1格：属于盟约 egirShip（1/0） |
| 817 | `shop0.b_siracusaShip` | 商店第1格：属于盟约 siracusaShip（1/0） |
| 818 | `shop0.b_kazimierzShip` | 商店第1格：属于盟约 kazimierzShip（1/0） |
| 819 | `shop0.b_preciShip` | 商店第1格：属于盟约 preciShip（1/0） |
| 820 | `shop0.b_swiftShip` | 商店第1格：属于盟约 swiftShip（1/0） |
| 821 | `shop0.b_skillfulShip` | 商店第1格：属于盟约 skillfulShip（1/0） |
| 822 | `shop0.b_arcaneShip` | 商店第1格：属于盟约 arcaneShip（1/0） |
| 823 | `shop0.b_steadShip` | 商店第1格：属于盟约 steadShip（1/0） |
| 824 | `shop0.b_deputShip` | 商店第1格：属于盟约 deputShip（1/0） |
| 825 | `shop0.b_visiShip` | 商店第1格：属于盟约 visiShip（1/0） |
| 826 | `shop0.b_miraShip` | 商店第1格：属于盟约 miraShip（1/0） |
| 827 | `shop0.b_investShip` | 商店第1格：属于盟约 investShip（1/0） |
| 828 | `shop0.b_raidShip` | 商店第1格：属于盟约 raidShip（1/0） |
| 829 | `shop0.b_indomShip` | 商店第1格：属于盟约 indomShip（1/0） |
| 830 | `shop0.b_maniShip` | 商店第1格：属于盟约 maniShip（1/0） |
| 831 | `shop0.b_emptyShip` | 商店第1格：属于盟约 emptyShip（1/0） |
| 832 | `shop0.b_soloShip` | 商店第1格：属于盟约 soloShip（1/0） |
| 833 | `shop0.b_suntShip` | 商店第1格：属于盟约 suntShip（1/0） |
| 834 | `shop1.present` | 商店第2格：这个格子有没有干员（1/0） |
| 835 | `shop1.tier` | 商店第2格：阶（费用档） |
| 836 | `shop1.golden` | 商店第2格：是否精锐（合成过） |
| 837 | `shop1.price` | 商店第2格：原价 |
| 838 | `shop1.atk` | 商店第2格：攻击 |
| 839 | `shop1.def` | 商店第2格：防御 |
| 840 | `shop1.hp` | 商店第2格：最大血量 |
| 841 | `shop1.res` | 商店第2格：法抗 |
| 842 | `shop1.bat` | 商店第2格：攻击间隔 |
| 843 | `shop1.aspd` | 商店第2格：攻速 |
| 844 | `shop1.range` | 商店第2格：攻击范围格数 |
| 845 | `shop1.block` | 商店第2格：阻挡数 |
| 846 | `shop1.fly` | 商店第2格：能否打飞行（1/0） |
| 847 | `shop1.ranged` | 商店第2格：远程位（1/0） |
| 848 | `shop1.dmg_phys` | 商店第2格：物理伤害（1/0） |
| 849 | `shop1.dmg_arts` | 商店第2格：法术伤害（1/0） |
| 850 | `shop1.dmg_heal` | 商店第2格：治疗（1/0） |
| 851 | `shop1.skillAtk` | 商店第2格：技能攻击倍率 |
| 852 | `shop1.skillTimes` | 商店第2格：技能连击次数 |
| 853 | `shop1.skillSp` | 商店第2格：技能费用（SP） |
| 854 | `shop1.row` | 商店第2格：站位行（场上才有） |
| 855 | `shop1.col` | 商店第2格：站位列 |
| 856 | `shop1.items` | 商店第2格：装备件数 |
| 857 | `shop1.itemTier` | 商店第2格：装备阶之和 |
| 858 | `shop1.copies` | 商店第2格：自己一共有几张同名（含精锐） |
| 859 | `shop1.b_yanShip` | 商店第2格：属于盟约 yanShip（1/0） |
| 860 | `shop1.b_sargonShip` | 商店第2格：属于盟约 sargonShip（1/0） |
| 861 | `shop1.b_victoriaShip` | 商店第2格：属于盟约 victoriaShip（1/0） |
| 862 | `shop1.b_kjeragShip` | 商店第2格：属于盟约 kjeragShip（1/0） |
| 863 | `shop1.b_lateranoShip` | 商店第2格：属于盟约 lateranoShip（1/0） |
| 864 | `shop1.b_egirShip` | 商店第2格：属于盟约 egirShip（1/0） |
| 865 | `shop1.b_siracusaShip` | 商店第2格：属于盟约 siracusaShip（1/0） |
| 866 | `shop1.b_kazimierzShip` | 商店第2格：属于盟约 kazimierzShip（1/0） |
| 867 | `shop1.b_preciShip` | 商店第2格：属于盟约 preciShip（1/0） |
| 868 | `shop1.b_swiftShip` | 商店第2格：属于盟约 swiftShip（1/0） |
| 869 | `shop1.b_skillfulShip` | 商店第2格：属于盟约 skillfulShip（1/0） |
| 870 | `shop1.b_arcaneShip` | 商店第2格：属于盟约 arcaneShip（1/0） |
| 871 | `shop1.b_steadShip` | 商店第2格：属于盟约 steadShip（1/0） |
| 872 | `shop1.b_deputShip` | 商店第2格：属于盟约 deputShip（1/0） |
| 873 | `shop1.b_visiShip` | 商店第2格：属于盟约 visiShip（1/0） |
| 874 | `shop1.b_miraShip` | 商店第2格：属于盟约 miraShip（1/0） |
| 875 | `shop1.b_investShip` | 商店第2格：属于盟约 investShip（1/0） |
| 876 | `shop1.b_raidShip` | 商店第2格：属于盟约 raidShip（1/0） |
| 877 | `shop1.b_indomShip` | 商店第2格：属于盟约 indomShip（1/0） |
| 878 | `shop1.b_maniShip` | 商店第2格：属于盟约 maniShip（1/0） |
| 879 | `shop1.b_emptyShip` | 商店第2格：属于盟约 emptyShip（1/0） |
| 880 | `shop1.b_soloShip` | 商店第2格：属于盟约 soloShip（1/0） |
| 881 | `shop1.b_suntShip` | 商店第2格：属于盟约 suntShip（1/0） |
| 882 | `shop2.present` | 商店第3格：这个格子有没有干员（1/0） |
| 883 | `shop2.tier` | 商店第3格：阶（费用档） |
| 884 | `shop2.golden` | 商店第3格：是否精锐（合成过） |
| 885 | `shop2.price` | 商店第3格：原价 |
| 886 | `shop2.atk` | 商店第3格：攻击 |
| 887 | `shop2.def` | 商店第3格：防御 |
| 888 | `shop2.hp` | 商店第3格：最大血量 |
| 889 | `shop2.res` | 商店第3格：法抗 |
| 890 | `shop2.bat` | 商店第3格：攻击间隔 |
| 891 | `shop2.aspd` | 商店第3格：攻速 |
| 892 | `shop2.range` | 商店第3格：攻击范围格数 |
| 893 | `shop2.block` | 商店第3格：阻挡数 |
| 894 | `shop2.fly` | 商店第3格：能否打飞行（1/0） |
| 895 | `shop2.ranged` | 商店第3格：远程位（1/0） |
| 896 | `shop2.dmg_phys` | 商店第3格：物理伤害（1/0） |
| 897 | `shop2.dmg_arts` | 商店第3格：法术伤害（1/0） |
| 898 | `shop2.dmg_heal` | 商店第3格：治疗（1/0） |
| 899 | `shop2.skillAtk` | 商店第3格：技能攻击倍率 |
| 900 | `shop2.skillTimes` | 商店第3格：技能连击次数 |
| 901 | `shop2.skillSp` | 商店第3格：技能费用（SP） |
| 902 | `shop2.row` | 商店第3格：站位行（场上才有） |
| 903 | `shop2.col` | 商店第3格：站位列 |
| 904 | `shop2.items` | 商店第3格：装备件数 |
| 905 | `shop2.itemTier` | 商店第3格：装备阶之和 |
| 906 | `shop2.copies` | 商店第3格：自己一共有几张同名（含精锐） |
| 907 | `shop2.b_yanShip` | 商店第3格：属于盟约 yanShip（1/0） |
| 908 | `shop2.b_sargonShip` | 商店第3格：属于盟约 sargonShip（1/0） |
| 909 | `shop2.b_victoriaShip` | 商店第3格：属于盟约 victoriaShip（1/0） |
| 910 | `shop2.b_kjeragShip` | 商店第3格：属于盟约 kjeragShip（1/0） |
| 911 | `shop2.b_lateranoShip` | 商店第3格：属于盟约 lateranoShip（1/0） |
| 912 | `shop2.b_egirShip` | 商店第3格：属于盟约 egirShip（1/0） |
| 913 | `shop2.b_siracusaShip` | 商店第3格：属于盟约 siracusaShip（1/0） |
| 914 | `shop2.b_kazimierzShip` | 商店第3格：属于盟约 kazimierzShip（1/0） |
| 915 | `shop2.b_preciShip` | 商店第3格：属于盟约 preciShip（1/0） |
| 916 | `shop2.b_swiftShip` | 商店第3格：属于盟约 swiftShip（1/0） |
| 917 | `shop2.b_skillfulShip` | 商店第3格：属于盟约 skillfulShip（1/0） |
| 918 | `shop2.b_arcaneShip` | 商店第3格：属于盟约 arcaneShip（1/0） |
| 919 | `shop2.b_steadShip` | 商店第3格：属于盟约 steadShip（1/0） |
| 920 | `shop2.b_deputShip` | 商店第3格：属于盟约 deputShip（1/0） |
| 921 | `shop2.b_visiShip` | 商店第3格：属于盟约 visiShip（1/0） |
| 922 | `shop2.b_miraShip` | 商店第3格：属于盟约 miraShip（1/0） |
| 923 | `shop2.b_investShip` | 商店第3格：属于盟约 investShip（1/0） |
| 924 | `shop2.b_raidShip` | 商店第3格：属于盟约 raidShip（1/0） |
| 925 | `shop2.b_indomShip` | 商店第3格：属于盟约 indomShip（1/0） |
| 926 | `shop2.b_maniShip` | 商店第3格：属于盟约 maniShip（1/0） |
| 927 | `shop2.b_emptyShip` | 商店第3格：属于盟约 emptyShip（1/0） |
| 928 | `shop2.b_soloShip` | 商店第3格：属于盟约 soloShip（1/0） |
| 929 | `shop2.b_suntShip` | 商店第3格：属于盟约 suntShip（1/0） |
| 930 | `shop3.present` | 商店第4格：这个格子有没有干员（1/0） |
| 931 | `shop3.tier` | 商店第4格：阶（费用档） |
| 932 | `shop3.golden` | 商店第4格：是否精锐（合成过） |
| 933 | `shop3.price` | 商店第4格：原价 |
| 934 | `shop3.atk` | 商店第4格：攻击 |
| 935 | `shop3.def` | 商店第4格：防御 |
| 936 | `shop3.hp` | 商店第4格：最大血量 |
| 937 | `shop3.res` | 商店第4格：法抗 |
| 938 | `shop3.bat` | 商店第4格：攻击间隔 |
| 939 | `shop3.aspd` | 商店第4格：攻速 |
| 940 | `shop3.range` | 商店第4格：攻击范围格数 |
| 941 | `shop3.block` | 商店第4格：阻挡数 |
| 942 | `shop3.fly` | 商店第4格：能否打飞行（1/0） |
| 943 | `shop3.ranged` | 商店第4格：远程位（1/0） |
| 944 | `shop3.dmg_phys` | 商店第4格：物理伤害（1/0） |
| 945 | `shop3.dmg_arts` | 商店第4格：法术伤害（1/0） |
| 946 | `shop3.dmg_heal` | 商店第4格：治疗（1/0） |
| 947 | `shop3.skillAtk` | 商店第4格：技能攻击倍率 |
| 948 | `shop3.skillTimes` | 商店第4格：技能连击次数 |
| 949 | `shop3.skillSp` | 商店第4格：技能费用（SP） |
| 950 | `shop3.row` | 商店第4格：站位行（场上才有） |
| 951 | `shop3.col` | 商店第4格：站位列 |
| 952 | `shop3.items` | 商店第4格：装备件数 |
| 953 | `shop3.itemTier` | 商店第4格：装备阶之和 |
| 954 | `shop3.copies` | 商店第4格：自己一共有几张同名（含精锐） |
| 955 | `shop3.b_yanShip` | 商店第4格：属于盟约 yanShip（1/0） |
| 956 | `shop3.b_sargonShip` | 商店第4格：属于盟约 sargonShip（1/0） |
| 957 | `shop3.b_victoriaShip` | 商店第4格：属于盟约 victoriaShip（1/0） |
| 958 | `shop3.b_kjeragShip` | 商店第4格：属于盟约 kjeragShip（1/0） |
| 959 | `shop3.b_lateranoShip` | 商店第4格：属于盟约 lateranoShip（1/0） |
| 960 | `shop3.b_egirShip` | 商店第4格：属于盟约 egirShip（1/0） |
| 961 | `shop3.b_siracusaShip` | 商店第4格：属于盟约 siracusaShip（1/0） |
| 962 | `shop3.b_kazimierzShip` | 商店第4格：属于盟约 kazimierzShip（1/0） |
| 963 | `shop3.b_preciShip` | 商店第4格：属于盟约 preciShip（1/0） |
| 964 | `shop3.b_swiftShip` | 商店第4格：属于盟约 swiftShip（1/0） |
| 965 | `shop3.b_skillfulShip` | 商店第4格：属于盟约 skillfulShip（1/0） |
| 966 | `shop3.b_arcaneShip` | 商店第4格：属于盟约 arcaneShip（1/0） |
| 967 | `shop3.b_steadShip` | 商店第4格：属于盟约 steadShip（1/0） |
| 968 | `shop3.b_deputShip` | 商店第4格：属于盟约 deputShip（1/0） |
| 969 | `shop3.b_visiShip` | 商店第4格：属于盟约 visiShip（1/0） |
| 970 | `shop3.b_miraShip` | 商店第4格：属于盟约 miraShip（1/0） |
| 971 | `shop3.b_investShip` | 商店第4格：属于盟约 investShip（1/0） |
| 972 | `shop3.b_raidShip` | 商店第4格：属于盟约 raidShip（1/0） |
| 973 | `shop3.b_indomShip` | 商店第4格：属于盟约 indomShip（1/0） |
| 974 | `shop3.b_maniShip` | 商店第4格：属于盟约 maniShip（1/0） |
| 975 | `shop3.b_emptyShip` | 商店第4格：属于盟约 emptyShip（1/0） |
| 976 | `shop3.b_soloShip` | 商店第4格：属于盟约 soloShip（1/0） |
| 977 | `shop3.b_suntShip` | 商店第4格：属于盟约 suntShip（1/0） |
| 978 | `shop4.present` | 商店第5格：这个格子有没有干员（1/0） |
| 979 | `shop4.tier` | 商店第5格：阶（费用档） |
| 980 | `shop4.golden` | 商店第5格：是否精锐（合成过） |
| 981 | `shop4.price` | 商店第5格：原价 |
| 982 | `shop4.atk` | 商店第5格：攻击 |
| 983 | `shop4.def` | 商店第5格：防御 |
| 984 | `shop4.hp` | 商店第5格：最大血量 |
| 985 | `shop4.res` | 商店第5格：法抗 |
| 986 | `shop4.bat` | 商店第5格：攻击间隔 |
| 987 | `shop4.aspd` | 商店第5格：攻速 |
| 988 | `shop4.range` | 商店第5格：攻击范围格数 |
| 989 | `shop4.block` | 商店第5格：阻挡数 |
| 990 | `shop4.fly` | 商店第5格：能否打飞行（1/0） |
| 991 | `shop4.ranged` | 商店第5格：远程位（1/0） |
| 992 | `shop4.dmg_phys` | 商店第5格：物理伤害（1/0） |
| 993 | `shop4.dmg_arts` | 商店第5格：法术伤害（1/0） |
| 994 | `shop4.dmg_heal` | 商店第5格：治疗（1/0） |
| 995 | `shop4.skillAtk` | 商店第5格：技能攻击倍率 |
| 996 | `shop4.skillTimes` | 商店第5格：技能连击次数 |
| 997 | `shop4.skillSp` | 商店第5格：技能费用（SP） |
| 998 | `shop4.row` | 商店第5格：站位行（场上才有） |
| 999 | `shop4.col` | 商店第5格：站位列 |
| 1000 | `shop4.items` | 商店第5格：装备件数 |
| 1001 | `shop4.itemTier` | 商店第5格：装备阶之和 |
| 1002 | `shop4.copies` | 商店第5格：自己一共有几张同名（含精锐） |
| 1003 | `shop4.b_yanShip` | 商店第5格：属于盟约 yanShip（1/0） |
| 1004 | `shop4.b_sargonShip` | 商店第5格：属于盟约 sargonShip（1/0） |
| 1005 | `shop4.b_victoriaShip` | 商店第5格：属于盟约 victoriaShip（1/0） |
| 1006 | `shop4.b_kjeragShip` | 商店第5格：属于盟约 kjeragShip（1/0） |
| 1007 | `shop4.b_lateranoShip` | 商店第5格：属于盟约 lateranoShip（1/0） |
| 1008 | `shop4.b_egirShip` | 商店第5格：属于盟约 egirShip（1/0） |
| 1009 | `shop4.b_siracusaShip` | 商店第5格：属于盟约 siracusaShip（1/0） |
| 1010 | `shop4.b_kazimierzShip` | 商店第5格：属于盟约 kazimierzShip（1/0） |
| 1011 | `shop4.b_preciShip` | 商店第5格：属于盟约 preciShip（1/0） |
| 1012 | `shop4.b_swiftShip` | 商店第5格：属于盟约 swiftShip（1/0） |
| 1013 | `shop4.b_skillfulShip` | 商店第5格：属于盟约 skillfulShip（1/0） |
| 1014 | `shop4.b_arcaneShip` | 商店第5格：属于盟约 arcaneShip（1/0） |
| 1015 | `shop4.b_steadShip` | 商店第5格：属于盟约 steadShip（1/0） |
| 1016 | `shop4.b_deputShip` | 商店第5格：属于盟约 deputShip（1/0） |
| 1017 | `shop4.b_visiShip` | 商店第5格：属于盟约 visiShip（1/0） |
| 1018 | `shop4.b_miraShip` | 商店第5格：属于盟约 miraShip（1/0） |
| 1019 | `shop4.b_investShip` | 商店第5格：属于盟约 investShip（1/0） |
| 1020 | `shop4.b_raidShip` | 商店第5格：属于盟约 raidShip（1/0） |
| 1021 | `shop4.b_indomShip` | 商店第5格：属于盟约 indomShip（1/0） |
| 1022 | `shop4.b_maniShip` | 商店第5格：属于盟约 maniShip（1/0） |
| 1023 | `shop4.b_emptyShip` | 商店第5格：属于盟约 emptyShip（1/0） |
| 1024 | `shop4.b_soloShip` | 商店第5格：属于盟约 soloShip（1/0） |
| 1025 | `shop4.b_suntShip` | 商店第5格：属于盟约 suntShip（1/0） |
| 1026 | `bond.yanShip.count` | 自己的盟约 yanShip：在场人数（盟约计数） |
| 1027 | `bond.yanShip.tier` | 自己的盟约 yanShip：激活档位 |
| 1028 | `bond.yanShip.active` | 自己的盟约 yanShip：是否激活（1/0） |
| 1029 | `bond.yanShip.layers` | 自己的盟约 yanShip：层数 |
| 1030 | `bond.yanShip.pace` | 自己的盟约 yanShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1031 | `bond.yanShip.projR13` | 自己的盟约 yanShip：按幂律外推到 R13 的层数 |
| 1032 | `bond.sargonShip.count` | 自己的盟约 sargonShip：在场人数（盟约计数） |
| 1033 | `bond.sargonShip.tier` | 自己的盟约 sargonShip：激活档位 |
| 1034 | `bond.sargonShip.active` | 自己的盟约 sargonShip：是否激活（1/0） |
| 1035 | `bond.sargonShip.layers` | 自己的盟约 sargonShip：层数 |
| 1036 | `bond.sargonShip.pace` | 自己的盟约 sargonShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1037 | `bond.sargonShip.projR13` | 自己的盟约 sargonShip：按幂律外推到 R13 的层数 |
| 1038 | `bond.victoriaShip.count` | 自己的盟约 victoriaShip：在场人数（盟约计数） |
| 1039 | `bond.victoriaShip.tier` | 自己的盟约 victoriaShip：激活档位 |
| 1040 | `bond.victoriaShip.active` | 自己的盟约 victoriaShip：是否激活（1/0） |
| 1041 | `bond.victoriaShip.layers` | 自己的盟约 victoriaShip：层数 |
| 1042 | `bond.victoriaShip.pace` | 自己的盟约 victoriaShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1043 | `bond.victoriaShip.projR13` | 自己的盟约 victoriaShip：按幂律外推到 R13 的层数 |
| 1044 | `bond.kjeragShip.count` | 自己的盟约 kjeragShip：在场人数（盟约计数） |
| 1045 | `bond.kjeragShip.tier` | 自己的盟约 kjeragShip：激活档位 |
| 1046 | `bond.kjeragShip.active` | 自己的盟约 kjeragShip：是否激活（1/0） |
| 1047 | `bond.kjeragShip.layers` | 自己的盟约 kjeragShip：层数 |
| 1048 | `bond.kjeragShip.pace` | 自己的盟约 kjeragShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1049 | `bond.kjeragShip.projR13` | 自己的盟约 kjeragShip：按幂律外推到 R13 的层数 |
| 1050 | `bond.lateranoShip.count` | 自己的盟约 lateranoShip：在场人数（盟约计数） |
| 1051 | `bond.lateranoShip.tier` | 自己的盟约 lateranoShip：激活档位 |
| 1052 | `bond.lateranoShip.active` | 自己的盟约 lateranoShip：是否激活（1/0） |
| 1053 | `bond.lateranoShip.layers` | 自己的盟约 lateranoShip：层数 |
| 1054 | `bond.lateranoShip.pace` | 自己的盟约 lateranoShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1055 | `bond.lateranoShip.projR13` | 自己的盟约 lateranoShip：按幂律外推到 R13 的层数 |
| 1056 | `bond.egirShip.count` | 自己的盟约 egirShip：在场人数（盟约计数） |
| 1057 | `bond.egirShip.tier` | 自己的盟约 egirShip：激活档位 |
| 1058 | `bond.egirShip.active` | 自己的盟约 egirShip：是否激活（1/0） |
| 1059 | `bond.egirShip.layers` | 自己的盟约 egirShip：层数 |
| 1060 | `bond.egirShip.pace` | 自己的盟约 egirShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1061 | `bond.egirShip.projR13` | 自己的盟约 egirShip：按幂律外推到 R13 的层数 |
| 1062 | `bond.siracusaShip.count` | 自己的盟约 siracusaShip：在场人数（盟约计数） |
| 1063 | `bond.siracusaShip.tier` | 自己的盟约 siracusaShip：激活档位 |
| 1064 | `bond.siracusaShip.active` | 自己的盟约 siracusaShip：是否激活（1/0） |
| 1065 | `bond.siracusaShip.layers` | 自己的盟约 siracusaShip：层数 |
| 1066 | `bond.siracusaShip.pace` | 自己的盟约 siracusaShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1067 | `bond.siracusaShip.projR13` | 自己的盟约 siracusaShip：按幂律外推到 R13 的层数 |
| 1068 | `bond.kazimierzShip.count` | 自己的盟约 kazimierzShip：在场人数（盟约计数） |
| 1069 | `bond.kazimierzShip.tier` | 自己的盟约 kazimierzShip：激活档位 |
| 1070 | `bond.kazimierzShip.active` | 自己的盟约 kazimierzShip：是否激活（1/0） |
| 1071 | `bond.kazimierzShip.layers` | 自己的盟约 kazimierzShip：层数 |
| 1072 | `bond.kazimierzShip.pace` | 自己的盟约 kazimierzShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1073 | `bond.kazimierzShip.projR13` | 自己的盟约 kazimierzShip：按幂律外推到 R13 的层数 |
| 1074 | `bond.preciShip.count` | 自己的盟约 preciShip：在场人数（盟约计数） |
| 1075 | `bond.preciShip.tier` | 自己的盟约 preciShip：激活档位 |
| 1076 | `bond.preciShip.active` | 自己的盟约 preciShip：是否激活（1/0） |
| 1077 | `bond.preciShip.layers` | 自己的盟约 preciShip：层数 |
| 1078 | `bond.preciShip.pace` | 自己的盟约 preciShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1079 | `bond.preciShip.projR13` | 自己的盟约 preciShip：按幂律外推到 R13 的层数 |
| 1080 | `bond.swiftShip.count` | 自己的盟约 swiftShip：在场人数（盟约计数） |
| 1081 | `bond.swiftShip.tier` | 自己的盟约 swiftShip：激活档位 |
| 1082 | `bond.swiftShip.active` | 自己的盟约 swiftShip：是否激活（1/0） |
| 1083 | `bond.swiftShip.layers` | 自己的盟约 swiftShip：层数 |
| 1084 | `bond.swiftShip.pace` | 自己的盟约 swiftShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1085 | `bond.swiftShip.projR13` | 自己的盟约 swiftShip：按幂律外推到 R13 的层数 |
| 1086 | `bond.skillfulShip.count` | 自己的盟约 skillfulShip：在场人数（盟约计数） |
| 1087 | `bond.skillfulShip.tier` | 自己的盟约 skillfulShip：激活档位 |
| 1088 | `bond.skillfulShip.active` | 自己的盟约 skillfulShip：是否激活（1/0） |
| 1089 | `bond.skillfulShip.layers` | 自己的盟约 skillfulShip：层数 |
| 1090 | `bond.skillfulShip.pace` | 自己的盟约 skillfulShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1091 | `bond.skillfulShip.projR13` | 自己的盟约 skillfulShip：按幂律外推到 R13 的层数 |
| 1092 | `bond.arcaneShip.count` | 自己的盟约 arcaneShip：在场人数（盟约计数） |
| 1093 | `bond.arcaneShip.tier` | 自己的盟约 arcaneShip：激活档位 |
| 1094 | `bond.arcaneShip.active` | 自己的盟约 arcaneShip：是否激活（1/0） |
| 1095 | `bond.arcaneShip.layers` | 自己的盟约 arcaneShip：层数 |
| 1096 | `bond.arcaneShip.pace` | 自己的盟约 arcaneShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1097 | `bond.arcaneShip.projR13` | 自己的盟约 arcaneShip：按幂律外推到 R13 的层数 |
| 1098 | `bond.steadShip.count` | 自己的盟约 steadShip：在场人数（盟约计数） |
| 1099 | `bond.steadShip.tier` | 自己的盟约 steadShip：激活档位 |
| 1100 | `bond.steadShip.active` | 自己的盟约 steadShip：是否激活（1/0） |
| 1101 | `bond.steadShip.layers` | 自己的盟约 steadShip：层数 |
| 1102 | `bond.steadShip.pace` | 自己的盟约 steadShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1103 | `bond.steadShip.projR13` | 自己的盟约 steadShip：按幂律外推到 R13 的层数 |
| 1104 | `bond.deputShip.count` | 自己的盟约 deputShip：在场人数（盟约计数） |
| 1105 | `bond.deputShip.tier` | 自己的盟约 deputShip：激活档位 |
| 1106 | `bond.deputShip.active` | 自己的盟约 deputShip：是否激活（1/0） |
| 1107 | `bond.deputShip.layers` | 自己的盟约 deputShip：层数 |
| 1108 | `bond.deputShip.pace` | 自己的盟约 deputShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1109 | `bond.deputShip.projR13` | 自己的盟约 deputShip：按幂律外推到 R13 的层数 |
| 1110 | `bond.visiShip.count` | 自己的盟约 visiShip：在场人数（盟约计数） |
| 1111 | `bond.visiShip.tier` | 自己的盟约 visiShip：激活档位 |
| 1112 | `bond.visiShip.active` | 自己的盟约 visiShip：是否激活（1/0） |
| 1113 | `bond.visiShip.layers` | 自己的盟约 visiShip：层数 |
| 1114 | `bond.visiShip.pace` | 自己的盟约 visiShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1115 | `bond.visiShip.projR13` | 自己的盟约 visiShip：按幂律外推到 R13 的层数 |
| 1116 | `bond.miraShip.count` | 自己的盟约 miraShip：在场人数（盟约计数） |
| 1117 | `bond.miraShip.tier` | 自己的盟约 miraShip：激活档位 |
| 1118 | `bond.miraShip.active` | 自己的盟约 miraShip：是否激活（1/0） |
| 1119 | `bond.miraShip.layers` | 自己的盟约 miraShip：层数 |
| 1120 | `bond.miraShip.pace` | 自己的盟约 miraShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1121 | `bond.miraShip.projR13` | 自己的盟约 miraShip：按幂律外推到 R13 的层数 |
| 1122 | `bond.investShip.count` | 自己的盟约 investShip：在场人数（盟约计数） |
| 1123 | `bond.investShip.tier` | 自己的盟约 investShip：激活档位 |
| 1124 | `bond.investShip.active` | 自己的盟约 investShip：是否激活（1/0） |
| 1125 | `bond.investShip.layers` | 自己的盟约 investShip：层数 |
| 1126 | `bond.investShip.pace` | 自己的盟约 investShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1127 | `bond.investShip.projR13` | 自己的盟约 investShip：按幂律外推到 R13 的层数 |
| 1128 | `bond.raidShip.count` | 自己的盟约 raidShip：在场人数（盟约计数） |
| 1129 | `bond.raidShip.tier` | 自己的盟约 raidShip：激活档位 |
| 1130 | `bond.raidShip.active` | 自己的盟约 raidShip：是否激活（1/0） |
| 1131 | `bond.raidShip.layers` | 自己的盟约 raidShip：层数 |
| 1132 | `bond.raidShip.pace` | 自己的盟约 raidShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1133 | `bond.raidShip.projR13` | 自己的盟约 raidShip：按幂律外推到 R13 的层数 |
| 1134 | `bond.indomShip.count` | 自己的盟约 indomShip：在场人数（盟约计数） |
| 1135 | `bond.indomShip.tier` | 自己的盟约 indomShip：激活档位 |
| 1136 | `bond.indomShip.active` | 自己的盟约 indomShip：是否激活（1/0） |
| 1137 | `bond.indomShip.layers` | 自己的盟约 indomShip：层数 |
| 1138 | `bond.indomShip.pace` | 自己的盟约 indomShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1139 | `bond.indomShip.projR13` | 自己的盟约 indomShip：按幂律外推到 R13 的层数 |
| 1140 | `bond.maniShip.count` | 自己的盟约 maniShip：在场人数（盟约计数） |
| 1141 | `bond.maniShip.tier` | 自己的盟约 maniShip：激活档位 |
| 1142 | `bond.maniShip.active` | 自己的盟约 maniShip：是否激活（1/0） |
| 1143 | `bond.maniShip.layers` | 自己的盟约 maniShip：层数 |
| 1144 | `bond.maniShip.pace` | 自己的盟约 maniShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1145 | `bond.maniShip.projR13` | 自己的盟约 maniShip：按幂律外推到 R13 的层数 |
| 1146 | `bond.emptyShip.count` | 自己的盟约 emptyShip：在场人数（盟约计数） |
| 1147 | `bond.emptyShip.tier` | 自己的盟约 emptyShip：激活档位 |
| 1148 | `bond.emptyShip.active` | 自己的盟约 emptyShip：是否激活（1/0） |
| 1149 | `bond.emptyShip.layers` | 自己的盟约 emptyShip：层数 |
| 1150 | `bond.emptyShip.pace` | 自己的盟约 emptyShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1151 | `bond.emptyShip.projR13` | 自己的盟约 emptyShip：按幂律外推到 R13 的层数 |
| 1152 | `bond.soloShip.count` | 自己的盟约 soloShip：在场人数（盟约计数） |
| 1153 | `bond.soloShip.tier` | 自己的盟约 soloShip：激活档位 |
| 1154 | `bond.soloShip.active` | 自己的盟约 soloShip：是否激活（1/0） |
| 1155 | `bond.soloShip.layers` | 自己的盟约 soloShip：层数 |
| 1156 | `bond.soloShip.pace` | 自己的盟约 soloShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1157 | `bond.soloShip.projR13` | 自己的盟约 soloShip：按幂律外推到 R13 的层数 |
| 1158 | `bond.suntShip.count` | 自己的盟约 suntShip：在场人数（盟约计数） |
| 1159 | `bond.suntShip.tier` | 自己的盟约 suntShip：激活档位 |
| 1160 | `bond.suntShip.active` | 自己的盟约 suntShip：是否激活（1/0） |
| 1161 | `bond.suntShip.layers` | 自己的盟约 suntShip：层数 |
| 1162 | `bond.suntShip.pace` | 自己的盟约 suntShip：层数 ÷ 自然开局同回合的参考层数（快慢） |
| 1163 | `bond.suntShip.projR13` | 自己的盟约 suntShip：按幂律外推到 R13 的层数 |
| 1164 | `boss.boss_1` | R14 BOSS 是 boss_1（1/0） |
| 1165 | `boss.boss_2` | R14 BOSS 是 boss_2（1/0） |
| 1166 | `boss.boss_3` | R14 BOSS 是 boss_3（1/0） |
| 1167 | `boss.boss_4` | R14 BOSS 是 boss_4（1/0） |
| 1168 | `boss.boss_5` | R14 BOSS 是 boss_5（1/0） |
| 1169 | `boss.boss_6` | R14 BOSS 是 boss_6（1/0） |
| 1170 | `boss.boss_7` | R14 BOSS 是 boss_7（1/0） |
| 1171 | `boss.boss_8` | R14 BOSS 是 boss_8（1/0） |
| 1172 | `boss.boss_9` | R14 BOSS 是 boss_9（1/0） |
| 1173 | `boss.boss_10` | R14 BOSS 是 boss_10（1/0） |
| 1174 | `hidden.boss_1` | 隐藏 BOSS 是 boss_1（只在 R15 揭晓后为 1） |
| 1175 | `hidden.boss_2` | 隐藏 BOSS 是 boss_2（只在 R15 揭晓后为 1） |
| 1176 | `hidden.boss_3` | 隐藏 BOSS 是 boss_3（只在 R15 揭晓后为 1） |
| 1177 | `hidden.boss_4` | 隐藏 BOSS 是 boss_4（只在 R15 揭晓后为 1） |
| 1178 | `hidden.boss_5` | 隐藏 BOSS 是 boss_5（只在 R15 揭晓后为 1） |
| 1179 | `hidden.boss_6` | 隐藏 BOSS 是 boss_6（只在 R15 揭晓后为 1） |
| 1180 | `hidden.boss_7` | 隐藏 BOSS 是 boss_7（只在 R15 揭晓后为 1） |
| 1181 | `hidden.boss_8` | 隐藏 BOSS 是 boss_8（只在 R15 揭晓后为 1） |
| 1182 | `hidden.boss_9` | 隐藏 BOSS 是 boss_9（只在 R15 揭晓后为 1） |
| 1183 | `hidden.boss_10` | 隐藏 BOSS 是 boss_10（只在 R15 揭晓后为 1） |
| 1184 | `mate+1.present` | 下家第 1 位队友（公开）：这个座位有人（1/0） |
| 1185 | `mate+1.alive` | 下家第 1 位队友（公开）：活着（1/0） |
| 1186 | `mate+1.lp` | 下家第 1 位队友（公开）：血 |
| 1187 | `mate+1.level` | 下家第 1 位队友（公开）：商店等级 |
| 1188 | `mate+1.board` | 下家第 1 位队友（公开）：上场人数 |
| 1189 | `mate+1.layersTotal` | 下家第 1 位队友（公开）：所有盟约层数之和 |
| 1190 | `mate+1.mainLayers` | 下家第 1 位队友（公开）：层数最多的那条盟约的层数 |
| 1191 | `mate+1.yanShip.count` | 下家第 1 位队友（公开）：盟约 yanShip 的在场人数 |
| 1192 | `mate+1.yanShip.layers` | 下家第 1 位队友（公开）：盟约 yanShip 的层数 |
| 1193 | `mate+1.sargonShip.count` | 下家第 1 位队友（公开）：盟约 sargonShip 的在场人数 |
| 1194 | `mate+1.sargonShip.layers` | 下家第 1 位队友（公开）：盟约 sargonShip 的层数 |
| 1195 | `mate+1.victoriaShip.count` | 下家第 1 位队友（公开）：盟约 victoriaShip 的在场人数 |
| 1196 | `mate+1.victoriaShip.layers` | 下家第 1 位队友（公开）：盟约 victoriaShip 的层数 |
| 1197 | `mate+1.kjeragShip.count` | 下家第 1 位队友（公开）：盟约 kjeragShip 的在场人数 |
| 1198 | `mate+1.kjeragShip.layers` | 下家第 1 位队友（公开）：盟约 kjeragShip 的层数 |
| 1199 | `mate+1.lateranoShip.count` | 下家第 1 位队友（公开）：盟约 lateranoShip 的在场人数 |
| 1200 | `mate+1.lateranoShip.layers` | 下家第 1 位队友（公开）：盟约 lateranoShip 的层数 |
| 1201 | `mate+1.egirShip.count` | 下家第 1 位队友（公开）：盟约 egirShip 的在场人数 |
| 1202 | `mate+1.egirShip.layers` | 下家第 1 位队友（公开）：盟约 egirShip 的层数 |
| 1203 | `mate+1.siracusaShip.count` | 下家第 1 位队友（公开）：盟约 siracusaShip 的在场人数 |
| 1204 | `mate+1.siracusaShip.layers` | 下家第 1 位队友（公开）：盟约 siracusaShip 的层数 |
| 1205 | `mate+1.kazimierzShip.count` | 下家第 1 位队友（公开）：盟约 kazimierzShip 的在场人数 |
| 1206 | `mate+1.kazimierzShip.layers` | 下家第 1 位队友（公开）：盟约 kazimierzShip 的层数 |
| 1207 | `mate+1.preciShip.count` | 下家第 1 位队友（公开）：盟约 preciShip 的在场人数 |
| 1208 | `mate+1.preciShip.layers` | 下家第 1 位队友（公开）：盟约 preciShip 的层数 |
| 1209 | `mate+1.swiftShip.count` | 下家第 1 位队友（公开）：盟约 swiftShip 的在场人数 |
| 1210 | `mate+1.swiftShip.layers` | 下家第 1 位队友（公开）：盟约 swiftShip 的层数 |
| 1211 | `mate+1.skillfulShip.count` | 下家第 1 位队友（公开）：盟约 skillfulShip 的在场人数 |
| 1212 | `mate+1.skillfulShip.layers` | 下家第 1 位队友（公开）：盟约 skillfulShip 的层数 |
| 1213 | `mate+1.arcaneShip.count` | 下家第 1 位队友（公开）：盟约 arcaneShip 的在场人数 |
| 1214 | `mate+1.arcaneShip.layers` | 下家第 1 位队友（公开）：盟约 arcaneShip 的层数 |
| 1215 | `mate+1.steadShip.count` | 下家第 1 位队友（公开）：盟约 steadShip 的在场人数 |
| 1216 | `mate+1.steadShip.layers` | 下家第 1 位队友（公开）：盟约 steadShip 的层数 |
| 1217 | `mate+1.deputShip.count` | 下家第 1 位队友（公开）：盟约 deputShip 的在场人数 |
| 1218 | `mate+1.deputShip.layers` | 下家第 1 位队友（公开）：盟约 deputShip 的层数 |
| 1219 | `mate+1.visiShip.count` | 下家第 1 位队友（公开）：盟约 visiShip 的在场人数 |
| 1220 | `mate+1.visiShip.layers` | 下家第 1 位队友（公开）：盟约 visiShip 的层数 |
| 1221 | `mate+1.miraShip.count` | 下家第 1 位队友（公开）：盟约 miraShip 的在场人数 |
| 1222 | `mate+1.miraShip.layers` | 下家第 1 位队友（公开）：盟约 miraShip 的层数 |
| 1223 | `mate+1.investShip.count` | 下家第 1 位队友（公开）：盟约 investShip 的在场人数 |
| 1224 | `mate+1.investShip.layers` | 下家第 1 位队友（公开）：盟约 investShip 的层数 |
| 1225 | `mate+1.raidShip.count` | 下家第 1 位队友（公开）：盟约 raidShip 的在场人数 |
| 1226 | `mate+1.raidShip.layers` | 下家第 1 位队友（公开）：盟约 raidShip 的层数 |
| 1227 | `mate+1.indomShip.count` | 下家第 1 位队友（公开）：盟约 indomShip 的在场人数 |
| 1228 | `mate+1.indomShip.layers` | 下家第 1 位队友（公开）：盟约 indomShip 的层数 |
| 1229 | `mate+1.maniShip.count` | 下家第 1 位队友（公开）：盟约 maniShip 的在场人数 |
| 1230 | `mate+1.maniShip.layers` | 下家第 1 位队友（公开）：盟约 maniShip 的层数 |
| 1231 | `mate+1.emptyShip.count` | 下家第 1 位队友（公开）：盟约 emptyShip 的在场人数 |
| 1232 | `mate+1.emptyShip.layers` | 下家第 1 位队友（公开）：盟约 emptyShip 的层数 |
| 1233 | `mate+1.soloShip.count` | 下家第 1 位队友（公开）：盟约 soloShip 的在场人数 |
| 1234 | `mate+1.soloShip.layers` | 下家第 1 位队友（公开）：盟约 soloShip 的层数 |
| 1235 | `mate+1.suntShip.count` | 下家第 1 位队友（公开）：盟约 suntShip 的在场人数 |
| 1236 | `mate+1.suntShip.layers` | 下家第 1 位队友（公开）：盟约 suntShip 的层数 |
| 1237 | `mate+2.present` | 下家第 2 位队友（公开）：这个座位有人（1/0） |
| 1238 | `mate+2.alive` | 下家第 2 位队友（公开）：活着（1/0） |
| 1239 | `mate+2.lp` | 下家第 2 位队友（公开）：血 |
| 1240 | `mate+2.level` | 下家第 2 位队友（公开）：商店等级 |
| 1241 | `mate+2.board` | 下家第 2 位队友（公开）：上场人数 |
| 1242 | `mate+2.layersTotal` | 下家第 2 位队友（公开）：所有盟约层数之和 |
| 1243 | `mate+2.mainLayers` | 下家第 2 位队友（公开）：层数最多的那条盟约的层数 |
| 1244 | `mate+2.yanShip.count` | 下家第 2 位队友（公开）：盟约 yanShip 的在场人数 |
| 1245 | `mate+2.yanShip.layers` | 下家第 2 位队友（公开）：盟约 yanShip 的层数 |
| 1246 | `mate+2.sargonShip.count` | 下家第 2 位队友（公开）：盟约 sargonShip 的在场人数 |
| 1247 | `mate+2.sargonShip.layers` | 下家第 2 位队友（公开）：盟约 sargonShip 的层数 |
| 1248 | `mate+2.victoriaShip.count` | 下家第 2 位队友（公开）：盟约 victoriaShip 的在场人数 |
| 1249 | `mate+2.victoriaShip.layers` | 下家第 2 位队友（公开）：盟约 victoriaShip 的层数 |
| 1250 | `mate+2.kjeragShip.count` | 下家第 2 位队友（公开）：盟约 kjeragShip 的在场人数 |
| 1251 | `mate+2.kjeragShip.layers` | 下家第 2 位队友（公开）：盟约 kjeragShip 的层数 |
| 1252 | `mate+2.lateranoShip.count` | 下家第 2 位队友（公开）：盟约 lateranoShip 的在场人数 |
| 1253 | `mate+2.lateranoShip.layers` | 下家第 2 位队友（公开）：盟约 lateranoShip 的层数 |
| 1254 | `mate+2.egirShip.count` | 下家第 2 位队友（公开）：盟约 egirShip 的在场人数 |
| 1255 | `mate+2.egirShip.layers` | 下家第 2 位队友（公开）：盟约 egirShip 的层数 |
| 1256 | `mate+2.siracusaShip.count` | 下家第 2 位队友（公开）：盟约 siracusaShip 的在场人数 |
| 1257 | `mate+2.siracusaShip.layers` | 下家第 2 位队友（公开）：盟约 siracusaShip 的层数 |
| 1258 | `mate+2.kazimierzShip.count` | 下家第 2 位队友（公开）：盟约 kazimierzShip 的在场人数 |
| 1259 | `mate+2.kazimierzShip.layers` | 下家第 2 位队友（公开）：盟约 kazimierzShip 的层数 |
| 1260 | `mate+2.preciShip.count` | 下家第 2 位队友（公开）：盟约 preciShip 的在场人数 |
| 1261 | `mate+2.preciShip.layers` | 下家第 2 位队友（公开）：盟约 preciShip 的层数 |
| 1262 | `mate+2.swiftShip.count` | 下家第 2 位队友（公开）：盟约 swiftShip 的在场人数 |
| 1263 | `mate+2.swiftShip.layers` | 下家第 2 位队友（公开）：盟约 swiftShip 的层数 |
| 1264 | `mate+2.skillfulShip.count` | 下家第 2 位队友（公开）：盟约 skillfulShip 的在场人数 |
| 1265 | `mate+2.skillfulShip.layers` | 下家第 2 位队友（公开）：盟约 skillfulShip 的层数 |
| 1266 | `mate+2.arcaneShip.count` | 下家第 2 位队友（公开）：盟约 arcaneShip 的在场人数 |
| 1267 | `mate+2.arcaneShip.layers` | 下家第 2 位队友（公开）：盟约 arcaneShip 的层数 |
| 1268 | `mate+2.steadShip.count` | 下家第 2 位队友（公开）：盟约 steadShip 的在场人数 |
| 1269 | `mate+2.steadShip.layers` | 下家第 2 位队友（公开）：盟约 steadShip 的层数 |
| 1270 | `mate+2.deputShip.count` | 下家第 2 位队友（公开）：盟约 deputShip 的在场人数 |
| 1271 | `mate+2.deputShip.layers` | 下家第 2 位队友（公开）：盟约 deputShip 的层数 |
| 1272 | `mate+2.visiShip.count` | 下家第 2 位队友（公开）：盟约 visiShip 的在场人数 |
| 1273 | `mate+2.visiShip.layers` | 下家第 2 位队友（公开）：盟约 visiShip 的层数 |
| 1274 | `mate+2.miraShip.count` | 下家第 2 位队友（公开）：盟约 miraShip 的在场人数 |
| 1275 | `mate+2.miraShip.layers` | 下家第 2 位队友（公开）：盟约 miraShip 的层数 |
| 1276 | `mate+2.investShip.count` | 下家第 2 位队友（公开）：盟约 investShip 的在场人数 |
| 1277 | `mate+2.investShip.layers` | 下家第 2 位队友（公开）：盟约 investShip 的层数 |
| 1278 | `mate+2.raidShip.count` | 下家第 2 位队友（公开）：盟约 raidShip 的在场人数 |
| 1279 | `mate+2.raidShip.layers` | 下家第 2 位队友（公开）：盟约 raidShip 的层数 |
| 1280 | `mate+2.indomShip.count` | 下家第 2 位队友（公开）：盟约 indomShip 的在场人数 |
| 1281 | `mate+2.indomShip.layers` | 下家第 2 位队友（公开）：盟约 indomShip 的层数 |
| 1282 | `mate+2.maniShip.count` | 下家第 2 位队友（公开）：盟约 maniShip 的在场人数 |
| 1283 | `mate+2.maniShip.layers` | 下家第 2 位队友（公开）：盟约 maniShip 的层数 |
| 1284 | `mate+2.emptyShip.count` | 下家第 2 位队友（公开）：盟约 emptyShip 的在场人数 |
| 1285 | `mate+2.emptyShip.layers` | 下家第 2 位队友（公开）：盟约 emptyShip 的层数 |
| 1286 | `mate+2.soloShip.count` | 下家第 2 位队友（公开）：盟约 soloShip 的在场人数 |
| 1287 | `mate+2.soloShip.layers` | 下家第 2 位队友（公开）：盟约 soloShip 的层数 |
| 1288 | `mate+2.suntShip.count` | 下家第 2 位队友（公开）：盟约 suntShip 的在场人数 |
| 1289 | `mate+2.suntShip.layers` | 下家第 2 位队友（公开）：盟约 suntShip 的层数 |
| 1290 | `mate+3.present` | 下家第 3 位队友（公开）：这个座位有人（1/0） |
| 1291 | `mate+3.alive` | 下家第 3 位队友（公开）：活着（1/0） |
| 1292 | `mate+3.lp` | 下家第 3 位队友（公开）：血 |
| 1293 | `mate+3.level` | 下家第 3 位队友（公开）：商店等级 |
| 1294 | `mate+3.board` | 下家第 3 位队友（公开）：上场人数 |
| 1295 | `mate+3.layersTotal` | 下家第 3 位队友（公开）：所有盟约层数之和 |
| 1296 | `mate+3.mainLayers` | 下家第 3 位队友（公开）：层数最多的那条盟约的层数 |
| 1297 | `mate+3.yanShip.count` | 下家第 3 位队友（公开）：盟约 yanShip 的在场人数 |
| 1298 | `mate+3.yanShip.layers` | 下家第 3 位队友（公开）：盟约 yanShip 的层数 |
| 1299 | `mate+3.sargonShip.count` | 下家第 3 位队友（公开）：盟约 sargonShip 的在场人数 |
| 1300 | `mate+3.sargonShip.layers` | 下家第 3 位队友（公开）：盟约 sargonShip 的层数 |
| 1301 | `mate+3.victoriaShip.count` | 下家第 3 位队友（公开）：盟约 victoriaShip 的在场人数 |
| 1302 | `mate+3.victoriaShip.layers` | 下家第 3 位队友（公开）：盟约 victoriaShip 的层数 |
| 1303 | `mate+3.kjeragShip.count` | 下家第 3 位队友（公开）：盟约 kjeragShip 的在场人数 |
| 1304 | `mate+3.kjeragShip.layers` | 下家第 3 位队友（公开）：盟约 kjeragShip 的层数 |
| 1305 | `mate+3.lateranoShip.count` | 下家第 3 位队友（公开）：盟约 lateranoShip 的在场人数 |
| 1306 | `mate+3.lateranoShip.layers` | 下家第 3 位队友（公开）：盟约 lateranoShip 的层数 |
| 1307 | `mate+3.egirShip.count` | 下家第 3 位队友（公开）：盟约 egirShip 的在场人数 |
| 1308 | `mate+3.egirShip.layers` | 下家第 3 位队友（公开）：盟约 egirShip 的层数 |
| 1309 | `mate+3.siracusaShip.count` | 下家第 3 位队友（公开）：盟约 siracusaShip 的在场人数 |
| 1310 | `mate+3.siracusaShip.layers` | 下家第 3 位队友（公开）：盟约 siracusaShip 的层数 |
| 1311 | `mate+3.kazimierzShip.count` | 下家第 3 位队友（公开）：盟约 kazimierzShip 的在场人数 |
| 1312 | `mate+3.kazimierzShip.layers` | 下家第 3 位队友（公开）：盟约 kazimierzShip 的层数 |
| 1313 | `mate+3.preciShip.count` | 下家第 3 位队友（公开）：盟约 preciShip 的在场人数 |
| 1314 | `mate+3.preciShip.layers` | 下家第 3 位队友（公开）：盟约 preciShip 的层数 |
| 1315 | `mate+3.swiftShip.count` | 下家第 3 位队友（公开）：盟约 swiftShip 的在场人数 |
| 1316 | `mate+3.swiftShip.layers` | 下家第 3 位队友（公开）：盟约 swiftShip 的层数 |
| 1317 | `mate+3.skillfulShip.count` | 下家第 3 位队友（公开）：盟约 skillfulShip 的在场人数 |
| 1318 | `mate+3.skillfulShip.layers` | 下家第 3 位队友（公开）：盟约 skillfulShip 的层数 |
| 1319 | `mate+3.arcaneShip.count` | 下家第 3 位队友（公开）：盟约 arcaneShip 的在场人数 |
| 1320 | `mate+3.arcaneShip.layers` | 下家第 3 位队友（公开）：盟约 arcaneShip 的层数 |
| 1321 | `mate+3.steadShip.count` | 下家第 3 位队友（公开）：盟约 steadShip 的在场人数 |
| 1322 | `mate+3.steadShip.layers` | 下家第 3 位队友（公开）：盟约 steadShip 的层数 |
| 1323 | `mate+3.deputShip.count` | 下家第 3 位队友（公开）：盟约 deputShip 的在场人数 |
| 1324 | `mate+3.deputShip.layers` | 下家第 3 位队友（公开）：盟约 deputShip 的层数 |
| 1325 | `mate+3.visiShip.count` | 下家第 3 位队友（公开）：盟约 visiShip 的在场人数 |
| 1326 | `mate+3.visiShip.layers` | 下家第 3 位队友（公开）：盟约 visiShip 的层数 |
| 1327 | `mate+3.miraShip.count` | 下家第 3 位队友（公开）：盟约 miraShip 的在场人数 |
| 1328 | `mate+3.miraShip.layers` | 下家第 3 位队友（公开）：盟约 miraShip 的层数 |
| 1329 | `mate+3.investShip.count` | 下家第 3 位队友（公开）：盟约 investShip 的在场人数 |
| 1330 | `mate+3.investShip.layers` | 下家第 3 位队友（公开）：盟约 investShip 的层数 |
| 1331 | `mate+3.raidShip.count` | 下家第 3 位队友（公开）：盟约 raidShip 的在场人数 |
| 1332 | `mate+3.raidShip.layers` | 下家第 3 位队友（公开）：盟约 raidShip 的层数 |
| 1333 | `mate+3.indomShip.count` | 下家第 3 位队友（公开）：盟约 indomShip 的在场人数 |
| 1334 | `mate+3.indomShip.layers` | 下家第 3 位队友（公开）：盟约 indomShip 的层数 |
| 1335 | `mate+3.maniShip.count` | 下家第 3 位队友（公开）：盟约 maniShip 的在场人数 |
| 1336 | `mate+3.maniShip.layers` | 下家第 3 位队友（公开）：盟约 maniShip 的层数 |
| 1337 | `mate+3.emptyShip.count` | 下家第 3 位队友（公开）：盟约 emptyShip 的在场人数 |
| 1338 | `mate+3.emptyShip.layers` | 下家第 3 位队友（公开）：盟约 emptyShip 的层数 |
| 1339 | `mate+3.soloShip.count` | 下家第 3 位队友（公开）：盟约 soloShip 的在场人数 |
| 1340 | `mate+3.soloShip.layers` | 下家第 3 位队友（公开）：盟约 soloShip 的层数 |
| 1341 | `mate+3.suntShip.count` | 下家第 3 位队友（公开）：盟约 suntShip 的在场人数 |
| 1342 | `mate+3.suntShip.layers` | 下家第 3 位队友（公开）：盟约 suntShip 的层数 |
