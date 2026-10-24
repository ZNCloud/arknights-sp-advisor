// Runs the real overlay.mjs against a scripted client, without a game client: the overlay's own code paths (SNAPSHOT,
// boxOf, recordTurn, the lineup hook) run unchanged; only cdp-client.mjs is replaced. Used by test/overlay-lineup.test.mjs
// (lineup off: byte-identical to the golden output of the overlay before the lineup check existed) and by the replay
// runs of the lineup check on recorded matches (lineup on).
//
// The harness is a copy of the overlay's directory (os.tmpdir(), removed afterwards unless `keep`) with:
//   * cdp-client.mjs → a scripted client: every `evaluate` runs the expression in this process against a stand-in
//     `globalThis.__SP__.store` whose match is the current frame (frames: [{ match: { public, private }, me }]);
//   * open-brief.mjs → a stub (the real one lives only on the player's machine) whose decide() throws, so the opening
//     brief is skipped exactly as the overlay skips a failing one;
//   * ../Stronghold-Protocol/plugins/pick-advisor/ui/index.html → this repo's plugin/ui/index.html.
// Frames advance: mode 'ticks' = after `ticks` SNAPSHOT reads; mode 'lineup' = once state.json's lineup fragment of the
// frame's round is final (done / error / timeout) or the frame's prep deadline has passed. After the last frame the
// overlay process is ended and { stdout, transcript (state.json after every tick), records } is returned.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FAKE_CDP = `// test harness: scripted client (test/overlay-harness.mjs)
import fs from 'node:fs';
const frames = fs.readFileSync(process.env.HARNESS_FRAMES, 'utf8').split('\\n').filter(Boolean).map((l) => JSON.parse(l));
const mode = process.env.HARNESS_MODE || 'ticks', per = Number(process.env.HARNESS_TICKS || 3);
const state = new URL('./state.json', import.meta.url), out = process.env.HARNESS_OUT;
let i = 0, reads = 0, since = Date.now();
const final = new Set(['done', 'error', 'timeout']);
function log(line) { fs.appendFileSync(out, JSON.stringify(line) + '\\n'); }
function advance() {
  let s = null; try { s = fs.readFileSync(state, 'utf8'); } catch {}
  if (s !== null) log({ frame: frames[i].label ?? i, state: s });
  const f = frames[i], pub = f.match && f.match.public;
  let next = false;
  if (mode === 'ticks') next = ++reads >= per;
  else {
    const box = s ? JSON.parse(s) : null, lu = box && box.lineup;
    const prep = pub && pub.phase === 'PREP';
    const deadline = prep && typeof pub.deadline === 'number' ? pub.deadline - (pub.serverNow || 0) : 0;
    next = !prep ? ++reads >= per : (lu && lu.round === pub.round && final.has(lu.state)) || Date.now() - since > deadline + 2000;
  }
  if (next) { i++; reads = 0; since = Date.now(); if (i >= frames.length) { log({ end: true }); process.exit(0); } }
}
export async function connect() {
  return {
    async evaluate(expression) {
      const f = frames[i];
      globalThis.location = { origin: 'http://harness.local' };
      globalThis.localStorage = { getItem: () => null };
      globalThis.__SP__ = { store: { get: () => ({ match: f.match || {}, me: f.me || {}, connection: { status: 'open' } }) },
        data: { get: async () => f.bonds || null } };
      if (expression.includes('globalThis.__SP__;') && expression.includes('dataBonds')) advance();   // the overlay's SNAPSHOT: one tick
      return await (0, eval)(expression);
    },
    close() {},
  };
}
`;
const STUB_BRIEF = `// test harness stub: the real open-brief.mjs lives only on the player's machine
export function decide() { throw new Error('open-brief stub'); }
`;
// a fixed clock (lineup off: every output byte must be reproducible); TZ is pinned by the caller
const FROZEN = `const T0 = Date.UTC(2026, 9, 24, 12, 0, 0), D = Date;
globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [T0])); } static now() { return T0; } };
const lt = D.prototype.toLocaleTimeString;   // the log's clock format: one locale on every machine (Windows ignores LANG)
D.prototype.toLocaleTimeString = function (l, o) { return lt.call(this, l ?? 'en-US', o); };
`;

export async function runOverlay({ frames, args = ['--watch', '--log', '--interval', '20'], mode = 'ticks', ticks = 3, overlaySource = null,
  frozen = true, timeoutMs = 120000, keep = false, engine = null, onLine = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-harness-'));
  const dir = path.join(root, 'advisor-dev');
  try {
    fs.cpSync(repo, dir, { recursive: true, filter: (src) => {
      const rel = path.relative(repo, src);
      return !/^(\.git|matches|records|state\.json|route\.json|node_modules)(\/|\\|$)/.test(rel);
    } });
    if (overlaySource != null) fs.writeFileSync(path.join(dir, 'overlay.mjs'), overlaySource);
    fs.writeFileSync(path.join(dir, 'cdp-client.mjs'), FAKE_CDP);
    fs.writeFileSync(path.join(dir, 'open-brief.mjs'), STUB_BRIEF);
    const page = path.join(root, 'Stronghold-Protocol', 'plugins', 'pick-advisor', 'ui');
    fs.mkdirSync(page, { recursive: true });
    fs.copyFileSync(path.join(repo, 'plugin', 'ui', 'index.html'), path.join(page, 'index.html'));
    // eval/engine.mjs reads ../engine next to the advisor directory
    if (engine) fs.symlinkSync(path.resolve(engine), path.join(root, 'engine'), 'junction');
    const framesFile = path.join(root, 'frames.jsonl'), outFile = path.join(root, 'transcript.jsonl');
    fs.writeFileSync(framesFile, frames.map((f) => JSON.stringify(f)).join('\n') + '\n');
    const pre = path.join(root, 'frozen.mjs');
    fs.writeFileSync(pre, FROZEN);
    const node = [...(frozen ? ['--import', pathToFileURL(pre).href] : []), path.join(dir, 'overlay.mjs'), ...args];
    const env = { ...process.env, TZ: 'UTC', LANG: 'C', HARNESS_FRAMES: framesFile, HARNESS_OUT: outFile, HARNESS_MODE: mode, HARNESS_TICKS: String(ticks) };
    const stdout = await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, node, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      p.stdout.on('data', (d) => { out += d; if (onLine) for (const l of String(d).split('\n')) if (l.trim()) onLine(l); });
      p.stderr.on('data', (d) => { err += d; });
      const t = setTimeout(() => { p.kill(); reject(Error(`overlay harness timed out after ${timeoutMs} ms\n${err.slice(-2000)}`)); }, timeoutMs);
      p.on('exit', (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(Error(`overlay exited ${code}\n${err.slice(-2000)}`)); });
    });
    const transcript = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const recDir = path.join(dir, 'records'), records = {};
    if (fs.existsSync(recDir)) for (const f of fs.readdirSync(recDir).sort()) records[f] = fs.readFileSync(path.join(recDir, f), 'utf8');
    return { stdout, transcript, records, root };
  } finally { if (!keep) fs.rmSync(root, { recursive: true, force: true }); }
}
