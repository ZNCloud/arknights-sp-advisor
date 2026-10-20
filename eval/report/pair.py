#!/usr/bin/env python3
# usage: python3 pair.py <hind-run output> <base cand> <cand>
"""Paired (same sample seed) differences of hind-run outputs: candidate − base, unclipped LP loss, layers, R14 / R15 shares."""
import json, sys, math
from collections import defaultdict
HW = {'boss_8': 50, 'boss_9': 40, 'boss_10': 40}
def mse(xs):
    xs = [x for x in xs if x is not None]
    if not xs: return None
    m = sum(xs) / len(xs)
    se = math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1) / len(xs)) if len(xs) > 1 else 0.0
    return (m, se, len(xs))
def met(r):
    r15 = r.get('r15') or {}
    w = sum(HW[k] for k in r15) or 1
    return {'lpLoss': r.get('lpLoss'), 'layers': r.get('layers'),
            'r14': r['r14']['shareAtCountdown'] if r.get('r14') else None,
            'r15': sum(HW[k] * v['shareAtCountdown'] for k, v in r15.items()) / w if r15 else None}
def pairs(path, base, cand):
    d = json.load(open(path)); by = defaultdict(lambda: defaultdict(dict))
    for r in d['rows']: by[r['round']][r['cand']][r['sampleSeed']] = met(r)
    out = {}
    for rnd, cs in sorted(by.items()):
        if base not in cs or cand not in cs: continue
        b, c = cs[base], cs[cand]
        row = {}
        for k in ['lpLoss', 'layers', 'r14', 'r15']:
            ds = [c[s][k] - b[s][k] for s in c if s in b and c[s][k] is not None and b[s][k] is not None]
            row[k] = mse(ds)
        out[rnd] = row
    return d, out
def f(t, p=2): return '-' if not t else f"{t[0]:+.{p}f}±{t[1]:.{p}f}"
if __name__ == '__main__':
    path, base, cand = sys.argv[1], sys.argv[2], sys.argv[3]
    d, out = pairs(path, base, cand)
    print(f"# {path}: {cand} − {base}, rollouts {len(d['rows'])}, errors {len(d['errors'])}")
    for rnd, row in out.items():
        # lpLoss: negative = fewer LP lost (better)
        print(f"R{rnd}: Δ掉血 {f(row['lpLoss'],1)}  Δ层数 {f(row['layers'],1)}  ΔR14份额 {f(row['r14'])}  ΔR15份额 {f(row['r15'])}  n={row['r14'][2] if row['r14'] else (row['r15'][2] if row['r15'] else 0)}")
