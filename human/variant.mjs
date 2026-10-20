// Pair-field score of hand-picked variants of a recorded boss board. Mods: "dir:<name>:<DIR>", "move:<name>:<r>,<c>"
// (operator names as the engine data spells them; the first match on the board). node variant.mjs <game> <posDir> <round> <seeds> <label=mod;mod> …
import { readFileSync } from 'node:fs';
import { restore, fromJSON } from '../advisor/state.mjs';
import { ownerPairFight, ownerBossFight } from '../advisor/battle.mjs';
const SOLO = process.env.SP_SOLO === '1';   // teammate-free lens: the owner alone on the solo template
const [game, posDir, roundArg, seedsArg, ...variants] = process.argv.slice(2);
const round = +roundArg, seeds = +seedsArg;
const st = fromJSON(readFileSync(`${posDir}/${game}-r${String(round).padStart(2, '0')}-end.json`, 'utf8'));
const HIDDEN = { boss_8: 50, boss_9: 40, boss_10: 40 };
const probe = restore(st, { rngMode: 'exact' }); const hidden = round === probe.gd.hiddenRound; const bosses = hidden ? Object.entries(HIDDEN) : [[probe.bossId, 1]]; probe.dispose();
function apply(ps, mods) {
  for (const mod of mods) {
    const [kind, name, arg] = mod.split(':');
    const e = [...ps.board].find(([, p]) => p.kind === 'chess' && ps.gd.chess(p.id)?.name === name);
    if (!e) throw Error(`no ${name} on the board`);
    const [key, p] = e;
    if (kind === 'dir') p.dir = arg;
    else if (kind === 'move') { const [r, c] = arg.split(',').map(Number); const k2 = `${r},${c}`; const other = ps.board.get(k2);
      ps._deployMap = null; ps._deployField = undefined; if (!ps._legal(p, r, c)) throw Error(`illegal ${name} → ${k2}`);
      ps.board.delete(key); if (other) ps.board.set(key, other); ps.board.set(k2, p); }
  }
  ps.recompute();
}
for (const v of ['owner=', ...variants]) {
  const [label, spec] = v.split('=');
  const mods = spec ? spec.split(';').filter(Boolean) : [];
  let w = 0, cd = 0, ot = 0, pc = 0;
  for (const [id, wt] of bosses) for (let k = 0; k < seeds; k++) {
    const m = restore(st, { rngMode: 'exact' });
    const ps = m.players.get('p0'), mate = m.order.find(p => p !== ps);
    apply(ps, mods);
    let f;
    if (SOLO) f = ownerBossFight(m, ps, { bossId: id, hidden, round, seed: 1100 + k });
    else { mate.board = new Map([...ps.board].map(([key, p]) => [key, structuredClone(p)])); mate.layers = { ...ps.layers }; mate.recompute();
      f = ownerPairFight(m, ps, mate, { bossId: id, hidden, round, seed: 1100 + k }); }
    w += wt; cd += wt * f.shareAtCountdown; ot += wt * f.shareAtOvertime; pc += wt * (f.shareAtCountdown >= 1 ? 1 : 0); m.dispose();
  }
  console.log(JSON.stringify({ game, round, field: SOLO ? 'solo' : 'pair', label, mods, share: +(cd / w).toFixed(3), shareOt: +(ot / w).toFixed(3), pClear: +(pc / w).toFixed(3) }));
}
