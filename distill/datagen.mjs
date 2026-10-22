// Distillation data: p0 plays by a teacher/student mixture (DAgger: with probability beta the teacher's choice, else the
// student's), and at EVERY p0 decision the advisor (the teacher) labels the position — so the student also learns on
// positions its own play reaches. Every other seat and the rest of p0's turn play the guide (eval/seat-driver.mjs).
//   node sp-advisor/distill/datagen.mjs --seeds 100001-100040 --out <dir>/iter0.jsonl --teacher model --model sp-advisor/models
//        [--student <student.json> --beta 0.5] [--iter 0] [--K 8 --N 6 --N2 6] [--team sp-advisor/models/team-profile.json]
//        [--steps 2 --workers 16 --concurrent 8 --guide guides/g06_final.json]
// Teachers: `model` = value-model scores for every legal action (advise N=0, ~seconds); `rollout` = the full rollout
// advisor (advise with rollouts, 12–53 s per position on 16 threads) — soft labels for its top-K candidates only.
// One JSON row per decision (x, legal vocab slots, teacher utilities u, teacher pick, team line) + <out>.games.jsonl with
// one row per finished game; a rerun skips finished seeds (resumable) and drops rows of unfinished games.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, deriveSeed, makeMatch } from '../eval/engine.mjs';
import { capture, restore } from '../advisor/state.mjs';
import { advise, modelScorer } from '../advisor/advise.mjs';
import { RolloutPool } from '../advisor/pool.mjs';
import { listActions } from '../advisor/actions.mjs';
import { teamSpec } from '../advisor/team.mjs';
import { dataHash, codeHash } from '../eval/version.mjs';
import { playSeat, choose } from '../eval/seat-driver.mjs';
import { VOCAB, GUIDE, vocabIndex, legalByIndex } from './vocab.mjs';
import { studentFeatures, studentNames, lineIds, FEATURE_VERSION } from './features.mjs';
import { loadStudent, studentPick } from './student.mjs';

// Seed ranges already used for training or evaluation elsewhere (spfull 5001–5200 = the fixed 150/200-seed eval,
// spmate 2001–2050 / 3001–3800 evals, 60001–61200 team-profile training, 50000+ value-model self-play): never generate here.
export const RESERVED = [[2001, 2050], [3001, 3800], [5001, 5200], [50000, 61200]];
export function parseSeeds(s) {
  return s.split(',').flatMap(r => { const [a, b] = r.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
}
export function checkSeeds(seeds) {
  const bad = seeds.filter(x => RESERVED.some(([a, b]) => x >= a && x <= b));
  if (bad.length) throw Error(`seeds overlap reserved eval/training ranges ${JSON.stringify(RESERVED)}: ${bad.slice(0, 5).join(',')}${bad.length > 5 ? '…' : ''}`);
}

const r3 = v => v.map(x => Math.round(x * 1000) / 1000);
const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) { if (!args[i].startsWith('--')) throw Error('Expected --flag'); opt[args[i].slice(2)] = args[++i]; }
// only run when executed directly: the tests import checkSeeds / parseSeeds
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

async function main() {
  if (!opt.seeds || !opt.out) throw Error('--seeds and --out are required');
  const seeds = parseSeeds(opt.seeds); checkSeeds(seeds);
  const spec = JSON.parse(readFileSync(opt.guide || 'guides/g06_final.json', 'utf8'));
  const teacher = opt.teacher || 'model', beta = +(opt.beta ?? 1), iter = +(opt.iter || 0);
  if (!['model', 'rollout'].includes(teacher)) throw Error(`--teacher model|rollout, got ${teacher}`);
  if (teacher === 'model' && !opt.model) throw Error('--teacher model needs --model <value-model dir>');
  if (beta < 1 && !opt.student) throw Error('--beta < 1 needs --student (DAgger: the student plays part of the steps)');
  const cfg = { K: +(opt.K || (teacher === 'model' ? 999 : 8)), N: teacher === 'model' ? 0 : +(opt.N ?? 6), N2: teacher === 'model' ? 0 : +(opt.N2 ?? 6),
    steps: +(opt.steps ?? 2), z: +(opt.z ?? 1), margin: +(opt.margin ?? .05) };
  const profile = opt.team ? JSON.parse(readFileSync(opt.team, 'utf8')) : null;
  const student = opt.student ? loadStudent(opt.student) : null;
  const out = opt.out, gamesFile = `${out}.games.jsonl`;
  mkdirSync(dirname(out), { recursive: true });
  // resume: keep the rows of finished games only
  const done = new Set(existsSync(gamesFile) ? readFileSync(gamesFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).seed) : []);
  if (existsSync(out)) writeFileSync(out, readFileSync(out, 'utf8').split('\n').filter(l => l && done.has(JSON.parse(l).seed)).map(l => l + '\n').join(''));
  const m1 = makeMatch(1, 4), layout = { featureNames: studentNames(m1.gd).names, lines: lineIds(m1.gd, spec) }; m1.dispose();
  writeFileSync(`${out}.meta.json`, JSON.stringify({ ...dataHash(), codeHash: codeHash(), featureVersion: FEATURE_VERSION, vocab: VOCAB, teacher, cfg, beta, iter,
    student: opt.student || null, team: opt.team || null, model: opt.model || null, guide: spec.id, seeds: opt.seeds, createdAt: new Date().toISOString(),
    // layout for the Python side (distill/model.py groups unit slots into tokens by these names)
    ...layout }, null, 1));
  const todo = seeds.filter(s => !done.has(s));
  const pool = new RolloutPool(+(opt.workers || 16)), scorer = teacher === 'model' ? modelScorer({ pool, spec, modelDir: opt.model }) : null;
  const stats = { games: 0, rows: 0, dropped: 0, outOfVocabPicks: 0, studentSteps: 0, wins: 0 }, t0 = Date.now();
  let names = null;

  async function game(seed) {
    const rows = [], rng = createRng(deriveSeed(seed, `dagger:${iter}`));
    const decide = async (m, ps, step) => {
      names ||= studentNames(m.gd);
      const st = capture(m), x = studentFeatures(m, ps), legal = [...legalByIndex(listActions(m, ps)).keys()].sort((a, b) => a - b);
      const res = await advise(st, { playerId: 'p0', spec, pool, K: cfg.K, N: cfg.N, N2: cfg.N2, seed: seed * 100 + m.round * 7 + step, scorer, team: profile ? { profile } : null });
      const teach = choose(res, cfg.z, cfg.margin), u = {};
      for (const c of res.candidates) {
        const i = vocabIndex(c.action), val = teacher === 'model' ? c.modelUtil : c.utility;
        if (i >= 0 && !(i in u) && Number.isFinite(val)) u[i] = Math.round(val * 1e4) / 1e4;
      }
      const pick = teach.deviated ? vocabIndex(teach.action) : GUIDE;
      if (pick < 0) stats.outOfVocabPicks++;
      // the line the team-aware advisor steers this seat to (advisor/team.mjs teamSpec → pickLine / observed line)
      const lines = lineIds(m.gd, spec), m0 = restore(st, { rngMode: 'exact' }), line = teamSpec(spec, m0, 'p0', profile).seats.p0?.route ?? null;
      const lineAvail = lines.map((l, i) => (!m0.disabledBonds.includes(l) && !m0.staticInactiveBonds.includes(l) ? i : -1)).filter(i => i >= 0);
      m0.dispose();
      const actor = student && rng() >= beta ? 'student' : 'teacher';
      const act = actor === 'student' ? studentPick(student, m, ps, { margin: cfg.margin }) : teach;
      if (actor === 'student') stats.studentSteps++;
      rows.push({ seed, round: m.round, step, iter, actor, teacher, x: r3(x), legal, u, pick, line: line ? lines.indexOf(line) : -1, lineAvail });
      return { action: act.action, deviated: act.deviated, record: { round: m.round, step, actor, deviated: act.deviated, label: act.deviated ? act.action.label : '按guide' } };
    };
    const o = await playSeat(seed, { spec, steps: cfg.steps, decide });
    const e = o.engineErrors;
    if (e.match || e.sim || e.meta || e.log.length) { stats.dropped++; console.log(`seed ${seed}: dropped (engine error) ${JSON.stringify(e).slice(0, 200)}`); return; }
    for (const r of rows) Object.assign(r, { z: o.utility, win: o.win ? 1 : 0, lastRound: o.lastRound });
    appendFileSync(out, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
    appendFileSync(gamesFile, JSON.stringify({ seed, rows: rows.length, win: o.win, utility: o.utility, lastRound: o.lastRound, studentSteps: rows.filter(r => r.actor === 'student').length }) + '\n');
    stats.games++; stats.rows += rows.length; if (o.win) stats.wins++;
    console.log(`datagen ${stats.games}/${todo.length} seed ${seed} rows=${rows.length} U=${o.utility.toFixed(3)} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  // bounded number of games in flight (each holds a live match in this thread)
  const queue = [...todo];
  await Promise.all(Array.from({ length: Math.min(+(opt.concurrent || 8), queue.length) }, async () => { while (queue.length) await game(queue.shift()); }));
  await pool.close();
  console.log(JSON.stringify({ datagen: { ...stats, skippedDone: done.size, featureDims: names?.names.length ?? null, wallSec: (Date.now() - t0) / 1000 } }));
}
