// advisor-dev/lab/patch-core.mjs — 对插件内核做幂等的小改动（避免命令行转义地狱）。
//   node advisor-dev/lab/patch-core.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, '..', '..', 'Stronghold-Protocol', 'plugins', 'pick-advisor', 'ui', 'index.html');
let s = fs.readFileSync(file, 'utf8');
const before = s;
let n = 0;

/** 幂等替换：仅当 oldText 存在且 newText 不存在时替换 */
const swap = (oldText, newText, label) => {
  if (s.includes(newText)) { console.log(`  = ${label}（已存在）`); return; }
  if (!s.includes(oldText)) { console.log(`  ! ${label}（没找到锚点）`); return; }
  s = s.replace(oldText, newText);
  n += 1;
  console.log(`  + ${label}`);
};

// 1) scoreSlot 的棋子里带上站位提示
swap(
  'route: hasBond, key: key, copies: copies, item: false, base: base, tier: tierOf(slot.id) };',
  'route: hasBond, key: key, copies: copies, item: false, base: base, tier: tierOf(slot.id), place: placeOf(slot.id) };',
  '棋子行带 place',
);

// 2) 装备行的站位提示
swap(
  "route: false, key: false, copies: 0, item: true };",
  "route: false, key: false, copies: 0, item: true, place: '装备→主C/前排' };",
  '装备行带 place',
);

// 3) 暴露 placeOf 供 overlay 使用（core-loader 的导出清单）
if (!s.includes('placeOf, keyOpsOf')) {
  const anchor = 'layersOf, damageMultiplier, survivalMultiplier, bbOf, coreBondsFor, modeOf, lastRoundOf, upgradePrice, shopSlotsOf';
  if (s.includes(anchor)) { /* core 里没有导出清单，跳过 */ }
}
if (n === 0 && s === before) console.log('没有改动');
fs.writeFileSync(file, s);
console.log(`\n完成，改动 ${n} 处 → ${file}`);
