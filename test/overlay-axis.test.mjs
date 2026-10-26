// node --test test/overlay-axis.test.mjs — 盟约轴心权重（sprlaxis_1532）默认开；--no-axis 退回规则 A 那版：state.json、
// 日志和对局记录与规则 A 那版 overlay（944df5e）逐字节相同。金样本 test/fixtures/overlay-rulea.golden.json 是 944df5e 的
// overlay.mjs 在同一个 harness、同一批帧（test/fixtures/overlay-frames.jsonl）、默认开关下的输出；站位检查在自己的线程上
// 异步出结果，两边都只去掉它那一段（overlay-harness.mjs withoutLineup），其余逐字节比。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOverlay, withoutLineup } from './overlay-harness.mjs';

const fx = (f) => new URL(`./fixtures/${f}`, import.meta.url);
const frames = fs.readFileSync(fx('overlay-frames.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const golden = JSON.parse(fs.readFileSync(fx('overlay-rulea.golden.json'), 'utf8'));
const ARGS = ['--watch', '--log', '--interval', '20'];

test('--no-axis: state.json, log and records are byte-identical to the rule-A overlay (944df5e)', async () => {
  const r = withoutLineup(await runOverlay({ frames, args: [...ARGS, '--no-axis'] }));
  assert.equal(r.transcript.length, golden.transcript.length);
  r.transcript.forEach((t, i) => assert.equal(t.state, golden.transcript[i].state, `state.json after tick ${i} (${t.frame})`));
  assert.equal(r.stdout, golden.stdout);
  assert.deepEqual(r.records, golden.records);
  assert.ok(r.transcript.every((t) => t.state === undefined || !JSON.parse(t.state).axis), 'no axis field under --no-axis');
});

test('default (axis on): the same frames now carry the axis line, so the switch above really is what makes them equal', async () => {
  const r = withoutLineup(await runOverlay({ frames, args: ARGS }));
  const states = r.transcript.filter((t) => t.state !== undefined).map((t) => JSON.parse(t.state));
  const prep = states.filter((s) => s.axis && s.phase === 'PREP');   // 战斗中不说这句（nlOf 只在休整期说）
  assert.ok(prep.length > 0, 'axis field in at least one prep state');
  assert.ok(prep.every((s) => s.nl.some((l) => l.startsWith(`轴心是${s.axis.main}`))), 'the axis sentence is in the advice text');
  assert.notEqual(r.stdout, golden.stdout);
});
