from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from playwright.sync_api import sync_playwright
import json, os
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('YZ2_KANIT','/tmp/yz2-kanitlar'));OUT.mkdir(parents=True,exist_ok=True)
class H(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
srv=ThreadingHTTPServer(('127.0.0.1',0),partial(H,directory=str(ROOT)))
Thread(target=srv.serve_forever,daemon=True).start()
URL=f'http://127.0.0.1:{srv.server_port}/index.html?db=HARDENING'
results=[]
def test(name,fn):
 try:fn();results.append({'test':name,'pass':True});print('PASS',name,flush=True)
 except Exception as e:results.append({'test':name,'pass':False,'error':str(e)});print('FAIL',name,str(e)[:1800],flush=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 ctx=browser.new_context(viewport={'width':390,'height':844},service_workers='block')
 ctx.add_init_script("localStorage.setItem('yz2_role','boss')")
 page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(URL);page.wait_for_selector('.command-hero')
 def api(code,arg=None):return page.evaluate("async arg=>{const db=await import('./js/db.js'),c=await import('./js/core.js');"+code+'}',arg)
 today=api("await db.put('customers',c.newRecord({id:'TEST_C',name:'TEST_Firma'}));await db.put('vehicles',c.newRecord({id:'TEST_J',name:'TEST_JCB',type:'JCB'}));await db.metaSet('gemini_key','DUMMY');await db.metaSet('gemini_model','gemini-test');await db.metaSet('gemini_consent',true);return c.todayStr();")
 mock={'kind':'work'}
 def gemini(route):
  if mock['kind']=='work':
   content={'works':[{'date':today,'date_source':'mesaj','customer_id':'TEST_C','vehicle_id':'TEST_J','work_type':'JCB Çalışması','quantity':1,'unit':'Saat','unit_price':2500,'quote':f'{today} TEST_Firma TEST_JCB 1 saat çalıştı saat fiyatı 2500 KDV dahil'}]}
  elif mock['kind']=='price':content={'price_rules':[{'customer_id':'TEST_C','vehicle_id':'TEST_J','unit':'Saat','price':3000,'quote':'TEST_Firma TEST_JCB saatlik fiyatı 3000 TL'}]}
  else:content={'ids':['f0','f1'],'text':'Tahsilat 999999 TL.'}
  route.fulfill(status=200,content_type='application/json',body=json.dumps({'candidates':[{'content':{'parts':[{'text':json.dumps(content)}]}}]}))
 page.route('https://generativelanguage.googleapis.com/**',gemini)
 def assistant():
  page.goto(URL+'#/akilli-asistan');page.wait_for_selector('[data-msg]')
  page.locator('[data-msg]').fill(f'{today} TEST_Firma TEST_JCB 1 saat çalıştı saat fiyatı 2500 KDV dahil')
  page.locator('[data-ask]').click();page.wait_for_selector('[data-kind="work"]')
 def form_gate():
  assistant();row=page.locator('[data-kind="work"]');row.locator('[data-pick]').check();page.locator('[data-save]').click();page.wait_for_timeout(150)
  assert api("return (await db.listActive('work_records')).length;")==0
  row.locator('[name=manual_vat_basis]').select_option('included');row.locator('[name=manual_vat_rate]').fill('20');row.locator('[name=manual_price_confirmed]').check()
  row.locator('[name=quantity]').fill('2');assert not row.locator('[name=manual_price_confirmed]').is_checked()
  row.locator('[name=quantity]').fill('1');row.locator('[name=manual_price_confirmed]').check()
  page.screenshot(path=str(OUT/'kdv-kapisi.png'),full_page=True)
  page.locator('[data-save]').click();page.wait_for_timeout(600)
  v=api("return (await db.listActive('work_records')).map(w=>w.price_snapshot);")
  assert len(v)==1 and v[0]['kdv_included'] is True and v[0]['kdv_rate']==20 and v[0]['amount']==2500,v
 test('Real asistan: missing VAT blocks write, edits revoke consent, included price survives',form_gate)
 def zero_rate():
  assistant();row=page.locator('[data-kind="work"]');row.locator('[data-pick]').check();row.locator('[name=quantity]').fill('2');row.locator('[name=manual_vat_basis]').select_option('excluded');row.locator('[name=manual_vat_rate]').fill('0');row.locator('[name=manual_price_confirmed]').check();page.locator('[data-save]').click();page.wait_for_timeout(500)
  assert api("return (await db.listActive('work_records')).some(w=>w.quantity===2&&w.price_snapshot.kdv_rate===0&&w.price_snapshot.kdv_included===false);")
 test('Real asistan: explicit %0 is not silently replaced by %20',zero_rate)
 def price_rule():
  old=api("const r=c.newRecord({id:'TEST_OLD_PRICE',customer_id:'TEST_C',vehicle_id:'TEST_J',unit:'Saat',price:2000,kdv_rate:20,kdv_included:false,valid_from:'2026-01-01',active:true});await db.put('price_book',r);return r;")
  mock['kind']='price';page.goto(URL+'#/akilli-asistan');page.wait_for_selector('[data-msg]');page.locator('[data-msg]').fill('TEST_Firma TEST_JCB saatlik fiyatı 3000 TL');page.locator('[data-ask]').click();page.wait_for_selector('[data-kind="price"]')
  row=page.locator('[data-kind="price"]');row.locator('[data-pick]').check();assert not row.locator('[name=apply_unpriced]').is_checked()
  page.locator('[data-save]').click();page.wait_for_timeout(120);assert api("return (await db.listActive('price_book')).filter(r=>r.customer_id==='TEST_C').length;")==1
  row.locator('[name=manual_vat_basis]').select_option('included');row.locator('[name=manual_vat_rate]').fill('10');row.locator('[name=valid_from]').fill(today);row.locator('[name=manual_price_confirmed]').check()
  page.locator('[data-save]').click();page.wait_for_timeout(400)
  assert api("return (await db.get('price_book','TEST_OLD_PRICE')); ")==old
  assert api("return (await db.listActive('price_book')).some(r=>r.customer_id==='TEST_C'&&r.price===3000&&r.kdv_rate===10&&r.kdv_included===true&&r.valid_from===c.todayStr());")
  assert api("return (await db.listActive('work_records')).every(w=>w.price_snapshot.unit_price===2500);")
  mock['kind']='work'
 test('Price rule requires VAT and date; older rule and existing snapshots stay unchanged',price_rule)
 def budgets():
  v=api("const g=await import('./js/ai-guard.js');await db.metaSet('ai_daily_request_limit',3);await db.metaSet(g.AI_BUDGET_KEY,{date:g.aiDay(),attempts:0});let sent=0;const f=g.guardedAiFetch(db,async()=>{sent++;return new Response('{}')});const results=await Promise.allSettled(Array.from({length:30},()=>f('mock',{})));return {sent,ok:results.filter(x=>x.status==='fulfilled').length,budget:await db.metaGet(g.AI_BUDGET_KEY)};")
  assert v['sent']==3 and v['ok']==3 and v['budget']['attempts']==3,v
  v=api("const g=await import('./js/ai-guard.js');await db.metaSet('gemini_consent',false);try{await g.reserveAiRequest(db);return false;}catch{return true;}")
  assert v
  api("await db.metaSet('gemini_consent',true);await db.metaSet('ai_daily_request_limit',60);await db.metaSet('ai_request_budget_v1',null);")
 test('IndexedDB transaction serializes 30 parallel reservations and checks revocation',budgets)
 def multi_tab():
  api("await db.metaSet('ai_daily_request_limit',4);await db.metaSet('ai_request_budget_v1',null);")
  other=ctx.new_page();other.goto(URL);other.wait_for_selector('.command-hero')
  # Both tabs start requests before either result is awaited (real shared IndexedDB, no JS mutex).
  code="async()=>{const db=await import('./js/db.js'),g=await import('./js/ai-guard.js');window.guardPromise=Promise.allSettled(Array.from({length:12},()=>g.reserveAiRequest(db)));}"
  page.evaluate(code);other.evaluate(code)
  a=page.evaluate("async()=> (await window.guardPromise).filter(x=>x.status==='fulfilled').length")
  b=other.evaluate("async()=> (await window.guardPromise).filter(x=>x.status==='fulfilled').length")
  assert a+b==4,(a,b)
  other.close();api("await db.metaSet('ai_daily_request_limit',60);await db.metaSet('ai_request_budget_v1',null);")
 test('Two browser tabs share one request ceiling',multi_tab)
 def summary():
  mock['kind']='evidence';page.goto(URL+'#/akilli-asistan/ozet');page.wait_for_selector('[data-ai]');page.locator('[data-ai]').click();page.wait_for_function("() => document.querySelector('[data-note]')?.innerText.includes('AI yalnız')")
  text=page.locator('[data-text]').input_value();assert '999999' not in text and 'İş sayısı: 2' in text,text
  page.screenshot(path=str(OUT/'kanit-ozeti.png'),full_page=True)
 test('AI cannot replace local labels/values in real day summary UI',summary)
 def backup():
  v=api("const b=await import('./js/backup.js'),crypt=await import('./js/backup-crypt.js');await db.metaSet('driver_links',[{lid:'DUMMY',secret:'DUMMY_SECRET',exit:'DUMMY_EXIT'}]);const clean=await b.fullBackup(db),full=await b.fullBackup(db,{includeDriverSecrets:true});let blocked=false;try{await crypt.encodeBackup(full);}catch{blocked=true;}const encrypted=await crypt.encodeBackup(full,'Uzun-Test-Parolasi!');const back=await crypt.decodeBackup(encrypted,async()=>'Uzun-Test-Parolasi!');return {clean:JSON.stringify(clean).includes('DUMMY_SECRET'),blocked,secret:back.meta.find(m=>m.key==='driver_links').value[0].secret,works:back.data.work_records.length};")
  assert v=={'clean':False,'blocked':True,'secret':'DUMMY_SECRET','works':2},v
 test('Real database backup separates secrets and encrypted roundtrip preserves records',backup)
 def driver_security():
  v=api("const sec=await import('./js/security.js'),core=await import('./js/security-core.js');await db.put('personnel',c.newRecord({id:'TEST_P',name:'TEST_Driver',active:true}));const pair=await sec.newDriverLink({pid:'TEST_P',name:'TEST_Driver',vid:'TEST_J'});const code='TEST_OPAQUE',sig=await core.hmac(pair.link.secret,code),data=await db.dumpAll();const pack={lid:pair.link.lid,p:'TEST_P',n:'TEST_Driver',_code:code,_sig:sig};const good=(await sec.checkPayloads([pack],data))[0];const wrong=(await sec.checkPayloads([{...pack,_sig:'wrong'}],data))[0];const unknown=(await sec.checkPayloads([{...pack,lid:'UNKNOWN'}],data))[0];const unsigned=(await sec.checkPayloads([{p:'TEST_P'}],data))[0];await sec.revokeLink(pair.link.lid,'TEST');const revoked=(await sec.checkPayloads([pack],data))[0];return {good:good.ok,wrong:!!wrong.reject,unknown:!!unknown.reject,unsigned:!!unsigned.reject,revoked:!!revoked.reject};")
  assert v=={'good':True,'wrong':True,'unknown':True,'unsigned':True,'revoked':True},v
  msg=api("const drv=await import('./js/driver-core.js');const data=await db.dumpAll();const cfg=drv.driverConfig(data,{personnel_id:'TEST_P',vehicle_id:'TEST_J'});cfg.lid='UNKNOWN';cfg.ls='AAAAAAAAAAAAAAAAAAAAAA';return drv.driverMessage([{id:'TEST_ENTRY',k:'w',date:c.todayStr(),vid:'TEST_J',cid:'TEST_C',wt:'JCB Çalışması',q:3,u:'Saat'}],cfg);")
  page.goto(URL+'#/akilli-asistan');page.wait_for_selector('[data-msg]');page.locator('[data-msg]').fill(msg);page.locator('[data-ask]').click()
  page.wait_for_function("() => document.querySelector('[data-out]')?.innerText.includes('Şoför paketi reddedildi')")
  assert page.locator('[data-kind="work"]').count()==0
  assert api("return (await db.listActive('work_records')).length;")==2
 test('Driver MAC/known link/revocation gates and no AI fallback for forged packets',driver_security)
 def all_routes():
  for route,selector in [('#/yapay-zeka','[data-gconsent]'),('#/kasa','[data-list]'),('#/akilli-asistan/danisman','[data-advgo]'),('#/ayarlar','[data-backup]')]:
   page.goto(URL+route);page.wait_for_timeout(350)
   assert not page.locator('#screen').inner_text().startswith('Hata'),route
  assert not errors,errors
 test('Settings, cash, advisor and AI screens open without JS exceptions',all_routes)
 def lock_burst():
  api("const sec=await import('./js/security-core.js');await db.metaSet('sec_lock',{...(await sec.hashSecret('482917')),idle_min:5});await db.metaSet('sec_fail',{n:0,until:0});")
  page.reload();page.wait_for_selector('#lock-root [data-pw]');page.locator('#lock-root [data-pw]').fill('WRONG')
  page.evaluate("()=>{const input=document.querySelector('#lock-root [data-pw]');for(let i=0;i<20;i++)input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}")
  page.wait_for_timeout(600);assert api("return (await db.metaGet('sec_fail')).n;")==1
  page.locator('#lock-root [data-pw]').fill('482917');page.locator('#lock-root [data-go-un]').click();page.wait_for_selector('#lock-root',state='detached')
  api("await db.metaSet('sec_lock',null);")
 test('Twenty concurrent Enter events cannot race the password check; correct unlock still works',lock_burst)
 def offline():
  off=browser.new_context(viewport={'width':390,'height':844},service_workers='allow')
  off.add_init_script("localStorage.setItem('yz2_role','boss')")
  pg=off.new_page();pg.goto(URL+'&offline=1');pg.wait_for_selector('.command-hero')
  pg.evaluate("async()=>{await navigator.serviceWorker.ready;}")
  # Install caches all JS modules before the ready promise resolves.
  pg.reload();pg.wait_for_selector('.command-hero');off.set_offline(True)
  pg.reload();pg.wait_for_selector('.command-hero')
  assert pg.evaluate("async()=>{const p=await import('./js/assistant-price.js'),e=await import('./js/evidence-report.js');return p.confirmedManualPrice({price:100,quantity:1,vatRate:0,basis:'included',confirmed:true}).amount===100&&e.evidenceCatalog({tahsilat:0}).length===1;}")
  off.close()
 test('Offline reload serves the new finance and evidence modules from atomic app cache',offline)
 browser.close()
srv.shutdown();(OUT/'browser-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
if any(not r['pass'] for r in results):raise SystemExit(1)
