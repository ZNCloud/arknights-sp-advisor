// Paired seed bootstrap; diagnostic, not a multiple-comparison-adjusted proof.
import { readFileSync,writeFileSync } from 'node:fs';
const [left,right,out]=process.argv.slice(2);
if(!left||!right||!out)throw Error('Usage: compare.mjs reference.json candidate.json output.json');
const a=JSON.parse(readFileSync(left,'utf8')),b=JSON.parse(readFileSync(right,'utf8'));
if(!a.summary.qualityPass||!b.summary.qualityPass)throw Error('Invalid rows: fix engine errors first');
const map=new Map(a.rows.map(r=>[r.seed,r]));
if(a.rows.length!==b.rows.length||b.rows.some(r=>!map.has(r.seed)))throw Error('Seeds must match');
let state=1234567;const rand=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
const damage=r=>r.battles?.find(x=>x.round===14)?.damageFraction||0;
const results={};
for(const [name,f] of Object.entries({r15:r=>+r.hiddenCleared,r14:r=>+r.r14Killed,r14Damage:damage})){
  const ds=b.rows.map(r=>f(r)-f(map.get(r.seed))),n=ds.length,bs=[];
  for(let i=0;i<5000;i++){let v=0;for(let j=0;j<n;j++)v+=ds[Math.floor(rand()*n)];bs.push(v/n);}bs.sort((x,y)=>x-y);
  results[name]={candidateMinusReference:ds.reduce((x,y)=>x+y,0)/n,pairedBootstrapCi95:[bs[124],bs[4874]],n,
    note:ds.every(x=>x===0)?'No discordance observed; zero interval does not prove equivalence.':null};
}
writeFileSync(out,JSON.stringify({left,right,results},null,2)+'\n');console.log(JSON.stringify(results,null,2));
