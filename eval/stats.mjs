export function wilson(k,n,z=1.959963984540054) {
  if(!n) return null;
  const p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  return [k===0?0:Math.max(0,c-h),k===n?1:Math.min(1,c+h)];
}
export function aggregate(rows) {
  const n=rows.length;
  const metric=key=>{const k=rows.filter(x=>x[key]===true).length;return {k,n,rate:n?k/n:null,ci95:wilson(k,n)};};
  const invalid=rows.filter(x=>x.error||x.errors?.match||x.errors?.sim||x.errors?.meta||x.errors?.log?.length).length;
  const reached=rows.filter(x=>x.hiddenReached===true),cleared=reached.filter(x=>x.hiddenCleared===true).length;
  const decisionMs=rows.flatMap(x=>x.decisionMs||[]).sort((a,b)=>a-b);
  return {n,invalid,qualityPass:invalid===0,r14Killed:metric('r14Killed'),hiddenReached:metric('hiddenReached'),hiddenCleared:metric('hiddenCleared'),
    hiddenConditional:{k:cleared,n:reached.length,rate:reached.length?cleared/reached.length:null,ci95:wilson(cleared,reached.length)},
    hiddenClearedFamilywiseCi95:wilson(rows.filter(x=>x.hiddenCleared===true).length,n,2.39397979981851),
    decisionMs:decisionMs.length?{n:decisionMs.length,p50:decisionMs[Math.floor(.5*(decisionMs.length-1))],p95:decisionMs[Math.floor(.95*(decisionMs.length-1))],max:decisionMs.at(-1)}:null,
    byHiddenBoss:Object.fromEntries([...new Set(rows.map(x=>x.hiddenBossId).filter(Boolean))].map(id=>{const r=rows.filter(x=>x.hiddenBossId===id),k=r.filter(x=>x.hiddenCleared).length;return[id,{k,n:r.length,ci95:wilson(k,r.length)}];}))};
}
