/* Contextual commands for working planes, fasteners and rigid assembly mates. */
(() => {
  'use strict';
  const app=window.LabApp,cad=window.LabCAD,G=window.LabAssemblyGeometry;
  const canvas=document.getElementById('model-canvas');
  const names={planes:'Рабочая плоскость',fastener:'Отверстие под крепёж',mates:'Стыковка деталей'};
  const NS='http://www.w3.org/2000/svg';
  const panel=document.createElement('section');
  panel.id='assembly-tool';
  panel.className='workshop-popup glass';
  panel.hidden=true;
  const guides=document.createElementNS(NS,'svg');
  guides.id='assembly-guides';
  document.body.append(guides,panel);
  let edit=null,timer=0,frame=0,taps=new Map(),drag=null;
  const view=()=>app.getModelViewer();
  const bodyById=id=>app.getBodies().find(body=>body.id===id);
  const plus=(a,b)=>a.map((n,i)=>n+b[i]);
  const minus=(a,b)=>a.map((n,i)=>n-b[i]);
  const times=(a,s)=>a.map(n=>n*s);
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const round=n=>Math.round(n*100)/100;
  const radians=n=>n*Math.PI/180;
  const format=n=>round(n).toLocaleString('ru-RU');
  const local=(body,point)=>minus(G.unplacePoint(body,point),body.offset);
  const world=(body,point)=>G.placePoint(body,plus(point,body.offset));
  function element(tag,text=''){
    const node=document.createElement(tag);
    if(text)node.textContent=text;
    return node;
  }
  function button(text,action,handler){
    const node=element('button',text);
    node.type='button';node.dataset.assemblyAction=action;
    node.addEventListener('click',handler);
    return node;
  }
  function buttons(...items){
    const line=element('div');
    line.className='workshop-buttons';line.append(...items);panel.append(line);
  }
  function field(label,name,min,max,step) {
    const row=element('label');row.className='workshop-field';
    const input=element('input');
    Object.assign(input,{type:'number',value:String(edit[name]),min:String(min),max:String(max),step:String(step),required:true});
    input.dataset.assemblyField=name;
    input.addEventListener('input',()=>{
      if(!input.validity.valid||!Number.isFinite(input.valueAsNumber)){
        clearTimeout(timer);setStatus('Проверьте пределы значения.');setApply(false);return;
      }
      edit[name]=input.valueAsNumber;
      if(edit.mode==='slide'){
        const slider=panel.querySelector('[data-assembly-travel]');
        if(slider){
          slider.min=edit.min;
          slider.max=edit.max;
          slider.value=edit.distance;
        }
      }
      schedulePreview();scheduleGuides();
    });
    row.append(element('span',label),input);panel.append(row);
  }
  function choice(label,name,options,onChange) {
    const row=element('label');row.className='workshop-field';
    const input=element('select');input.dataset.assemblyField=name;
    for(const [value,title] of options){
      const item=element('option',title);item.value=value;input.append(item);
    }
    input.value=edit[name];input.addEventListener('change',()=>{edit[name]=input.value;onChange();});
    row.append(element('span',label),input);panel.append(row);
  }
  function paragraph(text){
    const item=element('p',text);item.className='workshop-hint';panel.append(item);
  }
  function setStatus(text){
    const status=panel.querySelector('.workshop-status');if(status)status.textContent=text;
  }
  function setApply(valid){
    if(edit)edit.valid=Boolean(valid);
    const apply=panel.querySelector('[data-assembly-action=apply]');if(apply)apply.disabled=!valid;
  }
  function render() {
    if(!edit)return;
    const e=edit;
    panel.replaceChildren();panel.setAttribute('aria-label',names[e.tool]);
    const heading=element('div');heading.className='workshop-heading';
    const closeButton=button('×','close',close);closeButton.setAttribute('aria-label','Закрыть');
    heading.append(element('strong',names[e.tool]),closeButton);panel.append(heading);
    if(e.tool==='planes'){
      if(!e.body)paragraph('Отметьте на детали центр рабочей плоскости.');
      else {
        field('Высота над листом, мм','z',-500,1000,'any');
        field('Наклон, °','tilt',-80,80,'any');
        field('Ось наклона, °','azimuth',-180,180,'any');
        field('Длина выступа, мм','depth',-500,500,'any');
        if(e.stage==='draw'){
          paragraph('Коснитесь по очереди вершин на плоскости. Тяните холст, чтобы повернуть вид.');
          buttons(button('Убрать точку','vertex-back',backVertex),button('Замкнуть контур','finish-sketch',finishSketch));
        }else{
          if(!e.points.length)paragraph('Отрицательная длина направляет выступ от плоскости к детали.');
          buttons(button(e.points.length?'Перечертить':'Начертить контур','start-sketch',()=>{
            clearPreview();e.draft=[];e.stage='draw';render();scheduleGuides();
          }),button('Другой центр','anchor',restart));
        }
      }
    }else if(e.tool==='fastener'){
      if(!e.body)paragraph('Коснитесь плоской грани в центре отверстия.');
      else {
        field('Сквозной диаметр, мм','diameter',.2,150,'any');
        field('Диаметр головки, мм','headDiameter',.3,200,'any');
        choice('Посадка головки','headStyle',[['step','Цилиндрический уступ'],['cone','Коническая зенковка']],()=>{render();schedulePreview();});
        if(e.headStyle==='cone')field('Угол зенковки, °','headAngle',30,150,'any');
        else field('Глубина уступа, мм','headDepth',.1,200,'any');
        buttons(button('Другой центр','anchor',restart));
      }
    }else{
      choice('Опоры','mode',[['axis','Цилиндрические оси'],['faces','Плоские грани'],['slide','Поступательное сопряжение']],()=>{
        e.moving=e.fixed=null;e.stage='moving';e.distance=0;clearPreview();render();scheduleGuides();
      });
      if(!e.moving)paragraph(e.mode==='axis'?'Коснитесь боковой стенки подвижного круглого штифта.':'Коснитесь плоской грани подвижной детали.');
      else if(!e.fixed)paragraph(e.mode==='axis'?'Коснитесь стенки круглого отверстия на второй детали.':'Коснитесь ответной грани второй детали.');
      else{
        field(e.mode==='axis'?'Сдвиг вдоль оси, мм':'Зазор вдоль нормали, мм','distance',-500,500,'any');
        if(e.mode==='slide'){
          field('Начало хода, мм','min',-500,500,'any');
          field('Конец хода, мм','max',-500,500,'any');
          const slider=element('input');
          Object.assign(slider,{type:'range',min:e.min,max:e.max,value:e.distance,step:.1});
          slider.setAttribute('aria-label','Положение ползунка');
          slider.dataset.assemblyTravel='true';
          slider.addEventListener('input',()=>{
            e.distance=slider.valueAsNumber;
            panel.querySelector('[data-assembly-field="distance"]').value=String(e.distance);
            schedulePreview();
          });
          panel.append(slider);
        }
      }
      if(e.moving)buttons(button('Выбрать опоры заново','anchor',()=>{
        e.moving=e.fixed=null;e.stage='moving';e.distance=0;clearPreview();render();scheduleGuides();
      }));
      const existing=e.savedMates.get(e.moving?.body||e.selectedBody);
      if(existing)buttons(button('Снять стыковку','detach',()=>{
        close();app.removeModelFeature(existing);
      }));
    }
    const status=element('div');
    status.className='workshop-status';status.setAttribute('role','status');panel.append(status);
    if(e.tool==='mates'?e.fixed:e.body&&(e.tool!=='planes'||e.points.length&&e.stage!=='draw')){
      const apply=button('Применить','apply',commit);apply.disabled=!e.valid;
      buttons(button('Отменить','cancel',close),apply);
    }
    panel.hidden=false;
  }
  function clearPreview(){
    clearTimeout(timer);timer=0;
    if(app.isModelEditing()){
      edit.restarting=true;app.cancelModelEdit();edit.restarting=false;app.beginModelEdit();view().setPreview(true);
    }
    edit.signature=null;edit.valid=false;
  }
  function reset() {
    if(!edit)return;
    clearTimeout(timer);cancelAnimationFrame(frame);
    timer=frame=0;taps.clear();drag=null;
    const savedHeightDrag=edit.heightDrag;
    edit=null;panel.hidden=true;guides.replaceChildren();
    document.body.classList.remove('assembly-editing');
    view()?.setPreview(false);view()?.setHeightDrag(savedHeightDrag);
  }
  function close(){if(!edit)return;reset();app.cancelModelEdit();}
  function restart(){
    clearPreview();
    edit.body=null;edit.anchor=null;edit.points=[];edit.draft=[];edit.stage='anchor';render();scheduleGuides();
  }
  function run(tool){
    if(!Object.hasOwn(names,tool))return false;
    close();
    if(!app.isModelOpen())cad.modelMode(true,false);
    const bodies=app.getBodies();
    if(!view()?.mesh||!view().supported||!bodies.length){app.toast('Сначала откройте объём из готового контура.');return false;}
    if(tool==='mates'&&bodies.length<2){app.toast('Для стыковки нужны две отдельные детали.');return false;}
    const heightDrag=view().heightDragEnabled;
    view().setHeightDrag(false);view().setAutoRotate(false);
    const savedMates=new Map(app.getState().modelFeatures.filter(f=>f.type==='mate').map(f=>[f.target,f.id]));
    edit={tool,stage:tool==='mates'?'moving':'anchor',mode:'axis',distance:0,min:0,max:30,body:null,anchor:null,points:[],draft:[],
      selectedBody:cad.getState().selected[0],savedMates,
      z:0,tilt:0,azimuth:0,depth:10,diameter:4,headDiameter:7,headDepth:2,headStyle:'step',headAngle:90,valid:false,signature:null,heightDrag};
    app.beginModelEdit();view().setPreview(true);
    document.body.classList.add('assembly-editing');
    render();scheduleGuides();panel.querySelector('button').focus({preventScroll:true});
    return true;
  }
  function planeFrame(e){
    const a=radians(e.tilt),q=radians(e.azimuth);
    return G.frame([e.anchor[0],e.anchor[1],e.z],[Math.sin(q)*Math.sin(a),-Math.cos(q)*Math.sin(a),Math.cos(a)],[Math.cos(q),Math.sin(q),0]);
  }
  function descriptor(e){
    if(e.tool==='planes'){
      if(e.stage==='draw'||e.points.length<3)return null;
      const plane=planeFrame(e);
      return {type:'workplane',target:e.body,origin:plane.origin,normal:plane.normal,u:plane.u,
        points:e.points.map(p=>plane.world(...p)),depth:e.depth};
    }
    if(e.tool==='fastener'){
      if(!e.body)return null;
      const {anchor,normal,diameter,headDiameter,headDepth,headStyle,headAngle}=e;
      return {type:'fastener',target:e.body,origin:anchor,normal,diameter,headDiameter,headDepth,headStyle,headAngle};
    }
    if(!e.fixed)return null;
    return {type:'mate',target:e.moving.body,tool:e.fixed.body,mode:e.mode,moving:e.moving.ref,fixed:e.fixed.ref,distance:e.distance,min:e.min,max:e.max};
  }
  function preview(){
    clearTimeout(timer);timer=0;
    if(!edit)return;
    const operation=descriptor(edit);
    if(!operation||panel.querySelector('input:invalid')){setApply(false);return;}
    const signature=JSON.stringify(operation);
    if(signature!==edit.signature){
      const originalMate=operation.type==='mate'?edit.savedMates.get(operation.target):null;
      edit.previewValid=originalMate?app.previewExistingFeature(originalMate,operation):app.previewFeature(operation);
      edit.signature=signature;
    }
    setApply(edit.previewValid);
    setStatus(edit.previewValid?'':app.getModelError());
    scheduleGuides();
  }
  function schedulePreview(){
    setApply(false);clearTimeout(timer);timer=setTimeout(preview,105);
  }
  function commit(){preview();if(edit?.valid&&app.commitModelEdit())reset();}
  function backVertex(){if(edit?.stage==='draw'){edit.draft.pop();scheduleGuides();}}
  function finishSketch(){
    if(edit.draft.length<3){setStatus('Отметьте не меньше трёх вершин.');return;}
    edit.points=edit.draft.slice();edit.stage='ready';render();preview();
  }
  function chooseAt(event){
    const e=edit;
    if(e.stage==='draw'){
      const body=bodyById(e.body),plane=planeFrame(e),origin=world(body,plane.origin),normal=G.placeDirection(body,plane.normal);
      const point=view().unprojectToPlane(event.clientX,event.clientY,{origin,normal});
      if(!point){setStatus('Поверните вид, чтобы увидеть рабочую плоскость.');return;}
      const q=plane.project(local(body,point)).slice(0,2);
      if(e.draft.length>=3){
        const start=view().project(world(body,plane.world(...e.draft[0])));
        if(start&&Math.hypot(start.x-event.clientX,start.y-event.clientY)<14){finishSketch();return;}
      }
      if(e.draft.length>=256){setStatus('Замкните рабочий контур. В нём уже 256 точек.');return;}
      if(!e.draft.length||Math.hypot(...minus(q,e.draft.at(-1)))>.08)e.draft.push(q);
      setStatus('');scheduleGuides();return;
    }
    if(!['anchor','moving','fixed'].includes(e.stage))return;
    const hit=view().pick(event.clientX,event.clientY),body=hit&&bodyById(hit.bodyId);
    if(!body){setStatus('Коснитесь поверхности детали.');return;}
    if(e.tool==='mates'){
      if(e.stage==='fixed'&&body.id===e.moving.body){setStatus('Выберите опору на другой детали.');return;}
      try{
        e[e.stage]={body:body.id,ref:G.surfaceReference(body,hit,e.mode)};
        e.stage=e.moving&&e.fixed?'ready':'fixed';
      }catch(error){setStatus(error.message);return;}
    }else{
      e.body=body.id;e.anchor=local(body,hit.point);e.normal=G.unplaceDirection(body,hit.normal);
      e.z=round(e.anchor[2]);e.stage='ready';
      if(e.tool==='fastener'){
        const b=body.baseBounds||body.bounds,dims=b.max.map((x,i)=>x-b.min[i]).sort((a,b)=>a-b);
        e.diameter=round(clamp(dims[1]/9,.6,6));
        e.headDiameter=round(e.diameter*1.8);
        e.headDepth=round(clamp(dims[0]/4,.1,2));
      }
    }
    render();preview();scheduleGuides();
  }
  canvas.addEventListener('pointerdown',event=>{
    if(!edit||event.button!==0)return;
    if(taps.size)for(const p of taps.values())p.multi=true;
    taps.set(event.pointerId,{x:event.clientX,y:event.clientY,multi:taps.size>0});
  },true);
  canvas.addEventListener('pointermove',event=>{
    const p=taps.get(event.pointerId);
    if(p&&Math.hypot(event.clientX-p.x,event.clientY-p.y)>7)p.moved=true;
  },true);
  canvas.addEventListener('pointerup',event=>{
    const p=taps.get(event.pointerId);taps.delete(event.pointerId);
    if(edit&&p&&!p.multi&&!p.moved&&Math.hypot(event.clientX-p.x,event.clientY-p.y)<=7)chooseAt(event);
  },true);
  for(const type of ['pointercancel','lostpointercapture'])canvas.addEventListener(type,event=>taps.delete(event.pointerId));
  function svg(tag,attrs,text=''){
    const node=document.createElementNS(NS,tag);
    for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));
    if(text)node.textContent=text;guides.append(node);return node;
  }
  function path(points,closed=false,kind='assembly-guide'){
    const projected=points.map(p=>view().project(p));
    if(projected.every(Boolean))svg(closed?'polygon':'polyline',{class:kind,points:projected.map(p=>p.x+','+p.y).join(' ')});
  }
  function note(point,text,dx=9,dy=-9){
    const q=view().project(point);
    if(q)svg('text',{class:'assembly-label',x:q.x+dx,y:q.y+dy},text);
  }
  function marker(point,r=5,active=false) {
    const q=view().project(point);
    if(!q)return;
    svg('circle',{class:active?'assembly-handle':'assembly-point',cx:q.x,cy:q.y,r,'data-mate-handle':active?'yes':'no'});
  }
  function draw() {
    frame=0;guides.replaceChildren();
    const e=edit;if(!e||!view()?.lastProjection)return;
    if(e.tool==='planes'&&e.body){
      const body=bodyById(e.body),plane=planeFrame(e),b=body.baseBounds||body.bounds;
      const size=clamp(Math.max(...minus(b.max,b.min))*.62,13,100);
      const at=(x,y,z=0)=>world(body,plane.world(x,y,z));
      path([at(-size,-size),at(size,-size),at(size,size),at(-size,size)],true,'assembly-plane');
      for(let i=-3;i<=3;i++){
        const c=i*size/4;
        path([at(c,-size),at(c,size)],false,'assembly-grid');
        path([at(-size,c),at(size,c)],false,'assembly-grid');
      }
      note(at(-size,size),format(e.z)+' мм · '+format(e.tilt)+'°',9,16);
      const points=e.stage==='draw'?e.draft:e.points;
      const profile=points.map(p=>at(...p));
      if(profile.length>1)path(profile,e.stage!=='draw');
      profile.forEach((p,i)=>marker(p,i===0?5:3));
      if(e.stage!=='draw'&&points.length>=3){
        const back=points.map(p=>at(...p,e.depth));
        path(back,true,'assembly-outline');
        for(let i=0;i<profile.length;i++)path([profile[i],back[i]],false,'assembly-outline');
      }
    }else if(e.tool==='fastener'&&e.body){
      const body=bodyById(e.body),plane=G.frame(e.anchor,e.normal);
      const at=(x,y,z=0)=>world(body,plane.world(x,y,z));
      const ring=(r,z=0)=>Array.from({length:48},(_,i)=>at(r*Math.cos(i*Math.PI/24),r*Math.sin(i*Math.PI/24),z));
      const conical=e.headStyle==='cone';
      const headDepth=conical?(e.headDiameter-e.diameter)/2/Math.tan(e.headAngle*Math.PI/360):e.headDepth;
      path(ring(e.headDiameter/2),true);path(ring(e.diameter/2),true);
      path(ring((conical?e.diameter:e.headDiameter)/2,-headDepth),true,'assembly-outline');
      marker(at(0,0),3);
      note(at(e.headDiameter/2,0),'⌀'+format(e.headDiameter)+' мм');
      note(at(0,-e.diameter/2),'⌀'+format(e.diameter)+' мм',9,17);
      note(at(-e.headDiameter/2,0,-headDepth),'↧ '+format(headDepth)+' мм',-45,21);
    }else if(e.tool==='mates'&&e.moving){
      const anchor=G.axisOf(bodyById(e.moving.body),e.moving.ref,true);
      marker(anchor.point,6);
      if(e.fixed){
        const support=G.axisOf(bodyById(e.fixed.body),e.fixed.ref,false);
        const extension=Math.max(8,Math.min(28,view().radius*.25));
        const handle=plus(support.point,times(support.normal,e.distance+extension));
        path([plus(support.point,times(support.normal,-extension)),handle]);
        marker(support.point,4);marker(handle,9,true);note(handle,format(e.distance)+' мм');
      }
    }
  }
  function scheduleGuides(){if(edit&&!frame)frame=requestAnimationFrame(draw);}
  canvas.addEventListener('labmodelrender',scheduleGuides);
  guides.addEventListener('pointerdown',event=>{
    if(!edit?.fixed||event.target.dataset?.mateHandle!=='yes')return;
    const fixed=G.axisOf(bodyById(edit.fixed.body),edit.fixed.ref,false);
    const a=view().project(fixed.point),b=view().project(plus(fixed.point,times(fixed.normal,20)));
    if(!a||!b)return;
    const dx=(b.x-a.x)/20,dy=(b.y-a.y)/20,screenScale=dx*dx+dy*dy;
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,start:edit.distance,dx,dy,screenScale};
    event.preventDefault();guides.setPointerCapture(event.pointerId);
  });
  guides.addEventListener('pointermove',event=>{
    if(!edit||drag?.id!==event.pointerId)return;
    const x=event.clientX-drag.x,y=event.clientY-drag.y;
    const move=drag.screenScale>.15?(x*drag.dx+y*drag.dy)/drag.screenScale:-y*.35;
    const bounded=edit.mode==='slide';
    edit.distance=round(clamp(drag.start+move,bounded?edit.min:-500,bounded?edit.max:500));
    const input=panel.querySelector('[data-assembly-field=distance]');if(input)input.value=edit.distance;
    const slider=panel.querySelector('[data-assembly-travel]');if(slider)slider.value=edit.distance;
    schedulePreview();scheduleGuides();
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])guides.addEventListener(type,event=>{
    if(drag?.id===event.pointerId){drag=null;preview();}
  });
  document.addEventListener('labchange',event=>{
    if(!edit)return;
    const {kind,active,open}=event.detail;
    if(kind==='modelpreview'&&!active&&!edit.restarting)reset();
    else if((kind==='model'&&!open)||['project','tool'].includes(kind))close();
  });
  document.addEventListener('keydown',event=>{
    if(!edit||document.querySelector('dialog[open]'))return;
    if(event.key==='Escape'){
      event.preventDefault();event.stopImmediatePropagation();close();
    }else if(edit.stage==='draw'&&!event.target.closest('input, select, textarea')){
      if(event.key==='Enter'){event.preventDefault();event.stopImmediatePropagation();finishSketch();}
      if(event.key==='Backspace'){event.preventDefault();event.stopImmediatePropagation();backVertex();}
    }
  },true);
  window.LabAssemblyTools=Object.freeze({run,close,active:()=>Boolean(edit)});
})();
