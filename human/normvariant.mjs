// Own-field leak score of hand-picked variants of a recorded NORMAL-round battle board (advisor/field.mjs normalScore: the
// replay's aligned enemy pick + the engine's 10 most likely picks). Mods: "swap:<benchName>:<boardName>" (the bench
// operator takes the board operator's tile and facing), "add:<benchName>:<r>,<c>:<DIR>", "move:<name>:<r>,<c>", "dir:<name>:<DIR>".
// node normvariant.mjs <game> <replay.json> <posDir> <round> <label=mod;mod> …
import { readFileSync } from 'node:fs';
import { fromJSON } from '../advisor/state.mjs';
import { normalScore, priorFor } from '../advisor/field.mjs';
const [game, replayPath, posDir, roundArg, ...variants] = process.argv.slice(2);
const round = +roundArg, rep = JSON.parse(readFileSync(replayPath, 'utf8'));
const st = fromJSON(readFileSync(`${posDir}/${game}-r${String(round).padStart(2, '0')}-end.json`, 'utf8'));
const prior = priorFor(st, 10), alignedPick = rep.rounds.find(x => x.round === round)?.wave?.chosen?.pick || null;
const nameOf = (ps, p) => ps.gd.chess(p.id)?.name;
function apply(ps, mods) {
  for (const mod of mods) {
    const [kind, a, b, c] = mod.split(':');
    const onBoard = n => [...ps.board].find(([, p]) => p.kind === 'chess' && nameOf(ps, p) === n);
    const inHand = n => ps.hand.findIndex(p => p?.kind === 'chess' && nameOf(ps, p) === n);
    if (kind === 'swap') { const hi = inHand(a), e = onBoard(b); if (hi < 0 || !e) return false; const [key, bp] = e, hp = ps.hand[hi];
      const [r, cc] = key.split(',').map(Number); ps._deployMap = null; ps._deployField = undefined; if (!ps._legal(hp, r, cc)) return false;
      hp.dir = bp.dir; ps.board.set(key, hp); ps.hand[hi] = bp; }
    else if (kind === 'add') { const hi = inHand(a); if (hi < 0) return false; const [r, cc] = b.split(',').map(Number); const hp = ps.hand[hi];
      ps._deployMap = null; ps._deployField = undefined; if (ps.board.has(b) || !ps._legal(hp, r, cc)) return false; hp.dir = c || 'RIGHT'; ps.board.set(b, hp); ps.hand[hi] = null; }
    else if (kind === 'move') { const e = onBoard(a); if (!e) return false; const [key, p] = e; const [r, cc] = b.split(',').map(Number); const other = ps.board.get(b);
      ps._deployMap = null; ps._deployField = undefined; if (!ps._legal(p, r, cc)) return false; ps.board.delete(key); if (other) ps.board.set(key, other); ps.board.set(b, p); }
    else if (kind === 'dir') { const e = onBoard(a); if (!e) return false; e[1].dir = b; }
  }
  ps.recompute();
  return true;
}
for (const v of ['owner=', ...variants]) {
  const [label, spec] = v.split('=');
  const mods = spec ? spec.split(';').filter(Boolean) : [];
  const s = normalScore(st, (m, ps) => apply(ps, mods), { alignedPick, prior });
  console.log(JSON.stringify({ game, round, label, mods, ...(s || { error: 'variant not applicable' }) }));
}
