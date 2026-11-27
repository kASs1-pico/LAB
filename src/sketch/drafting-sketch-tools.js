/* Sketch diagnostics and dimensions. Paper coordinates use four units per millimetre. */
(function (global) {
  'use strict';
  const MM=4, JOIN=.004, MIN_LENGTH=.04, MAX_REPAIR=8, MAX_SEGMENTS=6000, MAX_MARKS=24;
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
  const cross=(a,b)=>a.x*b.y-a.y*b.x;
  const dot=(a,b)=>a.x*b.x+a.y*b.y;
  const offset=(a,b,t)=>({x:a.x+b.x*t,y:a.y+b.y*t});
  const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const angleNorm=value=>(value%360+360)%360;
  const complete=stroke=>stroke.type==='circle'||stroke.type==='arc'&&Math.abs(stroke.delta)>=359.999;
  const pointKey=point=>[point.x,point.y].map(value=>Math.round(value/JOIN)).join(',');
  const editableDimension=stroke=>stroke?.type==='line'||stroke?.type==='circle';
  function valueOf(stroke){return stroke.type==='line'?distance(stroke.a,stroke.b)/MM:stroke.r*2/MM;}
  function arcPoint(stroke,degrees){
    const radians=degrees*Math.PI/180;
    return {x:stroke.cx+stroke.r*Math.cos(radians),y:stroke.cy+stroke.r*Math.sin(radians)};
  }
  function endpoints(stroke){
    if(stroke.type==='line')return [{shapeId:stroke.id,key:'a',point:stroke.a},{shapeId:stroke.id,key:'b',point:stroke.b}];
    if(stroke.type==='path'&&stroke.points.length>1){
      const points=stroke.points;
      if(points.length>2&&distance(points[0],points.at(-1))<=JOIN)return [];
      return [{shapeId:stroke.id,key:0,point:points[0]},{shapeId:stroke.id,key:points.length-1,point:points.at(-1)}];
    }
    if(stroke.type==='arc'&&!complete(stroke))return [
      {shapeId:stroke.id,key:null,point:arcPoint(stroke,stroke.start)},
      {shapeId:stroke.id,key:null,point:arcPoint(stroke,stroke.start+stroke.delta)}
    ];
    return [];
  }
  const edgeKey=(a,b)=>[pointKey(a),pointKey(b)].sort().join(';');
  function signature(stroke){
    if(stroke.type==='line')return 'path:'+edgeKey(stroke.a,stroke.b);
    if(stroke.type==='path')return 'path:'+stroke.points.slice(1)
      .flatMap((point,i)=>distance(point,stroke.points[i])>JOIN?[edgeKey(point,stroke.points[i])]:[]).sort().join('|');
    const center=pointKey({x:stroke.cx,y:stroke.cy})+','+Math.round(stroke.r/JOIN);
    if(complete(stroke))return 'circle:'+center;
    const start=angleNorm(stroke.start+Math.min(0,stroke.delta));
    return 'arc:'+center+','+Math.round(start*10000)+','+Math.round(Math.abs(stroke.delta)*10000);
  }
  function shapePoint(stroke){
    if(stroke.type==='line')return midpoint(stroke.a,stroke.b);
    if(stroke.type==='path')return stroke.points[0];
    return arcPoint(stroke,complete(stroke)?0:stroke.start+stroke.delta/2);
  }
  function inArc(stroke,p){
    if(complete(stroke))return true;
    const angle=Math.atan2(p.y-stroke.cy,p.x-stroke.cx)*180/Math.PI;
    const tolerance=JOIN/Math.max(stroke.r,JOIN)*180/Math.PI;
    const relative=angleNorm((angle-stroke.start)*Math.sign(stroke.delta));
    return relative<=Math.abs(stroke.delta)+tolerance||relative>=360-tolerance;
  }
  function linePrimitive(a,b){
    return {a,b,ends:[a,b],lowX:Math.min(a.x,b.x),highX:Math.max(a.x,b.x),lowY:Math.min(a.y,b.y),highY:Math.max(a.y,b.y)};
  }
  function primitives(strokes){
    const items=[];
    for(const stroke of strokes){
      if(stroke.type==='circle'||stroke.type==='arc'){
        items.push({curve:stroke,ends:endpoints(stroke).map(end=>end.point),
          lowX:stroke.cx-stroke.r,highX:stroke.cx+stroke.r,lowY:stroke.cy-stroke.r,highY:stroke.cy+stroke.r});
      }else{
        const vertices=stroke.type==='line'?[stroke.a,stroke.b]:stroke.points;
        for(let i=1;i<vertices.length;i++){
          if(distance(vertices[i-1],vertices[i])>JOIN)items.push(linePrimitive(vertices[i-1],vertices[i]));
        }
      }
    }
    return items.sort((a,b)=>a.lowX-b.lowX);
  }
  function betweenLines(a,b){
    const u=sub(a.b,a.a),v=sub(b.b,b.a),w=sub(b.a,a.a),det=cross(u,v);
    const ul=Math.hypot(u.x,u.y),vl=Math.hypot(v.x,v.y);
    if(Math.abs(det)>1e-10*ul*vl){
      const t=cross(w,v)/det,s=cross(w,u)/det;
      return t>=0&&t<=1&&s>=0&&s<=1?[offset(a.a,u,t)]:[];
    }
    if(Math.abs(cross(w,u))>JOIN*ul)return [];
    const params=[dot(w,u)/(ul*ul),dot(sub(b.b,a.a),u)/(ul*ul)];
    const left=Math.max(0,Math.min(...params)),right=Math.min(1,Math.max(...params));
    return (right-left)*ul>JOIN?[offset(a.a,u,(left+right)/2)]:[];
  }
  function lineAndCurve(line,curve){
    const direction=sub(line.b,line.a),p=sub({x:curve.cx,y:curve.cy},line.a),length=Math.hypot(direction.x,direction.y);
    const along=dot(p,direction)/length,away=cross(p,direction)/length;
    if(Math.abs(away)>curve.r+JOIN)return [];
    const delta=Math.sqrt(Math.max(0,curve.r**2-away**2));
    return [along-delta,along+delta].filter(t=>t>=0&&t<=length)
      .map(t=>offset(line.a,direction,t/length)).filter(point=>inArc(curve,point));
  }
  function betweenCurves(a,b){
    const origin={x:a.cx,y:a.cy},d=sub({x:b.cx,y:b.cy},origin),length=Math.hypot(d.x,d.y);
    if(length<=JOIN){
      if(Math.abs(a.r-b.r)>JOIN)return [];
      return [a,b].flatMap(curve=>(complete(curve)?[0,90,180,270]:[curve.start,curve.start+curve.delta/2,curve.start+curve.delta])
        .map(angle=>arcPoint(curve,angle))).filter(p=>inArc(a,p)&&inArc(b,p));
    }
    if(length>a.r+b.r+JOIN||length<Math.abs(a.r-b.r)-JOIN)return [];
    const middle=(a.r*a.r-b.r*b.r+length*length)/(2*length),s=Math.sqrt(Math.max(0,a.r*a.r-middle*middle));
    const center=offset(origin,d,middle/length),normal={x:-d.y,y:d.x};
    return [offset(center,normal,s/length),offset(center,normal,-s/length)].filter(p=>inArc(a,p)&&inArc(b,p));
  }
  function crossings(strokes){
    const items=primitives(strokes),found=new Map();
    for(let i=0;i<items.length&&found.size<MAX_MARKS;i++){
      const a=items[i];
      for(let j=i+1;j<items.length&&found.size<MAX_MARKS;j++){
        const b=items[j];
        if(b.lowX>a.highX+JOIN)break;
        if(b.lowY>a.highY+JOIN||a.lowY>b.highY+JOIN)continue;
        const hits=a.curve?(b.curve?betweenCurves(a.curve,b.curve):lineAndCurve(b,a.curve))
          :(b.curve?lineAndCurve(a,b.curve):betweenLines(a,b));
        for(const p of hits){
          const joint=a.ends.some(end=>distance(end,p)<=JOIN)&&b.ends.some(end=>distance(end,p)<=JOIN);
          if(!joint)found.set(pointKey(p),p);
        }
      }
    }
    return [...found.values()];
  }
  function gaps(strokes){
    const lookup=new Map(strokes.map(stroke=>[stroke.id,stroke]));
    const ends=strokes.flatMap(endpoints);
    const loose=ends.filter((end,i)=>!ends.some((other,j)=>i!==j&&distance(end.point,other.point)<=JOIN));
    const nearest=loose.map(a=>{
      let index=-1,length=Infinity;
      for(let i=0;i<loose.length;i++){
        const b=loose[i];
        if(a===b)continue;
        if(a.shapeId===b.shapeId&&!(lookup.get(a.shapeId).type==='path'&&lookup.get(a.shapeId).points.length>2))continue;
        const gap=distance(a.point,b.point);
        if(gap<length){length=gap;index=i;}
      }
      return {index,length};
    });
    return loose.flatMap((a,i)=>{
      const {index,length}=nearest[i];
      return index>i&&nearest[index].index===i?[{a,b:loose[index],length}]:[];
    }).sort((a,b)=>a.length-b.length);
  }
  function check(strokes,analyze){
    const fullSegmentCount=strokes.reduce((n,s)=>n+(s.type==='path'?s.points.length-1:1),0);
    if(strokes.length>1024||fullSegmentCount>MAX_SEGMENTS)return {gaps:[],duplicates:[],intersections:[],issues:[],
      limited:true};
    const seen=new Set(),unique=[],duplicates=[];
    for(const stroke of strokes){
      const key=signature(stroke);
      if(seen.has(key)){if(duplicates.length<MAX_MARKS)duplicates.push(shapePoint(stroke));}
      else{seen.add(key);unique.push(stroke);}
    }
    const analysis=analyze(strokes,{tolerance:.05});
    return {gaps:gaps(unique).slice(0,MAX_MARKS),duplicates,intersections:crossings(unique),issues:analysis.errors,limited:false};
  }

  function dimensionChanges(strokes,shape,millimetres){
    if(!editableDimension(shape)||!Number.isFinite(millimetres)||millimetres*MM<MIN_LENGTH)throw new Error('Введите размер не меньше 0,01 мм.');
    if(shape.type!=='line'){
      if(millimetres>1000)throw new Error('Диаметр должен быть не больше 1000 мм.');
      return [{...shape,r:millimetres*MM/2}];
    }
    const length=distance(shape.a,shape.b);
    if(length<MIN_LENGTH)throw new Error('У отрезка слишком малая исходная длина.');
    const point=offset(shape.a,sub(shape.b,shape.a),millimetres*MM/length);
    const replacements=[{...shape,b:point}];
    for(const stroke of strokes){
      if(stroke.id===shape.id)continue;
      if(stroke.type==='line'){
        const a=distance(shape.b,stroke.a)<=JOIN?point:stroke.a;
        const b=distance(shape.b,stroke.b)<=JOIN?point:stroke.b;
        if(a!==stroke.a||b!==stroke.b)replacements.push({...stroke,a,b});
      }else if(stroke.type==='path'){
        const points=stroke.points.map(p=>distance(shape.b,p)<=JOIN?point:p);
        if(points.some((p,i)=>p!==stroke.points[i]))replacements.push({...stroke,points});
      }else if(endpoints(stroke).some(end=>distance(end.point,shape.b)<=JOIN)){
        throw new Error('Конец отрезка соединён с дугой. Сначала отредактируйте соединение.');
      }
    }
    return replacements;
  }
  function moveEndpoints(a,b,shapes,canMove){
    if(!Number.isFinite(distance(a.point,b.point))||distance(a.point,b.point)>MAX_REPAIR)throw new Error('Соединяйте зазоры до 2 мм.');
    const movableA=a.key!==null&&canMove(a.shapeId),movableB=b.key!==null&&canMove(b.shapeId);
    if(!movableA&&!movableB)throw new Error('Для соединения нужен редактируемый конец отрезка или линии.');
    const position=movableA&&movableB?midpoint(a.point,b.point):movableA?b.point:a.point;
    const moves=new Map();
    for(const end of [a,b].filter((_,index)=>index===0?movableA:movableB)){
      if(!moves.has(end.shapeId)){
        const original=shapes.get(end.shapeId);
        moves.set(end.shapeId,original.type==='path'?{...original,points:original.points.slice()}:{...original});
      }
      const shape=moves.get(end.shapeId);
      if(shape.type==='path')shape.points[end.key]=position;
      else shape[end.key]=position;
    }
    return [...moves.values()];
  }
  if(typeof module!=='undefined'&&module.exports){
    module.exports={check,dimensionChanges,moveEndpoints};
    return;
  }

  const app=global.LabApp,cad=global.LabCAD,solid=global.LabExtrusion;
  const paper=document.getElementById('paper'),wrap=document.getElementById('paper-wrap');
  const namespace='http://www.w3.org/2000/svg';
  const display=value=>Number(value.toFixed(3)).toLocaleString('ru-RU');
  const make=(tag,value='')=>Object.assign(document.createElement(tag),{textContent:value});
  const svg=(tag,attrs,content='')=>{
    const node=document.createElementNS(namespace,tag);
    for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));
    node.textContent=content;return node;
  };
  function button(text,action,invoke){
    const node=make('button',text);
    node.type='button';node.dataset.sketchAction=action;
    node.addEventListener('click',invoke);return node;
  }
  const panel=make('section');
  panel.id='drafting-sketch-panel';panel.className='design-edit-panel glass';panel.hidden=true;
  document.body.append(panel);
  const dimensions=svg('g',{id:'drafting-sketch-dimensions','aria-hidden':'true'});
  const markers=svg('g',{id:'drafting-sketch-markers','aria-hidden':'true'});
  paper.append(dimensions,markers);
  let mode='',selected='',report=null,openingFocus=null,refreshFrame=0,refreshPanel=false;

  function close({restoreFocus=true}={}){
    if(!mode)return;
    mode='';selected='';report=null;
    panel.hidden=true;markers.replaceChildren();
    document.body.classList.remove('drafting-sketch-active');
    if(restoreFocus){
      const fallback=document.getElementById('studio-menu-toggle');
      (openingFocus?.getClientRects().length?openingFocus:fallback)?.focus({preventScroll:true});
    }
    openingFocus=null;
  }
  function heading(title){
    panel.replaceChildren();panel.setAttribute('aria-label',title);
    const row=make('header');row.className='design-edit-header';
    const dismiss=button('×','close',()=>close());dismiss.setAttribute('aria-label','Закрыть');
    row.append(make('strong',title),dismiss);panel.append(row);
  }
  function message(text){
    const node=make('p',text);node.className='design-edit-note';panel.append(node);
  }
  function visibleShapes(){
    const state=app.getState(),layers=new Map(state.layers.map(layer=>[layer.id,layer]));
    const shapes=state.strokes.filter(stroke=>layers.get(stroke.layer)?.visible!==false);
    const shapeMap=new Map(shapes.map(stroke=>[stroke.id,stroke]));
    return {shapes,shapeMap,movable:id=>!layers.get(shapeMap.get(id)?.layer)?.locked};
  }
  function editableSuggestions(report,shapes){
    return report.gaps.filter(({a,b,length})=>length<=MAX_REPAIR&&
      (a.key!==null&&shapes.movable(a.shapeId)||b.key!==null&&shapes.movable(b.shapeId)));
  }
  function repair(gap){
    const current=visibleShapes(),updated=check(current.shapes.filter(shape=>!shape.construction),solid.analyze);
    const match=editableSuggestions(updated,current).find(({a,b})=>a.shapeId===gap.a.shapeId&&a.key===gap.a.key&&
      b.shapeId===gap.b.shapeId&&b.key===gap.b.key&&distance(a.point,gap.a.point)<=JOIN&&distance(b.point,gap.b.point)<=JOIN);
    if(!match){app.toast('Контур изменился. Проверьте зазор снова.');refresh();return;}
    try{
      const replacements=moveEndpoints(match.a,match.b,current.shapeMap,current.movable);
      const options={sketchOnly:true,driverId:replacements[0].id};
      if(!app.replaceSketchShapes(replacements,{...options,preview:true})){
        if(app.isModelEditing())app.cancelModelEdit();
        refresh();return;
      }
      function repairedPoint(end){
        if(end.key===null)return end.point;
        const shape=app.getSketchShape(end.shapeId);
        return shape.type==='path'?shape.points[end.key]:shape[end.key];
      }
      if(distance(repairedPoint(match.a),repairedPoint(match.b))>JOIN||!app.commitModelEdit(options)){
        if(app.isModelEditing())app.cancelModelEdit();
        app.toast('Геометрическая связь мешает соединить выбранные вершины.');refresh();return;
      }
      app.toast('Вершины совпадают. Изменение можно отменить.');refresh();
    }catch(error){
      if(app.isModelEditing())app.cancelModelEdit();
      app.toast(error.message);
    }
  }
  function showCheck(current){
    heading('Проверка контура');
    report=check(current.shapes.filter(shape=>!shape.construction),solid.analyze);
    if(report.limited){
      message('На видимых слоях слишком много построений для подробной проверки. Скройте лишние слои и повторите.');
      return;
    }
    const counts=[
      report.gaps.length&&('Зазоры: '+report.gaps.length),
      report.intersections.length&&('Пересечения: '+report.intersections.length),
      report.duplicates.length&&('Дубли: '+report.duplicates.length)
    ].filter(Boolean);
    if(counts.length)message(counts.join(' · '));
    else if(!report.issues.length)message('Контуры замкнуты. Пересечений и дублей не найдено.');
    for(const issue of [...new Map(report.issues.map(issue=>[issue.code,issue])).values()].slice(0,4))message(issue.message);
    const suggestions=editableSuggestions(report,current);
    const list=make('ul');list.className='drafting-gap-list';
    for(const [index,gap] of report.gaps.slice(0,8).entries()){
      const prefix=report.gaps.length>1?'Зазор '+(index+1)+' · ':'Зазор ';
      const row=make('li'),label=make('span',prefix+display(gap.length/MM)+' мм');
      row.append(label);
      if(suggestions.includes(gap))row.append(button('Соединить вершины','repair',()=>repair(gap)));
      list.append(row);
    }
    if(list.childElementCount)panel.append(list);
  }
  function setDimension(shape,amount){
    const {shapes}=visibleShapes();
    try{
      const replacements=dimensionChanges(shapes,shape,amount);
      const wasClosed=solid.analyze(shapes.filter(item=>!item.construction)).ok;
      const options={sketchOnly:true,driverId:shape.id,sketchDimension:{shapeId:shape.id,kind:shape.type==='line'?'length':'diameter'}};
      if(!app.replaceSketchShapes(replacements,{...options,preview:true})){
        if(app.isModelEditing())app.cancelModelEdit();
        return;
      }
      const changed=app.getSketchShape(shape.id);
      const validSize=changed&&Math.abs(valueOf(changed)-amount)<1e-5;
      const validContour=!wasClosed||solid.analyze(app.getModelStrokes()).ok;
      if(!validSize||!validContour||!app.commitModelEdit(options)){
        if(app.isModelEditing())app.cancelModelEdit();
        if(!validSize||!validContour)app.toast('Размер конфликтует со связями или нарушает замкнутый контур.');
        return;
      }
      app.toast('Размер обновлён.');
    }catch(error){
      if(app.isModelEditing())app.cancelModelEdit();
      app.toast(error.message);
    }
  }
  function showDimension(current){
    heading('Управляющий размер');
    const choice=make('select');choice.id='drafting-dimension-shape';
    const blank=make('option','Выберите на листе или в списке');blank.value='';choice.append(blank);
    const candidates=current.shapes.filter(shape=>editableDimension(shape)&&current.movable(shape.id));
    const active=candidates.find(shape=>shape.id===selected);
    const labels=make('label','Построение');labels.htmlFor=choice.id;panel.append(labels);
    candidates.forEach((shape,index)=>{
      const name=shape.type==='line'?'Отрезок':'Окружность';
      const option=make('option',name+' '+(index+1)+' · '+display(valueOf(shape))+' мм');
      option.value=shape.id;choice.append(option);
    });
    choice.value=active?.id||'';
    choice.addEventListener('change',()=>{selected=choice.value;refresh();panel.querySelector('#drafting-dimension-shape').focus({preventScroll:true});});
    panel.append(choice);
    if(!active){message('Нажмите на отрезок или окружность на открытом слое.');return;}
    const form=make('form');
    const label=make('label',active.type==='line'?'Длина, мм':'Диаметр, мм');
    const input=make('input');
    label.htmlFor=input.id='drafting-dimension-value';input.type='number';input.min='.01';input.step='any';
    input.required=true;input.value=String(Number(valueOf(active).toFixed(5)));
    const apply=make('button','Применить');apply.type='submit';apply.dataset.sketchAction='apply';
    form.addEventListener('submit',event=>{event.preventDefault();if(form.reportValidity())setDimension(active,input.valueAsNumber);});
    form.append(label,input,apply);panel.append(form);
    if(app.getSketchDimensions().some(record=>record.shapeId===active.id)){
      panel.append(button('Убрать подпись','remove-dimension',()=>app.removeSketchDimension(active.id)));
    }
  }
  function draw(current,records){
    const scale=Math.abs(paper.getScreenCTM()?.a)||1,px=1/scale;
    dimensions.replaceChildren();markers.replaceChildren();
    const line=(node,a,b,className)=>node.append(svg('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:className}));
    const label=(node,p,text,className)=>node.append(svg('text',{x:p.x,y:p.y,'font-size':12*px,class:className},text));
    for(const record of records){
      const shape=current.shapeMap.get(record.shapeId);
      if(!editableDimension(shape))continue;
      const group=svg('g',{'data-sketch-dimension':record.shapeId});
      if(shape.type==='line'){
        const direction=sub(shape.b,shape.a),length=Math.hypot(direction.x,direction.y);
        if(length<MIN_LENGTH)continue;
        const normal={x:direction.y/length,y:-direction.x/length};
        const a=offset(shape.a,normal,19*px),b=offset(shape.b,normal,19*px);
        line(group,shape.a,a,'drafting-sketch-leader');line(group,shape.b,b,'drafting-sketch-leader');line(group,a,b,'drafting-sketch-leader');
        label(group,offset(midpoint(a,b),normal,4*px),display(valueOf(shape))+' мм','drafting-sketch-text');
      }else{
        const a=arcPoint(shape,-45),b=offset(a,{x:1,y:-1},18*px);
        line(group,a,b,'drafting-sketch-leader');label(group,offset(b,{x:1,y:0},17*px),'⌀'+display(valueOf(shape))+' мм','drafting-sketch-text');
      }
      dimensions.append(group);
    }
    if(mode==='check'&&report){
      const mark=(point,kind)=>markers.append(svg('circle',{cx:point.x,cy:point.y,r:6*px,class:'drafting-sketch-error '+kind}));
      for(const [index,gap] of report.gaps.entries()){
        mark(gap.a.point,'gap');mark(gap.b.point,'gap');line(markers,gap.a.point,gap.b.point,'drafting-sketch-gap');
        const prefix=report.gaps.length>1?(index+1)+' · ':'';
        label(markers,offset(midpoint(gap.a.point,gap.b.point),{x:0,y:-1},10*px),prefix+display(gap.length/MM)+' мм','drafting-sketch-text');
      }
      for(const point of report.duplicates)mark(point,'duplicate');
      for(const point of report.intersections)mark(point,'intersection');
      for(const issue of report.issues)for(const point of issue.points.slice(0,4))mark(point,issue.code);
    }
    const shape=mode==='dimension'&&current.shapeMap.get(selected);
    if(shape?.type==='line')line(markers,shape.a,shape.b,'design-link-outline');
    else if(shape&&editableDimension(shape))markers.append(svg('circle',{cx:shape.cx,cy:shape.cy,r:shape.r,class:'design-link-outline'}));
  }
  function refresh(){
    const records=app.getSketchDimensions();
    if(!records.length&&!mode){dimensions.replaceChildren();markers.replaceChildren();return;}
    const current=visibleShapes();
    if(mode==='check')showCheck(current);
    if(mode==='dimension')showDimension(current);
    draw(current,records);
  }
  function run(key){
    if(!['check','dimension'].includes(key))return false;
    close({restoreFocus:false});
    cad.cancel();
    if(app.isModelOpen())cad.modelMode(false);
    openingFocus=document.activeElement;mode=key;panel.hidden=false;
    document.body.classList.add('drafting-sketch-active');
    refresh();panel.querySelector('button')?.focus({preventScroll:true});return true;
  }
  function shapeDistance(shape,p){
    if(shape.type!=='line')return Math.abs(Math.hypot(p.x-shape.cx,p.y-shape.cy)-shape.r);
    const d=sub(shape.b,shape.a),t=Math.max(0,Math.min(1,dot(sub(p,shape.a),d)/(dot(d,d)||1)));
    return distance(p,offset(shape.a,d,t));
  }
  document.addEventListener('pointerdown',event=>{
    if(mode!=='dimension'||event.button!==0||!wrap.contains(event.target))return;
    event.preventDefault();event.stopImmediatePropagation();
    const {shapes,movable}=visibleShapes(),point=app.getPaperPoint(event);
    let nearest=15/(paper.getScreenCTM()?.a||1);
    selected='';
    for(const shape of shapes.filter(s=>editableDimension(s)&&movable(s.id))){
      const length=shapeDistance(shape,point);
      if(length<nearest){nearest=length;selected=shape.id;}
    }
    refresh();
  },true);
  document.addEventListener('keydown',event=>{
    if(!mode||event.key!=='Escape'||document.querySelector('dialog[open]'))return;
    event.preventDefault();event.stopImmediatePropagation();close();
  },true);
  document.addEventListener('labchange',event=>{
    const {kind,open}=event.detail;
    if(kind==='project'||open&&(kind==='model'||kind==='draftview')||kind==='tool'&&mode==='dimension')close({restoreFocus:false});
    if(!['drawing','viewport','project','sketchdimensions'].includes(kind))return;
    refreshPanel||=kind!=='viewport';
    if(refreshFrame)return;
    refreshFrame=requestAnimationFrame(()=>{
      refreshFrame=0;
      const rebuild=refreshPanel;refreshPanel=false;
      if(rebuild||!mode)refresh();
      else draw(visibleShapes(),app.getSketchDimensions());
    });
  });
  global.LabDraftingSketchTools=Object.freeze({run,close,active:()=>mode});
  refresh();
})(typeof window==='undefined'?globalThis:window);
