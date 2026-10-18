// advisor-dev/lab/sweep.mjs — 在真实引擎上做「运营节奏」参数搜索，用胜率当唯一裁判。
//
//   node advisor-dev/lab/sweep.mjs --mode solo --seeds 6
//   node advisor-dev/lab/sweep.mjs --mode multi --seeds 6 --difficulty ABYSS
//
// 每个 arm 就是一组 SP_LAB_* 环境变量；调用 tools/matchrun.mjs（真实 Match + bot.js），
// 解析「wins X/N / rounds passed / distribution」，最后按 胜场 → 回合数 排序。
//
// 注意：这里的胜率是「这个引擎 + bot 策略 + 这套规则」下的胜率，不是对真人的胜率。

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..', 'Stronghold-Protocol');

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const mode = flag('--mode', 'solo');
const seeds = Number(flag('--seeds', '6'));
const difficulty = flag('--difficulty', 'ABYSS');
const rehearsal = flag('--rehearsal', '0');
const lpArg = flag('--lp', '');
const extra = lpArg ? ['--lp', lpArg] : [];

const BASE_LEVEL = [1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 6, 6, 6, 6];

/** 一组假设 */
const ARMS = [
  { name: 'baseline', env: {} },
  { name: 'commit@5', env: { SP_LAB_COMMIT: '1', SP_LAB_COMMIT_FROM: '5', SP_LAB_COMMIT_PEN: '12', SP_LAB_COMMIT_W: '8', SP_LAB_MERGE_BONUS: '120', SP_LAB_MAX_PAIRS: '10', SP_LAB_BENCH_BUDGET: '12' } },
  { name: 'commit@7', env: { SP_LAB_COMMIT: '1', SP_LAB_COMMIT_FROM: '7', SP_LAB_COMMIT_PEN: '12', SP_LAB_COMMIT_W: '8', SP_LAB_MERGE_BONUS: '120', SP_LAB_MAX_PAIRS: '10', SP_LAB_BENCH_BUDGET: '12' } },
  { name: 'commit@9', env: { SP_LAB_COMMIT: '1', SP_LAB_COMMIT_FROM: '9', SP_LAB_COMMIT_PEN: '12', SP_LAB_COMMIT_W: '8', SP_LAB_MERGE_BONUS: '120', SP_LAB_MAX_PAIRS: '10', SP_LAB_BENCH_BUDGET: '12' } },
  { name: 'commit@7+快升级', env: { SP_LAB_COMMIT: '1', SP_LAB_COMMIT_FROM: '7', SP_LAB_COMMIT_PEN: '12', SP_LAB_COMMIT_W: '8', SP_LAB_MERGE_BONUS: '120', SP_LAB_MAX_PAIRS: '10', SP_LAB_BENCH_BUDGET: '12', SP_LAB_LEVEL_TARGET: JSON.stringify([1,1,2,2,3,3,4,4,4,5,5,6,6,6,6,6]) } },
];

function runArm(arm) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      path.join(repo, 'tools', 'matchrun.mjs'),
      '--mode', mode, '--difficulty', difficulty, '--seeds', String(seeds), '--rehearsal', rehearsal, ...extra,
    ], { cwd: repo, env: { ...process.env, ...arm.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', () => {
      const wins = out.match(/wins (\d+)\/(\d+)/);
      const rounds = out.match(/rounds passed: avg ([\d.]+)/);
      const dist = out.match(/distribution: (.+)/);
      resolve({
        name: arm.name,
        wins: wins ? Number(wins[1]) : 0,
        n: wins ? Number(wins[2]) : seeds,
        avgRounds: rounds ? Number(rounds[1]) : 0,
        dist: dist ? dist[1].trim() : '',
        env: arm.env,
      });
    });
  });
}

console.log(`难度 ${difficulty} · 模式 ${mode} · 每臂 ${seeds} 种子 · rehearsal=${rehearsal}`);
console.log('臂名            胜/总数   平均回合   回合分布');
const results = [];
for (const arm of ARMS) {
  const r = await runArm(arm);
  results.push(r);
  console.log(`${r.name.padEnd(16)} ${String(r.wins).padStart(2)}/${String(r.n).padEnd(3)}  ${String(r.avgRounds).padStart(6)}    ${r.dist}`);
}

results.sort((a, b) => b.wins - a.wins || b.avgRounds - a.avgRounds);
const best = results[0];
console.log(`\n最优：${best.name}（${best.wins}/${best.n}，平均 ${best.avgRounds} 回合）`);
console.log(`  env: ${JSON.stringify(best.env)}`);
