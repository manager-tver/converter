// ConvertLab — client-side converter
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const { jsPDF } = window.jspdf;

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
async function docxToHtml(arrayBuffer){
  const res=await mammoth.convertToHtml({arrayBuffer});
  return res.value;
}
// --- PT Sans (Cyrillic) font registration for jsPDF ---
let pdfFontsReady=false;
// registerFonts must be called on a jsPDF document instance
function registerFonts(doc){
  if(pdfFontsReady) return;
  const fam = window.__pdfFonts && window.__pdfFonts.PTSans;
  if(!fam){ throw new Error('Кириллический шрифт не найден'); }
  const defs={
    normal: fam.normal, bold: fam.bold, italic: fam.italic, bolditalic: fam.bolditalic
  };
  for(const style of Object.keys(defs)){
    const vfsName = 'PTSans-'+style+'.ttf';
    // addFileToVFS and addFont are instance methods in jsPDF 2.5.x
    doc.addFileToVFS(vfsName, defs[style]);
    doc.addFont(vfsName, 'PTSans', style);
  }
  pdfFontsReady=true;
}

// Parse Mammoth HTML into a list of blocks: {text, bold, italic} runs separated by paragraph breaks.
function htmlToBlocks(html){
  const div=document.createElement('div'); div.innerHTML=html;
  const blocks=[];
  function walk(node){
    node.childNodes.forEach(ch=>{
      if(ch.nodeType===3){ // text node
        const t=ch.textContent;
        if(t && t.trim()!==''){
          blocks.push({text:t, bold:false, italic:false});
        }
      } else if(ch.nodeType===1){ // element
        const tag=ch.tagName.toLowerCase();
        let bold=false, italic=false;
        if(tag==='b'||tag==='strong') bold=true;
        if(tag==='i'||tag==='em') italic=true;
        if(ch.childNodes.length===0){
          const t=(ch.textContent||'').trim();
          if(t) blocks.push({text:t, bold, italic});
        } else {
          walkWithStyle(ch, bold, italic);
        }
        if(tag==='p'||tag==='div'||tag==='h1'||tag==='h2'||tag==='h3'||tag==='li'){
          blocks.push({paragraph:true});
        }
      }
    });
  }
  function walkWithStyle(node, bold, italic){
    node.childNodes.forEach(ch=>{
      if(ch.nodeType===3){
        const t=ch.textContent;
        if(t && t.trim()!==''){ blocks.push({text:t, bold, italic}); }
      } else if(ch.nodeType===1){
        const tag=ch.tagName.toLowerCase();
        let b=bold, i=italic;
        if(tag==='b'||tag==='strong') b=true;
        if(tag==='i'||tag==='em') i=true;
        if(ch.childNodes.length===0){
          const t=(ch.textContent||'').trim();
          if(t) blocks.push({text:t, bold:b, italic:i});
        } else {
          walkWithStyle(ch,b,i);
        }
        if(tag==='p'||tag==='div'||tag==='h1'||tag==='h2'||tag==='h3'||tag==='li'){
          blocks.push({paragraph:true});
        }
      }
    });
  }
  walk(div);
  return blocks;
}

// Render DOCX content to a real-text PDF using embedded Cyrillic font
async function docxToPdf(html){
  const { jsPDF } = window.jspdf;
  const doc=new jsPDF({unit:'pt', format:'a4'});
  registerFonts(doc);
  const pageW=doc.internal.pageSize.getWidth();
  const margin=46; // ~1.6cm
  const usableW=pageW-2*margin;
  const fontSize=11;
  doc.setFont('PTSans','normal'); doc.setFontSize(fontSize);

  const blocks=htmlToBlocks(html);
  let x=margin, y=margin+fontSize;
  let lineH=fontSize*1.5;

  function newLine(gap){
    if(y+gap>doc.internal.pageSize.getHeight()-margin){
      doc.addPage(); y=margin+fontSize;
    } else {
      y+=gap;
    }
  }

  for(const b of blocks){
    if(b.paragraph){ newLine(lineH); continue; }
    const style = (b.bold?'bold':'')+(b.italic?'italic':'');
    const text=b.text.replace(/\s+/g,' ').trim();
    if(!text) continue;
    doc.setFont('PTSans', style||'normal');
    const lines=doc.splitTextToSize(text, usableW);
    for(const line of lines){
      if(y>doc.internal.pageSize.getHeight()-margin){
        doc.addPage(); y=margin+fontSize;
        doc.setFont('PTSans', style||'normal');
      }
      doc.text(line, x, y);
      y+=lineH;
    }
  }
  return doc.output('blob');
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
      else if(to==='jpg'||to==='png'){ const html=await docxToHtml(buf); const box=$('hiddenRender'); box.innerHTML=html; const c=await html2canvas(box,{scale:2}); outBlob=await canvasToBlob(c, to==='png'?'image/png':'image/jpeg', .92); outName=`${base}.${to}`; }
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
