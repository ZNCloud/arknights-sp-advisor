// advisor-dev/lab/bossprobe.mjs — 单 BOSS 定向测强：固定 bossId × profile × 队伍 LP，测「这种盘面能不能杀它」。
//
// tools/balance.mjs 的 runBoss 会按种子随机抽 BOSS（boss_1..7 按 weight），量 boss_7 / boss_5 这种要跑几十个样本
// 才凑得齐。这个脚本把 bossId 直接钉住，于是「盘面强度 → 胜率」是一条干净的、可复现的曲线：
//
//   node advisor-dev/lab/bossprobe.mjs --boss boss_7 --profile 2.0 --samples 8 --lp 15
//   node advisor-dev/lab/bossprobe.mjs --boss all --profile 1.0,1.4,2.0,3.0 --samples 6 --json
//
// 口径与 balance.mjs 完全一致（同一个 runBoss、同一个合格曲线、同一个 profile 定义）：
//   ratio150 = 150 真实秒（= 300 游戏秒）内打掉的血池比例；victory = 血池清空且 teamLp > 0；
//   击杀窗口 W_real = 150 + LP0 − Σ(lpr × 漏怪)（150 秒后每秒掉 1 LP，config.bossOvertimeDrainPerSec）。
//   本工具的 dpsNeeded = pool / W_real（**未**含阶段乘子把血池放大的部分）；含有效血池（boss_7 ×1.75、boss_1 ×1.20）
//   的需求值见 model/bosstable.json 的 rows[].dpsNeeded。

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..', 'Stronghold-Protocol');
const u = (p) => pathToFileURL(p).href;

const { runBoss } = await import(u(path.join(repo, 'tools', 'balance.mjs')));
const { getData } = await import(u(path.join(repo, 'server', 'data.js')));

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

const difficulty = String(flag('--difficulty', 'ABYSS')).toUpperCase();
const mode = String(flag('--mode', 'solo')) === 'multi' ? 'multi' : 'solo';
const round = Number(flag('--round', '14'));
const samples = Math.max(1, Number(flag('--samples', '8')));
const lp = Number(flag('--lp', '15'));
const seed0 = Number(flag('--seed', '1'));
const bosses = list(flag('--boss', 'all')).flatMap((b) => (b === 'all' ? ['boss_1', 'boss_2', 'boss_3', 'boss_4', 'boss_5', 'boss_6', 'boss_7'] : [b]));
const profiles = list(flag('--profile', '1.0')).map(Number).filter((x) => x > 0);
const asJson = args.includes('--json');

const data = getData({ log: { info() {}, debug() {}, warn() {}, error() {} } });
const BOSSES = data.bosses || {};
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

const rows = [];
for (const profile of profiles) {
  for (const bossId of bosses) {
    const rec = BOSSES[bossId] || {};
    const enemy = rec.enemyKey && data.enemies ? data.enemies[rec.enemyKey] : null;
    const st = (enemy && enemy.stats) || {};
    const pool = (rec.bloodPoint || {})[difficulty] ?? null;
    const runs = [];
    for (let i = 0; i < samples; i++) {
      runs.push(runBoss({ data, mode, difficulty, round, seed: 1000 + seed0 + i * 7, profile, bossLp: lp, bossId }));
    }
    const kills = runs.filter((r) => r.killTime != null);
    const ratio = avg(runs.map((r) => r.ratio150));
    const victory = runs.filter((r) => r.victory).length / runs.length;
    // 击杀窗口（真实秒）：150 + LP0 − 漏怪扣掉的 LP；击杀时间 game s → real s 要 /2（combatTimeScale 2）
    const wReal = 150 + lp - avg(runs.map((r) => r.leakLp));
    rows.push({
      bossId, name: rec.name || bossId, profile, lp, samples, difficulty, mode, round,
      pool, lpr: rec.lpr ?? st.lpr ?? null, def: st.def ?? null, res: st.res ?? null, atk: st.atk ?? null,
      ratio150: +ratio.toFixed(3), ratio150Min: +Math.min(...runs.map((r) => r.ratio150)).toFixed(3),
      victory: +victory.toFixed(3), kills: kills.length,
      killTimeGameS: kills.length ? Math.round(avg(kills.map((r) => r.killTime))) : null,
      killTimeRealS: kills.length ? Math.round(avg(kills.map((r) => r.killTime)) / 2) : null,
      windowRealS: Math.round(wReal), leakLp: +avg(runs.map((r) => r.leakLp)).toFixed(2),
      teamLpZero: runs.filter((r) => r.teamLpEnd <= 0).length,
      dpsReal: kills.length ? Math.round(pool / (avg(kills.map((r) => r.killTime)) / 2)) : null,
      dpsNeeded: pool && wReal > 0 ? Math.round(pool / wReal) : null,
    });
  }
}

if (asJson) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '-');
  const k = (x) => (Number.isFinite(x) ? (x >= 1e6 ? `${(x / 1e6).toFixed(2)}M` : `${Math.round(x / 1000)}k`) : '-');
  console.log(`\n== ${mode} ${difficulty} R${round} · LP ${lp} · ${samples} samples/boss ==`);
  console.log('  boss     profile  pool   DEF  RES  lpr | ratio150  min   victory | kill(real s) window  DPS(real) need');
  for (const r of rows) {
    console.log(`  ${r.bossId.padEnd(8)} ${String(r.profile).padEnd(7)} ${k(r.pool).padStart(6)} ${String(r.def).padStart(4)} ${String(r.res).padStart(4)} ${String(r.lpr).padStart(4)} | ${f2(r.ratio150).padStart(8)} ${f2(r.ratio150Min).padStart(5)} ${(r.victory * 100).toFixed(0).padStart(6)}% | ${String(r.killTimeRealS ?? '-').padStart(6)} ${String(r.windowRealS).padStart(4)}s ${k(r.dpsReal).padStart(9)} ${k(r.dpsNeeded)}`);
  }
}
