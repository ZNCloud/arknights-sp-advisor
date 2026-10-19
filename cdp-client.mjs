// advisor-dev/cdp-client.mjs — a minimal Chrome DevTools Protocol client for the 卫戍协议 desktop client.
//
// The client is Electron: started with `--remote-debugging-port=9222` it in Chrome's terms becomes a debuggable app,
// and its page — the real game page the server serves — exposes `globalThis.__SP__ = { store, net, data }`. Reading
// that is the whole trick: no client file is touched, the server sees nothing unusual, and the information is exactly
// what the player already sees on screen.
//
//   const cdp = await connect({ port: 9222 });
//   await cdp.evaluate('1 + 1');
//   cdp.close();

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'Stronghold-Protocol');

async function loadWs() {
  const mod = await import(pathToFileURL(path.join(repo, 'node_modules', 'ws', 'index.js')).href);
  const WebSocket = mod.WebSocket || mod.default;
  if (typeof WebSocket !== 'function') throw new Error(`ws did not load a WebSocket class (keys: ${Object.keys(mod).join(',')})`);
  return WebSocket;
}

/** @param {{ port?: number|string }} [opts] */
export async function connect({ port = process.env.CDP_PORT || 9222 } = {}) {
  const WebSocket = await loadWs();
  let targets;
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  } catch (error) {
    throw new Error(`no debugger on :${port} — start the client with --remote-debugging-port=${port} (${error.message})`);
  }
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!pages.length) throw new Error(`the client has no page target on :${port}`);
  // the game page is the http(s) one; the launcher is a file:// page
  const page = pages.find((t) => /^https?:/.test(t.url)) || pages[0];

  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 1 << 26 });
  await new Promise((ok, bad) => { ws.once('open', ok); ws.once('error', bad); });

  let seq = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    if (msg.error) slot.bad(new Error(JSON.stringify(msg.error)));
    else slot.ok(msg.result);
  });
  const send = (method, params = {}) => new Promise((ok, bad) => {
    const id = ++seq;
    pending.set(id, { ok, bad });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Runtime.enable');

  return {
    url: page.url,
    async evaluate(expression) {
      const r = await send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true, allowUnsafeEvalBlockedByCSP: true,
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result?.value;
    },
    close() { try { ws.close(); } catch { /* already gone */ } },
  };
}
