// Central cooperative planner: all bot seats share their holdings. No unrevealed shop RNG.
export function planTeam(m) {
  const seats=m.alivePlayers(),cores=m.gd.bondIds.filter(id=>m.gd.bond(id).isCore&&!m.disabledBonds.includes(id)&&!m.staticInactiveBonds.includes(id));
  const choices=seats.map(ps=>cores.map(route=>{
    const ids=m.gd.visibleChess.filter(id=>m.pool.has(id)&&m.gd.chess(id).bonds.includes(route));
    const owned=ps.allChess().filter(p=>m.gd.chess(p.id).bonds.includes(route)).length;
    const left=ids.reduce((s,id)=>s+m.pool.left(id),0);
    return {route,ids,score:owned*12+(ps.layers[route]||0)*.1+Math.log1p(left)*2};
  }));
  let combinations=0,best=null;
  function visit(i,chosen,score){
    if(i===seats.length){combinations++;if(!best||score>best.score)best={chosen:[...chosen],score};return;}
    for(const c of choices[i])if(!chosen.some(x=>x.route===c.route))visit(i+1,[...chosen,c],score+c.score);
  }
  visit(0,[],0);
  const routes={},reservations={};
  if(best)best.chosen.forEach((c,i)=>{routes[seats[i].playerId]=c.route;for(const id of c.ids)if(reservations[id]==null)reservations[id]=seats[i].playerId;});
  // Shared support units also receive a single owner for this prep. Holdings dominate tie breaks.
  for(const id of m.gd.visibleChess.filter(id=>m.pool.has(id)))if(reservations[id]==null){
    let owner=0,score=-Infinity;
    seats.forEach((ps,i)=>{const n=ps.allChess().filter(x=>m.gd.baseIdOf(x.id)===id).length;
      const s=n*10+((m.gd.chess(id).bonds||[]).some(b=>ps.bonds[b]?.active)?2:0)-i*.001;
      if(s>score){score=s;owner=i;}});
    if(seats[owner])reservations[id]=seats[owner].playerId;
  }
  return {routes,reservations,combinations,score:best?.score??null,
    assignments:seats.map((ps,i)=>({option:String.fromCharCode(65+i),player:ps.playerId,route:routes[ps.playerId],reservedIds:Object.keys(reservations).filter(id=>reservations[id]===ps.playerId)})),
    combinationWinProbability:null,probabilityStatus:'joint rollout estimator not fitted; score is allocation prior'};
}
