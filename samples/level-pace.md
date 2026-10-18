# 实验记录：level-pace

## Arm 1: baseline
命令：
```pwsh
node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 3 --rehearsal 1 --lp 45
```

输出末尾 6 行：
```text
coop ABYSS · 4 seat(s) · seeds 1..3
  rounds passed: avg 11.67 · min 9 · max 13 · wins 0/3 · hidden 0
  distribution: 9:1  13:2
  avg LP of alive players after each round: R1:45.0(12) R2:45.0(12) R3:44.9(12) R4:43.4(12) R5:41.5(12) R6:38.9(12) R7:34.3(12) R8:28.1(12) R9:26.2(11) R10:28.0(8) R11:21.9(8) R12:17.3(7) R13:9.3(6) R14:0.0(6)
  engine errors: 0 · meta errors: 0 · sim errors: 0 · total 51498 ms
```

## Arm 2: 卡L4 (SP_LAB_LEVEL_TARGET='[1,1,2,2,2,3,3,3,4,4,4,4,4,4,4,4]')
命令：
```pwsh
$env:SP_LAB_LEVEL_TARGET='[1,1,2,2,2,3,3,3,4,4,4,4,4,4,4,4]'; node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 3 --rehearsal 1 --lp 45
```

输出末尾 6 行：
```text
coop ABYSS · 4 seat(s) · seeds 1..3
  rounds passed: avg 11.67 · min 10 · max 13 · wins 0/3 · hidden 0
  distribution: 10:1  12:1  13:1
  avg LP of alive players after each round: R1:45.0(12) R2:45.0(12) R3:44.9(12) R4:43.4(12) R5:41.5(12) R6:38.9(12) R7:33.9(12) R8:24.7(12) R9:22.3(11) R10:20.6(9) R11:15.0(8) R12:14.5(6) R13:16.7(3) R14:0.0(3)
  engine errors: 0 · meta errors: 0 · sim errors: 0 · total 52061 ms
```

## Arm 3: 慢升级 (SP_LAB_LEVEL_TARGET='[1,1,1,2,2,2,3,3,3,4,4,4,5,5,5,5]')
命令：
```pwsh
$env:SP_LAB_LEVEL_TARGET='[1,1,1,2,2,2,3,3,3,4,4,4,5,5,5,5]'; node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 3 --rehearsal 1 --lp 45
```

输出末尾 6 行：
```text
coop ABYSS · 4 seat(s) · seeds 1..3
  rounds passed: avg 12.00 · min 10 · max 13 · wins 0/3 · hidden 0
  distribution: 10:1  13:2
  avg LP of alive players after each round: R1:45.0(12) R2:45.0(12) R3:44.9(12) R4:43.4(12) R5:41.4(12) R6:39.3(12) R7:35.8(12) R8:29.8(12) R9:25.8(12) R10:30.9(9) R11:28.6(8) R12:20.6(8) R13:13.0(7) R14:0.0(7)
  engine errors: 0 · meta errors: 0 · sim errors: 0 · total 58193 ms
```
