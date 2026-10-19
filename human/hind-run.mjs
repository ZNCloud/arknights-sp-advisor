// Driver: every (round × candidate × mode × sample) rollout of one game on a worker pool, common random numbers across
// candidates and modes (sampleSeed = 1000·round + k). Output: one JSON with every rollout.
// node sp-advisor/human/hind-run.mjs <game> <replay.json> <positionsDir> <out.json> [--rounds 1-15] [--cands a,b] [--modes A,B] [--N 12] [--workers 60]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { RolloutPool } from '../advisor/pool.mjs';
import { CANDIDATES } from './candidates.mjs';

const [game, replayPath, posDir, outPath, ...rest] = process.argv.slice(2);
const opt = {}; for (let i = 0; i < rest.length; i += 2) opt[rest[i].slice(2)] = rest[i + 1];
const range = s => s.split(',').flatMap(x => { const [a, b] = x.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
const rounds = range(opt.rounds || '1-15'), cands = (opt.cands || Object.keys(CANDIDATES).join(',')).split(','), modes = (opt.modes || 'A,B').split(',');
const N = +(opt.N || 12), pool = new RolloutPool(+(opt.workers || 60), new URL('./hind-worker.mjs', import.meta.url));
const tasks = [];
for (const round of rounds) {
  const f = `${posDir}/${game}-r${String(round).padStart(2, '0')}-start.json`;
  if (!existsSync(f)) { console.log(`skip R${round}: no position ${f}`); continue; }
  const stateJSON = readFileSync(f, 'utf8');
  for (const cand of cands) for (const mode of modes) for (let k = 1; k <= N; k++)
    tasks.push({ game, replayPath, stateKey: f, stateJSON, round, cand, mode, sampleSeed: 1000 * round + k });
}
const t0 = Date.now(), rows = [], errors = [];
let done = 0;
await Promise.all(tasks.map(t => pool.run(t).then(r => rows.push(r), e => errors.push(String(e.message || e).slice(0, 600))).finally(() => {
  if (++done % 100 === 0 || done === tasks.length) console.log(`${game}: ${done}/${tasks.length} rollouts, ${errors.length} errors, ${Math.round((Date.now() - t0) / 1000)} s`);
})));
await pool.close();
writeFileSync(outPath, JSON.stringify({ game, rounds, cands, modes, N, seconds: Math.round((Date.now() - t0) / 1000), errors, rows }));
console.log(`wrote ${outPath}: ${rows.length} rollouts, ${errors.length} errors`);
