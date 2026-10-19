// B3 改动清单：比较两份引擎目录的 data/*.json，逐条列出改了的干员 / 技能 / 盟约 / 装备 / 效果 / 驻防 / 数值表，
// 逐字段「旧值 → 新值」，带中文名。纯 JSON 读取，不加载引擎。
// Usage: node sp-advisor/tools/datadiff.mjs <oldEngineDir> <newEngineDir> [--json out.json] [--max 400]
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';

const [oldDir, newDir, ...rest] = process.argv.slice(2), opt = {};
for (let i = 0; i < rest.length; i++) opt[rest[i].replace(/^--/, '')] = rest[++i];
if (!oldDir || !newDir) throw Error('usage: datadiff.mjs <oldEngineDir> <newEngineDir>');
const KIND = { chess: '干员', bonds: '盟约', items: '装备', effects: '效果', garrisons: '驻防', bands: '策略', tokens: '召唤物', bosses: 'Boss', enemies: '敌人', tuning: '数值表', config: '配置', waves: '波次', stages: '地图', choices: '抉择', factions: '派系' };
const load = (dir, f) => existsSync(`${dir}/data/${f}`) ? JSON.parse(readFileSync(`${dir}/data/${f}`, 'utf8')) : null;
const label = (kind, id, rec, other) => {
  const r = rec || other || {};
  const n = r.name || r.title || r.label || null;
  return n ? `${n}(${id})` : id;
};
const short = v => { const s = JSON.stringify(v); return s === undefined ? '∅' : s.length > 120 ? s.slice(0, 117) + '…' : s; };
// Leaf-level diff; arrays of primitives are compared whole (a bond list is one field), others index-wise.
function diff(a, b, path, out) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  const obj = x => x && typeof x === 'object';
  if (obj(a) && obj(b) && Array.isArray(a) === Array.isArray(b) && !(Array.isArray(a) && [...a, ...b].every(x => !obj(x)))) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], path ? `${path}.${k}` : k, out);
  } else out.push({ field: path || '(整条)', old: a, new: b });
}
const files = [...new Set([...readdirSync(`${oldDir}/data`), ...readdirSync(`${newDir}/data`)])].filter(f => f.endsWith('.json') && f !== 'assets.json').sort();
const report = [];
for (const f of files) {
  const kind = f.replace('.json', ''), A = load(oldDir, f) || {}, B = load(newDir, f) || {};
  if (JSON.stringify(A) === JSON.stringify(B)) continue;
  const flat = typeof A === 'object' && !Array.isArray(A) && Object.values({ ...A, ...B }).every(v => v && typeof v === 'object');
  if (!flat) { const ch = []; diff(A, B, '', ch); report.push({ file: f, kind: KIND[kind] || kind, id: '(整文件)', name: f, changes: ch }); continue; }
  for (const id of [...new Set([...Object.keys(A), ...Object.keys(B)])].sort()) {
    if (JSON.stringify(A[id]) === JSON.stringify(B[id])) continue;
    const ch = [];
    if (!(id in A)) ch.push({ field: '(新增)', old: undefined, new: '…' });
    else if (!(id in B)) ch.push({ field: '(删除)', old: '…', new: undefined });
    else diff(A[id], B[id], '', ch);
    report.push({ file: f, kind: KIND[kind] || kind, id, name: label(kind, id, B[id], A[id]), changes: ch });
  }
}
const max = +(opt.max || 400);
console.log(`改动 ${report.length} 条（${files.length} 个数据文件比较；assets.json 不比）`);
for (const r of report.slice(0, max)) {
  console.log(`[${r.kind}] ${r.name}`);
  for (const c of r.changes.slice(0, 30)) console.log(`    ${c.field}: ${short(c.old)} → ${short(c.new)}`);
  if (r.changes.length > 30) console.log(`    …另有 ${r.changes.length - 30} 处`);
}
if (opt.json) writeFileSync(opt.json, JSON.stringify(report, null, 1));
