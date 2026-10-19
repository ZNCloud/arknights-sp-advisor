// 真人局重放 → 顾问逐回合建议 (task sphind_2254 step 4). For every recorded prep of the human matches (the forced start
// positions of human/replay.mjs) the advisor (advisor/advise.mjs: value-model pre-filter + rollouts) is asked what to do;
// next to it: what the overlay's live advice said at that moment (record `advice` / `pick`, verbatim) and what the
// owner actually did that prep (human/ownerturn.mjs deriveTurn). Whether the owner's turn CONTAINS the advisor's action
// is reported as a fact about the two lists, never as "followed the advice".
// node sp-advisor/eval/human-advice.mjs --positions positions --out results/advice.json [--games game1,game2] [--rounds 1-15]
//      [--K 4 --N 6 --N2 6 --workers 48 --model sp-advisor/models --guide guides/g06_final.json]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fromJSON } from '../advisor/state.mjs';
import { advise, modelScorer } from '../advisor/advise.mjs';
import { RolloutPool } from '../advisor/pool.mjs';
import { loadGame } from '../human/replay.mjs';
import { deriveTurn } from '../human/ownerturn.mjs';
import { makeMatch } from './engine.mjs';

const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i += 2) opt[args[i].slice(2)] = args[i + 1];
const range = s => s.split(',').flatMap(x => { const [a, b] = x.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
const games = (opt.games || 'game1,game2').split(','), rounds = range(opt.rounds || '1-15');
const spec = JSON.parse(readFileSync(opt.guide || 'guides/g06_final.json', 'utf8'));
const cfg = { K: +(opt.K || 4), N: +(opt.N || 6), N2: +(opt.N2 || 6) };
const pool = new RolloutPool(+(opt.workers || 48));
const scorer = opt.model === 'none' ? null : modelScorer({ pool, spec, modelDir: opt.model || 'sp-advisor/models' });
const gdm = makeMatch(1, 4), gd = gdm.gd;
const nm = id => gd.chess(id)?.name || gd.item(id)?.name || id;

function ownerTurnText(gdLike, R) {
  const t = deriveTurn(gdLike, R.start, R.end);
  const parts = [];
  if (t.levelUps) parts.push(`升级×${t.levelUps}`);
  for (const b of t.buys) parts.push(`买 ${nm(b.id)}`);
  for (const b of t.itemBuys) parts.push(`买装备 ${nm(b.id)}`);
  for (const s of t.sells) parts.push(`卖 ${nm(s.base)}×${s.copies}`);
  for (const x of [...t.eliteAppeared, ...t.extra]) parts.push(`得到 ${nm(x.id)}（非开局商店）`);
  return { text: parts.join('；') || '无买卖', turn: t };
}
// does the owner's net turn contain the advisor's single action? (same kind and same card / item)
function contains(turn, a) {
  if (!a) return null;
  switch (a.type) {
    case 'level': return turn.levelUps > 0;
    case 'buy': return [...turn.buys, ...turn.itemBuys].some(b => b.id === a.id);
    case 'sell': return turn.sells.some(s => s.base && a.id && s.base.replace(/_b$/, '_a') === a.id.replace(/_b$/, '_a'));
    case 'macro': return a.name === 'level' ? turn.levelUps > 0 : null;
    case 'guide': case 'end': return null;
    default: return null;
  }
}

const out = { cfg, model: opt.model || 'sp-advisor/models', rows: [] };
const t0 = Date.now();
for (const g of games) {
  const G = loadGame(g);
  for (const r of rounds) {
    const f = `${opt.positions || 'positions'}/${g}-r${String(r).padStart(2, '0')}-start.json`;
    const R = G.rounds.find(x => x.round === r);
    if (!existsSync(f) || !R?.end) continue;
    const state = fromJSON(readFileSync(f, 'utf8'));
    let res, err = null;
    try { res = await advise(state, { playerId: 'p0', spec, pool, ...cfg, seed: 1000 * r + (g === 'game1' ? 1 : 2), scorer }); }
    catch (e) { err = String(e.stack || e).slice(0, 400); }
    const own = ownerTurnText(gd, R);
    const live = R.preps.map(p => ({ line: p.line, advice: p.advice, pick: p.pick }));
    const rec = res?.recommendation;
    out.rows.push({ game: g, round: r, error: err, advisor: rec ? { label: rec.label, action: rec.action, utility: rec.utility, winRate: rec.winRate, vsGuide: rec.vsGuide } : null,
      top: res ? res.candidates.slice(0, 5).map(c => ({ label: c.label, action: c.action, utility: c.utility, winRate: c.winRate, vsGuide: c.vsGuide })) : null,
      modelStatus: res?.modelStatus || null, rollouts: res?.rollouts || 0, ms: res ? Math.round(res.ms) : 0,
      owner: own.text, ownerTurnContainsAdvisorAction: contains(own.turn, rec?.action), liveOverlay: live });
    console.log(`${g} R${r}: 顾问 ${rec?.label ?? err} | owner ${own.text} | ${Math.round((Date.now() - t0) / 1000)} s`);
    writeFileSync(opt.out || 'results/advice.json', JSON.stringify(out, null, 1));
  }
}
await pool.close(); gdm.dispose();
console.log(`done ${out.rows.length} positions in ${Math.round((Date.now() - t0) / 1000)} s`);
