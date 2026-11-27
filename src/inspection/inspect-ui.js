/* Transient assembly inspection views. All transforms stay outside the document. */
(() => {
  'use strict';
  const app=window.LabApp,G=window.LabInspectGeometry;
  if(!app||!G)return;
  const $=id=>document.getElementById(id);
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const number=n=>Number(n.toFixed(2)).toLocaleString('ru-RU');
  const radians=n=>n*Math.PI/180,degrees=n=>n*180/Math.PI;
  const printWorkerUrl=document.currentScript?.src?new URL('../workers/print-worker.js',document.currentScript.src):null;
  let current=null,storage=null;
  let baseline;
  function element(tag,attrs={},text=''){
    const node=document.createElement(tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);node.textContent=text;return node;
  }
  function listen(s,target,type,fn,options={}){target.addEventListener(type,fn,{...options,signal:s.events.signal});}
  function button(s,label,fn,id){const node=element('button',{type:'button',id},label);s.tools.append(node);listen(s,node,'click',fn);return node;}
  function slider(s,label,id,min,max,step,value,handler){
    const row=element('label',{class:'inspection-range'}),caption=element('span',{},label),input=element('input',{id,type:'range',min,max,step,value}),output=element('output',{'for':id});
    row.append(caption,input,output);s.tools.append(row);listen(s,input,'input',()=>handler(Number(input.value)));return {row,input,output};
  }
  function snapshot(mesh){
    const copy={stats:{...mesh.stats},bounds:structuredClone(mesh.bounds),contours:[]};
    for(const key of ['positions','normals','edges','surfaceTypes','contourIds'])if(mesh[key])copy[key]=mesh[key].slice();
    return copy;
  }
  function db(){
    if(!storage)storage=new Promise((resolve,reject)=>{
      const open=indexedDB.open('drawing-lab-comparison',1);
      open.onupgradeneeded=()=>open.result.createObjectStore('views');open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);
    });return storage;
  }
  async function readBaseline(){
    if(baseline!==undefined)return baseline;
    try{
      const database=await db();
      const saved=await new Promise((resolve,reject)=>{const query=database.transaction('views').objectStore('views').get('pinned');query.onsuccess=()=>resolve(query.result||null);query.onerror=()=>reject(query.error);});
      // A save or clear made during the read takes precedence over the stored copy.
      if(baseline===undefined)baseline=saved;
    }catch{/* Current-session snapshots also work when storage is unavailable. */}
    return baseline;
  }
  async function writeBaseline(mesh){
    baseline=mesh?snapshot(mesh):null;const value=baseline;
    try{const database=await db();await new Promise((resolve,reject)=>{const tx=database.transaction('views','readwrite'),store=tx.objectStore('views');if(value)store.put(value,'pinned');else store.delete('pinned');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});return true;}
    catch{return false;}
  }
  function notification(s,text){if(current===s)s.status.textContent=text;}
  function navigation(s,viewer,canvas,onDown,onMove,onEnd){
    let gesture=null;
    listen(s,canvas,'pointerdown',e=>{
      if(e.button>0||gesture)return;
      const start=onDown(e,viewer.pick(e.clientX,e.clientY));if(!start)return;
      e.preventDefault();e.stopImmediatePropagation();canvas.setPointerCapture(e.pointerId);gesture={...start,x:e.clientX,y:e.clientY,id:e.pointerId};
    },{capture:true});
    listen(s,canvas,'pointermove',e=>{if(gesture?.id!==e.pointerId)return;e.preventDefault();e.stopImmediatePropagation();onMove?.(e,gesture);},{capture:true});
    function release(e){if(gesture?.id!==e.pointerId)return;e.stopImmediatePropagation();const completed=gesture;gesture=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);onEnd?.(e,completed);}
    for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(s,canvas,type,release,{capture:true});
  }
  function close(){
    if(!current)return;const s=current;current=null;s.events.abort();cancelAnimationFrame(s.motionFrame||0);
    if(s.light){s.cleanup?.();}else for(const v of s.viewers){const gl=v.gl;v.dispose();gl?.getExtension('WEBGL_lose_context')?.loseContext();}
    s.layer?.remove();s.toolbar.remove();document.body.classList.remove('inspection-open','inspection-light');
  }
  function open(mode,title){
    close();const source=app.getModelMesh(),base=app.getModelViewer();if(!source||!base?.supported||!app.isModelOpen()){app.toast('Откройте готовую 3D-модель.');return null;}
    if(app.isModelEditing()){app.toast('Сначала подтвердите текущую операцию.');return null;}
    const events=new AbortController(),toolbar=element('section',{id:'inspection-toolbar',class:'glass','aria-label':title}),heading=element('div',{class:'inspection-heading'}),status=element('div',{id:'inspection-status',role:'status'}),tools=element('div',{class:'inspection-tools'});
    const exit=element('button',{id:'inspection-close',type:'button','aria-label':'Закрыть просмотр'},'×');heading.append(element('strong',{},title),exit);toolbar.append(heading,status,tools);document.body.append(toolbar);
    const s={mode,source,base,events,toolbar,status,tools,viewers:[],parts:source.bodies||[],light:mode==='light'};current=s;listen(s,exit,'click',close);
    listen(s,document,'keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}},{capture:true});
    listen(s,document,'labchange',e=>{if(e.detail.kind==='model'&&!e.detail.open||e.detail.kind==='tool'||e.detail.kind==='modelgeometry'&&app.getModelMesh()!==source)close();});
    listen(s,window,'pagehide',close);listen(s,document,'pointerdown',e=>{if(e.target.closest('#cad-presentation-close,#open-model,#cad-back,#cad-detach,#new-sheet,#undo,#redo,#cad-actions,#model-close'))close();},{capture:true});
    if(s.light){document.body.classList.add('inspection-light');return s;}
    document.body.classList.add('inspection-open');const layer=element('div',{id:'inspection-surface'});$('model-preview').append(layer);s.layer=layer;
    const canvas=element('canvas',{id:'inspection-canvas','aria-label':title,tabindex:0});layer.append(canvas);s.canvas=canvas;
    const view=new LabModelViewer(canvas);s.viewers.push(view);if(!view.supported){close();app.toast('Браузеру не удалось открыть дополнительный 3D-вид.');return null;}
    s.viewer=view;view.setMesh(source,{animate:false});view.setMaterial(base.material);view.setCamera(base.getCamera(),false);view.setLightDirection(base.lightDirection);view.setGroundVisible(false);
    // A fixed frame keeps the assembly rooted while parts move or geometry changes between versions.
    s.frame={center:G.center(source.bounds),radius:Math.max(1,view.radius*(mode==='explode'?1.65:1.1))};view.inspectionFrame=s.frame;view.requestRender();return s;
  }
  function selectedBody(s){const id=window.LabCAD?.getState().selected[0];return s.parts.find(p=>p.id===id)||s.parts[0];}
  function chooseBody(s,onChange,caption='Движущаяся деталь',id='inspection-hinge-body'){
    const label=element('label',{class:'inspection-selection'},caption+' '),select=element('select',{id});
    for(const body of s.parts)select.append(element('option',{value:body.id},body.name));select.value=selectedBody(s).id;label.append(select);s.tools.append(label);listen(s,select,'change',()=>onChange(s.parts.find(p=>p.id===select.value)));return select;
  }
  function guideMarkers(s,points){s.viewer.setInspectionOverlay([],points.flat());}
  function surfaceLabel(s,id){
    const pin=element('div',{id,class:'inspection-pin','aria-hidden':'true'}),caption=element('span');
    pin.append(caption);s.layer.append(pin);pin.hidden=true;let anchor=null;
    function position(){
      if(!anchor)return;
      const r=s.layer.getBoundingClientRect(),p=s.viewer.project(anchor);if(!p){pin.hidden=true;return;}
      const x=p.x-r.left,y=p.y-r.top;
      pin.hidden=x<0||x>r.width||y<0||y>r.height;
      pin.style.left=x+'px';pin.style.top=y+'px';
      pin.classList.toggle('leftwards',x>r.width-caption.offsetWidth-24);
      pin.classList.toggle('downwards',y<32);
    }
    listen(s,s.canvas,'labmodelrender',position);
    return (point,text)=>{anchor=point;pin.hidden=!point;if(point){caption.textContent=text;position();}};
  }
  function explode(){
    if(app.getBodies().length<2){app.toast('Для разнесённого вида нужны две детали.');return;}
    const s=open('explode','Разнесённый вид');if(!s)return;
    const origin=G.center(s.source.bounds),span=Math.max(...G.sub(s.source.bounds.max,s.source.bounds.min));
    const centers=s.parts.map(b=>G.center(b.bounds));
    // Concentric/coincident parts need distinct guides too.
    const offsets=centers.map((c,i)=>{
      let delta=G.sub(c,origin);const duplicates=centers.filter(p=>Math.hypot(...G.sub(p,c))<.01).length;
      if(duplicates>1||Math.hypot(...delta)<.01){const a=i*Math.PI*2/centers.length;delta=[Math.cos(a),Math.sin(a),.55];}
      return G.scale(G.unit(delta),span*.55);
    });
    s.factor=.35;s.factors=s.parts.map(()=>s.factor);
    const control=slider(s,'Разнос','inspection-explode',0,100,1,35,n=>show(n/100));
    function show(factor,index=-1){const value=clamp(factor,0,1);if(index<0){s.factor=value;s.factors.fill(value);}else s.factors[index]=value;const guides=[];
      const parts=s.parts.map((part,i)=>{const d=G.scale(offsets[i],s.factors[i]);guides.push(...centers[i],...G.add(centers[i],d));return {...part,mesh:G.transformed(part.mesh,p=>G.add(p,d))};});
      s.viewer.setMesh(G.assembly(parts),{animate:false});s.viewer.inspectionFrame=s.frame;s.viewer.setInspectionOverlay([],guides);control.input.value=Math.round(s.factor*100);control.output.value=`${Math.round(s.factor*100)} %`;
    }
    notification(s,'Тяните отдельную деталь вбок. Ползунок раздвигает всю сборку.');show(s.factor);
    navigation(s,s.viewer,s.canvas,(e,hit)=>hit?{index:hit.bodyIndex,factor:s.factors[hit.bodyIndex]}:null,(e,g)=>show(g.factor+(e.clientX-g.x)/Math.max(100,s.canvas.clientWidth*.45),g.index));
    button(s,'↓ PNG',async()=>{try{const blob=await s.viewer.getImage({transparent:true,width:1600,height:1200});const url=URL.createObjectURL(blob),a=element('a',{href:url,download:'Сборка-разнесённый-вид.png'});a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch{notification(s,'Не удалось сохранить снимок.');}},'inspection-png');
  }
  function hinge(){
    if(app.getBodies().length<2){app.toast('Для проверки петли нужны подвижная деталь и корпус.');return;}
    const s=open('hinge','Ход петли');if(!s)return;
    const markAngle=surfaceLabel(s,'inspection-angle-mark');
    const selected=chooseBody(s,reset),control=slider(s,'Угол','inspection-angle',-180,180,.1,0,requestAngle);
    function reset(part){markAngle(null);cancelAnimationFrame(s.motionFrame);s.motionFrame=0;s.moving=part;s.angle=0;s.requested=0;s.axis=[];s.collision=null;s.movingSpatial=G.tree(G.triangles(part.mesh));
      const others=s.parts.filter(x=>x!==part);s.fixed=G.tree(others.flatMap(x=>G.triangles(x.mesh)));s.spacing=Math.max(.05,Math.min(...others.flatMap(x=>G.sub(x.bounds.max,x.bounds.min).filter(n=>n>0))));
      s.viewer.setMesh(s.source,{animate:false});guideMarkers(s,[]);control.input.value=0;control.input.disabled=true;control.output.value='0°';notification(s,'Нажмите на два конца ребра, вокруг которого вращается деталь.');}
    button(s,'Другая ось',()=>reset(s.moving),'inspection-reset-axis');reset(s.parts.find(x=>x.id===selected.value));
    function snap(e,hit){const k=hit.triangle*9,p=s.viewer.mesh.positions;let best=hit.point,d=15;
      for(let i=0;i<9;i+=3){const q=Array.from(p.subarray(k+i,k+i+3)),screen=s.viewer.project(q);const dist=Math.hypot(screen.x-e.clientX,screen.y-e.clientY);if(dist<d){d=dist;best=q;}}return best;}
    function display(result){
      const {angle,collision}=result;s.angle=angle;s.collision=collision;
      const pose=G.rotation(s.axis,angle),mesh=G.transformed(s.moving.mesh,p=>pose.apply(p),n=>pose.apply(n,true));
      s.viewer.setMesh(G.assembly(s.parts.map(p=>p===s.moving?{...p,mesh}:p)),{animate:false});
      const patches=[];if(collision){const t=collision.obstacle;patches.push(...t.a,...t.b,...t.c);const i=collision.moving*9;patches.push(...mesh.positions.subarray(i,i+9));}
      s.viewer.setInspectionOverlay(patches,s.axis.flat(),!!collision);control.input.value=degrees(angle).toFixed(2);control.output.value=`${number(degrees(angle))}°`;
      markAngle(collision?G.scale(G.add(s.axis[0],s.axis[1]),.5):null,`${number(degrees(angle))}°`);
      notification(s,collision?`Контакт при ${number(degrees(angle))}°. Тяните деталь обратно.`:'Тяните деталь или измените угол.');
    }
    function requestAngle(value){if(s.axis.length<2)return;s.requested=radians(clamp(value,-180,180));if(s.motionFrame)return;
      function advance(){s.motionFrame=0;if(current!==s)return;const maxStep=radians(6);const next=s.angle+clamp(s.requested-s.angle,-maxStep,maxStep);
        const result=G.moveHinge(s.movingSpatial,s.fixed,s.axis,s.angle,next,s.spacing);display(result);if(!result.collision&&Math.abs(s.requested-s.angle)>1e-5)s.motionFrame=requestAnimationFrame(advance);}
      s.motionFrame=requestAnimationFrame(advance);
    }
    navigation(s,s.viewer,s.canvas,(e,hit)=>{
      if(!hit)return null;
      if(s.axis.length<2){const p=snap(e,hit);if(!s.axis.length||Math.hypot(...G.sub(p,s.axis[0]))>.25)s.axis.push(p);
        if(s.axis.length===1){const size=s.viewer.radius*.025;guideMarkers(s,[[p[0]-size,p[1],p[2]],[p[0]+size,p[1],p[2]],[p[0],p[1]-size,p[2]],[p[0],p[1]+size,p[2]]]);notification(s,'Теперь отметьте вторую точку оси.');}
        else{guideMarkers(s,s.axis);control.input.disabled=false;notification(s,'Потяните подвижную деталь или измените угол.');}return {select:true};}
      return hit.bodyId===s.moving.id?{angle:degrees(s.angle)}:null;
    },(e,g)=>{if(!g.select)requestAngle(g.angle+(e.clientX-g.x-(e.clientY-g.y))*.55);});
  }
  function thickness(){
    const s=open('thickness','Толщина стенок');if(!s)return;
    const markThickness=surfaceLabel(s,'inspection-thickness-mark');
    const control=slider(s,'Тоньше','inspection-threshold',.1,20,.1,2,draw);s.samples=[];s.indices=new Map();
    const field=element('input',{id:'inspection-threshold-number',type:'number',min:'.01',max:'1000',step:'.1',value:'2','aria-label':'Минимальная толщина в миллиметрах'});s.tools.insertBefore(field,control.row.nextSibling);listen(s,field,'input',()=>{const n=Number(field.value);if(n>0&&n<=1000)draw(n);});
    function draw(limit){control.input.value=limit;control.output.value=`${number(limit)} мм`;field.value=Number(limit.toFixed(2));let patches=[];
      for(const cell of s.samples)if(cell.distance<limit-1e-5)patches.push(...cell.vertices);s.viewer.setInspectionOverlay(patches);notification(s,patches.length?'Синим выделены тонкие участки. Нажмите на поверхность для замера.':'Тонких участков среди измеренных точек нет. Нажмите на поверхность для замера.');}
    notification(s,'Измерение по нормали к поверхности…');
    async function calculate(){for(const body of s.parts){await new Promise(r=>requestAnimationFrame(r));if(current!==s)return;
        const tris=G.triangles(body.mesh),index=G.tree(tris);s.indices.set(body.id,index);const cells=G.wallSamples(tris,index);for(const cell of cells)s.samples.push(cell);
      }if(current===s)draw(Number(field.value));}
    calculate().catch(()=>notification(s,'Не удалось измерить эту сетку.'));
    listen(s,s.canvas,'labmodelselect',e=>{const hit=e.detail.hit;if(!hit||!s.indices.has(hit.bodyId)){markThickness(null);return;}const mm=G.thickness(s.indices.get(hit.bodyId),hit.point,hit.normal);markThickness(Number.isFinite(mm)?hit.point:null,`${number(mm)} мм`);notification(s,Number.isFinite(mm)?`В точке касания ${number(mm)} мм по нормали к поверхности.`:'В этой точке луч не встретил противоположную стенку.');});
  }
  function printCheck(){
    const s=open('print','Ориентация для печати');
    if(!s)return;
    const drawings=window.LabDrawingGeometry;
    if(!s.parts.length||!drawings){close();return;}
    const P=window.LabPrintGeometry;
    let part=selectedBody(s),up=[0,0,1],oriented=null,angle=45;
    let updatePrintControls=()=>{};
    function display() {
      oriented=drawings.printOrientation(part.mesh,up,angle);
      const {mesh,patches,guides,supports,contactArea,overhangArea}=oriented;
      s.viewer.setMesh(G.assembly([{...part,mesh,bounds:mesh.bounds}]),{animate:false});
      s.viewer.inspectionFrame={
        center:G.center(mesh.bounds),
        radius:Math.max(1,Math.hypot(...G.sub(mesh.bounds.max,mesh.bounds.min))*.64)
      };
      s.viewer.setInspectionOverlay(patches,[...guides,...supports],true);
      threshold.output.value=angle+'°';
      notification(s,`Опора ${number(contactArea)} мм² · нависания ${number(overhangArea)} мм². Нажмите на грань, чтобы положить её на стол.`);
      updatePrintControls();
    }
    if(s.parts.length>1)chooseBody(s,body=>{part=body;up=[0,0,1];display();},'Деталь','print-body');
    const threshold=slider(s,'От вертикали','print-angle',5,80,1,45,n=>{angle=n;display();});
    button(s,'Исходное положение',()=>{up=[0,0,1];display();},'print-reset');
    if(P)updatePrintControls=printControls(s,P,()=>({part,oriented,angle}),direction=>{up=direction;display();});
    listen(s,s.canvas,'labmodelselect',e=>{
      if(!e.detail.hit||!oriented)return;
      up=oriented.unorient(G.scale(e.detail.hit.normal,-1));
      display();
    });
    s.viewer.setView('iso');
    display();
  }
  function printControls(s,geometry,context,orient){
    const cell=element('div',{class:'print-check-controls'});
    const profileSelect=element('select',{id:'print-profile'});
    const profileLabel=element('label',{class:'inspection-selection',for:'print-profile'},'Рабочий объём принтера');
    const dimensions=element('div',{class:'print-custom-bed'});
    const storageKey='drawing-lab-printer-profile';
    const {validSize,printerPreference}=geometry;
    let stored=printerPreference(null);
    try{stored=printerPreference(JSON.parse(localStorage.getItem(storageKey)));}catch{/* Session-only. */}
    for(const [value,{name}] of Object.entries(geometry.profiles))profileSelect.append(element('option',{value},name));
    profileSelect.append(element('option',{value:'custom'},'Свой размер'));
    profileSelect.value=stored.profile;
    const fields=['X','Y','Z'].map((axis,i)=>{
      const label=element('label',{class:'inspection-selection'},axis);
      const input=element('input',{type:'number',step:'any',min:5,max:10000,value:stored.size[i],'aria-label':`Рабочий объём ${axis}, мм`});
      label.append(input);dimensions.append(label);return input;
    });
    const fitText=element('p',{id:'print-fit',role:'status'});
    const actions=element('div',{class:'print-action-row'});
    const results=element('div',{id:'print-results',class:'print-results'});
    const makeButton=(id,label)=>{
      const node=element('button',{id,type:'button'},label);actions.append(node);return node;
    };
    const findPosition=makeButton('print-orient-options','Подобрать положение');
    const diagnose=makeButton('print-diagnose','Проверить сетку');
    const cancel=makeButton('print-cancel','Отменить расчёт');
    cancel.hidden=true;
    const exportPart=makeButton('print-export-3mf','3MF в этом положении');
    const layers=element('details',{class:'print-layers'});
    layers.append(element('summary',{},'Предпросмотр слоёв'));
    const layerFields=element('div',{class:'print-layer-fields'});
    const layerHeightLabel=element('label',{class:'inspection-selection'},'Высота слоя, мм');
    const height=element('input',{id:'print-layer-height',type:'number',min:.05,max:5,step:.05,value:.2});
    const layerLabel=element('label',{class:'inspection-selection'},'Слой');
    const layer=element('input',{id:'print-layer',type:'range',min:1,max:1,value:1});
    const layerNote=element('output',{id:'print-layer-note','aria-live':'polite'});
    const layerFigure=document.createElementNS('http://www.w3.org/2000/svg','svg');
    layerFigure.setAttribute('role','img');
    layerFigure.setAttribute('aria-label','Сечение выбранного слоя');
    layerHeightLabel.append(height);layerLabel.append(layer);layerFields.append(layerHeightLabel,layerLabel);
    layers.append(layerFields,layerNote,layerFigure);
    profileLabel.append(profileSelect);
    cell.append(profileLabel,dimensions,fitText,actions,results,layers);s.tools.append(cell);
    s.toolbar.classList.add('print-toolbar');
    let active=null,layerFrame=0,options=null,diagnostic=null;
    const on=(item,type,fn)=>listen(s,item,type,fn);
    const sizeText=size=>size.map(number).join(' × ')+' мм';
    const readBed=()=>geometry.profiles[profileSelect.value]?.size||fields.map(field=>field.valueAsNumber);
    function refreshFit(){
      const {oriented}=context(),bed=readBed(),custom=profileSelect.value==='custom';
      dimensions.hidden=!custom;
      findPosition.disabled=!validSize(bed)||Boolean(active);
      if(!oriented)return;
      if(!validSize(bed)){
        fitText.textContent='Введите три размера от 5 до 10 000 мм.';
        fitText.dataset.fits='false';
        return;
      }
      const info=geometry.fits(oriented.mesh.bounds,bed);
      fitText.dataset.fits=String(info.fits);
      const overflow=info.overflow.map((n,i)=>n>1e-5?`${'XYZ'[i]} +${number(n)} мм`:'').filter(Boolean);
      fitText.textContent=info.fits
        ? `${sizeText(info.size)} · помещается в рабочий объём`
        : `${sizeText(info.size)} · превышение по ${overflow.join(', ')}`;
    }
    function updatePreferences(){
      const size=fields.map(field=>field.valueAsNumber);
      if(validSize(size))try{localStorage.setItem(storageKey,JSON.stringify(printerPreference({profile:profileSelect.value,size})));}catch{/* Session-only. */}
      stop();
      options=null;renderResult();refreshFit();
    }
    function segmentPath(lines){
      return lines.map(([[ax,ay],[bx,by]])=>`M ${ax} ${-ay} L ${bx} ${-by}`).join(' ');
    }
    function drawLayer(){
      if(!layers.open)return;
      const {oriented}=context();
      if(!oriented)return;
      const step=height.valueAsNumber;
      if(!Number.isFinite(step)||step<.05||step>5){
        layerNote.textContent='Введите высоту от 0,05 до 5 мм.';
        layerFigure.replaceChildren();
        return;
      }
      const sample=geometry.layerPreview(oriented.mesh,step,Number(layer.value)-1);
      layer.max=String(sample.count);layer.value=String(sample.layer+1);
      const detail=!sample.current.length?'В этом сечении нет материала.':sample.layer===0?'Первый слой на столе.'
        :sample.bands.length?'Цветом показаны участки без материала строго под ними.':'Под слоем есть материал.';
      layerNote.textContent=`${sample.layer+1} / ${sample.count} · Z ${number(sample.z)} мм. ${detail}`;
      const {min,max}=oriented.mesh.bounds,span=Math.max(max[0]-min[0],max[1]-min[1],1),pad=span*.07;
      layerFigure.setAttribute('viewBox',`${min[0]-pad} ${-max[1]-pad} ${max[0]-min[0]+pad*2} ${max[1]-min[1]+pad*2}`);
      function path(className,commands){
        const node=document.createElementNS(layerFigure.namespaceURI,'path');
        node.setAttribute('class',className);node.setAttribute('d',commands);return node;
      }
      const missing=sample.bands.map(([x,y,w,h])=>`M ${x} ${-y} h ${w} v ${-h} h ${-w} Z`).join(' ');
      layerFigure.replaceChildren(path('print-layer-missing',missing),path('print-layer-previous',segmentPath(sample.previous)),path('print-layer-current',segmentPath(sample.current)));
    }
    function refreshLayer(){
      cancelAnimationFrame(layerFrame);
      layerFrame=requestAnimationFrame(drawLayer);
    }
    function renderResult(){
      results.replaceChildren();
      if(options){
        const list=element('ol',{class:'print-orientation-list'});
        for(const position of options.slice(0,3)){
          const item=element('li');
          const choice=element('button',{type:'button'});
          choice.textContent=`${sizeText(position.size)} · опора ${number(position.contactArea)} мм² · нависания ${number(position.overhangArea)} мм²${position.fits?'':' · больше объёма'}`;
          on(choice,'click',()=>orient(position.up));item.append(choice);list.append(item);
        }
        results.append(list);
      }
      if(diagnostic){
        const labels=[[diagnostic.open,'незамкнутые рёбра'],[diagnostic.nonManifold,'рёбра с лишними гранями'],[diagnostic.flipped,'рёбра с разворотом граней'],[diagnostic.degenerate,'вырожденные треугольники']];
        const issues=labels.filter(([count])=>count).map(([count,label])=>`${label} · ${count}`);
        if(diagnostic.inverted)issues.push('оболочка вывернута');
        if(diagnostic.crossing)issues.push('найдено самопересечение');
        const report=element('p',{role:'status'},issues.length?issues.join(' · '):'Нарушений при проверке сетки не найдено.');
        results.append(report);
      }
    }
    function stop(){
      if(!active)return;
      active.worker?.terminate();
      clearTimeout(active.fallback);
      active=null;
      cancel.hidden=true;
      diagnose.disabled=false;
    }
    function run(kind){
      const {part,oriented,angle}=context();
      if(!oriented)return;
      stop();
      const job={worker:null,fallback:null};
      active=job;
      const bed=[...readBed()];
      const target=kind==='orientation'?part.mesh:oriented.mesh;
      const mesh={positions:target.positions,normals:target.normals,edges:target.edges,bounds:target.bounds,stats:target.stats};
      cancel.hidden=false;
      findPosition.disabled=diagnose.disabled=true;
      results.replaceChildren(element('p',{role:'status'},'Выполняется расчёт…'));
      function finish(result,error){
        if(active!==job)return;
        stop();
        refreshFit();
        if(error){
          results.replaceChildren(element('p',{role:'status'},error));
          return;
        }
        if(kind==='orientation')options=result;
        else{
          diagnostic=result;
          s.viewer.setInspectionOverlay(result.highlights,[...oriented.guides,...result.marks],false);
        }
        renderResult();
      }
      function local(){
        if(active!==job)return;
        job.worker?.terminate();
        job.worker=null;
        const steps=kind==='orientation'?geometry.orientationScores(mesh,bed,angle):null;
        const scores=[];
        function update(){
          if(active!==job)return;
          try{
            if(!steps){finish(geometry.meshIssues(mesh));return;}
            const next=steps.next();
            if(next.done){finish(geometry.rankOrientation(scores));return;}
            scores.push(next.value);
            job.fallback=setTimeout(update,0);
          }catch(error){finish(null,error.message);}
        }
        job.fallback=setTimeout(update,40);
      }
      if(!printWorkerUrl||typeof Worker!=='function'||location.protocol==='file:'){local();return;}
      try{
        job.worker=new Worker(printWorkerUrl);
        job.worker.onmessage=e=>finish(e.data.result,e.data.error);
        job.worker.onerror=event=>{event.preventDefault();local();};
        job.worker.postMessage({kind,mesh,bed,angle});
      }catch{local();}
    }
    on(profileSelect,'change',updatePreferences);
    for(const field of fields)on(field,'change',updatePreferences);
    on(findPosition,'click',()=>run('orientation'));
    on(diagnose,'click',()=>run('mesh'));
    on(cancel,'click',()=>{stop();refreshFit();renderResult();});
    on(layers,'toggle',refreshLayer);
    on(height,'input',refreshLayer);
    on(layer,'input',refreshLayer);
    on(exportPart,'click',()=>{
      const {part,oriented}=context();
      if(!oriented)return;
      try{
        const mesh={...oriented.mesh,bodies:[{...part,mesh:oriented.mesh}]};
        const blob=window.LabModelExport.threeMF(mesh,{material:s.base.material});
        const url=URL.createObjectURL(blob),link=element('a',{href:url,download:'Деталь.3mf'});
        document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
      }catch(error){notification(s,error.message);}
    });
    s.events.signal.addEventListener('abort',()=>{stop();cancelAnimationFrame(layerFrame);},{once:true});
    let previousPart=null,previousAngle=null;
    return ()=>{
      const {part,angle}=context();
      stop();
      if(part!==previousPart||angle!==previousAngle)options=null;
      previousPart=part;previousAngle=angle;
      diagnostic=null;
      renderResult();refreshFit();refreshLayer();
    };
  }
  async function compare(){
    const s=open('compare','Сравнение вариантов');if(!s)return;
    const wipe=element('div',{id:'inspection-wipe',role:'slider',tabindex:0,'aria-label':'Граница исходного и текущего вариантов','aria-valuemin':'0','aria-valuemax':'100'});
    const badge=element('span',{},'До · После');wipe.append(badge);s.layer.append(wipe);wipe.hidden=true;
    let previous=null,previousCanvas=null,split=.5;
    function move(fraction){split=clamp(fraction,0,1);wipe.style.left=`${split*100}%`;wipe.setAttribute('aria-valuenow',String(Math.round(split*100)));if(previousCanvas)previousCanvas.style.clipPath=`inset(0 ${(1-split)*100}% 0 0)`;}
    function setVariant(mesh){
      wipe.hidden=!mesh;if(!mesh){if(previousCanvas)previousCanvas.hidden=true;notification(s,'Запомните первый вариант. После правки откройте сравнение снова.');return;}
      if(!previous){previousCanvas=element('canvas',{id:'inspection-baseline','aria-hidden':'true'});s.layer.insertBefore(previousCanvas,wipe);previous=new LabModelViewer(previousCanvas);s.viewers.push(previous);}
      if(!previous.supported){notification(s,'Браузеру не удалось открыть второй вид.');return;}
      previousCanvas.hidden=false;previous.setMesh(mesh,{animate:false});const box=G.bounds([mesh.bounds.min,mesh.bounds.max,s.source.bounds.min,s.source.bounds.max]);
      s.frame={center:G.center(box),radius:Math.max(1,Math.hypot(...G.sub(box.max,box.min))*.55)};previous.inspectionFrame=s.frame;s.viewer.inspectionFrame=s.frame;previous.setGroundVisible(false);previous.setMaterial(s.base.material);previous.setLightDirection(s.base.lightDirection);move(split);s.viewer.requestRender();notification(s,'Тяните разделитель. Вращение и масштаб общие для обоих вариантов.');
    }
    listen(s,s.canvas,'labmodelrender',()=>{if(previous&&previousCanvas&&!previousCanvas.hidden)previous.setCamera(s.viewer.getCamera(),false,true);});
    let dragging=null;listen(s,wipe,'pointerdown',e=>{e.preventDefault();dragging=e.pointerId;wipe.setPointerCapture(e.pointerId);});listen(s,wipe,'pointermove',e=>{if(dragging!==e.pointerId)return;const r=s.layer.getBoundingClientRect();move((e.clientX-r.left)/r.width);});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(s,wipe,type,()=>dragging=null);
    listen(s,wipe,'keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();move(e.key==='Home'?0:e.key==='End'?1:split+(e.key==='ArrowRight'?.025:-.025));}});
    const save=button(s,'Запомнить вариант',async()=>{const persisted=await writeBaseline(s.source);if(current!==s)return;setVariant(baseline);notification(s,persisted?'Вариант сохранён. Можно вернуться к редактированию.':'Вариант сохранён до закрытия вкладки.');save.textContent='Обновить исходный';},'inspection-save-baseline');
    button(s,'Очистить',async()=>{await writeBaseline(null);if(current===s){setVariant(null);save.textContent='Запомнить вариант';}},'inspection-forget-baseline');
    const old=await readBaseline();if(current!==s)return;if(old)save.textContent='Обновить исходный';setVariant(old);
  }
  function light(){
    if(!window.LabCAD?.getState().presenting)window.LabCAD?.action('present');
    const s=open('light','Освещение');if(!s)return;s.base.setAutoRotate(false);
    const direction=s.base.lightDirection;let azimuth=degrees(Math.atan2(direction[1],direction[0])),elevation=degrees(Math.asin(G.unit(direction)[2]));
    const az=slider(s,'Направление','inspection-light-azimuth',-180,180,1,azimuth,n=>{azimuth=n;update();});const el=slider(s,'Высота','inspection-light-elevation',-70,85,1,elevation,n=>{elevation=n;update();});
    function update(){const a=radians(azimuth),e=radians(elevation);s.base.setLightDirection([Math.cos(e)*Math.cos(a),Math.cos(e)*Math.sin(a),Math.sin(e)]);az.output.value=`${Math.round(azimuth)}°`;el.output.value=`${Math.round(elevation)}°`;}
    button(s,'Исходный свет',()=>{s.base.setLightDirection([-.45,.65,1]);sync();},'inspection-reset-light');
    function sync(){const d=G.unit(s.base.lightDirection);azimuth=degrees(Math.atan2(d[1],d[0]));elevation=degrees(Math.asin(d[2]));az.input.value=azimuth;el.input.value=elevation;az.output.value=`${Math.round(azimuth)}°`;el.output.value=`${Math.round(elevation)}°`;}
    s.syncLight=sync;sync();notification(s,'Потяните по свободному фону, чтобы передвинуть блик.');
  }
  // In presentation the empty background controls a camera-space studio light.
  const mainCanvas=$('model-canvas');let lightDrag=null;
  mainCanvas.addEventListener('pointerdown',e=>{
    const v=app.getModelViewer();if(e.button>0||!window.LabCAD?.getState().presenting||!v||v.recording||v.pick(e.clientX,e.clientY))return;
    e.preventDefault();e.stopImmediatePropagation();v.setAutoRotate(false);const d=G.unit(v.lightDirection);lightDrag={id:e.pointerId,x:e.clientX,y:e.clientY,a:Math.atan2(d[1],d[0]),el:Math.asin(d[2])};mainCanvas.setPointerCapture(e.pointerId);
  },true);
  mainCanvas.addEventListener('pointermove',e=>{const g=lightDrag;if(g?.id!==e.pointerId)return;e.preventDefault();e.stopImmediatePropagation();const a=g.a+(e.clientX-g.x)*.015,el=clamp(g.el-(e.clientY-g.y)*.012,-1.2,1.48);app.getModelViewer().setLightDirection([Math.cos(el)*Math.cos(a),Math.cos(el)*Math.sin(a),Math.sin(el)]);current?.syncLight?.();},true);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])mainCanvas.addEventListener(type,e=>{if(lightDrag?.id===e.pointerId){lightDrag=null;e.stopImmediatePropagation();if(mainCanvas.hasPointerCapture(e.pointerId))mainCanvas.releasePointerCapture(e.pointerId);}},true);
  const modes={explode,hinge,thickness,light,compare,print:printCheck};
  window.LabInspect={run(mode){if(modes[mode])return modes[mode]();},close,getMode:()=>current?.mode||null};
})();
