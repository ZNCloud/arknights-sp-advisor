// advisor-dev/lab/inspect.mjs — 单局检查器：逐回合打印盘面强度，用来对照 balance.mjs 的「合格曲线」。
//
//   node advisor-dev/lab/inspect.mjs --difficulty ABYSS --seed 1 --lp 45
//
// 输出每回合：等级 / 上阵数 / 精锐数 / 装备数 / 总层数 / 最强三个盟约 / LP / 本回合伤害，
// 以及 BOSS 回合的血池剩余 —— 这样能直接看出 bot 在哪一项落后于合格曲线
// （合格曲线：R12 层 285 / 精锐 5 / 装备 7；R13 层 358 / 精锐 6 / 装备 8）。

import path from 'node:path';
import { pathToFileURL } from 'node:url';
const u = (p) => pathToFileURL(p).href;
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..', 'Stronghold-Protocol');

const { Match } = await import(u(path.join(repo, 'server', 'match', 'Match.js')));
const { VirtualScheduler } = await import(u(path.join(repo, 'server', 'match', 'scheduler.js')));
const { getData } = await import(u(path.join(repo, 'server', 'data.js')));

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const mode = flag('--mode', 'mode_solo_abyss') || flag('--mode', 'solo');
const difficulty = flag('--difficulty', 'ABYSS');
const seed = Number(flag('--seed', '1'));
const lp = Number(flag('--lp', '45'));
const rehearsal = Number(flag('--rehearsal', '1'));

const data = await getData();
const sched = new VirtualScheduler();
const errors = [];
const log = { info() {}, debug() {}, warn() {}, error: (...a) => errors.push(a.map(String).join(' ')) };
const players = /multi|coop/i.test(mode) ? 2 : 1;
const seats = [];
for (let i = 0; i < players; i += 1) seats.push({ seat: i, playerId: `ai_${i}`, name: `AI-${i + 1}`, isBot: true, connected: true });
const m = new Match({
  roomCode: 'INSPECT', mode: 'solo', difficulty, seats, seed, data, log, scheduler: sched,
  battleContent: 'full', botRehearsal: rehearsal,
  send: () => true, broadcast: () => {}, onEnd: () => {},
});

const eliteCount = (ps) => [...ps.board.values()].filter((p) => p && p.kind === 'chess' && /_b$/.test(String(p.id))).length;
const itemCount = (ps) => {
  let n = 0;
  for (const p of ps.board.values()) if (p && Array.isArray(p.items)) n += p.items.length;
  for (const p of ps.hand) if (p && Array.isArray(p.items)) n += p.items.length;
  return n;
};
const layerTotal = (ps) => Object.values(ps.layers || {}).reduce((a, b) => a + (Number(b) || 0), 0);
const topBonds = (ps) => Object.entries(ps.layers || {})
  .filter(([, v]) => (Number(v) || 0) > 0)
  .sort((a, b) => b[1] - a[1]).slice(0, 3)
  .map(([id, v]) => `${data.bonds[id]?.name ?? id}${Math.round(v)}`).join(' ');

console.log(`== ${difficulty} · seed ${seed} · 起始LP ${lp} · rehearsal ${rehearsal} ==`);
console.log('R  等级 上阵 精锐 装备 总层数  最强盟约                       LP   dmg   boss');
let last = '';
const rows = [];
m.start();
sched.runUntil(() => {
  const key = `${m.phase}:${m.round}`;
  if (key !== last) {
    last = key;
    if (m.phase === 'PREP' && m.round === 1) for (const ps of m.players.values()) ps.lp = lp;
    if (m.phase === 'SETTLE') {
      for (const ps of m.order) {
        const r = m.lastResults.get(ps.playerId);
        const row = {
          round: m.round, level: ps.shop.level, units: ps.deployCount, elites: eliteCount(ps), items: itemCount(ps),
          layers: layerTotal(ps), top: topBonds(ps), lp: ps.lp, dmg: r ? r.killed : null,
          boss: m.bossPool ? `${Math.round(m.bossPool.hp)}/${Math.round(m.bossPool.maxHp)}` : '',
        };
        rows.push(row);
        console.log(`${String(row.round).padStart(2)}  L${row.level}   ${String(row.units).padStart(2)}   ${String(row.elites).padStart(2)}   ${String(row.items).padStart(2)}   ${String(Math.round(row.layers)).padStart(4)}    ${row.top.padEnd(28)} ${String(row.lp).padStart(3)}  ${String(row.dmg ?? '-').padStart(4)}  ${row.boss}`);
        if (process.env.SP_INSPECT_IDS === '1') {
          const ids = [...ps.board.values()].filter((p) => p && p.kind === 'chess').map((p) => `${p.id}${ps.gd?.isGolden?.(p.id) ?? m.gd.isGolden(p.id) ? '*' : ''}`);
          console.log(`     盘面: ${ids.join(' ')}`);
          console.log(`     手牌: ${[...ps.hand].filter(Boolean).map((p) => p.id).join(' ')}`);
        }
      }
    }
  }
  return m.phase === 'RESULT' || m.phase === undefined;
}, { maxSteps: 3e6 });

const sum = m.lastSummary || {};
console.log(`\n结果：${sum.victory ? '胜利' : '失败'} · 通过 ${sum.roundsPassed} 回合 · BOSS ${data.bosses?.[m.bossId]?.name ?? m.bossId}`);
if (errors.length) console.log('errors:', errors.slice(0, 3));
