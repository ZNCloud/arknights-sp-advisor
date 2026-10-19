# ABYSS search scaffold

See `../../design/GOAL.md`, `LOOP.md`, `EXPERIMENTS.md` and `SCAFFOLD.md` for the fixed engine contract, limitations and executable batch plan.

From the task root:

```bash
bash run-node.sh --test sp-advisor/search/core.test.mjs
bash run-node.sh sp-advisor/eval/batch.mjs --strategy search --players 4 --seed 1 --seeds 10 --workers 5 --out design/results/search-final-p4.json
bash run-node.sh sp-advisor/eval/advice.mjs --players 4 --samples 2 --out design/results/advice-p4.json
```

`decide()` uses detached engine prep states, sampled chance transitions and a heuristic leaf. The probability field is explicitly **uncalibrated**. Only actual `hiddenCleared` outcomes count as R15 wins; generic `victory` is insufficient. Optional continuation estimates use the baseline bot, not a calibrated search-policy forecast.

The external engine is GPL-3.0; it remains in the separate `engine/` clone. No engine code or data is vendored into this directory. Runtime currently requires its pinned source layout and Node 22.
