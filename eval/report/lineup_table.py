#!/usr/bin/env python3
"""docs/MODEL.md §5.1: lineup check on the owner's 30 battle boards + the A-mode full-game check of every recommendation.
python3 sp-advisor/eval/report/lineup_table.py sp-advisor/docs/advisor/v3-lineup-human.json 'sp-advisor/docs/advisor/v3-hind-lineup-{game}.json'"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from pair import pairs
lineup, hind = sys.argv[1], sys.argv[2]
L = json.load(open(lineup))['rows']
H = {}
for g in ['game1', 'game2']:
    f = hind.format(game=g)
    if os.path.exists(f): H[g] = pairs(f, 'owner', 'lineup')[1]
HIND = {('game1', 8): '能天使那一格换送葬人（对齐 5→0 漏）', ('game1', 14): '圣约送葬人、魔王挪最后一排 + 新约能天使顶到 10,8（单人 1.55→3.07）',
        ('game1', 15): '圣约送葬人与信仰搅拌机对调（单人 0.81→1.14）', ('game2', 7): '惊蛰精锐替野鬃（2→0 漏）', ('game2', 8): '惊蛰精锐替野鬃、补灰毫（1→0 漏）',
        ('game2', 10): '宴替雷蛇（4→0 漏）', ('game2', 14): '玛恩纳朝左（单人 0.85→0.97）'}
STANDIN = 'chess_char_4_12'   # 歌蕾蒂娅 stands in for the client-only 4_27 in game 2
def f(t, p=2): return '-' if not t else f"{t[0]:+.{p}f}±{t[1]:.{p}f}"
def sig(t): return t and abs(t[0]) > 2 * t[1] and t[1] > 0
print('| 局 | 回合 | 顾问建议（按 Ready 前） | 这一仗复核（新随机） | 整局复核 36 个未来：Δ掉血 / Δ层数 / ΔR14 份额 / ΔR15 份额 | 事后诸葛亮（sphind_2254） |')
print('|---|---|---|---|---|---|')
stats = {'rec': 0, 'better': 0, 'worse': 0, 'mixed': 0, 'flat': 0, 'hits': 0, 'standin': 0}
for r in L:
    g, rnd = r['game'], r['round']
    hind = HIND.get((g, rnd), '')
    if not r['steps'] and not hind: continue
    adv = '，然后 '.join(s['what'] for s in r['steps']) if r['steps'] else '不动'
    pos = lambda Lx: {str(x['uid']): (x['row'], x['col'], x['dir']) for x in Lx}
    cur, best = pos(r['current']), pos(r['best'])
    standin = g == 'game2' and any(str(r['names'].get(u, '')).startswith(STANDIN) and cur.get(u) != best.get(u) for u in set(cur) | set(best))
    if r['recommend']: stats['rec'] += 1
    if standin and r['recommend']: stats['standin'] += 1
    adv = ('★ ' if r['recommend'] else '（未过门槛）') + adv + ('（含 4_27 替身，不进结论）' if standin else '')
    c, b, gn = (r.get('recheck') or {}).get('current'), (r.get('recheck') or {}).get('best'), r.get('gain')
    if not gn: one = '-'
    elif r['kind'] == 'normal': one = f"掉血 {c['loss']:.2f}→{b['loss']:.2f}，拿层 {c['layers']:.1f}→{b['layers']:.1f}，净 {gn['mean']:+.2f}±{gn['se']:.2f} 分"
    else: one = f"份额 {c['share']:.2f}→{b['share']:.2f}（{gn['mean']:+.2f}±{gn['se']:.2f}）"
    h = H.get(g, {}).get(rnd)
    full = f"{f(h['lpLoss'],1)} / {f(h['layers'],1)} / {f(h['r14'])} / {f(h['r15'])}" if h else '-'
    verdict = ''
    if h and r['recommend'] and not standin:
        good = [k for k in ('r14', 'r15') if sig(h[k]) and h[k][0] > 0] + (['lp'] if sig(h['lpLoss']) and h['lpLoss'][0] < 0 else [])
        bad = [k for k in ('r14', 'r15') if sig(h[k]) and h[k][0] < 0] + (['lp'] if sig(h['lpLoss']) and h['lpLoss'][0] > 0 else [])
        verdict = '好' if good and not bad else '差' if bad and not good else '有好有差' if good else '持平'
        stats[{'好': 'better', '差': 'worse', '有好有差': 'mixed', '持平': 'flat'}[verdict]] = stats.get({'好': 'better', '差': 'worse', '有好有差': 'mixed', '持平': 'flat'}[verdict], 0) + 1
        stats.setdefault('bad_list', []).extend(f"{g[-1]}R{rnd}:{k}" for k in bad)
    if hind and r['recommend']: stats['hits'] += 1
    print(f"| {g[-1]} | R{rnd} | {adv} | {one} | {full}{'（' + verdict + '）' if verdict else ''} | {hind or '-'} |")
print()
print(f"建议 {stats['rec']} 个（其中动到 4_27 替身的 {stats['standin']} 个不进结论）；其余 {stats['rec'] - stats['standin']} 个的整局复核（>2 标准误算显著；看 R14 / R15 份额和掉血）："
      f"好 {stats['better']}、有好有差 {stats['mixed']}、持平 {stats['flat']}、差 {stats['worse']}；显著变差的项：{', '.join(stats.get('bad_list', [])) or '无'}。"
      f"事后诸葛亮 7 个站位点里顾问提出了改动的 {stats['hits']} 个。")
