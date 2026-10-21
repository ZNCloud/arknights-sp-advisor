// One self-play match with a play profile per seat, recorded in the overlay's own record format (matches/*.jsonl):
// rows from seat p0's point of view — its own LP / level / bonds / board count, the teammates through `mates` built by
// the same matesOf() the overlay uses, on the engine's own publicView() — and a RESULT row carrying m.result.
// So advisor/team.mjs reads a self-play match and a real one through one parser.
import { parentPort } from 'node:worker_threads';
import { makeMatch, runToEnd, errorsOf, createRng, deriveSeed } from './engine.mjs';
import { installGuide, guidePrep } from '../guides/policy.mjs';
import { traceBattles, outcomeOf } from '../advisor/rollout.mjs';
import { randomEconomy } from '../advisor/actions.mjs';
import { matesOf, resultOf, teamSpec } from '../advisor/team.mjs';

export function recordRow(m, myId, phase) {
  const pub = m.publicView(), me = pub.players.find((p) => p.playerId === myId), ps = m.players.get(myId);
  return {
    phase, round: m.round, mode: 'selfplay', funds: ps.funds, lp: me.lp, level: me.shopLevel,
    bonds: (me.bonds || []).filter((b) => !b.off).map((b) => `${b.bondId}:${b.count}/${b.layers}`),
    board: [...ps.board.values()].filter((p) => p.kind === 'chess').map((p) => ({ id: p.id })),
    self: { seat: me.seat, name: me.name },
    mates: matesOf(pub.players, myId),
    teamLp: pub.teamLp ?? null, bossHp: pub.bossHp ? { hp: pub.bossHp.hp, max: pub.bossHp.max } : null,
  };
}

/**
 * task: { seed, base: guide spec, seats: { p0: profileId, ... }, profiles: { id: { levelTargets?, eps?, line?, tempo? } },
 *         lines?: 'shuffle' | 'mates', teamProfile?: models/team-profile.json }
 * A profile's guide fields go into spec.seats (guides/policy.mjs seatSpec); `eps` = chance per turn of 1–3 random
 * legal economy actions before the guide plays the turn (a sloppy player); `tempo: 'learned'` = the team profile's
 * learned levelTargets; `line` = p0's line rule in the 'mates' scenario (below).
 */
export function playTeam({ seed, base, seats, profiles, lines = null, teamProfile = null }) {
  const seatOv = {}, eps = {}, lineRule = {};
  for (const [pid, id] of Object.entries(seats)) {
    if (!profiles[id]) throw Error(`unknown profile ${id}`);
    const { eps: e = 0, line = null, tempo = null, ...ov } = profiles[id];
    if (tempo === 'learned') { if (!teamProfile) throw Error(`profile ${id} needs --team`); ov.levelTargets = teamProfile.tempo.learned; }
    if (Object.keys(ov).length) seatOv[pid] = ov;
    eps[pid] = e; lineRule[pid] = line;
  }
  const m = makeMatch(seed, 4), rng = createRng(deriveSeed(seed, 'teamplay'));
  // lines: 'shuffle' = every seat plays a random available core line (line × boss outcomes, learned without the seat
  // order confounding them); 'mates' = the teammates p1–p3 pick random lines of their own (like players who do not
  // coordinate) and p0 decides by its profile's `line` rule: 'blind' = the guide's first-choice line whoever is on it,
  // 'free' = the first-choice line no teammate is on (team view), 'learned' = advisor/team.mjs pickLine (+ team view)
  if (lines) {
    const avail = m.gd.bondIds.filter((b) => m.gd.bond(b).isCore && !m.disabledBonds.includes(b) && !m.staticInactiveBonds.includes(b) && base.recipes[b]);
    const wanted = [...new Set([...base.coreOrder, ...avail])].filter((b) => avail.includes(b));
    const lrng = createRng(deriveSeed(seed, 'teamplay-lines')), deck = avail.slice();
    for (let i = deck.length - 1; i > 0; i--) { const j = lrng.int(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const set = (pid, route) => { seatOv[pid] = { ...(seatOv[pid] || {}), route }; };
    if (lines === 'shuffle') m.order.forEach((ps, i) => { if (deck[i]) set(ps.playerId, deck[i]); });
    else if (lines === 'mates') {
      const mates = {};
      m.order.forEach((ps, i) => { if (ps.playerId !== 'p0' && deck[i]) { set(ps.playerId, deck[i]); mates[ps.playerId] = deck[i]; } });
      const rule = lineRule.p0 || 'blind';
      if (rule === 'blind') set('p0', wanted[0]);
      else {
        const ts = teamSpec({ ...base, seats: seatOv }, m, 'p0', rule === 'learned' ? teamProfile : null, { lines: mates });
        set('p0', ts.seats.p0.route);
      }
    } else throw Error(`unknown lines mode ${lines}`);
  }
  const spec = { ...base, seats: seatOv };
  installGuide(m, spec);
  const battles = traceBattles(m), rows = [];
  m.scheduleBotPrep = function (ps) {
    const round = this.round;
    this.later(0, () => {
      if (this.phase !== 'PREP' || this.round !== round || !ps.alive || ps.ready) return;
      if (eps[ps.playerId] && rng() < eps[ps.playerId]) randomEconomy(this, ps, rng);
      guidePrep(this, ps);
    });
  };
  const end = m.endPrep;
  m.endPrep = function (...a) { rows.push(recordRow(this, 'p0', 'PREP')); return end.apply(this, a); };
  m.start();
  const s = runToEnd(m), errors = errorsOf(m);
  if (errors.match || errors.sim || errors.meta || errors.log.length) { m.dispose(); return { seed, seats, engineError: JSON.stringify(errors).slice(0, 200) }; }
  const outcome = outcomeOf(m, s, battles);
  rows.push({ ...recordRow(m, 'p0', 'RESULT'), result: resultOf(s, m.bossPool ? m.bossPool.maxHp : null) });
  const routes = { ...m.guideTeam.routes };
  m.dispose();
  return { seed, seats, routes, outcome, rows };
}

if (parentPort) parentPort.on('message', (task) => {
  try { parentPort.postMessage({ result: playTeam(task) }); } catch (e) { parentPort.postMessage({ error: `seed ${task.seed}: ${e.stack || e}` }); }
});
