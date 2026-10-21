// Self-play tables with a different play profile per seat, written as overlay-format records (one match per line:
// { seed, seats, outcome, rows }). Feeds advisor/learn-team.mjs (who played better, what to learn) and
// eval/team-eval.mjs (does the learned profile help).
// Usage: node sp-advisor/eval/teamplay.mjs --seeds 60001-60600 --mix g06,owner,fast6,slow,sloppy --out results/team-train.jsonl
//        [--p0 g06] [--seats p0=g06,p1=fast6,p2=g06,p3=g06] [--profiles sp-advisor/eval/team-profiles.json]
//        [--guide guides/g06_final.json] [--workers 64] [--lines shuffle|mates] [--team models/team-profile.json]
//   --lines shuffle: each seat plays a random available core line (else the guide's seat-order assignment);
//   --lines mates: p1–p3 pick random lines, p0 by its profile's line rule (blind / free / learned; needs --team for learned).
//   --team sp-advisor/models/team-profile.json: the learned profile (profiles with tempo/line 'learned').
//   --mix: every seat (p0 too unless --p0 is given) draws its profile from the list, uniformly, seeded by the seed.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { RolloutPool } from '../advisor/pool.mjs';
import { createRng, deriveSeed } from './engine.mjs';

const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) { if (!args[i].startsWith('--')) throw Error('Expected --flag'); opt[args[i].slice(2)] = args[++i]; }
export const parseSeeds = (s) => s.split(',').flatMap((r) => { const [a, b] = r.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
const seeds = parseSeeds(opt.seeds || '60001-60010');
const base = JSON.parse(readFileSync(opt.guide || 'guides/g06_final.json', 'utf8'));
const profiles = JSON.parse(readFileSync(opt.profiles || new URL('./team-profiles.json', import.meta.url), 'utf8'));
const out = opt.out || 'results/team.jsonl';
const teamProfile = opt.team ? JSON.parse(readFileSync(opt.team, 'utf8')) : null;
const fixed = opt.seats ? Object.fromEntries(opt.seats.split(',').map((x) => x.split('='))) : null;
const mix = opt.mix ? opt.mix.split(',') : null;
if (!fixed && !mix) throw Error('need --seats or --mix');
for (const id of [...(mix || []), ...Object.values(fixed || {}), opt.p0].filter(Boolean)) if (!profiles[id]) throw Error(`unknown profile ${id}`);
const seatsOf = (seed) => {
  if (fixed) return fixed;
  const rng = createRng(deriveSeed(seed, 'teamplay-seats')), s = {};
  for (const pid of ['p0', 'p1', 'p2', 'p3']) s[pid] = pid === 'p0' && opt.p0 ? opt.p0 : rng.pick(mix);
  return s;
};

mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, '');
const pool = new RolloutPool(+(opt.workers || 32), new URL('./teamplay-worker.mjs', import.meta.url));
let done = 0, dropped = 0, wins = 0; const t0 = Date.now();
await Promise.all(seeds.map((seed) => pool.run({ seed, base, seats: seatsOf(seed), profiles, lines: opt.lines || null, teamProfile }).then((g) => {
  done++;
  if (g.engineError) { dropped++; console.log(`seed ${seed}: dropped (engine error) ${g.engineError}`); return; }
  if (g.outcome.win) wins++;
  appendFileSync(out, JSON.stringify(g) + '\n');
  if (done % 100 === 0 || done === seeds.length) console.log(`teamplay ${done}/${seeds.length} wins=${wins} droppedEngineError=${dropped} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})));
await pool.close();
console.log(JSON.stringify({ out, games: done - dropped, droppedEngineError: dropped, wins, wallSec: (Date.now() - t0) / 1000 }));
