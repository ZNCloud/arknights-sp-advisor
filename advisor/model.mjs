// Evaluator v2: LightGBM value model (dumped JSON trees, trained by advisor/train.py) evaluated in plain JS.
// score(state, playerId, actions): every legal action → apply + finish the turn on a restored copy, features at the
// prep end (the same point datagen records), model prediction. Runs in the rollout pool ('score' jobs).
import { readFileSync } from 'node:fs';

export function loadTrees(path) {
  const d = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(d.tree_info)) throw Error(`${path}: not a LightGBM dump`);
  return { objective: String(d.objective || ''), trees: d.tree_info.map(t => t.tree_structure), nFeatures: d.max_feature_idx + 1 };
}
function leaf(node, x) {
  while (node.leaf_value === undefined) {
    const v = x[node.split_feature];
    if (node.decision_type !== '<=') throw Error(`unsupported split ${node.decision_type}`);
    const missing = v == null || Number.isNaN(v);
    const left = missing ? node.default_left : v <= node.threshold;
    node = left ? node.left_child : node.right_child;
  }
  return node.leaf_value;
}
export function predict(model, x) {
  if (x.length !== model.nFeatures) throw Error(`feature length ${x.length} != model ${model.nFeatures}`);
  let s = 0; for (const t of model.trees) s += leaf(t, x);
  return model.objective.startsWith('binary') ? 1 / (1 + Math.exp(-s)) : s;
}

// One candidate on a restored copy: apply + finish the advised seat's turn, then every other seat's guide prep; the
// features are read inside endPrep, exactly where datagen records its rows.
export async function scoreAction(state, { playerId, action, sampleSeed, spec, models }) {
  const [{ restore }, { installGuide, guidePrep }, { finishTurn }, { seatFeatures }] = await Promise.all([
    import('./state.mjs'), import('../guides/policy.mjs'), import('./rollout.mjs'), import('./features.mjs')]);
  const m = restore(state, { rngMode: 'resample', sampleSeed });
  installGuide(m, spec);
  let x = null;
  const end = m.endPrep;
  m.endPrep = function (...a) { if (!x) x = seatFeatures(this, this.players.get(playerId)); return end.apply(this, a); };
  const ps = m.players.get(playerId), fin = finishTurn(m, ps, action);
  if (!fin.ok) { m.dispose(); return { illegal: true, reply: fin.reply }; }
  for (const p of m.alivePlayers()) if (p !== ps && !p.ready) guidePrep(m, p);
  if (!x) m.sched.runUntil(() => x != null || m.phase !== 'PREP', { maxSteps: 1e5 });
  m.dispose();
  if (!x) throw Error('scoreAction: prep ended without a feature read');
  return { win: predict(models.win, x), util: predict(models.util, x) };
}
