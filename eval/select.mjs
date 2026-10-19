// Deterministic diagnostic candidate selection, never silently promotes all-zero results.
import { readFileSync,writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const file=process.argv[2];if(!file)throw Error('Pass B or C manifest.json');
const m=JSON.parse(readFileSync(file,'utf8'));if(!['B','C'].includes(m.batch))throw Error('Use B or C');
const groups=new Map();
for(const j of m.jobs){const r=JSON.parse(readFileSync(j.flags.out,'utf8'));
  if(!r.summary.qualityPass||r.rows.length!==Number(j.flags.seeds)||r.manifest.codeHash!==m.codeHash)throw Error(`Invalid or stale ${j.name}`);
  const g=groups.get(j.name)||{name:j.name,flags:j.flags,rows:[]};g.rows.push(r);groups.set(j.name,g);
}
const score=g=>{const rs=g.rows;return [Math.min(...rs.map(r=>r.summary.hiddenCleared.rate)),rs.reduce((s,r)=>s+r.summary.hiddenCleared.k,0),rs.reduce((s,r)=>s+r.summary.r14Killed.k,0),rs.reduce((s,r)=>s+r.rows.reduce((t,x)=>t+(x.battles?.find(z=>z.round===14)?.damageFraction||0),0),0)];};
const ordered=[...groups.values()].filter(g=>g.flags.params).sort((a,b)=>{const x=score(a),y=score(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return y[i]-x[i];return a.name.localeCompare(b.name);});
const best=ordered[0],reference=groups.get(m.batch==='B'?'baseline':'reserved');
const improvement=best.rows.every(r=>r.summary.hiddenCleared.rate>=reference.rows.find(t=>t.rows[0].players===r.rows[0].players).summary.hiddenCleared.rate)&&score(best)[1]>score(reference)[1];
const dir=dirname(file),params=JSON.parse(readFileSync(best.flags.params,'utf8'));
writeFileSync(`${dir}/candidate.params.json`,JSON.stringify(params,null,2)+'\n');
const result={chosen:best.name,score:score(best),eligibleForValidation:improvement,
  status:improvement?'POINT_ESTIMATE_IMPROVED_REQUIRES_PAIRED_VALIDATION':'DIAGNOSTIC_ONLY_NO_R15_IMPROVEMENT',
  ranking:ordered.map(g=>({name:g.name,score:score(g)})),instruction:'Do not overwrite default parameters or claim 80%. Run paired comparison and held-out validation.'};
writeFileSync(`${dir}/SELECTION.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
