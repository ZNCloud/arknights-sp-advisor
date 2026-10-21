#!/usr/bin/env node
// lab/replay.mjs — 把 overlay 记下来的对局重放成「每一拍顾问说了什么 / 你实际做了什么 / 差在哪」。
//
// 原理：客户端自己不保留过程，但 overlay 每进一个新阶段就把 store.get('match') 的私有视图抄一份
// （资金/等级/手牌/上阵/商店），同时记下当时顾问的结论。于是相邻两帧一比，资金、等级、商店、上阵的变化
// 就能反推出这一拍做了什么；同一帧里的 advice/pick 就是当时屏幕上的建议。
//
// 用法：
//   node lab/replay.mjs                 # 复盘 matches/ 下的全部对局
//   node lab/replay.mjs --file <path>   # 指定 jsonl（records/ 原文件也行）
//   node lab/replay.mjs --only-x        # 只看和顾问不一致的拍
//   node lab/replay.mjs --json          # 机器可读

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitMatches, tracksOf } from '../advisor/team.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

// ── 名字表：插件页里内嵌的 sp-data（干员/装备 id → 中文名），没有就退化成打 id ──────────────
const NAME = (() => {
  const file = path.join(ROOT, 'plugin', 'ui', 'index.html');
  try {
    const html = fs.readFileSync(file, 'utf8');
    const i = html.indexOf('id="sp-data"');
    const start = html.indexOf('>', i) + 1;
    const d = JSON.parse(html.slice(start, html.indexOf('</script>', start)));
    const map = new Map();
    for (const [id, row] of Object.entries(d.chess || {})) map.set(id, row[1]);
    for (const [id, row] of Object.entries(d.items || {})) map.set(id, row[1]);
    for (const [id, bond] of Object.entries(d.bonds || {})) map.set(id, bond.n);
    return map;
  } catch { return new Map(); }
})();
const nameOf = (id) => NAME.get(id) || id;
const bondName = (id) => NAME.get(id) || id;

const files = opt('--file')
  ? [path.resolve(opt('--file'))]
  : [path.join(ROOT, 'matches')].flatMap((dir) => (fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().map((f) => path.join(dir, f))
    : []));
if (!files.length) { console.error('没有 jsonl：用 --file 指定，或先把 records/ 拷到 matches/'); process.exit(1); }

const ECON = new Set(['ROUND_START', 'PREP', 'SP_DRAFT', 'UNITE']);

function view(row) {
  const bonds = new Map();
  for (const b of row.bonds || []) {
    const m = /^(.+?):(\d+)\/(\d+)$/.exec(String(b));
    if (m) bonds.set(m[1], { count: +m[2], layers: +m[3] });
  }
  return {
    phase: row.phase, round: row.round,
    funds: row.funds ?? 0, lp: row.lp ?? 0, level: row.level ?? 1,
    bonds,
    board: (row.board || []).map((p) => ({ id: p.id, golden: !!p.golden })),
    hand: (row.hand || []).slice(),
    shop: (row.shop || []).map((s) => ({ slot: s.slot ?? null, id: s.id, price: s.price, frozen: !!s.frozen })),
    advice: row.advice || null, pick: row.pick || null, boss: row.boss || null,
  };
}

const units = (v) => [...v.board.map((p) => p.id), ...v.hand];
const count = (arr) => arr.reduce((m, x) => (m.set(x, (m.get(x) || 0) + 1), m), new Map());
const gainedIds = (a, b) => { const pa = count(units(a)); return [...count(units(b))].filter(([id, n]) => n > (pa.get(id) || 0)).map(([id]) => id); };
const coreBond = (v) => { let best = null; for (const [id, b] of v.bonds) if (b.count > 0 && (!best || b.layers > best.layers)) best = { id, ...b }; return best; };
const sameShop = (a, b) => a.length === b.length && a.every((s, i) => s.id === b[i].id && s.frozen === b[i].frozen);
const sameUnits = (a, b) => { const x = count(units(a)), y = count(units(b)); if (x.size !== y.size) return false; for (const [k, v] of x) if (y.get(k) !== v) return false; return true; };
/** 只差「商店开门/关门」不算操作 */
const shopOnly = (a, b) => a.funds === b.funds && a.level === b.level && sameUnits(a, b);
/** 我自己这一拍真的变了（钱/等级/LP/商店/上阵/手牌）——队友变化不算我的决策 */
const selfChanged = (a, b) => a.funds !== b.funds || a.level !== b.level || a.lp !== b.lp
  || !sameUnits(a, b) || a.shop.length !== b.shop.length || a.shop.some((s, i) => !b.shop[i] || s.id !== b.shop[i].id || s.frozen !== b.shop[i].frozen);

function adviceOf(v) {
  const a = String(v.advice || '');
  const pickName = v.pick ? String(v.pick).replace(/\(.*\)$/, '') : null;
  const slotM = /槽位\s*(\d+)/.exec(a);
  let kind = 'none';
  // 顺序有讲究：「没有值得抓的，刷一次」也含「抓」，所以刷新要先判
  if (/刷/.test(a)) kind = 'refresh';
  else if (/抓/.test(a)) kind = 'buy';
  else if (/升调度中心/.test(a)) kind = 'level';
  else if (/忍住|没钱了|攒金/.test(a)) kind = 'wait';
  else if (a) kind = 'other';
  return { kind, pickName, slot: slotM ? Number(slotM[1]) : null, text: a };
}

/** 精锐化：同名的 _a 变成 _b（记录里 id 后缀就是精锐标记） */
const baseOf = (id) => String(id).replace(/_b$/, '_a');

function actionsBetween(prev, cur) {
  const acts = [];
  const dLevel = cur.level - prev.level;
  if (dLevel > 0) acts.push({ type: 'level', detail: `升调度中心 Lv${prev.level}→Lv${cur.level}` });

  const added = gainedIds(prev, cur);
  const prevAll = new Set(units(prev));
  const dSpent = prev.funds - cur.funds;
  for (const id of added) {
    const slot = prev.shop.find((s) => s.id === id);
    if (slot) { acts.push({ type: 'buy', name: nameOf(id), id, price: slot.price, detail: `买 ${nameOf(id)}（${slot.price} 金）` }); continue; }
    if (id !== baseOf(id) && prevAll.has(baseOf(id))) { acts.push({ type: 'golden', name: nameOf(id), detail: `合并出精锐 ${nameOf(id)}` }); continue; }
    // 钱确实少了 → 这是「商店在这一拍里换过之后买的」；没花钱才是真·奖励/掉落
    if (dSpent > 0) acts.push({ type: 'buy', name: nameOf(id), id, price: null, detail: `买 ${nameOf(id)}（这一拍内商店换过，价不详）` });
    else acts.push({ type: 'gain', name: nameOf(id), detail: `入手 ${nameOf(id)}（奖励/掉落）` });
  }

  for (const s of cur.shop) {
    const before = prev.shop.find((p) => p.id === s.id);
    if (s.frozen && (!before || !before.frozen)) acts.push({ type: 'freeze', name: nameOf(s.id), detail: `冻住 ${nameOf(s.id)}` });
  }

  const bought = acts.some((a) => a.type === 'buy');
  const turnedOver = prev.shop.length > 0 && cur.shop.length > 0
    && cur.shop.every((s) => !prev.shop.some((p) => p.id === s.id));
  const spent = prev.funds - cur.funds;
  // 刷新：商店换过（整体换掉，或钱正好少了 1 金且没买牌）
  if (!bought && prev.shop.length && cur.shop.length && (turnedOver || (spent === 1 && !sameShop(prev.shop, cur.shop)))) {
    acts.push({ type: 'refresh', detail: '刷了一次商店' });
  }

  if (!acts.length) acts.push(spent > 0 ? { type: 'spend', detail: `花了 ${spent} 金（看不出买了什么）` } : { type: 'hold', detail: '什么都没做' });
  return acts;
}

function verdictOf(adv, acts) {
  const bought = acts.filter((a) => a.type === 'buy');
  const names = bought.map((b) => b.name);
  const hit = adv.pickName && names.some((n) => n.includes(adv.pickName) || adv.pickName.includes(n));
  const leveled = acts.some((a) => a.type === 'level');
  const refreshed = acts.some((a) => a.type === 'refresh');
  const held = acts.every((a) => a.type === 'hold');

  if (adv.kind === 'buy') {
    if (hit) return { tag: '照做', ok: true, why: `买的就是顾问点的「${adv.pickName}」` };
    if (bought.length) return { tag: '换人', ok: false, why: `顾问点「${adv.pickName}」，你买了 ${names.join('、')}` };
    if (leveled) return { tag: '改用升本', ok: false, why: `顾问要买「${adv.pickName}」，你去升本` };
    if (refreshed) return { tag: '改用刷新', ok: false, why: `顾问要买「${adv.pickName}」，你去刷商店` };
    if (acts.some((a) => a.type === 'golden' || a.type === 'gain')) return { tag: '只动场上', ok: false, why: `顾问要买「${adv.pickName}」，你在合并/摆牌` };
    if (held) return { tag: '没动', ok: false, why: `顾问点的「${adv.pickName}」没买` };
    return { tag: '其它', ok: false, why: acts.map((a) => a.type).join('+') };
  }
  if (adv.kind === 'level') {
    if (leveled) return { tag: '照做', ok: true, why: '按建议升本' };
    if (bought.length) return { tag: '改用买', ok: false, why: `顾问要升本，你买了 ${names.join('、')}` };
    if (held) return { tag: '没动', ok: false, why: '建议升本，没升' };
    return { tag: '其它', ok: false, why: acts.map((a) => a.type).join('+') };
  }
  if (adv.kind === 'refresh') {
    if (refreshed) return { tag: '照做', ok: true, why: '按建议刷了商店' };
    if (bought.length) return { tag: '改用买', ok: false, why: `顾问要刷，你买了 ${names.join('、')}` };
    if (leveled) return { tag: '改用升本', ok: false, why: '顾问要刷，你升本' };
    if (held) return { tag: '没动', ok: false, why: '建议刷新，没刷' };
    return { tag: '其它', ok: false, why: acts.map((a) => a.type).join('+') };
  }
  if (adv.kind === 'wait') {
    if (held) return { tag: '照做', ok: true, why: '按建议存钱' };
    if (bought.length) return { tag: '超额买', ok: false, why: `顾问说存钱，你买了 ${names.join('、')}` };
    if (leveled) return { tag: '超额升本', ok: false, why: '顾问说存钱，你升本' };
    if (refreshed) return { tag: '超额刷新', ok: false, why: '顾问说存钱，你刷了商店' };
    return { tag: '其它', ok: false, why: acts.map((a) => a.type).join('+') };
  }
  return { tag: '无建议', ok: null, why: '这一帧顾问没有结论' };
}

const loadRows = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean)
  .sort((a, b) => String(a.at).localeCompare(String(b.at)));

const report = [];
for (const file of files) {
  splitMatches(loadRows(file)).forEach((m, mi) => {
    const frames = m.rows.map(view);
    const rounds = [...new Set(frames.map((f) => f.round).filter((r) => r > 0))].sort((a, b) => a - b);
    const beats = [];
    for (const round of rounds) {
      const inRound = frames.filter((f) => f.round === round);
      const econ = inRound.filter((f) => ECON.has(f.phase));
      const entry = econ.find((f) => f.shop.length > 0);
      if (!entry) continue;
      const adv = adviceOf(entry);
      if (adv.kind === 'none') continue;

      const steps = [];
      // 只看「商店开着」的帧：买 / 刷 / 冻 / 升本都发生在这里；关门之后（COMBAT 等）不构成决策
      const shops = econ.filter((f) => f.shop.length > 0);
      for (let i = 0; i + 1 < shops.length; i++) {
        const [a, b] = [shops[i], shops[i + 1]];
        if (shopOnly(a, b)) continue;
        if (!selfChanged(a, b)) continue;              // 只有队友动了，不算我这一拍
        const acts = actionsBetween(a, b);
        const real = acts.some((x) => ['buy', 'golden', 'gain', 'freeze', 'refresh', 'level', 'sell'].includes(x.type));
        const spent = acts.some((x) => x.type === 'spend');
        if (!real && !spent) continue;                 // 过账/收息之类的空拍
        steps.push([a, b]);
      }
      // 整回合一次都没动手：也记一拍「没动」，这样「顾问建议了、你没做」才看得见
      if (!steps.length) {
        // 老记录（只按阶段落盘）一回合只有一帧商店：退回「入口 → 本回合最后一帧」，把这一回合的动作合起来看
        const tail = econ[econ.length - 1];
        if (tail && tail !== entry) {
          const acts = actionsBetween(entry, tail);
          const real = acts.some((x) => ['buy', 'golden', 'gain', 'freeze', 'refresh', 'level', 'sell', 'spend'].includes(x.type));
          if (real) steps.push([entry, tail]);
        }
      }
      if (!steps.length) steps.push([entry, entry]);
      const cb0 = coreBond(entry);
      for (const [a, b] of steps) {
        const acts = actionsBetween(a, b);
        // 只有「商店开门」这一类的空拍不记
        if (acts.length === 1 && acts[0].type === 'hold' && sameUnits(a, b) && a.funds === b.funds && a.level === b.level) {
          // 保留：这就是「没动」
        }
        const cb = coreBond(b);
        // 顾问说的是「槽位 N」：如果这一帧的商店带了槽位号（新记录才有），顺手核一下点的是不是那张
        let slotCheck = null;
        if (adv.slot) {
          const at = entry.shop.find((s) => s.slot === adv.slot);
          if (at) slotCheck = { slot: adv.slot, name: nameOf(at.id), ok: !adv.pickName || nameOf(at.id) === adv.pickName };
        }
        beats.push({
          round, phase: a.phase,
          fundsBefore: a.funds, fundsAfter: b.funds,
          levelBefore: a.level, levelAfter: b.level,
          lpBefore: a.lp, lpAfter: b.lp,
          advice: adv, adviceNow: adviceOf(a).text, slotCheck,
          acts, verdict: verdictOf(adv, acts),
          core: cb ? { name: cb.id, count: cb.count, layers: cb.layers, dLayers: cb.layers - (cb0 && cb0.id === cb.id ? cb0.layers : 0) } : null,
        });
      }
    }
    const res = m.rows.find((r) => r.phase === 'RESULT');
    const last = frames[frames.length - 1];
    report.push({
      file: path.basename(file), match: mi + 1,
      rounds: rounds.length ? rounds[rounds.length - 1] : 0,
      endLp: res ? res.lp : last.lp,
      boss: frames.map((f) => f.boss).find(Boolean) || null,
      beats, players: tracksOf(m.rows).seats.map((p) => ({ ...p, series: p.rounds.map((x) => x.end) })),
      summary: beats.reduce((a, b) => { a[b.verdict.tag] = (a[b.verdict.tag] || 0) + 1; return a; }, {}),
    });
  });
}

if (flag('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const m of report) {
    console.log(`\n===== ${m.file} · 第 ${m.match} 局 · 打到 R${m.rounds} · 结束 LP${m.endLp} =====`);
    if (m.boss) console.log(`BOSS ${String(m.boss).replace(/^假想敌：/, '')}`);
    for (const b of m.beats) {
      if (flag('--only-x') && b.verdict.ok) continue;
      const mark = b.verdict.ok === true ? '✓' : b.verdict.ok === false ? '✗' : '·';
      const core = b.core ? `  〔${b.core.name} ${b.core.count}人 ${b.core.layers}层${b.core.dLayers ? ` ${b.core.dLayers > 0 ? '+' : ''}${b.core.dLayers}` : ''}〕` : '';
      console.log(`R${b.round} 金${b.fundsBefore}→${b.fundsAfter} Lv${b.levelBefore}→${b.levelAfter} LP${b.lpBefore}→${b.lpAfter}${core}`);
      console.log(`   顾问：${b.advice.text}`);
      console.log(`   你　：${b.acts.map((a) => a.detail).join(' / ')}`);
      console.log(`   ${mark} ${b.verdict.tag} — ${b.verdict.why}`);
      if (b.slotCheck && !b.slotCheck.ok) console.log(`   ⚠ 顾问说的槽位 ${b.slotCheck.slot} 上是「${b.slotCheck.name}」，和它点的「${b.advice.pickName}」不是同一张`);
    }
    // ── 每个座位怎么玩的：LP / 升本节奏 / 上阵人数 / 主叠层数 ──
    if (m.players && m.players.length > 1) {
      console.log('   —— 谁怎么玩（公开视图：LP / 调度中心 / 上阵 / 主叠盟约）——');
      for (const p of m.players) {
        const s = p.series.filter((x) => x.level != null || x.board != null);
        if (!s.length) continue;
        const first = s[0], lastS = s[s.length - 1];
        const coreTxt = lastS.core ? `${bondName(lastS.core.id)} ${lastS.core.count}人 ${lastS.core.layers}层` : '—';
        const who = p.self ? '我' : `${p.isBot ? 'bot' : '队友'} ${String(p.name).slice(0, 10)}${p.seat == null ? '' : `(seat${p.seat})`}`;
        console.log(`   ${who.padEnd(14)} Lv${first.level}→${lastS.level} · 上阵${first.board}→${lastS.board} · LP${first.lp}→${lastS.lp} · 主叠 ${coreTxt}`);
      }
      // 层数矩阵：一眼看出谁在扛输出
      const rounds = [...new Set(m.players.flatMap((p) => p.series.map((x) => x.round)))].sort((a, b) => a - b);
      console.log(`   层数矩阵（主叠盟约层数，按回合）`);
      console.log(`   ${'座位'.padEnd(14)}${rounds.map((r) => `R${r}`.padStart(5)).join('')}`);
      for (const p of m.players) {
        const byRound = new Map(p.series.map((x) => [x.round, x.core ? x.core.layers : 0]));
        const cells = rounds.map((r) => String(byRound.get(r) ?? '').padStart(5)).join('');
        const who = p.self ? '我' : `${p.isBot ? 'bot' : '队友'}${String(p.name).slice(0, 8)}`;
        console.log(`   ${who.padEnd(14)}${cells}`);
      }
    }
    console.log(`   —— ${Object.entries(m.summary).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('  ')}`);
  }
  const all = report.reduce((a, m) => { for (const [k, v] of Object.entries(m.summary)) a[k] = (a[k] || 0) + v; return a; }, {});
  console.log(`\n# 全部 : ${Object.entries(all).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('  ')}`);
}
