/* Contextual tools for profile construction, bending, feature arrays and lettering. */
(() => {
  'use strict';
  const app = window.LabApp;
  const cad = window.LabCAD;
  const canvas = document.getElementById('model-canvas');
  const svgNS = 'http://www.w3.org/2000/svg';
  const titles = {
    loft: 'По сечениям', fold: 'Сгиб листа', pattern: 'Массив элементов', text: 'Надпись на грани',
    mirror: 'Ось симметрии', tracing: 'Фото как калька', loupe: 'Лупа', explode: 'Разнести сборку',
    hinge: 'Проверить шарнир', thickness: 'Толщина стенок', light: 'Направить свет', compare: 'Сравнить варианты',
    constraints: 'Связи эскиза', history: 'История детали', planes: 'Рабочие плоскости',
    fastener: 'Отверстие под винт', mates: 'Стыковка деталей', drawing: 'Чертёж А4',
    print: 'Проверка 3D-печати', theme: 'Серо-синяя тема', tour: 'Маршрут камеры',
    caliper: 'Штангенциркуль 2D/3D', 'contour-check': 'Проверка контура',
    'driving-dimension': 'Управляющий размер', tolerance: 'Проверка допуска', journal: 'Журнал измерений',
    experiment: 'Эксперимент', 'advanced-modeling':'Расширенное моделирование'
  };
  const menu = document.createElement('section');
  menu.id = 'workshop-menu'; menu.className = 'workshop-popup glass'; menu.hidden = true;
  menu.setAttribute('aria-label', 'Мастерская');
  const panel = document.createElement('section');
  panel.id = 'workshop-operation'; panel.className = 'workshop-popup glass'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Настройки построения');
  const guides = document.createElementNS(svgNS, 'svg');
  guides.id = 'workshop-guides';
  const inscription = document.createElement('input');
  inscription.id='workshop-inscription'; inscription.type='text'; inscription.maxLength=32;
  inscription.required=true; inscription.hidden=true; inscription.autocomplete='off'; inscription.spellcheck=false;
  inscription.dataset.workshopField='text'; inscription.setAttribute('aria-label','Надпись на грани');
  inscription.placeholder='Введите надпись';
  inscription.addEventListener('input',()=>{if(edit?.key==='text'){edit.text=inscription.value;schedulePreview();}});
  document.body.append(menu, guides, panel, inscription);
  let edit = null, timer = 0, frame = 0, grip = null;
  const viewer = () => app.getModelViewer();
  const toLocal = p => (window.LabAssemblyGeometry?.unplacePoint(edit.body,p)||p).map((x,i)=>x-edit.body.offset[i]);
  const toWorld = p => {
    const point=p.map((x,i)=>x+edit.body.offset[i]);
    return window.LabAssemblyGeometry?.placePoint(edit.body,point)||point;
  };
  const center = points => points[0].map((_, k) => points.reduce((sum,p) => sum+p[k], 0) / points.length);
  const dot = (a,b) => a.reduce((sum,x,i) => sum+x*b[i],0);
  const length = a => Math.hypot(...a);
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const round = n => Math.round(n*100)/100;
  function el(tag, props = {}, text = '') {
    const node = document.createElement(tag);
    Object.assign(node, props); if(text) node.textContent = text; return node;
  }
  function button(text, action, fn) {
    const node = el('button', {type:'button'}, text);
    node.dataset.workshopAction = action; node.addEventListener('click', fn); return node;
  }
  function title(container, text, close) {
    const h = el('div',{className:'workshop-heading'});
    const x = button('×', 'close', close); x.setAttribute('aria-label','Закрыть');
    h.append(el('strong',{},text), x); container.append(h);
  }
  function dismissMenu(){ menu.hidden = true; }
  function closeCompanions(){
    window.LabSketchExtras?.close();
    window.LabInspect?.close();
    window.LabDesignEdit?.close();
    window.LabAssemblyTools?.close();
    window.LabDrawingSheet?.close();
    window.LabCanvasVisual?.close();
    window.LabDraftingSketchTools?.close();
    window.LabCaliper?.close();
    window.LabMeasurementJournal?.close();
    window.LabExperimentUI?.close();
    window.LabSolidUpgrade?.close();
  }
  function open(){
    if(edit) cancel();
    closeCompanions();
    document.getElementById('cad-radial').hidden = true;
    if(!document.getElementById('studio-menu').hidden) document.getElementById('menu-close').click();
    menu.replaceChildren(); title(menu,'Мастерская',dismissMenu);
    const groups = [
      ['Эскиз',['contour-check','driving-dimension','constraints','mirror','tracing','loupe']],
      ['Построение',['planes','fastener','loft','fold','pattern','text','mates','history']],
      ['Детали и сборки',['advanced-modeling']],
      ['Осмотр',['explode','hinge','thickness','compare','light','print']],
      ['Измерения',['caliper','tolerance','journal','experiment']],
      ['Чертёж и показ',['drawing','tour','theme']]
    ];
    for(const [heading,keys] of groups){
      const group = el('div',{className:'workshop-group'}); group.append(el('h3',{},heading));
      for(const key of keys) group.append(button(titles[key],key,()=>run(key)));
      menu.append(group);
    }
    menu.hidden=false;menu.querySelector('button').focus({preventScroll:true});
  }
  function reset(){
    if(!edit) return;
    clearTimeout(timer); cancelAnimationFrame(frame); timer=frame=0;
    if(edit.restoreHeightDrag)viewer()?.setHeightDrag(true);
    inscription.hidden=true; edit=null; grip=null; panel.hidden=true; guides.replaceChildren(); document.body.classList.remove('workshop-editing');
    viewer()?.setPreview(false);
  }
  function cancel(){if(!edit)return;reset(); app.cancelModelEdit();}
  function run(key){
    dismissMenu();
    if(!Object.hasOwn(titles,key))return;
    const selection=cad.getState();
    const independentTool=['caliper','contour-check','driving-dimension','tolerance','journal','experiment'].includes(key);
    if(independentTool&&(edit||app.isModelEditing()||selection.task||selection.operation)){
      app.toast('Завершите текущую операцию перед выбором другого инструмента.');return;
    }
    if(edit)cancel();
    closeCompanions();
    if(selection.task||selection.operation)cad.cancel();
    if(key==='experiment'){window.LabExperimentUI.open();return;}
    if(key==='advanced-modeling'){window.LabSolidUpgrade.open();return;}
    if(key==='caliper'){window.LabCaliper.run();return;}
    if(key==='tolerance'||key==='journal'){window.LabMeasurementJournal.open(null,{mode:key});return;}
    if(key==='contour-check'||key==='driving-dimension'){
      if(app.isModelOpen())cad.modelMode(false);
      window.LabDraftingSketchTools.run(key==='contour-check'?'check':'dimension');return;
    }
    if(key==='theme'){window.LabCanvasVisual.run('theme');return;}
    if(key==='constraints'){
      if(app.isModelOpen())cad.modelMode(false);
      window.LabDesignEdit.run(key);return;
    }
    if(['mirror','tracing','loupe'].includes(key)){
      if(app.isModelOpen())cad.modelMode(false);
      window.LabSketchExtras.run(key); return;
    }
    if(!app.isModelOpen())cad.modelMode(true,false);
    if(!app.getModelMesh()?.positions.length||!viewer()?.supported){app.toast('Для этой операции откройте объём из замкнутого контура.');return;}
    if(['hinge','explode','thickness','light','compare','print'].includes(key)){
      if(key==='light'&&!cad.getState().presenting)cad.action('present');
      window.LabInspect.run(key);return;
    }
    if(['planes','fastener','mates'].includes(key)){window.LabAssemblyTools.run(key);return;}
    if(key==='history'){window.LabDesignEdit.run(key);return;}
    if(key==='drawing'){window.LabDrawingSheet.open();return;}
    if(key==='tour'){window.LabCanvasVisual.run(key);return;}
    const parts=app.getBodies();const part=parts.find(b=>b.id===selection.selected[0])||parts[0];
    if(!part)return;
    const oldHit=cad.getHit();const hit=oldHit?.bodyId===part.id?oldHit:null;
    edit={key,body:part,mode:'',valid:false,signature:null};
    const bounds=part.baseBounds||part.bounds, off=part.offset;
    const lo=bounds.min.map((x,i)=>x-off[i]), hi=bounds.max.map((x,i)=>x-off[i]);
    edit.center=lo.map((n,i)=>(n+hi[i])/2);edit.size=Math.max(1,Math.min(hi[0]-lo[0],hi[1]-lo[1]));
    edit.z=hi[2];
    if(key==='loft'){
      edit.sections=[];edit.index=0;addSection('rectangle');
    }else if(key==='fold'){
      if(!['extrude','fold'].includes(part.mode)){reset();app.toast('Для сгиба выберите вытянутую плоскую заготовку.');return;}
      edit.z=part.height;
      edit.line=[[lo[0],edit.center[1]],[hi[0],edit.center[1]]];edit.angle=45;
    }else if(key==='pattern'){
      edit.seeds=patternSources(part);if(!edit.seeds.length){reset();app.toast('Сначала начертите отверстие внутри контура или создайте выступ на грани детали.');return;}
      edit.seed=0;
      if(hit){const p=toLocal(hit.point);edit.seed=edit.seeds.reduce((best,s,i,list)=>length(center(s.source.points).map((n,k)=>n-p[k]))<length(center(list[best].source.points).map((n,k)=>n-p[k]))?i:best,0);}
      edit.count=3;edit.layout='linear';edit.direction=[1,0,0];edit.step=Math.max(2,round(edit.size/5));edit.sweep=360;
      configureSeed(edit.seed);
    }else{
      edit.text='АБ';edit.fontSize=round(clamp(edit.size/8,2,10));edit.depth=.65;edit.operation='cut';
      if(hit)placeText(hit);else edit.mode='text-point';
    }
    edit.restoreHeightDrag=viewer().heightDragEnabled;viewer().setHeightDrag(false);
    app.beginModelEdit();viewer().setAutoRotate(false);viewer().setPreview(true);document.body.classList.add('workshop-editing');
    renderPanel();preview();scheduleGuides();
  }
  function patternSources(part){
    const list=[],analysis=app.getAnalysis(),root=part.sourceLoop;
    if(part.mode==='extrude'){
      for(const loop of analysis?.loops||[]){
        if(loop.parent!==root||loop.depth%2!==1)continue;
        // Feature profiles are stored in the part's unmoved millimetre coordinates.
        list.push({name:`Отверстие ${list.length+1}`,source:{type:'cut',points:loop.points.map(p=>[p.x/4,-p.y/4,part.height]),normal:[0,0,1],depth:part.height}});
      }
    }
    for(const f of app.getState().modelFeatures){
      if(f.target===part.id&&['add','cut'].includes(f.type))list.push({name:`${f.type==='add'?'Выступ':'Карман'} ${list.length+1}`,source:{points:f.points,normal:f.normal,type:f.type,depth:f.depth}});
    }
    return list;
  }
  function configureSeed(index){
    const e=edit; e.seed=index;
    const source=e.seeds[index].source, origin=center(source.points);
    const distance=dot(e.center.map((x,i)=>x-origin[i]),source.normal);
    e.patternCenter=e.center.map((x,i)=>x-source.normal[i]*distance);
    e.direction=baseline(source.normal);
    if(dot(e.center.map((x,i)=>x-origin[i]),e.direction)<0)e.direction=e.direction.map(x=>-x);
  }
  function baseline(normal){
    const axis=Math.abs(normal[0])<.85?[1,0,0]:[0,1,0];
    const projected=axis.map((n,i)=>n-dot(axis,normal)*normal[i]);return projected.map(x=>x/length(projected));
  }
  function placeText(hit){
    edit.origin=toLocal(hit.point);
    edit.normal=window.LabAssemblyGeometry?.unplaceDirection(edit.body,hit.normal)||hit.normal.slice();
    edit.u=baseline(edit.normal);edit.mode='';
  }
  function sectionPoints(type,small){
    const [cx,cy]=edit.center;const r=small||edit.size*.33;
    if(type==='circle')return Array.from({length:40},(_,i)=>[cx+r*Math.cos(i*Math.PI/20),cy+r*Math.sin(i*Math.PI/20)]);
    return [[cx-r,cy-r],[cx+r,cy-r],[cx+r,cy+r],[cx-r,cy+r]];
  }
  function sectionPoint(section,point,inverse=false){
    let crossSum=0,xSum=0,ySum=0;
    const points=section.points;
    points.forEach(([x,y],i)=>{
      const [a,b]=points[(i+1)%points.length],cross=x*b-y*a;
      crossSum+=cross;xSum+=(x+a)*cross;ySum+=(y+b)*cross;
    });
    const [cx,cy]=Math.abs(crossSum)>1e-8?[xSum/(3*crossSum),ySum/(3*crossSum)]:center(points);
    const [ox,oy]=[section.x||0,section.y||0],angle=(section.angle||0)*Math.PI/180*(inverse?-1:1);
    const x=point[0]-cx-(inverse?ox:0),y=point[1]-cy-(inverse?oy:0),c=Math.cos(angle),s=Math.sin(angle);
    return [cx+x*c-y*s+(inverse?0:ox),cy+x*s+y*c+(inverse?0:oy)];
  }
  function addSection(type){
    if(edit.sections.length>=7){app.toast('Можно задать до семи сечений над основанием.');return;}
    const previous=edit.sections.at(-1);
    if(previous?.z>=499.9){app.toast('Уменьшите высоту верхнего сечения, чтобы добавить следующее.');return;}
    edit.sections.push({z:round(Math.min(500,(previous?.z||0)+Math.max(5,edit.body.height))),points:sectionPoints(type,edit.size*(.33-.02*edit.sections.length)),type});
    edit.index=edit.sections.length-1;
  }
  function descriptor(){
    const e=edit;const f={type:e.key,target:e.body.id};
    if(e.key==='loft')return {...f,sections:e.sections.map(({z,points,x=0,y=0,angle=0})=>({z,angle,points:points.map(p=>[p[0]+x,p[1]+y])}))};
    if(e.key==='fold')return {...f,line:e.line,angle:e.angle};
    if(e.key==='pattern')return {...f,source:e.seeds[e.seed].source,count:e.count,layout:e.layout,step:e.direction.map(n=>n*e.step),center:e.patternCenter,sweep:e.sweep,skipFirst:true};
    if(!e.origin)return null;
    return {...f,text:e.text,origin:e.origin,normal:e.normal,u:e.u,size:e.fontSize,depth:e.depth,operation:e.operation};
  }
  function preview(){
    clearTimeout(timer);timer=0;if(!edit)return;
    const apply=panel.querySelector('[data-workshop-action=apply]');const status=panel.querySelector('.workshop-status');
    const f=descriptor();edit.valid=false;
    if(panel.querySelector('input:invalid')||(edit.key==='text'&&!edit.mode&&!edit.text.trim())){if(apply)apply.disabled=true;if(status)status.textContent=edit.key==='text'&&!edit.text.trim()?'Введите надпись на грани.':'Проверьте введённое значение.';return;}
    if(!f||edit.mode){if(apply)apply.disabled=true;if(status)status.textContent='';return;}
    const signature=JSON.stringify(f);
    if(signature!==edit.signature){edit.lastValid=app.previewFeature(f);edit.signature=signature;}
    edit.valid=edit.lastValid;
    if(apply)apply.disabled=!edit.valid;
    if(status)status.textContent=edit.valid?'':app.getModelError();scheduleGuides();
  }
  function schedulePreview(){
    if(!edit)return;edit.valid=false;const apply=panel.querySelector('[data-workshop-action=apply]');if(apply)apply.disabled=true;
    clearTimeout(timer);timer=setTimeout(preview,110);scheduleGuides();
  }
  function apply(){
    preview();if(!edit?.valid)return;
    if(!app.commitModelEdit())return;reset();
  }
  function field(label,key,value,options={}){
    const row=el('label',{className:'workshop-field'});row.append(el('span',{},label));
    let control;
    if(options.choices){control=el('select');for(const [v,t] of options.choices){control.append(el('option',{value:String(v)},t));}}
    else {
      control=el('input',{type:'number',required:true,min:String(options.min??.1),max:String(options.max??200),step:String(options.step??'any')});
    }
    control.value=String(value);control.dataset.workshopField=key;
    control.addEventListener(options.choices?'change':'input',()=>{
      if(!edit)return;
      const value=options.choices?control.value:control.valueAsNumber;
      if(!options.choices&&(!Number.isFinite(value)||!control.checkValidity())){edit.valid=false;clearTimeout(timer);panel.querySelector('[data-workshop-action=apply]').disabled=true;panel.querySelector('.workshop-status').textContent='Введите значение в указанном диапазоне.';return;}
      options.change?.(value);if(!options.change)edit[key]=value;
      if(options.refresh)renderPanel();schedulePreview();
    });row.append(control);panel.append(row);
  }
  function row(...buttons){const r=el('div',{className:'workshop-buttons'});r.append(...buttons);panel.append(r);}
  function setPick(mode){edit.mode=mode;edit.picks=[];guides.replaceChildren();renderPanel();preview();scheduleGuides();}
  function renderPanel(){
    if(!edit)return;const e=edit;panel.replaceChildren();title(panel,titles[e.key],cancel);
    const prompts={'text-point':'Коснитесь грани в начале строки.','fold-line':'Отметьте две точки линии сгиба на листе.','pattern-center':'Коснитесь центра окружности на плоскости элемента.','pattern-step':'Коснитесь места для второй копии.','section-draw':'Отметьте вершины сечения на выбранной высоте.'};
    if(e.mode){
      panel.append(el('p',{className:'workshop-hint'},prompts[e.mode]));
      if(e.mode==='section-draw'){row(button('Замкнуть сечение','finish-section',finishDraw));}
      row(button('Отмена','cancel-pick',()=>{if(!e.origin&&e.key==='text'){cancel();return;}e.mode='';renderPanel();preview();scheduleGuides();}));
    }else if(e.key==='loft'){
      const section=e.sections[e.index];
      field('Сечение','section',e.index,{choices:e.sections.map((_,i)=>[i,`Сечение ${i+1}`]),change:v=>{e.index=Number(v);},refresh:true});
      field('Высота над листом, мм','z',section.z,{min:.1,max:500,change:v=>section.z=v});
      field('Смещение X, мм','section-x',section.x||0,{min:-500,max:500,change:v=>section.x=v});
      field('Смещение Y, мм','section-y',section.y||0,{min:-500,max:500,change:v=>section.y=v});
      field('Поворот, °','section-angle',section.angle||0,{min:-180,max:180,change:v=>section.angle=v});
      field('Профиль','profile',section.type,{choices:[['rectangle','Прямоугольник'],['circle','Круг'],['custom','Нарисовать…']],change:v=>{if(v==='custom'){e.mode='section-draw';e.picks=[];}else {section.type=v;section.points=sectionPoints(v);}},refresh:true});
      row(button('+ Сечение','add-section',()=>{addSection('circle');renderPanel();schedulePreview();}),button('Убрать','remove-section',()=>{if(e.sections.length>1){e.sections.splice(e.index,1);e.index=Math.min(e.index,e.sections.length-1);renderPanel();schedulePreview();}}));
    }else if(e.key==='fold'){
      field('Угол, °','angle',e.angle,{min:-150,max:150,step:1});row(button('Провести линию сгиба','fold-line',()=>setPick('fold-line')),button('Другая сторона','flip-fold',()=>{e.line.reverse();renderPanel();schedulePreview();}));
    }else if(e.key==='pattern'){
      field('Элемент','seed',e.seed,{choices:e.seeds.map((s,i)=>[i,s.name]),change:v=>{configureSeed(Number(v));},refresh:true});
      field('Расположение','layout',e.layout,{choices:[['linear','В ряд'],['circular','По окружности']],refresh:true});
      field('Всего элементов','count',e.count,{min:2,max:24,step:1});
      if(e.layout==='linear'){
        field('Шаг, мм','step',e.step,{min:.1,max:500});row(button('Указать шаг на модели','pattern-step',()=>setPick('pattern-step')));
      }else{
        field('Дуга, °','sweep',e.sweep,{min:1,max:360,step:1});row(button('Указать центр','pattern-center',()=>setPick('pattern-center')));
      }
    }else{
      field('Высота букв, мм','fontSize',e.fontSize,{min:.5,max:100});field('Глубина, мм','depth',e.depth,{min:.05,max:200});
      field('Способ','operation',e.operation,{choices:[['cut','Гравировка'],['add','Рельеф']]});row(button('Указать начало строки','text-point',()=>setPick('text-point')));
    }
    panel.append(el('div',{className:'workshop-status',role:'status'}));
    if(!e.mode){row(button('Отменить','cancel',cancel),button('Применить','apply',apply));panel.querySelector('[data-workshop-action=apply]').disabled=!e.valid;}
    inscription.hidden=e.key!=='text'||Boolean(e.mode)||!e.origin;
    if(!inscription.hidden&&inscription.value!==e.text)inscription.value=e.text;
    panel.hidden=false;
  }
  function finishDraw(){if(edit.picks.length<3){app.toast('Отметьте минимум три вершины.');return;}const s=edit.sections[edit.index];Object.assign(s,{points:edit.picks.slice(),type:'custom',x:0,y:0,angle:0});edit.mode='';renderPanel();schedulePreview();}
  function project(local){return viewer().project(toWorld(local));}
  function plane(event,origin,normal=[0,0,1]){
    const worldNormal=window.LabAssemblyGeometry?.placeDirection(edit.body,normal)||normal;
    const p=viewer().unprojectToPlane(event.clientX,event.clientY,{origin:toWorld(origin),normal:worldNormal});return p&&toLocal(p);
  }
  function addPick(event){
    const e=edit;
    if(e.mode==='text-point'){
      const hit=viewer().pick(event.clientX,event.clientY);if(!hit||hit.bodyId!==e.body.id){app.toast('Выберите грань активной детали.');return;}placeText(hit);
    }else if(e.mode==='fold-line'){
      const p=plane(event,[0,0,e.z]);if(!p)return;e.picks.push(p.slice(0,2));if(e.picks.length===2){e.line=e.picks;e.mode='';}
    }else if(e.mode==='section-draw'){
      const s=e.sections[e.index],p=plane(event,[0,0,s.z]);if(!p)return;
      if(e.picks.length>=3){const q=project([...e.picks[0],s.z]);if(Math.hypot(q.x-event.clientX,q.y-event.clientY)<14){finishDraw();return;}}
      e.picks.push(p.slice(0,2));
    }else{
      const seed=e.seeds[e.seed].source,origin=center(seed.points),p=plane(event,origin,seed.normal);if(!p)return;
      if(e.mode==='pattern-center')e.patternCenter=p;
      else{const d=p.map((n,i)=>n-origin[i]),n=length(d);if(n<.1)return;e.step=round(n);e.direction=d.map(x=>x/n);}
      e.mode='';
    }
    renderPanel();schedulePreview();scheduleGuides();
  }
  canvas.addEventListener('pointerdown',event=>{if(!edit?.mode||event.button!==0)return;event.preventDefault();event.stopImmediatePropagation();addPick(event);},true);
  function svg(tag,attributes){const node=document.createElementNS(svgNS,tag);for(const [k,v] of Object.entries(attributes))node.setAttribute(k,String(v));guides.append(node);return node;}
  function trace(points,close=false){const projected=points.map(project);if(projected.some(p=>!p))return;svg(close?'polygon':'polyline',{points:projected.map(p=>`${p.x},${p.y}`).join(' '),class:'operation-trace'});}
  function arrowTip(start,end){
    const a=project(start),b=project(end);if(!a||!b)return;
    const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(length<22)return;
    const x=dx/length,y=dy/length,tip=[b.x-x*7,b.y-y*7];
    svg('polyline',{points:[[tip[0]-x*9+y*4,tip[1]-y*9-x*4],tip,[tip[0]-x*9-y*4,tip[1]-y*9+x*4]].map(p=>p.join(',')).join(' '),class:'operation-arrow'});
  }
  function handle(p,kind,caption,indices={}){
    const q=project(p);if(!q)return;
    const node=svg('circle',{cx:q.x,cy:q.y,r:7,class:'operation-grip',role:'img','aria-label':caption||'Изменить вершину'});node.dataset.grip=kind;Object.assign(node.dataset,indices);
    if(caption){const text=svg('text',{x:q.x+12,y:q.y-7,class:'operation-value'});text.textContent=caption;}
  }
  function drawGuides(){
    frame=0;guides.replaceChildren();if(!edit||!viewer()?.lastProjection)return;
    const e=edit;
    if(e.key==='loft'){
      e.sections.forEach((s,i)=>{
        const points=s.points.map(p=>sectionPoint(s,p));
        trace(points.map(p=>[...p,s.z]),true);
        if(e.mode)return;
        handle([...center(points),s.z],'z',`${round(s.z)} мм`,{index:i});
        if(i===e.index&&s.type!=='circle'&&points.length<=48)points.forEach((p,k)=>handle([...p,s.z],'vertex',null,{index:i,vertex:k}));
      });if(e.mode==='section-draw'&&e.picks.length)trace(e.picks.map(p=>[...p,e.sections[e.index].z]));
    }else if(e.key==='fold'){
      trace(e.line.map(p=>[...p,e.z]));if(e.mode){for(const p of e.picks)handle([...p,e.z],'',null);return;}
      const mid=center(e.line),dir=e.line[1].map((x,i)=>x-e.line[0][i]),len=length(dir)||1,rad=e.angle*Math.PI/180,r=e.size*.22;
      const count=Math.max(1,Math.ceil(Math.abs(e.angle)/6));
      const arc=Array.from({length:count+1},(_,i)=>{
        const a=rad*i/count;
        return [mid[0]-dir[1]/len*r*Math.cos(a),mid[1]+dir[0]/len*r*Math.cos(a),e.z+r*Math.sin(a)];
      });
      const tip=arc.at(-1);trace(arc);trace([arc[0],[...mid,e.z],tip]);handle(tip,'angle',`${round(e.angle)}°`);
    }else if(e.key==='pattern'){
      const source=e.seeds[e.seed].source,p=center(source.points);trace(source.points,true);if(e.mode)return;
      if(e.layout==='linear'){const end=p.map((x,i)=>x+e.direction[i]*e.step);trace([p,end]);arrowTip(p,end);handle(end,'step',`${round(e.step)} мм`);}else{trace([p,e.patternCenter]);handle(e.patternCenter,'pattern-center','Центр');}
    }else if(e.origin){
      const q=project(e.origin);
      if(q){inscription.style.left=clamp(q.x+12,8,innerWidth-inscription.offsetWidth-8)+'px';inscription.style.top=clamp(q.y-46,8,innerHeight-54)+'px';}
      handle(e.origin,'text-depth',`${e.operation==='cut'?'−':'+'}${round(e.depth)} мм`);}
  }
  function scheduleGuides(){if(edit&&!frame)frame=requestAnimationFrame(drawGuides);}
  function syncNumber(key,value){const control=panel.querySelector(`[data-workshop-field="${key}"]`);if(control)control.value=String(round(value));}
  guides.addEventListener('pointerdown',e=>{
    const h=e.target.closest('[data-grip]');if(!edit||edit.mode||!h?.dataset.grip)return;e.preventDefault();
    const index=Number(h.dataset.index)||0;grip={type:h.dataset.grip,id:e.pointerId,index,vertex:Number(h.dataset.vertex),y:e.clientY,sectionZ:edit.sections?.[index]?.z,angle:edit.angle,depth:edit.depth*(edit.operation==='add'?1:-1)};
    guides.setPointerCapture(e.pointerId);
  });
  guides.addEventListener('pointermove',event=>{
    if(!edit||!grip||event.pointerId!==grip.id)return;
    const e=edit,dy=grip.y-event.clientY,scale=2*viewer().lastProjection.halfHeight/canvas.clientHeight;
    if(grip.type==='z'){
      const s=e.sections[grip.index];s.z=round(clamp(grip.sectionZ+dy*scale/Math.max(.35,Math.cos(viewer().pitch)),(e.sections[grip.index-1]?.z||0)+.2,e.sections[grip.index+1]?e.sections[grip.index+1].z-.1:500));e.index=grip.index;renderPanel();
    }else if(grip.type==='vertex'){
      const s=e.sections[grip.index],p=plane(event,[0,0,s.z]);if(p){s.points[grip.vertex]=sectionPoint(s,p,true);s.type='custom';}
    }else if(grip.type==='angle'){e.angle=Math.round(clamp(grip.angle+dy*.7,-150,150));syncNumber('angle',e.angle);}
    else if(grip.type==='text-depth'){const v=grip.depth+dy*scale*.2;e.operation=v<0?'cut':'add';e.depth=round(clamp(Math.abs(v),.05,200));syncNumber('depth',e.depth);panel.querySelector('[data-workshop-field=operation]').value=e.operation;}
    else {const source=e.seeds[e.seed].source,origin=center(source.points),p=plane(event,origin,source.normal);if(p){if(grip.type==='pattern-center')e.patternCenter=p;else{const delta=p.map((x,i)=>x-origin[i]),n=length(delta);if(n>.1){e.direction=delta.map(x=>x/n);e.step=round(n);syncNumber('step',e.step);}}}}
    schedulePreview();
  });
  function release(e){if(grip?.id!==e.pointerId)return;grip=null;if(guides.hasPointerCapture(e.pointerId))guides.releasePointerCapture(e.pointerId);renderPanel();preview();}
  guides.addEventListener('pointerup',release);guides.addEventListener('pointercancel',release);
  canvas.addEventListener('labmodelrender',scheduleGuides);
  document.addEventListener('labchange',e=>{
    if(!edit)return;const d=e.detail;
    if(d.kind==='modelpreview'&&!d.active)reset();
    else if((d.kind==='model'&&!d.open)||d.kind==='tool')cancel();
  });
  document.addEventListener('keydown',e=>{
    if(document.querySelector('dialog[open]'))return;
    if(e.key==='Escape'&&!menu.hidden){e.preventDefault();e.stopImmediatePropagation();dismissMenu();return;}
    if(!edit)return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancel();}
    if(e.key==='Enter'&&edit.mode==='section-draw'){e.preventDefault();e.stopImmediatePropagation();finishDraw();}
  },true);
  document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target)&&!e.target.closest('#workshop-launch,#cad-workshop'))dismissMenu();});
  document.getElementById('workshop-launch').addEventListener('click',open);
  document.getElementById('experiment-launch').addEventListener('click',()=>{
    if(!document.getElementById('studio-menu').hidden)document.getElementById('menu-close').click();
    run('experiment');
  });
  document.getElementById('cad-light').addEventListener('click',()=>window.LabInspect.run('light'));
  for(const shortcut of document.querySelectorAll('[data-workshop-shortcut]')){
    shortcut.addEventListener('click',()=>{
      const launch=document.getElementById('tool-launch');
      if(shortcut.closest('#tool-palette')&&launch.getAttribute('aria-expanded')==='true')launch.click();
      run(shortcut.dataset.workshopShortcut);
    });
  }
  window.LabWorkshop={open,run,active:()=>Boolean(edit),cancel};
})();
