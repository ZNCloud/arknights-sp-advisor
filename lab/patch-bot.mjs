// advisor-dev/lab/patch-bot.mjs — 给 server/match/bot.js 的「运营节奏常数」加环境变量开关（幂等）。
//
//   node advisor-dev/lab/patch-bot.mjs
//
// 只改这几个数字的来源，不改任何逻辑：默认值原样保留，环境变量存在时覆盖。
// 这样参数搜索可以跑真实引擎，而不用 fork 一份 bot。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const botPath = path.join(here, '..', '..', 'Stronghold-Protocol', 'server', 'match', 'bot.js');
const MARK = '/* SP_LAB_KNOBS */';

/** 常数名 → 环境变量名 */
const KNOBS = {
  LEVEL_TARGET: 'SP_LAB_LEVEL_TARGET',   // JSON 数组，index = 回合
  MAX_REFRESHES: 'SP_LAB_MAX_REFRESHES',
  MAX_PAIRS: 'SP_LAB_MAX_PAIRS',
  BENCH_BUDGET: 'SP_LAB_BENCH_BUDGET',
  BUY_FULL_MIN: 'SP_LAB_BUY_FULL_MIN',
  MERGE_HIT: 'SP_LAB_MERGE_HIT',
  PAIR_HIT: 'SP_LAB_PAIR_HIT',
  FOCUS_MEMBER: 'SP_LAB_FOCUS_MEMBER',
  ARMOR_WEIGHT: 'SP_LAB_ARMOR_WEIGHT',
};

let src = await fs.readFile(botPath, 'utf8');
if (src.includes(MARK)) {
  console.log('已打过补丁，跳过');
  process.exit(0);
}

let changed = 0;
for (const [name, env] of Object.entries(KNOBS)) {
  // const NAME = 12;            或   const NAME = [1, 1, 2];
  const re = new RegExp(`^const ${name} = (.+?);$`, 'm');
  const m = src.match(re);
  if (!m) { console.log(`跳过 ${name}（没找到）`); continue; }
  const literal = m[1];
  const isArray = literal.trim().startsWith('[');
  const expr = isArray
    ? `JSON.parse(process.env.${env} || '${literal.replace(/'/g, "\\'")}')`
    : `Number(process.env.${env} ?? ${literal})`;
  src = src.replace(re, `const ${name} = ${expr}; ${MARK}`);
  changed += 1;
  console.log(`  ${name} ← process.env.${env}（默认 ${isArray ? '数组' : literal}）`);
}

await fs.writeFile(botPath, src);
console.log(`\n已改写 ${changed} 个常数 → ${botPath}`);
