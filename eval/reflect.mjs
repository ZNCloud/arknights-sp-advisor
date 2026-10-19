import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { classifyFailure } from './recorder.mjs';
const [input,out]=process.argv.slice(2);if(!input||!out)throw Error('Usage: reflect.mjs report.json output-directory');
const data=JSON.parse(readFileSync(input,'utf8'));if(!data.summary.qualityPass)throw Error('Fix invalid simulation group first');
mkdirSync(out,{recursive:true});
const failures=data.rows.filter(r=>!r.hiddenCleared).sort((a,b)=>b.players-a.players||a.seed-b.seed).map(r=>({
  schemaVersion:1,seed:r.seed,players:r.players,injection:!!r.injection,source:input,codeHash:data.manifest.codeHash,
  failure:classifyFailure(r),bossId:r.bossId,hiddenBossId:r.hiddenBossId,hiddenLayerSum:r.hiddenLayerSum,
  battles:r.battles,rounds:r.reflectionRounds||[],productionOnlyTrace:r.trace||null,
  missingRoundTrace:!r.reflectionRounds,missingReason:r.reflectionRounds?null:'Legacy output: rerun to record exact enemy and charged LP fields',
  teams:r.teams||[],decisionSample:r.decisions||[]}));
const counts={};for(const r of failures)counts[r.failure.primary]=(counts[r.failure.primary]||0)+1;
for(let i=0;i<failures.length;i+=10)writeFileSync(`${out}/dead-${String(i/10+1).padStart(3,'0')}.json`,JSON.stringify({schemaVersion:1,instruction:'Explain deaths using engine file:line, propose one concrete change per hypothesis, then verify with paired seeds.',matches:failures.slice(i,i+10)},null,2)+'\n');
const hypotheses={schemaVersion:1,status:'TEMPLATE_REQUIRES_MODEL_ANALYSIS',batch:input,hypotheses:[{
  id:'H001',seeds:[],failureClass:'PRE_R14_ELIMINATION',observations:[],
  mechanismEvidence:[{file:'engine/server/match/match/settle.js',line:41,claim:'Replace with relevant mechanism and causal explanation'}],
  counterfactual:'Which available mechanism or 2–3-piece combination could have prevented this death?',
  change:{kind:'parameter|macro|prior',file:'sp-advisor/search/params.json',key:null,before:null,after:null},
  test:{reference:null,candidate:null,seedStart:1001,seeds:50,players:4,primary:'hiddenCleared',secondary:['r14Killed','meanR14Damage'],retainIf:'No errors; paired improvement; no unacceptable latency regression'},
  status:'UNTESTED',pairedResult:null,decision:'DO_NOT_PROMOTE_UNTESTED'}]};
writeFileSync(`${out}/HYPOTHESES.template.json`,JSON.stringify(hypotheses,null,2)+'\n');
writeFileSync(`${out}/SUMMARY.json`,JSON.stringify({input,n:data.rows.length,failures:failures.length,counts,batches:Math.ceil(failures.length/10)},null,2)+'\n');
console.log(JSON.stringify({out,counts,failures:failures.length}));
