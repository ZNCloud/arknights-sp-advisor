// Guide adapter: only validated player actions. Engine data/rules are never mutated.
import { buyScoreOf, itemTarget, planLayout, fieldModel, effDps } from '../../engine/server/match/bot.js';
import { computeBonds, pieceBonds } from '../../engine/server/match/bondsMeta.js';
import { legalTiles, placeClass, parseKey } from '../../engine/server/match/board.js';
import { topActiveBondMeta } from '../../engine/server/sim/content/garrisons/meta.js';
const econBonds=['visiShip','miraShip','investShip'];
const econNames=['山','锡人','琳琅诗怀雅','寒檀','赫默','华法琳'];
const coreBands={yanShip:'band_duyaoy',kjeragShip:'band_sciurus',lateranoShip:'band_paganini',sargonShip:'band_pepe',victoriaShip:'band_harold',egirShip:'band_pith',siracusaShip:'band_chiave',kazimierzShip:'band_mlynar'};
const free=ps=>ps.hand.findIndex(x=>!x);
const rec=(ps,p)=>ps.gd.chess(p.id);
const base=(ps,p)=>ps.gd.baseIdOf(p.id);
const name=(ps,p)=>rec(ps,p)?.name;
const isHealer=c=>c?.dmgType==='heal'||c?.attackKind==='heal';
const isBlocker=c=>c?.position==='MELEE'&&(c?.stats?.blockCnt??0)>0&&!isHealer(c);
function legal(ps,p,r,c){return legalTiles(ps.deployMap(),placeClass(ps,rec(ps,p))).some(([x,y])=>x===r&&y===c);}
export function assign(m,spec){
 const avail=m.gd.bondIds.filter(b=>m.gd.bond(b).isCore&&!m.disabledBonds.includes(b)&&!m.staticInactiveBonds.includes(b));
 const wanted=[...new Set([...spec.coreOrder,...avail])].filter(b=>avail.includes(b));
 // A seat whose line is given (spec.seats[pid].route: the advisor's line pick, a teammate's observed line) keeps it; the
 // other seats take the remaining wanted lines in seat order (no override = the original seat-order assignment).
 const fixed={};for(const [pid,o] of Object.entries(spec.seats||{}))if(o&&o.route&&avail.includes(o.route)&&spec.recipes[o.route])fixed[pid]=o.route;
 const rest=wanted.filter(b=>!Object.values(fixed).includes(b));let k=0;
 const routes={};m.order.forEach(ps=>routes[ps.playerId]=fixed[ps.playerId]??rest[k++%rest.length]);
 const reservations={};
 // Explicit scarce names first: a multi-core terminal belongs to the earliest assigned route that needs it.
 for(const ps of m.order){const r=spec.recipes[routes[ps.playerId]];for(const id of m.gd.visibleChess){const c=m.gd.chess(id);if([...r.producers,...r.terminals].includes(c.name)&&reservations[id]==null)reservations[id]=ps.playerId;}}
 for(const id of m.gd.visibleChess){if(reservations[id]!=null)continue;const c=m.gd.chess(id);const owner=m.order.find(ps=>c.bonds.includes(routes[ps.playerId]));if(owner)reservations[id]=owner.playerId;}
 if(['cycle','onebook','yan','layers'].includes(spec.style))for(const id of m.gd.visibleChess)if(econNames.includes(m.gd.chess(id).name)&&reservations[id]==null)reservations[id]=m.order[0].playerId;
 return {routes,reservations};
}
function record(m,ps,type,detail={}){m.guideActions.push({round:m.round,player:ps.playerId,type,...detail});}
function act(m,ps,type,fn,detail={}){const funds=ps.funds;const r=fn();record(m,ps,type,{...detail,ok:!!r?.ok,fundsBefore:funds,fundsAfter:ps.funds});return !!r?.ok;}
function routeInfo(m,ps){const core=m.guideTeam.routes[ps.playerId];return {core,...m.guideSpec.recipes[core]};}
function ownsName(ps,n){return ps.allChess().some(p=>name(ps,p)===n);}
function canTake(m,ps,id){const o=m.guideTeam.reservations[ps.gd.baseIdOf(id)];return o==null||o===ps.playerId;}
function econSeat(m,ps){return ps===m.order[0]&&['cycle','onebook','yan','layers','bank','general'].includes(m.guideSpec.style);}
function value(m,ps,p,{buy=false}={}){
 const c=rec(ps,p);if(!c)return -100;const r=routeInfo(m,ps),late=m.round>=m.guideSpec.transitionRound;
 let v=c.tier*3+(ps.gd.isGolden(p.id)?9:0)+(p.items?.length||0)*3;
 if(c.bonds.includes(r.core))v+=7;
  if(r.producers.includes(c.name))v+=late?1:17;
  if(r.terminals.includes(c.name))v+=late?25:7;
 if(econSeat(m,ps)&&econNames.includes(c.name))v+=late?0:10;
 if(m.guideSpec.style==='general'&&c.bonds.some(x=>['preciShip','skillfulShip'].includes(x)))v+=5;
  if(m.round>=14&&econNames.includes(c.name)&&!r.terminals.includes(c.name))v-=7;
 // Use the public wave model for boss armour/air fit; never inspect an unrevealed hidden boss.
 if(m.round>=12&&!isHealer(c)){const model=fieldModel(m,ps);v+=Math.min(18,Math.log1p(Math.max(0,effDps(model,c)))*2);if(c.canHitFly)v+=4;}
 if(buy){
   const copies=ps.allChess().filter(x=>base(ps,x)===c.baseId);
   if(ps.completesChessMerge(p.id))v+=42;else if(copies.length===1&&!ps.gd.isGolden(copies[0].id))v+=9;
   if(copies.some(x=>ps.gd.isGolden(x.id)))v-=55;
   v+=Math.max(-12,Math.min(15,buyScoreOf(m,ps,p.id)*.22));
   if(copies.length===0&&ps.allChess().length<ps.deployCap)v+=10;
 }
 return v;
}
function lineupValue(m,ps,set){
 const r=routeInfo(m,ps),chosen=new Set(set.map(p=>p.uid));
 const shadow={...ps,board:new Map(set.map((p,i)=>[String(i),p])),hand:ps.allChess().filter(p=>!chosen.has(p.uid))};
 const bonds=computeBonds(ps.gd,shadow);let v=set.reduce((a,p)=>a+value(m,ps,p),0);
 for(const [id,b] of Object.entries(bonds)){
  if(!b.active)continue;
  if(id===r.core)v+=35*b.tier+Math.min(80,(ps.layers[id]||0)*.13);
  else if(r.addons.includes(id))v+=22*b.tier+Math.min(40,(ps.layers[id]||0)*.08);
  else if(!econBonds.includes(id))v+=9*b.tier+Math.min(18,(ps.layers[id]||0)*.04);
 }
  const cs=set.map(p=>rec(ps,p));v+=Math.min(2,cs.filter(isBlocker).length)*18+Math.min(1,cs.filter(isHealer).length)*22+Math.min(2,cs.filter(c=>c.canHitFly&&!isHealer(c)).length)*12;
 if(econSeat(m,ps)&&m.round<14){
  if(bonds.investShip?.active&&set.some(p=>name(ps,p)==='山')&&(ps.layers.investShip||0)<100)v+=30;
  if(bonds.yanShip?.active&&set.some(p=>name(ps,p)==='小满'))v+=20;
  if((bonds.yanShip?.active||bonds.arcaneShip?.active)&&set.some(p=>name(ps,p)==='夕'))v+=25;
 }
 return v;
}
function choose(m,ps){
 const all=ps.allChess();if(all.length<=ps.deployCap)return all;
 let set=[];const left=[...all];
 while(set.length<ps.deployCap&&left.length){let best=0,bv=-Infinity;left.forEach((p,i)=>{const v=lineupValue(m,ps,[...set,p]);if(v>bv){bv=v;best=i;}});set.push(left.splice(best,1)[0]);}
 for(let k=0;k<2;k++){let bv=lineupValue(m,ps,set),swap=null;for(let i=0;i<set.length;i++)for(const p of left){const cand=set.slice();cand[i]=p;const v=lineupValue(m,ps,cand);if(v>bv+.01){bv=v;swap={i,p};}}if(!swap)break;const j=left.indexOf(swap.p);[set[swap.i],left[j]]=[left[j],set[swap.i]];}
 return set;
}
function pairTraits(m,ps,set,plan){
 // Production on the front/back square is only proposed when both cells are legal; use actual direction.
  const pairs=[['塞雷娅','夕'],['塞雷娅','山'],['白面鸮','赫默'],['断崖','小满'],['引星棘刺','寒檀'],['华法琳','寒芒克洛丝'],['魔王','寒芒克洛丝'],['魔王','圣约送葬人'],['魔王','能天使'],['华法琳','能天使'],['初雪','圣聆初雪'],['灵知','圣聆初雪']];
 const locked=new Set();
 for(const [an,bn] of pairs){const a=set.find(p=>name(ps,p)===an),b=set.find(p=>name(ps,p)===bn);if(!a||!b||locked.has(a.uid))continue;const bk=plan.get(b.uid);if(!bk)continue;const [r,c]=parseKey(bk);const back=an==='断崖';
  for(const [dr,dc,dir] of [[0,-1,'RIGHT'],[0,1,'LEFT'],[-1,0,'UP'],[1,0,'DOWN']]){const ar=r+dr,ac=c+dc,k=`${ar},${ac}`;if(!legal(ps,a,ar,ac))continue;const victim=set.find(p=>p!==a&&plan.get(p.uid)===k);if(victim&&locked.has(victim.uid))continue;const old=plan.get(a.uid);if(victim){const [or,oc]=parseKey(old);if(!legal(ps,victim,or,oc))continue;plan.set(victim.uid,old);}plan.set(a.uid,k);plan.dirs?.set(a.uid,back?({RIGHT:'LEFT',LEFT:'RIGHT',UP:'DOWN',DOWN:'UP'}[dir]):dir);locked.add(a.uid);locked.add(b.uid);break;}
 }
}
function devourPlan(m,ps,set,plan){
 if(routeInfo(m,ps).core!=='egirShip')return;
 const members=set.filter(p=>pieceBonds(ps.gd,p).includes('egirShip')).sort((a,b)=>value(m,ps,b)-value(m,ps,a));
 if(members.length<3)return;
 // Longest legal horizontal chain, with strongest eligible terminal at left, facing right.
 let best=null;for(let r=9;r<=12;r++)for(let c=2;c<=8;c++){
  const chain=[];for(const p of members){const col=c+chain.length;if(col>10||!legal(ps,p,r,col))break;chain.push(p);}
  const score=chain.length*100+c;if(chain.length>=3&&(!best||score>best.score))best={r,c,chain,score};
 }
 if(!best)return;const occupied=new Set(best.chain.map((_,i)=>`${best.r},${best.c+i}`));
 for(const p of set.filter(p=>!best.chain.includes(p))){if(!occupied.has(plan.get(p.uid))){occupied.add(plan.get(p.uid));continue;}const tile=legalTiles(ps.deployMap(),placeClass(ps,rec(ps,p))).find(([r,c])=>!occupied.has(`${r},${c}`));if(tile){const k=tile.join(',');plan.set(p.uid,k);occupied.add(k);}}
 best.chain.forEach((p,i)=>{plan.set(p.uid,`${best.r},${best.c+i}`);plan.dirs?.set(p.uid,'RIGHT');});
 record(m,ps,'devour_layout',{chain:best.chain.map(p=>name(ps,p)),cells:best.chain.map(p=>plan.get(p.uid))});
}
function arrangeGuide(m,ps){
 const set=choose(m,ps),uids=new Set(set.map(p=>p.uid));
 for(const p of [...ps.board.values()])if(p.kind==='chess'&&!uids.has(p.uid)){if(free(ps)>=0)ps.move(p.uid,{area:'hand',idx:free(ps)});else act(m,ps,'sell_board_space',()=>ps.sell(p.uid),{id:p.id});}
 const plan=planLayout(m,ps,set);pairTraits(m,ps,set,plan);devourPlan(m,ps,set,plan);
 for(let pass=0;pass<3;pass++)for(const p of set){const k=plan.get(p.uid);if(!k||!ps.find(p.uid))continue;const [row,col]=parseKey(k);ps.move(p.uid,{area:'board',row,col},plan.dirs?.get(p.uid)||'RIGHT');}
 // Token stacks remain engine-owned. Deploy available summons with validated token move, where possible.
 for(const p of [...ps.hand,...ps.temp].filter(x=>x?.kind==='token')){for(const [row,col] of legalTiles(ps.deployMap(),'all')){if(ps.board.has(`${row},${col}`))continue;if(ps.move(p.uid,{area:'board',row,col}).ok)break;}}
 return set;
}
function equip(m,ps){
 for(const it of [...ps.hand,...ps.temp].filter(x=>x?.kind==='item')){
  let target=null;const ir=ps.gd.item(it.id),label=ir?.name||'';
   if(/商业包装/.test(label))target=ps.allChess().find(p=>name(ps,p)==='琳琅诗怀雅')||ps.allChess().find(p=>name(ps,p)==='锡人');
   if(!target&&m.guideSpec.itemIds?.includes(it.id)){const r=routeInfo(m,ps);target=[...ps.board.values()].filter(p=>p.kind==='chess').sort((a,b)=>((r.terminals.includes(name(ps,b))?1:0)-(r.terminals.includes(name(ps,a))?1:0))||((a.items?.length||0)-(b.items?.length||0)))[0]||null;}
   if(!target)target=itemTarget(m,ps,it);
  if(target)act(m,ps,'equip',()=>ps.equip(it.uid,target.uid),{item:it.id,target:target.id});
 }
}
// (d) R15 前专项转型: the hidden core's layerSum is already frozen (prep.js:174-176) and eligibility is decided
// (bossRounds.js:558), so the R15 prep is free to re-spec — but the core bond must stay active (sim reached():
// bonds/core.js:74-78 gates the layer damage bonus on st.active). Lift-test each non-terminal: sell it only when the
// core bond's tier does not drop and at least one blocker stays on the board.
function coreTierOf(m,ps,core){
 const shadow={...ps,board:new Map([...ps.board.values()].filter(p=>p.kind==='chess').map((p,i)=>[String(i),p])),hand:ps.hand.filter(p=>p&&p.kind==='chess')};
 return computeBonds(ps.gd,shadow)[core]?.tier||0;
}
function r15Transform(m,ps){
 const spec=m.guideSpec;
 if(!spec.r15Transform||m.round!==m.gd.hiddenRound)return;
 const r=routeInfo(m,ps),core=r.core;
 let sold=0;
 for(let guard=0;guard<8;guard++){
  let did=false;
  for(const p of [...ps.board.values()].filter(q=>q.kind==='chess')){
   if(r.terminals.includes(name(ps,p)))continue;
   const slot=ps.find(p.uid);if(!slot)continue;
   const [row,col]=parseKey(slot.key),t0=coreTierOf(m,ps,core),hf=free(ps);
   if(hf<0)break;
   if(!ps.move(p.uid,{area:'hand',idx:hf})?.ok)continue;
   const t1=coreTierOf(m,ps,core);
   const blockers=[...ps.board.values()].filter(q=>q.kind==='chess'&&isBlocker(rec(ps,q)));
   if(t1<t0||(blockers.length===0&&isBlocker(rec(ps,p)))||!act(m,ps,'r15_sell',()=>ps.sell(p.uid),{id:p.id})){
    ps.move(p.uid,{area:'board',row,col});
    continue;
   }
   sold++;did=true;break;
  }
  if(!did)break;
 }
 record(m,ps,'r15_transform',{sold,coreTier:coreTierOf(m,ps,core),funds:ps.funds});
}
function makeRoom(m,ps){
 if(free(ps)>=0)return true;equip(m,ps);if(free(ps)>=0)return true;
 const candidates=ps.hand.filter(p=>p?.kind==='chess').sort((a,b)=>value(m,ps,a)-value(m,ps,b));
 if(candidates.length)act(m,ps,'sell_space',()=>ps.sell(candidates[0].uid),{id:candidates[0].id});
 return free(ps)>=0;
}
function rewards(m,ps){
 for(let i=0;i<24&&ps.offers.length;i++){
  const slots=ps.offers[0].slots;let best=-1,bv=-Infinity;
  slots.forEach((s,j)=>{if(s.sold)return;const v=s.kind==='item'?8+ps.gd.tierOf(s.id)*2:canTake(m,ps,s.id)?value(m,ps,s,{buy:true}):-1e6;if(v>bv){bv=v;best=j;}});
  if(best<0||!makeRoom(m,ps))break;
  if(bv< -1e5){record(m,ps,'blocked_reward_reserved',{ids:slots.map(s=>s.id)});break;}
  if(!act(m,ps,'reward',()=>ps.pickReward(best),{id:slots[best].id}))break;
 }
}
function snapshot(m,ps,phase){
 const r=routeInfo(m,ps),owned=ps.allChess(),board=[...ps.board.values()].filter(p=>p.kind==='chess');
 m.guideTrace.push({round:m.round,player:ps.playerId,phase,route:r.core,band:ps.bandId,level:ps.shop.level,targetLevel:m.guideSpec.levelTargets[m.round],funds:ps.funds,lp:ps.lp,layers:{...ps.layers},activeLayers:ps.activatedLayers(),
 shop:ps.shop.slots.map(s=>s?{id:s.id,kind:s.kind,sold:s.sold,price:ps.priceOf(s),allowed:s.kind!=='chess'||canTake(m,ps,s.id)}:null),ownedChess:owned.length,deployCap:ps.deployCap,
 board:board.map(p=>({id:p.id,name:name(ps,p),cell:ps.find(p.uid)?.key,dir:p.dir,items:p.items?.map(i=>i.id)})),hand:ps.hand.filter(Boolean).map(p=>({id:p.id,name:name(ps,p)})),
 checks:{targetCoreActive:!!ps.bonds[r.core]?.active,producerOwned:r.producers.filter(n=>owned.some(p=>name(ps,p)===n)),producerDeployed:r.producers.filter(n=>board.some(p=>name(ps,p)===n)),terminalOwned:r.terminals.filter(n=>owned.some(p=>name(ps,p)===n)),terminalDeployed:r.terminals.filter(n=>board.some(p=>name(ps,p)===n)),investActive:!!ps.bonds.investShip?.active,investTriple:!!ps.bonds.investShip?.active&&ps.layers.investShip>=100,visiAll:ps.layers.visiShip>=150,miracleLayers:ps.layers.miraShip||0}});
}
// Per-seat play profile (advisor/team.mjs): `spec.seats[playerId]` overrides spec fields for that seat only (a
// teammate's observed tempo, a learned levelTargets). The seat's prep runs with the merged spec; the team's route
// assignment and reservations (assign) stay the base spec's.
export function seatSpec(spec,ps){const o=spec.seats&&spec.seats[ps.playerId];return o?{...spec,...o,seats:spec.seats}:spec;}
function prep(m,ps){
 const base=m.guideSpec;m.guideSpec=seatSpec(base,ps);
 try{prepSeat(m,ps);}finally{m.guideSpec=base;}
}
// ── 规则 A：卖线外牌凑钱 (spec.sellFund, default off; humanopt_1231 g11_A seats.p0.sellFund) ──
// Minimal port of the helpers sellFund needs, cherry-picked from the humanopt_1231 research branch (033a667:
// trig/ids/topNow/topOf; c4207c8: prepFeed/battleFeed/stackWindow; 1d7187d: lineWants; c6eae61: sellFund itself) —
// those commits' other switches (earlyStack, mergeStack, layerSteer, economy.investCycle, buyOut, pairs, …) are not
// ported; this file does not carry them, sprlruleA_1345 is in scope for sellFund only.
const ids=s=>String(s??'').split(',').map(x=>x.trim()).filter(Boolean);
const trig=(gd,id,ev)=>(gd.chess(id)?.garrisonIds||[]).map(g=>gd.garrison(g)).filter(g=>g?.eventType===ev);
// The lit bond a 「当前激活且层数最多」 trait feeds (ties → bond data order), board as it stands.
const topOf=(ps,lit)=>topActiveBondMeta({gd:ps.gd,data:{},bondActive:lit,layers:b=>ps.layers[b]||0});
const topNow=ps=>topOf(ps,b=>!!ps.bonds[b]?.active);
const stackWindow=(m,o)=>!!o&&m.round>=o.fromRound&&m.round<=o.untilRound;
// A piece p0's own line keeps (core member / recipe producer or terminal); anything else is a candidate to sell.
const lineWants=(m,ps,c)=>{const r=routeInfo(m,ps);return c.bonds.includes(r.core)||r.producers.includes(c.name)||r.terminals.includes(c.name);};
const lastRound=new WeakMap();
function lastRoundOf(m,ps){
 const k=lastRound.get(ps);if(k?.round===m.round)return k;
 const a=m.guideActions.filter(x=>x.player===ps.playerId&&x.round===m.round-1&&x.ok);
 const v={round:m.round,gained:a.filter(x=>['buy','reward','steer_buy'].includes(x.type)).length,refreshes:a.filter(x=>x.type==='refresh').length,spent:a.reduce((t,x)=>t+Math.max(0,(x.fundsBefore??0)-(x.fundsAfter??0)),0)};
 lastRound.set(ps,v);return v;
}
// prepFeed: one prep's 休整期 layers (SERVER_PREP_START/FIN, operator on the board) a holder of chess `id` adds to
// `bond`; sellFund uses it (with battleFeed) only to tell a dead single copy (feeds the core nothing) from one worth keeping.
function prepFeed(m,ps,id,bond,anyTop=false){
 const c=ps.gd.chess(id);if(!c)return 0;const has=c.bonds.includes(bond),top=topNow(ps),isTop=anyTop||!top||top===bond;
 const board=[...ps.board.entries()].filter(([,p])=>p.kind==='chess'),hand=ps.hand.filter(p=>p?.kind==='chess');
 const tiers=()=>new Set(board.filter(([,p])=>pieceBonds(ps.gd,p).includes(bond)).map(([,p])=>ps.gd.tierOf(p.id))).size;
 const rowMax=()=>{const n={};for(const [k] of board){const r=parseKey(k)[0];n[r]=(n[r]||0)+1;}return Math.max(0,...Object.values(n));};
 let v=0;
 for(const g of [...trig(ps.gd,id,'SERVER_PREP_START'),...trig(ps.gd,id,'SERVER_PREP_FIN')]){
  const bb=g.bb||{},bs=ids(g.bbStr?.bond),n=Number(bb.count)||0,mu=Number(bb.multi)||1;
  if(g.effectType==='SERVER_ADD_BOND'){if(bs.includes(bond))v+=n;}
  else if(g.effectType==='SERVER_ADD_BOND_CHESS_ALL'){if(has)v+=n;}
  else if(g.effectType==='SERVER_ADD_BOND_POSITION')v+=n*(has?2:1);
  else if(g.effectType==='SERVER_ADD_BOND_ACTIVATED_MOST_LAYER'){if(isTop)v+=n;}
  else if(g.effectType==='SERVER_ADD_ACT_BOND_DIFF_LV_MOST_LAYER'){if(isTop)v+=mu*tiers();}
  else if(g.effectType==='SERVER_ADD_BOND_IN_HAND')v+=n*hand.filter(p=>pieceBonds(ps.gd,p).includes(bond)).length;
  else if(g.effectType==='SERVER_ADD_BOND_METHOD'&&bs.includes(bond)){const k=g.bbStr?.add_method;
   v+=mu*(k==='shoplv'?ps.shop.level:k==='round_gain_char'?lastRoundOf(m,ps).gained:k==='hand_count'?hand.length:k==='same_row'?rowMax():k==='same_bond_diff_lv'?tiers():0);}
  else if(g.effectType==='SERVER_ADD_BOND_ROUND_COIN_COST'&&bs.includes(bond))v+=Math.floor(lastRoundOf(m,ps).spent/Math.max(1,n))*(Number(bb.layer)||0);
  else if(g.effectType==='SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER'&&bs.includes(bond))v+=Math.min(Number(bb.max_layer)||Infinity,(Number(bb.multiplier)||0)*lastRoundOf(m,ps).refreshes);
 }
 return v;
}
// battleFeed: an IN_BATTLE ADD_BOND trait's per-battle cap on `bond` — sellFund's other half of "feeds it nothing".
function battleFeed(ps,id,bond){
 const c=ps.gd.chess(id);if(!c)return 0;const top=topNow(ps);let v=0;
 for(const g of trig(ps.gd,id,'IN_BATTLE')){if(g.effectType!=='ADD_BOND')continue;const t=g.bbStr?.bond_type;
  if(t==='bond_by_id'&&ids(g.bbStr?.bond_id).includes(bond)||t==='bond_self'&&c.bonds.includes(bond)||t==='bond_actived_maxstack'&&(!top||top===bond))v+=Number(g.bb?.max_add_count_per_battle)||Number(g.bb?.bond_add_count)||0;}
 return v;
}
// spec.sellFund (default off; {fromRound, untilRound, gap, maxSells}): 卖线外牌凑钱 (humanopt_1231). Before a refresh, when
// a shop operator the line wants (member / recipe: the buy loop keeps it, no off-line penalty) scores above the buy floor
// but costs at most `gap` more than the funds, sell owned single copies the line does not want and that feed it nothing
// (prepFeed / battleFeed = 0, garrisons data), lowest value first, at most maxSells per round; the next step buys it.
function sellFund(m,ps,floor){
 const sf=m.guideSpec.sellFund,core=routeInfo(m,ps).core,cap=sf.maxSells??2;
 const done=m.guideActions.filter(x=>x.type==='sell_fund'&&x.round===m.round&&x.player===ps.playerId).length;if(done>=cap)return false;
 let tgt=-1,tv=-Infinity;
 ps.shop.slots.forEach((s,i)=>{if(!s||s.sold||s.kind!=='chess'||!canTake(m,ps,s.id))return;const gap=ps.priceOf(s)-ps.funds;if(gap<=0||gap>(sf.gap??2))return;
  if(!lineWants(m,ps,rec(ps,s)))return;const v=value(m,ps,s,{buy:true})-ps.priceOf(s)*2;if(v>floor&&v>tv){tv=v;tgt=i;}});
 if(tgt<0)return false;
 const single=p=>ps.allChess().filter(x=>base(ps,x)===base(ps,p)).length===1;
 const cands=ps.allChess().filter(p=>{const c=rec(ps,p);return c&&!ps.gd.isGolden(p.id)&&!lineWants(m,ps,c)&&prepFeed(m,ps,p.id,core,true)===0&&battleFeed(ps,p.id,core)===0&&single(p);}).sort((a,b)=>value(m,ps,a)-value(m,ps,b)||a.uid-b.uid);
 const price=ps.priceOf(ps.shop.slots[tgt]),sell=[];let f=ps.funds;
 for(const p of cands){if(f>=price||done+sell.length>=cap)break;sell.push(p);f+=ps.gd.sellPrice(p.id);}
 if(f<price)return false;
 for(const p of sell)if(!act(m,ps,'sell_fund',()=>ps.sell(p.uid),{id:p.id,for:ps.shop.slots[tgt].id}))return false;
 return true;
}
function prepSeat(m,ps){
 const spec=m.guideSpec;const start=performance.now();m.autoPickPersonalChoice(ps,'bot');snapshot(m,ps,'before');
 r15Transform(m,ps);
 rewards(m,ps);arrangeGuide(m,ps);equip(m,ps);
 const bank=ps.bandId==='band_cannot',wanted=spec.levelTargets[m.round]||6;
 // Held third is bought only after levels; do not refresh away a frozen third while banking.
 let holding=false;
 if(bank&&ps.shop.level<4){const third=ps.shop.slots.find(s=>s?.kind==='chess'&&!s.sold&&ps.completesChessMerge(s.id)&&canTake(m,ps,s.id));
  if(third&&m.round>=4){for(let k=0;k<3&&ps.shop.level<4&&ps.funds>=ps.shop.upgradePrice+ps.priceOf(third);k++)act(m,ps,'level_before_merge',()=>ps.levelUp());
   if(ps.shop.level<4){holding=true;if(!ps.shop.frozen)act(m,ps,'freeze_third',()=>ps.freeze());}}
 }
 if(!holding&&(!bank||m.round>=7||ps.shop.level>=4))for(let i=0;i<5&&ps.shop.level<wanted;i++){
  const reserve=m.round<=3?4:m.round<=6?3:2;if(ps.funds<ps.shop.upgradePrice+reserve)break;act(m,ps,'level',()=>ps.levelUp());
 }
 let refreshes=0;
 for(let step=0;step<spec.maxActions;step++){
  if(holding)break;
  rewards(m,ps);if(step%8===0)arrangeGuide(m,ps);equip(m,ps);if(!makeRoom(m,ps))break;
  const r=routeInfo(m,ps),late=m.round>=spec.transitionRound;let best=-1,bv=-Infinity,cycle=false;
  ps.shop.slots.forEach((s,i)=>{
   if(!s||s.sold||ps.priceOf(s)>ps.funds)return;
   const reserve=bank&&ps.allChess().length>=6?5:0;if(ps.funds-ps.priceOf(s)<reserve&&!ps.completesChessMerge(s.id))return;
   let v,cy=false;if(s.kind==='chess'){
    if(!canTake(m,ps,s.id))return;
    if(bank&&ps.shop.level<4&&ps.completesChessMerge(s.id))return;
    const c=rec(ps,s);v=value(m,ps,s,{buy:true})-ps.priceOf(s)*2;
    const copies=ps.allChess().filter(p=>base(ps,p)===c.baseId);
    const keep=c.bonds.includes(r.core)||r.producers.includes(c.name)||r.terminals.includes(c.name)||(econSeat(m,ps)&&c.bonds.some(b=>econBonds.includes(b)));
    if(!keep&&ps.allChess().length>=ps.deployCap)v-=35;
    if(ps.allChess().length>=ps.deployCap+5&&!ps.completesChessMerge(s.id)&&copies.length===0)v-=15;
    const deployedNames=[...ps.board.values()].filter(p=>p.kind==='chess').map(p=>name(ps,p));
    const hasEngine=(deployedNames.includes('小满')&&ps.bonds.yanShip?.active)||(deployedNames.includes('夕')&&(ps.bonds.yanShip?.active||ps.bonds.arcaneShip?.active))||(deployedNames.includes('山')&&ps.bonds.investShip?.active);
    if(spec.economy.cycle&&econSeat(m,ps)&&!late&&hasEngine&&copies.length===0&&ps.priceOf(s)<=Math.min(2,ps.funds-1)){v=Math.max(v,45);cy=!keep;}
   }else {const target=itemTarget(m,ps,s);if(!target&&!spec.itemIds?.includes(s.id))return;v=(late?20:0)+ps.gd.tierOf(s.id)*3-ps.priceOf(s)*2;if(spec.style==='equipment')v+=15;if(spec.itemIds?.includes(s.id))v+=40;}
   if(v>bv){bv=v;best=i;cycle=cy;}
  });
  // Only when normal scoring would stop: use affordable bodies for an empty slot.
  // A previous elite of the same base is not a reason to leave a legal slot empty.
  if(bv<=8&&!(spec.r15Transform&&m.round===m.gd.hiddenRound)&&ps.allChess().length<ps.deployCap&&!bank){
   const i=ps.shop.slots.findIndex(s=>s?.kind==='chess'&&!s.sold&&canTake(m,ps,s.id)&&ps.priceOf(s)<=ps.funds);
   if(i>=0){best=i;bv=9;cycle=false;record(m,ps,'fill_fallback',{id:ps.shop.slots[i].id});}
  }
  const buyFloor=spec.r15Transform&&m.round===m.gd.hiddenRound?2:8;
  // (e) R15 装备专购: at the hidden prep every coin left over is dead value — spend it on items for deployed
  // terminals and on chess buys that complete a merge (elite of an output unit), refresh the rest away.
  const r15=spec.r15Transform&&m.round===m.gd.hiddenRound;
  if(r15&&bv<=8&&best>=0&&ps.shop.slots[best].kind==='chess'&&!ps.completesChessMerge(ps.shop.slots[best].id))bv=-Infinity;
  if(best>=0&&bv>buyFloor){const s=ps.shop.slots[best],before=new Set(ps.allChess().map(p=>p.uid));if(!act(m,ps,'buy',()=>ps.buy(best),{id:s.id,score:bv,reservedOwner:m.guideTeam.reservations[ps.gd.baseIdOf(s.id)]}))break;
   if(cycle){const added=ps.allChess().find(p=>!before.has(p.uid)&&p.id===s.id);if(added)act(m,ps,'cycle_sell',()=>ps.sell(added.uid),{id:added.id});}continue;}
  if(holding)break;
  if(stackWindow(m,spec.sellFund)&&sellFund(m,ps,buyFloor))continue;
  const refreshCost=ps.shop.freeRefreshes>0?0:ps.gd.refreshPrice;const reserve=bank?5:0;
  if(refreshes>=(r15?99:spec.maxRefreshes)||ps.funds<refreshCost+reserve+1)break;
  if(!act(m,ps,'refresh',()=>ps.refresh()))break;refreshes++;
 }
 rewards(m,ps);arrangeGuide(m,ps);equip(m,ps);arrangeGuide(m,ps);m.autoPickPersonalChoice(ps,'bot');ps.resolveTemp();
 if(!ps.shop.frozen&&ps.shop.slots.some(s=>s?.kind==='chess'&&!s.sold&&canTake(m,ps,s.id)&&ps.completesChessMerge(s.id)&&ps.priceOf(s)>ps.funds))act(m,ps,'freeze_unaffordable',()=>ps.freeze());
 snapshot(m,ps,'ready');m.guideDecisionMs.push(performance.now()-start);if(!act(m,ps,'ready',()=>ps.setReady(true)))throw Error('guide cannot ready');
}
export function installGuide(m,spec){
 m.guideSpec=spec;m.guideActions=[];m.guideTrace=[];m.guideDecisionMs=[];m.guideTeam=assign(m,spec);
 m.scheduleBandBot=function(){const token=this._turnToken;this.later(0,()=>{if(this.phase!=='BAND_DRAFT'||token!==this._turnToken)return;const ps=this.players.get(this.draftTurn());if(!ps)return;const i=this.order.indexOf(ps),core=this.guideTeam.routes[ps.playerId];const wishes=[i===0?spec.primaryBand:coreBands[core],coreBands[core],'band_amiya','band_sarkazb','band_ermengard','band_chen',...this.gd.bandIds()];const band=wishes.find(b=>b&&this.gd.bandAllowed(b)&&!this.bandTaken(b,ps.playerId));const ans=this.pickBand(ps,band);if(!ans.ok)throw Error('guide band '+JSON.stringify(ans));});};
 m.scheduleBotPrep=function(ps){const round=this.round;this.later(0,()=>{if(this.phase==='PREP'&&this.round===round&&ps.alive&&!ps.ready)prep(this,ps);});};
 const end=m.endPrep;if(typeof end==='function')m.endPrep=function(...a){const r=end.apply(this,a);for(const ps of this.alivePlayers())snapshot(this,ps,'afterPrep');return r;};
}
export { prep as guidePrep };
