#!/usr/bin/env python3
"""50-seed self-play comparison (docs/MODEL.md §5.3): arms name=file:key (key = baseline | advised); every pair compared per seed.
python3 compare50.py "guide=docs/advisor/m2-baseline-50.json:baseline" "v2=docs/advisor/m2-hybrid-50.json:advised" ..."""
import json, math, sys
def load(path, key):
    d = json.load(open(path))
    return {r['seed']: r[key] for r in d['rows'] if r.get(key)}
def mse(xs):
    m = sum(xs) / len(xs); se = math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1) / len(xs)) if len(xs) > 1 else 0
    return m, se
def row(name, R):
    n = len(R); f = lambda k: sum(k(x) for x in R.values()) / n
    return f"| {name} | {sum(1 for x in R.values() if x['win'])}/{n} | {sum(1 for x in R.values() if x['lastRound'] >= 14)}/{n} | {f(lambda x: x['lastRound']):.2f} | {100*f(lambda x: x['r14Dmg']):.1f}% | {f(lambda x: x['utility']):.3f} |"
def paired(A, B):
    s = sorted(set(A) & set(B))
    du = [A[k]['utility'] - B[k]['utility'] for k in s]; dr = [A[k]['lastRound'] - B[k]['lastRound'] for k in s]
    (mu, su), (mr, sr) = mse(du), mse(dr)
    good = sum(1 for x in du if x > 1e-9); bad = sum(1 for x in du if x < -1e-9)
    wins = (sum(1 for k in s if A[k]['win'] and not B[k]['win']), sum(1 for k in s if B[k]['win'] and not A[k]['win']))
    return f"效用 {mu:+.3f}±{su:.3f}，到达回合 {mr:+.2f}±{sr:.2f}，好/差 {good}/{bad}，胜局 +{wins[0]} −{wins[1]}（n={len(s)}）"
if __name__ == '__main__':
    arms = [a.split('=') for a in sys.argv[1:]]
    data = {}
    for name, spec in arms:
        path, key = spec.split(':'); data[name] = load(path, key)
    print("| 打法（p0；队友全是 guide） | 胜 | 打进 R14 | 平均到达回合 | R14 平均伤害 | 效用 |"); print("|---|---|---|---|---|---|")
    for name in data: print(row(name, data[name]))
    names = list(data)
    for i, a in enumerate(names):
        for b in names[:i]:
            print(f"- {a} − {b}：{paired(data[a], data[b])}")
