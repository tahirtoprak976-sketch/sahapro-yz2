import assert from 'node:assert/strict';
import {test} from 'node:test';
import {confirmedManualPrice,confirmedRulePrice} from '../js/assistant-price.js';
import {fullBackup} from '../js/backup.js';
import {encodeBackup,decodeBackup} from '../js/backup-crypt.js';
import {evidenceCatalog,renderEvidenceSelection,requestEvidenceReport} from '../js/evidence-report.js';
import {keepVerified} from '../js/day-summary.js';
import {checkAnswer} from '../js/assistant-core.js';
import {reserveAiRequest,guardedAiFetch,AI_BUDGET_KEY,aiDay} from '../js/ai-guard.js';
import {withModelFallback,geminiChat,geminiJson,geminiSettings} from '../js/ai-gemini.js';
const price={price:'2500',quantity:'1',vatRate:'20',basis:'included',confirmed:true};
const adapter = extra => {
 const meta=new Map([['gemini_key','DUMMY'],['gemini_model','gemini-test'],['gemini_consent',true],...Object.entries(extra||{})]);
 return {meta,metaGet:async k=>meta.get(k),metaSet:async(k,v)=>meta.set(k,v)};
};
const response = obj => ({ok:true,status:200,json:async()=>obj});
test('KDV dahil fiyat ve %0 korunur; bilinmeyen oran/baz/onay yazıma geçemez',()=>{
 assert.equal(confirmedManualPrice(price).kdv_included,true);
 assert.equal(confirmedManualPrice({...price,vatRate:0}).kdv_rate,0);
 assert.equal(confirmedManualPrice({...price,quantity:'2,5',basis:'excluded'}).amount,6250);
 for(const bad of [{vatRate:''},{vatRate:null},{vatRate:-1},{vatRate:101},{basis:''},{confirmed:false},{price:Infinity},{price:0},{quantity:-2},{price:'2500x'}])
  assert.throws(()=>confirmedManualPrice({...price,...bad}));
});
test('Paylaşım yedeğinde API ve şoför sırları yok; tam kurtarma şifresiz/kolay şifreyle çıkamaz',async()=>{
 const db={dumpAll:async()=>({work_records:[{id:'W'}]}),metaGet:async()=>null,getAll:async s=>s==='meta'?[{key:'gemini_key',value:'DUMMY_API'},{key:'driver_links',value:[{secret:'DUMMY_SECRET',exit:'DUMMY_EXIT'}]},{key:'regular',value:'OK'}]:[]};
 const clean=await fullBackup(db);
 assert.ok(!JSON.stringify(clean).includes('DUMMY_'));
 const full=await fullBackup(db,{includeDriverSecrets:true});
 assert.ok(JSON.stringify(full).includes('DUMMY_SECRET'));
 await assert.rejects(encodeBackup(full),/şifre gerekli/);
 await assert.rejects(encodeBackup(full,'123456'),/şifre gerekli/);
 const encrypted=await encodeBackup(full,'Uzun-Test-Parolasi!');
 assert.deepEqual(await decodeBackup(encrypted,async()=>'Uzun-Test-Parolasi!'),full);
 encrypted[encrypted.length-1]^=1;
 await assert.rejects(decodeBackup(encrypted,async()=>'Uzun-Test-Parolasi!'));
 assert.deepEqual(await decodeBackup(new TextEncoder().encode(JSON.stringify(clean))),clean);
});
test('Gelir-tahsilat yer değiştirmesi ve küçük sayılar artık doğrulanmış özet olamaz',()=>{
 const facts={gelir:50000,tahsilat:0,is_sayisi:3};
 assert.equal(keepVerified('Tahsilat 50000 TL.',facts).text,'');
 assert.deepEqual(checkAnswer('Bugün 25 iş tamamlandı.',facts),[25]);
 assert.deepEqual(checkAnswer('Tahsilat 2026 TL.',facts),[2026]);
 assert.deepEqual(checkAnswer('17.10.2026',facts),[]);
 const rows=evidenceCatalog(facts), tahsilat=rows.find(r=>r.label==='Tahsilat');
 const out=renderEvidenceSelection({ids:[tahsilat.id],text:'Tahsilat 50000 TL.'},facts);
 assert.equal(out,'Tahsilat: 0');
 assert.throws(()=>renderEvidenceSelection({ids:['__proto__']},facts));
 assert.throws(()=>renderEvidenceSelection({ids:['f999']},facts));
});
test('Aynı anda yüz istek sınırı aşamaz; başarısızlıklar da bütçeyi tüketir',async()=>{
 const db=adapter({ai_daily_request_limit:3});let sent=0;
 const f=guardedAiFetch(db,async()=>{sent++;throw Error('Ağ hatası')});
 await Promise.allSettled(Array.from({length:100},()=>f('mock',{})));
 assert.equal(sent,3);assert.equal(db.meta.get(AI_BUDGET_KEY).attempts,3);
});
test('Onay iptali ve bozuk sayaç ağ çağrısından önce reddedilir',async()=>{
 const db=adapter({gemini_consent:false});let sent=0;
 await assert.rejects(guardedAiFetch(db,async()=>sent++)('mock',{}),/onay/);assert.equal(sent,0);
 db.meta.set('gemini_consent',true);db.meta.set(AI_BUDGET_KEY,{date:aiDay(),attempts:'bad'});
 await assert.rejects(reserveAiRequest(db),/geçersiz/);
 db.meta.set('gemini_consent','true');assert.equal((await geminiSettings(db)).ready,false);
});
test('Türkiye gece yarısında bütçe günü doğru değişir',()=>{
 assert.equal(aiDay(new Date('2026-10-17T20:59:59Z')),'2026-10-17');
 assert.equal(aiDay(new Date('2026-10-17T21:00:00Z')),'2026-10-18');
});
test('JSON şablon retry ayrı sayılır; tavan sonrası ikinci ağ denemesi çıkmaz',async()=>{
 const db=adapter({ai_daily_request_limit:1});let sent=0;
 const fake=async()=>{sent++;return {ok:false,status:400,json:async()=>({error:{message:'responseJsonSchema unsupported'}})}};
 await assert.rejects(withModelFallback(db,o=>geminiJson([{text:'x'}],{...o,schema:{type:'object'}}),{fetchFn:fake}),/sınırı/);
 assert.equal(sent,1);
});
test('Büyük istek, aşırı yanıt ve bozuk JSON reddedilir',async()=>{
 let sent=0;
 await assert.rejects(geminiChat([{role:'user',content:'x'.repeat(17*1024*1024)}],{key:'DUMMY',model:'m',fetchFn:async()=>{sent++}}),/çok büyük/);
 assert.equal(sent,0);
 await assert.rejects(geminiChat([],{key:'DUMMY',model:'m',fetchFn:async()=>new Response('x'.repeat(4*1024*1024+1))}),/boyutu/);
 await assert.rejects(geminiChat([],{key:'DUMMY',model:'m',fetchFn:async()=>new Response('not-json')}),/JSON/);
});
test('AI kanıt seçimi modele ait rakam ve etiketi hiçbir zaman yayınlamaz',async()=>{
 const db=adapter();const old=globalThis.fetch;
 globalThis.fetch=async()=>response({candidates:[{content:{parts:[{text:'{"ids":["f1"],"text":"Tahsilat 99999 TL"}'}]}}]});
 try {assert.equal(await requestEvidenceReport(db,{gelir:50000,tahsilat:0},'test'),'Tahsilat: 0');}
 finally {globalThis.fetch=old;}
});

test('Fiyat kuralı geçerlilik tarihi zorunlu, bozuk tarih reddedilir',()=>{
 assert.throws(()=>confirmedRulePrice({...price,validFrom:''}),/başlangıcını/);
 assert.throws(()=>confirmedRulePrice({...price,validFrom:'2026-02-30'}),/başlangıcını/);
 assert.equal(confirmedRulePrice({...price,validFrom:'2026-10-17'}).valid_from,'2026-10-17');
});
test('Yanıt bekleme zaman aşımı yerel kayıt yolunu engellemeden çağrıyı keser',async()=>{
 const timer=globalThis.setTimeout;
 globalThis.setTimeout=(fn,ms,...args)=>timer(fn,ms===45000?5:ms,...args);
 try {
  await assert.rejects(geminiChat([],{key:'DUMMY',model:'m',fetchFn:async(url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))}),/zaman aşımı/);
 } finally {globalThis.setTimeout=timer;}
});
