import { makeMatch, createRng, deriveSeed } from '../eval/engine.mjs';

// Vanilla, no DIY/plugin adapter. Copy all PlayerState data into fresh owners/dispatchers.
// Never clone or consume the live RNG. Each branch uses an independent search stream.
export function forkPrep(source, sampleSeed) {
  const m=makeMatch(source.seed,source.order.length);
  for(const k of ['round','phase','uidSeq','factions','disabledBonds','staticInactiveBonds','bannedChess','bossId','hiddenBossId','bossPairs','bossWaves','wave','teamLp','hiddenLayerSum'])
    m[k]=structuredClone(source[k]);
  m.stageId=source.stageId; m.stage=source.stage;
  m.pool.entries=structuredClone(source.pool.entries);
  m.itemPool.debt=structuredClone(source.itemPool.debt);
  for(const ps of source.order) {
    if(Object.keys(ps.diy).length) throw Error('Search adapter supports vanilla no-DIY seats only');
    const p=m.players.get(ps.playerId);
    for(const [k,v] of Object.entries(ps)) {
      if(['m','gd','diyStock'].includes(k)) continue;
      if(typeof v==='function') throw Error(`Unsupported player function ${k}`);
      p[k]=structuredClone(v);
    }
    // Empty no-DIY stock keeps its own methods; no live object references.
    p.ready=false;
  }
  for(const name of ['Shop','Meta','Bots','Draft','Waves']) m[`rng${name}`]=createRng(deriveSeed(sampleSeed,name));
  m.markPublic=()=>{};m.markPrivate=()=>{};m.tickerFor=()=>{};m.sendTo=()=>true;
  return m;
}
