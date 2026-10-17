from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
import json, os
NEW=Path(__file__).resolve().parents[1]
OLD=Path(os.environ.get('YZ2_OLD','/tmp/yz2-v10'))  # önceki YZ2 sürümünün kaynak klasörü (ör. canlıdaki v1.0)
phase={'new':False}
class H(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(NEW if phase['new'] else OLD),**kwargs)
 def translate_path(self,path):
  self.directory=str(NEW if phase["new"] else OLD)
  return super().translate_path(path)
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),H);Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/index.html?db=UPGRADE_SAFE'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);ctx=b.new_context(service_workers='allow');ctx.add_init_script("localStorage.setItem('yz2_role','boss')");pg=ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
 pg.goto(url);pg.wait_for_selector('.command-hero');pg.evaluate('async()=>{await navigator.serviceWorker.ready;}');pg.reload();pg.wait_for_selector('.command-hero')
 before=pg.evaluate('''async()=>{const db=await import('./js/db.js'),c=await import('./js/core.js');await db.put('customers',c.newRecord({id:'TEST_OLD_C',name:'TEST Existing Customer'}));await db.put('vehicles',c.newRecord({id:'TEST_OLD_V',name:'TEST Existing Vehicle'}));await db.put('work_records',c.newRecord({id:'TEST_OLD_W',date:'2026-10-12',customer_id:'TEST_OLD_C',vehicle_id:'TEST_OLD_V',work_type:'JCB Çalışması',quantity:2.5,unit:'Saat',price_snapshot:{amount:6250,unit_price:2500,kdv_rate:20,kdv_included:false,locked:true}}));await db.put('aliases',c.newRecord({id:'TEST_ALIAS',alias:'TEST Patron',target_type:'customer',target_id:'TEST_OLD_C',active:true}));await db.metaSet('driver_links',[{lid:'TEST_LINK',secret:'DUMMY_SECRET',exit:'DUMMY_EXIT'}]);return {version:c.APP_VERSION,work:await db.get('work_records','TEST_OLD_W'),alias:await db.get('aliases','TEST_ALIAS'),links:await db.metaGet('driver_links')};}''')
 assert before['version'].endswith('YZ2 v1.0')
 phase['new']=True
 pg.evaluate('async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();}')
 for _ in range(150):
  if pg.evaluate('async()=> {const r=await navigator.serviceWorker.getRegistration();return r?.waiting?.state==="installed";}'):break
  pg.wait_for_timeout(100)
 else:raise AssertionError('New worker did not finish installation')
 with pg.expect_navigation(wait_until='load'):
  pg.evaluate('async()=>{const r=await navigator.serviceWorker.getRegistration();r.waiting?.postMessage({type:"SKIP_WAITING"});}')
 pg.wait_for_selector('.command-hero')
 after=pg.evaluate('''async()=>{const db=await import('./js/db.js'),c=await import('./js/core.js');return {version:c.APP_VERSION,work:await db.get('work_records','TEST_OLD_W'),alias:await db.get('aliases','TEST_ALIAS'),links:await db.metaGet('driver_links')};}''')
 assert after['version'].endswith('YZ2 v1.1'),after['version']
 for key in ['work','alias','links']:assert before[key]==after[key],key
 assert not errs,errs
 print('PASS YZ2 v1.0 → YZ2 v1.1 (v3.9.02 tabanlı) Service Worker update: locked work snapshot, alias, driver secrets unchanged')
 Path(os.environ.get('YZ2_KANIT','/tmp/yz2-kanitlar')+'/upgrade.json').write_text(json.dumps({'from':before['version'],'to':after['version'],'preserved':['locked work','alias','driver links'],'errors':errs},indent=2))
 b.close()
server.shutdown()
