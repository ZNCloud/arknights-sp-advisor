// What the lineup check needs from the running client: the PREP position as the client itself holds it in
// `__SP__.store.get().match` (m.public + m.private, the server's own views — server/match/match/views.js publicView,
// server/match/player/views.js privateView). advisor/live.mjs rebuilds an engine position from it.
//
// lineupViewOf is evaluated INSIDE the client page by the desktop overlay (lineup-live.mjs sends its source text over
// the debugger), so it must stay self-contained: no imports, no closure over module scope. The tests call it directly
// on an engine match's own publicView() / privateView().
export function lineupViewOf(match) {
  const pub = match && match.public, p = match && match.private;
  if (!pub || !p) return null;
  const itemIds = (x) => (Array.isArray(x && x.items) ? x.items : []).map((i) => (i && typeof i === 'object' ? i.id : i)).filter((i) => typeof i === 'string');
  // uid / ownerUid: a summon (token) names its owner by the owner's uid (client uids, only meaningful within this view)
  const piece = (x) => (x && typeof x === 'object' ? { kind: x.kind, id: x.id, uid: x.uid ?? null, ownerUid: x.ownerUid ?? null, count: x.count ?? 1,
    row: x.row ?? null, col: x.col ?? null, dir: x.dir ?? null, items: itemIds(x) } : null);
  const list = (a) => (Array.isArray(a) ? a : []).filter(Boolean).map(piece);
  return {
    phase: pub.phase ?? null,
    round: pub.round ?? null,
    // prep countdown: the server's deadline and its clock when it sent this view (the overlay turns them into local time)
    deadline: typeof pub.deadline === 'number' ? pub.deadline : null,
    serverNow: typeof pub.serverNow === 'number' ? pub.serverNow : null,
    modeId: pub.modeId ?? null,
    difficulty: pub.difficulty ?? null,
    stageId: pub.stageId ?? null,
    bossId: pub.bossId ?? null,
    hiddenBossId: pub.hiddenBossId ?? null,
    factions: Array.isArray(pub.factions) ? pub.factions.slice() : [],
    drawnDisabledBonds: Array.isArray(pub.drawnDisabledBonds) ? pub.drawnDisabledBonds.slice() : [],
    bannedChess: Array.isArray(pub.bannedChess) ? pub.bannedChess.slice() : [],
    me: {
      playerId: p.playerId ?? null,
      alive: p.alive !== false,
      lp: p.lp,
      funds: p.funds,
      bandId: p.bandId ?? null,
      level: p.shop ? p.shop.level : null,
      deployCap: p.deployCap ?? null,
      board: list(p.board),
      hand: list(p.hand),
      temp: list(p.temp),
      bonds: (Array.isArray(p.bonds) ? p.bonds : []).filter(Boolean).map((b) => ({ bondId: b.bondId, count: b.count || 0, layers: typeof b.layers === 'number' ? b.layers : 0 })),
      // the effects column (策略 / 机变 / 悬赏): a bounty is `bounty:<uid>` with its card's effect id (iconId) and the
      // battles it still comes for (counter, null = every later battle); other 机变 effects are reported, not carried
      effects: (Array.isArray(p.effects) ? p.effects : []).filter(Boolean).map((e) => ({ id: e.id, name: e.name || null, kind: e.iconKind || null,
        iconId: e.iconId || null, counter: typeof e.counter === 'number' ? e.counter : null })),
      diy: p.diy && typeof p.diy === 'object' ? Object.keys(p.diy) : [],
      nextEnemies: (Array.isArray(p.nextEnemies) ? p.nextEnemies : []).filter(Boolean).map((e) => ({
        enemyKey: e.enemyKey, count: e.count, gate: e.gate, t: e.t, fly: !!e.fly, elite: !!e.elite, boss: !!e.boss, source: e.source || 'wave' })),
    },
  };
}
