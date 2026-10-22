// advisor-dev/route-pick.mjs — which saved main line (route.json) the overlay may use. Pure, so it is testable without
// the client or the plugin page (overlay.mjs top-level-loads both).

/**
 * The saved route, only when it was picked in THIS match: `saved` = parsed route.json ({route, match}), `match` =
 * matchKeyOf(the current m.public) from the plugin core, `isCore(id)` = a core bond. A legacy file without `match`
 * (bare id or {route}) is ignored — it is how game 1's pick steered game 2 (2026-10-21) — and so is any pick while the
 * match is unknown. null → the caller falls back to the auto route.
 */
export function routeFor(saved, match, isCore) {
  if (match == null || !saved || typeof saved !== 'object' || saved.match !== match) return null;
  return typeof saved.route === 'string' && isCore(saved.route) ? saved.route : null;
}
