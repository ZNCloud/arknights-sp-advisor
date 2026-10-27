// advisor-dev/analyze-demo.mjs — read a .spdemo (public-view replay) and reconstruct the match.
//
//   node advisor-dev/analyze-demo.mjs <demo.json> [--json]
//
// What a .spdemo holds: frames of {t, type, data} — m.public (the lobby/match public view, every player's
// lp / shopLevel / boardCount / bonds with layers), m.layer (one player's bond layers gained), b.start (a battle's
// full spec: every unit of every seat with chessId/golden/items), m.unitStats, m.ticker, m.result.
// It does NOT hold private views (shop, funds, hand) — those never leave the player's own page.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const asJson = process.argv.includes('--json');
const outIdx = process.argv.indexOf('--out');
const outPath = outIdx > 0 ? process.argv[outIdx + 1] : null;
const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(here, 'records', '_incoming-2026-10-27.spdemo.json');

const raw = fs.readFileSync(file);
const demo = JSON.parse(raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8'));
const frames = demo.frames;

// bond ids → Chinese names, from the engine data (engine checkout next to either this repo or the dev workspace)
const repo = [path.join(here, '..', 'Stronghold-Protocol'), path.join(here, '..', '..', 'Stronghold-Protocol')]
  .find((p) => fs.existsSync(path.join(p, 'data', 'bonds.json')));
if (!repo) throw new Error('engine checkout not found (expected ../Stronghold-Protocol or ../../Stronghold-Protocol)');
const bonds = JSON.parse(fs.readFileSync(path.join(repo, 'data', 'bonds.json'), 'utf8'));
const chess = JSON.parse(fs.readFileSync(path.join(repo, 'data', 'chess.json'), 'utf8'));
const bondName = (id) => (bonds[id] && (bonds[id].name || bonds[id].cn)) || id;
const chessName = (id) => (chess[id] && (chess[id].name || chess[id].cn)) || id;

const pubs = frames.filter((f) => f.type === 'm.public');
const layers = frames.filter((f) => f.type === 'm.layer');
const battles = frames.filter((f) => f.type === 'b.start');
const result = (frames.find((f) => f.type === 'm.result') || {}).data || demo.result;

// 第一次出现某个 phase/round 的公共视图，就是那一拍的起点
const roundOf = (t) => {
  let r = 0;
  for (const f of pubs) { if (f.t > t) break; r = f.data.round ?? r; }
  return r;
};
const phaseOf = (t) => {
  let p = null;
  for (const f of pubs) { if (f.t > t) break; p = f.data.phase ?? p; }
  return p;
};

const players = new Map(); // playerId → {seat, name, isBot}
for (const p of pubs[0].data.players) players.set(p.playerId, { seat: p.seat, name: p.name, isBot: p.isBot === true });
const label = (pid) => {
  const p = players.get(pid) || {};
  return `S${p.seat ?? '?'} ${p.name ?? pid}${p.isBot ? '(bot)' : ''}`;
};

// ── 每回合每位玩家的快照（最后一帧为准）──
const perRound = new Map(); // round → Map(pid → view)
for (const f of pubs) {
  const d = f.data;
  if (typeof d.round !== 'number') continue;
  const row = { phase: d.phase, round: d.round, players: d.players || [], teamLp: d.teamLp ?? null, bossHp: d.bossHp ?? null };
  perRound.set(d.round, row);
}

// ── 盟约层数：谁在涨、什么时候涨到阈值 ──
const layerByPlayerBond = new Map(); // `${pid}|${bondId}` → [{t, round, add}]
for (const f of layers) {
  const k = `${f.data.playerId}|${f.data.bondId}`;
  if (!layerByPlayerBond.has(k)) layerByPlayerBond.set(k, []);
  layerByPlayerBond.get(k).push({ t: f.t, round: roundOf(f.t), add: f.data.add });
}
const layerTotals = [...layerByPlayerBond.entries()].map(([k, list]) => {
  const [pid, bondId] = k.split('|');
  const byRound = {};
  let acc = 0;
  for (const e of list) { acc += e.add; byRound[e.round] = acc; }
  return { pid, bondId, total: acc, byRound, events: list.length };
}).sort((a, b) => b.total - a.total);

// ── 战斗阵容：每个席位每回合的强度（人数 / 精锐 / 装备）──
const boardByRound = new Map(); // `${round}|${pid}` → {units, golden, items, ids}
for (const f of battles) {
  const sp = f.data.spec || {};
  const round = sp.round;
  for (const seat of sp.players || []) {
    const units = (seat.units || []).filter((u) => u.kind === 'chess');
    const key = `${round}|${seat.playerId}`;
    const prev = boardByRound.get(key);
    const row = {
      units: units.length,
      golden: units.filter((u) => u.golden === true).length,
      items: units.reduce((n, u) => n + (u.items || []).length, 0),
      ids: units.map((u) => u.chessId),
    };
    if (!prev || row.units > prev.units) boardByRound.set(key, row);
  }
}

const out = {
  meta: {
    id: demo.id, mode: demo.mode, startedAt: new Date(demo.startedAt).toISOString(),
    durationMin: Math.round(demo.durationMs / 60000),
    result: {
      victory: result.victory, roundsPassed: result.roundsPassed, hiddenCleared: result.hiddenCleared,
      reason: result.reason, teamLp: result.teamLp, modeId: result.modeId, difficulty: result.difficulty,
      stageId: result.stageId, bossId: result.bossId, hiddenBossId: result.hiddenBossId, seed: result.seed,
    },
    me: demo.me,
    firstPublic: {
      factions: pubs[0].data.factions, disabledBonds: (pubs[0].data.disabledBonds || []).map(bondName),
      bannedCount: (pubs[0].data.bannedChess || []).length, variant: pubs[0].data.variant,
    },
  },
  players: (result.players || []).map((p) => ({
    seat: p.seat, name: p.name, isBot: p.isBot === true, lp: p.lp, alive: p.alive, roundsPassed: p.roundsPassed,
    band: p.bandId, kills: p.creditedKills,
    lineup: (p.lineup || []).map((u) => ({ id: u.id, name: chessName(u.id), golden: u.golden === true, row: u.row, col: u.col, items: u.items || [] })),
    bonds: (p.bonds || []).map((b) => ({ id: b.bondId, name: bondName(b.bondId), count: b.count, layers: b.layers, tier: b.tier })),
    stats: p.stats || null,
  })),
  layerTotals: layerTotals.map((x) => ({ ...x, who: label(x.pid), bond: bondName(x.bondId) })),
  rounds: [...perRound.entries()].sort((a, b) => a[0] - b[0]).map(([round, row]) => ({
    round, phase: row.phase, teamLp: row.teamLp,
    bossHp: row.bossHp ? Math.round(100 * row.bossHp.hp / row.bossHp.max) : null,
    seats: row.players.map((p) => ({
      seat: p.seat, name: p.name, isBot: p.isBot === true, lp: p.lp, level: p.shopLevel, board: p.boardCount,
      bonds: (p.bonds || []).filter((b) => (b.count || 0) >= 2 || (b.layers || 0) > 0)
        .map((b) => `${bondName(b.bondId)}:${b.count ?? 0}/${b.layers ?? 0}`).join(' '),
    })),
  })),
  battles: battles.map((f) => ({ round: f.data.spec?.round, kind: f.data.spec?.kind, seat: f.data.spec?.players?.map((p) => p.playerId) })),
  boards: [...boardByRound.entries()].map(([k, v]) => { const [round, pid] = k.split('|'); return { round: Number(round), who: label(pid), ...v }; })
    .sort((a, b) => a.round - b.round),
};

if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(`wrote ${outPath}`);
} else if (asJson) {
  console.log(JSON.stringify(out, null, 1));
} else {
  const m = out.meta;
  console.log(`# ${m.id}  ${m.startedAt}  ${m.durationMin} 分钟`);
  console.log(`模式 ${m.result.modeId} / ${m.result.difficulty} / 关卡 ${m.result.stageId}  变体 ${m.firstPublic.variant}`);
  console.log(`BOSS ${m.result.bossId} → 隐藏 ${m.result.hiddenBossId}  seed ${m.result.seed}`);
  console.log(`结果: victory=${m.result.victory} rounds=${m.result.roundsPassed} hidden=${m.result.hiddenCleared} teamLp=${m.result.teamLp}`);
  console.log(`禁用盟约: ${m.firstPublic.disabledBonds.join(', ')}   禁用棋子 ${m.firstPublic.bannedCount} 张`);
  console.log(`\n我: ${m.me.name} (${m.me.playerId})`);

  console.log('\n## 四家终局');
  for (const p of out.players) {
    console.log(`\nS${p.seat} ${p.name}${p.isBot ? '(bot)' : ''}  LP ${p.lp}  策略 ${p.band}  上阵 ${p.lineup.length}  精锐 ${p.lineup.filter((u) => u.golden).length}  击杀 ${p.kills}`);
    if (p.bonds.length) console.log('  盟约: ' + p.bonds.map((b) => `${b.name} ${b.count}人/${b.layers}层${b.tier ? ` tier${b.tier}` : ''}`).join('  '));
    if (p.stats) console.log('  统计: ' + Object.entries(p.stats).map(([k, v]) => `${k}=${v}`).join(' '));
  }

  console.log('\n## 谁在叠层（m.layer 累计）');
  for (const l of out.layerTotals.slice(0, 12)) {
    const rt = Object.entries(l.byRound).map(([r, v]) => `R${r}:${v}`).join(' ');
    console.log(`  ${l.who}  ${l.bond}  +${l.total}  [${rt}]`);
  }

  console.log('\n## 每回合（我的席位 + 队友）');
  const meSeat = out.players.find((p) => p.name === m.me.name)?.seat;
  for (const r of out.rounds) {
    const bits = r.seats.map((s) => `S${s.seat}${s.seat === meSeat ? '*' : ''} LP${s.lp} L${s.level} ${s.board}人 ${s.bonds}`).join(' | ');
    console.log(`  R${String(r.round).padStart(2)} ${String(r.phase || '').padEnd(11)} teamLp ${r.teamLp ?? '-'} boss ${r.bossHp ?? '-'}%  ${bits}`);
  }

  console.log('\n## 战斗阵容强度（b.start 里出现过的最高）');
  for (const b of out.boards) console.log(`  R${b.round} ${b.who}  ${b.units}人 精锐${b.golden} 装备${b.items}`);
}
