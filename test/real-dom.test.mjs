// node --test test/real-dom.test.mjs — real-dom.mjs against a stub DOM shaped exactly like the real client's shop bar
// (engine/public/js/ui/shopBar.js: `.scard[data-shop-slot]`, `.toolbtn--amber`, `.toolbtn--ice`) verified by reading
// that file (sprlui_1825). No real browser: a fake document good enough for the handful of selectors real-dom.mjs
// actually uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { applyOverlay, clearOverlay, injectSrc } from '../real-dom.mjs';

function el(tag, attrs = {}) {
  return {
    tag, dataset: {}, style: {}, children: [], text: '',
    ...attrs,
    get textContent() { return this.text; },
    set textContent(t) { this.text = t; },
    appendChild(c) { this.children.push(c); c.parent = this; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.removed = true; },
    getBoundingClientRect() { return this.rect || { top: 0, left: 0, right: 0, bottom: 0 }; },
  };
}

/** A stub document with a fixed shop: slots 0..n-1 are `.scard[data-shop-slot]`, plus a refresh and a freeze button —
 * exactly the shape ChessCard/ItemCard/ShopBar (shopBar.js) render, selector-matched by the literal strings
 * real-dom.mjs queries (no general CSS engine; this is not a browser, just enough of one). */
function stubDoc({ slots = 3 } = {}) {
  const cards = Array.from({ length: slots }, (_, i) => {
    const c = el('button', { dataset: { shopSlot: String(i) } });
    c.rect = { top: 10 * i, left: 100, right: 150, bottom: 10 * i + 40 };
    c.className = 'scard';
    return c;
  });
  const amber = el('button', { className: 'toolbtn--amber' });
  amber.rect = { top: 200, left: 300, right: 340, bottom: 230 };
  const ice = el('button', { className: 'toolbtn--ice' });
  ice.rect = { top: 200, left: 350, right: 390, bottom: 230 };
  const body = el('body');
  const byId = new Map();
  const doc = {
    body,
    createElement: (tag) => el(tag),
    getElementById: (id) => byId.get(id) || null,
    querySelector(sel) {
      if (sel === '.toolbtn--amber') return amber;
      if (sel === '.toolbtn--ice') return ice;
      const m = /^\[data-sp-adv-badge="(.+)"\]$/.exec(sel);
      if (m) return findBadge(body, m[1]) || null;
      throw Error(`stub doc: unhandled selector ${sel}`);
    },
    querySelectorAll(sel) {
      if (sel === '.scard[data-shop-slot]') return arrLike(cards);
      if (sel === '[data-sp-adv-badge]') return arrLike(allBadges(body));
      throw Error(`stub doc: unhandled selector ${sel}`);
    },
  };
  const origAppend = body.appendChild.bind(body);
  body.appendChild = (c) => { origAppend(c); byId.set(c.id, c); };
  return { doc, cards, amber, ice, body };
}
function arrLike(a) { a.forEach = Array.prototype.forEach.bind(a); return a; }
function allBadges(node, out = []) {
  for (const c of node.children || []) { if (c.dataset && c.dataset.spAdvBadge != null) out.push(c); allBadges(c, out); }
  return out;
}
function findBadge(node, key) {
  for (const c of node.children || []) {
    if (c.dataset && c.dataset.spAdvBadge === key) return c;
    const f = findBadge(c, key);
    if (f) return f;
  }
  return null;
}
// root.querySelector / querySelectorAll are called on the overlay root (a plain `el('div')`), not `doc` — give every
// created div/span the same two methods so `root.querySelector(...)` and `root.querySelectorAll(...)` work too.
const origEl = el;
function withQuery(node) {
  node.querySelector = (sel) => { const m = /^\[data-sp-adv-badge="(.+)"\]$/.exec(sel); return m ? findBadge(node, m[1]) : null; };
  node.querySelectorAll = (sel) => (sel === '[data-sp-adv-badge]' ? arrLike(allBadges(node)) : []);
  return node;
}

function freshDoc(opts) {
  const s = stubDoc(opts);
  const realCreate = s.doc.createElement;
  s.doc.createElement = (tag) => withQuery(realCreate(tag));
  return s;
}

test('plan = null: clearOverlay is a no-op when nothing was ever drawn (byte-identical toggle-off)', () => {
  const { doc, body } = freshDoc({ slots: 3 });
  applyOverlay(doc, null);
  assert.equal(body.children.length, 0, 'no overlay root was created');
  clearOverlay(doc);
  assert.equal(body.children.length, 0);
});

test('applyOverlay paints a badge per slot, highlights the top pick, and paints refresh + freeze', () => {
  const { doc, cards, amber, ice, body } = freshDoc({ slots: 3 });
  applyOverlay(doc, { slots: [{ index: 0, score: 12 }, { index: 1, score: 61 }, { index: 2, score: 5 }], top: 1, refresh: 7, freeze: 0 });
  const root = body.children.find((c) => c.id === 'sp-adv-badges');
  assert.ok(root, 'overlay root created');
  const badge = (key) => root.children.find((c) => c.dataset.spAdvBadge === key);
  assert.equal(badge('slot:0').textContent, '12');
  assert.equal(badge('slot:1').textContent, '买★61', 'the top pick is marked, not just scored');
  assert.equal(badge('slot:2').textContent, '5');
  assert.equal(badge('refresh').textContent, '7');
  assert.equal(badge('freeze').textContent, '0');
  // positioned off the real card's own rect (card 1, right=150 top=10 per the stub) — not a fixed/guessed spot
  assert.equal(badge('slot:1').style.left, `${Math.round(cards[1].rect.right - 4)}px`);
  assert.equal(badge('slot:1').style.top, `${Math.round(cards[1].rect.top - 4)}px`);
  assert.equal(badge('refresh').style.left, `${Math.round(amber.rect.right - 4)}px`);
  assert.equal(badge('freeze').style.left, `${Math.round(ice.rect.right - 4)}px`);
  // nothing on the real cards themselves changed (Preact owns those — see the module header)
  cards.forEach((c) => assert.equal(c.children.length, 0, 'no child was appended into the real card'));
});

test('applyOverlay is idempotent: a second call with the same plan updates in place, does not duplicate', () => {
  const { doc, body } = freshDoc({ slots: 2 });
  const plan = { slots: [{ index: 0, score: 10 }, { index: 1, score: 20 }], top: 0, refresh: 3, freeze: 1 };
  applyOverlay(doc, plan);
  applyOverlay(doc, plan);
  const root = body.children.find((c) => c.id === 'sp-adv-badges');
  assert.equal(root.children.length, 4, 'exactly 4 badges (2 slots + refresh + freeze), not 8');
});

test('applyOverlay drops a stale badge when its slot disappears (sold / shop rerolled)', () => {
  const { doc, body } = freshDoc({ slots: 2 });
  applyOverlay(doc, { slots: [{ index: 0, score: 10 }, { index: 1, score: 20 }], top: 1, refresh: 0, freeze: 0 });
  applyOverlay(doc, { slots: [{ index: 0, score: 10 }], top: 0, refresh: 0, freeze: 0 });   // slot 1 sold
  const root = body.children.find((c) => c.id === 'sp-adv-badges');
  assert.equal(root.children.find((c) => c.dataset.spAdvBadge === 'slot:1'), undefined, 'slot 1 badge is gone');
  assert.ok(root.children.find((c) => c.dataset.spAdvBadge === 'slot:0'), 'slot 0 badge stays');
});

test('injectSrc: the string sent to cdp.evaluate is fully self-contained — no free variable escapes `applyOverlay.toString()` alone', () => {
  // overlay.mjs has no bundler reach into the live page (see the module header): injectSrc re-declares rootOf/paint/
  // clearOverlay/ROOT_ID inline. Run the generated string in a brand-new vm context (no access to this module's own
  // closure) with only a stub `document` — exactly what the real page gives it — to prove nothing is missing.
  const { doc, body } = freshDoc({ slots: 2 });
  const src = injectSrc({ slots: [{ index: 0, score: 9 }, { index: 1, score: 50 }], top: 1, refresh: 4, freeze: 0 });
  vm.runInNewContext(src, { document: doc });
  const root = body.children.find((c) => c.id === 'sp-adv-badges');
  assert.ok(root, 'applyOverlay actually ran inside the isolated vm context');
  assert.equal(root.children.find((c) => c.dataset.spAdvBadge === 'slot:1').textContent, '买★50');
});

test('a plan given, then plan = null: the overlay is fully removed (toggling off mid-session leaves no trace)', () => {
  const { doc, body } = freshDoc({ slots: 1 });
  applyOverlay(doc, { slots: [{ index: 0, score: 40 }], top: 0, refresh: 2, freeze: 0 });
  assert.equal(body.children.length, 1);
  applyOverlay(doc, null);
  assert.equal(body.children.length, 0, 'the overlay root itself was removed, not just emptied');
});
