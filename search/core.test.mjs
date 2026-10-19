import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from '../eval/engine.mjs';
import { decide, execute } from './core.mjs';
import { forkPrep } from './fork.mjs';
import { planTeam } from './team.mjs';
import { wilson } from '../eval/stats.mjs';
import { estimateContinuation } from './rollout.mjs';
import { classifyFailure } from '../eval/recorder.mjs';
import { comboCandidates } from './macros.mjs';
const fingerprint=m=>JSON.stringify({players:m.order.map(p=>Object.fromEntries(Object.entries(p).filter(([k])=>!['m','gd','diyStock'].includes(k)))),
  pool:[...m.pool.entries],rng:[m.rngShop.state(),m.rngMeta.state(),m.rngBots.state()],uid:m.uidSeq},(_,v)=>v instanceof Map?[...v]:v instanceof Set?[...v]:v);
function prep(n=1){const m=makeMatch(1,n);m.start();m.sched.runUntil(()=>m.phase==='PREP',{maxSteps:100000});return m;}
test('search leaves live pieces, pool, counters and RNG unchanged; deterministic output',()=>{
  const m=prep(),before=fingerprint(m),a=decide(m,m.order[0]);assert.equal(fingerprint(m),before);
  const b=decide(m,m.order[0]);assert.deepEqual(a.actions,b.actions);assert.equal(fingerprint(m),before);
  assert.ok(Math.abs(a.actions.reduce((s,r)=>s+r.weight,0)-1)<1e-12);
  assert.ok(a.actions.every(x=>Number.isFinite(x.value)&&x.estimatedWinProbability>=0&&x.estimatedWinProbability<=1));
  const copy=forkPrep(m,123),r=execute(copy.order[0],a.recommendation);assert.equal(r.ok,true);assert.equal(fingerprint(m),before);copy.dispose();m.dispose();
});
test('four cooperative routes and card reservations have distinct owners',()=>{
  const m=prep(4),plan=planTeam(m);assert.equal(new Set(Object.values(plan.routes)).size,4);
  const ids=plan.assignments.flatMap(a=>a.reservedIds);assert.equal(new Set(ids).size,ids.length);assert.ok(plan.combinations>0);m.dispose();
});
test('Wilson handles endpoints and the 80 percent point estimate',()=>{
  assert.ok(wilson(0,10)[1]>.27);assert.ok(wilson(10,10)[0]<.73);assert.ok(wilson(40,50)[0]<.8);assert.equal(wilson(0,0),null);
});
test('empirical continuation reaches a real result without changing live state',()=>{
  const m=prep(),before=fingerprint(m),r=estimateContinuation(m,{samples:1});
  assert.equal(fingerprint(m),before);assert.equal(r.n,1);assert.ok(r.k===0||r.k===1);
  assert.equal(typeof r.rows[0].hiddenCleared,'boolean');assert.equal(r.ci95.length,2);m.dispose();
});
test('diagnosis distinguishes early death, R14, gate, LP and R15 failures',()=>{
  assert.equal(classifyFailure({players:4,battles:[]}).primary,'PRE_R14_ELIMINATION');
  const row={players:4,battles:[{round:14,teamLp:5}],r14Killed:false};
  assert.equal(classifyFailure(row).primary,'R14_DAMAGE');row.r14Killed=true;row.hiddenLayerSum=1200;
  assert.equal(classifyFailure(row).primary,'ENTRY_LAYERS');row.hiddenLayerSum=1201;row.battles[0].teamLp=1;
  assert.equal(classifyFailure(row).primary,'POST_R14_LP');row.hiddenReached=true;
  assert.equal(classifyFailure(row).primary,'R15_DAMAGE');
});
test('guide combination executes legal engine purchases and preserves the live root',()=>{
  const m=prep(),p=m.order[0];p.funds=100;
  const ids=m.gd.visibleChess.filter(id=>m.gd.chess(id).bonds.includes('yanShip')&&m.pool.has(id)).slice(0,2);
  p.shop.slots[0]={kind:'chess',id:ids[0],basePrice:2,sold:false};p.shop.slots[1]={kind:'chess',id:ids[1],basePrice:2,sold:false};
  const before=fingerprint(m),macros=comboCandidates(m,p);assert.ok(macros.length>0);
  const copy=forkPrep(m,33),r=execute(copy.order[0],macros[0]);assert.ok(r.ok&&r.completed>=1);
  assert.equal(fingerprint(m),before);copy.dispose();m.dispose();
});
