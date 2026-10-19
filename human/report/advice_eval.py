#!/usr/bin/env python3
"""真人局重放 → 顾问逐回合建议 vs owner vs 事后最优: one table over both games (A rollouts N=36 for R9–R14, 12 before)."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from econ_agg import aggregate, LABEL
adv = json.load(open('results/advice.json'))
def merged(g):
    rows = {}
    for f in [f'results/econ-A-{g}.json', f'results/econ2-A-{g}.json']:
        if os.path.exists(f):
            for r in aggregate(f)[1]: rows[(r['round'], r['cand'])] = r
    return rows
def field(g):
    F = json.load(open(f'results/field-{g}.json'))
    out = {}
    for r in F['rows']:
        if r['task']['kind'] != 'layout': continue
        if r['kind'] == 'normal' and r['objective'] == 'A':
            out[r['round']] = f"期望漏怪 {r['owner']['score']['A']:.1f}→{r['best']['score']['A']:.1f}" + (f"，对齐 {r['owner']['score']['B']}→{r['best']['score']['B']}" if r['owner']['score']['B'] else '')
        elif r['kind'] == 'boss' and not r['task'].get('items') and r.get('recheck'):
            out[r['round']] = f"单人份额 {r['recheck']['owner']['share']:.2f}→{r['recheck']['best']['share']:.2f}"
    return out
print("| 局 | 回合 | 顾问建议 | owner 实际 | owner 也做了? | A：顾问一步+guide vs 同计划重抽（ΔR14 / ΔR15 / Δ血） | A：owner 实际 vs 同计划重抽（ΔR14，正 = 手气/执行好于平均） | A：本回合最好的替代打法 vs owner（ΔR14） | B：同牌事后最优（当回合那一仗；普通回合按期望漏怪搜，BOSS 回合单人模板份额） |")
print("|---|---|---|---|---|---|---|---|---|")
stats = {'adv_better': 0, 'adv_worse': 0, 'n': 0}
for g in ['game1', 'game2']:
    E, Fd = merged(g), field(g)
    for r in [x for x in adv['rows'] if x['game'] == g]:
        rnd = r['round']; a = (r.get('advisor') or {}).get('label', r.get('error'))
        ad, ow, sh = E.get((rnd, 'advisor')), E.get((rnd, 'owner')), E.get((rnd, 'shadow'))
        f = lambda t: '-' if not t or t[0] is None else (f"{t[0]:+.2f}±{t[1]:.2f}" if t[1] is not None else f"{t[0]:+.2f}")
        advs = f"{f(ad.get('s_r14'))} / {f(ad.get('s_r15'))} / {f(ad.get('s_lpEnd'))}" if ad else '（只跑了 R9–R14）'
        if ad and ad.get('s_r14') and ad['s_r14'][0] is not None and ad['s_r14'][1]:
            stats['n'] += 1
            if ad['s_r14'][0] > 2 * ad['s_r14'][1]: stats['adv_better'] += 1
            if ad['s_r14'][0] < -2 * ad['s_r14'][1]: stats['adv_worse'] += 1
        own = f"{-sh['d_r14'][0]:+.2f}" if sh and sh.get('d_r14') and sh['d_r14'][0] is not None else '-'
        best = None
        for c in ['shadow', 'levelmax', 'rollmax', 'ai_turn', 'guide', 'advisor']:
            x = E.get((rnd, c))
            if x and x.get('d_r14') and x['d_r14'][0] is not None and (best is None or x['d_r14'][0] > best[1]): best = (c, x['d_r14'][0])
        bests = f"{LABEL.get(best[0], best[0])} {best[1]:+.2f}" if best else '-'
        cont = {True: '是', False: '否', None: '-'}[r.get('ownerTurnContainsAdvisorAction')]
        owner_txt = r['owner'].replace('歌蕾蒂娅', '4_27(替身)') if g == 'game2' else r['owner']
        print(f"| {g[-1]} | R{rnd} | {a} | {owner_txt} | {cont} | {advs} | {own} | {bests} | {Fd.get(rnd, '-')} |")
print(f"\n顾问档（R9–R14，两局共 {stats['n']} 个局面）：比「同计划重抽」显著好（> 2 标准误）{stats['adv_better']} 个，显著差 {stats['adv_worse']} 个。")
