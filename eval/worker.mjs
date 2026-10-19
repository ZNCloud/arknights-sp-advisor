import { runInjection } from './inject.mjs';
process.on('message',async task=>{
  const start=performance.now();
  try {
    const row=task.strategy==='inject'?runInjection(task):await (await import('./match.mjs')).runMatch(task);
    process.send({index:task.index,row:{...row,ms:performance.now()-start}});
  } catch(e) {process.send({index:task.index,row:{seed:task.seed,players:task.players,error:e.stack,ms:performance.now()-start}});}
});
