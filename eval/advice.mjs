import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { makeMatch } from './engine.mjs';
import { decide,execute } from '../search/core.mjs';
import { planTeam } from '../search/team.mjs';
import { estimateContinuation } from '../search/rollout.mjs';
const args=process.argv.slice(2),opt={};for(let i=0;i<args.length;i+=2)opt[args[i].slice(2)]=args[i+1];
const players=Number(opt.players||4),seed=Number(opt.seed||1),samples=Number(opt.samples||2);
const m=makeMatch(seed,players);m.start();m.sched.runUntil(()=>m.phase==='PREP',{maxSteps:100000});
const team=planTeam(m),advice=m.order.map(p=>({player:p.playerId,...decide(m,p,{},team.routes[p.playerId],players>1?team.reservations:{})}));
// One joint world per sample, never products of individual seat probabilities.
const joint=estimateContinuation(m,{samples,reservations:players>1?team.reservations:{}});
const focus=advice[0];
for(const row of focus.actions.slice(0,3))row.rollout=estimateContinuation(m,{samples,reservations:players>1?team.reservations:{},
  applyFirst:copy=>{const p=copy.order[0],r=execute(p,row.action);if(!r.ok)throw Error(JSON.stringify(r));if(row.action.type==='stop')p.setReady(true);}});
const out=resolve(opt.out||`design/results/advice-p${players}.json`);mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,JSON.stringify({seed,players,team:{...team,combinationWinProbability:joint.probability,joint},advice,
  note:'Offline empirical win estimates under baseline continuation; not a calibrated search-policy forecast.'},null,2)+'\n');
console.log(JSON.stringify({out,joint,actions:focus.actions.slice(0,3).map(r=>({action:r.action,weight:r.weight,rollout:r.rollout}))},null,2));m.dispose();
