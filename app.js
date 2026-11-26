// ConvertLab — client-side converter
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const { jsPDF } = window.jspdf;

// Register PT Sans (Cyrillic) as a web font via @font-face so html2canvas
// can render Cyrillic text with the embedded base64 TTFs from fonts.js.
function injectPtSansFontFace(){
  const fam = window.__pdfFonts && window.__pdfFonts.PTSans;
  if(!fam || document.getElementById('ptsans-fontface')) return;
  const css = '@font-face{font-family:"PT Sans";font-style:normal;font-weight:400;src:url(data:font/ttf;base64,' + fam.normal + ') format("truetype");}'
    + '@font-face{font-family:"PT Sans";font-style:normal;font-weight:700;src:url(data:font/ttf;base64,' + fam.bold + ') format("truetype");}'
    + '@font-face{font-family:"PT Sans";font-style:italic;font-weight:400;src:url(data:font/ttf;base64,' + fam.italic + ') format("truetype");}'
    + '@font-face{font-family:"PT Sans";font-style:italic;font-weight:700;src:url(data:font/ttf;base64,' + fam.bolditalic + ') format("truetype");}';
  const el=document.createElement('style');
  el.id='ptsans-fontface';
  el.textContent=css;
  document.head.appendChild(el);
}
injectPtSansFontFace();

let currentFile = null;
let fromFmt = 'auto';
let toFmt = 'jpg';
let mode = 'single';
let history = [];

const $ = id => document.getElementById(id);
const dropZone = $('dropZone'), fileInput = $('fileInput'), browseBtn = $('browseBtn');
const fileInfo = $('fileInfo'), fileName = $('fileName'), fileSize = $('fileSize'), fileIco = $('fileIco');
const convertBtn = $('convertBtn'), resultBox = $('resultBox'), downloadBtn = $('downloadBtn');
const resultFile = $('resultFile'), resultPreview = $('resultPreview'), errorBox = $('errorBox');
const progressWrap = $('progressWrap'), progressFill = $('progressFill'), progressText = $('progressText');

function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2800); }
function showError(msg){ errorBox.textContent='⚠️ '+msg; errorBox.hidden=false; }
function hideError(){ errorBox.hidden=true; }
function setProgress(pct, text){ progressWrap.hidden=false; progressFill.style.width=pct+'%'; progressText.textContent=text||''; }
function fmtSize(b){ if(b<1024) return b+' Б'; if(b<1048576) return (b/1024).toFixed(1)+' КБ'; return (b/1048576).toFixed(2)+' МБ'; }
function extOf(name){ return (name.split('.').pop()||'').toLowerCase(); }
function baseOf(name){ return name.replace(/\.[^.]+$/,''); }
function iconFor(ext){
  const m={pdf:'📕',docx:'📘',doc:'📘',xlsx:'📗',xls:'📗',pptx:'📙',ppt:'📙',jpg:'🖼️',jpeg:'🖼️',png:'🎨',webp:'🌐',txt:'📝',html:'🌐',htm:'🌐',csv:'📊',json:'🧾',md:'📄',rtf:'📑',odt:'📚',zip:'🗂️',epub:'🔤'};
  return m[ext]||'📄';
}
function detectFmt(file){
  const e = extOf(file.name);
  if(['pdf','docx','doc','xlsx','xls','pptx','ppt','jpg','jpeg','png','webp','txt','html','htm','csv','json','md','rtf','odt'].includes(e)) return e==='jpeg'?'jpg':e;
  if(file.type==='application/pdf') return 'pdf';
  if(file.type.startsWith('image/')) return file.type.split('/')[1]==='jpeg'?'jpg':file.type.split('/')[1];
  return e||'txt';
}

// --- UI wiring ---
browseBtn.onclick = e=>{ e.stopPropagation(); fileInput.click(); };
dropZone.onclick = ()=> fileInput.click();
fileInput.onchange = ()=>{ if(fileInput.files[0]) setFile(fileInput.files[0]); };
['dragover','dragenter'].forEach(ev=>dropZone.addEventListener(ev,e=>{e.preventDefault();dropZone.classList.add('drag');}));
['dragleave','drop'].forEach(ev=>dropZone.addEventListener(ev,e=>{e.preventDefault();dropZone.classList.remove('drag');}));
dropZone.addEventListener('drop',e=>{ const f=e.dataTransfer.files[0]; if(f) setFile(f); });
$('clearFile').onclick = e=>{ e.stopPropagation(); clearFile(); };
$('quality').oninput = e=> $('qVal').textContent=e.target.value+'%';

function setFile(file){
  currentFile=file; hideError(); resultBox.hidden=true;
  fileInfo.hidden=false; fileName.textContent=file.name; fileSize.textContent=fmtSize(file.size)+' • '+detectFmt(file).toUpperCase();
  fileIco.textContent=iconFor(extOf(file.name));
  progressWrap.hidden=true;
  convertBtn.disabled=false;
  // auto-suggest target
  const d=detectFmt(file);
  if(d==='pdf') selectTo('jpg');
  else if(d==='docx') selectTo('pdf');
  else if(d==='jpg'||d==='png'||d==='webp') selectTo('pdf');
  else if(d==='xlsx'||d==='csv') selectTo('pdf');
  else if(d==='txt') selectTo('pdf');
  toast('Файл выбран: '+file.name);
}
function clearFile(){ currentFile=null; fileInfo.hidden=true; convertBtn.disabled=true; fileInput.value=''; resultBox.hidden=true; }

function bindSelect(id, cb){
  const el=$(id);
  el.querySelectorAll('.fmt-btn').forEach(b=>b.onclick=()=>{
    el.querySelectorAll('.fmt-btn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); cb(b.dataset.fmt);
  });
}
bindSelect('fromSelect', v=> fromFmt=v);
bindSelect('toSelect', v=> toFmt=v);
function selectTo(fmt){
  toFmt=fmt;
  $('toSelect').querySelectorAll('.fmt-btn').forEach(b=>b.classList.toggle('active', b.dataset.fmt===fmt));
}
$('swapBtn').onclick=()=>{
  const cur=toFmt; selectTo(fromFmt==='auto'?'pdf':fromFmt);
  $('fromSelect').querySelectorAll('.fmt-btn').forEach(b=>b.classList.toggle('active', b.dataset.fmt===cur));
  fromFmt=cur; toast('Форматы поменяны');
};
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  t.classList.add('active'); mode=t.dataset.mode;
  fileInput.multiple = (mode==='batch');
  toast(mode==='batch'?'Пакетный режим: можно выбрать несколько файлов':'Одиночный режим');
});
document.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>{
  const [f,t]=b.dataset.quick.split(':');
  $('fromSelect').querySelectorAll('.fmt-btn').forEach(x=>x.classList.toggle('active', x.dataset.fmt===f));
  fromFmt=f; selectTo(t);
  document.getElementById('converter').scrollIntoView({behavior:'smooth'});
  toast(b.textContent.trim()+' — теперь загрузите файл');
});
$('convertAnother').onclick=()=>{ resultBox.hidden=true; clearFile(); };

// --- helpers ---
async function fileToArrayBuffer(f){ return await f.arrayBuffer(); }
async function fileToText(f){ return await f.text(); }
function blobToDataURL(blob){ return new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(blob); }); }
function canvasToBlob(canvas, type, q){ return new Promise(res=>canvas.toBlob(res,type,q)); }
function downloadBlob(blob, filename){
  const url=URL.createObjectURL(blob);
  downloadBtn.href=url; downloadBtn.download=filename;
  // auto click for convenience
  const a=document.createElement('a'); a.href=url; a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
}
function addHistory(name, from, to, size){
  history.unshift({name, from, to, size, time:new Date().toLocaleTimeString('ru-RU')});
  if(history.length>10) history.pop();
  $('historyWrap').hidden=false;
  $('historyList').innerHTML = history.map(h=>`<div class="hist-item"><span>${iconFor(extOf(h.name))} <b>${h.name}</b> — ${h.from.toUpperCase()} → ${h.to.toUpperCase()}</span><span>${fmtSize(h.size)} • ${h.time}</span></div>`).join('');
}

// --- converters ---
async function pdfToImages(arrayBuffer, imgFmt){
  const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
  const pages = $('multiPage').checked ? pdf.numPages : 1;
  const blobs=[];
  for(let i=1;i<=pages;i++){
    setProgress(Math.round(i/pages*90), `Страница ${i} из ${pages}…`);
    const page = await pdf.getPage(i);
    const vp = page.getViewport({scale:2});
    const canvas=document.createElement('canvas'); canvas.width=vp.width; canvas.height=vp.height;
    await page.render({canvasContext: canvas.getContext('2d'), viewport: vp}).promise;
    const mime = imgFmt==='png'?'image/png': imgFmt==='webp'?'image/webp':'image/jpeg';
    blobs.push(await canvasToBlob(canvas, mime, $('quality').value/100));
  }
  return blobs;
}
async function pdfToText(arrayBuffer){
  const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
  let out='';
  for(let i=1;i<=pdf.numPages;i++){
    setProgress(Math.round(i/pdf.numPages*80), `Читаю страницу ${i}…`);
    const page=await pdf.getPage(i);
    const tc=await page.getTextContent();
    out += tc.items.map(it=>it.str).join(' ')+'\n\n';
  }
  return out.trim();
}
async function imageToPdf(blob){
  const dataUrl = await blobToDataURL(blob);
  const img = new Image(); await new Promise((res,rej)=>{img.onload=res; img.onerror=rej; img.src=dataUrl;});
  const doc = new jsPDF({orientation: img.width>img.height?'landscape':'portrait', unit:'px', format:[img.width, img.height], hotfix:'px_scaling'});
  doc.addImage(dataUrl, 'JPEG', 0, 0, img.width, img.height);
  return doc.output('blob');
}
async function imageToImage(blob, targetFmt){
  const dataUrl = await blobToDataURL(blob);
  const img = new Image(); await new Promise((res,rej)=>{img.onload=res; img.onerror=rej; img.src=dataUrl;});
  const canvas=document.createElement('canvas'); canvas.width=img.width; canvas.height=img.height;
  const ctx=canvas.getContext('2d');
  if(targetFmt==='jpg'){ ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); }
  ctx.drawImage(img,0,0);
  const mime = targetFmt==='png'?'image/png': targetFmt==='webp'?'image/webp':'image/jpeg';
  return await canvasToBlob(canvas, mime, $('quality').value/100);
}
async function htmlToPdf(html){
  const box=$('hiddenRender');
  box.style.cssText='position:absolute;left:-9999px;top:0;width:800px;background:#fff;padding:36px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;line-height:1.5;box-sizing:border-box';
  box.innerHTML=html;
  await new Promise(r=>setTimeout(r,60));
  const canvas=await html2canvas(box,{scale:2, useCORS:true, backgroundColor:'#ffffff', windowWidth:800});
  const { jsPDF } = window.jspdf;
  const pdf=new jsPDF({unit:'pt', format:'a4'});
  const pageW=pdf.internal.pageSize.getWidth(), pageH=pdf.internal.pageSize.getHeight();
  const cw=canvas.width;                       // ширина canvas в пикселях
  const pageHpx=cw*pageH/pageW;                // высота страницы в пикселях canvas (с сохранением пропорций)
  let y=0;
  while(y<canvas.height){
    const sliceH=Math.min(pageHpx, canvas.height-y);
    const slice=document.createElement('canvas');
    slice.width=cw;
    slice.height=sliceH;
    const ctx=slice.getContext('2d');
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,cw,sliceH);
    ctx.drawImage(canvas,0,y,cw,sliceH,0,0,cw,sliceH);
    const imgData=slice.toDataURL('image/jpeg',0.92);
    pdf.addImage(imgData,'JPEG',0,0,pageW,sliceH*pageW/cw);
    y+=pageHpx;
  }
  return pdf.output('blob');
}
async function textToPdf(text){
  const doc=new jsPDF({unit:'pt', format:'a4'});
  const lines=doc.splitTextToSize(text, 500);
  doc.setFont('helvetica','normal'); doc.setFontSize(11);
  let y=40;
  for(const line of lines){
    if(y>800){ doc.addPage(); y=40; }
    doc.text(line, 40, y); y+=14;
  }
  return doc.output('blob');
}
async function textToDocx(text){
  const { Document, Packer, Paragraph, TextRun } = window.docx;
  const doc=new Document({sections:[{children: text.split('\n').map(l=>new Paragraph({children:[new TextRun(l||' ')]}))}]});
  return await Packer.toBlob(doc);
}
// Parse word/styles.xml -> map of styleId -> {align, spacing, line, ind, sz, b, i}
// and default run properties.
function parseStyles(stylesXml){
  const dom=new DOMParser().parseFromString(stylesXml,'application/xml');
  const NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const byNS=(p,n)=>Array.from(p.getElementsByTagNameNS(NS,n));
  const firstNS=(p,n)=>byNS(p,n)[0]||null;
  const attrNS=(el,n)=>el.getAttributeNS(NS,n);
  const styles={};
  let defaultR={sz:null,b:false,i:false};
  // docDefaults
  const dd=firstNS(dom,'docDefaults');
  if(dd){
    const rPr=firstNS(dd,'rPr');
    if(rPr){
      if(byNS(rPr,'sz').length){ const sz=firstNS(rPr,'sz'); if(sz) defaultR.sz=parseInt(attrNS(sz,'val'),10)/2; }
      if(byNS(rPr,'b').length) defaultR.b=true;
      if(byNS(rPr,'i').length) defaultR.i=true;
    }
  }
  for(const st of byNS(dom,'style')){
    const id=attrNS(st,'styleId');
    if(!id) continue;
    const o={align:null, spacingBefore:0, spacingAfter:0, line:null, lineRule:'auto',
      indLeft:0, indFirstLine:0, sz:null, b:false, i:false};
    const pPr=firstNS(st,'pPr');
    if(pPr){
      const jc=firstNS(pPr,'jc'); if(jc) o.align=attrNS(jc,'val');
      const sp=firstNS(pPr,'spacing');
      if(sp){
        if(sp.hasAttributeNS(NS,'before')) o.spacingBefore=parseInt(attrNS(sp,'before'),10);
        if(sp.hasAttributeNS(NS,'after')) o.spacingAfter=parseInt(attrNS(sp,'after'),10);
        if(sp.hasAttributeNS(NS,'line')) o.line=parseInt(attrNS(sp,'line'),10);
        if(sp.hasAttributeNS(NS,'lineRule')) o.lineRule=attrNS(sp,'lineRule');
      }
      const ind=firstNS(pPr,'ind');
      if(ind){
        if(ind.hasAttributeNS(NS,'left')) o.indLeft=parseInt(attrNS(ind,'left'),10);
        if(ind.hasAttributeNS(NS,'firstLine')) o.indFirstLine=parseInt(attrNS(ind,'firstLine'),10);
      }
    }
    const rPr=firstNS(st,'rPr');
    if(rPr){
      if(byNS(rPr,'sz').length){ const sz=firstNS(rPr,'sz'); if(sz) o.sz=parseInt(attrNS(sz,'val'),10)/2; }
      if(byNS(rPr,'b').length) o.b=true;
      if(byNS(rPr,'i').length) o.i=true;
    }
    styles[id]=o;
  }
  return {styles, defaultR};
}

// Parse word/numbering.xml -> abstractNum (level definitions) + num (id->abstractNumId).
function parseNumbering(numberingXml){
  const dom=new DOMParser().parseFromString(numberingXml,'application/xml');
  const NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const byNS=(p,n)=>Array.from(p.getElementsByTagNameNS(NS,n));
  const attrNS=(el,n)=>el.getAttributeNS(NS,n);
  const abstracts={};
  const numToAbs={};
  for(const an of byNS(dom,'abstractNum')){
    const id=attrNS(an,'abstractNumId');
    const lvls={};
    for(const lvl of byNS(an,'lvl')){
      const ilvl=attrNS(lvl,'ilvl');
      const fmt=firstChildText(lvl,NS,'numFmt');
      const txt=firstChildText(lvl,NS,'lvlText');
      const start=firstChildAttr(lvl,NS,'start');
      lvls[ilvl]={fmt, txt, start:start?parseInt(start,10):1};
    }
    abstracts[id]=lvls;
  }
  for(const num of byNS(dom,'num')){
    const id=attrNS(num,'numId');
    const abs=firstChildAttr(num,NS,'abstractNumId');
    if(id && abs) numToAbs[id]=abs;
  }
  return {abstracts, numToAbs};
  function firstChildText(parent,ns,name){
    const el=Array.from(parent.getElementsByTagNameNS(ns,name))[0];
    return el?el.textContent:null;
  }
  function firstChildAttr(parent,ns,name){
    const el=Array.from(parent.getElementsByTagNameNS(ns,name))[0];
    return el?el.getAttributeNS(ns,name):null;
  }
}

// Parse DOCX (Office Open XML) directly to HTML, preserving alignment,
// bold/italic, font sizes, line spacing, list numbering, tab stops and page
// size. Full layout control (mammoth drops paragraph alignment + numbering).
async function docxToHtml(arrayBuffer){
  const zip=await JSZip.loadAsync(arrayBuffer);
  const docXml=await zip.file('word/document.xml').async('string');
  const dom=new DOMParser().parseFromString(docXml,'application/xml');
  // Load styles + numbering: they carry paragraph alignment, font sizes,
  // list numbering and tab stops that inline w:jc alone cannot express.
  let stylesMap={styles:{}, defaultR:{sz:null,b:false,i:false}};
  let numbering={abstracts:{}, numToAbs:{}};
  try{ const sx=await zip.file('word/styles.xml').async('string'); stylesMap=parseStyles(sx); }catch(e){}
  try{ const nx=await zip.file('word/numbering.xml').async('string'); numbering=parseNumbering(nx); }catch(e){}
  const NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  // namespace-aware helpers (Clark notation {ns}tag is NOT supported by getElementsByTagName in browsers)
  const byNS=(parent,name)=>Array.from(parent.getElementsByTagNameNS(NS,name));
  const firstNS=(parent,name)=>byNS(parent,name)[0]||null;
  const attrNS=(el,name)=>el.getAttributeNS(NS,name);

  // --- page size & margins (from sectPr) ---
  let pageW=11906, pageH=16838, marginTop=1440, marginRight=1440, marginBottom=1440, marginLeft=1440;
  const sectPr=firstNS(dom,'sectPr');
  if(sectPr){
    const pgSz=firstNS(sectPr,'pgSz');
    if(pgSz){ pageW=parseInt(attrNS(pgSz,'w')||'11906',10); pageH=parseInt(attrNS(pgSz,'h')||'16838',10); }
    const pgMar=firstNS(sectPr,'pgMar');
    if(pgMar){
      marginTop=parseInt(attrNS(pgMar,'top')||'1440',10);
      marginRight=parseInt(attrNS(pgMar,'right')||'1440',10);
      marginBottom=parseInt(attrNS(pgMar,'bottom')||'1440',10);
      marginLeft=parseInt(attrNS(pgMar,'left')||'1440',10);
    }
  }
  // twips -> px (1 twip = 1/1440 inch, 1px = 1/96 inch) => px = twips * 96/1440
  const twipToPx = t => Math.round(t * 96 / 1440);
  const pageWPx=twipToPx(pageW), pageHPx=twipToPx(pageH);
  const mt=twipToPx(marginTop), mr=twipToPx(marginRight), mb=twipToPx(marginBottom), ml=twipToPx(marginLeft);

  // --- paragraph properties (merge paragraph style + direct properties) ---
  function readParaProps(pEl){
    const pPr=firstNS(pEl,'pPr');
    // base from paragraph style (pStyle) if present
    let o={align:null, spacingBefore:0, spacingAfter:0, line:null, lineRule:'auto', indLeft:0, indFirstLine:0};
    const pStyle=pPr?firstNS(pPr,'pStyle'):null;
    if(pStyle){
      const sid=attrNS(pStyle,'val');
      const st=stylesMap.styles[sid];
      if(st){
        if(st.align) o.align=st.align;
        o.spacingBefore=st.spacingBefore; o.spacingAfter=st.spacingAfter;
        o.line=st.line; o.lineRule=st.lineRule||'auto';
        o.indLeft=st.indLeft; o.indFirstLine=st.indFirstLine;
      }
    }
    if(!pPr) return o;
    // alignment: w:jc w:val — Word uses string values ("left","center","right","both")
    // but some producers emit numeric ("0","1","2","3"). Handle both.
    const jc=firstNS(pPr,'jc');
    if(jc){
      const v=attrNS(jc,'val');
      if(v==='center'||v==='1') o.align='center';
      else if(v==='right'||v==='2') o.align='right';
      else if(v==='both'||v==='3'||v==='justify') o.align='justify';
      else o.align='left';
    }
    // spacing (overrides style)
    const sp=firstNS(pPr,'spacing');
    if(sp){
      if(sp.hasAttributeNS(NS,'before')) o.spacingBefore=parseInt(attrNS(sp,'before'),10);
      if(sp.hasAttributeNS(NS,'after')) o.spacingAfter=parseInt(attrNS(sp,'after'),10);
      if(sp.hasAttributeNS(NS,'line')) o.line=parseInt(attrNS(sp,'line'),10);
      if(sp.hasAttributeNS(NS,'lineRule')) o.lineRule=attrNS(sp,'lineRule');
    }
    // indent (overrides style)
    const ind=firstNS(pPr,'ind');
    if(ind){
      if(ind.hasAttributeNS(NS,'left')) o.indLeft=parseInt(attrNS(ind,'left'),10);
      if(ind.hasAttributeNS(NS,'firstLine')) o.indFirstLine=parseInt(attrNS(ind,'firstLine'),10);
    }
    // numbering (w:numPr -> w:ilvl + w:numId)
    const numPr=firstNS(pPr,'numPr');
    if(numPr){
      const ilvl=firstNS(numPr,'ilvl');
      const numId=firstNS(numPr,'numId');
      if(ilvl && numId){
        o.num={ ilvl: parseInt(attrNS(ilvl,'val'),10)||0, numId: parseInt(attrNS(numId,'val'),10)||0 };
      }
    }
    // tab stops (w:tabs > w:tab with w:val + w:pos)
    const tabsEl=firstNS(pPr,'tabs');
    if(tabsEl){
      o.tabs=[];
      for(const t of byNS(tabsEl,'tab')){
        const val=attrNS(t,'val');
        const pos=attrNS(t,'pos');
        if(pos!==null) o.tabs.push({val: val||'left', pos: parseInt(pos,10)});
      }
    }
    return o;
  }

  // --- run properties -> inline style (default < style < direct rPr) ---
  function runStyle(rPr, style){
    const s={bold: stylesMap.defaultR.b||(style&&style.b), italic: stylesMap.defaultR.i||(style&&style.i), size: (style&&style.sz)||stylesMap.defaultR.sz};
    if(!rPr) return s;
    if(byNS(rPr,'b').length) s.bold=true;
    if(byNS(rPr,'i').length) s.italic=true;
    const sz=firstNS(rPr,'sz');
    if(sz) s.size=parseInt(attrNS(sz,'val'),10)/2; // half-points -> points
    return s;
  }

  // --- numbering counters (per numId/ilvl) ---
  const counters={};
  function nextNumber(numId, ilvl){
    if(!counters[numId]) counters[numId]=[0];
    const arr=counters[numId];
    if(arr.length<=ilvl) arr.length=ilvl+1;
    arr[ilvl]=(arr[ilvl]||0)+1;
    // reset deeper levels
    for(let i=ilvl+1;i<arr.length;i++) arr[i]=0;
    return arr[ilvl];
  }
  function formatNumber(numId, ilvl, n){
    const absId=numbering.numToAbs[numId];
    const lvls=numbering.abstracts[absId];
    let lvl=lvls&&lvls[ilvl];
    if(!lvl) lvl={fmt:'decimal', txt:'%1.', start:1};
    const arr=counters[numId]||[];
    function fmtVal(v, lv){
      if(!lv) return String(v);
      if(lv.fmt==='lowerLetter') return String.fromCharCode(96+(v-1)%26);
      if(lv.fmt==='upperLetter') return String.fromCharCode(64+(v-1)%26);
      if(lv.fmt==='lowerRoman') return toRoman(v).toLowerCase();
      if(lv.fmt==='upperRoman') return toRoman(v);
      return String(v);
    }
    let label=lvl.txt||'%1.';
    // fill %1..%9 with current counters at each level
    label=label.replace(/%(\d+)/g,(m,idx)=>{
      const lv=parseInt(idx,10)-1;
      let v=arr[lv];
      if(v===undefined) v=1;
      return fmtVal(v, lvls&&lvls[lv]);
    });
    return label;
  }
  function toRoman(n){
    const m=[[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
    let r=''; for(const [v,s] of m){ while(n>=v){ r+=s; n-=v; } } return r;
  }

  // --- build HTML for one paragraph ---
  function buildParagraph(pEl){
    const pp=readParaProps(pEl);
    // resolve paragraph style for run defaults
    const pPrEl=firstNS(pEl,'pPr');
    let styleObj=null;
    if(pPrEl){
      const ps=firstNS(pPrEl,'pStyle');
      if(ps){ const sid=attrNS(ps,'val'); styleObj=stylesMap.styles[sid]||null; }
    }
    const runs=byNS(pEl,'r');
    // collect raw text + per-run style, preserving tab/br markers
    let inner='';
    const textRuns=[];
    for(const r of runs){
      const rPr=firstNS(r,'rPr');
      const st=runStyle(rPr, styleObj);
      let txt='';
      const ts=byNS(r,'t');
      for(const t of ts){ txt += t.textContent; }
      const tabs=byNS(r,'tab');
      for(let i=0;i<tabs.length;i++) txt += '\t';
      const brs=byNS(r,'br');
      for(let i=0;i<brs.length;i++) txt += '\n';
      textRuns.push({txt, st});
    }
    // If numbering present, prefix with the list label.
    let numPrefix='';
    if(pp.num){
      const n=nextNumber(pp.num.numId, pp.num.ilvl);
      numPrefix=formatNumber(pp.num.numId, pp.num.ilvl, n);
    }
    // Determine if we have tabs in content OR defined tab stops -> render with absolute positioning
    const hasTabs = textRuns.some(t=>t.txt.indexOf('\t')>=0) || (pp.tabs && pp.tabs.length>0);
    if(hasTabs){
      // Build segments split by tab characters, keeping per-segment style.
      const segs=[];
      for(const tr of textRuns){
        const parts=tr.txt.split('\t');
        for(let i=0;i<parts.length;i++){
          if(i>0) segs.push({text:'\t', st:tr.st});
          if(parts[i]!=='') segs.push({text:parts[i], st:tr.st});
        }
      }
      const contentW=pageWPx - ml - mr;
      const stops=pp.tabs||[];
      // If tabs are used but no explicit stops defined, default to a right tab
      // at the content edge so "left text <tab> right text" places the right
      // part at the right margin (Word-like).
      let stopPx=stops.map(s=>({pos: twipToPx(s.pos), val:s.val}));
      if(stopPx.length===0){
        stopPx=[{pos: contentW, val:'right'}];
      }
      function segStyle(st){
        const sp=[];
        if(st.bold) sp.push('font-weight:700');
        if(st.italic) sp.push('font-style:italic');
        if(st.size) sp.push(`font-size:${st.size}pt`);
        return sp.length?` style="${sp.join(';')}"`:'';
      }
      function escOf(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
      // Render as a relative container. Leading text (before first tab) is inline
      // at left:0; each segment after a tab is absolutely positioned at its stop.
      let row='<div style="position:relative;width:100%;min-height:1.5em;white-space:nowrap;">';
      let segsHtml='';
      let leading=''; // accumulate inline text before first tab
      let tt=0; // number of tabs seen so far
      for(let i=0;i<segs.length;i++){
        if(segs[i].text==='\t'){ tt++; continue; }
        if(tt===0){
          // leading text: inline, left-aligned, accumulate
          leading += `<span${segStyle(segs[i].st)}>${escOf(segs[i].text)}</span>`;
        } else {
          // after a tab: position per the corresponding stop
          const sp=stopPx[Math.min(tt-1, stopPx.length-1)];
          let posPx, align;
          if(sp.val==='right'){ posPx=sp.pos; align='right'; }
          else if(sp.val==='center'){ posPx=sp.pos; align='center'; }
          else { posPx=sp.pos; align='left'; }
          const ss=segStyle(segs[i].st);
          let anchorStyle;
          if(align==='right'){
            anchorStyle=`position:absolute;right:${Math.max(0,contentW-posPx)}px;${ss}`;
          } else if(align==='center'){
            anchorStyle=`position:absolute;left:${posPx}px;transform:translateX(-50%);${ss}`;
          } else {
            anchorStyle=`position:absolute;left:${posPx}px;${ss}`;
          }
          segsHtml += `<span style="${anchorStyle}">${escOf(segs[i].text)}</span>`;
        }
      }
      if(leading) segsHtml = leading + segsHtml;
      row += segsHtml + '</div>';
      inner = (numPrefix?`<span style="font-weight:700">${numPrefix}</span> `:'') + row;
    } else {
      // plain (no tabs): render runs inline, with number prefix
      for(const tr of textRuns){
        const styleParts=[];
        if(tr.st.bold) styleParts.push('font-weight:700');
        if(tr.st.italic) styleParts.push('font-style:italic');
        if(tr.st.size) styleParts.push(`font-size:${tr.st.size}pt`);
        const styleAttr = styleParts.length ? ` style="${styleParts.join(';')}"` : '';
        const esc = tr.txt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        inner += `<span${styleAttr}>${esc}</span>`;
      }
      if(numPrefix) inner = `<span style="font-weight:700">${numPrefix}</span> ` + inner;
    }
    if(!inner.replace(/<[^>]+>/g,'').trim()) return '';
    // paragraph style
    const align = pp.align || 'left';
    const pStyleParts=[`text-align:${align}`];
    if(pp.spacingBefore) pStyleParts.push(`margin-top:${twipToPx(pp.spacingBefore)}px`);
    if(pp.spacingAfter) pStyleParts.push(`margin-bottom:${twipToPx(pp.spacingAfter)}px`);
    if(pp.line){
      if(pp.lineRule==='exact'||pp.lineRule==='atLeast'){
        pStyleParts.push(`line-height:${twipToPx(pp.line)}px`);
      } else {
        pStyleParts.push(`line-height:${pp.line/240}`); // 240 = single
      }
    } else {
      pStyleParts.push('line-height:1.5');
    }
    if(pp.indLeft) pStyleParts.push(`padding-left:${twipToPx(pp.indLeft)}px`);
    if(pp.indFirstLine) pStyleParts.push(`text-indent:${twipToPx(pp.indFirstLine)}px`);
    return `<p style="${pStyleParts.join(';')};margin:0">${inner}</p>`;
  }

  // --- build HTML for one table (signatures, layout tables) ---
  function buildTable(tblEl){
    // column widths from tblGrid (twips)
    const grid=firstNS(tblEl,'tblGrid');
    const colW=[];
    if(grid){
      for(const gc of byNS(grid,'gridCol')){
        const w=attrNS(gc,'w');
        if(w) colW.push(parseInt(w,10));
      }
    }
    // borders from tblPr/tblBorders (val, sz, color)
    const tblPr=firstNS(tblEl,'tblPr');
    let borders={top:'1px solid #000',left:'1px solid #000',bottom:'1px solid #000',right:'1px solid #000',insideH:'1px solid #000',insideV:'1px solid #000'};
    if(tblPr){
      const b=firstNS(tblPr,'tblBorders');
      if(b){
        for(const edge of ['top','left','bottom','right','insideH','insideV']){
          const el=firstNS(b,edge);
          if(el){
            const val=attrNS(el,'val');
            const sz=attrNS(el,'sz');
            const color=attrNS(el,'color');
            if(val && val!=='none'){
              const s=(sz?parseInt(sz,10)/8:1)+'px';
              borders[edge]=`${s} solid ${color||'#000'}`;
            } else {
              borders[edge]='none';
            }
          }
        }
      }
    }
    const borderCSS=`border-top:${borders.top};border-left:${borders.left};border-bottom:${borders.bottom};border-right:${borders.right};`;
    const cellBorderCSS=`border-top:${borders.top};border-left:${borders.left};border-bottom:${borders.bottom};border-right:${borders.right};border-top:${borders.insideH};border-left:${borders.insideV};`;
    // table width
    let tableW='100%';
    if(colW.length && colW.every(w=>w>0)){
      const tw=colW.reduce((a,b)=>a+b,0);
      if(tw>0) tableW=`${tw}px`;
    }
    let rowsHtml='';
    const trs=byNS(tblEl,'tr');
    for(const tr of trs){
      const tcCells=byNS(tr,'tc');
      let cellsHtml='';
      let ci=0;
      for(const tc of tcCells){
        const tcPr=firstNS(tc,'tcPr');
        let wpx=null;
        if(tcPr){
          const tcw=firstNS(tcPr,'tcW');
          if(tcw){
            const w=attrNS(tcw,'w'); const type=attrNS(tcw,'type');
            if(w && (type==='dxa'||!type)) wpx=twipToPx(parseInt(w,10));
          }
        }
        if(wpx==null && colW[ci]) wpx=twipToPx(colW[ci]);
        const wStyle = wpx?`width:${wpx}px;`:'';
        let cellInner='';
        for(const p of byNS(tc,'p')){
          const ppHtml=buildParagraph(p);
          if(ppHtml) cellInner += ppHtml;
        }
        cellsHtml += `<td style="${wStyle}${cellBorderCSS}vertical-align:top;">${cellInner}</td>`;
        ci++;
      }
      rowsHtml += `<tr>${cellsHtml}</tr>`;
    }
    return `<table style="width:${tableW};table-layout:fixed;${borderCSS}">${rowsHtml}</table>`;
  }

  // --- iterate body in document order: paragraphs AND tables ---
  const body=firstNS(dom,'body');
  let htmlBody='';
  if(body){
    for(const child of Array.from(body.children)){
      if(child.namespaceURI===NS){
        if(child.localName==='p'){
          htmlBody += buildParagraph(child);
        } else if(child.localName==='tbl'){
          htmlBody += buildTable(child);
        }
      }
    }
  }

  // assemble full HTML with page container
  const fontSize = 11; // default body pt
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;}
    body{font-family:'PT Sans',Arial,Helvetica,sans-serif;font-size:${fontSize}pt;color:#000;background:#fff;}
    .docpage{width:${pageWPx}px;min-height:${pageHPx}px;box-sizing:border-box;padding:${mt}px ${mr}px ${mb}px ${ml}px;overflow:hidden;}
    p{margin:0;}
  </style></head><body><div class="docpage">${htmlBody}</div></body></html>`;
}
// Convert DOCX to image(s) via html2canvas rendering, preserving exact A4
// proportions and Word-like layout. Returns an array of image blobs (one per page).
async function docxToImages(html, imgFmt){
  const canvases=await renderHtmlToPageCanvases(html);
  const blobs=[];
  for(const c of canvases){
    const mime = imgFmt==='png'?'image/png': imgFmt==='webp'?'image/webp':'image/jpeg';
    blobs.push(await canvasToBlob(c, mime, $('quality').value/100));
  }
  return blobs;
}

// Render DOCX HTML to a PDF via html2canvas (browser-rendered, so fonts,
// alignment and spacing are exact). The canvas is sliced into A4 pages.
async function docxToPdf(html){
  const canvases=await renderHtmlToPageCanvases(html);
  const { jsPDF } = window.jspdf;
  const pdf=new jsPDF({unit:'pt', format:'a4'});
  const pageW=pdf.internal.pageSize.getWidth();
  for(const c of canvases){
    const dataUrl=c.toDataURL('image/jpeg',0.92);
    pdf.addImage(dataUrl,'JPEG',0,0,pageW, pageW*c.height/c.width);
    if(canvases.length>1) pdf.addPage();
  }
  // remove the trailing blank page if more than one (addPage after last)
  if(canvases.length>1) pdf.deletePage(pdf.getNumberOfPages());
  return pdf.output('blob');
}

// Render an HTML string to a set of A4-page canvases using html2canvas.
// The HTML is rendered at A4 width (800px) then sliced vertically into
// page-height bands, each band becoming one page canvas.
async function renderHtmlToPageCanvases(html){
  const box=$('hiddenRender');
  // Render at A4 width. 800px ~ A4 width at 96dpi scaled.
  box.style.cssText='position:absolute;left:-9999px;top:0;width:800px;background:#fff;padding:0;font-family:\"PT Sans\",Arial,Helvetica,sans-serif;font-size:11pt;color:#000;line-height:1.5;box-sizing:border-box;white-space:normal;';
  box.innerHTML=html;
  // Ensure the PT Sans web font is fully loaded before rendering (avoids tofu/missing glyphs).
  try{ await document.fonts.ready; }catch(e){}
  await new Promise(r=>setTimeout(r,120));
  const canvas=await html2canvas(box,{scale:2, useCORS:true, backgroundColor:'#ffffff', windowWidth:800, logging:false});
  const cw=canvas.width;
  // A4 aspect ratio: width:height = 1:1.414. At 800px render width, page height = 800*1.414.
  const pageHPx = cw * Math.sqrt(2); // A4 portrait
  const canvases=[];
  let y=0;
  while(y<canvas.height){
    const sliceH=Math.min(pageHPx, canvas.height-y);
    const slice=document.createElement('canvas');
    slice.width=cw; slice.height=sliceH;
    const ctx=slice.getContext('2d');
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,cw,sliceH);
    ctx.drawImage(canvas,0,y,cw,sliceH,0,0,cw,sliceH);
    canvases.push(slice);
    y+=pageHPx;
  }
  return canvases;
}
async function docxToText(arrayBuffer){
  const res=await mammoth.extractRawText({arrayBuffer});
  return res.value;
}
async function xlsxRead(arrayBuffer){
  const wb=XLSX.read(arrayBuffer,{type:'array'});
  return wb;
}
async function pptxToText(arrayBuffer){
  const zip=await JSZip.loadAsync(arrayBuffer);
  let out='';
  const slideFiles=Object.keys(zip.files).filter(n=>n.startsWith('ppt/slides/slide')&&n.endsWith('.xml')).sort();
  for(const name of slideFiles){
    const xml=await zip.file(name).async('string');
    const texts=[...xml.matchAll(/<a:t>([^<]+)<\/a:t>/g)].map(m=>m[1]);
    if(texts.length) out+=texts.join(' ')+'\n\n';
  }
  return out.trim()||'Не удалось извлечь текст из PPTX';
}
async function rtfToText(text){
  // simple RTF strip
  return text.replace(/\\par[d]?/g,'\n').replace(/\{[^}]*\}/g,'').replace(/\\[a-z]+-?\d* ?/g,'').replace(/[{}]/g,'').trim();
}

// --- main convert ---
convertBtn.onclick = async ()=>{
  if(!currentFile) return;
  hideError(); resultBox.hidden=true; convertBtn.disabled=true;
  const from = detectFmt(currentFile);
  const to = toFmt;
  const base = baseOf(currentFile.name);
  setProgress(5,'Подготовка…');
  try{
    const buf = await fileToArrayBuffer(currentFile);
    let outBlob=null, outName='', outMime='application/octet-stream';

    // PDF source
    if(from==='pdf'){
      if(to==='jpg'||to==='png'||to==='webp'){
        const blobs=await pdfToImages(buf,to);
        if(blobs.length===1){ outBlob=blobs[0]; outName=`${base}.${to}`; }
        else{
          // zip multiple pages
          const zip=new JSZip();
          blobs.forEach((b,i)=>zip.file(`page-${i+1}.${to}`,b));
          outBlob=await zip.generateAsync({type:'blob'}); outName=`${base}-pages.zip`;
        }
      } else if(to==='txt'){ const t=await pdfToText(buf); outBlob=new Blob([t],{type:'text/plain;charset=utf-8'}); outName=`${base}.txt`; }
      else if(to==='docx'){ const t=await pdfToText(buf); outBlob=await textToDocx(t); outName=`${base}.docx`; }
      else if(to==='html'){ const t=await pdfToText(buf); outBlob=new Blob([`<html><body><pre>${t.replace(/</g,'&lt;')}</pre></body></html>`],{type:'text/html'}); outName=`${base}.html`; }
      else if(to==='pdf'){ outBlob=new Blob([buf],{type:'application/pdf'}); outName=`${base}.pdf`; }
      else throw new Error(`Конвертация PDF → ${to.toUpperCase()} не поддерживается`);
    }
    // Image source
    else if(['jpg','png','webp'].includes(from)){
      if(to==='pdf'){ outBlob=await imageToPdf(currentFile); outName=`${base}.pdf`; }
      else if(['jpg','png','webp'].includes(to)){ outBlob=await imageToImage(currentFile,to); outName=`${base}.${to}`; }
      else throw new Error(`Конвертация ${from.toUpperCase()} → ${to.toUpperCase()} не поддерживается`);
    }
    // DOCX source
    else if(from==='docx'||from==='doc'){
      if(to==='pdf'){ const html=await docxToHtml(buf); outBlob=await docxToPdf(html); outName=`${base}.pdf`; }
      else if(to==='txt'){ const t=await docxToText(buf); outBlob=new Blob([t],{type:'text/plain;charset=utf-8'}); outName=`${base}.txt`; }
      else if(to==='html'){ const html=await docxToHtml(buf); outBlob=new Blob([html],{type:'text/html'}); outName=`${base}.html`; }
      else if(to==='jpg'||to==='png'){ const html=await docxToHtml(buf); const blobs=await docxToImages(html,to); if(blobs.length===1){ outBlob=blobs[0]; outName=`${base}.${to}`; } else { const zip=new JSZip(); blobs.forEach((b,i)=>zip.file(`page-${i+1}.${to}`,b)); outBlob=await zip.generateAsync({type:'blob'}); outName=`${base}-pages.zip`; } }
      else throw new Error(`Конвертация DOCX → ${to.toUpperCase()} не поддерживается`);
    }
    // XLSX / CSV source
    else if(from==='xlsx'||from==='xls'||from==='csv'){
      const wb=await xlsxRead(buf);
      if(to==='pdf'){
        const ws=wb.Sheets[wb.SheetNames[0]];
        const html=XLSX.utils.sheet_to_html(ws);
        outBlob=await htmlToPdf(html); outName=`${base}.pdf`;
      } else if(to==='csv'){ const ws=wb.Sheets[wb.SheetNames[0]]; const csv=XLSX.utils.sheet_to_csv(ws); outBlob=new Blob([csv],{type:'text/csv;charset=utf-8'}); outName=`${base}.csv`; }
      else if(to==='json'){ const ws=wb.Sheets[wb.SheetNames[0]]; const json=XLSX.utils.sheet_to_json(ws,{header:1}); outBlob=new Blob([JSON.stringify(json,null,2)],{type:'application/json'}); outName=`${base}.json`; }
      else if(to==='xlsx'){ XLSX.writeFile(wb, `${base}.xlsx`); outBlob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}); outName=`${base}.xlsx`; }
      else if(to==='html'){ const ws=wb.Sheets[wb.SheetNames[0]]; const html=XLSX.utils.sheet_to_html(ws); outBlob=new Blob([html],{type:'text/html'}); outName=`${base}.html`; }
      else if(to==='txt'){ const ws=wb.Sheets[wb.SheetNames[0]]; const csv=XLSX.utils.sheet_to_csv(ws); outBlob=new Blob([csv],{type:'text/plain;charset=utf-8'}); outName=`${base}.txt`; }
      else if(to==='jpg'||to==='png'){ const ws=wb.Sheets[wb.SheetNames[0]]; const html=XLSX.utils.sheet_to_html(ws); const box=$('hiddenRender'); box.innerHTML=html; const c=await html2canvas(box,{scale:2}); outBlob=await canvasToBlob(c, to==='png'?'image/png':'image/jpeg', .92); outName=`${base}.${to}`; }
      else throw new Error(`Конвертация таблицы → ${to.toUpperCase()} не поддерживается`);
    }
    // TXT source
    else if(from==='txt'||from==='md'||from==='rtf'){
      let text=await fileToText(currentFile);
      if(from==='rtf') text=await rtfToText(text);
      if(to==='pdf'){ outBlob=await textToPdf(text); outName=`${base}.pdf`; }
      else if(to==='docx'){ outBlob=await textToDocx(text); outName=`${base}.docx`; }
      else if(to==='html'){ const html = from==='md' ? marked.parse(text) : `<pre>${text.replace(/</g,'&lt;')}</pre>`; outBlob=new Blob([html],{type:'text/html'}); outName=`${base}.html`; }
      else if(to==='txt'){ outBlob=new Blob([text],{type:'text/plain;charset=utf-8'}); outName=`${base}.txt`; }
      else if(to==='jpg'||to==='png'){ const box=$('hiddenRender'); box.innerHTML=`<pre style="white-space:pre-wrap;font-family:Arial">${text.replace(/</g,'&lt;')}</pre>`; const c=await html2canvas(box,{scale:2}); outBlob=await canvasToBlob(c, to==='png'?'image/png':'image/jpeg', .92); outName=`${base}.${to}`; }
      else throw new Error(`Конвертация текста → ${to.toUpperCase()} не поддерживается`);
    }
    // HTML source
    else if(from==='html'||from==='htm'){
      const html=await fileToText(currentFile);
      if(to==='pdf'){ outBlob=await htmlToPdf(html); outName=`${base}.pdf`; }
      else if(to==='txt'){ const div=document.createElement('div'); div.innerHTML=html; outBlob=new Blob([div.innerText],{type:'text/plain;charset=utf-8'}); outName=`${base}.txt`; }
      else if(to==='docx'){ const div=document.createElement('div'); div.innerHTML=html; outBlob=await textToDocx(div.innerText); outName=`${base}.docx`; }
      else if(to==='jpg'||to==='png'){ const box=$('hiddenRender'); box.innerHTML=html; const c=await html2canvas(box,{scale:2}); outBlob=await canvasToBlob(c, to==='png'?'image/png':'image/jpeg', .92); outName=`${base}.${to}`; }
      else throw new Error(`Конвертация HTML → ${to.toUpperCase()} не поддерживается`);
    }
    // PPTX source
    else if(from==='pptx'||from==='ppt'){
      const t=await pptxToText(buf);
      if(to==='txt'){ outBlob=new Blob([t],{type:'text/plain;charset=utf-8'}); outName=`${base}.txt`; }
      else if(to==='pdf'){ outBlob=await textToPdf(t); outName=`${base}.pdf`; }
      else if(to==='docx'){ outBlob=await textToDocx(t); outName=`${base}.docx`; }
      else if(to==='jpg'||to==='png'){ const box=$('hiddenRender'); box.innerHTML=`<pre style="white-space:pre-wrap;font-family:Arial">${t.replace(/</g,'&lt;')}</pre>`; const c=await html2canvas(box,{scale:2}); outBlob=await canvasToBlob(c, to==='png'?'image/png':'image/jpeg', .92); outName=`${base}.${to}`; }
      else throw new Error(`Конвертация PPTX → ${to.toUpperCase()} не поддерживается`);
    }
    else if(from==='json'){
      const text=await fileToText(currentFile);
      if(to==='pdf'){ outBlob=await textToPdf(text); outName=`${base}.pdf`; }
      else if(to==='txt'){ outBlob=new Blob([text],{type:'text/plain;charset=utf-8'}); outName=`${base}.txt`; }
      else throw new Error(`Конвертация JSON → ${to.toUpperCase()} не поддерживается`);
    }
    else {
      throw new Error(`Формат .${from} пока не поддерживается. Попробуйте PDF, DOCX, XLSX, JPG, PNG, TXT, HTML, CSV, PPTX.`);
    }

    setProgress(100,'Готово!');
    resultBox.hidden=false;
    resultFile.textContent=`${outName} • ${fmtSize(outBlob.size)}`;
    downloadBlob(outBlob, outName);
    addHistory(currentFile.name, from, to, outBlob.size);
    // preview for images
    resultPreview.innerHTML='';
    if(outBlob.type.startsWith('image/')){
      const url=URL.createObjectURL(outBlob);
      resultPreview.innerHTML=`<img src="${url}" alt="preview">`;
    }
    toast('✅ Конвертация завершена!');
  }catch(err){
    console.error(err);
    showError(err.message||'Ошибка конвертации. Попробуйте другой файл.');
    setProgress(0,'Ошибка');
  }finally{
    convertBtn.disabled=false;
  }
};
