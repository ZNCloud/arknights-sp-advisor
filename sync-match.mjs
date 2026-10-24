// advisor-dev/sync-match.mjs — 对局一有更新就把「本局复盘数据」推到 GitHub master
//
// 为什么不用 git push：这台机器上 git 到 github.com:443 的 TLS 握手会失败（SSL_ERROR_SYSCALL），
// 但 GitHub REST API 是通的，所以走 Contents API 直接 PUT 文件。
//
// 它上传的不是原始 7MB 日志，而是**压缩后的复盘包**：
//   matches/<日期>.json —— 每个回合：我方（金币/LP/等级/盟约/盘面）+ 四家公开面板（含层数）+ 该回合事件
//
// 用法：
//   node sync-match.mjs                # 常驻，每 60 秒检查一次，有变化才传
//   node sync-match.mjs --once         # 只检查一次
//   node sync-match.mjs --interval 120 # 自定义间隔（秒）
//   node sync-match.mjs --dry          # 只打印要传什么，不真的传
//
// 凭据：advisor-dev/.sync-secret.json  { "token": "github_pat_...", "repo": "ZNCloud/arknights-sp-advisor", "branch": "master" }
// 该文件不在仓库里（.gitignore 已排除）。

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const RECORDS = path.join(here, 'records');
const SECRET = path.join(here, '.sync-secret.json');
const STATE = path.join(here, '.sync-state.json');

const args = process.argv.slice(2);
const once = args.includes('--once');
const dry = args.includes('--dry');
const intervalArg = args.indexOf('--interval');
const interval = (intervalArg > 0 ? Number(args[intervalArg + 1]) : 60) * 1000;

const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);

async function readJson(p, fallback = null) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fallback; }
}

async function loadConfig() {
  const cfg = await readJson(SECRET);
  if (!cfg) throw new Error(`缺少 ${SECRET}（需要 {token, repo, branch}）`);
  return { repo: 'ZNCloud/arknights-sp-advisor', branch: 'master', ...cfg };
}

const day = () => new Date().toISOString().slice(0, 10);

/** 读某个 jsonl，返回数组 */
async function readLines(file) {
  try {
    const txt = await fs.readFile(file, 'utf8');
    return txt.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

/**
 * 把当天的记录压成「按对局分组」的复盘包。
 * 对局边界判定：回合回到 1（或变小）或距上一条超过 20 分钟。
 */
function buildSession(turns, events, results) {
  const groups = [];
  let cur = null;
  let prevAt = 0;
  for (const t of turns) {
    const at = Date.parse(t.at) || 0;
    const newMatch = !cur || (t.round <= 1 && t.phase === 'PREP') || (at - prevAt > 20 * 60 * 1000);
    if (newMatch) { cur = []; groups.push(cur); }
    prevAt = at;
    cur.push(t);
  }
  const last = groups[groups.length - 1] || [];
  const from = last.length ? Date.parse(last[0].at) : 0;
  const to = last.length ? Date.parse(last[last.length - 1].at) : 0;

  // 压缩：同一回合只保留两份快照 —— PREP（买牌/建议）与该回合最后一份（打完后：LP/层数/四家）
  const byRound = new Map();
  for (const t of last) {
    const r = t.round;
    const slot = byRound.get(r) || {};
    if (t.phase === 'PREP') slot.prep = t;
    else slot.end = t;
    byRound.set(r, slot);
  }
  const rounds = [...byRound.entries()].sort((a, b) => a[0] - b[0]).map(([r, v]) => {
    const p = v.prep || {};
    const e = v.end || v.prep || {};
    return {
      round: r,
      funds: p.funds, lp: p.lp, level: p.level,
      bonds: p.bonds,
      shop: (p.shop || []).map((x) => x.id + '@' + x.price + (x.frozen ? 'f' : '')),
      hand: p.hand,
      advice: p.advice || null, pick: p.pick || null,
      // 站位与队友：盘面（at/dir/items）、队友公开状态、输出终端、BOSS、队伍 LP / BOSS 血池——站位复盘和以后学站位要用
      board: p.board ?? null, mates: p.mates ?? null, terminal: p.terminal ?? null, boss: p.boss ?? null,
      teamLp: p.teamLp ?? null, bossHp: p.bossHp ?? null,
      after: { lp: e.lp, bonds: e.bonds, table: e.table || null, board: e.board ?? null },
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    day: day(),
    rounds,
    events,
    results,
  };
}

async function putFile(cfg, remotePath, content, message) {
  const url = `https://api.github.com/repos/${cfg.repo}/contents/${remotePath}`;
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'sp-advisor-sync',
    'Content-Type': 'application/json',
  };
  let sha = null;
  try {
    const r = await fetch(`${url}?ref=${cfg.branch}`, { headers });
    if (r.ok) sha = (await r.json()).sha;
  } catch { /* 不存在就是新建 */ }
  const body = { message, content: Buffer.from(content).toString('base64'), branch: cfg.branch };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).commit.sha.slice(0, 7);
}

async function tick() {
  const cfg = await loadConfig();
  const d = day();
  const turns = await readLines(path.join(RECORDS, `${d}.jsonl`));
  if (!turns.length) { return log('本次没有记录，跳过'); }
  const events = await readLines(path.join(RECORDS, `${d}-events.jsonl`));
  const results = await readLines(path.join(RECORDS, `${d}-results.jsonl`));

  const session = buildSession(turns, events, results);
  const payload = JSON.stringify(session, null, 1);
  // 只在「回合推进 / 出现结果」时上传，避免每 2 分钟一个无意义提交
  const lastR = session.rounds.length ? session.rounds[session.rounds.length - 1].round : 0;
  const lastPhase = session.rounds.length ? (session.rounds[session.rounds.length - 1].after ? 'done' : 'prep') : 'none';
  const stamp = `${session.day}|${session.rounds.length}|${lastR}|${lastPhase}|${session.results.length}`;
  const hash = crypto.createHash('sha256').update(stamp).digest('hex').slice(0, 16);

  const state = (await readJson(STATE, {})) || {};
  if (state.hash === hash) { return log('内容未变化，跳过'); }

  const remotePath = `matches/${d}.json`;
  const lastRound = session.rounds.length ? session.rounds[session.rounds.length - 1].round : '?';
  const msg = `match update ${d} R${lastRound} (${session.rounds.length} 轮, ${session.events.length} 事件)`;

  if (dry) {
    log(`[dry] 会传 ${remotePath}（${(payload.length / 1024).toFixed(0)} KB, hash ${hash}）: ${msg}`);
    return;
  }
  const sha = await putFile(cfg, remotePath, payload, msg);
  await fs.writeFile(STATE, JSON.stringify({ hash, remotePath, at: new Date().toISOString() }));
  log(`已上传 ${remotePath} → ${cfg.repo}@${cfg.branch} (${sha}) · R${lastRound} · ${(payload.length / 1024).toFixed(0)} KB`);
}

async function main() {
  log(`sync-match 启动 · 每 ${interval / 1000}s 检查一次 · ${once ? '只跑一次' : '常驻'}${dry ? ' · DRY' : ''}`);
  if (once) { await tick().catch((e) => log('失败:', e.message)); return; }
  for (;;) {
    await tick().catch((e) => log('失败:', e.message));
    await new Promise((r) => setTimeout(r, interval));
  }
}

await main();
