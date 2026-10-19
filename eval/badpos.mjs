// Bad-position study: find hard spots in real guide games (stuck at the R14 boss, core bond never online, broke),
// save them as position files, and ask the advisor for the best way out (paired vs. the guide continuation).
// Usage: node sp-advisor/eval/badpos.mjs --seeds 1001-1040 --out results/badpos.json [--model sp-advisor/models --K 4 --N 12 --N2 12 --max 4]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { makeMatch, runToEnd } from './engine.mjs';
import { installGuide } from '../guides/policy.mjs';
import { capture, toJSON, clone } from '../advisor/state.mjs';
import { advise, modelScorer } from '../advisor/advise.mjs';
import { RolloutPool } from '../advisor/pool.mjs';

const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) { if (!args[i].startsWith('--')) throw Error('Expected --flag'); opt[args[i].slice(2)] = args[++i]; }
const seeds = (opt.seeds || '1001-1040').split(',').flatMap(r => { const [a, b] = r.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
const spec = JSON.parse(readFileSync(opt.guide || 'guides/g06_final.json', 'utf8'));
const max = +(opt.max || 4);

// Every prep-start position of p0 in one guide game, with the tags that make it a "bad" spot.
function positions(seed) {
  const m = makeMatch(seed, 4); installGuide(m, spec); const out = [];
  const sb = m.scheduleBotPrep;
  m.scheduleBotPrep = function (ps) {
    if (ps.playerId === 'p0') {
      const core = this.guideTeam.routes.p0;
      out.push({ seed, round: this.round, funds: ps.funds, lp: ps.lp, coreActive: !!ps.bonds[core]?.active, core, state: capture(this) });
    }
    return sb.call(this, ps);
  };
  m.start(); const s = runToEnd(m); m.dispose();
  const lost14 = !s.victory && out.some(p => p.round === 14);
  return out.map(p => ({ ...p, tags: [lost14 && p.round >= 13 ? 'stuck14' : null, !p.coreActive && p.round >= 8 && p.round <= 10 ? 'noCore' : null,
    (p.round === 8 || p.round === 9) ? 'brokeSrc' : null].filter(Boolean) }));
}
const picked = { stuck14: [], noCore: [], broke: [], brokeSrc: [] };
for (const seed of seeds) for (const p of positions(seed)) for (const t of p.tags) if (picked[t].length < max && !picked[t].some(q => q.seed === p.seed)) picked[t].push(p);
// s1004 is the named stuck-at-14 case; always include its R13 spot.
if (!picked.stuck14.some(p => p.seed === 1004)) { const p = positions(1004).find(q => q.round === 13); if (p) picked.stuck14.unshift({ ...p, tags: ['stuck14'] }); }
// 缺钱局: prep-start funds are a fixed income (≈ round+3) in natural play, so a broke spot never occurs at prep start.
// DIAGNOSTIC construction: a real R8/R9 position with p0's funds set to 2 (stated in every output row).
for (const p of picked.brokeSrc) { const st = clone(p.state); st.seats.find(x => x.playerId === 'p0').funds = 2; picked.broke.push({ ...p, funds: 2, diagnostic: 'funds set to 2', state: st }); }
delete picked.brokeSrc;
mkdirSync('positions', { recursive: true });
const pool = new RolloutPool(+(opt.workers || 46)), rows = [];
for (const [tag, list] of Object.entries(picked)) for (const p of list) {
  const file = `positions/bad-${tag}-s${p.seed}-r${p.round}.json`; writeFileSync(file, toJSON(p.state));
  const res = await advise(p.state, { playerId: 'p0', spec, pool, K: +(opt.K || 4), N: +(opt.N || 12), N2: +(opt.N2 || 12), seed: p.seed,
    scorer: opt.model ? modelScorer({ pool, spec, modelDir: opt.model }) : null });
  const g = res.candidates.find(c => c.action.type === 'guide'), b = res.recommendation;
  const row = { tag, diagnostic: p.diagnostic || null, seed: p.seed, round: p.round, funds: p.funds, lp: p.lp, core: p.core, file, best: b.label, bestWin: b.winRate, bestU: b.utility, bestR14: b.r14Dmg,
    guideWin: g?.winRate, guideU: g?.utility, guideR14: g?.r14Dmg, vsGuide: b.vsGuide, n: b.n, ms: Math.round(res.ms),
    top: res.candidates.slice(0, 5).map(c => ({ label: c.label, win: c.winRate, U: +c.utility.toFixed(3), r14: +c.r14Dmg.toFixed(3), n: c.n, vsGuide: c.vsGuide })) };
  rows.push(row);
  console.log(`${tag} s${p.seed} R${p.round} $${p.funds} lp${p.lp}: best「${b.label}」win ${(b.winRate * 100).toFixed(0)}% U=${b.utility.toFixed(3)} | guide win ${((g?.winRate ?? 0) * 100).toFixed(0)}% U=${(g?.utility ?? 0).toFixed(3)} | Δ=${b.vsGuide ? b.vsGuide.mean.toFixed(3) + '±' + (b.vsGuide.se ?? 0).toFixed(3) : '0(guide最好)'} ${(res.ms / 1000).toFixed(0)}s`);
}
await pool.close();
writeFileSync(opt.out || 'results/badpos.json', JSON.stringify(rows, null, 1));
