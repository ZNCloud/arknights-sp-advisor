import { makeMatch, createRng, deriveSeed, planBoard, applyBoard, arrange, stateRow, errorsOf, runToEnd, data } from './engine.mjs';
import { attachRecorder,classifyFailure } from './recorder.mjs';

// All injections are diagnostic interventions, never normal-start policy results.
export function runInjection({ seed=1, players=1, kind='ceiling', layer=999, round=14, profile=3, actions=80 }) {
  const m = makeMatch(seed, players);
  const reflectionRounds=attachRecorder(m);
  const rng = createRng(deriveSeed(seed, 'injection'));
  const trace = [];
  for (const p of m.order) { p.lp=45; p.bandId=m.gd.defaultBandId; }
  m.round=round; m.phase='PREP'; m._planBossWaves();
  for (const p of m.order) {
    const wave=m.bossWaves.find(w=>w.players.includes(p.playerId)).wave;
    const plan=planBoard(m,round,rng,{profile,spawns:wave.spawns});
    applyBoard(m,p,plan,round,rng,{profile});
    if (kind==='empty') { p.board.clear(); p.hand.fill(null); p.layers={}; }
    if (kind==='ceiling') for (const id of m.gd.bondIds) p.layers[id]=layer;
    p.recompute();
  }
  if (kind==='growth') {
    // Gratis engine pieces and L6 at R1; no artificial layers or recurring money.
    // Optimistic prep-only envelope: skips normal-wave survival and acquisition cost.
    const byName = name => m.gd.visibleChess.find(id=>m.gd.chess(id).name===name && m.pool.has(id));
    const roster=['山','小满','调香师','号角','琳琅诗怀雅','锡人'];
    for (const p of m.order) {
      p.board.clear(); p.hand.fill(null); p.temp.fill(null); p.layers={}; p.effects=[]; p.counters={}; p.funds=0; p.pendingFunds=0;
      const ids=roster.map(byName).filter(Boolean);
      const helpers=m.gd.visibleChess.filter(id=>m.pool.has(id)&&m.gd.chess(id).bonds.includes('deputShip')&&!ids.includes(id));
      if (helpers[0]) ids.push(helpers[0]);
      const yan=m.gd.visibleChess.find(id=>m.pool.has(id)&&m.gd.chess(id).bonds.includes('yanShip')&&!ids.includes(id));
      if(yan) ids.push(yan);
      ids.slice(0,8).forEach((id,i)=>{p.hand[i]=p.newPiece('chess',m.gd.goldenIdOf(id)||id);});
      p.recompute(); arrange(m,p); p.recompute();
    }
    for(let r=1;r<=14;r++) {
      m.round=r; m.phase='PREP';
      for(const p of m.order) {
        p.startRound(r); m.dispatch(p,'onRoundStart',{round:r}); m.dispatch(p,'onPrepStart',{round:r});
        // Fixed maximum of action cycles, greedy acquisition layers plus refunds; no rewritten slots.
        for(let j=0;j<actions;j++) {
          const candidates=p.shop.slots.map((s,i)=>({s,i})).filter(({s})=>s?.kind==='chess'&&!s.sold&&p.priceOf(s)<=p.funds);
          candidates.sort((a,b)=>p.priceOf(a.s)-p.priceOf(b.s));
          const choice=candidates[0];
          if(choice && p.hand.some(x=>!x)) {
            const old=new Set(p.allChess().map(x=>x.uid));
            const result=p.buy(choice.i); if(!result.ok) throw Error(JSON.stringify(result));
            for(const q of p.allChess()) if(!old.has(q.uid)&&p.find(q.uid)?.area!=='board') p.sell(q.uid);
          } else { const result=p.refresh(); if(!result.ok) break; }
        }
        m.dispatch(p,'onPrepEnd',{round:r}); p.endPrep();
      }
      trace.push({round:r,players:stateRow(m)});
    }
    m.round=14; m.phase='PREP'; m._planBossWaves();
    for(const p of m.order) {p.ready=false; arrange(m,p,{final:true}); p.recompute();}
  }
  const start=stateRow(m);
  // Keep the same injected board through R15, carry actual team LP; no second strength grant.
  m.scheduleBotPrep=function(p) { this.later(0,()=>{ arrange(this,p,{final:true}); p.resolveTemp(); p.setReady(true); }); };
  const battles=[];
  const original=m._finishFinal;
  m._finishFinal=function(hidden,resultOf) {
    battles.push({round:this.round,hidden,bossId:hidden?this.hiddenBossId:this.bossId,
      pool:this.bossPool.maxHp,hp:this.bossPool.hp,damageFraction:1-this.bossPool.hp/this.bossPool.maxHp,teamLp:this.teamLp});
    return original.call(this,hidden,resultOf);
  };
  m.hiddenLayerSum=m.order.reduce((a,p)=>a+p.activatedLayers(),0);
  if(round===15) {m.hiddenReached=true; m._openTeamLp();}
  m.startFinalAssault(round===15);
  const summary=runToEnd(m);
  const out={seed,players,kind,layer,round,profile,actions,bossId:m.bossId,hiddenBossId:m.hiddenBossId,
    injection:true,start,trace,battles,hiddenLayerSum:m.hiddenLayerSum,
    r14Killed:battles.some(b=>b.round===14&&b.hp<=0),hiddenReached:!!summary.hiddenReached,
    hiddenCleared:!!summary.hiddenCleared,reflectionRounds,errors:errorsOf(m)};
  out.failure=classifyFailure(out);
  m.dispose(); return out;
}
