import { readdirSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { contentPatch } from './content.mjs';
export function codeHash(){
  const root=resolve(import.meta.dirname,'..'),h=createHash('sha256');
  for(const dir of ['eval','search','guides'])for(const name of readdirSync(`${root}/${dir}`).filter(x=>x.endsWith('.mjs')||(dir==='search'&&x==='params.json')).sort())
    h.update(`${dir}/${name}\n`).update(readFileSync(`${root}/${dir}/${name}`));
  return h.digest('hex');
}

// Game-data fingerprint (B1): sha256 over the engine's data/*.json (assets.json and i18n/ excluded — art/text only)
// plus the engine commit. Models and self-play data carry it; a mismatch marks the model stale (advisor/meta.mjs).
export function engineCommit(engineRoot){
  const git=`${engineRoot}/.git`,head=readFileSync(`${git}/HEAD`,'utf8').trim();
  if(!head.startsWith('ref: '))return head;
  const ref=head.slice(5);
  try{return readFileSync(`${git}/${ref}`,'utf8').trim();}catch{}
  const packed=readFileSync(`${git}/packed-refs`,'utf8').split('\n').find(l=>l.endsWith(` ${ref}`));
  if(!packed)throw Error(`engine ref ${ref} not found`);
  return packed.split(' ')[0];
}
export function dataHash(engineRoot=resolve(import.meta.dirname,'../../engine')){
  const h=createHash('sha256'),dir=`${engineRoot}/data`,files=readdirSync(dir).filter(x=>x.endsWith('.json')&&x!=='assets.json').sort();
  for(const name of files)h.update(`${name}\n`).update(readFileSync(`${dir}/${name}`));
  // An installed in-memory content patch (eval/content.mjs) is part of the game data.
  const patch=contentPatch();if(patch)h.update(`patch:${patch.sha256}`);
  const data=h.digest('hex'),commit=engineCommit(engineRoot);
  // fingerprint = data + engine commit (simulation code changes matter as much as numbers).
  return {dataHash:data,engineCommit:commit,files:files.length,contentPatch:patch?.sha256||null,fingerprint:createHash('sha256').update(`${data}\n${commit}`).digest('hex')};
}
