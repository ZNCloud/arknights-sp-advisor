#!/usr/bin/env python3
"""Tables for STEP_sphind_2254_<game>: A (信息公平) economy rollouts, B (已知未来) same-card battle boards, equipment
re-targeting, advisor vs owner. Usage: game_md.py <game> [econ.json ...]"""
import json, sys, os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, os.path.dirname(__file__))
from engine_data import load_json
from econ_agg import aggregate, LABEL, fd, fmt
CH = load_json("chess.json"); IT = load_json("items.json")
nm = lambda i: (CH.get(i) or IT.get(i) or {}).get('name', i) + ('(精锐)' if (CH.get(i) or {}).get('isGolden') else '')
g = sys.argv[1]
econ_files = sys.argv[2:] or [f'results/econ-A-{g}.json']
rep = json.load(open(f'results/replay-{g}.json'))
OWNER_EQUIPS = {x['round']: [l for l in x.get('turn', {}).get('log', []) if l.startswith('装备 ')] for x in rep['rounds']}
field = json.load(open(f'results/field-{g}.json')) if os.path.exists(f'results/field-{g}.json') else None
advice = json.load(open('results/advice.json')) if os.path.exists('results/advice.json') else None
out = []; w = out.append

# ---------- A: economy rollouts (latest file wins per (round, cand)) ----------
rows = {}
for f in econ_files:
    if not os.path.exists(f): continue
    _, rs = aggregate(f)
    for r in rs: rows[(r['round'], r['cand'])] = r
w("### A 口径（信息公平）：每回合换一种打法，之后照 owner 的计划续打（未来随机），owner 自己的场")
w("")
w("列说明：`终局血量` = 本回合起到 R13 结束 owner 自己掉血后剩的血（引擎普通回合比真实局更容易漏怪，绝对值偏低，看差）；`R14 份额` = R14 owner 单人在倒计时内打掉自己那一份 BOSS 血池的比例（≥1 = 自己那份打穿）；`R15 份额` = 三只隐藏 BOSS 按出场权重平均。`Δ` 是同一批随机未来上的配对差 ± 标准误。「vs 重抽」= 和「照 owner 这回合的计划、但刷新结果重抽」比（去掉 owner 当回合的刷新手气）。")
w("")
w("| 回合 | 打法 | 样本 | 终局血量 | R14 份额 | R14 打穿率 | R15 份额 | Δ终局血量 vs owner | ΔR14 vs owner | ΔR15 vs owner | ΔR14 vs 重抽 | ΔR15 vs 重抽 |")
w("|---|---|---|---|---|---|---|---|---|---|---|---|")
for rnd in sorted(set(k[0] for k in rows)):
    for c in ['owner', 'shadow', 'levelmax', 'rollmax', 'ai_turn', 'guide', 'advisor']:
        r = rows.get((rnd, c))
        if not r: continue
        w(f"| R{rnd} | {LABEL.get(c, c)} | {r['n']} | {fmt(r['lpEnd'],1)} | {fmt(r['r14'])} | {fmt(r['r14p'])} | {fmt(r['r15'])} | {fd(r.get('d_lpEnd'),1)} | {fd(r.get('d_r14'))} | {fd(r.get('d_r15'))} | {fd(r.get('s_r14'))} | {fd(r.get('s_r15'))} |")

# ---------- B: battle boards ----------
if field:
    w("\n### B 口径（已知未来）：同一批牌，事后最优的上场阵容 / 站位 / 朝向（只影响当回合那一仗）\n")
    w("普通回合：`对齐波次漏怪` = 复现时对齐的那一波敌人下 owner 自己场漏几只（1 只 = 1 血，联防前）；`先验期望漏怪` = 引擎这回合 10 种最常见敌人按概率加权（A 口径）。BOSS 回合：单人份额（16 个种子复核）。")
    w("")
    w("| 回合 | 目标 | owner | 引擎 AI 摆法 | 事后最优 | 最优做了什么（相对 owner 的改动，按搜索顺序） |")
    w("|---|---|---|---|---|---|")
    L = [r for r in field['rows'] if r['task']['kind'] == 'layout']
    def sn(s, kind):
        if not s: return '-'
        if kind == 'boss': return f"{s['share']:.2f} 份（打穿率 {s['pClear']:.0%}）"
        return f"对齐 {s['B']} / 期望 {s['A']:.2f}"
    for r in sorted(L, key=lambda x: (x['round'], str(x['objective']), str(x['task'].get('items')))):
        k = r['kind']
        if k == 'boss' and r.get('recheck'):
            o, b, a = r['recheck']['owner'], r['recheck']['best'], r['recheck']['ai']
        else:
            o, b, a = r['owner']['score'], r['best']['score'], (r['ai'] or {}).get('score')
        tgt = {'A': '少漏怪(期望)', 'B': '少漏怪(对齐波次)', 'boss': 'BOSS 份额' + ('（可重分装备）' if r['task'].get('items') else '（只动站位）')}[r['objective']]
        steps = '；'.join(s['what'] for s in r['best']['steps']) or '（不动最好）'
        w(f"| R{r['round']} | {tgt} | {sn(o,k)} | {sn(a,k)} | {sn(b,k)} | {steps} |")
    # items
    I = [r for r in field['rows'] if r['task']['kind'] == 'item']
    base = {r['task']['itemUid']: {x['round']: x for x in r['rounds']} for r in I if r['task']['toBase'] is None}
    w("\n### B 口径：装备给谁（装上就锁死；后面每一仗都把这件换到另一个人身上，其余与 owner 完全一样）\n")
    w("| 装上的回合 | 装备 | owner 给了 | 换给 | 生效回合数 | Δ对齐波次漏怪 | Δ期望漏怪 | ΔR14 份额 | ΔR15 份额 |")
    w("|---|---|---|---|---|---|---|---|---|")
    best_by_ev = {}
    for r in sorted(I, key=lambda x: (x['task']['round'], x['task']['itemUid'], str(x['task']['toBase']))):
        t = r['task']
        if t['toBase'] is None: continue
        b = base.get(t['itemUid'], {})
        dB = dA = 0; d14 = d15 = None; n = 0
        for x in r['rounds']:
            o = b.get(x['round'])
            if not x.get('applies') or not o or not o.get('score'): continue
            n += 1
            if x['kind'] == 'normal': dB += x['score']['B'] - o['score']['B']; dA += x['score']['A'] - o['score']['A']
            elif x['round'] == 14: d14 = x['score']['share'] - o['score']['share']
            else: d15 = x['score']['share'] - o['score']['share']
        if n == 0: continue
        w(f"| R{t['round']} | {nm(t['itemId'])} | {nm(t['carrier'])} | {nm(t['toBase'])} | {n} | {dB:+d} | {dA:+.2f} | {'-' if d14 is None else f'{d14:+.2f}'} | {'-' if d15 is None else f'{d15:+.2f}'} |")

# ---------- advisor ----------
if advice:
    w("\n### 顾问（仓库 advisor，模型预筛+推演）在 owner 每个局面上的建议\n")
    w("「owner 这回合也做了这件事」只说明两张清单有交集，不代表 owner 照做。`当时小框说` 是记录里 overlay 当时的原话（第一条 PREP 快照）。")
    w("")
    w("| 回合 | 顾问建议（推演效用 / 对 guide 配对差） | owner 实际 | owner 这回合也做了这件事？ | 当时小框说 |")
    w("|---|---|---|---|---|")
    for r in [x for x in advice['rows'] if x['game'] == g]:
        a = r.get('advisor') or {}
        vg = a.get('vsGuide') or {}
        vs = f"{vg['mean']:+.3f}±{vg['se']:.3f}" if vg.get('se') is not None else '-'
        live = (r.get('liveOverlay') or [{}])[0]
        c0 = r.get('ownerTurnContainsAdvisorAction')
        act = (a.get('action') or {})
        if c0 is None and act.get('type') == 'equip':
            lab = a.get('label', '')   # 给 X 装 Y
            c0 = any(l.startswith('装备 ') and lab.endswith(l.split(' → ')[0][3:]) and l.split(' → ')[1] in lab for l in OWNER_EQUIPS.get(r['round'], []))
        cont = {True: '是', False: '否', None: '-'}[c0]
        w(f"| R{r['round']} | {a.get('label', r.get('error'))}（{fmt(a.get('utility'),3)} / {vs}） | {r['owner']} | {cont} | {live.get('advice') or '-'} |")
txt = '\n'.join(out)
if g == 'game2': txt = txt.replace('歌蕾蒂娅', '4_27(替身)').replace('chess_char_4_27_a', '4_27(替身)')
print(txt)
