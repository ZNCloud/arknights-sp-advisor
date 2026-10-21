# Paired "reached R14" / win counts between two teamplay arms on the same seeds (McNemar exact, two-sided).
# python3 sp-advisor/eval/report/team_reach.py results/eval-blind.jsonl results/eval-learned.jsonl
import json, sys
from math import comb
def load(f): return {g['seed']: g['outcome'] for g in map(json.loads, open(f))}
a, b = load(sys.argv[1]), load(sys.argv[2]); seeds = sorted(set(a) & set(b))
def mcnemar(x, y):
    n = x + y
    return 1.0 if n == 0 else min(1.0, 2 * sum(comb(n, i) for i in range(min(x, y) + 1)) / 2 ** n)
for name, f in (('reach R14', lambda o: o['lastRound'] >= 14), ('win', lambda o: o['win'])):
    gain = sum(f(b[s]) and not f(a[s]) for s in seeds); loss = sum(f(a[s]) and not f(b[s]) for s in seeds)
    print(f"{name}: {sum(f(a[s]) for s in seeds)} -> {sum(f(b[s]) for s in seeds)} of {len(seeds)}  (+{gain} -{loss}, McNemar p={mcnemar(gain, loss):.4f})")
