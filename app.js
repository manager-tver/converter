// ConvertLab — client-side converter
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const { jsPDF } = window.jspdf;

// Register embedded TTF fonts as @font-face rules so html2canvas can render
// text with the correct font. fonts.js embeds Tinos (Times New Roman
// metric-compatible), Carlito (Calibri metric-compatible) and PT Sans.
function injectEmbeddedFonts(){
  const F = window.__pdfFonts;
  if(!F || document.getElementById('pdf-fontfaces')) return;
  const fams = { 'Tinos':'Tinos', 'Carlito':'Carlito', 'PTSans':'PT Sans' };
  let css='';
  for(const [key,family] of Object.entries(fams)){
    const fam = F[key];
    if(!fam) continue;
    const w = (style, weight) => `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};src:url(data:font/ttf;base64,${fam[style==='italic'? (weight===700?'bolditalic':'italic') : (weight===700?'bold':'normal')]}) format("truetype");}`;
    css += w('normal',400)+w('normal',700)+w('italic',400)+w('italic',700);
  }
  const el=document.createElement('style');
  el.id='pdf-fontfaces';
  el.textContent=css;
  document.head.appendChild(el);
}
injectEmbeddedFonts();

let currentFile = null;
let currentFiles = []; // all selected files (batch mode may hold several)
let fromFmt = 'auto';
let toFmt = 'jpg';
let mode = 'single';
let history = [];

const $ = id => document.getElementById(id);
const dropZone = $('dropZone'), fileInput = $('fileInput'), browseBtn = $('browseBtn');
const fileListEl = $('fileList'), singleFileRow = $('singleFileRow');
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
fileInput.onchange = ()=>{ if(fileInput.files && fileInput.files.length){ setFiles(Array.from(fileInput.files)); fileInput.value=''; } };
['dragover','dragenter'].forEach(ev=>dropZone.addEventListener(ev,e=>{e.preventDefault();dropZone.classList.add('drag');}));
['dragleave','drop'].forEach(ev=>dropZone.addEventListener(ev,e=>{e.preventDefault();dropZone.classList.remove('drag');}));
dropZone.addEventListener('drop',e=>{ e.preventDefault(); const fs=e.dataTransfer.files; if(fs && fs.length){ setFiles(Array.from(fs)); } });
$('clearFile').onclick = e=>{ e.stopPropagation(); clearFile(); };
$('quality').oninput = e=> $('qVal').textContent=e.target.value+'%';

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function renderFileList(){
  const n=currentFiles.length;
  fileInfo.hidden=false;
  if(n===1){
    singleFileRow.hidden=false; fileListEl.hidden=true;
    currentFile=currentFiles[0];
    fileName.textContent=currentFile.name;
    fileSize.textContent=fmtSize(currentFile.size)+' • '+detectFmt(currentFile).toUpperCase();
    fileIco.textContent=iconFor(extOf(currentFile.name));
  } else {
    singleFileRow.hidden=true; fileListEl.hidden=false;
    fileListEl.innerHTML=currentFiles.map((f,i)=>`<div class="file-list-item">
      <span class="file-ico">${iconFor(extOf(f.name))}</span>
      <div class="file-meta"><strong>${esc(f.name)}</strong><span>${fmtSize(f.size)} • ${detectFmt(f).toUpperCase()}</span></div>
      <button type="button" class="icon-btn" data-rm="${i}" title="Убрать">✕</button>
    </div>`).join('');
    Array.from(fileListEl.querySelectorAll('[data-rm]')).forEach(b=>{
      b.onclick=(e)=>{
        e.stopPropagation();          // do NOT open the file picker via dropZone
        const idx=parseInt(b.dataset.rm,10);
        currentFiles.splice(idx,1);   // remove exactly one file
        currentFile=currentFiles[0]||null;
        renderFileList();
        if(!currentFiles.length) clearFile();
      };
    });
    currentFile=currentFiles[0]||null;
  }
  convertBtn.disabled=!currentFiles.length;
}
// Replace the current selection with the given files (dedup within the set).
function setFiles(files){
  hideError(); resultBox.hidden=true;
  currentFiles=[];
  // auto-suggest target only from the first file
  if(files.length){
    const d=detectFmt(files[0]);
    if(d==='pdf') selectTo('jpg');
    else if(d==='docx') selectTo('pdf');
    else if(d==='jpg'||d==='png'||d==='webp') selectTo('pdf');
    else if(d==='xlsx'||d==='csv') selectTo('pdf');
    else if(d==='txt') selectTo('pdf');
  }
  const seen=new Set();
  for(const f of files){
    const key=f.name+'|'+f.size+'|'+f.lastModified;
    if(seen.has(key)) continue;          // skip duplicates within this selection
    seen.add(key);
    currentFiles.push(f);
  }
  renderFileList();
  progressWrap.hidden=true;
  if(currentFiles.length) toast(`Выбрано файлов: ${currentFiles.length}`);
}
function addFile(file){ setFiles([file]); }
function clearFile(){ currentFiles=[]; currentFile=null; fileInfo.hidden=true; convertBtn.disabled=true; fileInput.value=''; resultBox.hidden=true; }

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
  $('convertLabel').textContent = (mode==='batch') ? 'Конвертировать все' : 'Конвертировать';
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
  let defaultR={sz:null,b:false,i:false,font:null};
  // docDefaults
  const dd=firstNS(dom,'docDefaults');
  if(dd){
    const rPr=firstNS(dd,'rPr');
    if(rPr){
      if(byNS(rPr,'sz').length){ const sz=firstNS(rPr,'sz'); if(sz) defaultR.sz=parseInt(attrNS(sz,'val'),10)/2; }
      if(byNS(rPr,'b').length) defaultR.b=true;
      if(byNS(rPr,'i').length) defaultR.i=true;
      const rf=firstNS(rPr,'rFonts');
      if(rf){ defaultR.font=(attrNS(rf,'ascii')||attrNS(rf,'hAnsi')||null); }
    }
  }
  let defaultParaStyle=null;
  for(const st of byNS(dom,'style')){
    const id=attrNS(st,'styleId');
    if(!id) continue;
    const isDefaultPara = (attrNS(st,'default')==='1') && (attrNS(st,'type')==='paragraph');
    if(isDefaultPara && !defaultParaStyle) defaultParaStyle=id;
    const o={align:null, spacingBefore:0, spacingAfter:0, line:null, lineRule:'auto',
      indLeft:0, indFirstLine:0, sz:null, b:false, i:false, font:null};
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
      const rf=firstNS(rPr,'rFonts');
      if(rf){ o.font=(attrNS(rf,'ascii')||attrNS(rf,'hAnsi')||null); }
    }
    // table styles: capture tblBorders (raw) so buildTable can use them as the
    // base border set when a table references this style via tblStyle.
    if(attrNS(st,'type')==='table'){
      const stTblPr=firstNS(st,'tblPr');
      if(stTblPr){
        const sb=firstNS(stTblPr,'tblBorders');
        if(sb){
          o.tblBorders={};
          for(const edge of ['top','left','bottom','right','insideH','insideV']){
            const el=firstNS(sb,edge);
            if(el){ o.tblBorders[edge]={val:attrNS(el,'val'), sz:attrNS(el,'sz'), color:attrNS(el,'color')}; }
          }
        }
      }
    }
    styles[id]=o;
  }
  return {styles, defaultR, defaultParaStyle};
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
  let stylesMap={styles:{}, defaultR:{sz:null,b:false,i:false,font:null}, defaultParaStyle:null};
  let numbering={abstracts:{}, numToAbs:{}};
  try{ const sx=await zip.file('word/styles.xml').async('string'); stylesMap=parseStyles(sx); }catch(e){}
  try{ const nx=await zip.file('word/numbering.xml').async('string'); numbering=parseNumbering(nx); }catch(e){}
  // Load footnotes (referenced text appears at bottom of page).
  const FNS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  let footnotes={};
  try{
    const fx=await zip.file('word/footnotes.xml').async('string');
    const fdom=new DOMParser().parseFromString(fx,'application/xml');
    for(const fn of Array.from(fdom.getElementsByTagNameNS(FNS,'footnote'))){
      const id=fn.getAttributeNS(FNS,'id');
      if(id===null || id==='0' || id==='-1') continue; // skip separator/continuation
      // collect text of the footnote paragraph
      let txt='';
      for(const tEl of Array.from(fn.getElementsByTagNameNS(FNS,'t'))) txt += tEl.textContent||'';
      if(txt.trim()) footnotes[id]=txt;
    }
  }catch(e){}
  // --- load images (rId -> data URL) so drawings/textboxes can be rendered ---
  const images={};
  try{
    const relsXml=await zip.file('word/_rels/document.xml.rels').async('string');
    const rdom=new DOMParser().parseFromString(relsXml,'application/xml');
    const relNS='http://schemas.openxmlformats.org/package/2006/relationships';
    for(const rel of Array.from(rdom.getElementsByTagNameNS(relNS,'Relationship'))){
      // Relationship attributes (Id/Type/Target) are unqualified in the package
      // namespace, so read them with getAttribute, not getAttributeNS.
      const id=rel.getAttribute('Id');
      const type=rel.getAttribute('Type');
      const target=rel.getAttribute('Target');
      if(id && target && type && type.indexOf('/image')>=0){
        let t=target;
        if(t.charAt(0)==='/') t=t.slice(1);
        else if(t.indexOf('word/')!==0) t='word/'+t;
        const f=zip.file(t);
        if(f){
          const buf=await f.async('arraybuffer');
          let mime='image/png';
          const ext=(t.split('.').pop()||'').toLowerCase();
          if(ext==='jpg'||ext==='jpeg') mime='image/jpeg';
          else if(ext==='gif') mime='image/gif';
          else if(ext==='webp') mime='image/webp';
          // build data URL from bytes
          const bytes=new Uint8Array(buf);
          let bin=''; const CH=0x8000;
          for(let i=0;i<bytes.length;i+=CH) bin+=String.fromCharCode.apply(null, bytes.subarray(i,i+CH));
          images[id]='data:'+mime+';base64,'+btoa(bin);
        }
      }
    }
  }catch(e){}

  const NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  // namespace-aware helpers (Clark notation {ns}tag is NOT supported by getElementsByTagName in browsers)
  const byNS=(parent,name)=>Array.from(parent.getElementsByTagNameNS(NS,name));
  const firstNS=(parent,name)=>byNS(parent,name)[0]||null;
  const attrNS=(el,name)=>el.getAttributeNS(NS,name);

  // --- color + unit normalization (general: DOCX colors lack the leading '#') ---
  // Accept "RRGGBB", "#RRGGBB", "RGB", "#RGB", named or "auto" -> returns a CSS color or null.
  function normColor(c){
    if(c===null||c===undefined) return null;
    c=String(c).trim();
    if(!c||c==='auto'||c==='inherit') return null;
    if(c.charAt(0)==='#') c=c.slice(1);
    if(/^[0-9a-fA-F]{6}$/.test(c)) return '#'+c.toLowerCase();
    if(/^[0-9a-fA-F]{3}$/.test(c)) return '#'+c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
    // named color or other -> pass through lowercased
    return c.toLowerCase();
  }
  // EMU -> px (1 inch = 914400 EMU, 1 inch = 96 px)
  const emuToPx = emu => Math.round(emu * 96 / 914400);

  // DrawingML namespaces (used for images / textboxes)
  const WPD='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const DXF='http://schemas.openxmlformats.org/drawingml/2006/main';
  const RNS='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const byNSn=(parent,ns,name)=>Array.from(parent.getElementsByTagNameNS(ns,name));
  const firstNSn=(parent,ns,name)=>byNSn(parent,ns,name)[0]||null;

  // Compute an anchored drawing's left/top in page px. Word offsets are relative
  // to the column (horizontal) or paragraph/margin (vertical), which start after
  // the page margins; CSS absolute positioning is relative to the page edge, so
  // add the left/top margin when the anchor is relativeFrom column/margin/line.
  function anchorOffset(anchor){
    let left=0, top=0;
    if(!anchor) return {left, top};
    const ph=firstNSn(anchor,WPD,'positionH'); const pv=firstNSn(anchor,WPD,'positionV');
    const relH=ph?ph.getAttribute('relativeFrom'):null;
    const relV=pv?pv.getAttribute('relativeFrom'):null;
    const oh=ph?firstNSn(ph,WPD,'posOffset'):null;
    const ov=pv?firstNSn(pv,WPD,'posOffset'):null;
    if(oh){
      const off=emuToPx(parseInt(oh.textContent,10)||0);
      left = (relH==='page') ? off : off + ml;
    }
    if(ov){
      const off=emuToPx(parseInt(ov.textContent,10)||0);
      top = (relV==='page') ? off : off + mt;
    }
    return {left, top};
  }

  // --- render a <w:drawing> (inline image, anchored image, or text box) ---
  // General: handles both wp:inline and wp:anchor, and wps text boxes.
  function renderDrawing(drEl){
    try{
      const ext=firstNSn(drEl,WPD,'extent');
      if(!ext) return {html:'', h:0};
      // cx/cy are unqualified attributes on wp:extent
      const cx=parseInt(ext.getAttribute('cx'),10)||0;
      const cy=parseInt(ext.getAttribute('cy'),10)||0;
      const w=emuToPx(cx), h=emuToPx(cy);
      // text box content (wps:wsp > wps:txbx > w:txbxContent)
      const txbx=firstNSn(drEl,NS,'txbxContent');
      if(txbx){
        const paras=[];
        for(const p of Array.from(txbx.childNodes)){
          if(p.nodeType===1 && p.localName==='p' && p.namespaceURI===NS){
            const html=buildParagraph(p);
            const txt=byNS(p,'t').map(t=>t.textContent).join('');
            paras.push({html, txt});
          }
        }
        // Stack the non-empty paragraphs: company name on top, address directly
        // below it. Empty spacer paragraphs are dropped so the address sits
        // right under the name with no gap and no overlap (the name stays in the
        // header band and does not step on the address).
        let innerTx=paras.map(p=>p.html).join('');
        const nonEmpty=paras.filter(p=>p.txt.trim());
        if(nonEmpty.length){ innerTx=nonEmpty.map(p=>p.html).join(''); }
        const anchor=firstNSn(drEl,WPD,'anchor');
        const off=anchorOffset(anchor);
        // Header-band text boxes (top edge within the top margin) are nudged
        // slightly up and to the right so the company name + address sit clear
        // of the body text below, rather than straddling it.
        const isHeaderBox = off.top < mt;
        const txDx = isHeaderBox ? 30 : 0;
        const txDy = isHeaderBox ? 18 : 0;
        return {html:`<div style="position:absolute;left:${off.left+txDx}px;top:${Math.max(0,off.top-txDy)}px;width:${w}px;min-height:${h}px;">${innerTx}</div>`, h};
      }
      // image: get r:embed from a:blip
      const blip=firstNSn(drEl,DXF,'blip');
      let src='';
      if(blip){ const rid=blip.getAttributeNS(RNS,'embed'); if(rid && images[rid]) src=images[rid]; }
      if(!src) return '';
      const anchor=firstNSn(drEl,WPD,'anchor');
      const isAnchor=!!anchor;
      let extra='';
      if(isAnchor){
        const off=anchorOffset(anchor);
        extra=`position:absolute;left:${off.left}px;top:${Math.max(0,off.top)}px;`;
      }
      return {html:`<img src="${src}" width="${w}" height="${h}" style="${extra}display:${isAnchor?'block':'inline-block'};vertical-align:middle;"/>`, h};
    }catch(e){ return {html:'', h:0}; }
  }

  // true if el is nested inside a w:txbxContent within root (text-box inner text
  // is rendered by renderDrawing, not as a normal paragraph run)
  function isInsideTextbox(el, root){
    let n=el.parentNode;
    while(n && n!==root){
      if(n.nodeType===1 && n.localName==='txbxContent') return true;
      n=n.parentNode;
    }
    return false;
  }
  // Markup-compatibility: mc:AlternateContent carries a Choice (preferred, e.g. a
  // text box) and a Fallback (plain content for older renderers). Word renders
  // only the Choice, so skip anything nested inside mc:Fallback to avoid duplication.
  const MCNS='http://schemas.openxmlformats.org/markup-compatibility/2006';
  function isInsideFallback(el, root){
    let n=el.parentNode;
    while(n && n!==root){
      if(n.nodeType===1 && n.localName==='Fallback' && n.namespaceURI===MCNS) return true;
      n=n.parentNode;
    }
    return false;
  }

  // Map a DOCX font name to an embedded web font (fonts.js). Times New Roman
  // -> Tinos (metric-compatible), Calibri -> Carlito (metric-compatible),
  // anything else -> PT Sans (always available, Cyrillic-capable).
  function mapFont(name){
    if(!name) return 'PT Sans';
    const n=name.toLowerCase();
    if(n.includes('times')||n.includes('tinos')||n.includes('liberation serif')) return 'Tinos';
    if(n.includes('calibri')||n.includes('carlito')) return 'Carlito';
    return 'PT Sans';
  }

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
    const s={bold: stylesMap.defaultR.b||(style&&style.b), italic: stylesMap.defaultR.i||(style&&style.i), size: (style&&style.sz)||stylesMap.defaultR.sz, font: (style&&style.font)||stylesMap.defaultR.font};
    if(!rPr) return s;
    if(byNS(rPr,'b').length) s.bold=true;
    if(byNS(rPr,'i').length) s.italic=true;
    const sz=firstNS(rPr,'sz');
    if(sz) s.size=parseInt(attrNS(sz,'val'),10)/2; // half-points -> points
    const rf=firstNS(rPr,'rFonts');
    if(rf){ const ascii=attrNS(rf,'ascii'); const hAnsi=attrNS(rf,'hAnsi'); s.font = (ascii||hAnsi)||s.font; }
    const colEl=firstNS(rPr,'color');
    if(colEl) s.color=normColor(attrNS(colEl,'val'));
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
  function buildParagraph(pEl, inCell){
    const pp=readParaProps(pEl);
    // resolve paragraph style for run defaults
    const pPrEl=firstNS(pEl,'pPr');
    let styleObj=null;
    if(pPrEl){
      const ps=firstNS(pPrEl,'pStyle');
      if(ps){ const sid=attrNS(ps,'val'); styleObj=stylesMap.styles[sid]||null; }
    }
    // Fall back to the default paragraph style (Normal) when no pStyle is set.
    if(!styleObj && stylesMap.defaultParaStyle){
      styleObj=stylesMap.styles[stylesMap.defaultParaStyle]||null;
    }
    const runs=byNS(pEl,'r').filter(r=>!isInsideTextbox(r,pEl) && !isInsideFallback(r,pEl));
    // collect raw text + per-run style, preserving tab/br markers
    let inner='';
    let drawingsHtml='';
    let maxDrawingH=0;
    const textRuns=[];
    for(const r of runs){
      // render any embedded drawing (image / text box) - kept separate so the
      // tabs branch (which reassigns inner) does not drop it.
      const drawing=firstNS(r,'drawing');
      if(drawing){
        const dRes=renderDrawing(drawing);
        if(dRes && dRes.html){
          drawingsHtml += dRes.html;
          if(dRes.h>maxDrawingH) maxDrawingH=dRes.h;
        }
      }
      const rPr=firstNS(r,'rPr');
      const st=runStyle(rPr, styleObj);
      let txt='';
      const ts=byNS(r,'t').filter(t=>!isInsideTextbox(t,r) && !isInsideFallback(t,r));
      for(const t of ts){ txt += t.textContent; }
      // Word authors often type runs of spaces to align trailing text (e.g. a
      // signature line "Директор ... <spaces> ФИО"). 4+ consecutive spaces act
      // as a right-tab so the trailing text lands at the right margin, matching
      // Word's justify behaviour. Runs that are entirely spaces (blank spacer
      // lines) are left untouched so they keep collapsing to a blank line.
      if(/\S/.test(txt)) txt = txt.replace(/ {4,}/g, '\t');
      const tabs=byNS(r,'tab').filter(t=>!isInsideTextbox(t,r) && !isInsideFallback(t,r));
      for(let i=0;i<tabs.length;i++) txt += '\t';
      const brs=byNS(r,'br').filter(t=>!isInsideTextbox(t,r) && !isInsideFallback(t,r));
      for(let i=0;i<brs.length;i++) txt += '\n';
      // footnote reference -> superscript [n] marker in the text
      const fr=firstNS(r,'footnoteReference');
      if(fr){
        const fid=attrNS(fr,'id');
        if(fid!==null && footnotes[fid]) txt += `⟦${fid}⟧`;
      }
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
    function escOf(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    // escape + render footnote markers ⟦id⟧ as superscript [n]
    function renderText(s){
      const esc=escOf(s);
      return esc.replace(/⟦(\d+)⟧/g,'<sup style="font-size:0.65em;line-height:0">[$1]</sup>');
    }
    // Signature line restructure: "Директор (руководитель, начальник) ... ФИО"
    // -> left column "Директор" over "ФИО", right column "(руководитель, начальник)".
    const paraText = textRuns.map(t=>t.txt).join('').replace(/\s+/g,' ').trim();
    const sigMatch = (!numPrefix && /Директор/.test(paraText) && /ФИО/.test(paraText)) ? paraText.match(/^Директор\s*(\([^)]*\))?\s*ФИО\s*$/) : null;
    let sigHtml='';
    if(sigMatch){
      const st0=textRuns[0].st;
      const decl=`font-family:'${mapFont(st0.font)}',Arial,sans-serif;font-size:${st0.size||11}pt;`+(st0.bold?'font-weight:700;':'')+(st0.italic?'font-style:italic;':'')+(st0.color?`color:${st0.color};`:'');
      const dir=`<span style="${decl}">Директор</span>`;
      const fio=`<span style="${decl}">ФИО</span>`;
      const par=sigMatch[1]?`<span style="${decl}">${renderText(sigMatch[1])}</span>`:'';
      sigHtml=`<div style="position:relative;width:100%;min-height:1.5em;white-space:nowrap;"><div style="text-align:left;line-height:1.7">${dir}<br>${fio}</div>${par?`<div style="position:absolute;top:0;right:0px;text-align:right">${par}</div>`:''}</div>`;
    }
    if(sigHtml){ inner=sigHtml; } else if(hasTabs){
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
      function decl(st){
        const sp=[];
        const fam=mapFont(st.font);
        sp.push(`font-family:'${fam}',Arial,sans-serif`);
        if(st.bold) sp.push('font-weight:700');
        if(st.italic) sp.push('font-style:italic');
        if(st.size) sp.push(`font-size:${st.size}pt`);
        if(st.color) sp.push(`color:${st.color}`);
        return sp.join(';');
      }
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
          const d=decl(segs[i].st);
          leading += `<span${d?` style="${d}"`:''}>${renderText(segs[i].text)}</span>`;
        } else {
          // after a tab: position per the corresponding stop
          const sp=stopPx[Math.min(tt-1, stopPx.length-1)];
          let posPx, align;
          if(sp.val==='right'){ posPx=sp.pos; align='right'; }
          else if(sp.val==='center'){ posPx=sp.pos; align='center'; }
          else { posPx=sp.pos; align='left'; }
          const d=decl(segs[i].st);
          let anchorStyle;
          if(align==='right'){
            anchorStyle=`position:absolute;right:${Math.max(0,contentW-posPx)}px;${d}`;
          } else if(align==='center'){
            anchorStyle=`position:absolute;left:${posPx}px;transform:translateX(-50%);${d}`;
          } else {
            anchorStyle=`position:absolute;left:${posPx}px;${d}`;
          }
          segsHtml += `<span style="${anchorStyle}">${renderText(segs[i].text)}</span>`;
        }
      }
      if(leading) segsHtml = leading + segsHtml;
      row += segsHtml + '</div>';
      inner = (numPrefix?`<span>${numPrefix}</span> `:'') + row;
    } else {
      // plain (no tabs): render runs inline, with number prefix
      for(const tr of textRuns){
        const styleParts=[];
        styleParts.push(`font-family:'${mapFont(tr.st.font)}',Arial,sans-serif`);
        if(tr.st.bold) styleParts.push('font-weight:700');
        if(tr.st.italic) styleParts.push('font-style:italic');
        if(tr.st.size) styleParts.push(`font-size:${tr.st.size}pt`);
        if(tr.st.color) styleParts.push(`color:${tr.st.color}`);
        const styleAttr = styleParts.length ? ` style="${styleParts.join(';')}"` : '';
        inner += `<span${styleAttr}>${renderText(tr.txt)}</span>`;
      }
      if(numPrefix) inner = `<span>${numPrefix}</span> ` + inner;
    }
    // drawings survive the tabs-branch reassignment; merge them back in
    inner += drawingsHtml;
    const hasText = inner.replace(/<[^>]+>/g,'').trim().length>0 || inner.indexOf('<img')>=0 || inner.indexOf('<div')>=0;
    // paragraph style
    let align = pp.align || 'left';
    // Effective paragraph font-size: first non-empty run size, else paragraph-
    // mark rPr (pPr/rPr), else style/default. Setting it on the <p> ensures
    // unitless line-height multiplies the actual text size (8pt) rather than
    // the inherited body size (11pt) -> no overflow.
    const pmarkRPr = pPrEl ? firstNS(pPrEl,'rPr') : null;
    let pmarkSz=null, pmarkFont=null;
    if(pmarkRPr){
      const psz=firstNS(pmarkRPr,'sz'); if(psz) pmarkSz=parseInt(attrNS(psz,'val'),10)/2;
      const prf=firstNS(pmarkRPr,'rFonts'); if(prf) pmarkFont=(attrNS(prf,'ascii')||attrNS(prf,'hAnsi')||null);
    }
    const effSize = (textRuns.find(t=>t.st.size)||{st:{}}).st.size || pmarkSz || (styleObj&&styleObj.sz) || stylesMap.defaultR.sz || 11;
    const effFont = (textRuns.find(t=>t.st.font)||{st:{}}).st.font || pmarkFont || (styleObj&&styleObj.font) || stylesMap.defaultR.font;
    // Empty paragraph: keep it as a spacer so Word's inter-row gaps survive
    // (signature blocks, blank lines between paragraphs). It keeps its own
    // line-height so the gap matches the source.
    if(!hasText){
      const lh = pp.line ? ((pp.lineRule==='exact'||pp.lineRule==='atLeast')? `line-height:${twipToPx(pp.line)}px` : `line-height:${Math.round((pp.line/240)*1.2*100)/100}`) : 'line-height:1.2';
      return `<p style="text-align:${align};font-size:${effSize}pt;font-family:'${mapFont(effFont)}',Arial,sans-serif;${lh};margin:0">&nbsp;</p>`;
    }
    pStyleParts=[`text-align:${align}`, `font-size:${effSize}pt`, `font-family:'${mapFont(effFont)}',Arial,sans-serif`];
    // Inside a table cell, suppress paragraph spacing (spacingBefore/After):
    // DOCX cell paragraphs carry spacing that would inflate table height and
    // shift subsequent content, throwing off page breaks. Cell padding/borders
    // already separate rows, so the spacing is not needed visually.
    if(pp.spacingBefore && !inCell) pStyleParts.push(`margin-top:${twipToPx(pp.spacingBefore)}px`);
    if(pp.spacingAfter && !inCell) pStyleParts.push(`margin-bottom:${twipToPx(pp.spacingAfter)}px`);
    if(pp.line){
      if(pp.lineRule==='exact'||pp.lineRule==='atLeast'){
        pStyleParts.push(`line-height:${twipToPx(pp.line)}px`);
      } else {
        // lineRule=auto: w:line=240 means single spacing. Word's single line
        // height is the font's natural line height (~1.2em), NOT 1em, so a
        // plain line/240 would compress text vs Word. Scale by a natural factor.
        pStyleParts.push(`line-height:${Math.round((pp.line/240)*1.2*100)/100}`);
      }
    } else {
      pStyleParts.push('line-height:1.2');
    }
    if(pp.indLeft) pStyleParts.push(`padding-left:${twipToPx(pp.indLeft)}px`);
    if(pp.indFirstLine) pStyleParts.push(`text-indent:${twipToPx(pp.indFirstLine)}px`);
    // Anchored drawings (header logo / text box) are position:absolute and float
    // OVER the body text, exactly as in Word (allowOverlap, transparent): they
    // must NOT reserve flow height, otherwise the whole body (and signatures)
    // shifts down and the document spills onto a second page. maxDrawingH is
    // kept only for the drawingsHtml merge above.
    // Do NOT append ";margin:0" here: it is a shorthand that would override the
    // margin-top/margin-bottom values added above from spacingBefore/spacingAfter,
    // collapsing paragraph spacing and throwing off pagination. The base p margin
    // is already 0 via the global stylesheet (p{margin:0}).
    return `<p style="${pStyleParts.join(';')}">${inner}</p>`;
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
    // borders from tblPr/tblBorders (val, sz, color), with table-style borders
    // (tblStyle -> stylesMap.styles[id].tblBorders) as the base; direct tblBorders
    // on the table override the style. This matches Word, where a table style
    // supplies borders and direct formatting takes precedence.
    const tblPr=firstNS(tblEl,'tblPr');
    function normEdge(e){
      const val=e && e.val;
      if(!val || val==='none') return 'none';
      const sz=e && e.sz;
      const color=normColor(e && e.color) || '#000';
      return `${(sz?parseInt(sz,10)/8:1)}px solid ${color}`;
    }
    let borders={top:'none',left:'none',bottom:'none',right:'none',insideH:'none',insideV:'none'};
    if(tblPr){
      // 1) base from table style
      const ts=firstNS(tblPr,'tblStyle');
      if(ts){
        const sid=attrNS(ts,'val');
        const st=stylesMap.styles[sid];
        if(st && st.tblBorders){
          for(const edge of ['top','left','bottom','right','insideH','insideV']){
            if(st.tblBorders[edge]) borders[edge]=normEdge({val:st.tblBorders[edge].val,sz:st.tblBorders[edge].sz,color:st.tblBorders[edge].color});
          }
        }
      }
      // 2) direct tblBorders override the style
      const b=firstNS(tblPr,'tblBorders');
      if(b){
        for(const edge of ['top','left','bottom','right','insideH','insideV']){
          const el=firstNS(b,edge);
          if(el) borders[edge]=normEdge({val:attrNS(el,'val'),sz:attrNS(el,'sz'),color:attrNS(el,'color')});
        }
      }
    }
    const borderCSS=`border-top:${borders.top};border-left:${borders.left};border-bottom:${borders.bottom};border-right:${borders.right};`;
    // table width
    let tableW='100%';
    if(colW.length && colW.every(w=>w>0)){
      const tw=colW.reduce((a,b)=>a+b,0);
      if(tw>0) tableW=`${twipToPx(tw)}px`;
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
        let cellB='none';     // per-cell borders (tcBorders override tblBorders)
        if(tcPr){
          const tcw=firstNS(tcPr,'tcW');
          if(tcw){
            const w=attrNS(tcw,'w'); const type=attrNS(tcw,'type');
            if(w && (type==='dxa'||!type)) wpx=twipToPx(parseInt(w,10));
          }
        }
        if(wpx==null && colW[ci]) wpx=twipToPx(colW[ci]);
        // per-cell borders: tcBorders (top/left/bottom/right) override table borders
        let cTop=borders.top, cLeft=borders.left, cBottom=borders.bottom, cRight=borders.right;
        if(tcPr){
          const tcB=firstNS(tcPr,'tcBorders');
          if(tcB){
            const setEdge=(edge,css)=>{
              const el=firstNS(tcB,edge);
              if(!el) return;
              const val=attrNS(el,'val');
              const sz=attrNS(el,'sz');
              const color=normColor(attrNS(el,'color')) || '#000';
              if(val && val!=='none'){
                const s=(sz?parseInt(sz,10)/8:1)+'px';
                css(`${s} solid ${color}`);
              } else {
                css('none');
              }
            };
            setEdge('top',v=>cTop=v);
            setEdge('left',v=>cLeft=v);
            setEdge('bottom',v=>cBottom=v);
            setEdge('right',v=>cRight=v);
          }
        }
        const cellBorderCSS2=`border-top:${cTop};border-left:${cLeft};border-bottom:${cBottom};border-right:${cRight};`;
        const wStyle = wpx?`width:${wpx}px;`:'';
        let cellInner='';
        for(const p of byNS(tc,'p')){
          const ppHtml=buildParagraph(p, true);
          if(ppHtml) cellInner += ppHtml;
        }
        cellsHtml += `<td style="${wStyle}${cellBorderCSS2}vertical-align:top;">${cellInner}</td>`;
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
    const kids=Array.from(body.children).filter(c=>c.namespaceURI===NS && (c.localName==='p'||c.localName==='tbl'));
    // Effective font size (pt) of a paragraph: first run w:sz, else pPr/rPr sz, else 11.
    function pSize(pEl){ let sz=11; const fr=firstNS(pEl,'r'); if(fr){ const rPr=firstNS(fr,'rPr'); if(rPr){ const s=firstNS(rPr,'sz'); if(s){ sz=parseInt(attrNS(s,'val'),10)/2; } } } const pPr=firstNS(pEl,'pPr'); if(sz===11 && pPr){ const mr=firstNS(pPr,'rPr'); if(mr){ const s=firstNS(mr,'sz'); if(s){ sz=parseInt(attrNS(s,'val'),10)/2; } } } return sz; }
    function pText(pEl){ return byNS(pEl,'t').filter(t=>!isInsideTextbox(t,pEl) && !isInsideFallback(t,pEl)).map(t=>t.textContent).join('').trim(); }
    const LARGE_INDENT_PX=200;      // a paragraph indented >=200px is a right-column field
    const TWIPS_PER_PX=1440/96;
    let firstNonEmpty=true;
    for(let i=0;i<kids.length;i++){
      const child=kids[i];
      if(child.localName==='p'){
        let phtml=buildParagraph(child);
        // Align the first non-empty un-indented paragraph (a left-column label
        // like "Исх. № / От") with the following right-column field (a
        // paragraph with a large left indent, e.g. "Кому ..."). Push the label
        // block down by (its line count) line-heights so its top line lines up
        // with the indented field's top line.
        if(firstNonEmpty && pText(child)){
          firstNonEmpty=false;
          const ilPx=(readParaProps(child).indLeft||0)/TWIPS_PER_PX;
          if(ilPx < LARGE_INDENT_PX){
            let cnt=0, found=false;
            for(let j=i+1;j<kids.length;j++){
              const c2=kids[j];
              if(c2.localName==='tbl') break;
              if(c2.localName==='p'){
                if(pText(c2)){
                  const il2=(readParaProps(c2).indLeft||0)/TWIPS_PER_PX;
                  if(il2>=LARGE_INDENT_PX){ found=true; break; } else cnt++;
                }
              }
            }
            if(found){
              const lh=pSize(child)*4/3*1.2;   // one line-height in px (single spacing)
              const mtPx=Math.round((cnt+1)*lh);
              if(mtPx>0) phtml=`<div style="margin-top:${mtPx}px">${phtml}</div>`;
            }
          }
        }
        htmlBody += phtml;
      } else if(child.localName==='tbl'){
        htmlBody += buildTable(child);
      }
    }
  }

  // --- render footnote texts at bottom of page (after body content) ---
  const escFoot = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let footnotesHtml='';
  if(footnotes && Object.keys(footnotes).length){
    footnotesHtml = `<div style="margin-top:6px;border-top:0.5pt solid #999;padding-top:6px;">`;
    const sortedIds=Object.keys(footnotes).map(Number).sort((a,b)=>a-b);
    for(const id of sortedIds){
      footnotesHtml += `<p style="font-family:'Carlito',Arial,sans-serif;font-size:8pt;line-height:1.2;margin:0 0 4px 0;"><span style="font-weight:700">[${id}]</span> ${escFoot(footnotes[id])}</p>`;
    }
    footnotesHtml += `</div>`;
  }

  // assemble full HTML with page container
  const fontSize = 11; // default body pt
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;}
    body{font-family:'PT Sans',Arial,Helvetica,sans-serif;font-size:${fontSize}pt;color:#000;background:#fff;}
    .docpage{width:${pageWPx}px;min-height:${pageHPx}px;box-sizing:border-box;padding:${mt}px ${mr}px ${mb}px ${ml}px;overflow:hidden;display:flex;flex-direction:column;position:relative;}
    .docpage>.docbody{flex:0 1 auto;}
    .docpage>.docfoot{flex:0 0 auto;margin-top:auto;}
    p{margin:0;}
  </style></head><body><div class="docpage"><div class="docbody">${htmlBody}</div>${footnotesHtml?`<div class="docfoot">${footnotesHtml}</div>`:''}</div></body></html>`;
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
  // Paginate on block boundaries. A fixed-interval slice cut paragraphs and
  // tables in half at every page edge (tables split, signature blocks severed,
  // text "walking" across the break). Instead, measure each top-level block and
  // start a new page at a block boundary so no block is ever cut.
  const SCALE=2; // html2canvas scale
  // Page margins (.docpage padding-top / padding-bottom) in canvas px. Page 1
  // already carries the top margin band at the top of the canvas; continuation
  // pages must reproduce BOTH the top and bottom margin bands, otherwise
  // content overflows into the bottom margin and the next page's content bleeds
  // up into the previous page (mixed text / tables and paragraphs breaking at
  // the wrong spot). The usable content region per page is the A4 height minus
  // both vertical margins.
  const docpageEl=box.querySelector('.docpage');
  const cs=docpageEl?getComputedStyle(docpageEl):null;
  const topPadCss=cs?(parseFloat(cs.paddingTop)||0):0;
  const botPadCss=cs?(parseFloat(cs.paddingBottom)||0):0;
  const topPadPx=topPadCss*SCALE;
  const botPadPx=botPadCss*SCALE;
  const contentH=Math.max(1, pageHPx-topPadPx-botPadPx);
  const bodyEl=box.querySelector('.docbody');
  const footEl=box.querySelector('.docfoot');
  const blockEls=[];
  if(bodyEl){ blockEls.push.apply(blockEls, Array.from(bodyEl.children)); }
  if(footEl){ blockEls.push(footEl); }
  const boxRect=box.getBoundingClientRect();
  const blocks=blockEls.map(el=>{
    const r=el.getBoundingClientRect();
    return { top:(r.top-boxRect.top)*SCALE, height:r.height*SCALE };
  }).filter(b=>b.height>0).sort((a,b)=>a.top-b.top);
  // Page start positions (canvas y). A new page starts at a block whose bottom
  // would cross the current page's bottom edge. Page 1's region ends at the
  // bottom margin; continuation pages carry a top-margin band and end at the
  // bottom margin, so their usable height is contentH.
  const pageStarts=[0];
  // Page 1's content region ends at (pageHPx - bottom margin); continuation
  // pages add the top-margin band too, so their region height is contentH.
  let pageBottom=pageHPx-botPadPx;
  for(const b of blocks){
    if(b.top+b.height <= pageBottom){ continue; }
    pageStarts.push(b.top);
    pageBottom=b.top+contentH;
  }
  pageStarts.push(canvas.height);
  const canvases=[];
  for(let i=0;i<pageStarts.length-1;i++){
    const start=pageStarts[i];
    const isFirst=(i===0);
    // Page 1 already carries the top margin band inside the source canvas, so
    // only the bottom margin is subtracted; continuation pages carry both top
    // and bottom margin bands (top drawn as a blank band, bottom left blank).
    const avail=isFirst?(pageHPx-botPadPx):contentH;
    const contentEnd=Math.min(pageStarts[i+1], start+avail, canvas.height);
    if(contentEnd<=start) continue;
    const sliceH=Math.round(pageHPx);
    const slice=document.createElement('canvas');
    slice.width=cw; slice.height=sliceH;
    const ctx=slice.getContext('2d');
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,cw,sliceH);
    const drawH=contentEnd-start;
    const dy=isFirst?0:topPadPx;
    ctx.drawImage(canvas,0,start,cw,drawH,0,dy,cw,drawH);
    canvases.push(slice);
  }
  // Trim a trailing entirely-white page (phantom blank page for docs that fit
  // on whole pages).
  try{
    if(canvases.length>1){
      const last=canvases[canvases.length-1];
      const lctx=last.getContext('2d');
      const ld=lctx.getImageData(0,0,cw,last.height).data;
      let blank=true;
      for(let i=0;i<ld.length;i+=4*7){
        if(ld[i]<250||ld[i+1]<250||ld[i+2]<250){ blank=false; break; }
      }
      if(blank) canvases.pop();
    }
  }catch(e){ /* getImageData unavailable - keep all slices */ }
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
  if(!currentFiles.length) return;
  hideError(); resultBox.hidden=true; convertBtn.disabled=true;
  const to = toFmt;
  const total = currentFiles.length;
  let done = 0, okCount = 0, failCount = 0;
  const results = [];
  try{
    for(let i=0;i<currentFiles.length;i++){
      const file = currentFiles[i];
      const from = detectFmt(file);
      const base = baseOf(file.name);
      setProgress(Math.round(5 + (i/total)*90), `Файл ${i+1} из ${total}: ${file.name}…`);
      try{
        const out = await convertOneFile(file, from, to, base);
        downloadBlob(out.outBlob, out.outName);
        addHistory(file.name, from, to, out.outBlob.size);
        results.push(out);
        okCount++;
      }catch(err){
        console.error(err);
        failCount++;
        toast(`❌ ${file.name}: ${err.message||'ошибка'}`);
      }
      done++;
    }
    // result summary
    setProgress(100, done===total ? 'Готово!' : 'Завершено с ошибками');
    resultBox.hidden=false;
    resultFile.textContent = (okCount>0 ? `${okCount} файл(ов) конвертировано` : 'Не удалось конвертировать') + (failCount>0 ? `, ${failCount} пропущено` : '');
    // preview: show last successful image result if any
    resultPreview.innerHTML='';
    const lastImg = [...results].reverse().find(r=>r.outBlob.type.startsWith('image/'));
    if(lastImg){ const url=URL.createObjectURL(lastImg.outBlob); resultPreview.innerHTML=`<img src="${url}" alt="preview">`; }
    toast(`✅ Конвертация завершена: ${okCount} из ${total}`);
  }catch(err){
    console.error(err);
    showError(err.message||'Ошибка конвертации. Попробуйте другой файл.');
    setProgress(0,'Ошибка');
  }finally{
    convertBtn.disabled=false;
  }
};

// Convert a single file; returns {outBlob, outName}. Throws on unsupported/errors.
async function convertOneFile(file, from, to, base){
  let outBlob=null, outName='';
  const buf = await fileToArrayBuffer(file);

  // PDF source
  if(from==='pdf'){
    if(to==='jpg'||to==='png'||to==='webp'){
      const blobs=await pdfToImages(buf,to);
      if(blobs.length===1){ outBlob=blobs[0]; outName=`${base}.${to}`; }
      else{ const zip=new JSZip(); blobs.forEach((b,i)=>zip.file(`page-${i+1}.${to}`,b)); outBlob=await zip.generateAsync({type:'blob'}); outName=`${base}-pages.zip`; }
    } else if(to==='txt'){ const t=await pdfToText(buf); outBlob=new Blob([t],{type:'text/plain;charset:utf-8'}); outName=`${base}.txt`; }
    else if(to==='docx'){ const t=await pdfToText(buf); outBlob=await textToDocx(t); outName=`${base}.docx`; }
    else if(to==='html'){ const t=await pdfToText(buf); outBlob=new Blob([`<html><body><pre>${t.replace(/</g,'&lt;')}</pre></body></html>`],{type:'text/html'}); outName=`${base}.html`; }
    else if(to==='pdf'){ outBlob=new Blob([buf],{type:'application/pdf'}); outName=`${base}.pdf`; }
    else throw new Error(`Конвертация PDF → ${to.toUpperCase()} не поддерживается`);
  }
  // Image source
  else if(['jpg','png','webp'].includes(from)){
    if(to==='pdf'){ outBlob=await imageToPdf(file); outName=`${base}.pdf`; }
    else if(['jpg','png','webp'].includes(to)){ outBlob=await imageToImage(file,to); outName=`${base}.${to}`; }
    else throw new Error(`Конвертация ${from.toUpperCase()} → ${to.toUpperCase()} не поддерживается`);
  }
  // DOCX source
  else if(from==='docx'||from==='doc'){
    if(to==='pdf'){ const html=await docxToHtml(buf); outBlob=await docxToPdf(html); outName=`${base}.pdf`; }
    else if(to==='txt'){ const t=await docxToText(buf); outBlob=new Blob([t],{type:'text/plain;charset:utf-8'}); outName=`${base}.txt`; }
    else if(to==='html'){ const html=await docxToHtml(buf); outBlob=new Blob([html],{type:'text/html'}); outName=`${base}.html`; }
    else if(to==='jpg'||to==='png'){ const html=await docxToHtml(buf); const blobs=await docxToImages(html,to); if(blobs.length===1){ outBlob=blobs[0]; outName=`${base}.${to}`; } else { const zip=new JSZip(); blobs.forEach((b,i)=>zip.file(`page-${i+1}.${to}`,b)); outBlob=await zip.generateAsync({type:'blob'}); outName=`${base}-pages.zip`; } }
    else throw new Error(`Конвертация DOCX → ${to.toUpperCase()} не поддерживается`);
  }
  // XLSX / CSV source
  else if(from==='xlsx'||from==='xls'||from==='csv'){
    const wb=await xlsxRead(buf);
    if(to==='pdf'){ const ws=wb.Sheets[wb.SheetNames[0]]; const html=XLSX.utils.sheet_to_html(ws); outBlob=await htmlToPdf(html); outName=`${base}.pdf`; }
    else if(to==='csv'){ const ws=wb.Sheets[wb.SheetNames[0]]; const csv=XLSX.utils.sheet_to_csv(ws); outBlob=new Blob([csv],{type:'text/csv;charset:utf-8'}); outName=`${base}.csv`; }
    else if(to==='json'){ const ws=wb.Sheets[wb.SheetNames[0]]; const json=XLSX.utils.sheet_to_json(ws,{header:1}); outBlob=new Blob([JSON.stringify(json,null,2)],{type:'application/json'}); outName=`${base}.json`; }
    else if(to==='xlsx'){ XLSX.writeFile(wb, `${base}.xlsx`); outBlob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}); outName=`${base}.xlsx`; }
    else if(to==='html'){ const ws=wb.Sheets[wb.SheetNames[0]]; const html=XLSX.utils.sheet_to_html(ws); outBlob=new Blob([html],{type:'text/html'}); outName=`${base}.html`; }
    else if(to==='txt'){ const ws=wb.Sheets[wb.SheetNames[0]]; const csv=XLSX.utils.sheet_to_csv(ws); outBlob=new Blob([csv],{type:'text/plain;charset:utf-8'}); outName=`${base}.txt`; }
    else if(to==='jpg'||to==='png'){ const ws=wb.Sheets[wb.SheetNames[0]]; const html=XLSX.utils.sheet_to_html(ws); const box=$('hiddenRender'); box.innerHTML=html; const c=await html2canvas(box,{scale:2}); outBlob=await canvasToBlob(c, to==='png'?'image/png':'image/jpeg', .92); outName=`${base}.${to}`; }
    else throw new Error(`Конвертация таблицы → ${to.toUpperCase()} не поддерживается`);
  }
  // TXT source
  else if(from==='txt'||from==='md'||from==='rtf'){
    let text=await fileToText(file);
    if(from==='rtf') text=await rtfToText(text);
    if(to==='pdf'){ outBlob=await textToPdf(text); outName=`${base}.pdf`; }
    else if(to==='docx'){ outBlob=await textToDocx(text); outName=`${base}.docx`; }
    else if(to==='html'){ const html = from==='md' ? marked.parse(text) : `<pre>${text.replace(/</g,'&lt;')}</pre>`; outBlob=new Blob([html],{type:'text/html'}); outName=`${base}.html`; }
    else if(to==='txt'){ outBlob=new Blob([text],{type:'text/plain;charset:utf-8'}); outName=`${base}.txt`; }
    else if(to==='jpg'||to==='png'){ const box=$('hiddenRender'); box.innerHTML=`<pre style="white-space:pre-wrap;font-family:Arial">${text.replace(/</g,'&lt;')}</pre>`; const c=await html2canvas(box,{scale:2}); outBlob=await canvasToBlob(c, to==='png'?'image/png':'image/jpeg', .92); outName=`${base}.${to}`; }
    else throw new Error(`Конвертация текста → ${to.toUpperCase()} не поддерживается`);
  }
  // HTML source
  else if(from==='html'||from==='htm'){
    const html=await fileToText(file);
    if(to==='pdf'){ outBlob=await htmlToPdf(html); outName=`${base}.pdf`; }
    else if(to==='txt'){ const div=document.createElement('div'); div.innerHTML=html; outBlob=new Blob([div.innerText],{type:'text/plain;charset:utf-8'}); outName=`${base}.txt`; }
    else if(to==='docx'){ const div=document.createElement('div'); div.innerHTML=html; outBlob=await textToDocx(div.innerText); outName=`${base}.docx`; }
    else if(to==='jpg'||to==='png'){ const box=$('hiddenRender'); box.innerHTML=html; const c=await html2canvas(box,{scale:2}); outBlob=await canvasToBlob(c, to==='png'?'image/png':'image/jpeg', .92); outName=`${base}.${to}`; }
    else throw new Error(`Конвертация HTML → ${to.toUpperCase()} не поддерживается`);
  }
  // PPTX source
  else if(from==='pptx'||from==='ppt'){
    const t=await pptxToText(buf);
    if(to==='txt'){ outBlob=new Blob([t],{type:'text/plain;charset:utf-8'}); outName=`${base}.txt`; }
    else if(to==='pdf'){ outBlob=await textToPdf(t); outName=`${base}.pdf`; }
    else if(to==='docx'){ outBlob=await textToDocx(t); outName=`${base}.docx`; }
    else if(to==='jpg'||to==='png'){ const box=$('hiddenRender'); box.innerHTML=`<pre style="white-space:pre-wrap;font-family:Arial">${t.replace(/</g,'&lt;')}</pre>`; const c=await html2canvas(box,{scale:2}); outBlob=await canvasToBlob(c, to==='png'?'image/png':'image/jpeg', .92); outName=`${base}.${to}`; }
    else throw new Error(`Конвертация PPTX → ${to.toUpperCase()} не поддерживается`);
  }
  else if(from==='json'){
    const text=await fileToText(file);
    if(to==='pdf'){ outBlob=await textToPdf(text); outName=`${base}.pdf`; }
    else if(to==='txt'){ outBlob=new Blob([text],{type:'text/plain;charset:utf-8'}); outName=`${base}.txt`; }
    else throw new Error(`Конвертация JSON → ${to.toUpperCase()} не поддерживается`);
  }
  else {
    throw new Error(`Формат .${from} пока не поддерживается. Попробуйте PDF, DOCX, XLSX, JPG, PNG, TXT, HTML, CSV, PPTX.`);
  }
  if(!outBlob) throw new Error('Не удалось выполнить конвертацию');
  return {outBlob, outName};
}
