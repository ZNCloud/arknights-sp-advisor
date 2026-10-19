// B5 demo: value of "buy the changed operator" vs "guide" on real positions, by rollouts (exact current engine) and
// by the production model; run once vanilla and once through eval/with-patch.mjs to see the before/after change.
// Usage: node sp-advisor/eval/b5-value.mjs --positions a.json,b.json --favor chess_char_3_01_a --N 24 --out r.json
import { readFileSync, writeFileSync } from 'node:fs';
import { fromJSON, restore } from '../advisor/state.mjs';
import { listActions } from '../advisor/actions.mjs';
import { advise } from '../advisor/advise.mjs';
import { modelStatus } from '../advisor/meta.mjs';
import { RolloutPool } from '../advisor/pool.mjs';
import { contentPatch } from './content.mjs';
const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) opt[args[i].replace(/^--/, '')] = args[++i];
const spec = JSON.parse(readFileSync(opt.guide || 'guides/g06_la_natural.json', 'utf8')), favor = opt.favor.split(',');
const status = modelStatus(opt.model || 'sp-advisor/models');
console.log(`content patch: ${contentPatch()?.sha256?.slice(0, 12) || 'none (vanilla)'}; 模型状态：${status.reason}`);
const pool = new RolloutPool(+(opt.workers || 16)), out = { patch: contentPatch(), modelStatus: status.reason, rows: [] };
for (const file of opt.positions.split(',')) {
  const state = fromJSON(readFileSync(file, 'utf8')), live = restore(state, { rngMode: 'exact' }), ps = live.players.get('p0');
  const picks = listActions(live, ps).filter(a => a.type === 'guide' || (a.type === 'buy' && favor.includes(live.gd.baseIdOf(a.id))));
  live.dispose();
  const only = async () => ({ keep: picks, scored: picks });
  const res = await advise(state, { playerId: 'p0', spec, pool, K: 99, N: +(opt.N || 24), N2: 0, seed: 11, scorer: only });
  const g = res.candidates.find(c => c.action.type === 'guide'), b = res.candidates.find(c => c.action.type === 'buy');
  const row = { file, round: state.match.round, buy: b && { label: b.label, win: b.winRate, U: b.utility, r14: b.r14Dmg, n: b.n }, guide: { win: g.winRate, U: g.utility, r14: g.r14Dmg, n: g.n }, buyVsGuide: b?.vsGuide, engineErrorRollouts: res.engineErrorRollouts };
  out.rows.push(row);
  console.log(`${file} R${row.round}: ${b?.label} U=${b?.utility.toFixed(3)} win ${(b?.winRate * 100).toFixed(0)}% | guide U=${g.utility.toFixed(3)} win ${(g.winRate * 100).toFixed(0)}% | 买−guide ${b?.vsGuide ? `${b.vsGuide.mean >= 0 ? '+' : ''}${b.vsGuide.mean.toFixed(3)}±${b.vsGuide.se.toFixed(3)}` : '-'}`);
}
await pool.close();
if (opt.out) writeFileSync(opt.out, JSON.stringify(out, null, 1));
