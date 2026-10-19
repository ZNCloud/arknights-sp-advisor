import { fork, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { availableParallelism } from 'node:os';
import { createHash } from 'node:crypto';
import { aggregate } from './stats.mjs';
import { codeHash } from './version.mjs';
const args=process.argv.slice(2),opt={};
for(let i=0;i<args.length;i++){if(!args[i].startsWith('--'))throw Error('Expected --flag');opt[args[i].slice(2)]=args[++i];}
const int=(k,d,min,max)=>{const x=Number(opt[k]??d);if(!Number.isInteger(x)||x<min||x>max)throw Error(`Bad --${k}`);return x;};
const n=int('seeds',10,1,100000),seed=int('seed',1,1,2**31),players=int('players',1,1,4);
if(![1,2,4].includes(players))throw Error('players must be 1,2,4');
const workers=int('workers',Math.min(8,n),1,Math.min(32,availableParallelism()));
const strategy=opt.strategy||'inject';if(!['inject','baseline','search','guide'].includes(strategy))throw Error('Bad strategy');
const config=opt.params?JSON.parse(readFileSync(opt.params,'utf8')):{};
const root=resolve(import.meta.dirname,'../..');
const manifest={version:1,createdAt:new Date().toISOString(),node:process.version,engineCommit:execFileSync('git',['-C',`${root}/engine`,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  codeHash:codeHash(),options:opt,config,configHash:createHash('sha256').update(JSON.stringify(config)).digest('hex'),seeds:Array.from({length:n},(_,i)=>seed+i)};
const out=resolve(opt.out||`${root}/design/results/${strategy}-${opt.kind||'ceiling'}-p${players}.json`);
mkdirSync(dirname(out),{recursive:true});
const tasks=manifest.seeds.map((s,i)=>({index:i,seed:s,players,strategy,kind:opt.kind||'ceiling',layer:int('layer',999,0,999),round:int('round',14,14,15),profile:Number(opt.profile||3),actions:int('actions',80,1,10000),config}));
let next=0,done=0;const rows=new Array(n),children=[];
await new Promise(resolveDone=>{
  function launch(){
    const child=fork(new URL('./worker.mjs',import.meta.url),[],{stdio:['ignore','inherit','inherit','ipc']});children.push(child);
    let current=null,timer=null;
    const send=()=>{if(next>=tasks.length){if(child.connected)child.disconnect();return;}current=tasks[next++];child.send(current);timer=setTimeout(()=>child.kill('SIGTERM'),600000);};
    const receive=({index,row},alive=true)=>{clearTimeout(timer);rows[index]=row;current=null;done++;process.stderr.write(`completed ${done}/${n} seed=${row.seed}${row.error?' ERROR':''}\n`);if(done===n)resolveDone();if(alive)send();else if(next<tasks.length)launch();};
    child.on('message',receive);
    child.on('exit',(code)=>{if(current){const t=current;current=null;receive({index:t.index,row:{seed:t.seed,players,error:`worker exit ${code}`}},false);}});
    send();
  }
  for(let i=0;i<Math.min(n,workers);i++)launch();
});
const summary=aggregate(rows);writeFileSync(out,JSON.stringify({manifest,summary,rows},null,2)+'\n');
console.log(JSON.stringify({out,summary},null,2));
if(!summary.qualityPass)process.exitCode=1;
