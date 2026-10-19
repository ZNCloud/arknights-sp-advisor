import { createRng, deriveSeed, botPrep, errorsOf, runToEnd } from '../eval/engine.mjs';
import { forkPrep } from './fork.mjs';
import { wilson } from '../eval/stats.mjs';

// Optional OFFLINE joint continuation. Exact Match outcome, baseline continuation policy.
// applyFirst is a callback on the detached match, so this module never imports core (no cycle).
export function estimateContinuation(source,{samples=4,searchSeed=91723,applyFirst=null,reservations={}}={}) {
  const rows=[];
  for(let i=0;i<samples;i++) {
    const seed=deriveSeed(searchSeed,`rollout:${source.round}:${i}`),m=forkPrep(source,seed);
    m.seed=seed;m.hiddenReached=source.hiddenReached;
    if(m.round<15) {
      const weights=m.gd.mode.hiddenBossWeights||{};
      const rng=createRng(deriveSeed(seed,'unrevealed-hidden-boss'));
      m.hiddenBossId=rng.weighted(Object.keys(weights),id=>weights[id]);
    }
    if(applyFirst)applyFirst(m);
    m.scheduleBotPrep=function(p){this.later(0,()=>{
      if(!p.alive||p.ready||this.phase!=='PREP')return;
      const buy=p.buy;
      p.buy=function(slot){const s=this.shop.slots[slot],owner=s?.kind==='chess'?reservations[this.gd.baseIdOf(s.id)]:null;
        if(owner!=null&&owner!==this.playerId)return {error:'RESERVED'};
        return buy.call(this,slot);};
      try{botPrep(this,p);}finally{delete p.buy;}
    });};
    for(const p of m.alivePlayers())if(!p.ready)m.scheduleBotPrep(p);
    m.maybeEndPrep();
    const result=runToEnd(m),errors=errorsOf(m);
    if(errors.match||errors.sim||errors.meta||errors.log.length)throw Error('Rollout engine error');
    rows.push({seed,hiddenCleared:!!result.hiddenCleared,hiddenReached:!!result.hiddenReached});m.dispose();
  }
  const k=rows.filter(x=>x.hiddenCleared).length;
  return {k,n:rows.length,probability:k/rows.length,ci95:wilson(k,rows.length),
    policy:'baseline continuation with joint resource reservations',rows};
}
