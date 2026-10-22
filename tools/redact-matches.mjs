// 对局记录脱敏：matches/*.jsonl 里的昵称 → 座位<seat>、账号 id → seat<seat>（advisor/redact.mjs，换不干净就报错不落盘）。
// 只打印行数和替换个数，从不打印原值。默认不改 matches/ 里的受版本管理的数据：写进 matches/ 要显式 --in-place。
// Usage: node tools/redact-matches.mjs <in.jsonl> [...] --out-dir <dir> [--in-place]
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactRows } from '../advisor/redact.mjs';

const MATCHES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'matches');
const argv = process.argv.slice(2), files = [];
let outDir = null, inPlace = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out-dir') outDir = argv[++i];
  else if (argv[i] === '--in-place') inPlace = true;
  else if (argv[i].startsWith('--')) throw Error(`unknown flag ${argv[i]}`);
  else files.push(argv[i]);
}
if (!files.length || !outDir) throw Error('usage: redact-matches.mjs <in.jsonl> [...] --out-dir <dir> [--in-place]');
const out = path.resolve(outDir);
const inside = (dir, root) => { const r = path.relative(root, dir); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
if (inside(out, MATCHES) && !inPlace) throw Error('refusing to write into matches/ (tracked data) without --in-place');

// all files first, then write: one file that fails to redact leaves nothing half-done
const done = files.map((f) => {
  const rows = readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  return { f, ...redactRows(rows) };
});
mkdirSync(out, { recursive: true });
for (const d of done) {
  const dst = path.join(out, path.basename(d.f));
  writeFileSync(`${dst}.tmp`, d.rows.map((r) => JSON.stringify(r)).join('\n') + (d.rows.length ? '\n' : ''));
  renameSync(`${dst}.tmp`, dst);
  console.log(`${path.basename(d.f)}: ${d.rows.length} rows, ${d.names} names + ${d.ids} ids replaced → ${dst}`);
}
