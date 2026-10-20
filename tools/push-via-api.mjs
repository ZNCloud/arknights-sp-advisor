#!/usr/bin/env node
// tools/push-via-api.mjs —— 当 github.com 被墙、但 api.github.com 还通时，用 REST API 把本地提交推上去。
//
// 为什么需要它：`git push` 走的是 https://github.com/...，而 api.github.com 是另一个域名/IP，
// 国内经常只封前者。这条路把本地已有的提交对象原样搬到远端（blob 用 `git cat-file` 取，不重新算），
// 所以推完远端 sha 和本地 sha 完全一致，不会因为换行/编码被改写。
//
// 用法（token 从 Windows 凭据管理器取，别写进脚本）：
//   $env:GH_TOKEN = (git credential fill ... 里的 password)
//   node tools/push-via-api.mjs --remote ZNCloud/arknights-sp-advisor --branch master
//
// 前置：本地 HEAD 是 origin/master 的直系后代（只会 fast-forward）。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const REPO = opt('--remote', 'ZNCloud/arknights-sp-advisor');
const BRANCH = opt('--branch', 'master');
const TOKEN = process.env.GH_TOKEN || '';
if (!TOKEN) { console.error('缺少 GH_TOKEN'); process.exit(2); }

const API = 'https://api.github.com';
const git = (...args) => {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const gitBin = (...args) => {
  const tmp = path.join(os.tmpdir(), `push-api-${Math.random().toString(16).slice(2)}.bin`);
  const r = spawnSync('git', [...args], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${String(r.stderr)}`);
  fs.writeFileSync(tmp, r.stdout);
  return tmp;
};

async function api(p, init = {}) {
  const res = await fetch(`${API}${p}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'sp-advisor-push-api',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${p} -> ${res.status} ${text.slice(0, 300)}`);
  return json;
}

const head = git('rev-parse', 'HEAD').trim();
const base = (await api(`/repos/${REPO}/git/ref/heads/${BRANCH}`)).object.sha;

// 本地比远端多出的提交（按时间正序）
const list = git('rev-list', '--reverse', `${base}..${head}`).trim().split('\n').filter(Boolean);
if (!list.length) { console.log(`远端 ${base.slice(0, 7)} 已经是最新，没有要推的`); process.exit(0); }
const behind = git('rev-list', '--count', `${head}..${base}`).trim();
if (behind !== '0') { console.error(`本地落后远端 ${behind} 个提交，先 rebase 再用这个脚本`); process.exit(3); }

for (const sha of list) {
  const full = git('log', '-1', '--format=%B', sha).replace(/\n+$/, '');
  const parent = git('rev-parse', `${sha}^`).trim();
  const meta = git('log', '-1', '--format=%an%n%ae%n%aI%n%cn%n%ce%n%cI', sha).trim().split('\n');
  const [an, ae, ad, cn, ce, cd] = meta;
  const parentTree = (await api(`/repos/${REPO}/git/commits/${parent}`)).tree.sha;

  // 这个提交改了哪些文件（相对父提交）
  const changed = git('diff-tree', '--no-commit-id', '--name-status', '-r', sha).trim().split('\n').filter(Boolean);
  const entries = [];
  for (const line of changed) {
    const [status, p] = line.split('\t');
    if (status === 'D') { entries.push({ path: p, mode: '100644', sha: null }); continue; }
    const tmp = gitBin('cat-file', '-p', `${sha}:${p}`);
    const b64 = fs.readFileSync(tmp).toString('base64');
    fs.unlinkSync(tmp);
    const blob = await api(`/repos/${REPO}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: b64, encoding: 'base64' }) });
    entries.push({ path: p, mode: '100644', sha: blob.sha });
  }
  const tree = await api(`/repos/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: parentTree, tree: entries.map((e) => ({ path: e.path, mode: e.mode, type: 'blob', sha: e.sha })) }),
  });
  const commit = await api(`/repos/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: full + '\n',
      tree: tree.sha,
      parents: [parent],
      author: { name: an, email: ae, date: ad },
      committer: { name: cn, email: ce, date: cd },
    }),
  });
  const same = commit.sha === sha;
  console.log(`${sha.slice(0, 7)} -> ${commit.sha.slice(0, 7)}  ${same ? '（sha 一致 ✓）' : '（sha 不同，检查换行/编码）'}  ${full.split('\n')[0]}`);
  if (!same) {
    console.error('  ⚠ 远端 sha 与本地不同：远端对象已创建但与本地提交不完全一致，先别改 ref，检查后再决定');
    process.exit(4);
  }
  await api(`/repos/${REPO}/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
  console.log(`   refs/heads/${BRANCH} → ${commit.sha.slice(0, 7)}`);
}
console.log('完成。');
