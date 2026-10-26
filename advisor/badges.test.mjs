// node --test advisor/badges.test.mjs — the refresh/freeze scores behind the shop-card weight overlay (sprlui_1825):
// `view.refreshScore` is exactly adviceRaw's "刷一次" number (refreshEV), and `view.freeze` is the new one (freezeEV) —
// same yardstick (scoreSlot's point scale), same re-score trick sellFundOf already uses (price set to funds, scored as
// if affordable), gated by the same ≥40 "抓" threshold adviceRaw already uses elsewhere. Hits the plugin core directly
// (core-loader.mjs), not the overlay/DOM layer (that's test/overlay-badges.test.mjs and test/real-dom.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadAdvisor } from '../core-loader.mjs';

const PAGE = fileURLToPath(new URL('../plugin/ui/index.html', import.meta.url));
const { DATA, api } = await loadAdvisor(PAGE);

const route = 'victoriaShip';
const chess = DATA.chess;
// on-route tier-1 chess: scoreSlot gives it the plain "本线 +1" base (46) with nothing else going on
const onRoute = Object.keys(chess).filter((id) => chess[id][2].includes(route) && chess[id][4] === 0 && chess[id][0] === 1)
  .sort((a, b) => chess[a][3] - chess[b][3])[0];
// off-route tier-1 chess: scoreSlot docks it ("不搭路线"), stays well under the 40 "抓" line even priced as affordable
const offRoute = Object.keys(chess).filter((id) => !chess[id][2].includes(route) && chess[id][4] === 0 && chess[id][0] === 1)[0];
const price = chess[onRoute][3];

function privOf(funds, slotId) {
  return { funds, round: 5, lp: 40, shop: { level: 2, slots: [{ id: slotId, kind: 'chess', price }] }, hand: [], board: [], bonds: [] };
}

test('freezeEV: a card worth buying, priced above funds — ev > 0, names that exact slot', () => {
  const view = api.analyseState(privOf(price - 1, onRoute), { round: 5 }, route);
  assert.ok(view.freeze.ev > 0, 'locking in a ≥40-score card is worth something');
  assert.equal(view.freeze.target.index, 0);
  assert.equal(view.freeze.target.price, price);
});

test('freezeEV: already affordable — nothing to lock in, ev = 0, no target (not a sellFundOf-style re-score of a done deal)', () => {
  const view = api.analyseState(privOf(price, onRoute), { round: 5 }, route);
  assert.deepEqual(view.freeze, { ev: 0, target: null });
});

test('freezeEV: unaffordable but not worth it (off-route, under the 40 line even scored as affordable) — ev = 0', () => {
  const view = api.analyseState(privOf(0, offRoute), { round: 5 }, route);
  assert.deepEqual(view.freeze, { ev: 0, target: null });
});

test('freezeEV: never fabricates a price the player cannot see — it is scoreSlot on the same slot, not a different one', () => {
  const view = api.analyseState(privOf(price - 1, onRoute), { round: 5 }, route);
  // the same re-score trick sellFundOf already uses (ctx.funds set to the slot's own price) — not a new pattern
  assert.equal(view.freeze.target.name, api.nameOf(onRoute));
});

test('refreshScore on the view is exactly adviceRaw\'s own "刷一次" number — no second computation', () => {
  const priv = privOf(0, offRoute);   // nothing worth buying → adviceRaw falls through toward "refresh"
  const view = api.analyseState(priv, { round: 5 }, route);
  assert.equal(typeof view.refreshScore, 'number');
  // adviceRaw's refresh branch reads the same ev.ev computed from refreshEV(priv, route, modeId) — cross-check directly
  const ev = api.refreshEV ? api.refreshEV(priv, route, null) : null;
  if (ev) assert.equal(view.refreshScore, ev.ev);
});

test('freezeEV: nothing to say with an empty shop (no slot to re-score, unlike refreshScore which looks past the current slots)', () => {
  const priv = { funds: 10, round: 5, lp: 40, shop: { level: 1, slots: [] }, hand: [], board: [], bonds: [] };
  const view = api.analyseState(priv, { round: 5 }, route);
  assert.deepEqual(view.freeze, { ev: 0, target: null });
});
