import { parentPort } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { layoutSearch, itemAlt } from './fieldsearch.mjs';
import { loadGame } from './replay.mjs';
const reps = new Map(), games = new Map();
const rep = p => (reps.has(p) || reps.set(p, JSON.parse(readFileSync(p, 'utf8'))), reps.get(p));
const game = g => (games.has(g) || games.set(g, loadGame(g)), games.get(g));
parentPort.on('message', (t) => {
  try {
    const r = rep(t.replayPath);
    if (t.kind === 'layout') parentPort.postMessage({ result: { task: t, ...layoutSearch({ ...t, rep: r }) } });
    else if (t.kind === 'item') {
      const G = game(t.game), rounds = G.rounds.filter(x => x.round >= t.round && x.end && !x.end.inferred);
      parentPort.postMessage({ result: { task: t, rounds: itemAlt({ ...t, rep: r, rounds }) } });
    } else throw Error(`unknown task ${t.kind}`);
  } catch (e) { parentPort.postMessage({ error: `${t.kind} ${t.game} R${t.round} ${t.toBase ?? ''}: ${e.stack || e}` }); }
});
