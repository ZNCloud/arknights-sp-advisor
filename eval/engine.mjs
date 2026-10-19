// Offline adapter. Engine stays in the sibling engine/ checkout, unmodified.
import { fileURLToPath } from 'node:url';
export const engineRoot = fileURLToPath(new URL('../../engine/', import.meta.url));
const imp = p => import(new URL(`../../engine/${p}`, import.meta.url));
export const { Match } = await imp('server/match/Match.js');
export const { VirtualScheduler } = await imp('server/match/scheduler.js');
export const { getData } = await imp('server/data.js');
export const { arrange, botPrep, buyScoreOf, itemTarget } = await imp('server/match/bot.js');
export const { createRng, deriveSeed } = await imp('server/sim/rng.js');
export const { planBoard, applyBoard } = await imp('tools/balance.mjs');
export const data = getData({ log: { info() {}, warn() {}, error() {} } });
export function makeMatch(seed, players, extra = {}) {
  const errors = [];
  const m = new Match({ roomCode: 'DESIGN', mode: players === 1 ? 'solo' : 'coop', difficulty: 'ABYSS',
    seed, data, seats: Array.from({ length: players }, (_, i) => ({ seat: i, playerId: `p${i}`, name: `P${i}`, isBot: true, connected: true })),
    scheduler: new VirtualScheduler(), clientCombat: false, botRehearsal: 0,
    log: { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) },
    send: () => true, broadcast() {}, onEnd() {}, ...extra });
  m.diagnosticErrors = errors;
  return m;
}
export function stateRow(m) {
  return m.order.map(p => ({ player: p.playerId, alive: p.alive, lp: p.lp, level: p.shop.level,
    layers: { ...p.layers }, totalLayers: Object.values(p.layers).reduce((a,b)=>a+b,0), activeLayers: p.activatedLayers(),
    funds: p.funds, buys: p.stats.buys, fundsGained: p.stats.fundsGained,
    bonds:Object.fromEntries(Object.entries(p.bonds).map(([id,b])=>[id,{active:!!b.active,layers:b.layers,count:b.count}])),
    board: [...p.board].map(([cell,x])=>({ cell, id:x.id, items:x.items?.map(i=>i.id) })), hand:p.hand.filter(Boolean).map(x=>x.id) }));
}
export function errorsOf(m) {
  return { match: m.errorCount || 0, sim: m.simErrors || 0, meta: m.dispatcher.errors || 0, log: m.diagnosticErrors };
}
export function runToEnd(m, { onPhase = () => {} } = {}) {
  let last = '';
  m.sched.runUntil(() => {
    const key = `${m.round}:${m.phase}`;
    if (key !== last) { last = key; onPhase(m); }
    return m.phase === 'RESULT';
  }, { maxSteps: 5e6 });
  if (m.phase !== 'RESULT') throw new Error(`unfinished ${m.phase} R${m.round}`);
  return m.lastResultMsg;
}
