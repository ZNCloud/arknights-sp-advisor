// Position interface: capture a PREP-phase match as plain data, save it as JSON, restore it as a live Match that can
// keep simulating. This is the single snapshot/restore implementation; search/fork.mjs delegates here.
import { makeMatch, createRng, deriveSeed } from '../eval/engine.mjs';

export const STATE_VERSION = 1;
const MATCH_KEYS = ['round','phase','uidSeq','factions','disabledBonds','staticInactiveBonds','bannedChess','bossId','hiddenBossId',
  'bossPairs','bossWaves','wave','teamLp','hiddenLayerSum','hiddenReached','stageId','stage',
  'offers','offerWin','offerSeq','draft','sp','lastResults','unitePlan','bossPool','_battleSeq','_uniteLeftKey'];
const RNG_NAMES = ['Setup','Shop','Meta','Bots','Draft','Waves'];
const SKIP_PLAYER = new Set(['m','gd','diyStock']);

const extraKeys = a => Object.getOwnPropertyNames(a).filter(k => k !== 'length' && !/^\d+$/.test(k));
// Deep copy that keeps own (also non-enumerable) non-index properties of arrays (the engine hangs the pre-rolled wave schedule on
// m.factions.picks; structuredClone and JSON.stringify both drop it, which silently changes every later wave).
export function clone(v) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'function') throw Error('clone: function value');
    return v;
  }
  if (v instanceof Map) return new Map([...v].map(([k, x]) => [clone(k), clone(x)]));
  if (v instanceof Set) return new Set([...v].map(clone));
  if (Array.isArray(v)) {
    const out = v.map(clone);
    for (const k of extraKeys(v)) Object.defineProperty(out, k, { value: clone(v[k]), writable: true, configurable: true, enumerable: Object.getOwnPropertyDescriptor(v, k).enumerable });
    return out;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return structuredClone(v);
  const out = {};
  for (const k of Object.keys(v)) out[k] = clone(v[k]);
  return out;
}

// Plain-data capture (structuredClone semantics: Maps/Sets kept). No live references survive.
export function capture(m) {
  if (m.phase !== 'PREP') throw Error(`capture needs PREP phase, got ${m.phase}`);
  const s = { version: STATE_VERSION, seed: m.seed, players: m.order.length, match: {}, pool: clone(m.pool.entries),
    itemDebt: clone(m.itemPool.debt), rng: Object.fromEntries(RNG_NAMES.map(n => [n, m[`rng${n}`].state()])), seats: [] };
  for (const k of MATCH_KEYS) s.match[k] = clone(m[k]);
  for (const ps of m.order) {
    if (Object.keys(ps.diy).length) throw Error('state capture supports vanilla no-DIY seats only');
    const p = {};
    for (const [k, v] of Object.entries(ps)) {
      if (SKIP_PLAYER.has(k)) continue;
      if (typeof v === 'function') throw Error(`Unsupported player function ${k}`);
      p[k] = clone(v);
    }
    s.seats.push(p);
  }
  return s;
}

// rngMode 'exact' continues the captured streams (replay check); 'resample' draws an independent future from
// sampleSeed (rollouts must not reuse the hidden future of the real game).
export function restore(s, { rngMode = 'resample', sampleSeed = 1, revealHiddenBoss = false } = {}) {
  if (s.version !== STATE_VERSION) throw Error(`state version ${s.version} != ${STATE_VERSION}`);
  const m = makeMatch(s.seed, s.players);
  for (const k of MATCH_KEYS) m[k] = clone(s.match[k]);
  m.pool.entries = clone(s.pool);
  m.itemPool.debt = clone(s.itemDebt);
  for (const src of s.seats) {
    const p = m.players.get(src.playerId);
    if (!p) throw Error(`seat ${src.playerId} missing`);
    for (const [k, v] of Object.entries(src)) p[k] = clone(v);
    p.ready = false;
  }
  for (const n of RNG_NAMES) m[`rng${n}`] = rngMode === 'exact' ? rngAt(s.rng[n]) : createRng(deriveSeed(sampleSeed, n));
  if (rngMode !== 'exact' && !revealHiddenBoss && m.round < m.gd.hiddenRound) {
    // The hidden boss is unrevealed before R15: a rollout samples it from the public weights.
    const w = m.gd.mode.hiddenBossWeights || {};
    if (Object.keys(w).length) m.hiddenBossId = createRng(deriveSeed(sampleSeed, 'hidden-boss')).weighted(Object.keys(w), id => w[id]);
  }
  m.markPublic = () => {}; m.markPrivate = () => {}; m.tickerFor = () => {}; m.sendTo = () => true;
  return m;
}
function rngAt(state) {
  // createRng(seed) starts at state=seed (seed 0 is remapped), so seed with the raw state and verify.
  const r = createRng(state);
  if (r.state() !== state) throw Error(`rng state ${state} not restorable`);
  return r;
}

// JSON codec: Map/Set are tagged so a position file round-trips exactly.
// Arrays with extra own properties are tagged too (see clone()).
export function toJSON(s) {
  return JSON.stringify(s, function (k, v) {
    if (v instanceof Map) return { $map: [...v] };
    if (v instanceof Set) return { $set: [...v] };
    if (Array.isArray(v)) {
      const extra = extraKeys(v);
      if (extra.length) return { $arr: [...v], $props: Object.fromEntries(extra.map(x => [x, v[x]])), $hidden: extra.filter(x => !Object.getOwnPropertyDescriptor(v, x).enumerable) };
    }
    return v;
  });
}
export function fromJSON(text) {
  return JSON.parse(text, (k, v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    if ('$map' in v) return new Map(v.$map);
    if ('$set' in v) return new Set(v.$set);
    if ('$arr' in v) {
      for (const [x, val] of Object.entries(v.$props)) Object.defineProperty(v.$arr, x, { value: val, writable: true, configurable: true, enumerable: !v.$hidden.includes(x) });
      return v.$arr;
    }
    return v;
  });
}
