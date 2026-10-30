// lab/match-digest.mjs — per-match digest of .spdemo files: every seat ranked, the top two dissected.
//
//   node lab/match-digest.mjs matches/*.spdemo             # markdown to stdout
//   node lab/match-digest.mjs --json matches/*.spdemo      # machine-readable
//
// Ranking is by `stats.bossDamage` (the co-op contribution the result page itself reports), tie-broken by dmgDealt;
// `--by dmg` ranks by dmgDealt instead. Operator names come from the advisor page's compact data (core-loader), bond
// and band names from the engine's data/*.json, so nothing is hand-copied.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAdvisor } from '../core-loader.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = [path.join(here, '..', '..', 'Stronghold-Protocol')].find((p) => fs.existsSync(path.join(p, 'data', 'bonds.json')));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const BONDS = readJson(path.join(engine, 'data', 'bonds.json'));
const BANDS = readJson(path.join(engine, 'data', 'bands.json'));

const { DATA } = await loadAdvisor();
const CH = DATA.chess || {};
const nameOf = (id) => (CH[id] ? CH[id][1] : String(id).replace(/^chess_/, ''));
const bondName = (id) => (BONDS[id] ? BONDS[id].name : id);
const bandOf = (id) => (BANDS[id] ? `${BANDS[id].name}·${BANDS[id].effectName || ''}`.replace(/·$/, '') : id);

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const byIdx = argv.indexOf('--by');
const by = byIdx >= 0 ? argv[byIdx + 1] : 'boss';
const files = argv.filter((a, i) => !a.startsWith('--') && !(byIdx >= 0 && i === byIdx + 1));

const loadDemo = (f) => {
  const b = fs.readFileSync(f);
  return JSON.parse(b[0] === 0x1f && b[1] === 0x8b ? zlib.gunzipSync(b).toString('utf8') : b.toString('utf8'));
};

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 0);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

function digest(file) {
  const d = loadDemo(file);
  const r = d.result || {};
  const pubs = d.frames.filter((f) => f.type === 'm.public');
  const byRound = new Map();
  for (const f of pubs) if (typeof f.data.round === 'number') byRound.set(f.data.round, f.data);
  const rounds = [...byRound.entries()].sort((a, b) => a[0] - b[0]);
  const info = pubs[0] ? pubs[0].data : {};

  const totalBoss = sum((r.players || []).map((p) => (p.stats || {}).bossDamage || 0));
  const seats = (r.players || []).map((p) => {
    const st = p.stats || {};
    const bonds = (p.bonds || []).slice().sort((a, b) => (b.layers || 0) - (a.layers || 0));
    const lineup = (p.lineup || []).map((u) => ({ id: u.id, name: nameOf(u.id), golden: u.golden === true, items: (u.items || []).length }));
    return {
      seat: p.seat, name: p.name, isBot: p.isBot === true, band: p.bandId, bandName: bandOf(p.bandId),
      lp: p.lp, alive: p.alive, roundsPassed: p.roundsPassed,
      lineup: lineup.length, golden: lineup.filter((u) => u.golden).length,
      items: st.itemsEquipped ?? 0, merges: st.merges ?? 0, refreshes: st.refreshes ?? 0, gold: st.gold ?? 0,
      leaks: st.leaks ?? 0, perfect: st.perfectRounds ?? 0, kills: st.kills ?? 0,
      boss: st.bossDamage ?? 0, dmg: st.dmgDealt ?? 0, layers: st.activatedLayers ?? 0,
      bonds: bonds.map((b) => ({ id: b.bondId, name: bondName(b.bondId), count: b.count, layers: b.layers })),
      topBond: bonds[0] ? `${bondName(bonds[0].bondId)} ${bonds[0].count}人/${bonds[0].layers}层` : null,
      lineupNames: lineup,
      bossShare: pct(st.bossDamage || 0, totalBoss),
    };
  });

  const key = by === 'dmg' ? 'dmg' : 'boss';
  const ranked = seats.slice().sort((a, b) => b[key] - a[key] || b.dmg - a.dmg);

  // per-round curve of a seat's main bond (layers + count) and its shop level
  const curveOf = (seat) => {
    const main = (seats.find((s) => s.seat === seat) || {}).bonds?.[0];
    if (!main) return null;
    const rows = [];
    let prev = 0;
    for (const [round, data] of rounds) {
      const p = (data.players || []).find((x) => x.seat === seat);
      if (!p) continue;
      const b = (p.bonds || []).find((x) => x.bondId === main.id);
      const layers = (b && b.layers) || 0;
      const count = (b && b.count) || 0;
      rows.push({ round, phase: data.phase, layers, count, delta: layers - prev, level: p.shopLevel, lp: p.lp, board: p.boardCount });
      prev = layers;
    }
    return { bond: main.name, id: main.id, thresholds: (BONDS[main.id] || {}).thresholds || [], rows };
  };

  return {
    file: file.split(/[\\/]/).pop(),
    id: d.id, startedAt: new Date(d.startedAt).toISOString(), minutes: Math.round(d.durationMs / 60000),
    mode: r.modeId, difficulty: r.difficulty, stage: r.stageId, boss: r.bossId, hiddenBoss: r.hiddenBossId,
    victory: r.victory, roundsPassed: r.roundsPassed, hidden: r.hiddenCleared, teamLp: r.teamLp, seed: r.seed,
    banned: { disabledBonds: (info.disabledBonds || []).map(bondName), bannedChess: (info.bannedChess || []).length, factions: info.factions || [] },
    totalBoss, ranked, top2: ranked.slice(0, 2).map((s) => ({ ...s, curve: curveOf(s.seat) })),
    rounds: rounds.map(([round, data]) => ({
      round, phase: data.phase,
      seats: (data.players || []).map((p) => ({ seat: p.seat, lp: p.lp, level: p.shopLevel, board: p.boardCount,
        main: (p.bonds || []).filter((b) => (b.layers || 0) > 0 || (b.count || 0) > 0)
          .sort((a, b) => (b.layers || 0) - (a.layers || 0)).slice(0, 2)
          .map((b) => `${bondName(b.bondId)} ${b.count || 0}/${b.layers || 0}`).join(' · ') })),
    })),
  };
}

const out = files.map(digest);

if (asJson) {
  console.log(JSON.stringify(out, null, 1));
} else {
  for (const m of out) {
    console.log(`\n## ${m.startedAt.slice(0, 10)} ${m.difficulty} ${m.stage}`);
    console.log(`${m.minutes} 分钟 · ${m.mode} · boss ${m.boss}→${m.hiddenBoss} · seed ${m.seed} · victory=${m.victory} rounds=${m.roundsPassed} hidden=${m.hidden} teamLp=${m.teamLp}`);
    console.log(`禁用盟约候选: ${m.banned.disabledBonds.join('/') || '-'} · 禁用棋子 ${m.banned.bannedChess} 张`);
    console.log('');
    console.log('| 排名 | seat | 策略 | LP | 上阵·精锐 | 装备 | 合成 | 刷新 | 金币 | 漏怪 | 完美 | 核心盟约 | boss伤害 | 占比 | 总层数 |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    m.ranked.forEach((s, i) => {
      console.log(`| ${i + 1} | ${s.seat} | ${s.bandName} | ${s.lp} | ${s.lineup}·${s.golden} | ${s.items} | ${s.merges} | ${s.refreshes} | ${s.gold} | ${s.leaks} | ${s.perfect} | ${s.topBond || '-'} | ${(s.boss / 1e6).toFixed(2)}M | ${s.bossShare}% | ${s.layers} |`);
    });
    for (const t of m.top2) {
      console.log(`\n### 第 ${m.ranked.findIndex((s) => s.seat === t.seat) + 1} 名 · 座位${t.seat} — ${t.bandName}`);
      console.log(`主盟约 ${t.curve ? t.curve.bond : '-'}（阈值 ${(t.curve?.thresholds || []).join('/')}）· 精锐 ${t.golden}/${t.lineup} · 装备 ${t.items} · 漏怪 ${t.leaks} · 完美 ${t.perfect}`);
      console.log(`其余盟约: ${t.bonds.slice(1, 6).map((b) => `${b.name} ${b.count}/${b.layers}`).join(' · ') || '-'}`);
      console.log(`阵容: ${t.lineupNames.map((u) => (u.golden ? '★' : '') + u.name).join('、')}`);
      if (t.curve) {
        const rows = t.curve.rows.filter((x) => x.layers > 0 || x.round >= 6);
        console.log(`层数曲线: ${rows.map((x) => `R${x.round}:${x.count}/${x.layers}${x.delta > 0 ? `(+${x.delta})` : ''}`).join(' ')}`);
        console.log(`等级曲线: ${t.curve.rows.map((x) => `R${x.round}:L${x.level}`).join(' ')}`);
      }
    }
  }
}
