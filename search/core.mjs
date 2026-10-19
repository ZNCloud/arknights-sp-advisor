import defaults from './params.json' with { type: 'json' };
import { buyScoreOf, deriveSeed } from '../eval/engine.mjs';
import { forkPrep } from './fork.mjs';
import { comboCandidates } from './macros.mjs';

export function parameters(config={}) {
  const p={...defaults,...config};
  for(const k of ['depth','beam','samples','maxNodes','maxDecisions']) if(!Number.isInteger(p[k])||p[k]<1)throw Error(`Bad ${k}`);
  if(p.depth>3||p.beam>12||p.samples>16||p.maxNodes>2048||p.maxDecisions>256||!(p.temperature>0))throw Error('Search budget outside supported limits');
  if(!['reserved','free','homogeneous'].includes(p.teamMode))throw Error('Bad teamMode');
  for(const k of ['temperature','routeWeight','layerWeight','economyWeight','levelWeight','riskWeight','priorWeight','searchSeed'])if(!Number.isFinite(p[k]))throw Error(`Bad ${k}`);
  if(p.calibration&&(!Number.isFinite(p.calibration.slope)||!Number.isFinite(p.calibration.intercept)))throw Error('Bad calibration');
  return p;
}
export function features(m,ps,route=null) {
  const owned=ps.allChess(),counts={},gold={};
  let material=0,air=0,heal=0,items=0,routeUnits=0;
  const boss=m.gd.boss(m.round===15?m.hiddenBossId:m.bossId),enemy=m.gd.enemy(boss?.enemyKey),def=enemy?.stats?.def||600,res=enemy?.stats?.res||40;
  const vals=owned.map(piece=>{
    const c=ps.gd.chess(piece.id),base=ps.gd.baseIdOf(piece.id);counts[base]=(counts[base]||0)+1;
    const elite=ps.gd.isGolden(piece.id);if(elite)gold[base]=true;
    if(c.bonds.includes(route))routeUnits++;
    if(c.canHitFly)air++;if(c.dmgType==='heal')heal++;
    items+=(piece.items||[]).length;
    const atk=c.stats.atk,bat=c.stats.bat||1;
    const eff=c.dmgType==='arts'?atk*(1-res/100):c.dmgType==='heal'?atk*.55:Math.max(atk-def,.05*atk);
    return 6+ps.gd.tierOf(piece.id)*2+(elite?6:0)+Math.min(30,eff/bat/35);
  }).sort((a,b)=>b-a);
  material=vals.slice(0,ps.deployCap).reduce((a,b)=>a+b,0)+vals.slice(ps.deployCap).reduce((a,b)=>a+.12*b,0);
  const pairs=Object.entries(counts).filter(([id,n])=>n>=2&&!gold[id]).length;
  const layers=Object.values(ps.layers).reduce((a,b)=>a+b,0);
  const economicLayers=(ps.layers.visiShip||0)+(ps.layers.miraShip||0)+(ps.layers.investShip||0)*.5;
  return {material,air:Math.min(air,2),heal:Math.min(heal,1),items,pairs,layers,economicLayers,
    routeUnits:Math.min(routeUnits,6),funds:ps.funds,level:ps.shop.level,lp:ps.lp,round:m.round,activeLayers:ps.activatedLayers()};
}
export function evaluate(m,ps,p,route) {
  const f=features(m,ps,route),early=Math.max(0,(14-m.round)/13);
  return f.material+f.pairs*6+f.items*2+f.air*3+f.heal*5+p.routeWeight*f.routeUnits+
    p.layerWeight*(f.layers+early*f.economicLayers)+p.economyWeight*f.funds+
    p.levelWeight*f.level*early+p.riskWeight*f.lp*.2;
}
export function actions(m,ps,p,route,reservations={}) {
  const a=[{type:'stop',prior:0}];
  if(ps.hand.some(x=>!x)) {
    ps.shop.slots.forEach((s,slot)=>{
      if(!s||s.sold||ps.priceOf(s)>ps.funds)return;
      const base=ps.gd.baseIdOf(s.id),owner=reservations[base];
      if(s.kind==='chess'&&owner!=null&&owner!==ps.playerId)return;
      a.push({type:'buy',slot,id:s.id,prior:buyScoreOf(m,ps,s.id)});
      if(s.kind==='chess')a.push({type:'cycle',slot,id:s.id,prior:1});
    });
    if(ps.offers[0])ps.offers[0].slots.forEach((s,idx)=>{if(!s.sold&&(s.price||0)<=ps.funds)a.push({type:'reward',idx,id:s.id,prior:20});});
  }
  if(ps.shop.freeRefreshes>0||ps.funds>=m.gd.refreshPrice)a.push({type:'refresh',prior:2});
  if(ps.shop.level<m.gd.maxShopLevel&&ps.funds>=ps.shop.upgradePrice)a.push({type:'level',prior:4});
  for(const piece of ps.hand.filter(x=>x?.kind==='chess'))a.push({type:'sell',uid:piece.uid,id:piece.id,prior:-2});
  if(p.guideMacros)a.push(...comboCandidates(m,ps,reservations));
  return a.sort((x,y)=>y.prior-x.prior||JSON.stringify(x).localeCompare(JSON.stringify(y)));
}
export function execute(ps,a) {
  if(a.type==='combo') {
    let completed=0;
    for(const step of a.steps){const r=execute(ps,step);if(!r.ok)return completed?{ok:true,partial:true,completed}:r;completed++;}
    return {ok:true,completed};
  }
  if(a.type==='stop')return {ok:true};
  if(a.type==='buy')return ps.buy(a.slot);
  if(a.type==='refresh')return ps.refresh();
  if(a.type==='level')return ps.levelUp();
  if(a.type==='reward')return ps.pickReward(a.idx);
  if(a.type==='sell')return ps.sell(a.uid);
  if(a.type==='cycle') {
    const before=new Set(ps.allChess().map(x=>x.uid)),r=ps.buy(a.slot);if(!r.ok)return r;
    for(const x of ps.allChess())if(!before.has(x.uid)&&ps.find(x.uid)?.area!=='board'&&!ps.gd.isGolden(x.id))ps.sell(x.uid);
    return r;
  }
  throw Error('Unknown action');
}
function probability(value,p) {
  // Explicitly uncalibrated until an out-of-sample calibration file is supplied.
  const c=p.calibration||{slope:.02,intercept:-8};
  return 1/(1+Math.exp(-Math.max(-30,Math.min(30,c.slope*value+c.intercept))));
}
export function decide(m,ps,config={},route=null,reservations={},decisionIndex=0) {
  const p=parameters(config),start=performance.now();let nodes=0;
  // buyScoreOf maintains a bot-focus cache. Even root candidate generation must be detached.
  const detached=forkPrep(m,p.searchSeed),pid=ps.playerId;m=detached;ps=m.players.get(pid);
  const root=actions(m,ps,p,route,reservations);
  // Keep root action families; pruning only inside the next decision node.
  const cap=Math.max(root.length*p.samples,p.maxNodes);
  function expand(state,action,depth,path) {
    const vals=[];
    for(let sample=0;sample<p.samples;sample++) {
      if(nodes>=cap&&vals.length)break;
      const salt=`${m.round}:${ps.playerId}:${decisionIndex}:${depth}:${sample}`;
      const copy=forkPrep(state,deriveSeed(p.searchSeed,salt));nodes++;
      const player=copy.players.get(ps.playerId),r=execute(player,action);
      if(!r.ok) {copy.dispose();continue;}
      let v=evaluate(copy,player,p,route);
      if(depth>1&&action.type!=='stop'&&nodes+p.samples<cap) {
        let best=-Infinity;
        for(const next of actions(copy,player,p,route,reservations).slice(0,p.beam)) {
          if(nodes+p.samples>=cap)break;
          best=Math.max(best,expand(copy,next,depth-1,`${path}/${next.type}:${next.slot??next.uid??''}`));
        }
        if(Number.isFinite(best))v=best;
      }
      if(copy.errorCount||copy.dispatcher.errors)throw Error('Search transition produced engine errors');
      vals.push(v);copy.dispose();
    }
    return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:-Infinity;
  }
  // Two passes prevent early roots consuming the budget meant for other roots.
  const rows=root.map((action,i)=>({action,value:expand(m,action,1,`root:${i}`)}));
  const shortlist=[...rows].sort((a,b)=>b.value-a.value).slice(0,p.beam);
  for(const row of shortlist)if(p.depth>1&&nodes+p.samples<cap)row.value=expand(m,row.action,p.depth,`deep:${root.indexOf(row.action)}`);
  for(const row of rows)row.value+=p.priorWeight*(row.action.prior||0);
  rows.sort((a,b)=>b.value-a.value);const top=rows[0].value;
  const sum=rows.reduce((s,r)=>s+Math.exp((r.value-top)/p.temperature),0);
  for(const row of rows){row.weight=Math.exp((row.value-top)/p.temperature)/sum;row.estimatedWinProbability=probability(row.value,p);}
  detached.dispose();
  return {recommendation:rows[0].action,actions:rows,nodes,ms:performance.now()-start,
    nodeBudget:cap,budgetExhausted:nodes>=cap,
    probabilityStatus:p.calibration?'fitted-model-see-calibration-provenance':'uncalibrated-heuristic-NOT-measured-win-rate',
    method:'sampled expectimax, engine prep transitions, heuristic leaf',route};
}
