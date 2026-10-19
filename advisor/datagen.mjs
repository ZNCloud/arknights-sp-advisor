// Self-play data for the value model. Diverse policies: guide specs (g06/g07/...), random perturbation
// (epsilon random legal actions, early turn ends), and diagnostic combo injection (labelled positives).
// Records, at every prep end, one row per alive seat: features + policy meta; labels filled at game end.
// Usage: node sp-advisor/advisor/datagen.mjs --games 2000 --seed 50000 --workers 24 --out data/selfplay.jsonl
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { RolloutPool } from './pool.mjs';
import { dataHash, codeHash } from '../eval/version.mjs';

const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) { if (!args[i].startsWith('--')) throw Error('Expected --flag'); opt[args[i].slice(2)] = args[++i]; }
const games = +(opt.games || 100), seed0 = +(opt.seed || 50000), out = opt.out || 'data/selfplay.jsonl';
const guides = (opt.guides || 'guides/g06_final.json,guides/g07_kj_natural.json,guides/g06_la_natural.json').split(',');
const specs = guides.map(g => JSON.parse(readFileSync(g, 'utf8')));
mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, '');
// B1: every data file carries the game version it was generated on (sidecar <out>.meta.json).
writeFileSync(`${out}.meta.json`, JSON.stringify({ ...dataHash(), codeHash: codeHash(), games, seed0, guides, table: opt.table === '1', favor: opt.favor || null, createdAt: new Date().toISOString() }, null, 1));
const pool = new RolloutPool(+(opt.workers || 24), new URL('./datagen-worker.mjs', import.meta.url));
let done = 0, rows = 0, wins = 0, dropped = 0; const t0 = Date.now();
await Promise.all(Array.from({ length: games }, (_, i) => {
  const seed = seed0 + i, r = (seed * 2654435761 >>> 0) / 2 ** 32;
  // Mix: 15% injection, otherwise natural with eps in {0, .1, .25, .4}.
  const policy = r < .15 ? { inject: ['la_mix', 'kj_items', 'la_items', 'la_full'][seed % 4], injectFrom: 6 + seed % 7, eps: 0 } : { eps: [0, .1, .25, .4][seed % 4] };
  const spec = specs[(seed >> 2) % specs.length];
  return pool.run({ seed, spec, policy: { ...policy, table: opt.table === '1', favor: opt.favor ? opt.favor.split(',') : null } }).then(res => {
    appendFileSync(out, res.rows.map(x => JSON.stringify(x)).join('\n') + (res.rows.length ? '\n' : ''));
    done++; rows += res.rows.length; if (res.outcome.win) wins++; if (res.engineError) { dropped++; console.log(`seed ${seed}: dropped (engine error) ${res.engineError}`); }
    if (done % 50 === 0 || done === games) console.log(`datagen ${done}/${games} rows=${rows} wins=${wins} droppedEngineError=${dropped} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  });
}));
await pool.close();
