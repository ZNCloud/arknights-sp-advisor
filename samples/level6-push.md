# 实验记录：level6-push

## Arm 1: baseline
命令：
```pwsh
node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 5 --rehearsal 1 --lp 45
```

输出末尾 6 行：
```text
coop ABYSS · 4 seat(s) · seeds 1..5
  rounds passed: avg 11.60 · min 9 · max 13 · wins 0/5 · hidden 0
  distribution: 9:1  11:1  12:1  13:2
  avg LP of alive players after each round: R1:45.0(20) R2:45.0(20) R3:45.0(20) R4:43.8(20) R5:42.6(20) R6:40.9(20) R7:35.7(20) R8:28.7(20) R9:23.4(19) R10:21.1(16) R11:13.6(16) R12:15.9(8) R13:9.3(6) R14:0.0(6)
  engine errors: 0 · meta errors: 0 · sim errors: 0 · total 86523 ms
```

## Arm 2: level6-push (SP_LAB_LEVEL_TARGET='[1,1,1,2,2,2,3,3,3,4,4,5,6,6,6,6]')
命令：
```pwsh
$env:SP_LAB_LEVEL_TARGET='[1,1,1,2,2,2,3,3,3,4,4,5,6,6,6,6]'
node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 5 --rehearsal 1 --lp 45
```

输出末尾 6 行：
```text
coop ABYSS · 4 seat(s) · seeds 1..5
  rounds passed: avg 12.20 · min 10 · max 13 · wins 0/5 · hidden 0
  distribution: 10:1  12:1  13:3
  avg LP of alive players after each round: R1:45.0(20) R2:45.0(20) R3:45.0(20) R4:43.8(20) R5:42.5(20) R6:41.3(20) R7:38.3(20) R8:31.7(20) R9:25.4(20) R10:25.5(17) R11:19.3(16) R12:17.8(10) R13:11.1(8) R14:0.0(8)
  engine errors: 0 · meta errors: 0 · sim errors: 0 · total 97132 ms
```
