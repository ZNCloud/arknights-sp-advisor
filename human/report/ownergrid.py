#!/usr/bin/env python3
"""Owner's recorded battle board of a round as a text grid (record row: id / tile / facing / items)."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine_data import load_json
CH = load_json("chess.json"); IT = load_json("items.json")
AR = {"RIGHT": "→", "LEFT": "←", "UP": "↑", "DOWN": "↓"}
def cn(i):
    if i.startswith('chess_char_4_27'): return '4_27'
    c = CH.get(i) or {}; return c.get('name', i) + ('*' if c.get('isGolden') else '')
def grid(row):
    cells = {}
    for b in row['board']:
        if not b.get('at'): continue
        it = ''.join('[' + IT.get(x['id'], {}).get('name', x['id']) + ']' for x in b.get('items', []))
        cells[tuple(b['at'])] = f"{cn(b['id'])}{AR.get(b.get('dir'), '')}{it}"
    out = ['| 行\\列 | ' + ' | '.join(str(c) for c in range(2, 11)) + ' |', '|' + '---|' * 10]
    for r in range(9, 13): out.append(f'| {r} | ' + ' | '.join(cells.get((r, c), '·') for c in range(2, 11)) + ' |')
    bench = [cn(h) for h in row['hand'] if not h.startswith('chess_item')]
    out.append(f"\n备战席：{'、'.join(bench) or '无'}（`*` = 精锐，箭头 = 朝向，[ ] = 装备）")
    return '\n'.join(out)
file, first, last = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
L = open(file).read().splitlines()[first - 1:last]
rows = [json.loads(l) for l in L]
for spec in sys.argv[4:]:
    rnd, note = spec.split('=', 1)
    rr = [r for r in rows if r['round'] == int(rnd) and r['phase'] in ('COMBAT', 'FINAL_ASSAULT', 'HIDDEN_CORE')]
    if not rr: continue
    print(f"\n#### R{rnd} owner 实际上场（战斗快照）\n"); print(grid(rr[0])); print(f"\n**建议改动**：{note}\n")
