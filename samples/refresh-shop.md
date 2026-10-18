# refresh-shop: 刷新频率与商店利用

## Arm 1: Baseline

### 命令原文
```powershell
node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 3 --rehearsal 1 --lp 45
```

### 输出最后 6 行
```text
coop ABYSS · 4 seat(s) · seeds 1..3
  rounds passed: avg 11.67 · min 9 · max 13 · wins 0/3 · hidden 0
  distribution: 9:1  13:2
  avg LP of alive players after each round: R1:45.0(12) R2:45.0(12) R3:44.9(12) R4:43.4(12) R5:41.5(12) R6:38.9(12) R7:34.3(12) R8:28.1(12) R9:26.2(11) R10:28.0(8) R11:21.9(8) R12:17.3(7) R13:9.3(6) R14:0.0(6)
  engine errors: 0 · meta errors: 0 · sim errors: 0 · total 47950 ms
```

---

## Arm 2: SP_LAB_MAX_REFRESHES=28

### 命令原文
```powershell
$env:SP_LAB_MAX_REFRESHES="28"; node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 3 --rehearsal 1 --lp 45
```

### 输出最后 6 行
```text
coop ABYSS · 4 seat(s) · seeds 1..3
  rounds passed: avg 11.67 · min 9 · max 13 · wins 0/3 · hidden 0
  distribution: 9:1  13:2
  avg LP of alive players after each round: R1:45.0(12) R2:45.0(12) R3:44.9(12) R4:43.4(12) R5:41.5(12) R6:38.9(12) R7:34.3(12) R8:28.1(12) R9:26.2(11) R10:28.0(8) R11:21.9(8) R12:17.3(7) R13:9.3(6) R14:0.0(6)
  engine errors: 0 · meta errors: 0 · sim errors: 0 · total 46228 ms
```

---

## Arm 3: SP_LAB_MERGE_HIT=90 SP_LAB_PAIR_HIT=24 SP_LAB_MAX_PAIRS=8 SP_LAB_BENCH_BUDGET=10

### 命令原文
```powershell
$env:SP_LAB_MERGE_HIT="90"; $env:SP_LAB_PAIR_HIT="24"; $env:SP_LAB_MAX_PAIRS="8"; $env:SP_LAB_BENCH_BUDGET="10"; node tools/matchrun.mjs --mode coop --players 4 --difficulty ABYSS --seeds 3 --rehearsal 1 --lp 45
```

### 输出最后 6 行
```text
coop ABYSS · 4 seat(s) · seeds 1..3
  rounds passed: avg 11.67 · min 11 · max 13 · wins 0/3 · hidden 0
  distribution: 11:2  13:1
  avg LP of alive players after each round: R1:45.0(12) R2:45.0(12) R3:44.9(12) R4:43.3(12) R5:41.4(12) R6:39.0(12) R7:33.3(12) R8:25.4(12) R9:23.6(10) R10:20.4(9) R11:20.2(6) R12:19.0(4) R13:9.0(4) R14:0.0(4)
  engine errors: 0 · meta errors: 0 · sim errors: 0 · total 41202 ms
```
