// Document presentation only: never calculates, changes, or persists business data.
const profile = (code, category, subtitle, identity, detail, groups = []) => ({code, category, subtitle, identity, detail, groups});
export const PDF_TEMPLATES = {
  work: profile('IS', 'OPERASYON', 'Saha çalışma kaydı', 'İş ve Saha Bilgileri', 'Çalışma Kalemleri', [['Çalışma ve Miktar', /iş tür|yapılan iş|miktar|birim$|malzeme|sefer|saat|mola|başlangıç saati|bitiş saati/i], ['Fiyatlandırma', /fiyat|kdv|tutar/i]]),
  slip: profile('FS', 'OPERASYON', 'Hizmet ve teslim kaydı', 'Teslim ve İş Bilgileri', 'Gerçekleşen Hizmetler'),
  quote: profile('TK', 'TİCARİ', 'Hizmet ve fiyat teklifi', 'Teklif ve Muhatap Bilgileri', 'Teklif Kalemleri'),
  comparison: profile('KR', 'TİCARİ', 'Teklif sürümleri ve alternatifleri', 'Karşılaştırma Bilgileri', 'Karşılaştırma Tablosu'),
  contract: profile('SZ', 'TİCARİ', 'Taraflar, hizmet kapsamı ve koşullar', 'Taraflar ve Sözleşme Bilgileri', 'Sözleşme Fiyat Eki'),
  progress: profile('HK', 'HAKEDİŞ', 'Dönemsel iş ve bedel dökümü', 'Hakediş ve Dönem Bilgileri', 'Hakediş Kalemleri'),
  account: profile('CR', 'FİNANS', 'Borç, alacak ve bakiye hareketleri', 'Cari Hesap Bilgileri', 'Cari Hesap Hareketleri'),
  receipt: profile('TH', 'FİNANS', 'Tahsilat / ödeme kayıt belgesi', 'Ödeme ve Taraf Bilgileri', 'Tahsilat / Ödeme Hareketleri'),
  cash: profile('KS', 'FİNANS', 'Kasa hareket ve teslim takibi', 'Kasa ve Dönem Bilgileri', 'Kasa Hareketleri'),
  bank: profile('BN', 'FİNANS', 'Hesap ve banka hareket dökümü', 'Banka Hesap Bilgileri', 'Banka Hareketleri'),
  fuel: profile('YK', 'FİLO', 'Araç / makine yakıt takibi', 'Araç ve Yakıt Bilgileri', 'Yakıt Hareketleri', [['Yakıt ve Sayaç', /litre|yakıt|km|kilometre|saat|fiyat|tutar|kdv/i]]),
  tank: profile('DP', 'YAKIT', 'Tank giriş, çıkış ve stok takibi', 'Tank ve Dönem Bilgileri', 'Tank Hareketleri'),
  vehicle: profile('AR', 'FİLO', 'Araç / makine bilgi kartı', 'Araç Kimlik Bilgileri', 'Araç Bilgi Dökümü', [['Teknik ve İşletme Bilgileri', /marka|model|yıl|mülkiyet|özmal|taşeron|yakıt|km|kilometre|saat|zimmet/i]]),
  vehicle_document: profile('AE', 'FİLO', 'Araca ait evrak ve geçerlilik takibi', 'Araç ve Belge Bilgileri', 'Araç Evrak Dökümü', [['Geçerlilik ve Hatırlatma', /geçerlilik|hatırlatma|başlangıç|bitiş/i]]),
  personnel: profile('PR', 'PERSONEL', 'Personel bilgi kartı', 'Personel Bilgileri', 'Personel Bilgi Dökümü', [['Görev ve Çalışma Bilgileri', /görev|işe giriş|zimmet|başlangıç|bitiş|aktif/i]]),
  personnel_document: profile('PE', 'PERSONEL', 'Kişiye ait evrak ve geçerlilik takibi', 'Personel ve Belge Bilgileri', 'Personel Evrak Dökümü', [['Geçerlilik ve Hatırlatma', /geçerlilik|hatırlatma|başlangıç|bitiş/i]]),
  personnel_activity: profile('PC', 'PERSONEL', 'İzin, çalışma ve zimmet takibi', 'Personel ve Dönem Bilgileri', 'İzin / Çalışma Hareketleri'),
  leave: profile('IZ', 'PERSONEL', 'İzin talep, onay ve kayıt belgesi', 'Personel Bilgileri', 'İzin Bilgileri'),
  payroll: profile('UA', 'PERSONEL', 'Ücret, avans ve ödeme takip defteri', 'Personel ve Dönem Bilgileri', 'Ücret / Avans Hareketleri'),
  maintenance: profile('BK', 'FİLO', 'Bakım ve servis işlem kaydı', 'Araç ve Servis Bilgileri', 'Bakım İşlemleri', [['Yapılan İşlem ve Parçalar', /bakım|işlem|parça|açıklama/i], ['Maliyet ve Durum', /maliyet|kdv|tutar|durum/i]]),
  fault: profile('AZ', 'FİLO', 'Arıza bildirimi ve müdahale kaydı', 'Araç ve Arıza Bilgileri', 'Arıza ve Müdahale Dökümü', [['Arıza ve Müdahale', /arıza|açıklama|önem|servis|parça/i], ['Maliyet ve Durum', /maliyet|kdv|tutar|durum/i]]),
  service_plan: profile('BP', 'FİLO', 'Tarih ve sayaç bazlı bakım planı', 'Araç ve Plan Bilgileri', 'Bakım Takvimi'),
  expense: profile('GD', 'FİNANS', 'Gider ve ödeme takibi', 'Gider ve Kaynak Bilgileri', 'Gider Kalemleri', [['Tutar ve Ödeme Bilgileri', /tutar|kdv|ödeyen|ödeme|personele/i]]),
  customer: profile('MS', 'MÜŞTERİ', 'Firma ve iletişim bilgi kartı', 'Müşteri Bilgileri', 'Müşteri Kayıt Dökümü'),
  site: profile('ST', 'OPERASYON', 'Şantiye ve saha bilgi kartı', 'Şantiye Bilgileri', 'Şantiye İş Dökümü'),
  contractor: profile('TS', 'OPERASYON', 'Taşeron ve çalışma özeti', 'Taşeron Bilgileri', 'Taşeron Çalışmaları'),
  price: profile('FL', 'TİCARİ', 'Fiyat, birim ve uygulama kapsamı', 'Fiyat Listesi Kapsamı', 'Fiyat Kalemleri'),
  dump: profile('DK', 'OPERASYON', 'Döküm sahası ve taşıma takibi', 'Döküm Sahası Bilgileri', 'Döküm İş Satırları'),
  quarry: profile('OC', 'OPERASYON', 'Malzeme ocağı ve sevkiyat takibi', 'Ocak Bilgileri', 'Malzeme / Sevkiyat Satırları'),
  document: profile('BL', 'BELGE', 'Belge sahibi ve geçerlilik takibi', 'Belge ve Sahip Bilgileri', 'Belge Dökümü', [['Geçerlilik ve Hatırlatma', /geçerlilik|hatırlatma|başlangıç|bitiş/i]]),
  daily: profile('GS', 'YÖNETİM', 'Günlük faaliyet ve kapanış özeti', 'Gün ve Rapor Bilgileri', 'Günlük Faaliyetler'),
  management: profile('YR', 'YÖNETİM', 'Gelir, maliyet ve faaliyet değerlendirmesi', 'Yönetim Özeti', 'Yönetim Dökümü'),
  supplier: profile('TD', 'FİNANS', 'Tedarikçi firma bilgi kartı', 'Tedarikçi Bilgileri', 'Tedarikçi Dökümü'),
  payable: profile('AB', 'FİNANS', 'Alış belgesi ve borç takibi', 'Belge ve İşlem Tarafı', 'Alış Kalemleri'),
  aging: profile('VD', 'FİNANS', 'Vade ve gecikme dağılımı', 'Dönem ve Taraf Bilgileri', 'Vade / Yaşlandırma Dökümü'),
  purchase: profile('SA', 'SATIN ALMA', 'Sipariş ve teslim kapsamı', 'Sipariş ve Tedarikçi Bilgileri', 'Sipariş Kalemleri'),
  instrument: profile('CS', 'FİNANS', 'Çek / senet portföy takibi', 'Evrak ve Taraf Bilgileri', 'Çek / Senet Hareketleri'),
  activity: profile('TG', 'OPERASYON', 'Sahibine bağlı görev ve takip', 'Görev ve Sahip Bilgileri', 'Takip Görevleri'),
  report: profile('RP', 'RAPOR', 'Filtreli kayıt ve faaliyet dökümü', 'Rapor Bilgileri', 'Ayrıntılı Kayıtlar'),
};
export const STORE_TEMPLATES = {
  work_records:'work',slips:'slip',quotes:'quote',quote:'quote',contracts:'contract',contract:'contract',hakedis:'progress',cari_movements:'account',cash_records:'cash',fuel_records:'fuel',fuel_tank_movements:'tank',vehicles:'vehicle',personnel:'personnel',personnel_events:'personnel_activity',maintenance_records:'maintenance',fault_records:'fault',expense_records:'expense',customers:'customer',sites:'site',contractors:'contractor',price_book:'price',dump_sites:'dump',quarries:'quarry',documents:'document',suppliers:'supplier',payables:'payable',supplier_payments:'receipt',bank_accounts:'bank',bank_movements:'bank',receivable_plans:'aging',purchase_orders:'purchase',payroll_entries:'payroll',service_plans:'service_plan',activities:'activity',expense_categories:'expense',daily_closings:'daily',instruments:'instrument',daily:'daily',management:'management',
};
const lower = (s) => String(s || '').toLocaleLowerCase('tr-TR');
export function templateKey(spec) {
  if (PDF_TEMPLATES[spec.template]) return spec.template;
  if (STORE_TEMPLATES[spec.store]) return STORE_TEMPLATES[spec.store];
  const title=lower(spec.title);
  const rules=[
    [/karşılaştır|revizyon karşı/,'comparison'],[/sözleşme/,'contract'],[/hakediş/,'progress'],[/teklif/,'quote'],[/personel.*(evrak|belge)|src|ehliyet/,'personnel_document'],[/araç.*(evrak|belge)|muayene/,'vehicle_document'],[/ücret|avans/,'payroll'],[/personel.*(izin|çalışma|zimmet)|izin.*rapor/,'personnel_activity'],[/personel/,'personnel'],[/bakım.*plan|bakım.*takvim/,'service_plan'],[/bakım/,'maintenance'],[/arıza/,'fault'],[/tank|depo/,'tank'],[/yakıt/,'fuel'],[/dijital.*fiş|fiş/,'slip'],[/vade|yaşlandır/,'aging'],[/cari|ekstre/,'account'],[/tahsilat|ödeme/,'receipt'],[/banka/,'bank'],[/kasa/,'cash'],[/satın alma|sipariş/,'purchase'],[/alış|borçlar/,'payable'],[/tedarikçi|petrolcü/,'supplier'],[/çek|senet/,'instrument'],[/maliyet|yönetici|yönetim/,'management'],[/gün|hafta|operasyon/,'daily'],[/döküm/,'dump'],[/ocak/,'quarry'],[/fiyat/,'price'],[/müşteri/,'customer'],[/şantiye/,'site'],[/taşeron/,'contractor'],[/araç|filo/,'vehicle'],[/gider/,'expense'],[/belge/,'document'],[/takip|görev/,'activity'],[/iş/,'work'],
  ];
  return rules.find(([re])=>re.test(title))?.[1] || 'report';
}
const DISPLAY_CODES = {
  UNIT_PRICE:"Birim Fiyatlı",QUANTITY_BASED:"Miktara Dayalı",LUMP_SUM:"Götürü Bedel",ALTERNATIVE:"Alternatifli",
  PERSONELDE:"Personelde",KASADA:"Kasada",BANKADA:"Bankada",TESLIM_EDILDI:"Teslim Edildi",IN:"Giriş",OUT:"Çıkış",
};
const displayValue=(value)=>typeof value==='string' ? DISPLAY_CODES[value] || value : value;
const moneyLabel=/^(ara toplam|genel toplam|kdv(?:\s*%.*)?|kdv tutarı|kdv dahil tutar|kdv hariç tutar|net|brüt|ödenen|kalan|bakiye|toplam tutar|toplam)$/i;
export function prepareDocument(spec) {
  const key=templateKey(spec),p=PDF_TEMPLATES[key];
  const sections=[];
  for(const original of spec.sections || []) {
    // Presentation copies; caller's objects/financial snapshot are never mutated.
    const section={...original, ...(original.pairs ? {pairs:original.pairs.map(([l,v])=>[l,displayValue(v)])}:{}), ...(original.rows ? {rows:original.rows.map(row=>row.map(displayValue))}:{})};
    if(section.headers) {section.title ||= p.detail;sections.push(section);continue;}
    if(!section.pairs || section.layout || section.title || section.image) {sections.push(section);continue;}
    const pairs=section.pairs.filter(([,v])=>v!==null&&v!==undefined&&v!=='');
    if(pairs.length && pairs.every(([l])=>moneyLabel.test(l))) {sections.push({...section,title:'Bedel Özeti',layout:'totals',pairs});continue;}
    const buckets=new Map([[p.identity,[]],...(p.groups || []).map(([t])=>[t,[]]),['Açıklamalar ve Notlar',[]]]);
    for(const pair of pairs) {
      const label=pair[0];
      const target=/açıklama|iç not|not$|kapsam|şart|sorumluluk|fesih|iş güvenliği/i.test(label)?'Açıklamalar ve Notlar':(p.groups || []).find(([,re])=>re.test(label))?.[0] || p.identity;
      buckets.get(target).push([...pair]);
    }
    let first=true;
    for(const [title,ps]of buckets)if(ps.length){sections.push({title,pairs:ps,layout:title==='Açıklamalar ve Notlar'?'clauses':'identity',...(first&&section.text?{text:section.text}:{})});first=false;}
    if(first&&section.text)sections.push({text:section.text});
  }
  return {...spec,template:key,profile:p,sections,orientation:spec.orientation || ((sections.some(s=>s.headers?.length>7))?'landscape':'portrait')};
}
