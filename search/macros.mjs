// Bounded guide-derived combinations. Every constituent executes through the engine.
export function comboCandidates(m,ps,reservations={}) {
  const free=ps.hand.filter(x=>!x).length;if(free<1)return [];
  const slots=ps.shop.slots.map((s,slot)=>({s,slot})).filter(({s})=>s?.kind==='chess'&&!s.sold&&
    (reservations[ps.gd.baseIdOf(s.id)]==null||reservations[ps.gd.baseIdOf(s.id)]===ps.playerId));
  const macros=[],econ=['visiShip','miraShip','investShip','deputShip'];
  for(let i=0;i<slots.length;i++)for(let j=i+1;j<slots.length;j++){
    if(free<2)continue;
    const pair=[slots[i],slots[j]],cost=pair.reduce((s,x)=>s+ps.priceOf(x.s),0);if(cost>ps.funds)continue;
    const common=m.gd.chess(pair[0].s.id).bonds.filter(b=>m.gd.chess(pair[1].s.id).bonds.includes(b));
    const same=ps.gd.baseIdOf(pair[0].s.id)===ps.gd.baseIdOf(pair[1].s.id);
    if(!same&&!common.some(b=>econ.includes(b)||m.gd.bond(b)?.isCore))continue;
    macros.push({type:'combo',name:same?'pair_or_merge':'activate_pair',bonds:common,
      steps:pair.map(x=>({type:'buy',slot:x.slot,id:x.s.id})),prior:3});
    if(macros.length>=4)break;
  }
  if(free>=3){
    const inv=slots.filter(x=>m.gd.chess(x.s.id).bonds.includes('investShip'));
    const chosen=[...new Map(inv.map(x=>[m.gd.baseIdOf(x.s.id),x])).values()].slice(0,3);
    if(chosen.length===3&&chosen.reduce((s,x)=>s+ps.priceOf(x.s),0)<=ps.funds)
      macros.push({type:'combo',name:'activate_investor_trio',bonds:['investShip'],steps:chosen.map(x=>({type:'buy',slot:x.slot,id:x.s.id})),prior:5});
  }
  for(const x of slots)if(ps.completesChessMerge(x.s.id)&&ps.shop.level<m.gd.maxShopLevel&&ps.funds>=ps.shop.upgradePrice+ps.priceOf(x.s))
    macros.push({type:'combo',name:'level_before_merge',steps:[{type:'level'},{type:'buy',slot:x.slot,id:x.s.id}],prior:5});
  return macros.slice(0,6);
}
