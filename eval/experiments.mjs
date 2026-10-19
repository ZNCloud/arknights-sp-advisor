// Generate executable, prespecified experiment groups; execute only with --execute yes.
import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync,execFileSync } from 'node:child_process';
import { codeHash } from './version.mjs';
const a=process.argv.slice(2),o={};for(let i=0;i<a.length;i+=2)o[a[i].replace(/^--/,'')]=a[i+1];
const batch=o.batch||'A',root=resolve(import.meta.dirname,'../..'),dir=`${root}/design/experiments/${batch}`;
if(!['A','B','C','FINAL'].includes(batch))throw Error('batch must be A B C FINAL');
mkdirSync(dir,{recursive:true});
const base=JSON.parse(readFileSync(o.params||new URL('../search/params.json',import.meta.url),'utf8'));
const jobs=[];
const requested=String(o.players||'4').split(',').map(Number);
if(requested.some(n=>![1,2,4].includes(n)))throw Error('--players accepts 4 or 4,2,1');
const selectedPlayers=[4,2,1].filter(n=>requested.includes(n));
const version={codeHash:codeHash(),engineCommit:execFileSync('git',['-C',`${root}/engine`,'rev-parse','HEAD'],{encoding:'utf8'}).trim()};
function job(name,players,strategy,extra={},config=null,seed=1001,seeds=50){
  if(!selectedPlayers.includes(players))return;
  const out=`${dir}/${name}-p${players}.json`,flags={strategy,players,seed,seeds,workers:Number(o.workers||8),out,...extra};
  if(config){const file=`${dir}/${name}-p${players}.params.json`;writeFileSync(file,JSON.stringify(config,null,2)+'\n');flags.params=file;}
  jobs.push({name,players,flags,args:Object.entries(flags).flatMap(([k,v])=>[`--${k}`,String(v)])});
}
if(batch==='A')for(const n of [4,2,1]){
  for(const layer of [0,450,650,999])job(`ceiling-L${layer}`,n,'inject',{kind:'ceiling',layer});
  for(const actions of [40,80,160])job(`growth-A${actions}`,n,'inject',{kind:'growth',actions});
  job('conditional-R15',n,'inject',{kind:'ceiling',layer:999,round:15});
}
if(batch==='B')for(const n of [4,2,1]){
  job('baseline',n,'baseline');job('reference',n,'search',{},base);
  job('no-guide-macros',n,'search',{}, {...base,guideMacros:false});
  for(const [key,values] of Object.entries({depth:[1,3],samples:[4,8],layerWeight:[.05,.2],economyWeight:[1,4],maxDecisions:[24,64],priorWeight:[0,.3]}))
    for(const value of values)job(`${key}-${value}`,n,'search',{}, {...base,[key]:value});
}
if(batch==='C')for(const n of [4,2])for(const teamMode of ['reserved','free','homogeneous'])job(teamMode,n,'search',{}, {...base,teamMode},2001);
if(batch==='FINAL')for(const n of [4,2,1])job('locked',n,'search',{},base,3001,200);
writeFileSync(`${dir}/manifest.json`,JSON.stringify({batch,...version,selectedPlayers,seedContract:'A/B development 1001..1050; C validation 2001..2050; FINAL held out 3001..3200',jobs},null,2)+'\n');
console.log(`Generated ${jobs.length} groups; ${dir}/manifest.json`);
if(o.execute==='yes')for(const j of jobs){
  if(existsSync(j.flags.out)&&o.resume==='yes'){
    const r=JSON.parse(readFileSync(j.flags.out,'utf8'));
    const matches=Object.entries(j.flags).every(([k,v])=>String(r.manifest?.options?.[k])===String(v));
    const expected=j.flags.params?JSON.parse(readFileSync(j.flags.params,'utf8')):{};
    if(r.summary?.qualityPass&&r.summary.n===j.flags.seeds&&matches&&r.manifest.codeHash===version.codeHash&&r.manifest.engineCommit===version.engineCommit&&JSON.stringify(r.manifest.config)===JSON.stringify(expected)){
      console.log(`skip complete ${j.name} p${j.players}`);continue;
    }
  }
  const r=spawnSync(process.execPath,[`${root}/sp-advisor/eval/batch.mjs`,...j.args],{stdio:'inherit'});
  if(r.status!==0)throw Error(`Stop: failed ${j.name} p${j.players}, inspect raw row errors`);
}
