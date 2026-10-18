# 实验记录：commit-split

## Arm A: 只开 COMMIT 组
命令：
```pwsh
$env:SP_LAB_COMMIT="1"
$env:SP_LAB_COMMIT_FROM="9"
$env:SP_LAB_COMMIT_PEN="12"
$env:SP_LAB_COMMIT_W="8"
node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 5 --rehearsal 1 --lp 45
```

输出末尾 6 行：
```text
coop ABYSS · 4 seat(s) · seeds 1..5
  rounds passed: avg 11.60 · min 9 · max 13 · wins 0/5 · hidden 0
  distribution: 9:1  11:1  12:1  13:2
  avg LP of alive players after each round: R1:45.0(20) R2:45.0(20) R3:45.0(20) R4:43.8(20) R5:42.6(20) R6:40.9(20) R7:35.7(20) R8:28.7(20) R9:23.9(19) R10:23.2(16) R11:14.6(16) R12:19.5(8) R13:16.5(6) R14:0.0(6)
  engine errors: 0 · meta errors: 0 · sim errors: 0 · total 84738 ms
```

## Arm B: 只开 MERGE + PAIR + BUDGET 组
命令：
```pwsh
$env:SP_LAB_MERGE_BONUS="120"
$env:SP_LAB_MAX_PAIRS="10"
$env:SP_LAB_BENCH_BUDGET="12"
node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 5 --rehearsal 1 --lp 45
```

输出末尾 6 行：
```text
coop ABYSS · 4 seat(s) · seeds 1..5
  rounds passed: avg 11.60 · min 9 · max 13 · wins 0/5 · hidden 0
  distribution: 9:1  11:1  12:1  13:2
  avg LP of alive players after each round: R1:45.0(20) R2:45.0(20) R3:45.0(20) R4:43.8(20) R5:42.6(20) R6:40.9(20) R7:37.2(20) R8:29.8(20) R9:24.8(19) R10:23.6(16) R11:16.8(16) R12:20.3(9) R13:14.0(8) R14:0.0(8)
  engine errors: 0 · meta errors: 0 · sim errors: 0 · total 92976 ms
```

## Arm C: 只开 MAX_PAIRS + BENCH_BUDGET 组
命令：
```pwsh
$env:SP_LAB_MAX_PAIRS="10"
$env:SP_LAB_BENCH_BUDGET="12"
node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 5 --rehearsal 1 --lp 45
```

输出末尾 6 行：
```text
coop ABYSS · 4 seat(s) · seeds 1..5
  rounds passed: avg 11.60 · min 9 · max 13 · wins 0/5 · hidden 0
  distribution: 9:1  11:1  12:1  13:2
  avg LP of alive players after each round: R1:45.0(20) R2:45.0(20) R3:45.0(20) R4:43.8(20) R5:42.6(20) R6:40.9(20) R7:35.7(20) R8:28.7(20) R9:23.4(19) R10:21.2(16) R11:13.9(16) R12:18.4(8) R13:12.7(6) R14:0.0(6)
  engine errors: 0 · meta errors: 0 · sim errors: 0 · total 79949 ms
```

## Arm D: 全开（commit@9）
命令：
```pwsh
$env:SP_LAB_COMMIT="1"
$env:SP_LAB_COMMIT_FROM="9"
$env:SP_LAB_COMMIT_PEN="12"
$env:SP_LAB_COMMIT_W="8"
$env:SP_LAB_MERGE_BONUS="120"
$env:SP_LAB_MAX_PAIRS="10"
$env:SP_LAB_BENCH_BUDGET="12"
node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 5 --rehearsal 1 --lp 45
```

输出末尾 6 行：
```text
coop ABYSS · 4 seat(s) · seeds 1..5
  rounds passed: avg 11.80 · min 9 · max 14 · wins 1/5 · hidden 0
  distribution: 9:1  11:1  12:1  13:1  14:1
  avg LP of alive players after each round: R1:45.0(20) R2:45.0(20) R3:45.0(20) R4:43.8(20) R5:42.6(20) R6:40.9(20) R7:37.2(20) R8:29.8(20) R9:24.9(19) R10:25.4(16) R11:17.4(16) R12:20.3(9) R13:17.4(7) R14:5.3(7)
  engine errors: 0 · meta errors: 0 · sim errors: 0 · total 87648 ms
```
