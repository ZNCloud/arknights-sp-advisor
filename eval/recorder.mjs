import { stateRow } from './engine.mjs';
const waveOf=m=>({stageId:m.stageId,templateId:m.wave?.templateId??null,
  spawns:(m.wave?.spawns||[]).map(s=>({enemyKey:s.enemyKey,count:s.count,routeIndex:s.routeIndex,mods:s.mods}))});
// Read-only hooks: record charged LP after the engine resolves unite, not raw leaks as LP loss.
export function attachRecorder(m){
  const rounds=[];let normal=null,boss=null;const leakTiles=[];
  const start=m.startCombat,settle=m.settle,final=m.startFinalAssault,finish=m._finishFinal,newBattle=m.newBattle;
  // read-only: record where leaked enemies exit (tile), for leak-position analysis; no behaviour change
  m.newBattle=function(opts,...args){const b=newBattle.call(this,opts,...args);
    try{b.on('enemyLeak',(ctx)=>{const e=ctx&&ctx.enemy;if(!e)return;
      leakTiles.push({round:this.round,owner:e.ownerId??null,defId:e.defId??null,row:Math.round(e.y),col:Math.round(e.x)});});}catch(_){/* non-event battle */}
    return b;};
  m.startCombat=function(...args){normal={round:this.round,kind:'normal',enemies:waveOf(this),playersStart:stateRow(this)};return start.apply(this,args);};
  m.settle=function(...args){
    const leaks=Object.fromEntries(this.order.map(p=>[p.playerId,(this.lastResults.get(p.playerId)?.leaked||[]).map(l=>({enemyKey:l.enemyKey||l.key||l.defId||null,counted:l.counted!==false}))]));
    const before=Object.fromEntries(this.order.map(p=>[p.playerId,p.stats.lpLost||0]));
    const r=settle.apply(this,args);
    rounds.push({...normal,playersEnd:stateRow(this),leaks,
      chargedLpLoss:Object.fromEntries(this.order.map(p=>[p.playerId,(p.stats.lpLost||0)-before[p.playerId]]))});normal=null;return r;
  };
  m.startFinalAssault=function(hidden,...args){
    boss={round:this.round,kind:hidden?'R15':'R14',bossId:hidden?this.hiddenBossId:this.bossId,playersStart:stateRow(this),
      teamLpBefore:hidden?this.teamLp:this.alivePlayers().reduce((s,p)=>s+p.lp,0),
      enemies:(this.bossWaves||[]).map(w=>({players:w.players,spawns:w.wave?.spawns?.map(s=>({enemyKey:s.enemyKey,count:s.count}))}))};
    return final.call(this,hidden,...args);
  };
  m._finishFinal=function(...args){rounds.push({...boss,playersEnd:stateRow(this),teamLpAfter:this.teamLp,
    teamLpLoss:boss?.teamLpBefore-this.teamLp,personalLpLoss:null,
    pool:this.bossPool.maxHp,hp:this.bossPool.hp});boss=null;  return finish.apply(this,args);};
  rounds.leakTiles=leakTiles;
  return rounds;
}
export function classifyFailure(row){
  if(row.error||row.errors?.match||row.errors?.sim||row.errors?.meta||row.errors?.log?.length)return {primary:'INVALID',flags:[]};
  if(row.hiddenCleared)return {primary:'WIN',flags:[]};
  const r14=row.battles?.find(b=>b.round===14),flags=[];
  if(row.round===15&&row.injection)return {primary:'R15_DAMAGE',flags:['CONDITIONAL_INJECTION']};
  if(!r14)return {primary:'PRE_R14_ELIMINATION',flags};
  if(!row.r14Killed)return {primary:'R14_DAMAGE',flags};
  if(!row.hiddenReached){
    if(!(row.hiddenLayerSum>(row.players===1?350:1200)))flags.push('ENTRY_LAYERS');
    if(!(r14.teamLp>1))flags.push('POST_R14_LP');
    return {primary:flags[0]||'UNCLASSIFIED_CHECK_RESULT',flags};
  }
  return {primary:'R15_DAMAGE',flags};
}
