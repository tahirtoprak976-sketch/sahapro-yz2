// SAHAPRO Document Engine — local Unicode TrueType PDF, no CDN or external data.
import { downloadBlob, shareOrDownload } from "./ui.js";
import { prepareDocument } from "./pdf-templates.js";
const fontPromises = new Map();
const encoder = new TextEncoder();
const bytes = (s) => encoder.encode(s);
function concat(arr) {
  const r = new Uint8Array(arr.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of arr) {
    r.set(a, o);
    o += a.length;
  }
  return r;
}
async function font(bold = false) {
  const key = bold ? "DejaVuSans-Bold.ttf" : "DejaVuSans.ttf";
  if (!fontPromises.has(key))
    fontPromises.set(key, (async () => {
      const response = await fetch(
        new URL("../vendor/" + key, import.meta.url),
      );
      if (!response.ok) throw Error("Türkçe PDF fontu yüklenemedi");
      const data = new Uint8Array(await response.arrayBuffer()),
        v = new DataView(data.buffer);
      const tables = {};
      for (let i = 0; i < v.getUint16(4); i++) {
        const o = 12 + i * 16;
        tables[String.fromCharCode(...data.slice(o, o + 4))] = v.getUint32(
          o + 8,
        );
      }
      const units = v.getUint16(tables.head + 18),
        nmetrics = v.getUint16(tables.hhea + 34);
      let cmap;
      const base = tables.cmap;
      for (let i = 0; i < v.getUint16(base + 2); i++) {
        const p = base + 4 + i * 8,
          o = base + v.getUint32(p + 4);
        if (v.getUint16(o) === 4 && (v.getUint16(p) === 3 || !cmap)) cmap = o;
      }
      if (!cmap) throw Error("Unicode font tablosu bulunamadı");
      const seg = v.getUint16(cmap + 6) / 2,
        end = cmap + 14,
        start = end + seg * 2 + 2,
        delta = start + seg * 2,
        range = delta + seg * 2;
      function glyph(code) {
        for (let i = 0; i < seg; i++) {
          const en = v.getUint16(end + 2 * i),
            st = v.getUint16(start + 2 * i);
          if (code > en) continue;
          if (code < st) return 0;
          const d = v.getInt16(delta + 2 * i),
            r = v.getUint16(range + 2 * i);
          if (!r) return (code + d) & 65535;
          const pos = range + 2 * i + r + 2 * (code - st);
          if (pos + 2 > data.length) return 0;
          const g = v.getUint16(pos);
          return g ? (g + d) & 65535 : 0;
        }
        return 0;
      }
      const width = (code) =>
        Math.round(
          (v.getUint16(tables.hmtx + 4 * Math.min(glyph(code), nmetrics - 1)) *
            1000) /
            units,
        );
      return { data, glyph, width, name: bold ? "DejaVuSans-Bold" : "DejaVuSans" };
    })().catch((e) => {
      fontPromises.delete(key);
      throw e;
    }));
  return fontPromises.get(key);
}
function clean(s) {
  return String(s ?? "")
    .replace(/[^\u0009\u000a\u000d\u0020-\uffff]/gu, "")
    .replace(/\t/g, " ");
}
function hex(s) {
  return [...s]
    .map((c) => c.charCodeAt(0).toString(16).padStart(4, "0"))
    .join("");
}
function wrap(s, width, size, f) {
  const output = [];
  for (const paragraph of clean(s).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      let trial = line ? line + " " + word : word;
      const measure = (t) =>
        [...t].reduce(
          (n, c) => n + (f.width(c.charCodeAt(0)) * size) / 1000,
          0,
        );
      if (measure(trial) <= width) {
        line = trial;
        continue;
      }
      if (line) output.push(line);
      line = "";
      for (const c of word) {
        if (line && measure(line + c) > width) {
          output.push(line);
          line = "";
        }
        line += c;
      }
    }
    output.push(line);
  }
  return output.length ? output : [""];
}
export async function buildDocument(input) {
  const spec = prepareDocument(input);
  const [f, fb] = await Promise.all([font(), font(true)]);
  const land = spec.orientation === "landscape", W = land ? 841.89 : 595.28,
    H = land ? 595.28 : 841.89, M = 36, bottom = H - 53,
    used = new Set(), pages = [], images = [], contentWidth = W - 2 * M;
  const ink = [0.10,0.17,0.27], muted = [0.38,0.44,0.51], navy = [0.10,0.19,0.31],
    accent = [0.85,0.43,0.12], pale = [0.95,0.96,0.98], edge=[0.82,0.86,0.90];
  let page, y, contentStart, signaturesRendered = false;
  const measure=(s,size=9,bold=false)=>[...clean(s)].reduce((n,c)=>n+(bold?fb:f).width(c.charCodeAt(0))*size/1000,0);
  function text(s, x, top, size = 9, bold = false, color = ink) {
    s = clean(s);
    for (const c of s) used.add(c.charCodeAt(0));
    page.push(`${color.join(' ')} rg BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${(H - top).toFixed(2)} Tm <${hex(s)}> Tj ET`);
  }
  function line(x1, y1, x2, y2, color=edge) {
    page.push(`${color.join(' ')} RG 0.45 w ${x1} ${H-y1} m ${x2} ${H-y2} l S`);
  }
  function rect(x, top, width, height, color) {
    page.push(`${color.join(' ')} rg ${x} ${H-top-height} ${width} ${height} re f`);
  }
  function right(s,x,top,size=9,bold=false,color=ink){text(s,x-measure(s,size,bold),top,size,bold,color);}
  const made = spec.generatedAt ? new Date(spec.generatedAt) : new Date();
  const madeLabel=made.toLocaleString('tr-TR', {timeZone:'Europe/Istanbul',dateStyle:'short',timeStyle:'short'});
  let logo;
  async function imageData(blob){
    const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');
    canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0);bitmap.close();
    const jpg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.92));
    if(!jpg)throw Error('Belge görüntüsü hazırlanamadı');
    const result={name:'Im'+images.length,data:new Uint8Array(await jpg.arrayBuffer()),width:canvas.width,height:canvas.height};images.push(result);return result;
  }
  function placeImage(img,x,top,width,height){page.push(`q ${width} 0 0 ${height} ${x} ${H-top-height} cm /${img.name} Do Q`);}
  if(spec.logo)logo=await imageData(spec.logo);
  function newPage() {
    page=[];pages.push(page);
    const first=pages.length===1;
    if(first){
      rect(M,26,31,31,navy);
      if(logo)placeImage(logo,M,26,31,31);else text('MH',M+4,47,13,true,[1,1,1]);
      text('MURATOĞLU HAFRİYAT',M+43,39,14,true,navy);
      text('Hafriyat · Nakliye · İş Makinesi',M+43,54,8,false,muted);
      const badge=spec.profile.category;right(badge,W-M,38,8,true,muted);
      right(spec.audience==='internal'?'İÇ KULLANIM':'MÜŞTERİ NÜSHASI',W-M,53,7,false,muted);
      y=83;
      for(const t of wrap(spec.title || 'Belge',contentWidth,19,fb)) {text(t,M,y,19,true,navy);y+=23;}
      text(spec.profile.subtitle,M,y-3,8,false,muted);y+=land?9:16;
    }else{
      text('MURATOĞLU HAFRİYAT',M,34,11,true,navy);right(spec.profile.category,W-M,34,8,true,muted);y=52;
      for(const t of wrap(spec.title || 'Belge',contentWidth,10,fb)){text(t,M,y,10,true,navy);y+=14;}
    }
    // Existing human-readable document number only; do not fabricate an approval or reference.
    const meta=spec.number ? 'Belge No: '+spec.number : 'Belge Türü: '+spec.profile.category;
    const leftWidth=contentWidth*0.58,rightWidth=contentWidth*0.40;
    const l=wrap(meta,leftWidth,7.5,f),r=wrap('Oluşturma: '+madeLabel,rightWidth,7.5,f);
    for(let i=0;i<Math.max(l.length,r.length);i++){
      if(l[i])text(l[i],M,y+11+i*11,7.5,false,muted);
      if(r[i])right(r[i],W-M,y+11+i*11,7.5,false,muted);
    }
    y+=Math.max(l.length,r.length)*11+16;
    rect(M,y-5,contentWidth,2,accent);y+=12;contentStart=y;
    if(contentStart>bottom-75)throw Error('Belge başlığı sayfaya sığmıyor; başlığı kısaltın');
  }
  newPage();
  function ensure(height){if(y+height>bottom)newPage();}
  function paragraph(value,size=9,color=ink,bold=false,x=M,width=contentWidth){
    for(const row of wrap(value,width,size,bold?fb:f)){
      ensure(size+5);text(row,x,y+size,size,bold,color);y+=size+5;
    }
    y+=6;
  }
  function heading(title,minFollowing=22){
    const rows=wrap(title,contentWidth-14,10,fb),height=rows.length*14+10;
    ensure(height+minFollowing);rect(M,y+1,3,height-4,accent);
    rows.forEach((s,i)=>text(s,M+11,y+11+i*14,10,true,navy));y+=height;
  }
  function pairsBlock(pairs,layout='identity'){
    pairs=pairs.filter(([,v])=>v!==null&&v!==undefined&&v!=='');
    if(layout==='totals'){
      const boxWidth=Math.min(325,contentWidth),x=W-M-boxWidth;
      const blockTop=y;
      if(land && spec.signatureLayout==='besideTotals' && spec.signatures?.length){
        const area=contentWidth-boxWidth-24,gap=20,slot=(area-gap*(spec.signatures.length-1))/spec.signatures.length;
        spec.signatures.forEach((s,i)=>{const xx=M+i*(slot+gap),label=typeof s==='string'?s:s.label;
          wrap(label,slot,9,fb).forEach((v,k)=>text(v,xx,blockTop+18+k*12,9,true));
          text('Ad Soyad / İmza',xx,blockTop+54,7.5,false,muted);line(xx,blockTop+75,xx+slot,blockTop+75);
        });signaturesRendered=true;
      }
      for(let i=0;i<pairs.length;i++){
        const [label,value]=pairs[i],last=i===pairs.length-1;
        const a=wrap(label,boxWidth*0.43-16,9,last?fb:f),b=wrap(value,boxWidth*0.57-16,last?11:9,last?fb:f);
        const h=Math.max(a.length,b.length)*14+16;ensure(h);
        rect(x,y,boxWidth,h,last?navy:pale);const c=last?[1,1,1]:ink;
        a.forEach((s,k)=>text(s,x+10,y+12+k*14,9,last,c));
        b.forEach((s,k)=>right(s,x+boxWidth-10,y+12+k*14,last?11:9,last,c));y+=h;
      }y+=13;return;
    }
    const gap=18,col=(contentWidth-gap)/2;
    for(let i=0;i<pairs.length;){
      const pair=pairs[i];
      const full=layout==='clauses'||clean(pair[1]).length>180||/açıklama|not$|kapsam|şart|sorumluluk|fesih|adres/i.test(pair[0]);
      if(full){
        heading(pair[0],18);paragraph(pair[1]);i++;continue;
      }
      const row=[pair];i++;
      if(i<pairs.length&&clean(pairs[i][1]).length<=180&&!/açıklama|not$|kapsam|şart|sorumluluk|fesih|adres/i.test(pairs[i][0]))row.push(pairs[i++]);
      const cells=row.map(([l,v])=>({label:wrap(l,col,7.5,f),value:wrap(v,col,9.3,fb)}));
      const max=Math.max(...cells.map(c=>c.label.length*10+c.value.length*13))+(land?10:15);
      if(max>bottom-contentStart-10){for(const [l,v]of row){heading(l);paragraph(v);}continue;}
      ensure(max);
      cells.forEach((cell,j)=>{const x=M+j*(col+gap);cell.label.forEach((s,k)=>text(s,x,y+8+k*10,7.5,false,muted));const baseline=y+cell.label.length*10+11;cell.value.forEach((s,k)=>text(s,x,baseline+k*13,9.3,true));line(x,y+max-4,x+col,y+max-4);});y+=max;
    }y+=9;
  }
  for(const section of spec.sections){
    // Yan yana imza kutuları: [{label, image (Blob|null), name, at}] — imza yoksa boş kutu (ıslak imza için)
    if(section.signs?.length){
      const n=section.signs.length,gap=20,w=(contentWidth-gap*(n-1))/n,boxH=78,h=boxH+58;
      ensure(h+(section.title?30:0));if(section.title)heading(section.title,h);
      for(let i=0;i<n;i++){
        const s0=section.signs[i],x=M+i*(w+gap);
        text(s0.label,x,y+10,9,true);
        page.push(`${edge.join(' ')} RG 0.6 w ${x} ${H-(y+16+boxH)} ${w} ${boxH} re S`);
        if(s0.image){const img=await imageData(s0.image);const sc=Math.min((w-16)/img.width,(boxH-12)/img.height);const iw=img.width*sc,ih=img.height*sc;placeImage(img,x+(w-iw)/2,y+16+(boxH-ih)/2,iw,ih);}
        else text('İmza',x+6,y+30,7.5,false,muted);
        const nm=wrap(s0.name||'Ad Soyad: ..............................',w,8.5,fb);nm.slice(0,2).forEach((v,k)=>text(v,x,y+16+boxH+13+k*11,8.5,!!s0.name,s0.name?ink:muted));
        text(s0.at||'Tarih: ....../....../..........',x,y+16+boxH+13+Math.min(nm.length,2)*11+2,7.5,false,muted);
      }
      y+=h+8;signaturesRendered=true;continue;
    }
    if(section.image){
      const img=await imageData(section.image),iw=Math.min(section.image_width||190,contentWidth,(section.max_h||100)*img.width/img.height),ih=iw*img.height/img.width;
      ensure(ih+50);if(section.title)heading(section.title,ih+12);
      if(section.text)paragraph(section.text,8,muted);
      ensure(ih+12);placeImage(img,M,y,iw,ih);y+=ih+15;
      continue;
    }
    if(section.headers){
      const n=section.headers.length;if(!n)continue;
      const rows=section.rows || [],size=n>9?7.2:n>7?7.6:8.2,leading=size+3.7;
      let ratios=section.widths?.length===n?section.widths:null;
      if(!ratios)ratios=section.headers.map((h,i)=>{
        const samples=rows.slice(0,100).map(r=>Math.min(measure(r[i],size),145));
        const numeric=/miktar|fiyat|tutar|kdv|net|brüt|bakiye|borç|alacak|ödenen|kalan|litre|toplam/i.test(h);
        return Math.max(numeric?48:35,Math.min(numeric?115:160,Math.max(measure(h,size,true),...samples)+13));
      });
      if(ratios.some(r=>!Number.isFinite(r)||r<=0))throw Error('Geçersiz PDF kolon genişliği');
      const total=ratios.reduce((a,b)=>a+b,0),widths=ratios.map(r=>contentWidth*r/total);
      const numeric=section.headers.map((h,i)=>section.align?.[i]==='right'||(/miktar|fiyat|tutar|kdv|net|brüt|bakiye|borç|alacak|ödenen|kalan|litre|toplam/i.test(h)&&!/^iş|açıklama/i.test(h)));
      const headerLines=section.headers.map((s,i)=>wrap(s,widths[i]-12,size,fb)),headerHeight=Math.max(...headerLines.map(a=>a.length))*leading+12;
      const header=(continuation=false)=>{
        if(section.title)heading(section.title+(continuation?' · devam':''),headerHeight+22);
        ensure(headerHeight+22);rect(M,y,contentWidth,headerHeight,navy);
        let x=M;headerLines.forEach((ls,i)=>{ls.forEach((s,k)=>numeric[i]?right(s,x+widths[i]-6,y+11+k*leading,size,true,[1,1,1]):text(s,x+6,y+11+k*leading,size,true,[1,1,1]));x+=widths[i];});y+=headerHeight;
      };
      const firstRows=rows.length?Math.max(...section.headers.map((_,i)=>wrap(rows[0][i],widths[i]-12,size,f).length))*leading+10:25;
      ensure(headerHeight+Math.min(firstRows,80)+35);header();
      if(!rows.length){paragraph('Bu filtrelerde kayıt bulunmuyor.',8.5,muted);y+=5;}
      for(let index=0;index<rows.length;index++){
        const cells=section.headers.map((_,i)=>wrap(rows[index][i]??'',widths[i]-12,size,f));
        const count=Math.max(...cells.map(c=>c.length)),height=count*leading+10;
        if(y+height>bottom&&height<bottom-contentStart-headerHeight-35){newPage();header(true);}
        let offset=0;
        while(offset<count){
          if(y+leading+10>bottom){newPage();header(true);}
          const fit=Math.min(count-offset,Math.floor((bottom-y-10)/leading));
          if(fit<1){newPage();header(true);continue;}
          const h=fit*leading+10;if(index%2===0)rect(M,y,contentWidth,h,pale);
          let x=M;cells.forEach((ls,i)=>{for(let k=0;k<fit;k++)if(ls[offset+k]){numeric[i]?right(ls[offset+k],x+widths[i]-6,y+size+5+k*leading,size):text(ls[offset+k],x+6,y+size+5+k*leading,size);}x+=widths[i];});
          y+=h;line(M,y,W-M,y);offset+=fit;
        }
      }
      y+=14;continue;
    }
    if(section.layout==='totals' && section.pairs){
      const bw=Math.min(325,contentWidth);
      const height=section.pairs.filter(([,v])=>v!==null&&v!==undefined&&v!=='').reduce((h,[l,v],i,ps)=>h+Math.max(wrap(l,bw*.43-16,9,i===ps.length-1?fb:f).length,wrap(v,bw*.57-16,i===ps.length-1?11:9,i===ps.length-1?fb:f).length)*14+16,0);
      ensure(height+(section.title?30:0));
    }
    if(section.title)heading(section.title,section.layout==='totals'?40:24);
    if(section.pairs)pairsBlock(section.pairs,section.layout);
    if(section.text)paragraph(section.text,section.layout==='notice'?8.5:9,section.layout==='notice'?muted:ink);
  }
  if(spec.signatures?.length && !signaturesRendered){
    const slots=spec.signatures.map(s=>typeof s==='string'?s:s.label),gap=20,width=(contentWidth-gap*(slots.length-1))/slots.length;
    const lines=slots.map(s=>wrap(s,width,9,fb)),h=Math.max(...lines.map(a=>a.length))*12+(land?34:65);ensure(h);
    slots.forEach((_,i)=>{const x=M+i*(width+gap);lines[i].forEach((s,k)=>text(s,x,y+12+k*12,9,true));text('Ad Soyad / İmza',x,y+h-27,7.5,false,muted);line(x,y+h-14,x+width,y+h-14);});y+=h;
  }
  for(let i=0;i<pages.length;i++){
    page=pages[i];line(M,H-40,W-M,H-40);
    text(spec.sample?'Örnek Belge · Gerçek işletme kaydı değildir':spec.audience==='internal'?'İç Kullanım · Muratoğlu Hafriyat':'Muratoğlu Hafriyat',M,H-26,7,false,muted);
    right(`SAHAPRO YZ2 · Sayfa ${i+1} / ${pages.length}`,W-M,H-26,7,false,muted);
  }
  const objs = [];
  const add = (body) => {
    objs.push(typeof body === "string" ? bytes(body) : body);
    return objs.length;
  };
  const stream = (data, extra = "") =>
    concat([
      bytes(`<< /Length ${data.length} ${extra} >>\nstream\n`),
      data,
      bytes("\nendstream"),
    ]);
  const catalog = add(""), tree = add("");
  const sorted=[...used].sort((a,b)=>a-b);
  let cmap="/CIDInit /ProcSet findresource begin\n12 dict begin begincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /SAHAPROUnicode def /CMapType 2 def\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n";
  for(let i=0;i<sorted.length;i+=100){const block=sorted.slice(i,i+100);cmap+=block.length+" beginbfchar\n"+block.map(c=>`<${c.toString(16).padStart(4,'0')}> <${c.toString(16).padStart(4,'0')}>`).join('\n')+"\nendbfchar\n";}
  cmap+="endcmap CMapName currentdict /CMap defineresource pop end end";
  const unicode=add(stream(bytes(cmap)));
  function embedFont(ff){
    const fontFile=add(stream(ff.data,`/Length1 ${ff.data.length}`));
    const descriptor=add(`<< /Type /FontDescriptor /FontName /${ff.name} /Flags 32 /FontBBox [-1100 -500 2100 1600] /ItalicAngle 0 /Ascent 928 /Descent -236 /CapHeight 729 /StemV 80 /FontFile2 ${fontFile} 0 R >>`);
    const cidMap=new Uint8Array(131072);for(const c of used){const g=ff.glyph(c);cidMap[c*2]=g>>8;cidMap[c*2+1]=g&255;}
    const mapping=add(stream(cidMap));
    const cidFont=add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${ff.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW 600 /W [${sorted.map(c=>c+' ['+ff.width(c)+']').join(' ')}] /CIDToGIDMap ${mapping} 0 R >>`);
    return add(`<< /Type /Font /Subtype /Type0 /BaseFont /${ff.name} /Encoding /Identity-H /DescendantFonts [${cidFont} 0 R] /ToUnicode ${unicode} 0 R >>`);
  }
  const type0=embedFont(f),typeBold=embedFont(fb),kids=[];
  const imageRefs = images.map((i) => ({
    ...i,
    ref: add(
      stream(
        i.data,
        `/Type /XObject /Subtype /Image /Width ${i.width} /Height ${i.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
      ),
    ),
  }));
  for (const commands of pages) {
    const content = add(stream(bytes(commands.join("\n"))));
    kids.push(
      add(
        `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${type0} 0 R /F2 ${typeBold} 0 R >> /XObject << ${imageRefs.map((i) => `/${i.name} ${i.ref} 0 R`).join(" ")} >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objs[catalog - 1] = bytes(`<< /Type /Catalog /Pages ${tree} 0 R >>`);
  objs[tree - 1] = bytes(
    `<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`,
  );
  const chunks = [bytes("%PDF-1.7\n")],
    offsets = [0];
  let offset = chunks[0].length;
  for (let i = 0; i < objs.length; i++) {
    offsets.push(offset);
    const chunk = concat([
      bytes(`${i + 1} 0 obj\n`),
      objs[i],
      bytes("\nendobj\n"),
    ]);
    chunks.push(chunk);
    offset += chunk.length;
  }
  chunks.push(
    bytes(
      `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
        .join(
          "",
        )}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF`,
    ),
  );
  return new Blob(chunks, { type: "application/pdf" });
}
export async function exportDocument(spec, mode = "download") {
  const printWindow = mode === "print" ? window.open("", "_blank") : null;
  if (mode === "print" && !printWindow)
    throw Error("Yazdırma penceresine izin verin");
  try {
    const blob = await buildDocument(spec),
      name = spec.filename || "SAHAPRO_Belge.pdf";
    if (mode === "share") await shareOrDownload(blob, name, spec.title);
    else if (mode === "print") {
      const url = URL.createObjectURL(blob);
      printWindow.location.href = url;
      printWindow.addEventListener("load", () => {
        try {
          printWindow.focus();
          printWindow.print();
        } catch (e) {
          /* PDF viewer print toolbar remains available */
        }
      });
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } else downloadBlob(blob, name);
    return blob;
  } catch (error) {
    printWindow?.close();
    throw error;
  }
}
