// In-memory content set (B5): apply a plugin-format data patch ({"patch":1,"ops":[...]}, docs/PLUGINS.md) with the
// engine's own applyPatches and install it with setData — the same path the engine's match host uses for a room's
// content set. Engine data files are never written. MUST run before eval/engine.mjs is imported (engine.mjs reads the
// data singleton at import); use eval/with-patch.mjs as the entry, workers get the patch via advisor/boot.mjs.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

let installed = null;
export const contentPatch = () => installed;
export async function installPatch(path) {
  if (installed) { if (installed.path !== path) throw Error(`another patch already installed: ${installed.path}`); return installed; }
  const imp = p => import(new URL(`../../engine/${p}`, import.meta.url));
  const [{ loadData, setData }, { applyPatches }] = await Promise.all([imp('server/data.js'), imp('shared/plugins/patch.js')]);
  const text = readFileSync(path, 'utf8'), doc = JSON.parse(text);
  if (doc.patch !== 1 || !Array.isArray(doc.ops)) throw Error(`${path}: not a {"patch":1,"ops":[...]} data patch`);
  const quiet = { info() {}, warn() {}, error() {} };
  const r = applyPatches(loadData(undefined, { log: quiet }), doc.ops, { pluginId: doc.pluginId || 'advisor-demo' });
  if (r.problems.length) throw Error(`patch problems: ${JSON.stringify(r.problems).slice(0, 400)}`);
  setData(r.data);
  installed = { path, sha256: createHash('sha256').update(text).digest('hex'), ops: doc.ops.length };
  return installed;
}
