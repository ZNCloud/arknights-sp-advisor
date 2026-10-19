// Battle-level hindsight driver: layout searches for every recorded round (A objective for normal rounds, B objective
// where the owner lost LP, boss share for R14/R15) and equipment re-targeting for every equip event of the record.
// node sp-advisor/human/field-run.mjs <game> <replay.json> <positionsDir> <out.json> [--workers 60] [--only layout|item]
import { writeFileSync, existsSync } from 'node:fs';
import { RolloutPool } from '../advisor/pool.mjs';
import { loadGame } from './replay.mjs';
import { engineId } from './force.mjs';
import { readFileSync } from 'node:fs';

const [gameName, replayPath, posDir, outPath, ...rest] = process.argv.slice(2);
const opt = {}; for (let i = 0; i < rest.length; i += 2) opt[rest[i].slice(2)] = rest[i + 1];
const G = loadGame(gameName), rep = JSON.parse(readFileSync(replayPath, 'utf8'));
const tasks = [];
const has = r => existsSync(`${posDir}/${gameName}-r${String(r).padStart(2, '0')}-end.json`);
if (opt.only !== 'item') for (const R of G.rounds) {
  if (!has(R.round)) continue;
  const base = { kind: 'layout', game: gameName, replayPath, posDir, round: R.round, budget: +(opt.budget || 200) };
  if (R.round >= 14) { tasks.push({ ...base, objective: 'boss', budget: R.round === 15 ? 100 : 160, items: true }); tasks.push({ ...base, objective: 'boss', budget: R.round === 15 ? 60 : 100, items: false, seed: 2 }); }
  else {
    tasks.push({ ...base, objective: 'A' });
    if (R.lpAfter < R.lpBefore) tasks.push({ ...base, objective: 'B' });
  }
}
// equip events: an item uid that appears on a board carrier for the first time
const events = [];
if (opt.only !== 'layout') {
  const seen = new Set();
  for (const R of G.rounds) {
    if (!R.end || R.end.inferred) continue;
    for (const b of R.end.board || []) for (const it of b.items || []) {
      if (seen.has(it.uid)) continue; seen.add(it.uid);
      events.push({ round: R.round, itemUid: it.uid, itemId: it.id, carrier: b.id });
    }
  }
  for (const ev of events) {
    const R = G.rounds.find(x => x.round === ev.round);
    const alts = new Set();
    for (const b of R.end.board || []) { if (b.id === ev.carrier) continue; const base = engineId(b.id).replace(/_b$/, '_a'); if ((b.items || []).length < 2) alts.add(base); }
    tasks.push({ kind: 'item', game: gameName, replayPath, posDir, ...ev, toBase: null });
    for (const toBase of alts) tasks.push({ kind: 'item', game: gameName, replayPath, posDir, ...ev, toBase });
  }
}
const pool = new RolloutPool(+(opt.workers || 60), new URL('./field-worker.mjs', import.meta.url));
const t0 = Date.now(), rows = [], errors = [];
let done = 0;
await Promise.all(tasks.map(t => pool.run(t).then(r => rows.push(r), e => errors.push(String(e.message || e).slice(0, 800))).finally(() => {
  if (++done % 10 === 0 || done === tasks.length) console.log(`${gameName}: ${done}/${tasks.length} tasks, ${errors.length} errors, ${Math.round((Date.now() - t0) / 1000)} s`);
})));
await pool.close();
writeFileSync(outPath, JSON.stringify({ game: gameName, events, seconds: Math.round((Date.now() - t0) / 1000), errors, rows }));
console.log(`wrote ${outPath}: ${rows.length} rows, ${errors.length} errors`);
