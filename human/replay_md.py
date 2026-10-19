#!/usr/bin/env python3
"""Render results/replay-<game>.json into the STEP_sphind_2254_replay markdown (both games)."""
import json, sys
D = "/jfs/home/zhiningjiao/codex_work/spcurve3_1612/engine/data/"
CH = json.load(open(D + "chess.json")); IT = json.load(open(D + "items.json")); BO = json.load(open(D + "bonds.json")); BS = json.load(open(D + "bosses.json"))
nm = lambda i: (CH.get(i) or {}).get('name', i) + ('(精锐)' if (CH.get(i) or {}).get('isGolden') else '') if not i.startswith('chess_item') else (IT.get(i) or {}).get('name', i) + ('+' if (IT.get(i) or {}).get('isGolden') else '')
bn = lambda b: (BO.get(b) or {}).get('name', b)
G = {g: json.load(open(f"{sys.argv[1] if len(sys.argv) > 1 else 'results'}/replay-{g}.json")) for g in ['game1', 'game2']}
LABEL = {'game1': '第一局（10-18 第 65–140 行）', 'game2': '第二局（10-19 第 72–144 行）'}
BAND = {'game1': '潘格尼尼 band_paganini（开局 24 血；R8 白得 6 阶精锐塑心 = 「累计花 55 资金送 4 阶以上精锐拉特兰」）',
        'game2': '绮良 band_kirara（开局 26 血；R13/R14 开局白得的人 = 「每花 20 资金送一名不高于调度中心等级的干员」）'}
out = []
w = out.append
def pick_s(p):
    if not p: return '-'
    return f"{p.get('type')}/{p.get('key')}"
for g, r in G.items():
    rows = r['rounds']
    ok = [x for x in rows if x.get('settle', {}).get('match')]
    bad = [x for x in rows if not x.get('settle', {}).get('match')]
    w(f"\n## {LABEL[g]}\n")
    w(f"- 结算血量和记录一致：**{len(ok)}/{len(rows)} 回合**（{', '.join('R%d' % x['round'] for x in ok)}）。")
    w(f"- 不一致：{', '.join('R%d（引擎 %s / 记录 %s）' % (x['round'], x['settle']['engineLp'], x['settle']['recordLp']) for x in bad) or '无'}——都是 BOSS 回合，原因见「对不齐的地方」。")
    w(f"- 对齐用的开局：地图 `{r['stage']}`（7 张图里唯一能让 owner 全部站位合法的一张）；R14 BOSS `{r['boss']}` {BS[r['boss']]['name']}；band {BAND[g]}；"
      f"本局禁用盟约（从记录里从没出现过的盟约里取）{', '.join(bn(b) for b in r['bans']['drawn'])}（引擎规定禁 7 个，记录只容得下 {len(r['bans']['drawn'])} 个，差 {r['bans']['short']} 个）。")
    w("")
    w("| 回合 | 开局强制对齐 | owner 的净操作（引擎接口重放） | 引擎拒绝 | 重放后与记录的差异 | 战斗棋盘强制后差异 | 敌人波次（引擎先验里与记录一致的概率 / 选中排名） | 结算血量 记录→引擎 |")
    w("|---|---|---|---|---|---|---|---|")
    for x in rows:
        t = x.get('turn', {}); d = t.get('derived', {}) or {}
        ops = []
        if d.get('levelUps'): ops.append(f"升级×{d['levelUps']}")
        if d.get('buys'): ops.append('买 ' + '、'.join(nm(b['id']) for b in d['buys']))
        if d.get('itemBuys'): ops.append('买装备 ' + '、'.join(nm(b['id']) for b in d['itemBuys']))
        if d.get('sells'): ops.append('卖 ' + '、'.join((f"{nm(s['base'])}(精锐，3 份)" if s['copies'] == 3 else f"{nm(s['base'])}×{s['copies']}") for s in d['sells']))
        if d.get('eliteAppeared'): ops.append('白得精锐 ' + '、'.join(nm(b['id']) for b in d['eliteAppeared']))
        if d.get('extra'): ops.append('非开局商店得到 ' + '、'.join(nm(b['id']) for b in d['extra']))
        if d.get('itemExtra'): ops.append('非开局商店得到装备 ' + '、'.join(nm(b['id']) for b in d['itemExtra']))
        eq = [l for l in t.get('log', []) if l.startswith('装备 ')]
        if eq: ops.append('；'.join(eq))
        f = t.get('funds', {})
        if f: ops.append(f"开局 {f.get('start')} 金，开局商店买完/升级后剩 {f.get('afterShopActions')} 金（这部分花在刷新或作废，记录分不开）")
        wv = x.get('wave') or {}
        wave = '-' if not wv else f"{wv.get('matchingPriorMass')} / 第 {(wv.get('chosen') or {}).get('rank', '无')} 个（{pick_s((wv.get('chosen') or {}).get('pick'))}）"
        st = x.get('settle', {})
        lp = f"{x['lpCarried']['record']}→{st.get('recordLp')} / 引擎 {st.get('engineLp')} {'✓' if st.get('match') else '✗'}"
        fix = x.get('forceStart', {}).get('bondFix') or {}
        fs = '✓' + (f"（盟约人数补正 {', '.join(f'{bn(k)}{v:+d}' for k, v in fix.items())}）" if fix else '')
        w(f"| R{x['round']} | {fs} | {'；'.join(ops) or '无'} | {'；'.join(t.get('refused', [])) or '无'} | {'；'.join(x.get('diffAfterReplay', [])) or '无'} | {'；'.join(x.get('forceEnd', {}).get('diff', [])) or '无'} | {wave} | {lp} |")
    ba = [x for x in rows if x.get('bossAlign')]
    if ba:
        w("\n**BOSS 回合对齐**（记录里没有队友、没有隐藏 BOSS：按「队友几个人 / 其中几个用 owner 战斗棋盘镜像（其余是引擎 AI 自己的棋盘）/ 隐藏 BOSS / 战斗随机种子」逐个试，取第一个结算血量等于记录的组合）：\n")
        w("| 回合 | 记录 | 试了几种 | 选中 | 试过的组合里 owner 结算血量的分布 |")
        w("|---|---|---|---|---|")
        for x in ba:
            t = x['bossAlign']['tried']; c = x['bossAlign']['chosen']
            dist = {}
            for y in t: dist[y['lp']] = dist.get(y['lp'], 0) + 1
            ch = (f"队友 {c['seats']} 人、{c['mirrored']} 个镜像" + (f"、隐藏 BOSS {c['hidden']} {BS[c['hidden']]['name']}" if c.get('hidden') else '') + ('、换了战斗种子' if c.get('seed') is not None else '')) if c else '**没有一种对上**'
            w(f"| R{x['round']} | {x['lpCarried']['record']}→{x['settle']['recordLp']} | {len(t)} | {ch} | {', '.join(f'{k} 血×{v}' for k, v in sorted(dist.items(), key=lambda kv: -kv[0]))} |")
    bos = [x for x in rows if x.get('ownerBoss')]
    if bos:
        w("\n**owner 自己这块棋盘单独打 BOSS**（引擎单人模板，只看自己那一份血池 = bloodPoint×1；4 个种子里的 1 个，复现时的读数）：\n")
        w("| 回合 | BOSS | 倒计时内打掉自己那份的 | 加时扣血前打掉的 | 打穿自己那份用时（游戏秒） |")
        w("|---|---|---|---|---|")
        for x in bos:
            for b in x['ownerBoss']:
                w(f"| R{x['round']} | {BS[b['bossId']]['name']}（{b['bossId']}） | {b['shareAtCountdown']:.0%} | {b['shareAtOvertime']:.0%} | {b['timeToShareGs'] if b['timeToShareGs'] is not None else '没打穿'} |")
print('\n'.join(out))
