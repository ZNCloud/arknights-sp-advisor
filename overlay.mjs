// advisor-dev/overlay.mjs — the desktop companion: reads the running client through its debugger and writes the
// few lines a small always-on-top box shows.
//
//   # once, for a look
//   node advisor-dev/overlay.mjs --once
//
//   # keep it running next to the game (box.ps1 reads state.json)
//   node advisor-dev/overlay.mjs --watch
//
//   # + the lineup check (站位检查) in every prep: off unless asked for (lineup-live.mjs; needs the engine checkout)
//   node advisor-dev/overlay.mjs --watch --lineup [--lineup-threads 16]
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
import { matesOf, resultOf } from './advisor/team.mjs';
import { redactRow } from './advisor/redact.mjs';
import { routeFor } from './route-pick.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(here, 'state.json');
const ROUTE = path.join(here, 'route.json');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const once = args.includes('--once');
// 记录默认开启：用户要求「点带顾问的启动器就必须带上所有信息」
const record = !args.includes('--no-record');
const log = args.includes('--log') || once;
// --redact：记录行里的昵称 / 账号 id 换成座位号再落盘（advisor/redact.mjs）；不加则记录与原来逐字节相同
const redact = args.includes('--redact');
const port = flag('--port', process.env.CDP_PORT || '9222');
const interval = Number(flag('--interval', '600')) || 600;
// --lineup：休整期里跑站位检查（lineup-live.mjs），结果作为小框的一行建议；不加则顾问的一切输出与原来逐字节相同
const lineupOn = args.includes('--lineup');

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

const lineup = lineupOn ? await (async () => {
  const { LiveLineup, defaultThreads } = await import('./lineup-live.mjs');
  const threads = Number(flag('--lineup-threads', String(defaultThreads())));
  if (log) console.log(`[${new Date().toLocaleTimeString()}] 站位检查已开（${threads} 线程）`);
  return new LiveLineup({ threads, log: log ? (s) => console.log(`[${new Date().toLocaleTimeString()}] ${s}`) : () => {} });
})() : null;

const SNAPSHOT = `(async () => {
  const S = globalThis.__SP__;
  const store = S && S.store;
  if (!store || typeof store.get !== 'function') return { ok: false, why: 'no __SP__.store' };
  const root = store.get() || {};
  // store.get() 不接受参数，返回整个状态；对局在 .match 里
  const m = root.match || {};
  const pub = m.public || null, p = m.private || null;
  // 本服自己的盟约表（顾问的数值表是官方 0.3.1）：按 origin 缓存，换服才重取
  let dataBonds = null;
  try {
    const origin = (typeof location !== 'undefined' && location.origin) || '';
    const cached = globalThis.__spAdvisorDataBonds;
    if (cached && cached.origin === origin) dataBonds = cached.ids;
    else if (S.data && typeof S.data.get === 'function') {
      const v = await S.data.get('bonds');
      dataBonds = v ? Object.keys(v) : null;
      globalThis.__spAdvisorDataBonds = { origin, ids: dataBonds };
    }
  } catch { dataBonds = null; }
  // row/col/dir/items 也带上：复盘要看「放哪了、朝哪、装了啥」（顾问逻辑用不到，但记录要用）
const piece = (x) => (x && typeof x === 'object' ? {
  kind: x.kind, id: x.id, golden: x.golden === true, tier: x.tier,
  row: x.row, col: x.col, dir: x.dir, items: x.items || [],
} : null);
  return {
    ok: true,
    connection: root.connection ? { status: root.connection.status } : null,
    // 服务器身份 + 它自己的盟约表（顾问的数值表是官方 0.3.1；这一句让 overlay 能判断「本服数据对不对得上」）
    origin: (typeof location !== 'undefined' && location.origin) || null,
    dataBonds,
    phase: pub ? pub.phase : null,
    round: pub ? pub.round : null,
    // 开局决策用的那份 m.public（boss、禁用名单、模式、队友策略）——服务端在 INFO_CHECK 就发下来了
    brief: pub ? {
      modeId: pub.modeId, difficulty: pub.difficulty, bossId: pub.bossId, hiddenBossId: pub.hiddenBossId,
      disabledBonds: (pub.disabledBonds || []).slice(0, 32),
      drawnDisabledBonds: (pub.drawnDisabledBonds || []).slice(0, 32),
      bannedChess: (pub.bannedChess || []).slice(0, 40),
      factions: (pub.factions || []).slice(0, 12),
      // 队友在玩什么：公开视图 m.public.players 里每人都有 LP / 调度中心等级 / 上阵人数 / 盟约（含层数）/ 状态。
      // 顾问只拿它「避开抢牌」，复盘要的正是同一份数据——原样带上，记录里才有「队友怎么玩」。
      players: (pub.players || []).map((x) => ({
        playerId: x.playerId, seat: x.seat, name: x.name, bandId: x.bandId || null, isBot: x.isBot === true,
        alive: x.alive !== false, lp: x.lp ?? null, shopLevel: x.shopLevel ?? null, boardCount: x.boardCount ?? null,
        status: x.status ?? null, autoplay: x.autoplay === true,
        bonds: (x.bonds || []).filter((b) => (b.count || 0) > 0 || (b.layers || 0) > 0)
          .map((b) => ({ bondId: b.bondId, count: b.count || 0, layers: b.layers || 0, tier: b.tier ?? 0, active: b.active === true, off: b.off === true })),
      })),
      // 合作进度：队伍 LP 与 BOSS 血池（谁在扛输出，看这个）
      teamLp: pub.teamLp ?? null,
      bossHp: pub.bossHp ? { hp: pub.bossHp.hp, max: pub.bossHp.max } : null,
      bossRound: pub.bossRound ?? null, hiddenRound: pub.hiddenRound ?? null,
    } : null,
    me: { playerId: (root.me && root.me.playerId) || null, name: (root.me && root.me.name) || null },
    // 终局结算 m.result：每个人（含队友）的阵容 / 盟约 / 统计（bossDamage、lpLost、活到第几回合）——「谁打得好」靠它
    result: m.result && Array.isArray(m.result.players) ? {
      victory: m.result.victory === true, roundsPassed: m.result.roundsPassed ?? null, hiddenCleared: m.result.hiddenCleared === true,
      reason: m.result.reason || null, bossId: m.result.bossId || null,
      players: m.result.players.map((x) => ({
        playerId: x.playerId, seat: x.seat, name: x.name, isBot: x.isBot === true, alive: x.alive === true,
        roundsPassed: x.roundsPassed ?? null, eliminatedRound: x.eliminatedRound ?? null, lp: x.lp ?? null,
        lineup: (x.lineup || []).map((u) => ({ id: u.id, golden: u.golden === true, row: u.row, col: u.col, items: u.items || [] })),
        bonds: (x.bonds || []).map((b) => ({ bondId: b.bondId, count: b.count || 0, layers: b.layers || 0 })),
        stats: x.stats || null,
      })),
    } : null,
    // 队友的棋盘：休整期点开队友看（m.field 'n:<playerId>'）时客户端才收到；BOSS 回合的搭档棋盘在 m.private.bossMate
    scout: m.field && m.field.prep === true && typeof m.field.fieldId === 'string' && m.field.fieldId.startsWith('n:') ? {
      playerId: m.field.fieldId.slice(2),
      units: (m.field.units || []).filter((u) => u.ownerId === m.field.fieldId.slice(2)).map((u) => ({
        id: u.defId, area: u.area || 'board', row: u.y, col: u.x, dir: u.dir || null, golden: u.golden === true, tier: u.tier, items: u.items || [] })),
    } : null,
    bossMate: p && p.bossMate ? {
      playerId: p.bossMate.playerId,
      units: (p.bossMate.units || []).map((u) => ({ id: u.defId, row: u.y, col: u.x, dir: u.dir || null, golden: u.golden === true, tier: u.tier, items: u.items || [] })),
    } : null,
    priv: p ? {
      funds: p.funds, lp: p.lp,
      shop: { level: p.shop ? p.shop.level : null,
        slots: ((p.shop && p.shop.slots) || []).filter(Boolean).map((s) => ({ kind: s.kind, id: s.id, price: s.price, sold: s.sold === true })) },
      hand: (p.hand || []).filter(Boolean).map(piece),
      board: (p.board || []).filter(Boolean).map(piece),
      bonds: (p.bonds || []).map((b) => ({ bondId: b.bondId, count: b.count, tier: b.tier === undefined ? null : b.tier, layers: typeof b.layers === 'number' ? b.layers : 0 })),
      bandId: p.bandId || null,
      // 服务端统计（m.private.stats）：以前 recordTurn 读 priv.stats 但这里没带上，记录里的 stats 一直是 null
      stats: p.stats || null,
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

/** the player's pick from box.ps1 (route.json), only if made in this match (route-pick.mjs) */
async function readRoute(match) {
  try {
    return routeFor(JSON.parse(await fs.readFile(ROUTE, 'utf8')), match, (id) => !!(DATA.bonds[id] && DATA.bonds[id].c === 1));
  } catch { return null; }   // no pick yet
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
  // 本局指纹：box.ps1 用它给点选的主线打标签，换了局就清掉自动选中的那条
  const match = api.matchKeyOf(snap.brief);
  // 只要进了休整期（有私有视图 + PREP）就给抓取建议；开局决策只在「还没开始打」的阶段显示
  const opening = OPEN_PHASES.has(snap.phase);
  if (opening) {
    const brief = briefBoxOf(snap);
    if (brief && (!snap.priv || !roundsPlayed)) return Object.assign(brief, { demo: !!snap.demo, match });
  }
  if (!snap.priv) {
    return { at, online: true, phase: snap.phase, idle: true, match, server: serverInfoOf(snap), text: snap.phase ? `对局阶段 ${snap.phase}，等休整期` : '在大厅，等开局' };
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
  const out = {
    at,
    online: true,
    match,
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
    // ── 说人话要用的原料：原来这些只活在打分模型的内部，小框只好吐「买#2 角峰 60金」这种电报体 ──
    level: view.level,
    adviceKind: (view.advice && view.advice.kind) || null,
    rows: (view.rows || []).slice(0, 3).map((r) => ({
      tag: '#' + (r.index + 1), slot: r.index + 1, name: r.name, price: r.price, score: r.score,
      route: !!r.route, key: !!r.key, copies: r.copies || 0, item: !!r.item, place: r.place || null,
      why: (r.why || []).slice(0, 3),
    })),
    pairs: (view.pairs || []).slice(0, 2).map((p) => ({ amp: p.amp, target: p.target, gain: p.gain, pos: p.pos })),
    upgrade: view.upgrade
      ? { yes: !!view.upgrade.yes, cost: view.upgrade.cost, why: view.upgrade.why || null, need: view.upgrade.need ?? null }
      : null,
    lpKind: (view.lp && view.lp.kind) || null,
    role: (view.role && view.role.name) || null,
  };
  out.server = serverInfoOf(snap);   // 这台服务器是谁、它的盟约表和顾问的 0.3.1 差在哪
  out.nl = nlOf(out);          // 自然语言版建议（小框与 --once 都读它）
  return out;
}

/**
 * 服务器指纹：origin + 它自己的盟约表 vs 顾问本地数据表（plugin/ui 里那份官方 0.3.1）。
 * 社区服经常改数据（合并服、MOD 服），顾问的数值按官方版算 —— 差多少要让玩家看见，而不是闷着头给建议。
 * 返回 null 表示这一帧没拿到（大厅/页面还没取数据）。
 */
function serverInfoOf(snap) {
  if (!snap || !snap.ok) return null;
  const ids = Array.isArray(snap.dataBonds) ? snap.dataBonds : null;
  if (!ids) return snap.origin ? { origin: snap.origin, bonds: null } : null;
  const local = Object.keys(DATA.bonds || {});
  const serverSet = new Set(ids);
  const localSet = new Set(local);
  const missing = local.filter((id) => !serverSet.has(id));      // 顾问认、本服没有（不该出现：会造成错误建议）
  const extra = ids.filter((id) => !localSet.has(id));           // 本服有、顾问不认（MOD/合服内容，顾问不会推荐）
  return {
    origin: snap.origin || null,
    bonds: ids.length, localBonds: local.length,
    missing: missing.slice(0, 12), extra: extra.slice(0, 12),
    exact: !missing.length && !extra.length,
  };
}

/**
 * 自然语言建议：把打分模型算出来的东西说成人话。
 *
 * 为什么要有它：原来的小框是「买#2 角峰 60金 / 放初雪→耶拉 / 冻#3 / 余3金别留」这种电报体，
 * 得先背下 #号=商店第几格、→=配对放大器、余=买完剩多少钱，才看得懂一句话在说什么。
 * 这里改成一句一件事、每句都带数字和理由。休整期先说「这回合动手做什么」，战斗中先说「这波怎么死」。
 *
 * 返回 string[]，空数组表示这一帧没有可说的（断连/大厅）。
 */
export function nlOf(box) {
  if (!box || box.text) return [];
  const out = [];
  // 引擎里的触发键 / 破甲通道是英文枚举，直接摆到小框上就是黑话（「叠层引擎（freeze）」「吃phys通道」）
  const EVENT_ZH = {
    ammo: '耗弹', death: '阵亡', freeze: '冻结', gain: '拿到牌', kill: '击杀',
    onstart: '开战', other: '其它触发', prepfin: '休整结束', prepstart: '休整开始',
    skill: '开技能', sold: '卖出',
  };
  const CHANNEL_ZH = { phys: '物理', magic: '法术', arts: '法术', true: '真实', real: '真实' };
  const human = (s) => {
    let t = String(s || '');
    for (const [k, v] of Object.entries(EVENT_ZH)) t = t.replace(new RegExp(`\\(${k}\\)`, 'g'), `（${v}时）`);
    return t;
  };
  const channelOf = (c) => CHANNEL_ZH[c] || c || '?';
  const money = (n) => `${n} 金`;
  const funds = box.funds || 0;
  const rows = box.rows || [];
  const top = rows[0];
  const inPrep = !box.phase || box.phase === 'PREP';
  const whyOf = (r) => (r && r.why && r.why.length ? r.why.map(human).join('、') : '');

  // ① 休整期：钱花在哪（三种口径来自模型的 advice.kind，这里不再拍一次脑袋）
  if (inPrep && box.adviceKind === 'buy' && top) {
    const gain = box.pickGain ? `；到手${box.pickGain.replace(/^\S+\s*/, '')}` : '';
    out.push(`先花 ${money(top.price)}买商店第 ${top.slot} 格的${top.name}——${whyOf(top) || '是这条线现在最值的一格'}${gain}。`);
    const second = rows[1];
    if (second && second.score >= 26 && funds >= top.price + second.price) {
      out.push(`钱还够，第 ${second.slot} 格的${second.name}（${money(second.price)}）可以顺手拿：${whyOf(second) || '补第二张'}。`);
    }
  } else if (inPrep && box.adviceKind === 'level' && box.upgrade) {
    out.push(`这回合先别抓牌，花 ${money(box.upgrade.cost)} 把调度中心升到 Lv${(box.level || 1) + 1}——${box.upgrade.why || '牌池升级后核心更好出'}。`);
  } else if (inPrep && box.adviceKind === 'refresh') {
    const want = (box.gap || []).slice(0, 2).map((g) => String(g).split(' ')[0]).join('、');
    out.push(`商店这几格不值得花，刷一次把它换掉${want ? `，目标是找${want}` : ''}：核心还没齐，装备可以往后放。`);
  } else if (inPrep && top && top.score >= 26) {
    out.push(`商店第 ${top.slot} 格的${top.name}可以拿（${money(top.price)}）：${whyOf(top) || '评分够'}。`);
  } else if (inPrep && funds === 0) {
    out.push(top
      ? `现在 0 金，但商店第 ${top.slot} 格的${top.name}（${money(top.price)}）值得留：冻住它，等下回合进账再买。`
      : '现在 0 金，商店里也没有要留的牌——这回合什么都不做，等进账。');
  } else if (inPrep) {
    out.push(`这回合不花这 ${money(funds)}：商店里没有这条线要的牌，留到下回合一起用。`);
  } else if (box.wave) {
    out.push(`第 ${box.round} 回合出怪中：这波 ${box.wave.total} 只${box.wave.fly ? `，其中 ${box.wave.fly} 只飞行` : ''}${box.wave.elite ? `、${box.wave.elite} 只精英` : ''}。`);
  }

  // ② 买到之后怎么摆（配对放大器 > 叠层放大器）——只有休整期才有得摆
  const pair = inPrep ? (box.pairs || [])[0] : null;
  if (pair) {
    out.push(`买完把${pair.amp}放到${pair.target}${pair.pos ? `的${pair.pos}` : '身前那一格'}——这一格能多叠 ${pair.gain} 层，摆错一格就白拿了。`);
  } else if (inPrep && box.stackPlace) {
    out.push(`叠层放大器要放前排第一格${box.stackChannel ? `（${human(box.stackChannel)}）` : ''}，位置类放大器摆错等于白占一个坑。`);
  }

  // ③ 钱不够 / 血线：这两件事都比「再加层」优先（0 金的情况在 ① 里已经说完了）
  if (inPrep && funds > 0 && top && top.price > funds && box.adviceKind !== 'buy') {
    out.push(`想要的${top.name}要 ${money(top.price)}，现在只有 ${money(funds)}——先冻住第 ${top.slot} 格，等钱够。`);
  }
  if (box.lpKind === 'hard') {
    out.push(`LP 只剩 ${box.lp}，再漏一波就结束：这回合先守，别拿血换层数。`);
  }

  // ④ 人数档位：说清楚「还差几个人、值不值得赌」
  if (box.tiers && !box.tiers.full && box.tiers.need != null) {
    const p = box.tierOdds ? box.tierOdds.p : null;
    const verdict = p == null ? '' : p >= 60 ? '，值得赌' : p >= 35 ? '，得看商店脸色' : '，别硬赌';
    const head = inPrep ? `场上 ${box.main.count} 人` : `这波打完 ${box.main.count} 人`;
    out.push(`${head}，再抓 ${box.tiers.need} 个就到 ${box.tiers.next} 人档${p != null ? `（按共享池折算约 ${p}%${verdict}）` : ''}。`);
  } else if (box.tiers && box.tiers.full) {
    out.push('人数档已经满了，接下来每一金都该换成层数或装备，不是再进人。');
  }

  // ⑤ 找谁叠：手里的先合精锐，没到手的按费用从低往高找（刚推荐买的那张不算「还缺」）
  if (box.gap && box.gap.length) {
    const names = box.gap
      .map((g) => String(g).trim())
      .filter((g) => !top || g.split(/\s+/)[0] !== top.name)
      .slice(0, 3)
      .map((g) => g.replace(/\s+/, '（') + '）');
    if (names.length) out.push(`这条线还缺 ${names.join('、')}，按费用从低往高抓；手上已有的先凑精锐。`);
  }

  // ⑥ 风险：飞行波 / BOSS 破甲（二选一，说更致命的那条）
  const flyShare = box.wave ? box.wave.fly / Math.max(1, box.wave.total) : 0;
  if (box.wave && flyShare >= 0.35) {
    const lack = box.wave.gap || 0;
    out.push(`这一波 ${box.wave.total} 只里有 ${box.wave.fly} 只飞行，场上能打空的只有 ${box.wave.have ?? '?'}/${box.wave.units ?? '?'} 个${lack > 0 ? `——至少再补 ${lack} 个对空，不然全从头上飞过去` : '，够用'}。`);
  } else if (box.armor && box.armor.need) {
    const gapAtk = Math.max(0, box.armor.need - (box.armor.have || 0));
    out.push(`本局 BOSS 是${box.armor.name}，弱点走${channelOf(box.armor.channel)}通道（系数 ${box.armor.k}）：破甲要 ${box.armor.need} 有效攻，你现在 ${box.armor.have}${box.armor.ok ? '，够了' : `，还差 ${gapAtk}`}。`);
  }

  // ⑦ 服务器数据对不上：顾问按官方 0.3.1 的盟约表算，社区服（合服/MOD）常常改表，先说清差在哪
  const sv = box.server;
  if (sv && sv.bonds != null && !sv.exact) {
    const bits = [];
    if (sv.extra && sv.extra.length) bits.push(`多 ${sv.extra.length} 个顾问不认识的盟约`);
    if (sv.missing && sv.missing.length) bits.push(`少 ${sv.missing.length} 个顾问要用的盟约（${sv.missing.slice(0, 3).join('/')}）`);
    out.push(`⚠ 本服（${String(sv.origin || '?').replace(/^https?:\/\//, '')}）有 ${sv.bonds} 个盟约，顾问按官方 0.3.1 的 ${sv.localBonds} 个算：${bits.join('、')}——建议里涉及这些盟约的部分会偏。`);
  }

  return out.slice(0, 7);
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
  if (box.nl && box.nl.length) return box.nl.join('\n');
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
 * 对局记录（复盘用）：往 records/<日期>.jsonl 追行。
 *
 * 什么时候写：① 进了新的「回合 + 阶段」；② 同一阶段里经济状态变了（买了 / 卖了 / 刷了 / 冻了 / 挪了位 / 升本）。
 * ②是逐动作粒度——只按阶段去重会把一回合里的四次购买压成一行，复盘时分不出先后，也算不出每买一张之后顾问改口成什么。
 * 写的是客户端事后不保留的东西：买了谁、放在哪（row/col/dir）、冻了哪格、装备给了谁、当时顾问说了什么。
 * 客户端只把「最终结果 + 终局上阵」写进 localStorage 的 sp.match-history.v1，过程不会留，所以由我们来记。
 */
const RECORD_DIR = path.join(path.dirname(STATE), 'records');

/**
 * 这一帧状态的指纹：钱、等级、上阵（含坐标）、手牌、商店（含槽位号与冻结）、盟约，
 * 外加每个队友的「粗状态」（LP / 调度中心等级 / 上阵人数 / 盟约人数）。
 * 只要它变了，就是有人动了一下（买 / 卖 / 刷 / 冻 / 摆位 / 升本 / 队友换了阵容），要落一行。
 * 只按 `阶段|回合` 去重的时候，一回合里的四次购买会被压成一行，复盘时看不出先后。
 *
 * 队友那部分只算「人数」不算层数：层数在战斗里每帧都在涨，放进指纹会把记录写成刷屏。
 */
export function recordKeyOf(priv, brief) {
  const slots = ((priv.shop && priv.shop.slots) || [])
    .map((s, i) => (s && !s.sold ? `${i + 1}:${s.id}:${s.price}${s.frozen ? 'F' : ''}` : '-'))
    .join(',');
  const board = (priv.board || []).map((p) => `${p.id}@${p.row},${p.col}`).join(',');
  const hand = (priv.hand || []).map((p) => p.id).join(',');
  const bonds = (priv.bonds || []).map((b) => `${b.bondId}=${b.count}/${b.layers ?? 0}`).join(',');
  const mates = ((brief && brief.players) || [])
    .map((p) => `${p.seat ?? '?'}:${p.alive ? 1 : 0}:${p.lp}:${p.shopLevel}:${p.boardCount}:${(p.bonds || []).map((b) => b.bondId + b.count).join('+')}`)
    .join(';');
  return `${priv.funds}|${(priv.shop && priv.shop.level) || 1}|${priv.lp}|${slots}|${board}|${hand}|${bonds}|${mates}`;
}

/** 队友（不含自己）的公开状态：LP / 调度中心 / 上阵人数 / 盟约（含层数）/ 状态（同一份 matesOf：advisor/team.mjs，自对局记录也用它） */
const matesOfSnap = (snap) => matesOf((snap.brief && snap.brief.players) || [], snap.me && snap.me.playerId);
/** 座位号 → 队友棋盘（点开看过的 / BOSS 搭档）：只在客户端收到时才有 */
function mateBoardsOf(snap) {
  const seatOf = (pid) => (((snap.brief && snap.brief.players) || []).find((p) => p.playerId === pid) || {}).seat;
  const out = {};
  for (const b of [snap.scout, snap.bossMate]) if (b && b.playerId && b.playerId !== (snap.me && snap.me.playerId) && seatOf(b.playerId) != null) out[seatOf(b.playerId)] = b.units;
  return Object.keys(out).length ? out : null;
}

async function recordTurn(snap, box) {
  if (!snap || !snap.ok || !snap.priv) return;
  const priv = snap.priv;
  // 阶段/回合变了必记；同一阶段里经济状态（含队友阵容）只要变了也记（逐动作），完全没动才跳过
  const boards = mateBoardsOf(snap);
  const server = serverInfoOf(snap);
  const key = `${snap.phase || '?'}|${snap.round || 0}|${recordKeyOf(priv, snap.brief)}|${snap.result ? 'R' : ''}|${boards ? JSON.stringify(boards).length : 0}`;
  if (recordTurn.last === key) return;
  recordTurn.last = key;
  const row = {
    at: new Date().toISOString(),
    phase: snap.phase, round: snap.round, mode: snap.brief && snap.brief.modeId,
    // 哪台服务器（社区服数据表常和官方不同；复盘时才知道这条记录来自哪个服）
    server,
    funds: priv.funds, lp: priv.lp, level: priv.shop && priv.shop.level,
    bonds: (priv.bonds || []).map((b) => `${b.bondId}:${b.count}/${b.layers ?? 0}`),
    board: (priv.board || []).map((p) => ({
      id: p.id, golden: !!p.golden, tier: p.tier, items: p.items || [],
      at: [p.row, p.col], dir: p.dir,
    })),
    hand: (priv.hand || []).map((p) => p.id),
    // slot 必须留：顾问说的是「槽位 3」，压掉已售格会让后面的位置整体前移，复盘时对不上
    shop: ((priv.shop && priv.shop.slots) || []).map((s, i) => (s && !s.sold ? { slot: i + 1, id: s.id, price: s.price, frozen: !!s.frozen } : null)).filter(Boolean),
    // 队友的公开状态（m.public.players）：看「他是怎么玩的」就靠这几列——LP / 升本节奏 / 上阵人数 / 盟约层数
    mates: matesOfSnap(snap),
    // 自己的座位（和 mates / result 里的 seat 对上）
    self: { seat: ((((snap.brief && snap.brief.players) || []).find((p) => p.playerId === (snap.me && snap.me.playerId))) || {}).seat ?? null },
    // 队友棋盘（点开看过才有，见 mateBoardsOf）与终局结算（只在 RESULT）
    mateBoards: boards,
    result: snap.result ? resultOf(snap.result, (snap.brief && snap.brief.bossHp && snap.brief.bossHp.max) || null) : null,
    // 合作进度：队伍 LP、BOSS 血池（谁的输出在扛）
    teamLp: (snap.brief && snap.brief.teamLp) ?? null,
    bossHp: (snap.brief && snap.brief.bossHp) || null,
    advice: box && box.advice ? box.advice : null,
    pick: box && box.pick ? `${box.pick.name}(${box.pick.score})` : null,
    terminal: box && box.terminal ? box.terminal.name : null,
    boss: box && box.armor ? `${box.armor.name} k=${box.armor.k}` : null,
    // 服务端给的统计（dmgDealt/bossDamage/kills/leaks/gold/refreshes/merges/itemsEquipped）——
    // 复盘时这比「赢没赢」有用得多，也直接对应 history 里的 stats 字段
    stats: priv.stats || null,
    // 所有座位的公开快照（局内可见：band / lp / 商店等级 / 各盟约人数）。
    // 之前只记自己的私视图，导致"别人怎么滚雪球"事后查不到 —— 这条补上。
    table: ((snap.brief && snap.brief.players) || []).map((q) => ({
      seat: q.seat, name: q.name, band: q.bandId, lp: q.lp, lv: q.shopLevel,
      bonds: (q.bonds || []).map((b) => (b.bondId || b.id) + ':' + (b.count || 0)).join(' '),
    })),
  };
  try {
    // --redact 换不干净会抛：宁可丢这一行，也不落半脱敏的数据
    const out = redact ? redactRow(row) : row;
    await fs.mkdir(RECORD_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    await fs.appendFile(path.join(RECORD_DIR, `${day}.jsonl`), JSON.stringify(out) + '\n');
  } catch (error) { if (log && redact) console.log(`记录跳过：${String(error.message || error).slice(0, 90)}`); }   // 记录失败不该影响顾问
}


/**
 * 对局结束时把结果落盘（append 到 records/<date>-results.jsonl）。
 * 客户端 localStorage['sp.match-history.v1'] 只保留极少数条目，而 match.result 在离开对局后就没了，
 * 所以必须在结束的那一刻抓下来 —— 否则「谁用缪尔赛思滚到多少层」这类复盘永远查不到。
 */
async function recordResult(cdp, snap) {
  if (!snap || !snap.ok) return;
  const key = `result|${snap.round || 0}|${snap.phase || ''}`;
  if (recordResult.last === key) return;
  const raw = await cdp.evaluate(`(() => {
    const st = (globalThis.__SP__.store.get() || {});
    const res = (st.match && st.match.result) || null;
    let histLast = null;
    try {
      const h = JSON.parse(localStorage.getItem('sp.match-history.v1') || '{}');
      const e = (h.entries || [])[(h.entries || []).length - 1] || null;
      histLast = e ? { id: e.id, savedAt: e.savedAt, result: e.result } : null;
    } catch (err) { histLast = null; }
    return JSON.stringify({ result: res, historyLast: histLast });
  })()`);
  recordResult.last = key;
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { return; }
  if (!parsed || (!parsed.result && !parsed.historyLast)) return;
  try {
    await fs.mkdir(RECORD_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    await fs.appendFile(path.join(RECORD_DIR, `${day}-results.jsonl`),
      JSON.stringify({ at: new Date().toISOString(), phase: snap.phase, round: snap.round, ...parsed }) + '\n');
  } catch { /* 记录失败不影响顾问 */ }
}

async function main() {
  let cdp = null;
  let said = '';
  const tick = async () => {
    try {
      if (!cdp) cdp = await connect({ port });
      await reloadAdvisor();                       // 逻辑/数据热更新：文件一变就用新的
      const snap = await cdp.evaluate(SNAPSHOT);
      const box = boxOf(snap, await readRoute(snap && snap.ok ? api.matchKeyOf(snap.brief) : null));
      if (lineup) await lineup.attach(box, snap, cdp);   // 站位检查：在宿主线程里异步跑，这里只取它当前的结果（不等）
      await writeState(box);
      if (record) await recordTurn(snap, box);     // 复盘：逐回合落盘（含所有座位的公开快照）
      if (record && (snap.phase === 'RESULT' || snap.phase === 'FINAL_ASSAULT')) await recordResult(cdp, snap);
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
    await lineup?.close();
    const box = JSON.parse(await fs.readFile(STATE, 'utf8'));
    console.log(JSON.stringify(box, null, 2));
    return;
  }

  let stop = false;
  process.on('SIGINT', () => { stop = true; cdp?.close(); lineup?.close(); process.exit(0); });
  while (!stop) {
    const ok = await tick();
    await new Promise((r) => setTimeout(r, ok ? interval : 3000));
  }
}

// only run when executed directly: demo-state.mjs imports boxOf/writeState without starting the poller
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();
