// After train.py: verify every training file was generated on the current game version and write models/meta.json.
// Usage: node sp-advisor/advisor/stamp.mjs --model sp-advisor/models data/a.jsonl [data/b.jsonl ...]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dataHash, codeHash } from '../eval/version.mjs';
const args = process.argv.slice(2); let modelDir = 'sp-advisor/models'; const files = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--model') modelDir = args[++i]; else files.push(args[i]);
const now = dataHash(), sources = files.map(f => {
  if (!existsSync(`${f}.meta.json`)) throw Error(`${f}: no version sidecar (${f}.meta.json)`);
  const m = JSON.parse(readFileSync(`${f}.meta.json`, 'utf8'));
  if (m.fingerprint !== now.fingerprint) throw Error(`${f}: generated on ${m.dataHash.slice(0, 12)}@${m.engineCommit.slice(0, 8)}, current ${now.dataHash.slice(0, 12)}@${now.engineCommit.slice(0, 8)} — regenerate`);
  return { file: f, games: m.games, createdAt: m.createdAt };
});
const metrics = JSON.parse(readFileSync(`${modelDir}/metrics.json`, 'utf8'));
writeFileSync(`${modelDir}/meta.json`, JSON.stringify({ ...now, codeHash: codeHash(), trainedAt: new Date().toISOString(), sources, featureSet: metrics.featureSet || 'x', ...(metrics.featureSet === 't' ? { tableVersion: (await import('./features-table.mjs')).TABLE_VERSION } : {}), valWinAuc: metrics.win.auc, valUtilR2: metrics.util.r2 }, null, 1));
console.log(`stamped ${modelDir}/meta.json data=${now.dataHash.slice(0, 12)} engine=${now.engineCommit.slice(0, 8)} from ${files.length} file(s)`);
