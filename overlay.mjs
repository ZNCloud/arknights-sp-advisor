// advisor-dev/overlay.mjs — the desktop companion: reads the running client through its debugger and writes the
// few lines a small always-on-top box shows.
//
//   # once, for a look
//   node advisor-dev/overlay.mjs --once
//
//   # keep it running next to the game (box.ps1 reads state.json)
//   node advisor-dev/overlay.mjs --watch
//
// What it reads: `globalThis.__SP__.store.get('match')` — the same public/private views the game page renders. It
// posts nothing, sends no match intent, and touches no client file. The client must have been started with
// `--remote-debugging-port=9222` (see 卫戍协议-带顾问启动.cmd next to the exe).
//
// The recommendation itself is the plugin's own core (core-loader.mjs), so the box and the in-game panel cannot drift.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-client.mjs';
import { loadAdvisor, PLUGIN_PAGE } from './core-loader.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(here, 'state.json');
const ROUTE = path.join(here, 'route.json');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const once = args.includes('--once');
const log = args.includes('--log') || once;
const port = flag('--port', process.env.CDP_PORT || '9222');
const interval = Number(flag('--interval', '600')) || 600;

// ── 热更新：顾问逻辑/数据的文件一变，下一 tick 就用新的（不用重启游戏，也不用重启这个进程）──
const WATCHED = [
  PLUGIN_PAGE,
  path.join(here, 'routes', '_matchup.json'),
  path.join(here, 'routes', '_modes.json'),
  path.join(here, 'routes', '_bosses.json'),
  path.join(here, 'routes', '_bands.json'),
];
let DATA = null;
let api = null;
let decide = null;
let loadedKey = '';

async function reloadAdvisor(force = false) {
  const stamps = [];
  for (const f of WATCHED) {
    try { stamps.push((await fs.stat(f)).mtimeMs); } catch { stamps.push(0); }
  }
  const key = stamps.join('|');
  if (!force && key === loadedKey) return false;
  const loaded = await loadAdvisor();
  const mod = await import(`./open-brief.mjs?v=${key.replace(/[^0-9]/g, '').slice(0, 12)}`);
  DATA = loaded.DATA;
  api = loaded.api;
  decide = mod.decide;
  loadedKey = key;
  if (log) console.log(`[${new Date().toLocaleTimeString()}] 顾问逻辑已重载（${WATCHED.length} 个文件有变化）`);
  return true;
}
await reloadAdvisor(true);

const SNAPSHOT = `(() => {
  const S = globalThis.__SP__;
  const store = S && S.store;
  if (!store || typeof store.get !== 'function') return { ok: false, why: 'no __SP__.store' };
  const root = store.get() || {};
  // store.get() 不接受参数，返回整个状态；对局在 .match 里
  const m = root.match || {};
  const pub = m.public || null, p = m.private || null;
  // row/col/dir/items 也带上：复盘要看「放哪了、朝哪、装了啥」（顾问逻辑用不到，但记录要用）
const piece = (x) => (x && typeof x === 'object' ? {
  kind: x.kind, id: x.id, golden: x.golden === true, tier: x.tier,
  row: x.row, col: x.col, dir: x.dir, items: x.items || [],
} : null);
  return {
    ok: true,
    connection: root.connection ? { status: root.connection.status } : null,
    phase: pub ? pub.phase : null,
    round: pub ? pub.round : null,
    // 开局决策用的那份 m.public（boss、禁用名单、模式、队友策略）——服务端在 INFO_CHECK 就发下来了
    brief: pub ? {
      modeId: pub.modeId, difficulty: pub.difficulty, bossId: pub.bossId, hiddenBossId: pub.hiddenBossId,
      disabledBonds: (pub.disabledBonds || []).slice(0, 32),
      drawnDisabledBonds: (pub.drawnDisabledBonds || []).slice(0, 32),
      bannedChess: (pub.bannedChess || []).slice(0, 40),
      factions: (pub.factions || []).slice(0, 12),
      // 队友在玩什么（公开的盟约条）：用来避开抢牌
      players: (pub.players || []).map((x) => ({
        name: x.name, bandId: x.bandId || null, isBot: x.isBot === true,
        bonds: (x.bonds || []).filter((b) => (b.count || 0) > 0).map((b) => ({ bondId: b.bondId, count: b.count })),
      })),
    } : null,
    priv: p ? {
      funds: p.funds, lp: p.lp,
      shop: { level: p.shop ? p.shop.level : null,
        slots: ((p.shop && p.shop.slots) || []).filter(Boolean).map((s) => ({ kind: s.kind, id: s.id, price: s.price, sold: s.sold === true })) },
      hand: (p.hand || []).filter(Boolean).map(piece),
      board: (p.board || []).filter(Boolean).map(piece),
      bonds: (p.bonds || []).map((b) => ({ bondId: b.bondId, count: b.count, tier: b.tier === undefined ? null : b.tier, layers: typeof b.layers === 'number' ? b.layers : 0 })),
      bandId: p.bandId || null,
      // 下一波怪预览：enemyKey/count/fly/elite/boss —— 「别漏光」靠它
      nextEnemies: (p.nextEnemies || []).slice(0, 12).map((e) => ({
        key: e.enemyKey || e.id || null, count: e.count || 1, fly: e.fly === true, elite: e.elite === true, boss: e.boss === true, t: e.t ?? null,
      })),
      // 机变/悬赏卡：要拿哪张
      choice: p.personalChoice ? {
        label: p.personalChoice.label || null,
        cards: (p.personalChoice.cards || []).slice(0, 4).map((c) => ({ label: c.label || c.name || c.id || '?', payout: c.payout ?? c.coin ?? null, lp: c.lpLoss ?? null })),
      } : null,
    } : null,
  };
})()`;

async function readRoute() {
  try {
    const saved = JSON.parse(await fs.readFile(ROUTE, 'utf8'));
    const id = typeof saved === 'string' ? saved : saved && saved.route;
    if (id && DATA.bonds[id] && DATA.bonds[id].c === 1) return id;
  } catch { /* no pick yet */ }
  return null;
}

/** the bond to support the main one: the board's second bond with room left, cheapest threshold first */
function pickAssist(priv, main) {
  const rows = [];
  for (const id of Object.keys(DATA.bonds)) {
    if (id === main) continue;
    const p = api.progressOf(priv, id);
    if (!p.count) continue;
    const next = api.nextThreshold(id, p.count);
    rows.push({ id, name: DATA.bonds[id].n, count: p.count, next, core: DATA.bonds[id].c === 1 });
  }
  rows.sort((a, b) => (a.next === null ? 99 : a.next - a.count) - (b.next === null ? 99 : b.next - b.count) || b.count - a.count);
  return rows[0] || null;
}

/** unowned chess that feed the main bond and the assist bond at once — the best picks for two layers at a time */
function dualStack(priv, main, assist) {
  const held = api.heldCounts(priv);
  const out = [];
  for (const id of Object.keys(DATA.chess)) {
    const row = DATA.chess[id];
    if (row[4] !== 0 || held[row[5]]) continue;
    const bonds = row[2];
    if (bonds.indexOf(main) < 0) continue;
    const cover = assist && bonds.indexOf(assist.id) >= 0 ? 2 : 1;
    out.push({ id, name: row[1], tier: row[0], cover, bonds });
  }
  out.sort((a, b) => b.cover - a.cover || a.tier - b.tier);
  return out;
}

/** 开局阶段：真实 PHASE 取值见 shared/constants.js（BAND_DRAFT 才是「选择策略」） */
const OPEN_PHASES = new Set(['INFO_CHECK', 'BAND_DRAFT', 'BATTLE_CHECK', 'ROUND_START', 'LOBBY']);

function briefBoxOf(snap) {
  if (!snap.brief || !snap.brief.modeId) return null;
  let d;
  try { d = decide(snap.brief); } catch { return null; }
  const b = d.brief;
  const top = d.top;
  const lines = [];
  lines.push(b.boss
    ? `BOSS ${b.boss.name}${b.boss.hidden ? '(隐藏)' : ''} HP${b.boss.hp} DEF${b.boss.def} RES${b.boss.res} ${b.boss.melee ? '近战' : '远程'}${b.boss.tags.length ? ' · ' + b.boss.tags.join('/') : ''}`
    : 'BOSS 未知');
  lines.push(`禁用 ${d.bans.drawn.join('/') || '无'}${d.bans.chess ? ` · 干员 ${d.bans.chess} 名` : ''} · 可用 ${b.coreAvailable.length} 条核心`);
  if (top) {
    lines.push(`建议 ${top.name}（相对 ${top.relative}%）${top.risk.length ? ' · 注意' : ''}`);
    if (d.bands.length) lines.push(`策略 ${d.bands[0].name}${d.bands[0].conflict ? '(' + d.bands[0].conflict + ')' : ''} · 备选 ${d.bands.slice(1, 3).map((x) => x.name).join('/')}`);
    if (d.loadout) lines.push(`调配 自选 ${d.loadout.diy.join('/')}${d.loadout.skill.length ? ' · ' + d.loadout.skill.slice(0, 2).map((s) => s.name + ':' + s.skill).join('，') : ''}`);
    if (top.risk.length) lines.push(`风险 ${top.risk[0]}`);
  } else {
    lines.push('没有可用的核心盟约');
  }
  return {
    at: Date.now(), online: true, phase: snap.phase, round: snap.round, open: true,
    boss: b.boss ? { name: b.boss.name, hp: b.boss.hp, def: b.boss.def, res: b.boss.res, melee: b.boss.melee, tags: b.boss.tags } : null,
    bans: d.bans, ranking: d.ranked.slice(0, 4).map((r) => ({ name: r.name, relative: r.relative, risk: r.risk.slice(0, 2) })),
    loadout: d.loadout ? { diy: d.loadout.diy || [], skill: (d.loadout.skill || []).slice(0, 4), notes: d.loadout.notes || null } : null,
    pick: top ? { bondId: top.bondId, name: top.name, relative: top.relative, entryRisk: top.entryRisk, bossNote: top.bossNote } : null,
    bands: d.bands.map((x) => ({ name: x.name, kind: x.kind, why: x.why, conflict: x.conflict })),
    text: lines.join('\n'),
  };
}

/** Everything the small box needs, from one snapshot of the page's own state. */
export function boxOf(snap, route) {
  const at = Date.now();
  if (!snap || !snap.ok) return { at, online: false, text: '未连上客户端（需用带调试端口的启动器）' };
  const roundsPlayed = (snap.priv && (snap.priv.bonds || []).reduce((n, b) => n + (b.layers || 0), 0)) || 0;
  // 只要进了休整期（有私有视图 + PREP）就给抓取建议；开局决策只在「还没开始打」的阶段显示
  const opening = OPEN_PHASES.has(snap.phase);
  if (opening) {
    const brief = briefBoxOf(snap);
    if (brief && (!snap.priv || !roundsPlayed)) return Object.assign(brief, { demo: !!snap.demo });
  }
  if (!snap.priv) {
    return { at, online: true, phase: snap.phase, idle: true, text: snap.phase ? `对局阶段 ${snap.phase}，等休整期` : '在大厅，等开局' };
  }
  const priv = snap.priv;
  priv.round = snap.round || 1;      // the core's estimate needs the round; the private view has none
  const banned = (snap.brief && snap.brief.disabledBonds) || [];
  // ── 拐弯：玩家实际在叠哪条核心盟约（层数最多的），那就跟着他走，而不是死守开局建议 ──
  const own = (priv.bonds || [])
    .filter((b) => DATA.bonds[b.bondId] && DATA.bonds[b.bondId].c === 1 && (b.layers || 0) >= 20)
    .sort((a, b) => (b.layers || 0) - (a.layers || 0));
  const pivoted = own.length && own[0].bondId !== route ? own[0].bondId : null;
  const route_ = pivoted || api.autoRoute(priv, route, banned);
  const pubBoss = (snap.brief && (snap.brief.bossId || snap.brief.hiddenBossId)) || null;
  const view = api.analyseState(priv, { round: snap.round, modeId: snap.brief && snap.brief.modeId, disabledBonds: banned, bossId: pubBoss }, route_);
  const assist = pickAssist(priv, route_);
  const dual = dualStack(priv, route_, assist);
  const bond = DATA.bonds[route_] || { n: route_, t: [] };
  // ── 下一波怪：数一下飞行/精英/boss，别漏光 ──
  const next = (priv.nextEnemies || []);
  const flyN = next.filter((e) => e.fly).reduce((n, e) => n + (e.count || 1), 0);
  const allN = next.reduce((n, e) => n + (e.count || 1), 0);
  const eliteN = next.filter((e) => e.elite).reduce((n, e) => n + (e.count || 1), 0);
  const bossN = next.filter((e) => e.boss).length;
  const wave = allN ? {
    total: allN, fly: flyN, elite: eliteN, boss: bossN,
    have: view.air ? view.air.have : null, units: view.air ? view.air.units : null, gap: view.air ? view.air.gap : 0,
    text: `下一波 ${allN} 只${flyN ? ` · 飞行 ${flyN}` : ''}${eliteN ? ` · 精英 ${eliteN}` : ''}${bossN ? ' · BOSS' : ''}${flyN / allN >= 0.35 ? (view.air && view.air.gap > 0 ? ` ← 对空差 ${view.air.gap}（场上能打飞 ${view.air.have}/${view.air.units}）` : ` · 对空够（${view.air ? view.air.have : '?'} 个）`) : ''}${(priv.lp || 99) <= 10 ? ' · 血少，别漏' : ''}`,
  } : null;
  return {
    at,
    online: true,
    phase: snap.phase,
    round: snap.round,
    funds: priv.funds,
    lp: priv.lp,
    main: { id: route_, name: bond.n, count: view.progress.count, next: view.next, thresholds: bond.t,
      layers: view.layers, mult: +view.mult.toFixed(2), ehp: +view.ehp.toFixed(2), pivoted: !!pivoted },
    wave,
    bounty: (view.bounties && view.bounties.length) ? { label: (priv.choice && priv.choice.label) || null, best: view.bounties } : null,
    gap: view.missing.slice(0, 5).map((m) => `${m.name} T${m.tier}`),
    // 商店：带上「本家/关键/已有几张/怎么放」，否则整屏 0 分看着像没刷新
    shop: view.rows.slice(0, 4).map((r) => ({
      tag: '#' + (r.index + 1), name: r.name, price: r.price, score: r.score,
      route: !!r.route, key: !!r.key, copies: r.copies || 0, item: !!r.item, place: r.place || null,
    })),
    advice: view.advice.text,
    compact: compactOf(view, priv, null),
    plan: planOf(view, priv),
    usage: view.usage || null,
    // 小盟约（附加盟约）：「激活的」+「差 1–2 个就能激活的」，按人类操作量排；apm=需要你额外做的动作数
    addons: (view.addons || []).map((a) => ({ name: a.name, count: a.count, need: a.need, active: a.active, apm: a.apm, next: a.next })),
    invest: view.invest || 1,
    addonLine: (view.addons || []).slice(0, 3).map((a) => (
      `${a.name}${a.active ? '✓' : ' ' + a.count + '/' + (a.next || a.count)}${a.id === 'investShip' && a.active ? '·获得时×' + (view.invest || 2) : ''}`
    )).join(' · ') || null,
    // 「获得时」给什么：抓这张牌能换多少层（投资人倍率已含）
    pickGain: gainLineOf(view, priv),
    // 叠层引擎：第一个放大器该怎么摆（位置类放大器是零操作收益，摆错一格就浪费）
    stackPlace: (view.stack && view.stack.place) ? String(view.stack.place).split(/[：:]/)[0].trim() : null,
    stackChannel: (view.stack && view.stack.channel) || null,
    // 破甲/BOSS 通道：能不能杀死本局 BOSS（model/bosstable.json）
    armor: view.armor ? {
      name: view.armor.name, need: view.armor.need, have: view.armor.have, ok: view.armor.ok,
      def: view.armor.def, channel: view.armor.channel, k: view.armor.k, weak: view.armor.weakChannel, lpr: view.armor.lpr,
      line: `${view.armor.name} · 通道 ${view.armor.channel} ${view.armor.k} · 破甲需 ATK ${view.armor.need}（你 ${view.armor.have}${view.armor.ok ? '✓' : ' ✗'}）${view.armor.lpr >= 10 ? ` · 漏一只 -${view.armor.lpr} LP` : ''}`,
    } : null,
    // 人数档位：只报「下一档给什么 + 还差几个人」——「塞满值不值」当场能看见
    // 输出终端：这条线上真正负责打 BOSS 的那一个（装备/精锐/站位都该喂它）
    terminal: view.terminal ? {
      name: view.terminal.name, eff: view.terminal.eff, atk: view.terminal.atk,
      golden: view.terminal.golden, place: view.terminal.place,
      line: `${view.terminal.name} ${view.terminal.eff} 有效攻（基础 ${view.terminal.atk}${view.terminal.golden ? '·精锐' : ''}）→ 装备/精锐/站位喂它`,
    } : null,
    // 到下一档的概率（共享池子折算后）：低了就别赌，把资源给终端
    tierOdds: (view.tiers && view.tiers.pNext != null) ? { goal: view.tiers.next, p: Math.round(view.tiers.pNext * 100) } : null,
    tierLine: view.tiers && !view.tiers.full
      ? `到${view.tiers.next}人档给 ${view.tiers.nextText || '?'} · 还差${view.tiers.need}人`
      : (view.tiers ? '档位已满' : null),
    tiers: view.tiers ? { next: view.tiers.next, need: view.tiers.need, line: view.tiers.line, short: view.tiers.short, full: view.tiers.full } : null,
    policyNote: (view.policy && view.policy.note) || null,
    // 「抓谁 + 为什么 + 怎么放」——取评分最高的那一格，一句话说清
    pick: view.rows.length ? {
      tag: '#' + (view.rows[0].index + 1),
      name: view.rows[0].name,
      price: view.rows[0].price,
      place: view.rows[0].place || null,
      why: (view.rows[0].why || []).slice(0, 2).join(' · '),
      score: view.rows[0].score,
    } : null,
    assist: assist ? { name: assist.name, count: assist.count, next: assist.next } : null,
    dual: dual.filter((d) => d.cover > 1).slice(0, 3).map((d) => d.name),
    // 手牌：让「找谁叠」的依据可见（缺谁已经把手牌算进 heldCounts，这里把手上有什么也摆出来）
    hand: handNames(priv),
    est: { low: view.est.low, high: view.est.high, pLow: Math.round(view.est.pLow * 100), pHigh: Math.round(view.est.pHigh * 100) },
  };
}

/**
 * 「抓这张牌能换什么」：用引擎的「获得时」特质算层数/金/刷新，投资人倍率已含。
 * 只对商店里分最高的那一格说一句，避免小框变成账本。
 */
function gainLineOf(view, priv) {
  const row = (view.rows || [])[0];
  if (!row || !row.id) return null;
  const g = api.gainOf(row.id, view.level, view.invest || 1);
  if (!g) return null;
  const bits = [];
  const lay = g.layers[view.route] || 0;
  if (lay) bits.push(`+${lay} 层`);
  for (const [bond, n] of Object.entries(g.layers)) {
    if (bond === view.route || !n) continue;
    const nm = (DATA.bonds[bond] && DATA.bonds[bond].n) || bond;
    bits.push(`${nm}+${n}`);
  }
  if (g.gold) bits.push(`+${g.gold}金`);
  if (g.refresh) bits.push(`免费刷新×${g.refresh}`);
  if (g.equip) bits.push(`装备×${g.equip}`);
  if (g.top) bits.push(`最多层盟约+${g.top}`);
  if (!bits.length) return null;
  return `${row.name} ${bits.join(' ')}${view.invest > 1 ? `（获得时×${view.invest}）` : ''}`;
}


/**
 * 极简输出（用户要求：每项不超过十个字）——
 *   抓谁 / 和谁配合 / 下阶段干啥 / 冻结否 / 什么时候组什么
 * 其余细节仍然留在 state.json 里，小框只显示这五行。
 */

/**
 * 一次列全的操作清单（用户要求：不要一条条挤牙膏，一个回合该做的全摆出来）。
 * 每条 ≤12 字，按「先买 → 摆位 → 冻结 → 经济(升/刷) → 防守(对空/通道)」排。
 */
function planOf(view, priv) {
  const cut = (t, n = 4) => String(t || '').replace(/\s+/g, '').slice(0, n);
  const out = [];
  const funds = priv.funds || 0;
  const rows = (view.rows || []).filter((r) => r.score >= 26).slice(0, 3);
  for (const r of rows) {
    out.push('买#' + (r.index + 1) + ' ' + cut(r.name) + ' ' + r.price + '金');
  }
  // 摆位：放大器 > 终端
  // 摆位：只推「配对」并按收益排序，低于阈值的不给（不给看着忙其实没用的位）
  const pairs = view.pairs || [];
  if (pairs.length) {
    const pr = pairs[0];
    out.push('放' + cut(pr.amp, 3) + '→' + cut(pr.target, 3));
    if (pairs[1] && pairs[1].gain >= pairs[0].gain * 0.6) out.push('放' + cut(pairs[1].amp, 3) + '→' + cut(pairs[1].target, 3));
  } else if (view.pick && view.pick.place) out.push('放' + cut(view.pick.name) + cut(view.pick.place, 6));
  // 冻结：买不起的本家/核心，冻住等下一回合
  const shop = (priv.shop && priv.shop.slots) || [];
  for (let i = 0; i < shop.length; i++) {
    const sl = shop[i];
    if (!sl || sl.sold || sl.frozen) continue;
    if (sl.price > funds && (view.rows || []).some((r) => r.index === i && r.route)) { out.push('冻#' + (i + 1)); break; }
  }
  // 升本：给结论 + 数字（不要「看情况」）
  if (view.upgrade) {
    const u = view.upgrade;
    out.push(u.yes ? '升本 是 ' + u.cost + '金' : '升本 否 ' + String(u.why).slice(0, 8));
  }
  // 阶段目标概率：到 6 人 / 到 9 人（共享池折算后）
  if (view.tiers) {
    const p = view.tiers.pNext;
    if (!view.tiers.full && p != null && p < 0.95) out.push('到' + view.tiers.next + '人 ' + Math.round(p * 100) + '%');
    else if (view.tiers.full) out.push('组已满');
  }
  out.push('位 ' + (view.role ? view.role.name : '?'));
  // 经济：升本 / 刷
  if (view.advice && view.advice.kind === 'refresh' && !(view.upgrade && view.upgrade.yes)) out.push('刷找核心');
  // LP 定价：硬红线（lpr>=10）才守，低血小额 lpr 可以透支
  if (view.lp && view.lp.text) out.push(view.lp.kind === 'hard' ? '守血线' : '血可透支');
  // 防守
  if (view.air && view.air.gap > 0) out.push('补对空' + view.air.gap + '个');
  if (view.armor && view.armor.weakChannel) out.push('通道弱k' + view.armor.k);
  if (view.tiers && !view.tiers.full && view.tiers.pNext != null && view.tiers.pNext < 0.35) out.push('别赌' + view.tiers.next + '人');
  // 终局目标：装备/精锐都喂终端
  // 奶位：没奶就别把装备往小身板上堆，先把奶补上
  const healers = (priv.board || []).filter((p) => {
    if (!p || typeof p.id !== 'string') return false;
    const r = DATA.chess[p.id];
    return r && r[8] === 'heal';
  }).length;
  if (!healers && view.terminal) out.push('先加奶（0 个）');
  else if (view.terminal) out.push('喂' + cut(view.terminal.name) + '装备');
  // 升本余量：买完还剩多少、够不够下一级
  const spent = rows.reduce((a, r) => a + (r.price || 0), 0);
  const left = funds - spent;
  const upNext = view.advice && view.advice.kind === 'level' ? null : null;

  if (left > 0 && view.level < 6) out.push('余' + left + '金别留');
  return out.slice(0, 8).map((t, i) => (i + 1) + '. ' + t);
}

function compactOf(view, priv, box) {
  const cut = (t, n = 6) => String(t || '').replace(/\s+/g, '').slice(0, n);
  const pick = view.rows && view.rows[0];
  const shop = (priv.shop && priv.shop.slots) || [];
  const out = {};
  // 抓谁
  const kind = view.advice && view.advice.kind;
  out.pick = kind === 'refresh' ? '先刷' : kind === 'level' ? '先升本'
    : kind === 'wait' ? '控血' : (pick ? '抓' + cut(pick.name) : '先刷');
  // 和谁配合：叠层放大器 > 辅助叠层 > 关键干员
  const amp = view.stack && view.stack.amps && view.stack.amps[0];
  out.partner = amp ? '配' + cut(amp.name) : (view.assist ? '配' + cut(view.assist.name) : '不用配');
  // 下阶段干啥
  if (view.tiers && !view.tiers.full && view.tiers.pNext != null && view.tiers.pNext < 0.35) out.next = '转喂终端';
  else if (view.advice && view.advice.kind === 'level') out.next = '升本';
  else if (view.advice && view.advice.kind === 'refresh') out.next = '刷商店';
  else if (view.terminal && view.terminal.golden === false) out.next = '喂终端';
  else out.next = '保血线';
  // 冻结否：买不起的本家牌/要留的牌才冻
  let frozenSlot = null;
  for (let i = 0; i < shop.length; i++) { if (shop[i] && shop[i].frozen) { frozenSlot = i + 1; break; } }
  const unaffordable = pick && pick.price > (priv.funds || 0);
  out.freeze = frozenSlot ? '冻#' + frozenSlot : unaffordable ? '冻#' + (pick.index + 1) : '别冻';
  // 什么时候组什么
  if (view.tiers && !view.tiers.full) {
    out.group = 'R' + Math.max((view.round || 1) + 2, 0) + '凑' + view.tiers.next + '人';
  } else {
    out.group = '组已满';
  }
  return out;
}

/** 手牌（按名字，重复的标 ×N；精锐标 ★） */function handNames(priv) {
  const out = [];
  const seen = new Map();
  for (const piece of priv.hand || []) {
    if (!piece || piece.kind !== 'chess' || typeof piece.id !== 'string') continue;
    const base = api.baseOf(piece.id);
    const label = api.nameOf(piece.id) + (api.isGolden(piece.id) ? '★' : '');
    if (seen.has(base)) { seen.get(base).n += 1; continue; }
    const row = { label, n: 1 };
    seen.set(base, row);
    out.push(row);
  }
  return out.map((r) => (r.n > 1 ? `${r.label}×${r.n}` : r.label));
}

function line(box) {
  if (box.text) return box.text;
  const est = box.est.low === box.est.high ? `成 ${box.est.high} 人 ${box.est.pHigh}%` : `成 ${box.est.low} 人 ${box.est.pLow}% / ${box.est.high} 人 ${box.est.pHigh}%`;
  const shop = (box.shop || []).map((r) => `${r.tag} ${r.name}${r.key ? '★' : r.route ? '·本家' : ''} ${r.price}金 ${r.score}`).join(' | ');
  return [
    `R${box.round} ${box.funds}金 · 主叠 ${box.main.name} ${box.main.count}${box.main.next ? '/' + box.main.next : ''} · ${est}`,
    `抓: ${box.advice}`,
    `手牌: ${box.hand && box.hand.length ? box.hand.join(' ') : '空'}`,
    `找谁叠: ${box.gap.join(' · ') || '路线已齐'}`,
    box.pickGain ? `这抓换: ${box.pickGain}` : null,
    box.armor ? `BOSS: ${box.armor.line}` : null,
    box.stackPlace ? `辅叠位: ${box.stackPlace}（身前一格）` : null,
    box.addonLine ? `小盟约: ${box.addonLine}` : null,
    box.terminal ? `终端: ${box.terminal.line}` : null,
    box.tierLine ? `档位: ${box.tierLine}` : null,
    `商店: ${shop || '空'}`,
    box.wave ? `预警: ${box.wave.text}` : null,
    `辅叠: ${box.assist ? `${box.assist.name} ${box.assist.count}${box.assist.next ? '/' + box.assist.next : ''}` : '—'}${box.dual.length ? ` · 双叠 ${box.dual.join('/')}` : ''}`,
  ].filter(Boolean).join('\n');
}

export async function writeState(box) {
  const tmp = `${STATE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(box));
  await fs.rename(tmp, STATE);
}

/**
 * 对局记录（复盘用）：每进入一个新的「回合 + 阶段」就往 records/ 追一行 JSONL。
 * 记的东西正是客户端事后不保留的：这一回合买了谁、放了哪（row/col/dir）、冻了哪格、装备给了谁、当时顾问说了什么。
 * 客户端只把「最终结果 + 终局上阵」写进 localStorage 的 sp.match-history.v1，过程不会留，所以由我们来记。
 */
const RECORD_DIR = path.join(path.dirname(STATE), 'records');

async function recordTurn(snap, box) {
  if (!snap || !snap.ok || !snap.priv) return;
  const key = `${snap.phase || '?'}|${snap.round || 0}`;
  if (recordTurn.last === key) return;
  recordTurn.last = key;
  const priv = snap.priv;
  const row = {
    at: new Date().toISOString(),
    phase: snap.phase, round: snap.round, mode: snap.brief && snap.brief.modeId,
    funds: priv.funds, lp: priv.lp, level: priv.shop && priv.shop.level,
    bonds: (priv.bonds || []).map((b) => `${b.bondId}:${b.count}/${b.layers ?? 0}`),
    board: (priv.board || []).map((p) => ({
      id: p.id, golden: !!p.golden, tier: p.tier, items: p.items || [],
      at: [p.row, p.col], dir: p.dir,
    })),
    hand: (priv.hand || []).map((p) => p.id),
    shop: ((priv.shop && priv.shop.slots) || []).map((s) => (s && !s.sold ? { id: s.id, price: s.price, frozen: !!s.frozen } : null)).filter(Boolean),
    advice: box && box.advice ? box.advice : null,
    pick: box && box.pick ? `${box.pick.name}(${box.pick.score})` : null,
    terminal: box && box.terminal ? box.terminal.name : null,
    boss: box && box.armor ? `${box.armor.name} k=${box.armor.k}` : null,
    // 服务端给的统计（dmgDealt/bossDamage/kills/leaks/gold/refreshes/merges/itemsEquipped）——
    // 复盘时这比「赢没赢」有用得多，也直接对应 history 里的 stats 字段
    stats: priv.stats || null,
  };
  try {
    await fs.mkdir(RECORD_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    await fs.appendFile(path.join(RECORD_DIR, `${day}.jsonl`), JSON.stringify(row) + '\n');
  } catch { /* 记录失败不该影响顾问 */ }
}

async function main() {
  let cdp = null;
  let said = '';
  const tick = async () => {
    try {
      if (!cdp) cdp = await connect({ port });
      await reloadAdvisor();                       // 逻辑/数据热更新：文件一变就用新的
      const snap = await cdp.evaluate(SNAPSHOT);
      const box = boxOf(snap, await readRoute());
      await writeState(box);
      await recordTurn(snap, box);                 // 复盘：逐回合落盘（客户端自己不存过程）
      const text = line(box);
      if (log && text !== said) { said = text; console.log(`\n[${new Date().toLocaleTimeString()}] ${text}`); }
      return true;
    } catch (error) {
      cdp?.close();
      cdp = null;
      const box = { at: Date.now(), online: false, text: `连接断开: ${String(error.message || error).slice(0, 90)}` };
      await writeState(box).catch(() => {});
      if (log && box.text !== said) { said = box.text; console.log(`\n[${new Date().toLocaleTimeString()}] ${box.text}`); }
      return false;
    }
  };

  if (once) {
    await tick();
    cdp?.close();
    const box = JSON.parse(await fs.readFile(STATE, 'utf8'));
    console.log(JSON.stringify(box, null, 2));
    return;
  }

  let stop = false;
  process.on('SIGINT', () => { stop = true; cdp?.close(); process.exit(0); });
  while (!stop) {
    const ok = await tick();
    await new Promise((r) => setTimeout(r, ok ? interval : 3000));
  }
}

// only run when executed directly: demo-state.mjs imports boxOf/writeState without starting the poller
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();
