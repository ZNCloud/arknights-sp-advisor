// The distilled student in plain JS (same idea as advisor/model.mjs evaluating LightGBM dumps): the JSON written by
// distill/train.py (export_student) → forward pass → a p0 decision for eval/seat-driver.mjs playSeat.
// Only the MLP runs here; a transformer student is refused loudly (train/evaluate it in Python until it is ported).
import { readFileSync } from 'node:fs';
import { listActions } from '../advisor/actions.mjs';
import { VOCAB, GUIDE, legalByIndex } from './vocab.mjs';
import { studentFeatures, studentNames, FEATURE_VERSION } from './features.mjs';

export function loadStudent(path) {
  const s = JSON.parse(readFileSync(path, 'utf8'));
  if (s.format !== 'sp-distill-student/1') throw Error(`${path}: not a distilled student (format ${s.format})`);
  if (s.arch !== 'mlp') throw Error(`${path}: arch ${s.arch} has no JS forward pass (only mlp)`);
  if (s.featureVersion !== FEATURE_VERSION) throw Error(`${path}: feature version ${s.featureVersion} != ${FEATURE_VERSION}`);
  if (JSON.stringify(s.vocab) !== JSON.stringify(VOCAB)) throw Error(`${path}: action vocabulary differs from distill/vocab.mjs`);
  // the exporter's own outputs on a few rows: this forward pass must reproduce them (float32 vs float64 → 1e-3)
  s.check.x.forEach((x, i) => {
    const q = forward(s, x).q, d = Math.max(...q.map((v, j) => Math.abs(v - s.check.q[i][j])));
    if (!(d < 1e-3)) throw Error(`${path}: JS forward pass differs from PyTorch by ${d} on check row ${i}`);
  });
  return s;
}
const dense = (L, x) => L.W.map((row, o) => row.reduce((acc, w, i) => acc + w * x[i], L.b[o]));
const relu = v => v.map(x => (x > 0 ? x : 0));
export function forward(s, x) {
  if (x.length !== s.norm.mean.length) throw Error(`student input ${x.length} != ${s.norm.mean.length}`);
  const c = s.norm.clip;   // same standardise-and-clip as distill/train.py normalize()
  let h = x.map((v, i) => Math.max(-c, Math.min(c, (v - s.norm.mean[i]) / s.norm.std[i])));
  for (const L of s.trunk) h = relu(dense(L, h));
  return { q: dense(s.heads.q, h), line: dense(s.heads.line, h), value: dense(s.heads.value, h)[0] };
}
// Best legal vocab action by predicted utility; deviate from the guide only when it beats the guide by `margin`
// (the advisor's model-only rule, eval/seat-driver.mjs choose).
export function studentPick(s, m, ps, { margin = .05 } = {}) {
  if (studentNames(m.gd).names.length !== s.norm.mean.length) throw Error('student trained on another feature layout');
  const t0 = performance.now(), { q } = forward(s, studentFeatures(m, ps)), legal = legalByIndex(listActions(m, ps));
  let best = GUIDE;
  for (const i of legal.keys()) if (q[i] > q[best]) best = i;
  const deviated = best !== GUIDE && q[best] > q[GUIDE] + margin;
  return { action: deviated ? legal.get(best) : { type: 'guide' }, deviated, best, q, ms: performance.now() - t0 };
}
export function studentDecide(s, opts = {}) {
  return async (m, ps, step) => {
    const p = studentPick(s, m, ps, opts);
    return { action: p.action, deviated: p.deviated, record: { round: m.round, step, deviated: p.deviated, label: p.deviated ? p.action.label : '按guide',
      best: VOCAB[p.best], qBest: +p.q[p.best].toFixed(4), qGuide: +p.q[GUIDE].toFixed(4), ms: +p.ms.toFixed(2) } };
  };
}
