import { readdirSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
export function codeHash(){
  const root=resolve(import.meta.dirname,'..'),h=createHash('sha256');
  for(const dir of ['eval','search','guides'])for(const name of readdirSync(`${root}/${dir}`).filter(x=>x.endsWith('.mjs')||(dir==='search'&&x==='params.json')).sort())
    h.update(`${dir}/${name}\n`).update(readFileSync(`${root}/${dir}/${name}`));
  return h.digest('hex');
}
