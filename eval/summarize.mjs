import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { dirname } from 'node:path';
const file=process.argv[2];if(!file)throw Error('Pass experiment manifest.json');
const m=JSON.parse(readFileSync(file,'utf8')),reports=[];
for(const j of m.jobs){
  if(!existsSync(j.flags.out)){reports.push({...j,result:'MISSING'});continue;}
  const d=JSON.parse(readFileSync(j.flags.out,'utf8'));
  const damage=d.rows.map(r=>r.battles?.find(b=>b.round===14)?.damageFraction||0);
  reports.push({name:j.name,players:j.players,...d.summary,meanR14Damage:damage.reduce((a,b)=>a+b,0)/damage.length,
    maxRoundMean:d.rows.reduce((a,r)=>a+Math.max(0,...(r.rounds||[]).map(x=>x.round)),0)/d.rows.length,
    result:j.flags.out});
}
const out=`${dirname(file)}/SUMMARY.json`;writeFileSync(out,JSON.stringify(reports,null,2)+'\n');
console.log('| group | seats | n | errors | R14 kills | R15 kills | 95% CI | mean R14 damage | decision p95 ms |');
console.log('|---|---:|---:|---:|---:|---:|---|---:|---:|');
for(const r of reports)console.log(`| ${r.name} | ${r.players} | ${r.n??'MISSING'} | ${r.invalid??'-'} | ${r.r14Killed?.k??'-'} | ${r.hiddenCleared?.k??'-'} | ${r.hiddenCleared?.ci95?.map(x=>(x*100).toFixed(2)).join('–')??'-'} | ${r.meanR14Damage?.toFixed(4)??'-'} | ${r.decisionMs?.p95?.toFixed(1)??'-'} |`);
console.log(`Saved ${out}`);
