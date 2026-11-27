/* Direct canvas modeling: transient handles, previews and editable source sketches. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),app=window.LabApp,body=document.body;
  if(!app||!window.LabSolid)return;
  const canvas=$('model-canvas'),paper=$('paper'),wrap=$('paper-wrap'),overlay=$('cad-overlay');
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),copy=x=>JSON.parse(JSON.stringify(x));
  const add=(a,b)=>a.map((x,i)=>x+b[i]),sub=(a,b)=>a.map((x,i)=>x-b[i]);
  const length=a=>Math.hypot(...a),fmt=x=>Number(Number(x).toFixed(2)).toLocaleString('ru-RU');
  const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let integrated=true,selected=[],lastHit=null,selectionMode=false,internalTool=false,session=null,task=null,drag=null,previewFrame=0;
  let overlayFrame=0,presenting=false,recording=false,focusBody=false,lastPointer={x:innerWidth/2,y:innerHeight/2},longPress=null,suppressLongPressClick=false;
  const viewer=()=>app.getModelViewer(),bodies=()=>app.getBodies(),findBody=id=>bodies().find(b=>b.id===id);
  const current=()=>findBody(selected[0])||bodies()[0];
  const externalEdit=()=>window.LabWorkshop?.active()||window.LabAssemblyTools?.active?.()||window.LabDesignEdit?.active?.()||window.LabDrawingSheet?.active?.()||window.LabCanvasVisual?.active?.()||window.LabCaliper?.active()||window.LabDraftingSketchTools?.active();
  const setting=(id,key,fallback)=>app.getState().modelBodies[id]?.[key]??fallback;
  function selectedShapes(id){const b=findBody(id),strokes=app.getModelStrokes();return (b?.sourceIndices||[]).map(i=>strokes[i]).filter(Boolean);}
  function toScreen(p){const q=new DOMPoint(p.x,p.y).matrixTransform(paper.getScreenCTM());return {x:q.x,y:q.y};}
  function planePoint(event,plane){return viewer()?.unprojectToPlane(event.clientX,event.clientY,{origin:plane.origin,normal:plane.normal});}
  function closeRadial(){$('cad-radial').hidden=true;}
  function closeContext(){$('cad-context').hidden=true;}
  function ensureBody(){const b=current();if(!b){app.toast('Замкните контур и откройте объём.');return null;}if(!selected.length)selected=[b.id];return b;}
  function modelMode(open,animate=true){
    if(!open){body.classList.remove('cad-integrated');$('cad-controls').hidden=true;app.setModelOpen(false);closeContext();scheduleOverlay();return;}
    integrated=true;app.setModelOpen(true);setIntegrated(true,animate);
  }
  function setIntegrated(value,animate=false){
    integrated=value;body.classList.toggle('cad-integrated',value&&app.isModelOpen());$('cad-controls').hidden=!app.isModelOpen();
    $('cad-detach').setAttribute('aria-label',value?'Модель отдельным окном':'Вернуть модель на холст');$('cad-detach').title=value?'Модель отдельным окном':'Вернуть модель на холст';
    const state=app.getState(),v=viewer();if(!v)return;
    v.setPaper({enabled:value,widthMm:state.width/4,heightMm:state.height/4,fit:value});
    if(animate&&value&&v.mesh){v.setView('top');if(!v.reducedMotion){v.setCamera({yaw:0,pitch:Math.PI/2,zoom:1},false);requestAnimationFrame(()=>v.setView('iso'));}else v.setView('iso');}
    v.resize();scheduleOverlay();
  }
  function setSelection(ids,hit,point){
    selected=[...new Set(ids)].filter(id=>findBody(id));lastHit=hit||null;
    if(focusBody)viewer()?.setFocusBody(selected[0]||null);
    if(point)lastPointer=point;renderContext();scheduleOverlay();
  }
  function renderContext(){
    const b=current();if(!app.isModelOpen()||!b||!selected.length||session||task||presenting){closeContext();return;}
    const target=$('cad-context');
    const actions=selected.length>1?[['boolean','Соединить / вырезать'],['distance','Расстояние'],['more','···']]:[['height','↥ Высота'],['face','✎ На грани'],['fillet','⌒ Рёбра'],['more','···']];
    target.innerHTML=actions.map(([action,label])=>`<button data-cad-action="${action}">${label}</button>`).join('');target.hidden=false;
    positionContext();
  }
  function positionContext(){
    const target=$('cad-context'),b=current();if(target.hidden||!b)return;
    const r=target.getBoundingClientRect(),p=viewer()?.project(lastHit?.bodyId===b.id?lastHit.point:b.bounds.max)||lastPointer;
    target.style.left=`${clamp(p.x-r.width/2,10,innerWidth-r.width-10)}px`;
    target.style.top=`${clamp(p.y-65,120,innerHeight-r.height-70)}px`;
  }
  function dimensionLabels(items,bounds){
    const padding=5, height=28;
    const left=Math.max(4,bounds.left)+padding,right=Math.min(innerWidth-4,bounds.right)-padding;
    const top=Math.max(5,bounds.top)+padding,bottom=Math.min(innerHeight-5,bounds.bottom)-padding;
    if(right-left<54||bottom-top<height)return '';
    const avoid=Array.from(document.querySelectorAll('.topbar,#cad-context,#cad-controls,#cad-parameter,#cad-task,#canvas-tour,.model-quickbar,.model-content,.studio-fab,#model-height-hud'))
      .map(el=>el.getBoundingClientRect()).filter(r=>r.width&&r.height);
    const touches=(a,b)=>a.left<b.right+padding&&a.right>b.left-padding&&a.top<b.bottom+padding&&a.bottom>b.top-padding;
    const clampBox=(x,y,w)=>{
      const cx=clamp(x,left+w/2,right-w/2),cy=clamp(y,top+height/2,bottom-height/2);
      return {cx,cy,left:cx-w/2,right:cx+w/2,top:cy-height/2,bottom:cy+height/2};
    };
    return items.map(({at,dx,dy,text,action,id})=>{
      const width=Math.max(54,text.length*6.5+16);
      if(width>right-left)return '';
      const x=at.x+dx,y=at.y+dy;
      let best=null,score=Infinity;
      function consider(px,py){
        const r=clampBox(px,py,width);
        const distance=(r.cx-x)**2+(r.cy-y)**2;
        if(at.x>r.left-3&&at.x<r.right+3&&at.y>r.top-3&&at.y<r.bottom+3)return;
        if(distance<score&&!avoid.some(other=>touches(r,other))){best=r;score=distance;}
      }
      consider(x,y);
      for(let radius=34;radius<=170&&score>radius*radius*.8;radius+=34)
        for(let i=0;i<12;i++){const a=i*Math.PI/6;consider(x+Math.cos(a)*radius,y+Math.sin(a)*radius);}
      if(!best){
        for(let py=top+height/2;py<=bottom;py+=height+padding)
          for(let px=left+width/2;px<=right;px+=width+padding)consider(px,py);
      }
      if(!best)return '';
      avoid.push(best);
      const end={x:clamp(at.x,best.left,best.right),y:clamp(at.y,best.top,best.bottom)};
      const leader=line(at,end,'dimension-leader');
      return `<g class="dimension-label" role="button" tabindex="0" aria-label="${esc(text)}" data-dimension="${action}" data-body="${esc(id)}">${leader}<rect x="${best.left}" y="${best.top}" width="${width}" height="${height}"/><text x="${best.cx}" y="${best.cy}">${esc(text)}</text></g>`;
    }).join('');
  }
  function line(a,b,cls='dimension-line'){return a&&b?`<line class="${cls}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`:'';}
  function scheduleOverlay(){if(!overlayFrame)overlayFrame=requestAnimationFrame(renderOverlay);}
  function renderOverlay(){
    overlayFrame=0;positionContext();let html='';const v=viewer(),b=current();
    const visibleModel=app.isModelOpen()&&v?.mesh&&b&&selected.length&&!presenting&&!window.LabCanvasVisual?.active?.();
    v?.setActiveBody(visibleModel?selected[0]:null);
    if(visibleModel){
      const placement=window.LabAssemblyGeometry;
      const {min:lo,max:hi}=b.baseBounds||b.bounds;
      const p=(x,y,z)=>v.project(placement?.placePoint?.(b,[x,y,z])||[x,y,z]);
      const a=p(lo[0],lo[1],lo[2]),x=p(hi[0],lo[1],lo[2]),y=p(lo[0],hi[1],lo[2]),z=p(hi[0],lo[1],hi[2]);
      const dimensions=[];
      function addDimension(start,end,value,action,dx,dy){
        if(!start||!end)return;
        html+=line(start,end);
        dimensions.push({at:{x:(start.x+end.x)/2,y:(start.y+end.y)/2},dx,dy,text:value,action,id:b.id});
      }
      addDimension(a,x,`${fmt(hi[0]-lo[0])} мм`,'width',0,22);
      addDimension(a,y,`${fmt(hi[1]-lo[1])} мм`,'length',-38,0);
      addDimension(x,z,`${fmt(hi[2]-lo[2])} мм`,'height',37,0);
      if(z&&b.mode==='extrude')html+=`<circle class="cad-grip" data-grip="height" data-body="${esc(b.id)}" cx="${z.x}" cy="${z.y}" r="7" aria-label="Потянуть высоту"/>`;
      if(session?.kind==='fillet'){
        const radius=Number($('cad-radius')?.value)||1,q=p(hi[0]-radius,lo[1],hi[2]);
        if(q)html+=`<circle class="cad-grip" data-grip="radius" data-body="${esc(b.id)}" cx="${q.x}" cy="${q.y}" r="8" aria-label="Потянуть радиус скругления"/>`;
      }
      const shapes=selectedShapes(b.id),circle=shapes.find(s=>s.type==='circle');
      if(circle){
        const q=p(circle.cx/4+(b.offset?.[0]||0),-circle.cy/4+(b.offset?.[1]||0),hi[2]);
        if(q)dimensions.push({at:q,dx:0,dy:-20,text:`R ${fmt(circle.r/4)} мм`,action:'radius',id:b.id});
      }
      if(selected.length===2){
        const b2=findBody(selected[1]);
        if(b2){
          const c1=b.bounds.min.map((n,i)=>(n+b.bounds.max[i])/2),c2=b2.bounds.min.map((n,i)=>(n+b2.bounds.max[i])/2);
          addDimension(v.project(c1),v.project(c2),`${fmt(length(sub(c2,c1)))} мм`,'distance',0,-22);
        }
      }
      html+=dimensionLabels(dimensions,canvas.getBoundingClientRect());
    }
    if(task?.kind==='face'){
      const points=task.points.map(p=>v?.project(p)).filter(Boolean);if(task.hover){const p=v?.project(task.hover);if(p)points.push(p);}
      if(points.length)html+=`<polyline class="cad-guide" points="${points.map(p=>`${p.x},${p.y}`).join(' ')}"/>`;
      task.points.forEach((p,i)=>{const q=v?.project(p);if(q)html+=`<circle class="cad-point" cx="${q.x}" cy="${q.y}" r="${i?4:7}"/>`;});
    }
    if(task&&['axis','path'].includes(task.kind)){
      const points=[...task.points,...(task.hover?[task.hover]:[])].map(toScreen);if(points.length)html+=`<polyline class="cad-guide" fill="none" points="${points.map(p=>`${p.x},${p.y}`).join(' ')}"/>`;
      task.points.forEach(p=>{const q=toScreen(p);html+=`<circle class="cad-point" cx="${q.x}" cy="${q.y}" r="5"/>`;});
    }
    if(overlay.innerHTML!==html){
      const focused=overlay.contains(document.activeElement)?document.activeElement.dataset.dimension:null;
      overlay.innerHTML=html;
      if(focused)overlay.querySelector(`[data-dimension="${focused}"]`)?.focus({preventScroll:true});
    }
  }
  function field(key,label,value,min,max,step=1,options){
    if(options)return `<div class="cad-field"><label for="cad-${key}">${label}</label><select id="cad-${key}" data-cad-field="${key}">${options.map(([v,t])=>`<option value="${esc(v)}"${String(value)===String(v)?' selected':''}>${esc(t)}</option>`).join('')}</select></div>`;
    return `<div class="cad-field"><label for="cad-${key}">${label}<span>мм</span></label><div class="cad-values"><input type="range" data-range-for="${key}" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}"><input id="cad-${key}" data-cad-field="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}"></div></div>`;
  }
  function values(){return Object.fromEntries([...$('cad-parameter').querySelectorAll('[data-cad-field]')].map(el=>[el.dataset.cadField,el.tagName==='SELECT'?el.value:Number(el.value)]));}
  function showParameter(title,html,note,preview,done,options={}){
    closeContext();closeRadial();$('model-panel').classList.remove('model-options-open');$('model-settings-toggle').setAttribute('aria-expanded','false');
    $('cad-parameter').innerHTML=`<h3>${esc(title)}</h3>${note?`<p>${esc(note)}</p>`:''}${html}<div id="cad-error" class="cad-error" role="status"></div><div class="cad-actions-row"><button id="cad-cancel">Отмена</button><button id="cad-apply" class="cad-apply">Применить</button></div>`;
    $('cad-parameter').hidden=false;session={kind:options.kind||'body',preview,done,return2D:options.return2D||false};app.beginModelEdit();viewer()?.setPreview(options.ghost!==false);
    $('cad-cancel').onclick=cancelOperation;$('cad-apply').onclick=applyOperation;
    if(options.initial!==false)runPreview();
    $('cad-parameter').tabIndex=-1;$('cad-parameter').focus({preventScroll:true});
  }
  function runPreview(){
    previewFrame=0;if(!session?.preview)return;let success=false;
    try{success=session.preview(values())!==false;}catch(error){$('cad-error').textContent=error.message;return;}
    $('cad-error').textContent=success?[...new Set(app.getModelMesh()?.warnings||[])].slice(0,2).join(' '):app.getModelError()||'Проверьте значение параметра.';scheduleOverlay();
  }
  $('cad-parameter').addEventListener('input',event=>{
    const el=event.target;if(el.dataset.rangeFor){const input=$(`cad-${el.dataset.rangeFor}`);input.value=el.value;}
    else if(el.dataset.cadField){const range=$('cad-parameter').querySelector(`[data-range-for="${el.dataset.cadField}"]`);if(range)range.value=el.value;}
    if(!previewFrame)previewFrame=requestAnimationFrame(runPreview);
  });
  $('cad-parameter').addEventListener('change',event=>{if(event.target.matches('select'))runPreview();});
  function applyOperation(){
    if(previewFrame){cancelAnimationFrame(previewFrame);previewFrame=0;}
    runPreview();
    if(!session)return;const done=session.done;if(!app.commitModelEdit()){$('cad-error').textContent=app.getModelError();return;}
    session=null;$('cad-parameter').hidden=true;viewer()?.setPreview(false);task=null;$('cad-task').hidden=true;clearSketchHandles();done?.();renderContext();scheduleOverlay();
  }
  function cancelOperation(){
    if(previewFrame){cancelAnimationFrame(previewFrame);previewFrame=0;}
    const back=session?.return2D;session=null;app.cancelModelEdit();viewer()?.setPreview(false);$('cad-parameter').hidden=true;task=null;$('cad-task').hidden=true;clearSketchHandles();closeRadial();if(back)modelMode(false);renderContext();scheduleOverlay();
  }
  function startBodyParameter(action){
    const b=ensureBody();if(!b)return;cancelOperation();selected=[b.id];
    if(action==='height'){
      if(b.mode!=='extrude'){app.toast('Высота вытягивания меняется у прямого объёма. Для этой детали измените исходный профиль.');return;}
      showParameter('Высота детали',field('height','Высота',setting(b.id,'height',b.height),1,200,.1),'Потяните верхнюю грань или измените число.',v=>app.previewBodySetting(b.id,'height',v.height));
    }else if(action==='fillet'){
      if(b.mode!=='extrude'){app.toast('Скругление рёбер доступно для вытянутой детали.');return;}
      showParameter('Скругление рёбер',field('radius','Радиус',setting(b.id,'fillet',1),0,20,.1)+field('side','Какие рёбра',setting(b.id,'filletSide',lastHit?.normal?.[2]<-.5?'bottom':'top'),0,0,1,[['top','Верхний контур'],['bottom','Нижний контур'],['both','Оба контура']]),'Потяните маркер радиуса на рёбрах или задайте число. Округляется выбранный контур.',v=>app.previewBodySetting(b.id,'filletSide',v.side)&&app.previewBodySetting(b.id,'fillet',v.radius),null,{kind:'fillet'});
    }else if(action==='shell'){
      if(b.mode!=='extrude'){app.toast('Толщина стенок задаётся для вытянутой детали. Для трубы нарисуйте профиль с отверстием.');return;}
      showParameter('Полая деталь',field('thickness','Толщина стенок и дна',setting(b.id,'shell',2)||2,.2,Math.min(50,b.height-.1),.1),'Верх открывается, стенки и дно получают одинаковую толщину.',v=>app.previewBodySetting(b.id,'shell',v.thickness));
    }else if(action==='move'){
      const offset=setting(b.id,'offset',[0,0,0]);
      showParameter('Переместить деталь',['x','y','z'].map((k,i)=>field(k,`Смещение ${k.toUpperCase()}`,offset[i],-500,500,.5)).join(''),'Потяните деталь по плоскости или задайте координаты. Так можно совместить тела перед вычитанием.',v=>app.previewBodySetting(b.id,'offset',[v.x,v.y,v.z]),null,{kind:'move',ghost:false});
    }
  }
  function sourceDimension(action,id){
    const b=findBody(id)||ensureBody();if(!b)return;selected=[b.id];cancelOperation();
    const shapes=selectedShapes(b.id).map(copy);if(!shapes.length)return;
    if(action==='radius'){
      const circle=shapes.find(s=>s.type==='circle');if(!circle){app.toast('Выберите окружность.');return;}
      showParameter('Радиус контура',field('radius','Радиус',circle.r/4,.5,200,.1),'Изменение исходной окружности перестраивает объём.',v=>app.replaceSketchShape(circle.id,{...circle,r:v.radius*4},{preview:true}));return;
    }
    const axis=action==='length'?1:0,points=shapes.flatMap(shapePoints),min=Math.min(...points.map(p=>axis?p.y:p.x)),max=Math.max(...points.map(p=>axis?p.y:p.x)),size=(max-min)/4;
    const cx=(Math.min(...points.map(p=>p.x))+Math.max(...points.map(p=>p.x)))/2,cy=(Math.min(...points.map(p=>p.y))+Math.max(...points.map(p=>p.y)))/2;
    showParameter(action==='length'?'Длина контура':'Ширина контура',field('size','Размер',size,1,Math.max(300,size*2),.1),'Исходный контур и его отверстия масштабируются с сохранением пропорций.',v=>{
      const ratio=v.size/Math.max(.001,size),replacements=[];
      for(const shape of shapes){const next=copy(shape);if(next.points)next.points=next.points.map(p=>({x:cx+(p.x-cx)*ratio,y:cy+(p.y-cy)*ratio}));if(next.a)for(const k of ['a','b'])next[k]={x:cx+(next[k].x-cx)*ratio,y:cy+(next[k].y-cy)*ratio};if(next.cx!==undefined){next.cx=cx+(next.cx-cx)*ratio;next.cy=cy+(next.cy-cy)*ratio;next.r*=ratio;}replacements.push(next);}return app.replaceSketchShapes(replacements,{preview:true});
    });
  }
  function distanceParameter(){
    const a=findBody(selected[0]),b=findBody(selected[1]);if(!a||!b){app.toast('Выберите две детали с Shift или через операцию объединения.');return;}
    cancelOperation();const center=t=>t.bounds.min.map((n,i)=>(n+t.bounds.max[i])/2),ca=center(a),cb=center(b),delta=sub(cb,ca),d=length(delta),direction=d?delta.map(x=>x/d):[1,0,0],offset=setting(b.id,'offset',[0,0,0]);
    showParameter('Расстояние между центрами',field('distance','Расстояние',d,0,500,.1),'Перемещается вторая выбранная деталь.',v=>app.previewBodySetting(b.id,'offset',offset.map((n,i)=>n+direction[i]*(v.distance-d))),null,{ghost:false});
  }
  function booleanParameter(){
    const b=ensureBody(),all=bodies().slice();if(!b||all.length<2){app.toast('Для этой операции нужны две отдельные детали.');return;}
    cancelOperation();const second=findBody(selected[1])||all.find(x=>x.id!==b.id);selected=[b.id,second.id];
    showParameter('Операция с двумя телами',field('operation','Операция','union',0,0,1,[['union','Объединить'],['subtract','Вычесть вторую деталь'],['intersect','Оставить пересечение']])+field('tool','Вторая деталь',second.id,0,0,1,all.filter(x=>x.id!==b.id).map(x=>[x.id,x.name])),'Для выреза и пересечения совместите детали через «Переместить». Предпросмотр можно отменить.',v=>app.previewFeature({type:v.operation,target:b.id,tool:v.tool}),()=>{selected=[b.id];lastHit=null;},{kind:'boolean'});
  }
  function showTask(text,finishLabel='Готово'){$('cad-task').hidden=false;$('cad-task-text').textContent=text;$('cad-task-finish').textContent=finishLabel;closeContext();closeRadial();}
  function drawingTask(kind){
    const b=ensureBody();if(!b)return;cancelOperation();selected=[b.id];modelMode(false);internalTool=true;app.setTool('pencil');internalTool=false;setSelectionMode(false);
    task={kind,bodyId:b.id,points:[],hover:null};showTask(kind==='axis'?'Отметьте две точки оси вращения на листе.':'Отметьте точки траектории. Enter — показать объём.',kind==='axis'?'Ось слева':'Показать');scheduleOverlay();
  }
  function finishDrawingTask(){
    if(!task)return;
    if(task.kind==='edit'){if(!app.commitModelEdit()){app.toast(app.getModelError());return;}task=null;clearSketchHandles();$('cad-task').hidden=true;modelMode(true);return;}
    if(task.kind==='face'){closeFace();return;}
    if(task.kind==='axis'){
      const t=task,b=findBody(t.bodyId);let axis;
      if(t.points.length>=2){const [a,c]=t.points,dx=(c.x-a.x)/4,dy=-(c.y-a.y)/4;if(Math.hypot(dx,dy)<1){app.toast('Отметьте две разные точки оси.');return;}axis={point:[a.x/4,-a.y/4],direction:[dx,dy]};}
      else if(b){const points=selectedShapes(b.id).flatMap(shapePoints);axis={point:[Math.min(...points.map(p=>p.x))/4,0],direction:[0,1]};}else return;
      task=null;$('cad-task').hidden=true;modelMode(true);showParameter('Вращение профиля','', 'Профиль совершает полный оборот вокруг выбранной оси.',()=>app.previewBodySetting(t.bodyId,'axis',axis)&&app.previewBodySetting(t.bodyId,'mode','revolve'),null,{kind:'revolve'});
    }else if(task.kind==='path'){
      if(task.points.length<2){app.toast('Нужно не меньше двух точек траектории.');return;}
      const t=task,path=t.points.map(p=>[p.x/4,-p.y/4,0]);task=null;$('cad-task').hidden=true;modelMode(true);
      showParameter('Вдоль траектории','', 'Профиль разворачивается поперёк пути. Для полой трубы используйте контур с отверстием.',()=>app.previewBodySetting(t.bodyId,'path',path)&&app.previewBodySetting(t.bodyId,'mode','sweep'),null,{kind:'sweep'});
    }
  }
  function startFace(){
    const b=ensureBody();if(!b)return;const hit=lastHit;if(!hit||hit.bodyId!==b.id){app.toast('Сначала нажмите на грань, на которой хотите рисовать.');return;}
    const plane=viewer().getFace(hit);if(!plane){app.toast('Выберите плоскую грань.');return;}
    cancelOperation();selected=[b.id];task={kind:'face',bodyId:b.id,plane,points:[],hover:null};showTask('Отметьте вершины на грани. Первая точка или Enter замыкает контур.','Замкнуть');viewer().setAutoRotate(false);scheduleOverlay();
  }
  function closeFace(){
    if(task?.kind!=='face'||task.points.length<3){app.toast('Добавьте хотя бы три вершины на грани.');return;}
    const t=task,offset=setting(t.bodyId,'offset',[0,0,0]),body=findBody(t.bodyId),placement=window.LabAssemblyGeometry;
    const points=t.points.map(p=>sub(placement?.unplacePoint?.(body,p)||p,offset));
    const normal=placement?.unplaceDirection?.(body,t.plane.normal)||t.plane.normal;
    task=null;$('cad-task').hidden=true;
    showParameter('Контур на грани',field('operation','Действие','add',0,0,1,[['add','Вытянуть наружу'],['cut','Вырезать карман']])+field('depth','Глубина',5,.1,200,.1),'Контур остаётся связан с деталью при её перемещении.',v=>app.previewFeature({type:v.operation,target:t.bodyId,points,normal,depth:v.depth}),null,{kind:'face'});
  }
  function shapePoints(s){if(s.points)return s.points;if(s.a)return [s.a,s.b];if(s.cx!==undefined)return [{x:s.cx-s.r,y:s.cy-s.r},{x:s.cx+s.r,y:s.cy+s.r}];return [];}
  function startEdit(){
    const b=ensureBody();if(!b)return;cancelOperation();const shapes=selectedShapes(b.id).map(copy);if(!shapes.length)return;
    const state=app.getState();if(shapes.some(s=>state.layers.find(l=>l.id===s.layer)?.locked)){app.toast('Разблокируйте слой исходного контура.');return;}
    selected=[b.id];modelMode(false);internalTool=true;app.setTool('pencil');internalTool=false;setSelectionMode(false);app.beginModelEdit();task={kind:'edit',bodyId:b.id,shapes};showTask('Перетаскивайте вершины. Готово — вернуться к объёму.');renderSketchHandles();
  }
  function clearSketchHandles(){$('cad-edit-layer').innerHTML='';}
  function renderSketchHandles(){
    if(task?.kind!=='edit'){clearSketchHandles();return;}
    const scale=paper.getScreenCTM()?.a||1,r=5/scale;let html='';
    for(const original of task.shapes){const s=app.getSketchShape(original.id);if(!s)continue;
      const pointHandle=(p,type,index)=>`<circle class="cad-edit-handle" data-shape-id="${esc(s.id)}" data-handle-type="${type}" data-point-index="${index}" cx="${p.x}" cy="${p.y}" r="${r}" stroke-width="${1.4/scale}"/>`;
      if(s.points){const first=s.points[0],last=s.points.at(-1);const pts=first.x===last.x&&first.y===last.y?s.points.slice(0,-1):s.points;html+=`<polyline class="cad-edit-line" points="${s.points.map(p=>`${p.x},${p.y}`).join(' ')}" stroke-width="${1/scale}"/>`;pts.forEach((p,i)=>html+=pointHandle(p,'point',i));}
      else if(s.a){html+=pointHandle(s.a,'a',0)+pointHandle(s.b,'b',1);}
      else if(s.cx!==undefined){html+=pointHandle({x:s.cx,y:s.cy},'center',0)+pointHandle({x:s.cx+s.r,y:s.cy},'radius',0);}
    }
    $('cad-edit-layer').innerHTML=html;
  }
  function setSelectionMode(value){selectionMode=value;body.classList.toggle('cad-selecting',value);$('cad-select').setAttribute('aria-pressed',String(value));}
  function nearestSketch(p){
    return app.getSketchHits(p,18/(paper.getScreenCTM()?.a||1))[0]||null;
  }
  wrap.addEventListener('pointerdown',event=>{
    if(event.button>0)return;
    if(task&&['axis','path'].includes(task.kind)){event.preventDefault();event.stopImmediatePropagation();const p=app.getPaperPoint(event);task.points.push(p);task.hover=null;scheduleOverlay();if(task.kind==='axis'&&task.points.length===2)finishDrawingTask();return;}
    if(task?.kind==='edit'){
      event.preventDefault();event.stopImmediatePropagation();const h=event.target.closest('.cad-edit-handle');if(!h)return;const shape=app.getSketchShape(h.dataset.shapeId),type=h.dataset.handleType,index=Number(h.dataset.pointIndex),p=type==='point'?shape.points[index]:type==='a'||type==='b'?shape[type]:{x:shape.cx,y:shape.cy};
      drag={kind:'vertex',id:event.pointerId,type,index,shapeId:shape.id,point:p,shapes:task.shapes.map(s=>app.getSketchShape(s.id))};wrap.setPointerCapture(event.pointerId);return;
    }
    if(selectionMode){event.preventDefault();event.stopImmediatePropagation();const shape=nearestSketch(app.getPaperPoint(event));if(!shape){selected=[];scheduleOverlay();return;}const sourceBody=()=>bodies().find(part=>part.sourceIndices.includes(shape.index));selected=[sourceBody()?.id||`body-${shape.id}`];modelMode(true);requestAnimationFrame(()=>{const selectedBody=findBody(selected[0])||sourceBody();if(selectedBody)setSelection([selectedBody.id],null,{x:event.clientX,y:event.clientY});});}
  },true);
  wrap.addEventListener('pointermove',event=>{
    if(task&&['axis','path'].includes(task.kind)){event.stopImmediatePropagation();task.hover=app.getPaperPoint(event);scheduleOverlay();return;}
    if(drag?.kind!=='vertex'||drag.id!==event.pointerId)return;event.preventDefault();event.stopImmediatePropagation();const p=app.getPaperPoint(event),d=drag;
    if(d.type==='center'||d.type==='radius'){
      const s=copy(d.shapes.find(s=>s.id===d.shapeId));if(d.type==='center'){s.cx=p.x;s.cy=p.y;}else s.r=Math.max(2,Math.hypot(p.x-s.cx,p.y-s.cy));app.replaceSketchShape(s.id,s,{preview:true});
    }else {const replacements=d.shapes.map(original=>{const s=copy(original),change=q=>Math.hypot(q.x-d.point.x,q.y-d.point.y)<.5?{x:p.x,y:p.y}:q;if(s.points)s.points=s.points.map(change);if(s.a){s.a=change(s.a);s.b=change(s.b);}return s;});app.replaceSketchShapes(replacements,{preview:true});}
    renderSketchHandles();
  },true);
  wrap.addEventListener('pointerup',event=>{if(drag?.kind==='vertex'&&drag.id===event.pointerId){event.preventDefault();event.stopImmediatePropagation();drag=null;if(wrap.hasPointerCapture(event.pointerId))wrap.releasePointerCapture(event.pointerId);}},true);
  canvas.addEventListener('pointerdown',event=>{
    if(event.button>0)return;
    if(task?.kind==='face'){
      event.preventDefault();event.stopImmediatePropagation();const p=planePoint(event,task.plane);if(!p){app.toast('Поверните грань ближе к камере.');return;}
      const first=task.points[0]&&viewer().project(task.points[0]);if(first&&task.points.length>=3&&Math.hypot(first.x-event.clientX,first.y-event.clientY)<14){closeFace();return;}
      task.points.push(p);task.hover=null;scheduleOverlay();return;
    }
    if(session?.kind==='move'){
      const hit=viewer()?.pick(event.clientX,event.clientY),b=current();if(!hit||hit.bodyId!==b?.id)return;
      event.preventDefault();event.stopImmediatePropagation();const plane={origin:hit.point,normal:[0,0,1]},p=planePoint(event,plane);if(!p)return;
      drag={kind:'move',id:event.pointerId,plane,start:p,offset:setting(b.id,'offset',[0,0,0]),bodyId:b.id};canvas.setPointerCapture(event.pointerId);
    }
  },true);
  canvas.addEventListener('pointermove',event=>{
    if(task?.kind==='face'){event.stopImmediatePropagation();task.hover=planePoint(event,task.plane);scheduleOverlay();}
    if(drag?.kind==='move'&&drag.id===event.pointerId){event.preventDefault();event.stopImmediatePropagation();const p=planePoint(event,drag.plane);if(!p)return;const offset=add(drag.offset,sub(p,drag.start));['x','y','z'].forEach((k,i)=>{$(`cad-${k}`).value=offset[i].toFixed(2);});app.previewBodySetting(drag.bodyId,'offset',offset);}
  },true);
  canvas.addEventListener('pointerup',event=>{if(drag?.kind==='move'&&drag.id===event.pointerId){event.stopImmediatePropagation();drag=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);}},true);
  for(const element of [wrap,canvas])element.addEventListener('pointercancel',event=>{if(drag?.id===event.pointerId){drag=null;cancelOperation();}},true);
  overlay.addEventListener('pointerdown',event=>{
    const grip=event.target.closest('[data-grip]');if(!grip)return;event.preventDefault();const id=grip.dataset.body,part=findBody(id);if(!part)return;
    const mmPerPixel=2*(viewer().lastProjection?.halfHeight||part.height)/canvas.getBoundingClientRect().height;
    if(grip.dataset.grip==='radius'&&session?.kind==='fillet'){drag={kind:'radius',id:event.pointerId,start:event.clientX,radius:Number($('cad-radius').value),mmPerPixel};overlay.setPointerCapture(event.pointerId);return;}
    const keepSession=Boolean(session&&['extrusion','body'].includes(session.kind)&&$('cad-height'));
    if(session&&!keepSession)cancelOperation();selected=[id];app.beginModelEdit();viewer().setPreview(true);drag={kind:'height',id:event.pointerId,bodyId:id,start:event.clientY,height:setting(id,'height',part.height),keepSession,mmPerPixel:mmPerPixel/Math.max(.35,Math.cos(viewer().pitch))};overlay.setPointerCapture(event.pointerId);
  });
  overlay.addEventListener('pointermove',event=>{if(drag?.id!==event.pointerId)return;if(drag.kind==='height')app.previewBodySetting(drag.bodyId,'height',clamp(drag.height+(drag.start-event.clientY)*drag.mmPerPixel,1,200));if(drag.kind==='radius'){$('cad-radius').value=clamp(drag.radius+(event.clientX-drag.start)*drag.mmPerPixel,0,20).toFixed(2);runPreview();}});
  overlay.addEventListener('pointerup',event=>{if(drag?.id!==event.pointerId)return;const d=drag;drag=null;if(d.kind==='height'&&!d.keepSession){if(!app.commitModelEdit())app.cancelModelEdit();viewer()?.setPreview(false);}if(overlay.hasPointerCapture(event.pointerId))overlay.releasePointerCapture(event.pointerId);scheduleOverlay();});
  overlay.addEventListener('pointercancel',()=>{if(drag){drag=null;cancelOperation();}});
  overlay.addEventListener('click',event=>{const label=event.target.closest('[data-dimension]');if(!label)return;selected=[label.dataset.body,...(label.dataset.dimension==='distance'?selected.slice(1):[])];const action=label.dataset.dimension;if(action==='height')startBodyParameter('height');else if(action==='distance')distanceParameter();else sourceDimension(action,label.dataset.body);});
  overlay.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
  canvas.addEventListener('labmodelselect',event=>{
    if(task||session||externalEdit())return;const {hit,clientX,clientY,shiftKey}=event.detail;if(!hit?.bodyId){setSelection([]);return;}
    const ids=shiftKey?(selected.includes(hit.bodyId)?selected.filter(id=>id!==hit.bodyId):[...selected,hit.bodyId].slice(-2)):[hit.bodyId];setSelection(ids,hit,{x:clientX,y:clientY});
  });
  canvas.addEventListener('labmodeledit',event=>{if(!externalEdit()&&event.detail.hit?.bodyId){setSelection([event.detail.hit.bodyId],event.detail.hit);startEdit();}});
  canvas.addEventListener('labmodelrender',scheduleOverlay);
  function openRadial(x=lastPointer.x,y=lastPointer.y){
    if(task||session||externalEdit())return;const b=current();const menu=$('cad-radial');
    const items=[['height','↥','Высота'],['face','✎','На грани'],['fillet','⌒','Скруглить'],['shell','▱','Полая деталь'],['revolve','↻','Вращение'],['sweep','∿','Вдоль пути'],['move','✥','Переместить'],['boolean','◫','Операции'],['edit','◇','Изменить контур'],['focus','◎','Фокус детали'],['technical','⌗','Чертёжный вид'],['present','▷','Презентация']];
    menu.innerHTML=`<div class="radial-caption"><span>${b?esc(b.name):'Операции на холсте'}</span><button id="cad-workshop" data-cad-action="workshop">Мастерская ↗</button><button id="cad-radial-close" aria-label="Закрыть">×</button></div>`+items.map(([action,symbol,title],i)=>{const a=i*Math.PI/6-Math.PI/2;return `<button data-cad-action="${action}" style="--rx:${50+39*Math.cos(a)}%;--ry:${50+39*Math.sin(a)}%"${!b&&!['technical','present'].includes(action)?' disabled':''}><b>${symbol}</b><span>${title}</span></button>`;}).join('');menu.hidden=false;const r=menu.getBoundingClientRect();menu.style.left=`${clamp(x-r.width/2,10,Math.max(10,innerWidth-r.width-10))}px`;menu.style.top=`${clamp(y-r.height/2,70,Math.max(70,innerHeight-r.height-12))}px`;$('cad-radial-close').onclick=closeRadial;
  }
  function action(name){
    window.LabCaliper?.close();
    window.LabDraftingSketchTools?.close();
    closeRadial();if(name==='workshop'){window.LabWorkshop?.open();return;}if(['height','fillet','shell','move'].includes(name))startBodyParameter(name);
    else if(name==='more')openRadial();else if(name==='face')startFace();else if(name==='boolean')booleanParameter();else if(name==='distance')distanceParameter();else if(name==='edit')startEdit();
    else if(name==='revolve')drawingTask('axis');else if(name==='sweep')drawingTask('path');else if(name==='focus'){const b=ensureBody();if(b){focusBody=!focusBody;viewer()?.setFocusBody(focusBody?b.id:null);app.toast(focusBody?'Выбранная деталь в фокусе. Повторное нажатие вернёт остальные.':'Все детали снова видны.');}}
    else if(name==='technical')toggleTechnical();else if(name==='present')presentation(true);
  }
  for(const id of ['cad-radial','cad-context'])$(id).addEventListener('click',event=>{const button=event.target.closest('[data-cad-action]');if(button)action(button.dataset.cadAction);});
  function toggleTechnical(){const enabled=$('cad-technical').getAttribute('aria-pressed')!=='true';$('cad-technical').setAttribute('aria-pressed',String(enabled));viewer()?.setTechnical(enabled);}
  function presentation(enabled){
    if(enabled&&!viewer()?.mesh){app.toast('Сначала создайте объём.');return;}
    if(enabled){cancelOperation();setIntegrated(true);closeContext();closeRadial();viewer().setFocusBody(null);viewer().setPaper({enabled:false});viewer().setGroundVisible(false);viewer().setAutoRotate(true);}
    else {viewer()?.cancelRecording();viewer()?.setAutoRotate(false);viewer()?.setGroundVisible(true);setIntegrated(integrated);}
    presenting=enabled;body.classList.toggle('cad-presenting',enabled);$('cad-presentation').hidden=!enabled;$('cad-spin').setAttribute('aria-pressed',String(Boolean(viewer()?.autoRotate)));$('cad-spin').textContent=viewer()?.autoRotate?'Ⅱ Пауза':'▷ Вращать';
  }
  function download(blob,ext){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`Модель-${new Date().toISOString().slice(0,10)}.${ext}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  $('cad-png').addEventListener('click',async()=>{try{download(await viewer().getImage({transparent:true,width:1600,height:1200}),'png');app.toast('PNG с прозрачным фоном готов.');}catch(error){app.toast(error.message);}});
  $('cad-video').addEventListener('click',async()=>{
    if(recording){viewer()?.cancelRecording();return;}recording=true;$('cad-video').textContent='■ Остановить';$('cad-png').disabled=true;$('cad-spin').disabled=true;
    try{const blob=await viewer().recordTurntable({duration:6000});if(blob.size){download(blob,blob.type.includes('mp4')?'mp4':'webm');app.toast('Видео вращения готово.');}}
    catch(error){app.toast(error.message);}finally{recording=false;$('cad-video').textContent='● Видео 6 с';$('cad-png').disabled=false;$('cad-spin').disabled=false;}
  });
  $('cad-spin').addEventListener('click',()=>{const enabled=$('cad-spin').getAttribute('aria-pressed')!=='true';const active=viewer()?.setAutoRotate(enabled);$('cad-spin').setAttribute('aria-pressed',String(Boolean(active)));$('cad-spin').textContent=active?'Ⅱ Пауза':'▷ Вращать';if(enabled&&!active)app.toast('Автовращение отключено настройкой уменьшения движения.');});
  canvas.addEventListener('labmodelautorotate',event=>{$('cad-spin').setAttribute('aria-pressed',String(event.detail.enabled));$('cad-spin').textContent=event.detail.enabled?'Ⅱ Пауза':'▷ Вращать';});
  $('cad-presentation-close').addEventListener('click',()=>presentation(false));$('cad-present').addEventListener('click',()=>presentation(true));$('cad-technical').addEventListener('click',toggleTechnical);
  $('cad-back').addEventListener('click',()=>{cancelOperation();modelMode(false);});$('cad-detach').addEventListener('click',()=>setIntegrated(!integrated));$('cad-actions').addEventListener('click',()=>openRadial(innerWidth/2,innerHeight/2));
  $('cad-select').addEventListener('click',()=>{cancelOperation();setSelectionMode(!selectionMode);if(selectionMode)app.toast('Нажмите на контур, чтобы выбрать и изменить его.');});
  $('cad-task-finish').addEventListener('click',finishDrawingTask);$('cad-task-cancel').addEventListener('click',()=>{const was2D=task&&['edit','axis','path'].includes(task.kind);cancelOperation();if(was2D)modelMode(true);});
  document.addEventListener('pointermove',event=>{lastPointer={x:event.clientX,y:event.clientY};if(longPress&&Math.hypot(event.clientX-longPress.x,event.clientY-longPress.y)>9){clearTimeout(longPress.timer);longPress=null;}},{passive:true});
  // Some touch browsers dispatch a click on release at the newly opened menu.
  document.addEventListener('pointerdown',()=>{suppressLongPressClick=false;},true);
  document.addEventListener('click',event=>{
    if(!suppressLongPressClick||!event.detail)return;
    suppressLongPressClick=false;event.preventDefault();event.stopImmediatePropagation();
  },true);
  for(const element of [wrap,canvas])element.addEventListener('pointerdown',event=>{
    if(task||session||externalEdit()||event.pointerType!=='touch')return;if(longPress)clearTimeout(longPress.timer);
    longPress={x:event.clientX,y:event.clientY,timer:setTimeout(()=>{
      if(element===canvas){const hit=viewer()?.pick(event.clientX,event.clientY);if(hit?.bodyId)setSelection([hit.bodyId],hit,{x:event.clientX,y:event.clientY});}
      else app.setTool(app.getState().tool);
      openRadial(event.clientX,event.clientY);
      suppressLongPressClick=!$('cad-radial').hidden;
      longPress=null;
    },550)};
  });
  for(const type of ['pointerup','pointercancel'])document.addEventListener(type,()=>{if(longPress)clearTimeout(longPress.timer);longPress=null;},{passive:true});
  document.addEventListener('keydown',event=>{
    if(!task||!(event.ctrlKey||event.metaKey)||!['KeyZ','KeyY'].includes(event.code)||/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(task.kind==='edit'){cancelOperation();modelMode(true);return;}
    task.future??=[];if(event.code==='KeyY'||event.shiftKey){const p=task.future.pop();if(p)task.points.push(p);}else{const p=task.points.pop();if(p)task.future.push(p);}
    task.hover=null;scheduleOverlay();
  },true);
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('#cad-radial,#cad-actions,#cad-context'))closeRadial();});
  document.addEventListener('keydown',event=>{
    if($('welcome-dialog').open||$('action-dialog').open||event.ctrlKey||event.metaKey||event.altKey||event.defaultPrevented||
      window.LabDrawingSheet?.active()||window.LabMeasurementJournal?.active()||window.LabExperimentUI?.active())return;
    if(event.key==='Escape'){
      if(presenting){event.preventDefault();presentation(false);}else if(task||session){event.preventDefault();const edit=task?.kind==='edit';cancelOperation();if(edit)modelMode(true);}else closeRadial();return;
    }
    if(/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))return;
    if(event.code==='Space'&&!document.activeElement.closest('button,a,[role=button]')){event.preventDefault();openRadial();}
    if(event.code==='KeyV'&&!app.isModelOpen()){event.preventDefault();setSelectionMode(!selectionMode);}
    if(event.key==='Enter'&&task){event.preventDefault();finishDrawingTask();}
  });
  document.addEventListener('labchange',event=>{
    const {kind,open}=event.detail;
    if(kind==='project'){
      selected=[];lastHit=null;focusBody=false;
      viewer()?.setFocusBody(null);
      setSelectionMode(false);
      cancelOperation();
      clearTimeout(longPress?.timer);longPress=null;
      if(presenting)presentation(false);
    }
    if(kind==='model'){
      if(open){if(task&&['edit','axis','path'].includes(task.kind))cancelOperation();setIntegrated(integrated);}
      else {if(session||task?.kind==='face')cancelOperation();body.classList.remove('cad-integrated');$('cad-controls').hidden=true;closeContext();}
      scheduleOverlay();
    }
    if(kind==='modelgeometry'){if(!session?.kind||session.kind!=='boolean')selected=selected.filter(id=>findBody(id));scheduleOverlay();}
    if(kind==='modelerror'&&$('cad-error'))$('cad-error').textContent=app.getModelError();
    if(kind==='tool'&&!internalTool){if(task||session)cancelOperation();setSelectionMode(false);if(app.isModelOpen())modelMode(false);}
    if(kind==='viewport'){if(task?.kind==='edit')renderSketchHandles();scheduleOverlay();}
    if(kind==='bodysetting'&&event.detail.key==='height'&&session&&$('cad-height')){const value=setting(event.detail.id,'height',20);$('cad-height').value=value;const range=$('cad-parameter').querySelector('[data-range-for=height]');if(range)range.value=value;}
    if(kind==='modelpreview'&&!event.detail.active){
      if(!event.detail.committed&&(session||task)){const edit=task?.kind==='edit';session=null;task=null;drag=null;$('cad-parameter').hidden=true;$('cad-task').hidden=true;clearSketchHandles();if(edit)modelMode(true);}
      viewer()?.setPreview(false);scheduleOverlay();
    }
  });
  document.addEventListener('labcontourclosed',event=>{
    if(task||session)return;
    modelMode(true,true);const b=bodies().find(b=>selectedShapes(b.id).some(s=>s.id===event.detail.shapeId));
    if(!b)return;selected=[b.id];lastHit=null;
    showParameter('Из контура в объём',field('height','Высота',setting(b.id,'height',b.height),1,200,.1),'Полупрозрачная модель — предпросмотр. Потяните грань или задайте высоту и подтвердите.',v=>app.previewBodySetting(b.id,'height',v.height),null,{kind:'extrusion',return2D:true,initial:false});
  });
  new MutationObserver(()=>{if(body.classList.contains('focus-mode')&&body.classList.contains('cad-integrated'))$('model-panel').inert=false;}).observe(body,{attributes:true,attributeFilter:['class']});
  window.addEventListener('resize',()=>{scheduleOverlay();renderContext();});
  window.addEventListener('pagehide',()=>viewer()?.cancelRecording());
  window.LabCAD={getHit:()=>lastHit?copy(lastHit):null,getState:()=>({integrated,selected:selected.slice(),task:task?.kind||null,operation:session?.kind||null,selectionMode,presenting}),select:(id)=>setSelection([id]),action,modelMode,cancel:cancelOperation,apply:applyOperation,openRadial};
})();
