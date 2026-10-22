// node --test advisor/route.test.mjs — the saved main line must not carry over into the next match
// (2026-10-21 game 2: the box kept asking for game 1's Victoria core for 6 rounds).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadAdvisor } from '../core-loader.mjs';
import { routeFor } from '../route-pick.mjs';

// PLUGIN_PAGE points outside the repo (the client checkout); the repo's own copy is the one under test
const PAGE = fileURLToPath(new URL('../plugin/ui/index.html', import.meta.url));
const { DATA, api } = await loadAdvisor(PAGE);
const isCore = (id) => !!(DATA.bonds[id] && DATA.bonds[id].c === 1);

const game1 = { modeId: 'mode_team', difficulty: 2, bossId: 'boss_a', hiddenBossId: null, round: 3,
  drawnDisabledBonds: ['yanShip', 'egirShip'], bannedChess: ['c2', 'c1'] };
const game2 = { ...game1, bossId: 'boss_b', drawnDisabledBonds: ['sargonShip', 'egirShip'] };

test('matchKeyOf: stable within a match, differs across matches, ignores hiddenBossId / round / order', () => {
  const k1 = api.matchKeyOf(game1);
  assert.equal(typeof k1, 'string');
  assert.equal(api.matchKeyOf({ ...game1, round: 9, hiddenBossId: 'boss_h', players: [{ playerId: 'p_x' }] }), k1);
  assert.equal(api.matchKeyOf({ ...game1, drawnDisabledBonds: ['egirShip', 'yanShip'], bannedChess: ['c1', 'c2'] }), k1);
  assert.notEqual(api.matchKeyOf({ ...game1, bossId: 'boss_b' }), k1);
  assert.notEqual(api.matchKeyOf({ ...game1, drawnDisabledBonds: ['yanShip', 'kjeragShip'] }), k1);
  assert.notEqual(api.matchKeyOf({ ...game1, bannedChess: ['c1'] }), k1);
  assert.notEqual(api.matchKeyOf({ ...game1, difficulty: 3 }), k1);
  assert.equal(api.matchKeyOf(null), null);
  assert.equal(api.matchKeyOf({ round: 1, phase: 'LOBBY' }), null);
});

test('routeFor: only a core route saved under this very match key', () => {
  const k1 = api.matchKeyOf(game1), k2 = api.matchKeyOf(game2);
  assert.equal(routeFor({ route: 'victoriaShip', match: k1 }, k1, isCore), 'victoriaShip');
  assert.equal(routeFor({ route: 'victoriaShip', match: k1 }, k2, isCore), null);       // another match
  assert.equal(routeFor({ route: 'victoriaShip' }, k1, isCore), null);                  // legacy box.ps1 file
  assert.equal(routeFor('victoriaShip', k1, isCore), null);                             // legacy bare id
  assert.equal(routeFor({ route: 'victoriaShip', match: null }, null, isCore), null);   // match unknown
  assert.equal(routeFor({ route: 'preciShip', match: k1 }, k1, isCore), null);          // not a core bond
  assert.equal(routeFor({ route: 'nope', match: k1 }, k1, isCore), null);
});

// a game-2 board already two deep in Kjerag: with game 1's Victoria stuck, autoRoute keeps Victoria (the bug)
const kj = Object.keys(DATA.chess).filter((id) => DATA.chess[id][4] === 0 && DATA.chess[id][2].includes('kjeragShip')
  && !DATA.chess[id][2].includes('victoriaShip')).slice(0, 2);
const priv2 = { funds: 10, lp: 40, round: 3, shop: { level: 2, slots: [] }, hand: [],
  board: kj.map((id, i) => ({ kind: 'chess', id, row: 0, col: i })), bonds: [{ bondId: 'kjeragShip', count: 2, tier: 0, layers: 0 }] };

test('replay: game-1 Victoria pick + game-2 brief → the saved route is dropped, autoRoute decides', () => {
  assert.equal(kj.length, 2);
  const saved = { route: 'victoriaShip', match: api.matchKeyOf(game1) };
  assert.equal(api.autoRoute(priv2, 'victoriaShip', game2.drawnDisabledBonds), 'victoriaShip');   // what game 2 got
  const route = routeFor(saved, api.matchKeyOf(game2), isCore);
  assert.equal(route, null);
  assert.equal(api.autoRoute(priv2, route, game2.drawnDisabledBonds), 'kjeragShip');
  // the same file in game 1 itself is still honoured
  assert.equal(routeFor(saved, api.matchKeyOf(game1), isCore), 'victoriaShip');
});

// The in-game panel's own message handler, run on a stub DOM: which route button is lit, what goes to storage.
function panel() {
  const html = readFileSync(PAGE, 'utf8');
  const src = /<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/.exec(html)[1];
  const data = /<script id="sp-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1];
  const node = () => ({ children: [], style: {}, className: null, type: '', title: '', listeners: {}, text: '',
    get textContent() { return this.text; }, set textContent(t) { this.text = t; this.children = []; },   // like the DOM: clears
    appendChild(c) { this.children.push(c); }, setAttribute() {}, addEventListener(t, f) { this.listeners[t] = f; } });
  const root = node();
  const document = { getElementById: (id) => (id === 'sp-data' ? { textContent: data } : id === 'app' ? root : null),
    createElement: () => node(), createTextNode: (t) => ({ textContent: t }) };
  const sent = [];
  let onMessage = null;
  const window = { addEventListener: (t, f) => { if (t === 'message') onMessage = f; } };
  new Function('document', 'window', 'parent', src)(document, window, { postMessage: (m) => sent.push(m) });
  const lit = () => {
    const bar = root.children.find((c) => c.className === 'route');
    return (bar && bar.children.find((b) => b.className === 'on')) || null;
  };
  return {
    sent,
    post: (data) => onMessage({ data: { v: 1, ...data } }),
    state: (pub) => onMessage({ data: { v: 1, t: 'state', public: pub, private: { ...priv2, playerId: 'p_0123456789' } } }),
    lit: () => { const b = lit(); return b ? b.title.split(' ')[0] : null; },
    click: (name) => root.children.find((c) => c.className === 'route').children.find((b) => b.title.startsWith(name + ' ')).listeners.click(),
  };
}

test('panel: a stored game-1 pick is honoured in game 1 and dropped in game 2 (same playerId)', () => {
  const vic = DATA.bonds.victoriaShip.n, kjn = DATA.bonds.kjeragShip.n;
  const p = panel();
  p.state(game1);
  assert.equal(p.lit(), kjn);                         // no pick yet: the auto route
  p.click(vic);
  assert.equal(p.lit(), vic);
  const set = p.sent.filter((m) => m.t === 'storage' && m.op === 'set').pop();
  assert.deepEqual(JSON.parse(set.value), { route: 'victoriaShip', match: api.matchKeyOf(game1) });
  p.state({ ...game1, round: 5 });
  assert.equal(p.lit(), vic);                         // same match: kept
  p.state(game2);
  assert.equal(p.lit(), kjn);                         // next match: back to the auto route

  // a fresh panel (re-attach) whose storage reply arrives before the first state
  const q = panel();
  q.post({ t: 'storage', op: 'get', ok: true, value: set.value });
  q.state(game1);
  assert.equal(q.lit(), vic);
  const r = panel();
  r.post({ t: 'storage', op: 'get', ok: true, value: set.value });
  r.state(game2);
  assert.equal(r.lit(), kjn);
  const legacy = panel();                             // old plain-id storage value: ignored
  legacy.state(game1);
  legacy.post({ t: 'storage', op: 'get', ok: true, value: 'victoriaShip' });
  assert.equal(legacy.lit(), kjn);
  const late = panel();                               // a reply after the first state, same match: adopted
  late.state(game1);
  late.post({ t: 'storage', op: 'get', ok: true, value: set.value });
  assert.equal(late.lit(), vic);
});
