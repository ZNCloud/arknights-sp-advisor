// Lineup check (advisor/lineup.mjs) on the owner's recorded battle boards (positions/<game>-rXX-end.json of
// human/replay.mjs): what would the advisor have said just before the owner pressed Ready? A normal round is fought
// against the replay's aligned enemy pick (docs/human/replay-<game>.json) — the stand-in for the wave the owner saw in
// the prep preview; boss rounds need no wave. The re-check stays on the owner's own field (recheckMetric 'own'): the
// record holds nothing about the teammates, whose boards here are engine stand-ins. Output: per round the greedy steps,
// the re-checked gain and whether it is recommended.
// node sp-advisor/eval/human-lineup.mjs --positions positions --out results/lineup-human.json [--games game1,game2]
//      [--rounds 1-15] [--workers 48] [--steps 3] [--seeds 4] [--recheck 24]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fromJSON, restore, capture, toJSON } from '../advisor/state.mjs';
import { checkLineup, poolEval, describe } from '../advisor/lineup.mjs';
import { waveOf } from '../advisor/field.mjs';
import { RolloutPool } from '../advisor/pool.mjs';

const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i += 2) opt[args[i].slice(2)] = args[i + 1];
const range = s => s.split(',').flatMap(x => { const [a, b] = x.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
const games = (opt.games || 'game1,game2').split(','), rounds = range(opt.rounds || '1-15');
const pool = new RolloutPool(+(opt.workers || 48));
const replayOf = g => JSON.parse(readFileSync(new URL(`../docs/human/replay-${g}.json`, import.meta.url), 'utf8'));

// the recorded battle board with the round's aligned wave in place (normal rounds)
function ownerBoard(posDir, game, round, rep) {
  const f = `${posDir}/${game}-r${String(round).padStart(2, '0')}-end.json`;
  if (!existsSync(f)) return null;
  const st = fromJSON(readFileSync(f, 'utf8'));
  const pick = rep.rounds.find(x => x.round === round)?.wave?.chosen?.pick || null;
  if (!pick) return { st, aligned: false };
  const m = restore(st, { rngMode: 'exact' });
  m.wave = waveOf(m, pick);
  for (const [i, p] of m.order.entries()) p.ready = st.seats[i].ready;   // restore() un-readies every seat
  const out = capture(m); m.dispose();
  return { st: out, aligned: true };
}

const out = { cfg: { steps: +(opt.steps || 3), seeds: +(opt.seeds || 4), recheck: opt.recheck ? +opt.recheck : null }, rows: [] };
const t0 = Date.now();
for (const g of games) {
  const rep = replayOf(g);
  for (const r of rounds) {
    const pos = ownerBoard(opt.positions || 'positions', g, r, rep);
    if (!pos) continue;
    const json = toJSON(pos.st), key = `${g}-${r}-lineup`;
    const res = await checkLineup(pos.st, { evalMany: poolEval(pool, json, key), maxSteps: out.cfg.steps, seeds: out.cfg.seeds, recheckSeeds: out.cfg.recheck ?? undefined,
      recheckMetric: 'own', log: s => console.log(`  ${g} R${r} ${s}`) });
    console.log(`${g} R${r} [${res.kind}] ${describe(res)} (${res.evals} evals, ${(res.ms / 1000).toFixed(1)} s)`);
    out.rows.push({ game: g, round: r, alignedWave: pos.aligned, ...res });
    writeFileSync(opt.out || 'results/lineup-human.json', JSON.stringify(out, null, 1));
  }
}
await pool.close();
console.log(`done ${out.rows.length} boards in ${Math.round((Date.now() - t0) / 1000)} s`);
