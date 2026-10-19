// Per-operator damage on the pair boss field (partner = the same board) for the owner's board and the searched best
// board of a boss round: the "why" behind a layout / item change. node sp-advisor/human/unitdmg.mjs <field.json> <posDir> <round> <items:0|1> [seeds]
import { readFileSync } from 'node:fs';
import { restore, fromJSON } from '../advisor/state.mjs';
import { applyLayout, applyItems } from './fieldeval.mjs';
import { ownerPairFight } from './battle.mjs';
const [fieldPath, posDir, roundArg, itemsArg, seedsArg] = process.argv.slice(2);
const F = JSON.parse(readFileSync(fieldPath, 'utf8')), round = +roundArg, seeds = +(seedsArg || 6);
const r = F.rows.find(x => x.task.kind === 'layout' && x.round === round && !!x.task.items === (itemsArg === '1'));
const st = fromJSON(readFileSync(`${posDir}/${F.game}-r${String(round).padStart(2, '0')}-end.json`, 'utf8'));
const HIDDEN = { boss_8: 50, boss_9: 40, boss_10: 40 };
const probe = restore(st, { rngMode: 'exact' }); const bosses = round === probe.gd.hiddenRound ? Object.keys(HIDDEN) : [probe.bossId]; const hidden = round === probe.gd.hiddenRound; probe.dispose();
const run = (L, I) => {
  const per = {};
  for (const id of bosses) for (let k = 0; k < seeds; k++) {
    const m = restore(st, { rngMode: 'exact' });
    const ps = m.players.get('p0'), mate = m.order.find(p => p !== ps);
    applyItems(ps, I); applyLayout(ps, L);
    mate.board = new Map([...ps.board].map(([key, p]) => [key, structuredClone(p)])); mate.layers = { ...ps.layers }; mate.recompute();
    const f = ownerPairFight(m, ps, mate, { bossId: id, hidden, round, seed: 700 + k });
    for (const u of f.units) if (u.kind === 'op' || u.dmg > 0) per[u.name] = (per[u.name] || 0) + u.dmg / (seeds * bosses.length);
    m.dispose();
  }
  return per;
};
const o = run(r.owner.layout, r.owner.items), b = run(r.best.layout, r.best.items);
const names = [...new Set([...Object.keys(o), ...Object.keys(b)])].sort((x, y) => (b[y] || 0) - (b[x] || 0));
console.log(JSON.stringify({ game: F.game, round, bosses, rows: names.map(n => ({ unit: n, owner: Math.round(o[n] || 0), best: Math.round(b[n] || 0), delta: Math.round((b[n] || 0) - (o[n] || 0)) })) }));
