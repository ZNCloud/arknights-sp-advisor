# 实验记录：commit-reseed

## Arm 1: baseline (seeds 4..9)
命令：
```pwsh
node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seed 4 --seeds 6 --rehearsal 1 --lp 45
```

输出末尾 6 行：
```text
coop ABYSS · 4 seat(s) · seeds 4..9
  rounds passed: avg 12.00 · min 11 · max 13 · wins 0/6 · hidden 0
  distribution: 11:2  12:2  13:2
  avg LP of alive players after each round: R1:45.0(24) R2:45.0(24) R3:45.0(24) R4:44.5(24) R5:42.0(24) R6:40.8(24) R7:32.6(24) R8:26.1(24) R9:19.1(24) R10:16.8(22) R11:11.8(20) R12:15.6(7) R13:18.2(5) R14:0.0(5)
  engine errors: 0 · meta errors: 0 · sim errors: 0 · total 117466 ms
```

## Arm 2: commit@9 (seeds 4..9)
命令：
```pwsh
$env:SP_LAB_COMMIT="1"
$env:SP_LAB_COMMIT_FROM="9"
$env:SP_LAB_COMMIT_PEN="12"
$env:SP_LAB_COMMIT_W="8"
$env:SP_LAB_MERGE_BONUS="120"
$env:SP_LAB_MAX_PAIRS="10"
$env:SP_LAB_BENCH_BUDGET="12"
node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seed 4 --seeds 6 --rehearsal 1 --lp 45
```

输出末尾 6 行：
```text
coop ABYSS · 4 seat(s) · seeds 4..9
  rounds passed: avg 12.17 · min 11 · max 13 · wins 0/6 · hidden 0
  distribution: 11:2  12:1  13:3
  avg LP of alive players after each round: R1:45.0(24) R2:45.0(24) R3:45.0(24) R4:44.5(24) R5:42.0(24) R6:40.8(24) R7:32.6(24) R8:26.2(24) R9:19.3(24) R10:17.0(24) R11:11.7(22) R12:15.9(7) R13:8.2(6) R14:0.0(6)
  engine errors: 0 · meta errors: 0 · sim errors: 0 · total 106810 ms
```
