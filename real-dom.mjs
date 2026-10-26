// advisor-dev/real-dom.mjs — the shop/refresh/freeze weight badges (sprlui_1825): painted on top of the real
// client's own shop bar (engine/public/js/ui/shopBar.js: `.scard[data-shop-slot]` operator/item cards,
// `.toolbtn--amber` refresh, `.toolbtn--ice` freeze), positioned from each card's live getBoundingClientRect().
//
// Why a separate fixed-position layer instead of appending into the real cards: the shop bar is a Preact tree
// that re-renders on every state push (preact.module.js diffing). A node appended straight inside a `.scard`
// button is not one of Preact's own vnodes, and a future re-render of that button can silently drop it. A sibling
// overlay that no Preact tree ever owns survives every re-render untouched — and this module never writes a
// class, attribute or style onto `.scard`, `.toolbtn--amber` or `.toolbtn--ice` themselves, so the real cards stay
// exactly what Preact put there (the client is only read: getBoundingClientRect, never mutated).
//
// plan = null (overlay.mjs --no-badges / --g06) → clearOverlay: every badge removed, no trace left in the DOM.
// plan = { slots: [{index, score}], top: index|null, refresh: number, freeze: number } (overlay.mjs boxOf → box.badge)
const ROOT_ID = 'sp-adv-badges';

function rootOf(doc) {
  let root = doc.getElementById(ROOT_ID);
  if (root) return root;
  root = doc.createElement('div');
  root.id = ROOT_ID;
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:999999;';
  doc.body.appendChild(root);
  return root;
}

function paint(doc, root, key, rect, text, top) {
  let el = root.querySelector(`[data-sp-adv-badge="${key}"]`);
  if (!rect) { el?.remove(); return; }
  if (!el) {
    el = doc.createElement('span');
    el.dataset.spAdvBadge = key;
    el.style.cssText = 'position:fixed;font:700 11px/1.3 monospace;padding:1px 4px;border-radius:3px;color:#101a1a;white-space:nowrap;';
    root.appendChild(el);
  }
  el.style.left = `${Math.round(rect.right - 4)}px`;
  el.style.top = `${Math.round(rect.top - 4)}px`;
  el.style.transform = 'translate(-100%, 0)';
  el.style.background = top ? '#7fe0bf' : '#d8c79a';
  el.textContent = top ? `买★${text}` : String(text);
}

/** Remove every badge and the overlay root: the real page is left exactly as the client itself rendered it. */
export function clearOverlay(doc) {
  doc.getElementById(ROOT_ID)?.remove();
}

/** One tick: `plan` from overlay.mjs's box.badge, or null to clear (the toggle is off). */
export function applyOverlay(doc, plan) {
  if (!plan) { clearOverlay(doc); return; }
  const root = rootOf(doc);
  const seen = new Set();
  const bySlot = new Map((plan.slots || []).map((s) => [s.index, s]));
  doc.querySelectorAll('.scard[data-shop-slot]').forEach((card) => {
    const idx = Number(card.dataset.shopSlot);
    const s = bySlot.get(idx);
    if (!s) return;
    const key = `slot:${idx}`;
    seen.add(key);
    paint(doc, root, key, card.getBoundingClientRect(), s.score, idx === plan.top);
  });
  const amber = doc.querySelector('.toolbtn--amber');
  if (amber && plan.refresh != null) { seen.add('refresh'); paint(doc, root, 'refresh', amber.getBoundingClientRect(), plan.refresh, false); }
  const ice = doc.querySelector('.toolbtn--ice');
  if (ice && plan.freeze != null) { seen.add('freeze'); paint(doc, root, 'freeze', ice.getBoundingClientRect(), plan.freeze, false); }
  // stale badges: a slot that was here last tick and is gone now (sold / rerolled) — don't leave a dead label
  root.querySelectorAll('[data-sp-adv-badge]').forEach((el) => { if (!seen.has(el.dataset.spAdvBadge)) el.remove(); });
}

/**
 * Source text for cdp.evaluate (overlay.mjs has no bundler reach into the live page, so the three functions above
 * are re-declared inline here — `PLAN` is substituted by the caller before sending). Self-contained on purpose:
 * `applyOverlay.toString()` alone would reference `rootOf`/`paint` as free variables and throw in the page.
 */
export function injectSrc(plan) {
  return `(function(){
    const ROOT_ID = ${JSON.stringify(ROOT_ID)};
    ${rootOf.toString()}
    ${paint.toString()}
    ${clearOverlay.toString()}
    ${applyOverlay.toString()}
    return applyOverlay(document, ${JSON.stringify(plan)});
  })()`;
}
