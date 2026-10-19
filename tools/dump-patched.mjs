// Write the data files an in-memory patch changes into <outDir>/data (so tools/datadiff.mjs can list the change).
// Usage: node sp-advisor/eval/with-patch.mjs <patch.json> sp-advisor/tools/dump-patched.mjs <outDir>
import { writeFileSync, mkdirSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';
import { data, engineRoot } from '../eval/engine.mjs';
const out = process.argv[2]; if (!out) throw Error('usage: dump-patched.mjs <outDir>');
mkdirSync(`${out}/data`, { recursive: true });
let changed = 0;
for (const f of readdirSync(`${engineRoot}/data`).filter(x => x.endsWith('.json') && x !== 'assets.json')) {
  const name = f.replace('.json', ''), orig = JSON.parse(readFileSync(`${engineRoot}/data/${f}`, 'utf8'));
  if (name in data && JSON.stringify(orig) !== JSON.stringify(data[name])) { writeFileSync(`${out}/data/${f}`, JSON.stringify(data[name])); changed++; }
  else copyFileSync(`${engineRoot}/data/${f}`, `${out}/data/${f}`);
}
console.log(`dumped ${out}/data (${changed} file(s) changed by the patch)`);
