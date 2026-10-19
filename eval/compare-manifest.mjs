import { readFileSync,mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
const file=process.argv[2],m=JSON.parse(readFileSync(file,'utf8')),dir=`${dirname(file)}/paired`;
mkdirSync(dir,{recursive:true});
for(const j of m.jobs){
  const name=m.batch==='A'?'ceiling-L0':m.batch==='B'?'baseline':m.batch==='C'?'reserved':null;
  const ref=m.jobs.find(x=>x.players===j.players&&x.name===name);
  if(!ref)throw Error('Expected A, B or C manifest');if(ref===j)continue;
  const r=spawnSync(process.execPath,[`${import.meta.dirname}/compare.mjs`,ref.flags.out,j.flags.out,`${dir}/${j.name}-p${j.players}.json`],{stdio:'inherit'});
  if(r.status!==0)throw Error(`Comparison failed: ${j.name}`);
}
