"""Evaluator v2 training: LightGBM on self-play rows (advisor/datagen.mjs).
Usage (docker python:3.12-slim, PYTHONPATH=pydeps): python sp-advisor/advisor/train.py data/selfplay-a.jsonl [...] --out sp-advisor/models
Outputs value-win.json (binary: team victory) and value-util.json (regression: ranking utility), plus metrics.json.
Validation is split by game seed so no game leaks across the split."""
import json, sys, argparse, numpy as np, lightgbm as lgb

ap = argparse.ArgumentParser(); ap.add_argument('files', nargs='+'); ap.add_argument('--out', default='sp-advisor/models'); ap.add_argument('--names', default=None)
a = ap.parse_args()
rows = [json.loads(l) for f in a.files for l in open(f) if l.strip()]
X = np.array([r['x'] for r in rows], dtype=np.float64)
seeds = np.array([r['seed'] for r in rows]); win = np.array([r['win'] for r in rows]); util = np.array([r['utility'] for r in rows])
inj = np.array([r['inject'] is not None for r in rows]); rnd = X[:, 0]
# Independent of datagen's policy hash (which picks injection games): seed mod 5.
val = seeds % 5 == 0
print(f'rows={len(rows)} games={len(set(seeds))} winRows={win.sum()} winGames={len(set(seeds[win==1]))} injectRows={inj.sum()} val={val.sum()}')
P = dict(learning_rate=.05, num_leaves=31, min_data_in_leaf=40, feature_fraction=.8, bagging_fraction=.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, num_threads=8)
def fit(y, obj, metric):
    dt = lgb.Dataset(X[~val], y[~val]); dv = lgb.Dataset(X[val], y[val], reference=dt)
    b = lgb.train({**P, 'objective': obj, 'metric': metric}, dt, num_boost_round=1500, valid_sets=[dv], callbacks=[lgb.early_stopping(60, verbose=False)])
    return b
def auc(y, p):
    o = np.argsort(p); y = y[o]; n1 = y.sum(); n0 = len(y) - n1
    if n1 == 0 or n0 == 0: return None
    ranks = np.arange(1, len(y) + 1); return float((ranks[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))
bw = fit(win.astype(float), 'binary', 'binary_logloss'); bu = fit(util, 'regression', 'l2')
pw = bw.predict(X[val]); pu = bu.predict(X[val])
m = {'rows': len(rows), 'games': int(len(set(seeds))), 'valRows': int(val.sum()), 'winTrees': bw.best_iteration, 'utilTrees': bu.best_iteration,
     'win': {'auc': auc(win[val], pw), 'brier': float(np.mean((pw - win[val]) ** 2)), 'baseRate': float(win[val].mean()),
             'aucNatural': auc(win[val & ~inj], pw[~inj[val]]), 'meanPredNatural': float(pw[~inj[val]].mean()), 'baseNatural': float(win[val & ~inj].mean())},
     'util': {'rmse': float(np.sqrt(np.mean((pu - util[val]) ** 2))), 'r2': float(1 - np.mean((pu - util[val]) ** 2) / np.var(util[val])),
              'r2Natural': float(1 - np.mean((pu[~inj[val]] - util[val & ~inj]) ** 2) / np.var(util[val & ~inj]))}}
# Calibration table on the validation split (deciles of predicted win prob).
bins = np.quantile(pw, np.linspace(0, 1, 11)); cal = []
for i in range(10):
    s = (pw >= bins[i]) & (pw <= bins[i + 1])
    if s.sum(): cal.append([float(pw[s].mean()), float(win[val][s].mean()), int(s.sum())])
m['win']['calibration'] = cal
by_round = {}
for r in sorted(set(rnd[val].astype(int))):
    s = rnd[val] == r
    by_round[int(r)] = {'n': int(s.sum()), 'utilR2': float(1 - np.mean((pu[s] - util[val][s]) ** 2) / max(1e-9, np.var(util[val][s]))), 'winAuc': auc(win[val][s], pw[s])}
m['byRound'] = by_round
imp = sorted(zip(bu.feature_importance('gain'), range(X.shape[1])), reverse=True)[:15]
names = json.load(open(a.names)) if a.names else None
m['topFeatures'] = [[names[i] if names else i, float(g)] for g, i in imp]
json.dump(bw.dump_model(), open(f'{a.out}/value-win.json', 'w')); json.dump(bu.dump_model(), open(f'{a.out}/value-util.json', 'w'))
json.dump(m, open(f'{a.out}/metrics.json', 'w'), indent=1); print(json.dumps(m, indent=1)[:3000])
