// node --test advisor/rulea.test.mjs — 规则 A「卖线外牌凑钱」(sprlruleA_1345, humanopt_1231 g11_A)：默认开，
// pub.g06 是唯一的退回开关；退回时 adviceOf 和加规则 A 之前逐字节相同（test/overlay-lineup.test.mjs 另外在
// overlay 整条主路上锁了这一点）。这里直接打插件内核（core-loader.mjs），构造一个「钱差一点、场上有张线外独苗」
// 的真实局面：差额在规则 A 的窗口（R3–R12、差价 ≤3）内才会触发，省一张卖一张，刚好能买到想要的那格。
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadAdvisor } from '../core-loader.mjs';

const PAGE = fileURLToPath(new URL('../plugin/ui/index.html', import.meta.url));
const { DATA, api } = await loadAdvisor(PAGE);

const route = 'victoriaShip';
const chess = DATA.chess;
// 一张本线的 1 阶干员（够不上档外加成，分数纯粹来自「本线 +1」，资金不够时会被扣到 40 分以下）
const onRoute = Object.keys(chess).filter((id) => chess[id][2].includes(route) && chess[id][4] === 0 && chess[id][0] === 1)
  .sort((a, b) => chess[a][3] - chess[b][3])[0];
// 一张线外 1 阶干员：卖出正好能补上差额
const offRoute = Object.keys(chess).filter((id) => !chess[id][2].includes(route) && chess[id][4] === 0 && chess[id][0] === 1)[0];
const price = chess[onRoute][3];

function privOf({ funds, board }) {
  return { funds, round: 5, lp: 40, shop: { level: 2, slots: [{ id: onRoute, kind: 'chess', price }] }, hand: [], board, bonds: [] };
}

test('规则 A 默认开：差一点钱时，卖线外独苗凑钱，建议改成 sell_fund', () => {
  const priv = privOf({ funds: price - 1, board: [{ kind: 'chess', id: offRoute, row: 0, col: 0 }] });
  const view = api.analyseState(priv, { round: 5 }, route);
  assert.equal(view.advice.kind, 'sell_fund');
  assert.deepEqual(view.advice.sell, [offRoute]);
  assert.match(view.advice.text, /卖 .+（补 1 金）→ 抓 /);
});

test('--g06：同一局面退回旧行为，逐字节不变（不卖牌，也不提规则 A）', () => {
  const priv = privOf({ funds: price - 1, board: [{ kind: 'chess', id: offRoute, row: 0, col: 0 }] });
  const on = api.analyseState(priv, { round: 5, g06: false }, route);
  const off = api.analyseState(priv, { round: 5, g06: true }, route);
  assert.equal(on.advice.kind, 'sell_fund');   // 默认开：确认下面的差异确实来自 g06，不是局面本身就没有卖的建议
  assert.equal(off.advice.kind, 'wait');
  assert.equal(off.advice.text, '钱会被清零（剩 ' + (price - 1) + ' 金）→ 买装备/升本/刷，别留');
});

test('钱够的时候不触发：直接正常买，g06 开关不改变任何东西', () => {
  const priv = privOf({ funds: price, board: [] });
  const on = api.analyseState(priv, { round: 5 }, route);
  const off = api.analyseState(priv, { round: 5, g06: true }, route);
  assert.deepEqual(on.advice, off.advice);
  assert.equal(on.advice.kind, 'buy');
});

test('卖不出凑不够差额：场上没有线外牌可卖，不建议卖（也不会因为差 gap 就瞎卖本线的牌）', () => {
  const priv = privOf({ funds: price - 1, board: [{ kind: 'chess', id: onRoute, row: 0, col: 0 }] });   // 场上只有一张本线的牌
  const view = api.analyseState(priv, { round: 5 }, route);
  assert.notEqual(view.advice.kind, 'sell_fund');
});

test('回合窗口外（R13，超过 g11_A 的 untilRound=12）不触发，即使差额和线外牌条件都满足', () => {
  const priv = privOf({ funds: price - 1, board: [{ kind: 'chess', id: offRoute, row: 0, col: 0 }] });
  priv.round = 13;
  const view = api.analyseState(priv, { round: 13 }, route);
  assert.notEqual(view.advice.kind, 'sell_fund');
});
