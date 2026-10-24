// Live position: the client's own view of a PREP (advisor/live-view.mjs lineupViewOf) → an engine PREP capture
// (advisor/state.mjs) whose seat p0 is the player, for the lineup check (advisor/lineup.mjs) in the desktop overlay.
//
// The client holds no random state and nothing of the engine's internals, so the position is BUILT, not restored:
//   * scaffoldOf: an engine match (fixed scaffold seed) is set up with the client's stage, R14 / hidden boss, drawn bans
//     and the player's band, and fast-forwarded by the engine bots to the client's round (every seat is kept alive on
//     the way: the bots only carry the match to the round, their play is not part of the position). It depends on the
//     setup and the round only, so the overlay builds it once per round (R14: ~9 s single-threaded);
//   * positionOf: at that round's PREP the seat p0 is forced onto the client's board / hand / items / LP / level / bond
//     counts and layers (human/force.mjs forceSeat, the same forcing the recorded-match replay uses), the board's
//     summons are granted by the engine (grantTokensFor) and the placed ones moved onto the client's tiles; its scaffold
//     effects / bounties (the bot's own picks) are replaced by the client's bounties (the card by its effect id, the
//     battles left by the effects column's counter);
//   * the round's enemy pick (a normal round's wave; a boss round's escorts) is the engine pick whose preview equals the
//     client's nextEnemies preview (the prep preview shows the round's real spawns), and the bounty enemies must preview
//     exactly as the client's; anything that does not match refuses the position — it is never fought against a guess.
// Checked against engine self-play, where the engine's own publicView / privateView play the client
// (advisor/live.test.mjs): same battle scores seed for seed. What is not carried over is returned in `notes` (机变
// effects other than bounties); 自选 seats are refused. Only the seat's own field is meaningful: teammates are scaffold
// bots (the lineup check runs with recheckMetric 'own').
import { makeMatch, createRng } from '../eval/engine.mjs';
import { capture, restore } from './state.mjs';
import { pickPrior, waveOf } from './field.mjs';
import { forceSeat } from '../human/force.mjs';
const W = await import(new URL('../../engine/server/match/waves.js', import.meta.url));
const { SharedPool } = await import(new URL('../../engine/server/match/pool.js', import.meta.url));

const SCAFFOLD_LP = 40;

// The client's seat view → the recorded-row shape forceSeat reads (overlay recordTurn rows: board `at: [row, col]`).
export function seatRowOf(me) {
  const hand = [...me.hand, ...me.temp].filter(p => p && (p.kind === 'chess' || p.kind === 'item')).map(p => p.id);
  return {
    lp: me.lp, funds: me.funds, level: me.level,
    board: me.board.filter(p => p.kind === 'chess').map(p => ({ id: p.id, at: [p.row, p.col], dir: p.dir || 'RIGHT', items: p.items.map(id => ({ id })) })),
    hand,
    bonds: me.bonds.filter(b => b.count > 0 || b.layers > 0).map(b => `${b.bondId}:${b.count}/${b.layers}`),
  };
}

// Preview entries of one source ('wave': the round's shared enemies; 'bounty': the seat's own adds), leaders excluded.
const previewKey = (list, source) => list.filter(e => (e.source || 'wave') === source && !e.boss)
  .map(e => `${e.enemyKey}x${e.count}@${Math.round(Number(e.t) * 100)}${e.fly ? 'F' : ''}${e.elite ? 'E' : ''}${e.gate === 'upper' ? 'U' : ''}`).join('|');

// The factions array the engine reads a round's pick from (setupMatchWaves: the schedule rides on it, non-enumerable).
function factionsWith(factions, round, pick) {
  const f = [...factions];
  Object.defineProperty(f, 'schedule', { value: { picks: Object.assign([], { [round]: pick }) }, enumerable: false });
  return f;
}
// The spawns a pick makes this round: the normal wave, or a boss round's solo and pair templates (which one the client
// fights depends on its pairing; the escorts follow the pick either way).
function spawnsOf(m, pick) {
  const gd = m.gd;
  if (m.round !== gd.bossRound && m.round !== gd.hiddenRound) return [waveOf(m, pick).spawns];
  const bossId = m.round === gd.hiddenRound ? m.hiddenBossId : m.bossId;
  return [true, false].map(solo => W.buildBossWave(gd, createRng(1), factionsWith(m.factions, m.round, pick), m.round, { bossId, solo }).spawns);
}
// The engine pick of this round whose preview is the client's: the engine's prior over the round's picks (field.mjs
// pickPrior), a wider sample when the common picks miss. Returns { pick, matches, sample } or null.
export function pickFromPreview(m, preview) {
  const want = previewKey(preview, 'wave');
  for (const n of [400, 4000]) {
    const hits = pickPrior(m.gd, m.round, n).filter(c => spawnsOf(m, c.pick).some(s => previewKey(W.previewOf(s), 'wave') === want));
    if (hits.length) return { pick: hits[0].pick, matches: hits.length, sample: n };
  }
  return null;
}

// Summons: every board owner gets its stacks from the engine (grantTokensFor, as at a round start); a summon the client
// shows on the board is moved there from its owner's stack through the engine's move handler. The owner is found by
// tile (client uid → client tile → the engine piece forceSeat put on that tile).
function placeTokens(ps, me) {
  for (const p of [...ps.board.values()]) if (p.kind === 'chess') ps.grantTokensFor(p);
  const tileOf = new Map(me.board.filter(p => p.kind === 'chess').map(p => [p.uid, `${p.row},${p.col}`]));
  for (const t of me.board.filter(p => p.kind === 'token')) {
    const owner = ps.board.get(tileOf.get(t.ownerUid));
    if (!owner) throw Error(`live position: summon ${t.id} at ${t.row},${t.col} has no owner on the board`);
    const stack = [...ps.hand, ...ps.temp].find(x => x && x.kind === 'token' && x.ownerUid === owner.uid && x.id === t.id);
    if (!stack) throw Error(`live position: the engine grants ${owner.id} no ${t.id} to place at ${t.row},${t.col}`);
    const r = ps.move(stack.uid, { area: 'board', row: t.row, col: t.col }, t.dir || 'RIGHT');
    if (!r?.ok) throw Error(`live position: the engine refused summon ${t.id} at ${t.row},${t.col}: ${JSON.stringify(r)}`);
  }
}

// What the scaffold depends on: two views with the same key share it.
export const scaffoldKey = v => JSON.stringify([v.modeId, v.difficulty, v.stageId, v.bossId, v.hiddenBossId, v.drawnDisabledBonds, v.bannedChess,
  v.factions, v.me.bandId, v.round]);

// The scaffold match at the view's round PREP (p0 not forced yet), as a capture. Throws when the engine cannot set the
// client's match up or does not reach the round.
export function scaffoldOf(v, { seed = 1 } = {}) {
  if (!v || v.phase !== 'PREP') throw Error(`live position needs the PREP phase, got ${v?.phase}`);
  const m = makeMatch(seed, 4);
  try {
    const gd = m.gd;
    if (m.modeId !== v.modeId || m.difficulty !== v.difficulty) throw Error(`live position: the engine plays ${m.modeId}/${m.difficulty}, the client ${v.modeId}/${v.difficulty}`);
    if (!gd.stage(v.stageId)) throw Error(`live position: stage ${v.stageId} is not in the engine data`);
    for (const b of [v.bossId, v.hiddenBossId]) if (b && !gd.boss(b)) throw Error(`live position: boss ${b} is not in the engine data`);
    if (v.me.bandId && !gd.band(v.me.bandId)) throw Error(`live position: band ${v.me.bandId} is not in the engine data`);
    if (!(v.round >= 1 && v.round <= Math.max(gd.lastRound, gd.hiddenRound || 0))) throw Error(`live position: round ${v.round}`);
    // the client's setup (the Match constructor drew its own: replaced before the match starts)
    m.stageId = v.stageId; m.stage = gd.stage(v.stageId);
    if (v.bossId) m.bossId = v.bossId;
    if (v.hiddenBossId) m.hiddenBossId = v.hiddenBossId;
    m.disabledBonds = v.drawnDisabledBonds.filter(b => gd.bond(b));
    m.bannedChess = v.bannedChess.filter(c => gd.chess(c));
    m.pool = new SharedPool(gd, { banned: m.bannedChess });
    const band = v.me.bandId;
    if (band) {
      const bt = m.bandTaken.bind(m); m.bandTaken = (b, pid) => (b === band && pid !== 'p0') ? true : bt(b, pid);
      const ab = m._applyBand.bind(m); m._applyBand = (ps, id, o) => ab(ps, ps.playerId === 'p0' ? band : id, o);
    }
    // bots carry the match to the round; p0 sits out the round's own prep
    const sb = m.scheduleBotPrep;
    m.scheduleBotPrep = function (ps, i) {
      for (const p of this.order) if (p.alive && p.lp < SCAFFOLD_LP) p.lp = SCAFFOLD_LP;
      if (ps.playerId === 'p0' && this.round === v.round) { this._livePrep = ps; return; }
      return sb.call(this, ps, i);
    };
    m.start();
    if (v.round === gd.hiddenRound) {
      // the client is in the Hidden Core, so its team won R14 and passed the hidden threshold; scaffold bots rarely do.
      // From R14's prep the scaffold enters R15 the way the engine does once eligible (bossRounds.js: hiddenReached,
      // the boss pool dropped, startRound(hiddenRound)) — R14's own battle is not part of the position.
      m.sched.runUntil(() => (m.round === gd.bossRound && m.phase === 'PREP' && m.alivePlayers().every(p => p.ready)) || m.phase === 'RESULT', { maxSteps: 5e7 });
      if (m.round !== gd.bossRound || m.phase !== 'PREP') throw Error(`live position: the scaffold match did not reach R${gd.bossRound} PREP (at R${m.round} ${m.phase})`);
      m.hiddenReached = true; m.bossPool = null; m.startRound(gd.hiddenRound);
    }
    m.sched.runUntil(() => (m._livePrep && m.phase === 'PREP') || m.phase === 'RESULT' || m.round > v.round, { maxSteps: 5e7 });
    if (!m._livePrep || m.phase !== 'PREP' || m.round !== v.round) throw Error(`live position: the scaffold match did not reach R${v.round} PREP (at R${m.round} ${m.phase})`);
    const ps = m._livePrep;
    if (band && ps.bandId !== band) throw Error(`live position: band ${band} not applied (seat has ${ps.bandId})`);
    // teammates finish their prep (queued bot callbacks)
    m.sched.runUntil(() => m.alivePlayers().every(p => p === ps || p.ready) || m.phase !== 'PREP', { maxSteps: 5e7 });
    if (m.phase !== 'PREP') throw Error(`live position: prep ended while the scaffold teammates prepared (R${m.round} ${m.phase})`);
    return capture(m);
  } finally { m.dispose(); }
}

// The position: the scaffold with p0 forced onto the client's seat and the round's enemies matched to its preview.
export function positionOf(v, { scaffold = null, seed = 1 } = {}) {
  if (!v || v.phase !== 'PREP') throw Error(`live position needs the PREP phase, got ${v?.phase}`);
  if (!v.me.alive) throw Error('live position: the player is eliminated');
  if (v.me.diy.length) throw Error(`live position: 自选编队 seats are not supported by the engine position (${v.me.diy.join(',')})`);
  scaffold ??= scaffoldOf(v, { seed });
  const notes = [];
  const m = restore(scaffold, { rngMode: 'exact' });
  try {
    const gd = m.gd, ps = m.players.get('p0');
    if (m.round !== v.round) throw Error(`live position: scaffold is R${m.round}, the client R${v.round}`);
    for (const [i, p] of m.order.entries()) if (p !== ps) p.ready = scaffold.seats[i].ready;   // restore() un-readies every seat
    // the bot's own picks on the way are not the player's
    ps.effects = []; ps.bounties = []; ps.personalChoice = null; ps.offers = [];
    const f = forceSeat(m, ps, seatRowOf(v.me), { shop: false, funds: true, lp: true });
    notes.push(...f.notes);
    if (Object.keys(f.bondFix).length) notes.push(`bond counts aligned to the client: ${JSON.stringify(f.bondFix)}`);
    placeTokens(ps, v.me);
    const cards = Array.isArray(gd.choices.cards?.bounty) ? gd.choices.cards.bounty : [];
    for (const e of v.me.effects.filter(x => String(x.id).startsWith('bounty:'))) {
      const card = cards.find(c => c.effectId === e.iconId);
      if (!card) throw Error(`live position: bounty card ${e.iconId} (${e.name}) is not in the engine data`);
      if (!m.addBounty(ps, card)) throw Error(`live position: the engine refused bounty card ${e.iconId}`);
      if (e.counter != null) ps.bounties.at(-1).roundsLeft = e.counter;
    }
    const others = v.me.effects.filter(e => e.kind !== 'band' && !String(e.id).startsWith('bounty:'));
    if (others.length) notes.push(`not carried over: ${others.length} 机变 effect(s) (${others.map(e => e.name || e.id).join('、')})`);
    const hit = pickFromPreview(m, v.me.nextEnemies);
    if (!hit) throw Error(`live position: no engine pick of R${m.round} previews as the client's enemies (${previewKey(v.me.nextEnemies, 'wave').slice(0, 160)})`);
    if (hit.matches > 1) notes.push(`${hit.matches} engine picks share the preview; took the most common`);
    m.factions = factionsWith(v.factions?.length ? v.factions : m.factions, m.round, hit.pick);
    if (m.round !== gd.bossRound && m.round !== gd.hiddenRound) m.wave = waveOf(m, hit.pick);
    const bountyPreview = previewKey(m.nextEnemiesFor(ps), 'bounty'), clientBounty = previewKey(v.me.nextEnemies, 'bounty');
    if (bountyPreview !== clientBounty) throw Error(`live position: the rebuilt bounty enemies (${bountyPreview || 'none'}) differ from the client's (${clientBounty || 'none'})`);
    return { st: capture(m), notes };
  } finally { m.dispose(); }
}
