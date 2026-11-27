/* Standalone SVG and multipage PDF exporters for the drawing sheet. */
(function (root) {
  'use strict';
  function exportSheet(sheet,width,height) {
    const copy=sheet.cloneNode(true);
    copy.setAttribute('width',width);copy.setAttribute('height',height);
    for(const node of copy.querySelectorAll('.draft-view-hit,.draft-drag-target,.draft-note-target,.draft-temporary'))node.remove();
    for(const node of copy.querySelectorAll('[tabindex]')){node.removeAttribute('tabindex');node.removeAttribute('role');}
    return new Blob([new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml'});
  }
  function download(blob,name){
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download=name;
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),3000);
  }
  function save(view) {
    const {scene,pageIndex}=view,source=pageIndex?view.pages[pageIndex-1].page:view.sheet;
    download(exportSheet(source,scene.width+'mm',scene.height+'mm'),
      `Чертёж-${scene.settings.format}${pageIndex?'-'+(pageIndex+1):''}.svg`);
  }
  async function renderPDFImage(source,width,height){
    const canvas=document.createElement('canvas');
    canvas.width=width;
    canvas.height=height;
    const url=URL.createObjectURL(source);
    try{
      const img=new Image();img.src=url;
      await img.decode();
      const context=canvas.getContext('2d',{alpha:false});
      if(!context)throw new Error('Не удалось подготовить страницу.');
      context.drawImage(img,0,0,canvas.width,canvas.height);
      const data=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));
      if(!data)throw new Error('Не удалось сохранить страницу.');
      return {data,width:canvas.width,height:canvas.height};
    }finally{URL.revokeObjectURL(url);canvas.width=canvas.height=0;}
  }
  function buildPDF(images,width,height){
    const parts=[],offsets=[0],encoder=new TextEncoder();
    let length=0;
    function append(input){
      const bytes=typeof input==='string'?encoder.encode(input):input;
      parts.push(bytes);length+=bytes.size??bytes.byteLength;
    }
    function object(id,...data){
      offsets[id]=length;append(`${id} 0 obj\n`);
      data.forEach(append);append('\nendobj\n');
    }
    append('%PDF-1.4\n');
    object(1,'<< /Type /Catalog /Pages 2 0 R >>');
    const refs=images.map((_,i)=>`${3+i*3} 0 R`).join(' ');
    object(2,`<< /Type /Pages /Count ${images.length} /Kids [ ${refs} ] >>`);
    const [w,h]=[width,height].map(mm=>(mm*72/25.4).toFixed(5));
    images.forEach((image,i)=>{
      const id=3+i*3,commands=`q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;
      object(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}]\n`+
        `/Resources << /XObject << /Im0 ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`);
      object(id+1,`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} `+
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.size} >>\nstream\n`,
        image.data,'\nendstream');
      object(id+2,`<< /Length ${commands.length} >>\nstream\n`,commands,'endstream');
    });
    const xref=length;
    append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
    offsets.slice(1).forEach(offset=>append(`${String(offset).padStart(10,'0')} 00000 n \n`));
    append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts,{type:'application/pdf'});
  }

  async function exportPDF(pages,width,height,signal){
    const pixelsPerMillimetre=200/25.4;
    const pixelWidth=Math.round(width*pixelsPerMillimetre);
    const pixelHeight=Math.round(height*pixelsPerMillimetre);
    // Snapshot each page before decoding the images, so concurrent edits cannot mix revisions.
    const sources=pages.map(page=>exportSheet(page,pixelWidth,pixelHeight));
    const images=[];
    for(const source of sources){
      if(signal.aborted)return null;
      images.push(await renderPDFImage(source,pixelWidth,pixelHeight));
    }
    return signal.aborted?null:buildPDF(images,width,height);
  }
  const api=Object.freeze({save,download,exportPDF,buildPDF});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.LabDrawingSheetExport=api;
})(typeof window==='undefined'?globalThis:window);
