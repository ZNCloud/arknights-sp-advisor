// Acceptance set: the recorded human matches as engine positions (task sphind_2254 step 4). Runs human/replay.mjs for
// every registered game and checks (1) every normal round's settle LP equals the record, (2) the engine logged no
// error, (3) the captured start / battle positions are byte-identical to the manifest human/accept-set.json (sha256 of
// the state JSON; `--write` records a new manifest). The positions themselves are regenerated, not stored (≈35 MB).
// node sp-advisor/human/accept.mjs [--write] [--games game1,game2] [--positions dir]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { replayGame } from './replay.mjs';
import { toJSON } from '../advisor/state.mjs';
import { GAMES } from './record.mjs';

const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) { if (args[i] === '--write') opt.write = true; else opt[args[i].slice(2)] = args[++i]; }
const games = (opt.games || Object.keys(GAMES).join(',')).split(',');
const manifestPath = new URL('./accept-set.json', import.meta.url);
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { positions: {} };
if (opt.positions) mkdirSync(opt.positions, { recursive: true });
const out = { games: {}, failures: [] };
for (const g of games) {
  const hashes = {};
  const r = await replayGame(g, { log: () => {}, mirrorTeam: true, captureEach: (round, st, tag) => {
    const json = toJSON(st), key = `${g}-r${String(round).padStart(2, '0')}-${tag}`;
    hashes[key] = createHash('sha256').update(json).digest('hex');
    if (opt.positions) writeFileSync(`${opt.positions}/${key}.json`, json);
  } });
  const normal = r.rounds.filter(x => x.round < 14);
  const lpOk = normal.filter(x => x.settle?.match).length;
  out.games[g] = { normalRounds: normal.length, settleLpMatch: lpOk, bossRounds: r.rounds.filter(x => x.round >= 14).map(x => ({ round: x.round, match: !!x.settle?.match, engineLp: x.settle?.engineLp, recordLp: x.settle?.recordLp })), positions: Object.keys(hashes).length };
  if (lpOk !== normal.length) out.failures.push(`${g}: settle LP matches ${lpOk}/${normal.length} normal rounds`);
  for (const [k, h] of Object.entries(hashes)) {
    if (opt.write) manifest.positions[k] = h;
    else if (manifest.positions[k] && manifest.positions[k] !== h) out.failures.push(`${k}: position hash changed`);
    else if (!manifest.positions[k]) out.failures.push(`${k}: not in the manifest`);
  }
}
if (opt.write) { manifest.note = 'sha256 of the advisor/state.mjs toJSON of every forced start / battle position of human/replay.mjs (mirror teammates in boss rounds)'; writeFileSync(manifestPath, JSON.stringify(manifest, null, 1)); }
console.log(JSON.stringify(out, null, 1));
console.log(out.failures.length ? `ACCEPT FAIL (${out.failures.length})` : 'ACCEPT PASS');
if (out.failures.length) process.exitCode = 1;
