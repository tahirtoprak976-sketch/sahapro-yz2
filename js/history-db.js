import * as db from './db.js';
import { newRecord, nowISO } from './core.js';
import { readHistoryPackage, prepareHistory, HISTORY_STORES } from './history-core.js';
import { backupBeforeHistoryImport } from './backup.js';
export async function loadHistoryData() {
  const pairs=await Promise.all(HISTORY_STORES.map(async s=>[s,await db.getAll(s)]));
  return Object.fromEntries(pairs);
}
export async function commitHistory(value, choices, options={}) {
  const p=readHistoryPackage(value);
  // Failure to create a recoverable full backup prevents ALL writes.
  await backupBeforeHistoryImport(db);
  const connection=await db.openDB();
  return new Promise((resolve,reject)=>{
    const t=connection.transaction([...HISTORY_STORES,'audit_log'],'readwrite');
    const data={};let pending=HISTORY_STORES.length,error,result;
    function stop(e){error=e;t.abort();}
    for(const s of HISTORY_STORES) {
      const req=t.objectStore(s).getAll();
      req.onsuccess=()=>{
        data[s]=req.result;
        if(--pending) return;
        try {
          // Revalidate within the same serialized transaction; preview is never authoritative.
          const plan=prepareHistory(p,choices,data,options);
          if(!plan.ready) throw Error(plan.errors.join('\n')||'Aktarılacak satır seçilmedi.');
          const batch=newRecord().id;
          for(const [store,rows] of Object.entries(plan.writes))for(const row of rows) {
            if(row.history_source)row.history_source.batch_id=batch;
            t.objectStore(store).add(row);
            t.objectStore('audit_log').add(newRecord({entity:store,entity_id:row.id,action:'create',new:row,reason:'Geçmiş iş aktarımı',at:nowISO(),history_batch_id:batch}));
          }
          result={batch_id:batch,works:plan.writes.work_records.length,fuels:plan.writes.fuel_records.length,cards:plan.newCards.length,record_ids:plan.writes.work_records.concat(plan.writes.fuel_records).map(r=>r.id)};
        } catch(e){stop(e);}
      };
    }
    t.oncomplete=()=>resolve(result);
    t.onabort=t.onerror=()=>reject(error||t.error||Error('Aktarım tamamlanamadı; hiçbir satır kaydedilmedi.'));
  });
}
