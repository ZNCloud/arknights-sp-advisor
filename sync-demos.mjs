// advisor-dev/sync-demos.mjs — 定时把 Downloads 里的 .spdemo 原片传到 GitHub（demos/raw/）
//
// 设计要点：
//   · 只传「新出现或内容变了」的文件：按 sha256 记账（.demos-state.json），已传过的跳过
//   · 原片逐字节上传，不做任何解析（无损）；每传完一批就更新 demos/raw-index.json（含 sha256，可复算）
//   · 首次运行会用 demos/raw-index.local.json 里已有的记录「预置账本」，避免把 21 个老文件重传一遍
//   · 走 GitHub Contents API（这台机器 git push 的 TLS 握手会失败，API 正常）
//
//   node sync-demos.mjs                    # 常驻，默认每 300 秒扫一次
//   node sync-demos.mjs --once             # 扫一次就退出
//   node sync-demos.mjs --interval 60      # 自定义间隔（秒）
//   node sync-demos.mjs --dry              # 只打印将上传什么
//   node sync-demos.mjs --dir <文件夹>      # 换来源目录

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const has = (n) => args.includes('--' + n);
const flag = (n, d = null) => { const i = args.indexOf('--' + n); return i >= 0 ? (args[i + 1] ?? true) : d; };

const SRC = flag('dir', 'C:\\Users\\Administrator\\Downloads');
const SECRET = path.join(here, '.sync-secret.json');
const STATE = path.join(here, '.demos-state.json');
const SEED = path.join(here, 'demos', 'raw-index.local.json');
const once = has('once');
const dry = has('dry');
const interval = (Number(flag('interval', 300)) || 300) * 1000;

const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function readJson(p, d = null) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return d; } }

async function loadConfig() {
  const cfg = await readJson(SECRET);
  if (!cfg) throw new Error(`缺少 ${SECRET}`);
  return { repo: 'ZNCloud/arknights-sp-advisor', branch: 'master', ...cfg };
}

async function putFile(cfg, remotePath, content, message) {
  const url = `https://api.github.com/repos/${cfg.repo}/contents/${remotePath}`;
  const headers = { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'sp-advisor-sync-demos' };
  let sha = null;
  try { const r = await fetch(`${url}?ref=${cfg.branch}`, { headers }); if (r.ok) sha = (await r.json()).sha; } catch { /* new */ }
  const body = { message, content: Buffer.from(content).toString('base64'), branch: cfg.branch };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`);
  const j = await res.json();
  return { commit: j.commit.sha.slice(0, 7), size: j.content && j.content.size };
}

/** 账本：{ files: { 文件名: {sha256, bytes, commit, at} } } */
async function loadState() {
  const st = (await readJson(STATE, null)) || { files: {} };
  if (!st.files) st.files = {};
  if (!Object.keys(st.files).length) {
    const seed = await readJson(SEED, null);
    if (seed && Array.isArray(seed.files)) {
      for (const f of seed.files) {
        if (f.file && f.sha256) st.files[f.file] = { sha256: f.sha256, bytes: f.bytes, commit: f.commit || null, at: seed.generatedAt || null };
      }
      if (Object.keys(st.files).length) {
        log(`账本已从 ${path.basename(SEED)} 预置 ${Object.keys(st.files).length} 条`);
        await fs.writeFile(STATE, JSON.stringify(st)).catch(() => {});   // 预置后立刻落盘，避免每次重新预置
      }
    }
  }
  return st;
}

async function tick() {
  const cfg = dry ? { repo: 'ZNCloud/arknights-sp-advisor', branch: 'master' } : await loadConfig();
  const st = await loadState();
  const names = (await fs.readdir(SRC)).filter((n) => n.toLowerCase().endsWith('.spdemo')).sort();
  if (!names.length) return log('来源目录没有 .spdemo');

  const todo = [];
  for (const name of names) {
    const buf = await fs.readFile(path.join(SRC, name));
    const digest = sha256(buf);
    const known = st.files[name];
    if (known && known.sha256 === digest) continue;      // 已传过且内容未变
    todo.push({ name, buf, digest });
  }
  if (!todo.length) return log(`${names.length} 个原片都已上传，无变化`);

  log(`待上传 ${todo.length} 个：${todo.map((t) => t.name).join(', ')}`);
  for (const t of todo) {
    const remote = `demos/raw/${t.name}`;
    if (dry) { log(`[dry] ${remote} ${(t.buf.length / 1024).toFixed(0)} KB sha ${t.digest.slice(0, 12)}`); continue; }
    try {
      const out = await putFile(cfg, remote, t.buf, `demo(raw): ${t.name} ${(t.buf.length / 1024).toFixed(0)} KB sha256:${t.digest.slice(0, 12)}`);
      st.files[t.name] = { sha256: t.digest, bytes: t.buf.length, commit: out.commit, at: new Date().toISOString() };
      await fs.writeFile(STATE, JSON.stringify(st));
      log(`↑ ${remote} ${(t.buf.length / 1024).toFixed(0)} KB → ${out.commit}${out.size === t.buf.length ? '' : ` ⚠ size ${out.size}`}`);
    } catch (e) {
      log(`✗ ${t.name}: ${e.message}`);
    }
  }

  if (dry) return;
  // 更新清单（含 sha256，可复算无损）
  const manifest = {
    generatedAt: new Date().toISOString(),
    source: SRC,
    count: Object.keys(st.files).length,
    totalBytes: Object.values(st.files).reduce((a, b) => a + (b.bytes || 0), 0),
    note: '.spdemo 原片逐字节上传（gzip 压缩的 JSON），sha256 为本地原文件摘要。',
    files: Object.entries(st.files).sort(([a], [b]) => a.localeCompare(b))
      .map(([file, v]) => ({ file, bytes: v.bytes, sha256: v.sha256, commit: v.commit })),
  };
  try {
    const out = await putFile(cfg, 'demos/raw-index.json', JSON.stringify(manifest, null, 1),
      `demo(raw): index — ${manifest.count} files, ${(manifest.totalBytes / 1024 / 1024).toFixed(1)} MB`);
    log(`↑ demos/raw-index.json (${manifest.count} 条) → ${out.commit}`);
  } catch (e) { log(`✗ 清单: ${e.message}`); }
}

async function main() {
  log(`sync-demos 启动 · 来源 ${SRC} · 每 ${interval / 1000}s 一次${once ? ' · 只跑一次' : ''}${dry ? ' · DRY' : ''}`);
  for (;;) {
    await tick().catch((e) => log('失败:', e.message));
    if (once) return;
    await new Promise((r) => setTimeout(r, interval));
  }
}

await main();
