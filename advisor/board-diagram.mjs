// advisor-dev/advisor/board-diagram.mjs — the additional window's board diagram (sprlui_1825): who's where now, and —
// when the lineup check (lineup-live.mjs → advisor/lineup.mjs checkLineup) recommends a change — the tile they
// should move to. lineup-live.mjs's `fragment()` only carries the raw layout (uid/row/col/dir) and a uid→chess-id
// map (it doesn't import the plugin core, see its own header); `nameOf` is injected so this stays a pure function,
// testable without loading the plugin core or starting overlay.mjs's CDP connection.
export function boardDiagramOf(frag, nameOf) {
  const b = frag && frag.board;
  if (!b || !Array.isArray(b.current)) return null;
  const nm = (uid) => { const id = (b.names || {})[uid]; return id ? nameOf(id) : String(uid); };
  const curByUid = new Map(b.current.map((u) => [u.uid, u]));
  const bestByUid = new Map((b.best || []).map((u) => [u.uid, u]));
  const units = b.current.map((u) => {
    const to = bestByUid.get(u.uid);
    const moved = to && (to.row !== u.row || to.col !== u.col || to.dir !== u.dir);
    return { uid: u.uid, name: nm(u.uid), row: u.row, col: u.col, dir: u.dir, to: moved ? { row: to.row, col: to.col, dir: to.dir } : null };
  });
  // 建议里「从手牌加人」的那种 step：best 里有、current 里没有的 uid——没有「现在站哪」，只有「该放哪」
  for (const u of b.best || []) {
    if (curByUid.has(u.uid)) continue;
    units.push({ uid: u.uid, name: nm(u.uid), row: null, col: null, dir: null, to: { row: u.row, col: u.col, dir: u.dir }, added: true });
  }
  return { units };
}
