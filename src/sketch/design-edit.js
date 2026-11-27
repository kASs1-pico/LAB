/* Sketch relations and the editable build sequence of a selected body. */
(() => {
  'use strict';
  const app = window.LabApp;
  const cad = window.LabCAD;
  const solver = window.LabDesignConstraints;
  const paper = document.getElementById('paper');
  const wrap = document.getElementById('paper-wrap');
  const canvas = document.getElementById('model-canvas');
  const ns = 'http://www.w3.org/2000/svg';
  const kinds = {
    equal:['=','Равная длина'], right:['⟂','Перпендикулярность'],
    tangent:['⌒','Касание'], center:['◎','Общий центр']
  };
  const titles = {
    add:'Выступ', cut:'Карман', union:'Объединение', subtract:'Вычитание', intersect:'Пересечение',
    loft:'По сечениям', fold:'Сгиб', pattern:'Массив', text:'Надпись', workplane:'Профиль на плоскости',
    fastener:'Отверстие под крепёж', mate:'Стыковка', 'split-body':'Разделение', 'mirror-body':'Зеркальная деталь',
    'instance-body':'Связанная копия', 'draft-angle':'Уклон стенок', 'catalog-body':'Типовая деталь','import-body':'Вставленная деталь',
    'edge-bevel':'Фаска ребра', 'edge-round':'Скругление ребра', ...window.LabSolidLabGeometry?.titles
  };
  const panel = document.createElement('section');
  panel.id = 'design-edit-panel';
  panel.className = 'design-edit-panel glass';
  panel.hidden = true;
  const overlay = document.createElementNS(ns, 'g');
  overlay.id = 'design-constraint-overlay';
  overlay.setAttribute('aria-hidden','true');
  paper.append(overlay);
  document.body.append(panel);

  let mode='', pair=[], kind='equal', drag=null, edit=null, bodyId='', restoreHeightDrag=false, previewTimer=0;
  const clone = value => JSON.parse(JSON.stringify(value));
  const isLine = shape => shape?.type==='line';
  const isCircle = shape => shape?.type==='circle'||(shape?.type==='arc'&&Math.abs(shape.delta)>=359.8);
  const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
  const round = value => Number(value.toFixed(3));
  const make = (tag, text='', className='') => {
    const node=document.createElement(tag);
    node.textContent=text;
    if(className)node.className=className;
    return node;
  };
  function button(text, action, invoke) {
    const node=make('button',text);
    node.type='button';node.dataset.designAction=action;
    node.addEventListener('click',invoke);
    return node;
  }
  function heading(title) {
    panel.replaceChildren();
    panel.setAttribute('aria-label',title);
    const row=make('header', '', 'design-edit-header');
    const x=button('×','close',close);
    x.setAttribute('aria-label','Закрыть');
    row.append(make('strong',title),x);
    panel.append(row);
  }
  function saveShapeDrag(cancelled) {
    if(!drag)return;
    const current=drag;drag=null;
    if(wrap.hasPointerCapture(current.id))wrap.releasePointerCapture(current.id);
    if(current.changed&&app.isModelEditing()){
      if(cancelled||!current.valid||!app.commitModelEdit({sketchOnly:true}))app.cancelModelEdit();
    }
  }
  function endHistoryPreview() {
    clearTimeout(previewTimer);previewTimer=0;
    if(!edit)return;
    const dirty=edit.dirty;
    edit=null;
    if(dirty){
      app.cancelModelEdit();
      app.getModelViewer()?.setPreview(false);
    }
  }
  function close() {
    const was=mode;mode='';panel.hidden=true;overlay.replaceChildren();
    document.body.classList.remove('design-constraints-open','design-history-open');
    if(was==='constraints')saveShapeDrag(true);
    if(was==='history'){
      endHistoryPreview();
      if(restoreHeightDrag)app.getModelViewer()?.setHeightDrag(true);
      restoreHeightDrag=false;
    }
    pair=[];bodyId='';
  }

  function shapeDistance(shape, p) {
    if(!isLine(shape))return Math.abs(Math.hypot(p.x-shape.cx,p.y-shape.cy)-shape.r);
    const {a,b}=shape, dx=b.x-a.x,dy=b.y-a.y;
    const n=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);
    return Math.hypot(p.x-a.x-n*dx,p.y-a.y-n*dy);
  }
  function constraintPick(event) {
    const state=app.getState();
    const p=app.getPaperPoint(event,false);
    const visible=state.strokes.filter(shape=>
      (isLine(shape)||isCircle(shape))&&state.layers.some(layer=>layer.id===shape.layer&&layer.visible&&!layer.locked));
    const threshold=15/(paper.getScreenCTM()?.a||1);
    let target=null, nearest=threshold;
    for(const shape of visible){
      const d=shapeDistance(shape,p);
      if(d<nearest){nearest=d;target=shape;}
    }
    if(!target)pair=[];
    else if(pair.includes(target.id))pair=pair.filter(id=>id!==target.id);
    else pair=pair.length>=2?[target.id]:[...pair,target.id];
    showConstraints();
  }
  function appendSvg(tag, attrs, text='') {
    const node=document.createElementNS(ns,tag);
    for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));
    if(text)node.textContent=text;
    overlay.append(node);return node;
  }
  function showConstraintOverlay() {
    overlay.replaceChildren();
    if(mode!=='constraints')return;
    const visible=app.getVisibleStrokes();
    const shapes=new Map(visible.map(shape=>[shape.id,shape]));
    const scale=paper.getScreenCTM()?.a||1, radius=7/scale;
    function grip(shape, point, type) {
      appendSvg('circle',{cx:point.x,cy:point.y,r:radius,class:'design-link-grip',
        'data-design-shape':shape.id,'data-design-handle':type});
    }
    for(const id of pair){
      const shape=shapes.get(id);if(!shape)continue;
      if(isLine(shape)){
        appendSvg('line',{x1:shape.a.x,y1:shape.a.y,x2:shape.b.x,y2:shape.b.y,class:'design-link-outline'});
        grip(shape,shape.a,'a');grip(shape,shape.b,'b');
      }else if(isCircle(shape)){
        appendSvg('circle',{cx:shape.cx,cy:shape.cy,r:shape.r,class:'design-link-outline'});
        grip(shape,{x:shape.cx,y:shape.cy},'center');
        grip(shape,{x:shape.cx+shape.r,y:shape.cy},'radius');
      }
    }
    const marks=new Map();
    for(const relation of app.getConstraints()){
      const a=shapes.get(relation.a),b=shapes.get(relation.b);
      if(!a||!b||(!pair.includes(a.id)&&!pair.includes(b.id)))continue;
      const marker = isLine(b)?{x:(b.a.x+b.b.x)/2,y:(b.a.y+b.b.y)/2}:{x:b.cx-b.r,y:b.cy};
      const n=marks.get(b.id)||0;marks.set(b.id,n+1);
      const label=appendSvg('text',{x:marker.x+10/scale,y:marker.y+(n*18-9)/scale,
        'font-size':16/scale,class:'design-link-mark'},kinds[relation.kind][0]);
      const title=document.createElementNS(ns,'title');title.textContent=kinds[relation.kind][1];label.append(title);
    }
  }
  function choice(name, value, options) {
    const select=make('select');select.setAttribute('aria-label',name);
    for(const [key,label] of options){
      const option=make('option',label);option.value=key;select.append(option);
    }
    select.value=value;return select;
  }
  function showConstraints() {
    if(mode!=='constraints')return;
    const visible=new Set(app.getVisibleStrokes().map(shape=>shape.id));
    pair=pair.filter(id=>visible.has(id));
    heading('Связи эскиза');
    const rule=choice('Тип связи',kind,Object.entries(kinds).map(([id,[symbol,label]])=>[id,symbol+'  '+label]));
    rule.id='design-constraint-kind';
    rule.addEventListener('change',()=>{kind=rule.value;showConstraints();panel.querySelector('#design-constraint-kind').focus({preventScroll:true});});
    const a=app.getSketchShape(pair[0]),b=app.getSketchShape(pair[1]);
    const compatible=solver.supports(kind,a,b);
    const hint=pair.length===0?'Выберите два отрезка или окружности.':
      pair.length===1?'Выберите второе построение. Первое задаёт положение или размер.':
      compatible?'Свяжите фигуры или потяните за синюю ручку.':'Выберите подходящую связь для этих фигур.';
    panel.append(rule,make('p',hint,'design-edit-note'));
    const row=make('div','','design-edit-buttons');
    const link=button('Связать','link',()=>{app.addConstraint(kind,pair[0],pair[1]);});
    link.disabled=!compatible;
    row.append(link,button('Снять выбор','clear',()=>{pair=[];showConstraints();}));
    row.lastChild.disabled=!pair.length;
    panel.append(row);
    for(const relation of app.getConstraints().filter(r=>pair.includes(r.a)||pair.includes(r.b))){
      const linked=make('div','','design-link-row');
      const [symbol,label]=kinds[relation.kind];
      linked.append(make('span',symbol+'  '+label),button('Удалить','unlink',()=>app.removeConstraint(relation.id)));panel.append(linked);
    }
    panel.hidden=false;showConstraintOverlay();
  }
  function moveGrip(event) {
    if(!drag||event.pointerId!==drag.id)return;
    event.preventDefault();event.stopImmediatePropagation();
    const p=app.getPaperPoint(event,false),current=drag;
    if(!current.changed&&Math.hypot(event.clientX-current.x,event.clientY-current.y)<3)return;
    current.changed=true;
    const shape=clone(current.shape);
    switch(current.handle){
      case 'a':case 'b': shape[current.handle]=p;break;
      case 'center': Object.assign(shape,{cx:p.x,cy:p.y});break;
      case 'radius': shape.r=clamp(Math.hypot(p.x-shape.cx,p.y-shape.cy),1,2000);break;
    }
    current.valid=app.replaceSketchShape(shape.id,shape,{preview:true,sketchOnly:true,driverId:shape.id});
  }

  function buildSequence(body, state) {
    const settings=state.modelBodies[body.id]||{}, renderMode=settings.mode||'extrude';
    const nodes=[{key:'sketch',title:'Контур'}];
    if(renderMode==='extrude')nodes.push({key:'height',title:'Вытягивание',value:settings.height??state.modelHeight});
    if(renderMode==='revolve'&&settings.axis)nodes.push({key:'axis',title:'Вращение',value:settings.axis});
    if(renderMode==='sweep'&&settings.path)nodes.push({key:'path',title:'Траектория',value:settings.path});
    if(settings.fillet>0)nodes.push({key:'fillet',title:'Скругление',value:settings.fillet});
    if(settings.shell>0)nodes.push({key:'shell',title:'Полость',value:settings.shell});
    if(settings.offset?.some(x=>x!==0))nodes.push({key:'offset',title:'Перемещение',value:settings.offset});
    for(const feature of state.modelFeatures){
      if(feature.target===body.id)nodes.push({key:'feature',id:feature.id,title:titles[feature.type]||feature.type,value:feature});
    }
    return nodes;
  }
  function historyFields(item,draft,section) {
    const n=(key,label,value,min,max,step='any')=>({key,label,value,min,max,step});
    const xy=['X','Y'],xyz=[...xy,'Z'];
    if(item.key==='height')return [n('value','Высота, мм',draft,1,200)];
    if(item.key==='fillet')return [n('value','Радиус, мм',draft,0,20)];
    if(item.key==='shell')return [n('value','Толщина, мм',draft,0,50)];
    if(item.key==='offset')return xyz.map((label,i)=>n(String(i),label+', мм',draft[i],-10000,10000));
    if(item.key==='axis')return [...xy.map((label,i)=>n(String(i),label+' оси, мм',draft.point[i],-10000,10000)),
      n('angle','Угол оси, °',Math.atan2(draft.direction[1],draft.direction[0])*180/Math.PI,-360,360),
      n('sweepAngle','Угол вращения, °',draft.angle??360,.5,360)];
    if(item.key==='path')return xyz.map((label,i)=>n(String(i),label+', мм',draft[section][i],-10000,10000));
    switch(draft.type){
      case 'add':case 'cut':return [n('depth','Глубина, мм',draft.depth,.01,200)];
      case 'fold':return [n('angle','Угол, °',draft.angle,-150,150)];
      case 'loft':return [n('z','Высота сечения, мм',draft.sections[section].z,.1,500),
        n('angle','Поворот сечения, °',draft.sections[section].angle??0,-180,180)];
      case 'text':return [{key:'text',label:'Надпись',value:draft.text,text:true},
        n('size','Высота букв, мм',draft.size,.5,100),n('depth','Глубина, мм',draft.depth,.05,200),
        {key:'operation',label:'Вид',value:draft.operation,options:[['add','Рельеф'],['cut','Гравировка']]}];
      case 'pattern':return [n('count','Всего элементов',draft.count,2,24,1),
        draft.layout==='linear'?n('step','Шаг, мм',Math.hypot(...draft.step),.05,10000):n('sweep','Дуга, °',draft.sweep,-360,360)];
      case 'union':case 'subtract':case 'intersect':return [{key:'type',label:'Действие',value:draft.type,
        options:[['union','Объединить'],['subtract','Вычесть'],['intersect','Пересечь']]}];
      case 'workplane':return [n('depth','Длина выступа, мм',draft.depth,-500,500)];
      case 'fastener':return [n('diameter','Диаметр, мм',draft.diameter,.2,150),
        n('headDiameter','Под головку, мм',draft.headDiameter,.3,200),
        draft.headStyle==='cone'?n('headAngle','Угол зенковки, °',draft.headAngle,30,150):
          n('headDepth','Глубина головки, мм',draft.headDepth,.1,200)];
      case 'mate':return [n('distance','Смещение, мм',draft.distance,draft.min??-500,draft.max??500)];
      case 'draft-angle':return [n('angle','Уклон, °',draft.angle,.1,30)];
      case 'edge-bevel':case 'edge-round':return [n('radius','Размер, мм',draft.radius,.05,20)];
      case 'edge-round-variable':return [n('radius','Радиус в начале, мм',draft.radius,.05,20),n('radiusEnd','Радиус в конце, мм',draft.radiusEnd,.05,20)];
      case 'helical-spring':return [
        n('diameter','Диаметр осевой линии витка, мм',draft.diameter,2,300),n('wire','Диаметр проволоки, мм',draft.wire,.2,40),
        n('pitch','Шаг витка, мм',draft.pitch,.5,100),n('turns','Число витков',draft.turns,1,8,.5)
      ];
      case 'reinforcing-rib':return [n('height','Высота, мм',draft.height,.2,200),n('width','Толщина, мм',draft.width,.2,100)];
      case 'dome':return [n('height','Высота купола, мм',draft.height,.25,300)];
      case 'multi-shell':return [n('thickness','Толщина стенок, мм',draft.thickness,.1,50)];
      case 'split-body':return draft.plane?[]:[n('fraction','Доля по оси',draft.fraction,.01,.99)];
      case 'mirror-body':return draft.plane?[]:[n('position','Координата плоскости, мм',draft.position,-10000,10000)];
      default:return [];
    }
  }
  function fieldChanged(current, key, value) {
    const {item,section}=current,draft=current.draft;
    if(item.key==='path')draft[section][Number(key)]=value;
    else if(item.key==='axis'){
      if(key==='angle')draft.direction=[Math.cos(value*Math.PI/180),Math.sin(value*Math.PI/180)];
      else if(key==='sweepAngle')draft.angle=value;
      else draft.point[Number(key)]=value;
    }else if(item.key==='offset')draft[Number(key)]=value;
    else if(item.key!=='feature')current.draft=value;
    else if(draft.type==='loft'&&key!=='suppressed')draft.sections[section][key]=value;
    else if(draft.type==='pattern'&&key==='step'){
      const length=Math.hypot(...item.value.step);
      draft.step=item.value.step.map(x=>value*x/length);
    }else draft[key]=value;
  }
  function previewHistory() {
    clearTimeout(previewTimer);previewTimer=0;
    if(mode!=='history'||!edit?.dirty)return false;
    const apply=panel.querySelector('[data-design-action="history-apply"]');
    const status=panel.querySelector('.design-history-status');
    if(panel.querySelector(':invalid')){
      apply.disabled=true;status.textContent='Проверьте значения в полях.';return false;
    }
    const {item,draft}=edit;
    const valid=item.key==='feature'?app.previewExistingFeature(item.id,draft):app.previewBodySetting(bodyId,item.key,draft);
    app.getModelViewer()?.setPreview(true);
    apply.disabled=!valid;
    status.textContent=valid?'':app.getModelError();
    return valid;
  }
  function scheduleHistoryPreview() {
    clearTimeout(previewTimer);
    const apply=panel.querySelector('[data-design-action="history-apply"]');
    if(apply)apply.disabled=true;
    previewTimer=setTimeout(previewHistory,80);
  }
  function field(row, spec) {
    const label=make('label','','design-edit-field');
    label.append(make('span',spec.label));
    const input=spec.options?choice(spec.label,spec.value,spec.options):make('input');
    input.dataset.designField=spec.key;
    if(!spec.options){
      input.type=spec.text?'text':'number';input.required=true;
      if(spec.text)input.maxLength=32;
      else Object.assign(input,{min:spec.min,max:spec.max,step:spec.step});
      input.value=spec.text?spec.value:String(round(spec.value));
    }
    input.addEventListener(spec.options?'change':'input',()=>{
      edit.dirty=true;
      if(input.validity.valid)fieldChanged(edit,spec.key,spec.text||spec.options?input.value:input.valueAsNumber);
      scheduleHistoryPreview();
    });
    label.append(input);row.append(label);
  }
  function chooseHistory(item) {
    endHistoryPreview();
    if(item.key==='sketch'){close();cad.action('edit');return;}
    edit={item,draft:clone(item.value),section:0,dirty:false};
    showHistory();
  }
  function featureAtHit(items, hit, body) {
    if(!hit)return null;
    const unplaced=window.LabAssemblyGeometry?.unplacePoint(body,hit.point)||hit.point;
    const local=unplaced.map((value,i)=>value-body.offset[i]);
    const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
    const delta=(point,origin)=>point.map((x,i)=>x-origin[i]);
    for(const item of items.slice().reverse()){
      const feature=item.key==='feature'?item.value:null;
      if(!feature||!['add','cut','fastener'].includes(feature.type))continue;
      const origin=feature.origin||feature.points[0],fromOrigin=delta(local,origin);
      const axial=dot(fromOrigin,feature.normal);
      if(feature.type==='fastener'){
        const radius=Math.hypot(...fromOrigin.map((x,i)=>x-axial*feature.normal[i]));
        if(axial<=.1&&radius<=feature.headDiameter/2+.05)return item;
        continue;
      }
      const depth=feature.type==='cut'?-feature.depth:feature.depth;
      if(axial<Math.min(0,depth)-.1||axial>Math.max(0,depth)+.1)continue;
      const axis=feature.normal.map(Math.abs).indexOf(Math.max(...feature.normal.map(Math.abs)));
      if([0,1,2].filter(i=>i!==axis).every(i=>{
        const coords=feature.points.map(point=>point[i]);
        return local[i]>=Math.min(...coords)-.1&&local[i]<=Math.max(...coords)+.1;
      }))return item;
    }
    return null;
  }
  function selectBody(id, hit) {
    endHistoryPreview();
    const bodies=app.getBodies(),body=bodies.find(x=>x.id===id)||bodies[0];
    if(!body){close();app.toast('Сначала откройте модель из замкнутого контура.');return;}
    bodyId=body.id;
    const items=buildSequence(body,app.getState());
    const found=featureAtHit(items,hit,body);
    if(found)edit={item:found,draft:clone(found.value),section:0,dirty:false};
    showHistory();
  }
  function showHistory() {
    if(mode!=='history')return;
    const body=app.getBodies().find(b=>b.id===bodyId);if(!body){close();return;}
    const scroll=panel.querySelector('.design-history-chain')?.scrollLeft||0;
    heading('Операции детали');
    const selected=make('div',body.name,'design-history-name');panel.append(selected);
    const chain=make('nav','','design-history-chain');chain.setAttribute('aria-label','Порядок построения');
    for(const item of buildSequence(body,app.getState())){
      const active=edit?.item.key===item.key&&edit.item.id===item.id;
      const node=button(item.title+(item.value?.suppressed?' ⏸':''),'history-item',()=>chooseHistory(item));
      node.setAttribute('aria-pressed',String(active));node.dataset.designStep=item.id||item.key;
      chain.append(node);
    }
    panel.append(chain);chain.scrollLeft=scroll;
    if(!edit){panel.append(make('p','Выберите шаг для правки или коснитесь нужной детали.','design-edit-note'));panel.hidden=false;return;}
    const {item,draft}=edit;
    if(item.key==='feature'){
      const label=make('label','','design-feature-state');
      const checkbox=make('input');
      checkbox.type='checkbox';
      checkbox.checked=draft.suppressed===true;
      checkbox.addEventListener('change',()=>{
        draft.suppressed=checkbox.checked;
        edit.dirty=true;
        scheduleHistoryPreview();
      });
      label.append(checkbox,document.createTextNode('Операция отключена'));
      panel.append(label);
    }
    const count=item.key==='path'?draft.length:item.key==='feature'&&draft.type==='loft'?draft.sections.length:0;
    if(count>1){
      const label=item.key==='path'?'Точка':'Сечение';
      const control=choice(label,String(edit.section),Array.from({length:count},(_,index)=>[String(index),label+' '+(index+1)]));
      control.id='design-history-section';
      control.addEventListener('change',()=>{
        edit.section=Number(control.value);showHistory();panel.querySelector('#design-history-section').focus({preventScroll:true});
      });
      panel.append(control);
    }
    const fields=historyFields(item,draft,edit.section);
    for(const spec of fields)field(panel,spec);
    const status=make('p','','design-history-status');status.setAttribute('role','status');panel.append(status);
    if(fields.length||item.key==='feature'){
      const row=make('div','','design-edit-buttons');
      const apply=button('Применить','history-apply',()=>{
        if(!previewHistory()||!app.commitModelEdit())return;
        edit=null;app.getModelViewer()?.setPreview(false);showHistory();
      });
      apply.disabled=true;
      row.append(button('Отменить','history-cancel',()=>{endHistoryPreview();showHistory();}),apply);panel.append(row);
      if(edit.dirty)scheduleHistoryPreview();
    }
    panel.hidden=false;
  }

  function run(key) {
    close();cad.cancel();
    if(key==='constraints'){
      if(app.isModelOpen())cad.modelMode(false);
      mode=key;document.body.classList.add('design-constraints-open');showConstraints();
    }else if(key==='history'){
      if(!app.isModelOpen())cad.modelMode(true,false);
      if(!app.getModelViewer()?.supported||!app.getBodies().length){app.toast('Сначала откройте модель.');return false;}
      mode=key;document.body.classList.add('design-history-open');
      const viewer=app.getModelViewer();
      restoreHeightDrag=viewer.heightDragEnabled;viewer.setHeightDrag(false);
      viewer.setAutoRotate(false);
      const hit=cad.getHit();
      selectBody(cad.getState().selected[0],hit);
    }else return false;
    return true;
  }
  document.addEventListener('pointerdown',event=>{
    if(mode!=='constraints'||!wrap.contains(event.target)||event.button!==0)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(drag)return;
    const target=event.target.closest('[data-design-handle]');
    if(target){
      const shape=app.getSketchShape(target.dataset.designShape);
      if(shape){
        drag={id:event.pointerId,shape,handle:target.dataset.designHandle,x:event.clientX,y:event.clientY,changed:false,valid:true};
        wrap.setPointerCapture(event.pointerId);
      }
    }else constraintPick(event);
  },true);
  document.addEventListener('pointermove',moveGrip,true);
  for(const type of ['pointerup','pointercancel','lostpointercapture']){
    document.addEventListener(type,event=>{
      if(drag?.id!==event.pointerId)return;
      event.stopImmediatePropagation();saveShapeDrag(type!=='pointerup');showConstraints();
    },true);
  }
  canvas.addEventListener('labmodelselect',event=>{
    if(mode==='history'&&event.detail.hit?.bodyId)selectBody(event.detail.hit.bodyId,event.detail.hit);
  });
  document.addEventListener('keydown',event=>{
    if(!mode||event.key!=='Escape'||document.querySelector('dialog[open]'))return;
    event.preventDefault();event.stopImmediatePropagation();close();
  },true);
  document.addEventListener('labchange',event=>{
    const {kind:type,open,active}=event.detail;
    if(!mode)return;
    if(type==='project'||type==='tool'||type==='model'&&((mode==='constraints'&&open)||(mode==='history'&&!open))){
      close();return;
    }
    if(mode==='constraints'){
      if(type==='drawing'){if(drag)showConstraintOverlay();else showConstraints();}
      if(type==='viewport')showConstraintOverlay();
    }else if(type==='modelpreview'&&!active&&edit?.dirty){
      edit=null;app.getModelViewer()?.setPreview(false);showHistory();
    }
  });
  window.LabDesignEdit=Object.freeze({run,close,active:()=>mode});
})();
