#!/usr/bin/env python3
"""Text grids of the owner's battle board vs the searched best board for chosen rounds (field-<game>.json)."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine_data import load_json
CH = load_json("chess.json"); IT = load_json("items.json")
ARROW = {"RIGHT": "→", "LEFT": "←", "UP": "↑", "DOWN": "↓"}
def cn(i):
    if i.startswith('chess_char_4_12') and False: return i
    c = CH.get(i) or {}
    return (c.get('name', i) + ('*' if c.get('isGolden') else ''))
def grid(layout, names, items=None, iname=None):
    cells = {}
    for x in layout:
        nm = cn(names[str(x['uid'])])
        it = ''
        if items and str(x['uid']) in items and items[str(x['uid'])]:
            it = '[' + '+'.join(iname.get(str(u), '?') for u in items[str(x['uid'])]) + ']'
        cells[(x['row'], x['col'])] = f"{nm}{ARROW.get(x['dir'],'?')}{it}"
    rows = []
    for r in range(9, 13):
        rows.append(f"| {r} | " + ' | '.join(cells.get((r, c), '·') for c in range(2, 11)) + ' |')
    return '| 行\\列 | ' + ' | '.join(str(c) for c in range(2, 11)) + ' |\n|' + '---|' * 10 + '\n' + '\n'.join(rows)
g = sys.argv[1]; want = [tuple(x.split(':')) for x in sys.argv[2:]]   # round:objective[:items]
F = json.load(open(f'results/field-{g}.json'))
for r in F['rows']:
    t = r['task']
    if t['kind'] != 'layout': continue
    key = (str(r['round']), r['objective']) if t.get('items') is None else (str(r['round']), r['objective'], 'items' if t.get('items') else 'layout')
    if not any(key[:len(w)] == w for w in want): continue
    names = {str(k): v for k, v in r['names'].items()}
    print(f"\n#### R{r['round']} {r['objective']} {'可重分装备' if t.get('items') else ''}\n\nowner：\n")
    print(grid(r['owner']['layout'], names))
    print("\n事后最优：\n")
    print(grid(r['best']['layout'], names))
    print('\n改动：' + '；'.join(s['what'] for s in r['best']['steps']))
