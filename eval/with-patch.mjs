// Usage: node sp-advisor/eval/with-patch.mjs <patch.json> <script.mjs> [script args...]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installPatch } from './content.mjs';
const [patch, script, ...rest] = process.argv.slice(2);
if (!patch || !script) throw Error('usage: with-patch.mjs <patch.json> <script.mjs> [args...]');
const info = await installPatch(resolve(patch));
console.error(`[content] patch ${patch} installed (${info.ops} ops, sha ${info.sha256.slice(0, 12)})`);
process.argv = [process.argv[0], resolve(script), ...rest];
await import(pathToFileURL(resolve(script)).href);
