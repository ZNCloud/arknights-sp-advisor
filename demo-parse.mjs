// advisor-dev/demo-parse.mjs — 解析《卫戍协议》客户端的 .spdemo 对局录像，压成可复盘的 JSON
//
// .spdemo 是什么：gzip 压缩的 JSON（v:2），顶层 {v,id,statsId,startedAt,endedAt,durationMs,mode,me,result,frames[]}，
// frames 是整局的服务器事件流，类型包括：
//   m.public    每次状态广播（阶段/回合/所有玩家 band+lp+商店等级+盟约）
//   m.layer     某个玩家某条盟约层数 +N（逐条！这是复盘"谁在叠什么"的关键）
//   m.ticker    广播（精锐化 / 升本 / BOSS 伤害 / 模式事件）
//   m.unitStats 每回合各单位的统计
//   b.start / b.end / b.pool  每场战斗的开始、结束、BOSS 血池与团队 LP 变化
//   m.result    结算（含所有玩家的终局阵容、golden、装备）
//
// 用法：
//   node demo-parse.mjs                      # 解析 Downloads 下全部 *.spdemo → demos/
//   node demo-parse.mjs --dir <文件夹>
//   node demo-parse.mjs --file <某个.spdemo>
//   node demo-parse.mjs --upload             # 解析后逐个上传到 GitHub 仓库（Contents API）
//
// 产出：demos/<id>.json（单局压缩复盘）+ demos/index.json（总表）

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, dflt = null) => { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1] ?? true) : dflt; };
const has = (name) => args.includes('--' + name);

const SRC = flag('dir', 'C:\\Users\\Administrator\\Downloads');
const ONE = flag('file', null);
const OUT = path.join(here, 'demos');
const SECRET = path.join(here, '.sync-secret.json');

/** 读一个 .spdemo → { json, sizeRaw, sizeJson } */
async function readDemo(file) {
  const buf = await fs.readFile(file);
  const json = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
  return { json, bytesPacked: buf.length, bytesJson: JSON.stringify(json).length };
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** 把一份录像压成复盘结构 */
export function compressDemo(json, fileName) {
  const frames = json.frames || [];
  const byType = (t) => frames.filter((f) => f && f.type === t);
  const result = json.result || (byType('m.result')[0] || {}).data || {};

  // 玩家终局信息（m.result.players）
  const finalPlayers = (result.players || []).map((p) => ({
    seat: p.seat, playerId: p.playerId || null, name: p.name, lp: p.lp, band: p.bandId,
    lineup: (p.lineup || []).map((u) => ({ id: u.id, g: u.golden === true, items: u.items || [] })),
    stats: p.stats || null,
  }));

  // 逐条层数增长（m.layer）：按 玩家×盟约 累计，并按回合切分
  const layerEvents = byType('m.layer').map((f) => f.data).filter(Boolean);
  const layersByPlayer = {};
  for (const ev of layerEvents) {
    const key = ev.playerId || '?';
    const rec = (layersByPlayer[key] = layersByPlayer[key] || {});
    rec[ev.bondId] = (rec[ev.bondId] || 0) + (Number(ev.add) || 0);
  }

  // 按 m.public 的回合/阶段取快照：每个回合保留 PREP（买牌期）与最后一次广播
  const pubs = byType('m.public').map((f) => f.data).filter(Boolean);
  const snaps = new Map(); // round -> {prep, last}
  for (const p of pubs) {
    if (!Number.isFinite(p.round)) continue;
    const slot = snaps.get(p.round) || {};
    if (p.phase === 'PREP') slot.prep = p; else slot.last = p;
    snaps.set(p.round, slot);
  }
  const sumBonds = (players, seat) => {
    const p = (players || []).find((x) => x.seat === seat);
    return p && Array.isArray(p.bonds) ? p.bonds.filter((b) => (b.count || 0) > 0 || (b.layers || 0) > 0)
      .map((b) => `${b.bondId}:${b.count || 0}/${b.layers || 0}`) : [];
  };
  const meSeat = (() => {
    const me = json.me || {};
    for (const p of (result.players || [])) if (p.name === me.name) return p.seat;
    return null;
  })();

  const rounds = [...snaps.entries()].sort((a, b) => a[0] - b[0]).map(([r, v]) => {
    const snap = v.prep || v.last || {};
    return {
      round: r,
      phasePrep: !!v.prep,
      players: (snap.players || []).map((p) => ({
        seat: p.seat, name: p.name, band: p.bandId, lp: p.lp, lv: p.shopLevel,
        bonds: (p.bonds || []).filter((b) => (b.count || 0) > 0 || (b.layers || 0) > 0)
          .map((b) => `${b.bondId}:${b.count || 0}/${b.layers || 0}`),
      })),
      me: meSeat == null ? null : { lp: (snap.players || []).find((p) => p.seat === meSeat)?.lp ?? null,
        bonds: sumBonds(snap.players, meSeat) },
    };
  });

  // BOSS 血池 / 团队 LP 曲线（b.pool）
  const poolCurve = byType('b.pool').map((f) => f.data).filter(Boolean)
    .map((d) => ({ hp: d.hp, max: d.max, teamLp: d.teamLp }))
    .filter((d) => Number.isFinite(d.hp) && Number.isFinite(d.max) && d.max > 0);
  const bossPct = poolCurve.length
    ? Math.max(0, Math.min(100, (1 - Math.min(...poolCurve.map((d) => d.hp / d.max))) * 100))
    : null;

  // 广播事件（含：精锐化 / 升本 / BOSS 伤害 / 联防）
  const events = byType('m.ticker').map((f) => f.data).filter(Boolean)
    .map((e) => ({ round: e.round ?? null, type: e.type, text: e.text, playerId: e.playerId || null }));

  // 战斗次数与单位统计（用于看"谁在打"）
  const battles = byType('b.start').map((f) => f.data).filter(Boolean)
    .map((b) => ({ battleId: b.battleId, kind: b.kind, fieldId: b.fieldId, round: b.round ?? null }));

  return {
    id: json.id || fileName,
    file: fileName,
    version: json.v ?? null,
    startedAt: iso(json.startedAt), endedAt: iso(json.endedAt), durationMin: json.durationMs ? +(json.durationMs / 60000).toFixed(1) : null,
    mode: json.mode, variant: (pubs[0] || {}).variant ?? null,
    modeId: result.modeId, difficulty: result.difficulty, stageId: result.stageId,
    bossId: result.bossId || (pubs[0] || {}).bossId || null, hiddenBossId: result.hiddenBossId || (pubs[0] || {}).hiddenBossId || null,
    victory: result.victory === true, reason: result.reason || null,
    roundsPassed: result.roundsPassed ?? null, teamLp: result.teamLp ?? null,
    hiddenReached: result.hiddenReached === true, hiddenCleared: result.hiddenCleared === true,
    me: { name: (json.me || {}).name || null, seat: meSeat, playerId: (json.me || {}).playerId || null },
    players: finalPlayers,
    layerTotals: layersByPlayer,
    layerTotalsBySeat: (() => {
      const out = {};
      for (const pl of finalPlayers) if (pl.playerId && layersByPlayer[pl.playerId]) out[pl.seat] = layersByPlayer[pl.playerId];
      return out;
    })(),
    bossDamagePct: bossPct === null ? null : +bossPct.toFixed(1),
    rounds,
    events,
    counts: { frames: frames.length, public: pubs.length, layerAdds: layerEvents.length, tickers: events.length, battles: battles.length },
  };
}

async function listDemos() {
  if (ONE) return [path.resolve(ONE)];
  const names = await fs.readdir(SRC);
  return names.filter((n) => n.toLowerCase().endsWith('.spdemo')).map((n) => path.join(SRC, n));
}

async function loadConfig() {
  const cfg = JSON.parse(await fs.readFile(SECRET, 'utf8'));
  return { repo: 'ZNCloud/arknights-sp-advisor', branch: 'master', ...cfg };
}

async function putFile(cfg, remotePath, content, message) {
  const url = `https://api.github.com/repos/${cfg.repo}/contents/${remotePath}`;
  const headers = { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'sp-advisor-demos' };
  let sha = null;
  try { const r = await fetch(`${url}?ref=${cfg.branch}`, { headers }); if (r.ok) sha = (await r.json()).sha; } catch { }
  const body = { message, content: Buffer.from(content).toString('base64'), branch: cfg.branch };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`);
  return (await res.json()).commit.sha.slice(0, 7);
}

async function main() {
  const files = await listDemos();
  if (!files.length) { console.log('没有找到 .spdemo'); return; }
  await fs.mkdir(OUT, { recursive: true });
  console.log(`发现 ${files.length} 个录像，开始解析…`);

  const index = [];
  for (const f of files) {
    try {
      const { json, bytesPacked } = await readDemo(f);
      const c = compressDemo(json, path.basename(f));
      const outPath = path.join(OUT, `${c.id}.json`);
      await fs.writeFile(outPath, JSON.stringify(c));
      const kb = (JSON.stringify(c).length / 1024).toFixed(0);
      index.push({
        id: c.id, file: c.file, at: c.startedAt, modeId: c.modeId, difficulty: c.difficulty,
        bossId: c.bossId, victory: c.victory, rounds: c.roundsPassed, teamLp: c.teamLp,
        hiddenCleared: c.hiddenCleared, bossDamagePct: c.bossDamagePct, durationMin: c.durationMin,
        me: c.me, players: c.players.map((p) => ({ seat: p.seat, name: p.name, band: p.band })),
        kb: +kb, packedKB: +(bytesPacked / 1024).toFixed(0),
      });
      console.log(`  ✓ ${c.id}  ${c.victory ? '胜' : '负'}  R${c.roundsPassed}  boss=${c.bossId}  BOSS ${c.bossDamagePct ?? '?'}%  → ${outPath} (${kb} KB)`);
    } catch (e) {
      console.log(`  ✗ ${path.basename(f)}: ${e.message}`);
    }
  }
  index.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  await fs.writeFile(path.join(OUT, 'index.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), count: index.length,
    wins: index.filter((x) => x.victory).length,
    demos: index,
  }, null, 1));
  console.log(`\n汇总: ${index.length} 局，胜 ${index.filter((x) => x.victory).length} → ${path.join(OUT, 'index.json')}`);

  if (has('upload')) {
    const cfg = await loadConfig();
    console.log('\n上传到 GitHub…');
    for (const item of index) {
      const local = path.join(OUT, `${item.id}.json`);
      const remote = `demos/${item.id}.json`;
      try {
        const sha = await putFile(cfg, remote, await fs.readFile(local), `demo: ${item.id} ${item.victory ? 'win' : 'loss'} R${item.rounds} boss=${item.bossId}`);
        console.log(`  ↑ ${remote} (${sha})`);
      } catch (e) { console.log(`  ✗ 上传 ${remote}: ${e.message}`); }
    }
    try {
      const sha = await putFile(cfg, 'demos/index.json', await fs.readFile(path.join(OUT, 'index.json')), `demo index: ${index.length} matches`);
      console.log(`  ↑ demos/index.json (${sha})`);
    } catch (e) { console.log(`  ✗ 上传 index: ${e.message}`); }
  }
}

await main();
