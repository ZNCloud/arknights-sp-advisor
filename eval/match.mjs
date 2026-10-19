import { installGuide } from '../guides/policy.mjs';
import { makeMatch, arrange, itemTarget, stateRow, errorsOf, runToEnd } from './engine.mjs';
import { decide, execute, parameters } from '../search/core.mjs';
import { planTeam } from '../search/team.mjs';
import { attachRecorder,classifyFailure } from './recorder.mjs';

export function runMatch({seed=1,players=1,strategy='baseline',config={}}) {
  const guideSeats=strategy==='guide'&&config.diyPicks?{seats:Array.from({length:players},(_,i)=>({seat:i,playerId:`p${i}`,name:`P${i}`,isBot:i!==0,connected:true,...(i===0?{diy:config.diyPicks}: {})}))}:{};
  const m=makeMatch(seed,players,guideSeats),p=parameters(config),decisions=[],decisionMs=[],rounds=[],teams=[];
  const reflectionRounds=attachRecorder(m);
  if(strategy==='guide'){if(config.diyPicks)m.order[0].autoplay=true;installGuide(m,config);}
  if(strategy==='search') {
    m.scheduleBotPrep=function(ps) {
      const round=this.round;
      this.later(0,()=>{
        if(this.phase!=='PREP'||round!==this.round||!ps.alive)return;
        if(this._searchTeamRound!==round){
          this._searchTeamRound=round;this._searchTeam=planTeam(this);
          if(p.teamMode==='homogeneous') {const route=Object.values(this._searchTeam.routes)[0];for(const key of Object.keys(this._searchTeam.routes))this._searchTeam.routes[key]=route;}
          teams.push({round,...this._searchTeam,teamMode:p.teamMode});
        }
        this.autoPickPersonalChoice(ps,'bot');
        for(let i=0;i<p.maxDecisions;i++) {
          arrange(this,ps); // Deploy frees the regular hand before generating purchase masks.
          const plan=this._searchTeam;
          const d=decide(this,ps,p,plan.routes[ps.playerId],players>1&&p.teamMode==='reserved'?plan.reservations:{},i);
          decisionMs.push(d.ms);
          if(decisions.length<32)decisions.push({round,player:ps.playerId,...d});
          if(d.recommendation.type==='stop')break;
          const r=execute(ps,d.recommendation);if(!r.ok)throw Error(`illegal recommendation ${JSON.stringify(r)}`);
        }
        arrange(this,ps);
        for(const item of [...ps.hand,...ps.temp].filter(x=>x?.kind==='item')) {
          const target=itemTarget(this,ps,item);if(target)ps.equip(item.uid,target.uid);
        }
        arrange(this,ps,{final:true});this.autoPickPersonalChoice(ps,'bot');ps.resolveTemp();
        const ready=ps.setReady(true);if(!ready.ok)throw Error(`Cannot ready: ${JSON.stringify(ready)}`);
      });
    };
  }
  const battles=[];const original=m._finishFinal;
  m._finishFinal=function(hidden,resultOf){
    battles.push({round:this.round,hidden,bossId:hidden?this.hiddenBossId:this.bossId,pool:this.bossPool.maxHp,hp:this.bossPool.hp,damageFraction:1-this.bossPool.hp/this.bossPool.maxHp,teamLp:this.teamLp});
    return original.call(this,hidden,resultOf);
  };
  m.start();
  const summary=runToEnd(m,{onPhase:mm=>{if(['SETTLE','FINAL_ASSAULT','HIDDEN_CORE'].includes(mm.phase))rounds.push({round:mm.round,phase:mm.phase,players:stateRow(mm)});}});
  const row={seed,players,strategy,injection:false,bossId:m.bossId,hiddenBossId:m.hiddenBossId,
    r14Killed:battles.some(b=>b.round===14&&b.hp<=0),hiddenReached:!!summary.hiddenReached,hiddenCleared:!!summary.hiddenCleared,
    genericVictory:!!summary.victory,reason:summary.reason,hiddenLayerSum:m.hiddenLayerSum,rounds,battles,teams,decisions,decisionMs,reflectionRounds,leakTiles:reflectionRounds.leakTiles,errors:errorsOf(m)};
  if(strategy==='guide'){row.guideId=config.id;row.guideTeam=m.guideTeam;row.guideTrace=m.guideTrace;row.guideActions=m.guideActions;row.decisionMs=m.guideDecisionMs;row.disabledBonds=m.disabledBonds;row.stageId=m.stageId;row.setup=m.order.map(p=>({player:p.playerId,isBot:p.isBot,diy:p.diy,band:p.bandId}));}
  row.failure=classifyFailure(row);
  m.dispose();return row;
}
