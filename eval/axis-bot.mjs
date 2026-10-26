// 盟约轴心权重的模拟对局（sprlaxis_1532）。p0 = g06 + 规则 A（g11_A 的 sellFund），买牌时再加上顾问内核自己算的
// 轴心分（插件页 axisCardOf / axisItemOf，经 guides/policy.mjs 的 m.guideAxis 钩子，乘 axisScale 折到攻略的买牌分上），
// 其余 3 个座位照 g06。同一批种子跑「有表」「无表」两臂即配对比较；--pin 把 p0 的主线钉成某条核心（建表的干预实验）。
// node eval/axis-bot.mjs --seeds 30001-30010 --out x.jsonl [--axis table.json|off] [--pin egirShip] [--scale 0.3]
//   [--page plugin/ui/index.html] [--guide guides/g06_final.json] [--ruleA 0]
//   --axis: 用这份表替换插件页的 D.axis 再加载内核（off = 删掉 D.axis，等于规则 A 那版顾问）；不给 = 插件页自带的表。
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAdvisor } from '../core-loader.mjs';
import { makeMatch, runToEnd, errorsOf } from './engine.mjs';
import { installGuide } from '../guides/policy.mjs';
import { traceBattles, outcomeOf } from '../advisor/rollout.mjs';

const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) { if (!args[i].startsWith('--')) throw Error(`Expected --flag, got ${args[i]}`); opt[args[i].slice(2)] = args[++i]; }
const seeds = (opt.seeds || '30001-30002').split(',').flatMap((r) => { const [a, b] = r.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(opt.guide || join(here, '..', '..', 'guides', 'g06_final.json'), 'utf8'));
const RULE_A = { fromRound: 3, untilRound: 12, gap: 3, maxSells: 2 };   // humanopt_1231 g11_A，与顾问内核 RULE_A 相同
const scale = Number(opt.scale ?? 0.3), pin = opt.pin || null;

let page = opt.page || join(here, '..', 'plugin', 'ui', 'index.html');
if (opt.axis) {
  const MARK = '<script id="sp-data" type="application/json">';
  const html = readFileSync(page, 'utf8'), s = html.indexOf(MARK) + MARK.length, e = html.indexOf('</script>', s);
  const D = JSON.parse(html.slice(s, e));
  if (opt.axis === 'off') delete D.axis; else D.axis = JSON.parse(readFileSync(opt.axis, 'utf8'));
  page = `${opt.out}.page.html`;                        // 写在 --out 旁边，不写 /tmp
  mkdirSync(dirname(page), { recursive: true });
  writeFileSync(page, html.slice(0, s) + JSON.stringify(D) + html.slice(e));
}
const { api } = await loadAdvisor(page);

const p0Spec = { axisScale: scale };
if (opt.ruleA !== '0') p0Spec.sellFund = RULE_A;
if (pin) p0Spec.route = pin;
const seatSpec = { ...spec, seats: { ...(spec.seats || {}), p0: { ...((spec.seats || {}).p0 || {}), ...p0Spec } } };

// 内核的轴心分：主线 = 攻略给 p0 的线；副羁绊进度读引擎的盟约人数（和客户端私有视图同一份）；本局禁用的盟约照禁。
function axisHook(m) {
  return (ps, id) => {
    if (ps.playerId !== 'p0') return 0;
    const priv = { bonds: Object.entries(ps.bonds).map(([bondId, b]) => ({ bondId, count: b.count || 0 })) };
    const ctx = { axis: api.axisCtxOf(priv, m.guideTeam.routes.p0, { disabledBonds: m.disabledBonds }) };
    const hit = ps.gd.item(id) ? api.axisItemOf(id, ctx) : api.axisCardOf(id, ctx);
    return hit ? hit.pts : 0;
  };
}

function snapOf(m, ps) {
  return { round: m.round, alive: ps.alive, lp: ps.lp, level: ps.shop.level,
    bonds: Object.fromEntries(Object.entries(ps.bonds).filter(([id, b]) => b.active || (ps.layers[id] || 0) > 0)
      .map(([id, b]) => [id, [b.count || 0, b.active ? 1 : 0, ps.layers[id] || 0]])),
    items: [...ps.board.values()].filter((p) => p.kind === 'chess').flatMap((p) => (p.items || []).map((i) => i.id)) };
}

if (opt.out) mkdirSync(dirname(opt.out), { recursive: true });
for (const seed of seeds) {
  const t = Date.now(), rec = { seed, pin, axis: opt.axis || 'page', scale, snaps: {} };
  const m = makeMatch(seed, 4);
  installGuide(m, seatSpec);
  m.guideAxis = axisHook(m);
  const battles = traceBattles(m);
  const end = m.endPrep;
  let lastPrep = 0;
  m.endPrep = function (...a) {
    const r = end.apply(this, a), ps = this.order[0];
    if (ps.alive) { lastPrep = this.round; if ([6, 8, 10, 12, 14].includes(this.round)) rec.snaps[this.round] = snapOf(this, ps); }
    return r;
  };
  let summary;
  try { m.start(); summary = runToEnd(m); } catch (e) { rec.error = String((e && e.message) || e).slice(0, 300); }
  if (summary) Object.assign(rec, outcomeOf(m, summary, battles));
  const p0 = m.order[0], err = errorsOf(m);
  rec.route = m.guideTeam.routes.p0;
  rec.pinOk = !pin || rec.route === pin;
  rec.p0Round = p0.alive ? m.round : lastPrep;
  rec.disabled = m.disabledBonds;
  rec.engineErrors = err.match + err.sim;
  const mine = m.guideActions.filter((x) => x.player === 'p0' && x.ok);
  rec.buys = mine.filter((x) => x.type === 'buy').length;
  rec.sellFund = mine.filter((x) => x.type === 'sell_fund').length;
  const p0ms = m.guideDecisionMs;                       // 每个座位每回合的攻略决策用时（毫秒），取均值
  rec.prepMs = +(p0ms.reduce((a, b) => a + b, 0) / Math.max(1, p0ms.length)).toFixed(2);
  rec.final = snapOf(m, p0);
  rec.wallMs = Date.now() - t;
  m.dispose();
  const line = JSON.stringify(rec);
  if (opt.out) appendFileSync(opt.out, line + '\n'); else console.log(line);
}
