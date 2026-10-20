// Re-score the owner's board and the searched best boards of the boss rounds on the PAIR field (advisor/battle.mjs
// ownerPairFight; partner = the same board) with many seeds: guards against a layout that only exploits the solo template.
// node sp-advisor/human/pairverify.mjs <field.json> <positionsDir> <out.json> [seeds]
import { readFileSync, writeFileSync } from 'node:fs';
import { restore, fromJSON } from '../advisor/state.mjs';
import { applyLayout, applyItems } from '../advisor/field.mjs';
import { ownerPairFight } from '../advisor/battle.mjs';
const [fieldPath, posDir, outPath, seedsArg] = process.argv.slice(2);
const F = JSON.parse(readFileSync(fieldPath, 'utf8')), seeds = +(seedsArg || 12);
const HIDDEN = { boss_8: 50, boss_9: 40, boss_10: 40 };
const out = [];
for (const r of F.rows.filter(x => x.task.kind === 'layout' && x.kind === 'boss')) {
  const st = fromJSON(readFileSync(`${posDir}/${F.game}-r${String(r.round).padStart(2, '0')}-end.json`, 'utf8'));
  const probe = restore(st, { rngMode: 'exact' }); const bossId = probe.bossId, hiddenRound = probe.gd.hiddenRound; probe.dispose();
  const bosses = r.round === hiddenRound ? Object.entries(HIDDEN) : [[bossId, 1]];
  const score = (L, I) => {
    let w = 0, cd = 0, ot = 0, pc = 0;
    for (const [id, wt] of bosses) for (let k = 0; k < seeds; k++) {
      const m = restore(st, { rngMode: 'exact' });
      try {
        const ps = m.players.get('p0'), mate = m.order.find(p => p !== ps);
        if (!applyItems(ps, I) || !applyLayout(ps, L)) return null;
        // the partner fields the very same board (same cards, tiles, items) on the mirrored half
        mate.board = new Map([...ps.board].map(([key, p]) => [key, structuredClone(p)])); mate.layers = { ...ps.layers }; mate.bondCountBonus = { ...ps.bondCountBonus }; mate.recompute();
        const f = ownerPairFight(m, ps, mate, { bossId: id, hidden: r.round === hiddenRound, round: r.round, seed: 500 + k });
        w += wt; cd += wt * f.shareAtCountdown; ot += wt * f.shareAtOvertime; pc += wt * (f.shareAtCountdown >= 1 ? 1 : 0);
      } finally { m.dispose(); }
    }
    return { share: +(cd / w).toFixed(3), shareOt: +(ot / w).toFixed(3), pClear: +(pc / w).toFixed(3) };
  };
  const row = { round: r.round, items: !!r.task.items, owner: score(r.owner.layout, r.owner.items), best: score(r.best.layout, r.best.items), ai: r.ai ? score(r.ai.layout, r.owner.items) : null, steps: r.best.steps.map(s => s.what) };
  out.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync(outPath, JSON.stringify({ game: F.game, seeds, rows: out }, null, 1));
