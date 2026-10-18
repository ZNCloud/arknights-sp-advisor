# 实验记录：commit-terminal

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
  engine errors: 0 · meta errors: 0 · sim errors: 0 · total 50805 ms
```

## Arm 2: commit@9
命令：
```pwsh
$env:SP_LAB_COMMIT="1"
$env:SP_LAB_COMMIT_FROM="9"
$env:SP_LAB_COMMIT_PEN="12"
$env:SP_LAB_COMMIT_W="8"
$env:SP_LAB_MERGE_BONUS="120"
$env:SP_LAB_MAX_PAIRS="10"
$env:SP_LAB_BENCH_BUDGET="12"
node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 3 --rehearsal 1 --lp 45
```

输出末尾 6 行：
```text
coop ABYSS · 4 seat(s) · seeds 1..3
  rounds passed: avg 12.00 · min 9 · max 14 · wins 1/3 · hidden 0
  distribution: 9:1  13:1  14:1
  avg LP of alive players after each round: R1:45.0(12) R2:45.0(12) R3:44.9(12) R4:43.5(12) R5:41.6(12) R6:39.0(12) R7:36.8(12) R8:29.8(12) R9:28.4(11) R10:36.3(8) R11:29.8(8) R12:22.6(8) R13:17.4(7) R14:5.3(7)
  engine errors: 0 · meta errors: 0 · sim errors: 0 · total 58118 ms
```
