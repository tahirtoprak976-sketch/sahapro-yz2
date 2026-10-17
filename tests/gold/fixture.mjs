export const fixture = () => ({
  customers: [{id:'CA',name:'Ahmet Yılmaz İnşaat'},{id:'CF',name:'Firma F İnşaat'},{id:'CG',name:'Gümüş Yapı'},{id:'CH',name:'Çağrı Hafriyat'},{id:'CM',name:'Mehmet Akyüz'},{id:'CL',name:'Leda'},{id:'CO',name:'Öztürk Grup'},{id:'CMH',name:'Mahir Yapı'}],
  sites: [{id:'S1',name:'Kemerburgaz',customer_id:'CF'},{id:'S2',name:'Eyüp',customer_id:'CF'},{id:'S3',name:'Şişli Plaza',customer_id:'CG'},{id:'S4',name:'Bahçeşehir',customer_id:'CA'},{id:'S6',name:'Yeşilpınar',customer_id:'CL'},{id:'S7',name:'Kağıthane',customer_id:'CO'},{id:'S8',name:'Beylikdüzü',customer_id:'CO'}],
  vehicles: [{id:'J',name:'JCB'},{id:'V1',name:'34 ABC 123'},{id:'V2',name:'Kamyon 1'},{id:'V3',name:'34EC1353'},{id:'M',name:'Manitou MTX1840'},{id:'MK',name:'Mini Kato'},{id:'T14',name:'14 tonluk'}],
  personnel: [{id:'P1',name:'Soner Abi'}],
  aliases: [{id:'a1',alias:'Patron C',target_type:'customer',target_id:'CF',active:true},{id:'a2',alias:'Ahmet Bey',target_type:'customer',target_id:'CA',active:true},{id:'a4',alias:'Mahir Bey',target_type:'customer',target_id:'CMH',active:true},{id:'a3',alias:'kemer',target_type:'site',target_id:'S1',active:true}],
  work_records: [], fuel_records: [], dump_sites: [], quarries: [],
});
