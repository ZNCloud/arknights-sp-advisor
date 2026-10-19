// Usage:
//   node sp-advisor/advisor/cli.mjs save --seed 1004 --round 10 --out positions/s1004-r10.json [--guide guides/g06_final.json]
//   node sp-advisor/advisor/cli.mjs advise --state positions/s1004-r10.json [--player p0] [--K 8 --N 8 --N2 8 --workers 24] [--model sp-advisor/models]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { makeMatch, runToEnd } from '../eval/engine.mjs';
import { installGuide } from '../guides/policy.mjs';
import { capture, toJSON, fromJSON } from './state.mjs';
import { advise, modelScorer } from './advise.mjs';
import { RolloutPool } from './pool.mjs';

const [cmd, ...rest] = process.argv.slice(2), opt = {};
for (let i = 0; i < rest.length; i++) { if (!rest[i].startsWith('--')) throw Error(`Expected --flag, got ${rest[i]}`); opt[rest[i].slice(2)] = rest[++i]; }
const spec = JSON.parse(readFileSync(opt.guide || 'guides/g06_final.json', 'utf8'));

// Play the guide game for --seed and capture the position at the start of --round's prep (before any seat acted).
export function savePosition(seed, round, players = 4) {
  const m = makeMatch(seed, players); installGuide(m, spec); let snap = null;
  const sb = m.scheduleBotPrep;
  m.scheduleBotPrep = function (ps) { if (this.round === round && !snap) snap = capture(this); return sb.call(this, ps); };
  m.start(); runToEnd(m); m.dispose();
  if (!snap) throw Error(`seed ${seed}: the game ended before round ${round}`);
  return snap;
}
if (cmd === 'save') {
  const s = savePosition(Number(opt.seed), Number(opt.round), Number(opt.players || 4));
  mkdirSync(dirname(opt.out), { recursive: true }); writeFileSync(opt.out, toJSON(s));
  console.log(`saved ${opt.out} round=${s.match.round} seats=${s.seats.map(p => `${p.playerId}:lp${p.lp}/$${p.funds}/L${p.shop.level}`).join(' ')}`);
} else if (cmd === 'advise') {
  const state = fromJSON(readFileSync(opt.state, 'utf8'));
  const pool = new RolloutPool(Number(opt.workers || 24));
  const res = await advise(state, { playerId: opt.player || 'p0', spec, pool, K: Number(opt.K || 8), N: Number(opt.N || 8), N2: Number(opt.N2 || 8), seed: Number(opt.seed || 1),
    scorer: opt.model ? modelScorer({ pool, spec, modelDir: opt.model }) : null });
  await pool.close();
  console.log(`round ${state.match.round} seat ${opt.player || 'p0'}: ${res.candidatesConsidered} legal actions, ${res.candidates.length} evaluated, ${res.rollouts} rollouts, ${(res.ms / 1000).toFixed(1)}s`);
  for (const c of res.candidates) console.log(`${c === res.recommendation ? '★' : ' '} ${c.label.padEnd(28)} win ${(c.winRate * 100).toFixed(0)}% [${c.winCI95.map(x => (x * 100).toFixed(0)).join('-')}] U=${c.utility.toFixed(3)}±${(c.utilitySE ?? 0).toFixed(3)} R14伤${(c.r14Dmg * 100).toFixed(0)}% 活到R14 ${(c.reachR14 * 100).toFixed(0)}% n=${c.n}${c.vsGuide ? ` vsGuide ${c.vsGuide.mean >= 0 ? '+' : ''}${c.vsGuide.mean.toFixed(3)}±${(c.vsGuide.se ?? 0).toFixed(3)}` : ''}${c.guideFirst ? ' (guide首选)' : ''}`);
  if (res.modelTable) { console.log(`value model, all ${res.modelTable.length} legal actions (top 12):`); for (const r of res.modelTable.slice(0, 12)) console.log(`   ${r.label.padEnd(28)} modelU=${r.modelUtil.toFixed(3)} modelWin=${(r.modelWin * 100).toFixed(1)}%`); }
  if (res.illegal.length) console.log('illegal (engine refused):', JSON.stringify(res.illegal));
  if (opt.out) writeFileSync(opt.out, JSON.stringify(res, null, 1));
} else if (cmd) throw Error(`unknown command ${cmd}`);
