/* Reference photo, live symmetry and a magnified view of the same SVG sheet. */
(() => {
  'use strict';
  const app = window.LabApp;
  const paper = document.getElementById('paper');
  const wrap = document.getElementById('paper-wrap');
  const ns = 'http://www.w3.org/2000/svg';
  const byId = id => document.getElementById(id);
  function svg(tag, attrs) {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, value);
    return el;
  }
  const photo = svg('image', {id:'sketch-reference', 'pointer-events':'none', preserveAspectRatio:'none'});
  paper.insertBefore(photo, byId('grid-layer'));
  const axes = svg('g', {id:'sketch-mirror-guide', 'pointer-events':'none'});
  paper.insertBefore(axes, byId('cad-edit-layer'));
  const markers = svg('g', {id:'sketch-picked-points', 'pointer-events':'none'});
  paper.append(markers);
  const card = document.createElement('section');
  card.id = 'sketch-extra-card'; card.className = 'glass'; card.hidden = true;
  card.setAttribute('role', 'dialog');card.setAttribute('aria-label', 'Параметры чертежа');
  document.body.append(card);
  const photoInput = document.createElement('input');
  photoInput.id = 'sketch-photo-input';photoInput.type = 'file';photoInput.accept = 'image/png,image/jpeg,image/webp';photoInput.hidden = true;
  document.body.append(photoInput);
  const lens = document.createElement('div');lens.id = 'sketch-loupe';lens.hidden = true;lens.setAttribute('aria-hidden','true');
  const lensSvg = svg('svg', {width:'100%', height:'100%'});
  const lensGroup = svg('g');
  // Referencing live drawing groups keeps the lens in sync without making a second copy of the sketch.
  for (const id of ['paper-background','sketch-reference','grid-layer','profile-layer','drawing-layer','draft-layer','contour-layer','smart-guides','sketch-mirror-guide','cad-edit-layer','sketch-picked-points']) lensGroup.append(svg('use',{href:`#${id}`}));
  lensSvg.append(lensGroup);lens.append(lensSvg);document.body.append(lens);
  let mode = '', points = [], active = '', loupeEnabled = true, tracking = null, lastTouch = null;
  let temporaryPhoto = null, importToken = 0;
  let drawingSettings = app.getSketchSettings();
  try { loupeEnabled = localStorage.getItem('drawing-lab-loupe') !== 'off'; } catch {}
  function toPaper(event) {
    const point = new DOMPoint(event.clientX,event.clientY).matrixTransform(paper.getScreenCTM().inverse());
    return {x:point.x,y:point.y};
  }
  function drawReference() {
    const settings = app.getSketchSettings();
    const tracing = temporaryPhoto || settings.tracing;
    if (!tracing) {photo.removeAttribute('href');photo.setAttribute('display','none');}
    else {
      if (photo.getAttribute('href') !== tracing.image) photo.setAttribute('href',tracing.image);
      for (const key of ['x','y','width','height','opacity']) photo.setAttribute(key,tracing[key]);
      photo.setAttribute('display',tracing.visible ? 'inline' : 'none');
    }
    axes.replaceChildren();
    const axis = settings.mirrorAxis;
    if (!axis) return;
    const dx=axis.b.x-axis.a.x, dy=axis.b.y-axis.a.y, reach=5000/Math.hypot(dx,dy);
    axes.append(svg('line',{x1:axis.a.x-dx*reach,y1:axis.a.y-dy*reach,x2:axis.a.x+dx*reach,y2:axis.a.y+dy*reach,stroke:'#6788a5','stroke-width':1,'stroke-dasharray':'7 5 2 5','vector-effect':'non-scaling-stroke'}));
    const r = 3.5 / (paper.getScreenCTM()?.a || 1);
    axes.append(svg('circle',{cx:axis.a.x,cy:axis.a.y,r,fill:'#789ab8'}));
  }
  function drawMarkers(hover) {
    markers.replaceChildren();
    const r=5/paper.getScreenCTM().a;
    const last=points[1]||hover;
    if (points.length && last) markers.append(svg('line',{x1:points[0].x,y1:points[0].y,x2:last.x,y2:last.y,stroke:'#466f93','stroke-dasharray':'5 4','stroke-width':1.4,'vector-effect':'non-scaling-stroke'}));
    for (const p of points) markers.append(svg('circle',{cx:p.x,cy:p.y,r,fill:'white',stroke:'#466f93','stroke-width':1.8,'vector-effect':'non-scaling-stroke'}));
  }
  function close() {
    importToken++;
    active='';mode='';points=[];temporaryPhoto=null;card.hidden=true;markers.replaceChildren();drawReference();
  }
  function showCard(title, content) {
    card.innerHTML = `<header><strong>${title}</strong><button id="sketch-extra-close" aria-label="Закрыть">×</button></header>${content}`;
    card.hidden = false;byId('sketch-extra-close').onclick = close;
  }
  function beginPick(kind) {
    mode=kind;points=[];drawMarkers();
    showCard(kind==='axis'?'Ось симметрии':'Масштаб фотографии',`<p id="sketch-pick-hint">${kind==='axis'?'Отметьте начало оси на листе.':'Отметьте первую точку известного отрезка на фотографии.'}</p>`);
  }
  function mirror() {
    active='mirror';
    const axis=app.getSketchSettings().mirrorAxis;
    if(!axis){beginPick('axis');return;}
    showCard('Зеркальное построение','<p>Новые фигуры отражаются относительно отмеченной оси.</p><button id="sketch-axis-new">Задать другую ось</button><button id="sketch-axis-off">Завершить построение пар</button>');
    byId('sketch-axis-new').onclick=()=>beginPick('axis');byId('sketch-axis-off').onclick=()=>{app.setSketchSetting('mirrorAxis',null);close();};
  }
  function tracingCard() {
    active='tracing';mode='';points=[];drawMarkers();
    const t=app.getSketchSettings().tracing;
    const actions=t?`<button id="sketch-calibrate">Указать две точки масштаба</button><label>Прозрачность <output id="sketch-opacity-value">${Math.round((1-t.opacity)*100)}%</output><input id="sketch-opacity" type="range" min="0" max="95" step="1" value="${Math.round((1-t.opacity)*100)}"></label><button id="sketch-photo-visibility">${t.visible?'Скрыть фотографию':'Показать фотографию'}</button><button id="sketch-photo-remove">Убрать фотографию</button>`:'';
    showCard('Фотокалька',`<button id="sketch-photo-pick">${t?'Заменить фотографию':'Выбрать фотографию'}</button>${actions}`);
    byId('sketch-photo-pick').onclick=()=>photoInput.click();
    if(!t)return;
    byId('sketch-calibrate').onclick=()=>{if(!t.visible){temporaryPhoto={...t,visible:true};drawReference();}beginPick('scale');};
    const opacity=byId('sketch-opacity');
    opacity.oninput=()=>{temporaryPhoto={...t,opacity:1-Number(opacity.value)/100};byId('sketch-opacity-value').value=`${opacity.value}%`;drawReference();};
    opacity.onchange=()=>{const value={...t,opacity:1-Number(opacity.value)/100};temporaryPhoto=null;app.setSketchSetting('tracing',value);tracingCard();};
    byId('sketch-photo-visibility').onclick=()=>{app.setSketchSetting('tracing',{...t,visible:!t.visible});tracingCard();};
    byId('sketch-photo-remove').onclick=()=>{app.setSketchSetting('tracing',null);close();};
  }
  async function importPhoto(file) {
    if(!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>15*1024*1024)throw new Error('Выберите изображение JPEG, PNG или WebP до 15 МБ.');
    const token=++importToken, url=URL.createObjectURL(file), img=new Image();
    try{
      img.src=url;await img.decode();
      const factor=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
      const raster=document.createElement('canvas');raster.width=Math.max(1,Math.round(img.naturalWidth*factor));raster.height=Math.max(1,Math.round(img.naturalHeight*factor));
      const ctx=raster.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,raster.width,raster.height);ctx.drawImage(img,0,0,raster.width,raster.height);
      let quality=.82,image=raster.toDataURL('image/jpeg',quality);
      while(image.length>1500000 && quality>.31){quality-=.12;image=raster.toDataURL('image/jpeg',quality);}
      if(image.length>1800000)throw new Error('Уменьшите разрешение фотографии.');
      if(token!==importToken||active!=='tracing')return;
      const {width:pageWidth,height:pageHeight}=app.getViewport(),fit=Math.min((pageWidth*.92)/raster.width,(pageHeight*.92)/raster.height);
      const width=raster.width*fit,height=raster.height*fit;
      temporaryPhoto={image,x:(pageWidth-width)/2,y:(pageHeight-height)/2,width,height,opacity:.5,visible:true};
      drawReference();beginPick('scale');
      const keep=document.createElement('button');keep.id='sketch-photo-fit';keep.textContent='Оставить в размере листа';keep.onclick=()=>{app.setSketchSetting('tracing',temporaryPhoto);close();};card.append(keep);
    }finally{URL.revokeObjectURL(url);}
  }
  photoInput.addEventListener('change',async()=>{const file=photoInput.files[0];photoInput.value='';if(!file)return;try{await importPhoto(file);}catch(error){app.toast(error.message);}});
  function scaleForm() {
    mode='measure';
    const distance=Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y);
    showCard('Масштаб фотографии',`<form id="sketch-scale-form"><label>Длина отрезка, мм<input id="sketch-known-length" type="number" step="any" min="0.01" max="10000" value="${Number((distance/4).toFixed(2))}" required></label><button type="submit">Применить масштаб</button></form>`);
    byId('sketch-scale-form').onsubmit=event=>{
      event.preventDefault();const length=Number(byId('sketch-known-length').value);if(!Number.isFinite(length)||length<=0)return;
      const start=points[0],ratio=length*4/distance,t=temporaryPhoto||app.getSketchSettings().tracing;if(!t){close();return;}
      const next={...t,x:start.x+(t.x-start.x)*ratio,y:start.y+(t.y-start.y)*ratio,width:t.width*ratio,height:t.height*ratio,visible:true};
      if(app.setSketchSetting('tracing',next)){close();app.toast(`Масштаб установлен по отрезку ${length.toLocaleString('ru-RU')} мм.`);}
    };
    byId('sketch-known-length').focus({preventScroll:true});byId('sketch-known-length').select();
  }
  function captured(event) {
    if(!['scale','axis'].includes(mode)||!wrap.contains(event.target)||event.button>0)return;
    event.preventDefault();event.stopImmediatePropagation();const p=toPaper(event);
    if(mode==='scale'){
      const t=temporaryPhoto||app.getSketchSettings().tracing;
      if(!t||p.x<t.x||p.y<t.y||p.x>t.x+t.width||p.y>t.y+t.height){app.toast('Отметьте точку внутри фотографии.');return;}
    }
    if(points.length&&Math.hypot(points[0].x-p.x,points[0].y-p.y)<2){app.toast('Разнесите точки дальше друг от друга.');return;}
    points.push(p);drawMarkers();
    if(points.length===1){byId('sketch-pick-hint').textContent=mode==='scale'?'Теперь отметьте второй конец отрезка.':'Отметьте вторую точку оси.';return;}
    if(mode==='axis'){app.setSketchSetting('mirrorAxis',{a:points[0],b:points[1]});close();app.toast('Зеркало включено. Чертите с одной стороны оси.');}else scaleForm();
  }
  function run(which) {
    if(!['mirror','tracing','loupe'].includes(which))return false;
    close();
    const cad=window.LabCAD?.getState();
    if(cad?.task||cad?.operation)window.LabCAD.cancel();
    if(app.isModelOpen())app.setModelOpen(false);
    if(which==='mirror')mirror();else if(which==='tracing')tracingCard();else {
      active='loupe';showCard('Лупа вершины',`<label class="sketch-check"><input id="sketch-loupe-enabled" type="checkbox" ${loupeEnabled?'checked':''}>При удержании вершины пальцем</label>`);
      byId('sketch-loupe-enabled').onchange=event=>{loupeEnabled=event.target.checked;try{localStorage.setItem('drawing-lab-loupe',loupeEnabled?'on':'off');}catch{}close();};
    }
    return true;
  }
  function showLens() {
    if(!tracking||!lastTouch)return;
    const evt=lastTouch,p=toPaper(evt),displayUnits=104/(2.7*paper.getScreenCTM().a);
    lensSvg.setAttribute('viewBox',`${p.x-displayUnits/2} ${p.y-displayUnits/2} ${displayUnits} ${displayUnits}`);
    const offset=document.body.classList.contains('lab-left-hand')?22:-52;
    lens.hidden=false;lens.style.left=`${Math.max(5,Math.min(innerWidth-109,evt.clientX+offset))}px`;
    lens.style.top=`${evt.clientY>=130?evt.clientY-126:Math.min(innerHeight-109,evt.clientY+23)}px`;
  }
  function clearLens(){if(tracking)clearTimeout(tracking.timer);tracking=null;lastTouch=null;lens.hidden=true;}
  document.addEventListener('pointerdown',event=>{
    if(tracking&&tracking.id!==event.pointerId){clearLens();return;}
    captured(event);
    if(!loupeEnabled||!wrap.contains(event.target)||event.pointerType!=='touch'||event.button>0||mode)return;
    const handle=event.target.closest('.cad-edit-handle');if(!handle&&app.getState().tool!=='contour')return;
    lastTouch=event;tracking={id:event.pointerId,timer:setTimeout(showLens,160)};
  },true);
  document.addEventListener('pointermove',event=>{
    if(tracking?.id===event.pointerId){lastTouch=event;if(!lens.hidden)showLens();}
    if(points.length===1&&['axis','scale'].includes(mode)&&wrap.contains(event.target))drawMarkers(toPaper(event));
  },true);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,event=>{if(tracking?.id===event.pointerId)clearLens();},true);
  byId('studio-menu-toggle').addEventListener('click',()=>{if(active){close();clearLens();}});
  window.addEventListener('blur',clearLens);document.addEventListener('keydown',event=>{if(active&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();}},true);
  document.addEventListener('labchange',event=>{
    const {kind,open}=event.detail;
    if(kind==='tool'||kind==='project'||kind==='model'&&open){close();clearLens();}
    if(kind==='viewport')drawReference();
    if(kind==='drawing'){
      const settings=app.getSketchSettings(),before=drawingSettings;
      drawingSettings=settings;
      const tracingChanged=before.tracing&&settings.tracing
        ? Object.keys(before.tracing).some(key=>before.tracing[key]!==settings.tracing[key])
        : before.tracing!==settings.tracing;
      const axisChanged=JSON.stringify(before.mirrorAxis)!==JSON.stringify(settings.mirrorAxis);
      if(active==='tracing'&&tracingChanged||active==='mirror'&&axisChanged)close();
      else drawReference();
    }
  });
  drawReference();window.LabSketchExtras={run,close,getState:()=>({active,mode,loupeEnabled})};
})();
