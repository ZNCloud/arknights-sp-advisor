// 盟约轴心表（sprlaxis_1532）：每条核心盟约（主轴）最搭的副羁绊 + 搭配强度，以及这条组合里值钱的道具。
// 一套公式管所有主轴，不按主轴开特例；三份数据：
//   T 牌表：同时带主轴和副羁绊的牌占主轴牌的比例（一张牌喂两条线）——插件页 D.chess；
//   H 真人：真人终局里「主轴 = A」的座位有多少激活了 B（且至少一张 B 的牌不带主轴），比全部座位的基础比例高多少
//          （向基础比例收缩，α=5 个座位）
//          ——owner 和队友的结算阵容（sprl_matches/games/*.json 逐提交还原的那份 + 10-21 三局）；
//   S 模拟：p0 钉在 A、只给 B 加权（s=1）对不加权，同一批种子配对，团队效用差减一个标准误（不够一个标准误就是 0）
//          ——eval/axis-bot.mjs 的跑数（out/exp1/runs）。
//   三项各除以全部（A,B）里的最大值缩到 0–1，搭配强度 = 三项平均；每条主轴留最强的 3 条（强度 > 0）。
// 道具：权重 = （绑定强度 + 真人提升）/ 2。绑定强度 = 装备绑定的盟约（giveBondId）是留下的副羁绊 B 时 = B 的强度，否则 0；
//   真人提升 = A 主轴座位上这件道具的出现率比全部座位高多少（同样收缩、同样缩到 0–1）。每条主轴留权重 ≥ 0.2 的前 5 件。
//   道具挂在它绑定的盟约上（本局被禁就不加）；不绑定盟约的挂在主轴上。
// node tools/axis-table.mjs --matches <sprl_matches 目录> --sim <runs 目录> [--write]
//   写 routes/_axis.gen.json（全部证据，给人看）；--write 再把 axis 表写进 plugin/ui/index.html 的 sp-data。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) { const k = args[i].slice(2); opt[k] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : '1'; }
const PAGE = path.join(repo, 'plugin', 'ui', 'index.html');
const MARK = '<script id="sp-data" type="application/json">';
const html = fs.readFileSync(PAGE, 'utf8');
const ds = html.indexOf(MARK) + MARK.length, de = html.indexOf('</script>', ds);
const D = JSON.parse(html.slice(ds, de));
const BO = D.bonds, CH = D.chess, IT = D.items;
const ITEMS = JSON.parse(fs.readFileSync(path.join(repo, '..', 'engine', 'data', 'items.json'), 'utf8'));
const giveOf = (id) => (ITEMS[id] && ITEMS[id].giveBondId) || null;
const baseItem = (id) => (ITEMS[id] && ITEMS[id].baseId) || id;

const ALPHA = 5, TOP = 3, ITEM_MIN = 0.2, ITEM_TOP = 5;
const cores = Object.keys(BO).filter((b) => BO[b].c === 1);
const members = (b) => new Set(Object.keys(CH).filter((id) => CH[id][4] === 0 && CH[id][2].includes(b)).map((id) => CH[id][5]));
// 副羁绊候选：非核心、至少 2 张牌的盟约（调和 1 张、绝技 0 张，不成「抓牌」的对象）
const cands = Object.keys(BO).filter((b) => BO[b].c !== 1 && members(b).size >= 2);

// ── T 牌表 ──
const T = {};
for (const A of cores) { const mA = members(A); T[A] = {}; for (const B of cands) { const mB = members(B); T[A][B] = [...mA].filter((x) => mB.has(x)).length / mA.size; } }

// ── H 真人 ──
function humanSeats(dir) {
  const seats = [], seen = new Set();
  const bondsOf = (bs) => (bs || []).map((b) => (typeof b === 'string'
    ? (([id, rest]) => { const [c, l] = rest.split('/').map(Number); return { bondId: id, count: c, layers: l, active: null }; })(b.split(':'))
    : { bondId: b.bondId, count: b.count || 0, layers: b.layers || 0, active: b.active }));
  const add = (game, p, src) => {
    const key = `${game}|${p.seat}|${p.playerId || ''}|${p.name || ''}`;
    if (seen.has(key) || p.isBot) return;
    seen.add(key);
    const bonds = bondsOf(p.bonds);
    const core = bonds.filter((b) => BO[b.bondId] && BO[b.bondId].c === 1);
    if (!core.length) return;
    const main = core.reduce((a, b) => (b.layers > a.layers ? b : a)).bondId;
    // 副羁绊算「激活」还要有至少一张场上的这条盟约的牌不带主轴：只靠主轴自己的牌顺带点亮的（如阿戈尔的水月带独行，
    // 独行 1 人就亮）不是玩家另外去抓的副羁绊。没有阵容明细的座位只能看激活标记。
    const cards = (p.lineup || []).map((u) => CH[u.id]).filter(Boolean);
    const outside = (B) => !cards.length || cards.some((c) => c[2].includes(B) && !c[2].includes(main));
    const active = new Set(bonds.filter((b) => b.bondId !== main && (b.active != null ? b.active : b.count >= (BO[b.bondId] ? BO[b.bondId].t[0] : 99)) && outside(b.bondId)).map((b) => b.bondId));
    const items = (p.lineup || []).flatMap((u) => (Array.isArray(u.items) ? u.items.map(baseItem) : []));
    seats.push({ game, main, active, items, itemIds: (p.lineup || []).some((u) => Array.isArray(u.items)), src });
  };
  for (const f of fs.readdirSync(path.join(dir, 'games')).filter((f) => f.endsWith('.json')).sort()) {
    const g = JSON.parse(fs.readFileSync(path.join(dir, 'games', f), 'utf8'));
    for (const p of ((g.resultDetail || {}).players || [])) add(g.gameId, p, 'games');
  }
  for (const line of fs.readFileSync(path.join(dir, 'derived', 'human_games.jsonl'), 'utf8').split('\n').filter(Boolean)) {
    const g = JSON.parse(line);
    for (const p of (g.players || [])) if (p.result && typeof p.result === 'object') add(g.gameId, p.result, 'turn-jsonl');
  }
  return seats;
}
const seats = humanSeats(opt.matches);
const lift = (k, n, p) => { const ph = (k + ALPHA * p) / (n + ALPHA); return p >= 1 ? 0 : Math.max(0, ph - p) / (1 - p); };
const H = {}, Hraw = {};
for (const A of cores) {
  const mine = seats.filter((s) => s.main === A);
  H[A] = {}; Hraw[A] = {};
  for (const B of cands) {
    const k = mine.filter((s) => s.active.has(B)).length, p = seats.filter((s) => s.active.has(B)).length / seats.length;
    H[A][B] = lift(k, mine.length, p);
    Hraw[A][B] = { k, n: mine.length, base: +p.toFixed(3) };
  }
}

// ── S 模拟 ──
function simRuns(dir) {
  const rows = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
    const [A, rest] = f.split('__'), B = rest.split('.')[0];
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(line);
      if (r.error || !r.pinOk) continue;
      ((rows[A] ||= {})[B] ||= {})[r.seed] = r;
    }
  }
  return rows;
}
const runs = simRuns(opt.sim);
const S = {}, Sraw = {};
for (const A of cores) {
  S[A] = {}; Sraw[A] = {};
  const off = (runs[A] || {}).off || {};
  for (const B of cands) {
    const on = (runs[A] || {})[B] || {};
    const d = Object.keys(on).filter((s) => off[s]).map((s) => ({ u: on[s].utility - off[s].utility, w: (on[s].win ? 1 : 0) - (off[s].win ? 1 : 0), r: on[s].p0Round - off[s].p0Round }));
    const n = d.length, mean = (k) => d.reduce((a, x) => a + x[k], 0) / Math.max(1, n);
    const mu = mean('u'), se = n > 1 ? Math.sqrt(d.reduce((a, x) => a + (x.u - mu) ** 2, 0) / (n - 1) / n) : Infinity;
    S[A][B] = n > 1 ? Math.max(0, mu - se) : 0;
    Sraw[A][B] = { n, dU: +mu.toFixed(4), se: +se.toFixed(4), dWin: +mean('w').toFixed(3), dP0Round: +mean('r').toFixed(2) };
  }
}

// ── 合成 ──
const gmax = (X) => Math.max(1e-9, ...cores.flatMap((A) => cands.map((B) => X[A][B])));
const tm = gmax(T), hm = gmax(H), sm = gmax(S);
const out = {}, evidence = {};
for (const A of cores) {
  const rows = cands.map((B) => {
    const t = T[A][B] / tm, h = H[A][B] / hm, s = S[A][B] / sm;
    return { id: B, name: BO[B].n, strength: +((t + h + s) / 3).toFixed(3), T: +t.toFixed(3), H: +h.toFixed(3), S: +s.toFixed(3), human: Hraw[A][B], sim: Sraw[A][B] };
  }).sort((a, b) => b.strength - a.strength);
  const keep = rows.filter((r) => r.strength > 0).slice(0, TOP);
  // 道具
  const mine = seats.filter((s) => s.main === A && s.itemIds), all = seats.filter((s) => s.itemIds);
  const ids = [...new Set(all.flatMap((s) => s.items))];
  const itemRows = Object.keys(IT).filter((id) => id === baseItem(id)).map((id) => {
    const g = giveOf(id), link = (keep.find((r) => r.id === g) || {}).strength || 0;   // 只认留下的副羁绊；主轴自己的装备内核另有打分
    const k = mine.filter((s) => s.items.includes(id)).length, p = all.filter((s) => s.items.includes(id)).length / Math.max(1, all.length);
    return { id, name: IT[id][1], give: g, link, hraw: lift(k, mine.length, p), k, n: mine.length, base: +p.toFixed(3) };
  });
  evidence[A] = { partners: rows, itemRows };
  out[A] = { keep, itemRows };
}
const ihm = Math.max(1e-9, ...cores.flatMap((A) => out[A].itemRows.map((r) => r.hraw)));
const axis = {};
for (const A of cores) {
  const items = out[A].itemRows.map((r) => ({ ...r, h: r.hraw / ihm, w: (r.link + r.hraw / ihm) / 2 }))
    .filter((r) => r.w >= ITEM_MIN).sort((a, b) => b.w - a.w).slice(0, ITEM_TOP);
  evidence[A].items = items.map((r) => ({ id: r.id, name: r.name, w: +r.w.toFixed(3), link: +r.link.toFixed(3), H: +r.h.toFixed(3), human: { k: r.k, n: r.n, base: r.base }, bond: r.link > 0 ? r.give : A }));
  const itemMap = {};
  for (const r of items) {
    const bond = r.link > 0 ? r.give : A, w = +r.w.toFixed(3);
    itemMap[r.id] = [w, bond];
    if (ITEMS[r.id] && ITEMS[r.id].goldenId) itemMap[ITEMS[r.id].goldenId] = [w, bond];
  }
  axis[A] = { partners: out[A].keep.map((r) => ({ id: r.id, s: r.strength })), items: itemMap };
  delete evidence[A].itemRows;
}
const meta = { method: 'strength = (T/maxT + H/maxH + S/maxS)/3; T = 两线共用牌/主轴牌; H = 收缩后的真人共激活提升 (α=5); S = max(0, 配对效用差 − 1SE)',
  maxima: { T: +tm.toFixed(4), H: +hm.toFixed(4), S: +sm.toFixed(4), itemH: +ihm.toFixed(4) },
  humanSeats: seats.length, humanSeatsWithItemIds: seats.filter((s) => s.itemIds).length, mains: Object.fromEntries(cores.map((A) => [A, seats.filter((s) => s.main === A).length])) };
fs.writeFileSync(path.join(repo, 'routes', '_axis.gen.json'), JSON.stringify({ meta, axis, evidence }, null, 1) + '\n');
if (opt.write) {
  D.axis = axis;
  fs.writeFileSync(PAGE, html.slice(0, ds) + JSON.stringify(D) + html.slice(de));
}
for (const A of cores) {
  console.log(`${BO[A].n}: ` + evidence[A].partners.slice(0, 5).map((r) => `${r.name} ${r.strength}(T${r.T} H${r.H} S${r.S})`).join(' | '));
  console.log('   道具: ' + evidence[A].items.map((r) => `${r.name} ${r.w}`).join(' | '));
}
