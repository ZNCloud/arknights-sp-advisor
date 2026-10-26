// node --test test/overlay-badges.test.mjs — 商店卡片/刷新/freeze 按钮的权重标注（sprlui_1825）默认开；--no-badges 退回
// 轴心权重那版（d73ea8c）：state.json、日志和对局记录逐字节相同。金样本 test/fixtures/overlay-axis.golden.json 是
// d73ea8c 的 overlay.mjs 在同一个 harness、同一批帧（test/fixtures/overlay-frames.jsonl）、默认开关下的输出
// （withoutLineup：站位检查自己异步出结果，两边都去掉那一段，其余逐字节比，和 test/overlay-axis.test.mjs 同一套方法）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOverlay, withoutLineup } from './overlay-harness.mjs';

const fx = (f) => new URL(`./fixtures/${f}`, import.meta.url);
const frames = fs.readFileSync(fx('overlay-frames.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const golden = JSON.parse(fs.readFileSync(fx('overlay-axis.golden.json'), 'utf8'));
const ARGS = ['--watch', '--log', '--interval', '20'];

test('--no-badges: state.json, log and records are byte-identical to the axis-weight overlay (d73ea8c)', async () => {
  const r = withoutLineup(await runOverlay({ frames, args: [...ARGS, '--no-badges'] }));
  assert.equal(r.transcript.length, golden.transcript.length);
  r.transcript.forEach((t, i) => assert.equal(t.state, golden.transcript[i].state, `state.json after tick ${i} (${t.frame})`));
  assert.equal(r.stdout, golden.stdout);
  assert.deepEqual(r.records, golden.records);
  assert.ok(r.transcript.every((t) => t.state === undefined || !JSON.parse(t.state).badge), 'no badge field under --no-badges');
});

test('default (badges on): the same frames now carry a badge plan in PREP (silent — it paints the real DOM, not the text advice, so stdout is unchanged)', async () => {
  const r = withoutLineup(await runOverlay({ frames, args: ARGS }), { keepBadge: true });
  const states = r.transcript.filter((t) => t.state !== undefined).map((t) => JSON.parse(t.state));
  const prep = states.filter((s) => s.badge && s.phase === 'PREP');
  assert.ok(prep.length > 0, 'badge field in at least one prep state');
  assert.ok(prep.every((s) => Array.isArray(s.badge.slots) && typeof s.badge.refresh === 'number' && typeof s.badge.freeze === 'number'));
});

test('--g06 also reverts badges (the one universal switch): no badge field, byte-identical to before rule A / lineup / axis / badges', async () => {
  const r = withoutLineup(await runOverlay({ frames, args: [...ARGS, '--g06'] }));
  assert.ok(r.transcript.every((t) => t.state === undefined || !JSON.parse(t.state).badge), 'no badge field under --g06');
});
