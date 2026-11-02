// advisor-dev/demo-upload-raw.mjs — 把 .spdemo 原片（无损）整份上传到 GitHub
//
// 与 demo-parse.mjs 的分工：
//   demo-parse.mjs        解析成「可读的复盘 JSON」（demos/<id>.json）——方便看，但不是原始数据
//   demo-upload-raw.mjs   把 .spdemo 原片逐字节上传（demos/raw/<原文件名>）——无损，可再还原成录像
//
// 每个文件都会算 sha256 写进 demos/raw-index.json，可用来校验「上传的就是原文件」。
//
//   node demo-upload-raw.mjs                 # 上传 Downloads 下全部 .spdemo
//   node demo-upload-raw.mjs --dir <文件夹>
//   node demo-upload-raw.mjs --dry           # 只打印，不传

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf('--' + n); return i >= 0 ? (args[i + 1] ?? true) : d; };
const dry = args.includes('--dry');

const SRC = flag('dir', 'C:\\Users\\Administrator\\Downloads');
const SECRET = path.join(here, '.sync-secret.json');

const loadConfig = async () => {
  const cfg = JSON.parse(await fs.readFile(SECRET, 'utf8'));
  return { repo: 'ZNCloud/arknights-sp-advisor', branch: 'master', ...cfg };
};

async function putFile(cfg, remotePath, content, message) {
  const url = `https://api.github.com/repos/${cfg.repo}/contents/${remotePath}`;
  const headers = { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'sp-advisor-raw' };
  let sha = null;
  try { const r = await fetch(`${url}?ref=${cfg.branch}`, { headers }); if (r.ok) sha = (await r.json()).sha; } catch { /* new file */ }
  const body = { message, content: Buffer.from(content).toString('base64'), branch: cfg.branch };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`);
  const j = await res.json();
  return { commit: j.commit.sha.slice(0, 7), size: j.content && j.content.size };
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function main() {
  const cfg = dry ? { repo: 'ZNCloud/arknights-sp-advisor', branch: 'master' } : await loadConfig();
  const names = (await fs.readdir(SRC)).filter((n) => n.toLowerCase().endsWith('.spdemo')).sort();
  if (!names.length) { console.log('没有 .spdemo'); return; }
  console.log(`找到 ${names.length} 个原片，合计 ${names.length ? '' : ''}准备上传…`);

  const index = [];
  for (const name of names) {
    const local = path.join(SRC, name);
    const buf = await fs.readFile(local);
    const digest = sha256(buf);
    const remote = `demos/raw/${name}`;
    const rec = { file: name, bytes: buf.length, sha256: digest, remote };
    if (dry) {
      console.log(`  [dry] ${remote}  ${(buf.length / 1024).toFixed(0)} KB  ${digest.slice(0, 12)}`);
      index.push(rec);
      continue;
    }
    try {
      const out = await putFile(cfg, remote, buf, `demo(raw): ${name}  ${(buf.length / 1024).toFixed(0)} KB  sha256:${digest.slice(0, 12)}`);
      const ok = out.size === buf.length;
      console.log(`  ↑ ${remote}  ${(buf.length / 1024).toFixed(0)} KB  commit ${out.commit}${ok ? '' : `  ⚠ 远端 size=${out.size} 不符`}`);
      index.push({ ...rec, commit: out.commit, verifiedSize: out.size });
    } catch (e) {
      console.log(`  ✗ ${name}: ${e.message}`);
      index.push({ ...rec, error: e.message });
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: SRC,
    count: index.length,
    totalBytes: index.reduce((a, b) => a + b.bytes, 0),
    note: '这是 .spdemo 原片的逐字节上传（gzip 压缩的 JSON）。sha256 为本地原文件摘要，可用于校验无损。',
    files: index,
  };
  const json = JSON.stringify(manifest, null, 1);
  await fs.mkdir(path.join(here, 'demos'), { recursive: true });
  await fs.writeFile(path.join(here, 'demos', 'raw-index.local.json'), json);
  if (!dry) {
    const out = await putFile(cfg, 'demos/raw-index.json', json, `demo(raw): index — ${index.length} files, ${(manifest.totalBytes / 1024 / 1024).toFixed(1)} MB`);
    console.log(`\n索引已上传 demos/raw-index.json (commit ${out.commit})`);
  }
  console.log(`汇总: ${index.length} 个文件，${(manifest.totalBytes / 1024 / 1024).toFixed(2)} MB`);
}

await main();
