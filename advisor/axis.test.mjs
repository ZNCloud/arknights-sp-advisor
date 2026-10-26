// node --test advisor/axis.test.mjs — 盟约轴心权重（sprlaxis_1532）：主轴 → 副羁绊 → 牌和道具加权，表在插件页 D.axis
// （tools/axis-table.mjs 从数据算出）。直接打插件内核（core-loader.mjs），不依赖表里的具体数值：取表里第一条有副羁绊的主轴。
//   * 副羁绊的牌加 round(30×强度)，理由里写「轴心X配Y」；不再扣「不搭路线」；
//   * 副羁绊人数到了最高档、或本局被禁，就不加；为它加权的道具也跟着不加；
//   * 主轴变了，配的副羁绊跟着变；
//   * pub.noAxis / pub.g06：整份 analyseState 结果与插件页去掉 D.axis 之后逐字节相同。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAdvisor } from '../core-loader.mjs';

const PAGE = fileURLToPath(new URL('../plugin/ui/index.html', import.meta.url));
const { DATA, api } = await loadAdvisor(PAGE);
const chess = DATA.chess;

// 同一页去掉 D.axis（= 规则 A 那版的数据）
const MARK = '<script id="sp-data" type="application/json">';
const html = fs.readFileSync(PAGE, 'utf8'), ds = html.indexOf(MARK) + MARK.length, de = html.indexOf('</script>', ds);
const bare = JSON.parse(html.slice(ds, de));
delete bare.axis;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axis-test-'));
const barePage = path.join(dir, 'index.html');
fs.writeFileSync(barePage, html.slice(0, ds) + JSON.stringify(bare) + html.slice(de));
const old = (await loadAdvisor(barePage)).api;
fs.rmSync(dir, { recursive: true, force: true });

const route = Object.keys(DATA.axis || {}).find((a) => DATA.axis[a].partners.length);
const partner = route && DATA.axis[route].partners[0];
const base = (id) => chess[id][5];
// 一张只带副羁绊、不带主轴的 1–2 阶牌（普通形态）
const pCard = route && Object.keys(chess).find((id) => chess[id][4] === 0 && chess[id][2].includes(partner.id) && !chess[id][2].includes(route));
const slot = (id) => ({ id, kind: 'chess', price: chess[id][3] });
const privOf = (extra = {}) => ({ funds: 20, round: 6, lp: 40, shop: { level: 3, slots: [slot(pCard)] }, hand: [], board: [], bonds: [], ...extra });
const rowOf = (view) => view.rows.find((r) => r.id === pCard);

test('表里有主轴和副羁绊（tools/axis-table.mjs 写进了插件页）', () => {
  assert.ok(route, 'D.axis has a core with partners');
  assert.ok(pCard, `a card of partner ${partner.id} without ${route}`);
});

test('副羁绊的牌加 round(30×强度)，理由里写明轴心和副羁绊，不再算「不搭路线」', () => {
  // 手上已有一张（+14），不加权时分数也在 0 以上，差值不被 Math.max(0, …) 截掉
  const priv = () => privOf({ hand: [{ kind: 'chess', id: pCard }] });
  const on = rowOf(api.analyseState(priv(), { round: 6 }, route));
  const off = rowOf(api.analyseState(priv(), { round: 6, noAxis: true }, route));
  assert.ok(off.score > 0);
  const pts = Math.round(30 * partner.s);
  assert.equal(on.score - off.score, pts + 8);          // +pts，且去掉 -8「不搭路线」
  assert.ok(on.why.includes(`轴心${DATA.bonds[route].n}配${DATA.bonds[partner.id].n}（+${pts}）`), on.why.join(' / '));
  assert.ok(!on.why.includes('不搭路线'));
  assert.ok(off.why.includes('不搭路线'));
});

test('副羁绊人数到最高档就不再加；本局被禁就不配（为它加权的道具也不加）', () => {
  const t = DATA.bonds[partner.id].t, full = t[t.length - 1];
  const capped = rowOf(api.analyseState(privOf({ bonds: [{ bondId: partner.id, count: full, layers: 0 }] }), { round: 6 }, route));
  assert.ok(!capped.why.some((w) => w.startsWith('轴心')), capped.why.join(' / '));
  const banned = api.analyseState(privOf(), { round: 6, disabledBonds: [partner.id] }, route);
  assert.ok(!rowOf(banned).why.some((w) => w.startsWith('轴心')));
  assert.ok(!banned.axis.partners.some((p) => p.id === partner.id));
  const item = Object.keys(DATA.axis[route].items).find((id) => DATA.axis[route].items[id][1] === partner.id);
  if (item) {
    const ctxOn = { axis: api.axisCtxOf({ bonds: [] }, route, {}) }, ctxBan = { axis: api.axisCtxOf({ bonds: [] }, route, { disabledBonds: [partner.id] }) };
    assert.ok(api.axisItemOf(item, ctxOn).pts > 0);
    assert.equal(api.axisItemOf(item, ctxBan), null);
  }
});

test('主轴变了，配的副羁绊跟着变', () => {
  const other = Object.keys(DATA.axis).find((a) => a !== route && JSON.stringify(DATA.axis[a].partners) !== JSON.stringify(DATA.axis[route].partners));
  assert.ok(other);
  const a = api.analyseState(privOf(), { round: 6 }, route).axis, b = api.analyseState(privOf(), { round: 6 }, other).axis;
  assert.equal(a.route, route);
  assert.equal(b.route, other);
  assert.notDeepEqual(a.partners.map((p) => p.id), b.partners.map((p) => p.id));
});

test('noAxis / g06：analyseState 整份结果与没有 D.axis 的插件页逐字节相同（真实对局帧 + 每条主轴）', () => {
  const frames = fs.readFileSync(new URL('../test/fixtures/overlay-frames.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const privs = frames.map((f) => f.match && f.match.private).filter((p) => p && p.shop);
  privs.push(privOf());
  let n = 0;
  for (const priv of privs) for (const r of Object.keys(DATA.axis)) for (const sw of [{ noAxis: true }, { g06: true }]) {
    const pub = { round: 6, ...sw };
    assert.equal(JSON.stringify(api.analyseState(priv, pub, r)), JSON.stringify(old.analyseState(priv, pub, r)), `${r} ${JSON.stringify(sw)}`);
    n++;
  }
  assert.ok(n >= 16);
});
