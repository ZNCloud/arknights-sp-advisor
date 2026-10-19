#!/usr/bin/env python3
"""Aggregate results/econ-A-<game>.json (and other hind-run outputs): per round × candidate means and paired
differences vs the owner's actual turn on identical sample seeds (common random numbers)."""
import json, sys, math
from collections import defaultdict
HW = {'boss_8': 50, 'boss_9': 40, 'boss_10': 40}
LABEL = {'owner': 'owner 实际', 'shadow': '照 owner 计划重抽刷新', 'levelmax': '剩钱全升级', 'rollmax': '剩钱全刷新', 'ai_turn': 'AI 托管本回合',
         'guide': '顾问 guide g06', 'advisor': '顾问建议一步+guide', 'ai_layout': 'AI 选人摆位', 'ai_items': 'AI 分新装备'}

def metrics(r):
    if 'r14' not in r: return None
    r15 = r.get('r15') or {}
    w = sum(HW[k] for k in r15) or 1
    return {
        'lpEnd': r['lpEnd'], 'lpLoss': r['lpLoss'],
        'r14': r['r14']['shareAtCountdown'] if r.get('r14') else None,
        'r14p': r['r14'].get('pClearCountdown') if r.get('r14') else None,
        'r15': sum(HW[k] * v['shareAtCountdown'] for k, v in r15.items()) / w if r15 else None,
        'r15p': sum(HW[k] * v.get('pClearCountdown', 0) for k, v in r15.items()) / w if r15 else None,
        'layers': r.get('layers'), 'level': r.get('level')}

def mse(xs):
    xs = [x for x in xs if x is not None]
    if not xs: return (None, None, 0)
    m = sum(xs) / len(xs)
    se = math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1) / len(xs)) if len(xs) > 1 else None
    return (m, se, len(xs))

def aggregate(path):
    d = json.load(open(path))
    by = defaultdict(dict)   # (round, mode) -> cand -> seed -> metrics
    for r in d['rows']:
        mt = metrics(r)
        if mt is None: continue
        by[(r['round'], r['mode'])].setdefault(r['cand'], {})[r['sampleSeed']] = mt
    out = []
    for (rnd, mode), cands in sorted(by.items()):
        own = cands.get('owner', {})
        sh = cands.get('shadow', {})
        for c, seeds in cands.items():
            row = {'round': rnd, 'mode': mode, 'cand': c, 'n': len(seeds)}
            for k in ['lpEnd', 'r14', 'r14p', 'r15', 'r15p', 'layers', 'level']:
                row[k] = mse([s[k] for s in seeds.values()])[0]
                if c != 'owner':
                    diffs = [seeds[s][k] - own[s][k] for s in seeds if s in own and seeds[s][k] is not None and own[s][k] is not None]
                    m, se, n = mse(diffs)
                    row['d_' + k] = (m, se, n)
                if c not in ('owner', 'shadow'):
                    diffs = [seeds[s][k] - sh[s][k] for s in seeds if s in sh and seeds[s][k] is not None and sh[s][k] is not None]
                    row['s_' + k] = mse(diffs)
            out.append(row)
    return d, out

def fmt(x, p=2):
    return '-' if x is None else f'{x:.{p}f}'
def fd(t, p=2):
    if not t or t[0] is None: return '-'
    m, se, n = t
    return f'{m:+.{p}f}±{se:.{p}f}' if se is not None else f'{m:+.{p}f}'

if __name__ == '__main__':
    d, rows = aggregate(sys.argv[1])
    print(f"# {d['game']} rollouts {len(d['rows'])} errors {len(d['errors'])}")
    for rnd in sorted(set(r['round'] for r in rows)):
        print(f"\nR{rnd}")
        for r in [x for x in rows if x['round'] == rnd]:
            print(f"  {r['mode']} {LABEL.get(r['cand'], r['cand']):10s} n{r['n']:3d} lpEnd {fmt(r['lpEnd'],1)} r14 {fmt(r['r14'])} p14 {fmt(r['r14p'])} r15 {fmt(r['r15'])} lvl {fmt(r['level'],1)} | vs owner Δlp {fd(r.get('d_lpEnd'),1)} Δr14 {fd(r.get('d_r14'))} Δr15 {fd(r.get('d_r15'))} | vs 重抽 Δlp {fd(r.get('s_lpEnd'),1)} Δr14 {fd(r.get('s_r14'))} Δr15 {fd(r.get('s_r15'))}")
