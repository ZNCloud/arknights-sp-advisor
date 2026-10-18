// advisor-dev/gen-tables.mjs — 从仓库自带的机器可读研究文档生成「叠层引擎表」
//
// 为什么要有这个：routes/_stack.json 是手写的，而 docs/research/02-bonds.json 里已有同一份数据的
// 机器可读版（layerGarrisons 97 条，带 blackboard / blackboardElite / range_id / effectType）。
// 手写表会随引擎版本漂移，所以这里改成生成；手写文件只保留「判断类字段」（stop / humanFit / apmNeed / note）。
//
//   node advisor-dev/gen-tables.mjs            # 写 routes/_stack.gen.json
//   node advisor-dev/gen-tables.mjs --print    # 打到 stdout
//
// 数据来源（都是仓库真值源，不手抄）：
//   Stronghold-Protocol/docs/research/02-bonds.json  → layerGarrisons / layerScalingGarrisons
//   Stronghold-Protocol/data/garrisons.json          → owners（下发给哪些干员）
//   Stronghold-Protocol/data/chess.json              → 干员名、精英形态

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', 'Stronghold-Protocol');
const out = path.join(here, 'routes', '_stack.gen.json');

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));

const [research, garrisons, chess] = await Promise.all([
  readJson(path.join(repo, 'docs', 'research', '02-bonds.json')),
  readJson(path.join(repo, 'data', 'garrisons.json')),
  readJson(path.join(repo, 'data', 'chess.json')),
]);

/** 事件 key → 我们的通道类型（与 _stack.json 的 _channels.key 对齐） */
const EVENT = [
  [/consume_ammo/i, 'ammo'],
  [/useskill/i, 'skill'],
  [/selfkillenemy/i, 'kill'],
  [/selfdead/i, 'death'],
  [/enemy_abflag_inrange/i, 'freeze'],
  [/onstart/i, 'onstart'],
];
const BY_TYPE = { SERVER_GAIN: 'gain', SERVER_PREP_FIN: 'prepfin', SERVER_PREP_START: 'prepstart', SERVER_CHESS_SOLD: 'sold' };
const eventOf = (key, eventType) =>
  (EVENT.find(([re]) => re.test(key || '')) || [null, BY_TYPE[eventType] || 'other'])[1];

/** 位置关系：range_id / effectType / desc 里能读出来的都读出来，读不出就 null */
function posOf(entry) {
  const bb = entry.blackboard || {};
  const d = String(entry.desc || '');
  if (/身前一格/.test(d)) return '身前一格';
  if (/身后一格/.test(d)) return '身后一格';
  if (/周围\s*4\s*格|周围4格/.test(d)) return '周围4格';
  if (/周围\s*8\s*格|周围8格/.test(d)) return '周围8格';
  if (/同一行/.test(d)) return '同一行';
  if (/整备区/.test(d)) return '整备区';
  if (/场上每/.test(d)) return '全场';
  if (bb.range_id) return 'range:' + bb.range_id;
  return null;
}

/** layerGarrisons 一条 → 我们的结构 */
function toEntry(g, elite) {
  const bb = (elite ? g.blackboardElite : g.blackboard) || g.blackboard || {};
  const key = bb.key || g.battleRuneKey || '';
  const addKey = Object.keys(bb).find((k) => /bond_add_count|add_count|count$/i.test(k) && typeof bb[k] === 'number');
  const bond = bb.bond_id || null;
  const vals = Object.keys(bb).filter((k) => /bond_add_count|add_count|consume_count|count$/i.test(k))
    .reduce((a, k) => { if (typeof bb[k] === 'number') a[k] = bb[k]; return a; }, {});
  return {
    garrisonId: g.garrisonId,
    eventType: g.eventType || null,
    effectType: g.effectType || null,
    event: eventOf(key, g.eventType),
    key,
    bond,
    add: addKey ? bb[addKey] : null,
    vals,
    pos: posOf(g),
    desc: String(elite ? (g.descElite || g.desc) : g.desc || '').replace(/<[^>]+>/g, ''),
  };
}

/** 下发给哪些干员（名字去精锐标记） */
function ownersOf(garrisonId) {
  // research 用的是基础 id（garrison_20），data/garrisons.json 用 _a/_b（普通/精锐），两套都要试
  const cands = [garrisonId, garrisonId + '_a', garrisonId + '_b'];
  let ids = [];
  for (const k of cands) if (garrisons[k] && Array.isArray(garrisons[k].owners)) ids = ids.concat(garrisons[k].owners);
  if (!ids.length) {
    for (const [cid, c] of Object.entries(chess)) {
      if (Array.isArray(c.garrisonIds) && c.garrisonIds.some((x) => cands.includes(x))) ids.push(cid);
    }
  }
  const names = [];
  for (const id of ids) {
    const c = chess[id];
    if (c && c.name && !names.includes(c.name)) names.push(c.name);
  }
  return names;
}

const triggers = {};
const amplifiers = {};
const seen = new Set();

for (const g of research.layerGarrisons || []) {
  const base = toEntry(g, false);
  const elite = toEntry(g, true);
  const names = ownersOf(g.garrisonId).length ? ownersOf(g.garrisonId) : ownersOf(base.garrisonId);
  for (const name of names) {
    const id = base.garrisonId + '|' + name;
    if (seen.has(id)) continue;
    seen.add(id);
    const isAmplifier = base.effectType === 'ADD_BOND' || /身前一格|身后一格/.test(base.desc);
    if (isAmplifier) {
      amplifiers[name] = amplifiers[name] || {
        pos: base.pos || (String(base.desc).includes('身前一格') ? '身前一格' : null), what: base.desc,
        eliteAdd: elite.add, baseAdd: base.add, garrisonId: base.garrisonId,
      };
    } else {
      triggers[name] = triggers[name] || {
        event: base.event, bond: base.bond, add: base.add, eliteAdd: elite.add,
        pos: base.pos, what: base.desc, garrisonId: base.garrisonId,
      };
    }
  }
}

// 手写表里的判断类字段（stop / humanFit / apmNeed / note / best / want）合并进来，不让生成覆盖判断
let curated = {};
try {
  curated = await readJson(path.join(here, 'routes', '_stack.json'));
} catch { /* 没有手写表也能跑 */ }
for (const [name, v] of Object.entries(curated.amplifier || {})) {
  amplifiers[name] = Object.assign({}, amplifiers[name] || {}, { pos: v.pos, what: v.what, stack: v.stack, best: v.best, want: v.want, note: v.note });
  // 生成侧拿不到的字段（pos/what）用手写表补齐；手写侧没有的（event/add）由生成侧提供
  amplifiers[name] = Object.assign({}, amplifiers[name] || {}, v, { best: v.best });
}
for (const [name, v] of Object.entries(curated.trigger || {})) {
  triggers[name] = Object.assign({}, triggers[name] || {}, { want: v.want, note: v.note });
  triggers[name] = Object.assign({}, v, triggers[name] || {});
}

const result = {
  _about: '由 advisor-dev/gen-tables.mjs 从 docs/research/02-bonds.json 的 layerGarrisons + data/garrisons.json 生成。不要手改；要改就改生成器或上游数据。手写判断字段（best/want/note）来自 routes/_stack.json 的合并。',
  _channels: curated._channels || {},
  _source: { layerGarrisons: (research.layerGarrisons || []).length, triggers: Object.keys(triggers).length, amplifiers: Object.keys(amplifiers).length },
  trigger: triggers,
  amplifier: amplifiers,
};

const json = JSON.stringify(result, null, 1);
if (process.argv.includes('--print')) {
  console.log(json);
} else {
  await fs.writeFile(out, json);
  console.log(`written ${out}: ${Object.keys(triggers).length} triggers, ${Object.keys(amplifiers).length} amplifiers, ${(research.layerGarrisons || []).length} garrisons`);
}
