/* Additional precise sketch geometry, linked shapes and constraint previews. */
(function (root) {
  'use strict';
  const MM=4, EPS=1e-6, TAU=2*Math.PI;
  const add=(a,b,k=1)=>({x:a.x+b.x*k,y:a.y+b.y*k});
  const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
  const length=p=>Math.hypot(p.x,p.y);
  const dot=(a,b)=>a.x*b.x+a.y*b.y;
  const cross=(a,b)=>a.x*b.y-a.y*b.x;
  const normal=p=>({x:-p.y,y:p.x});
  const polar=angle=>({x:Math.cos(angle),y:Math.sin(angle)});
  const unit=p=>{
    const size=length(p);
    if(size<=EPS)throw new Error('Выберите разные точки.');
    return {x:p.x/size,y:p.y/size};
  };
  const line=(a,b)=>({type:'line',a,b});
  const path=points=>({type:'path',points});
  const pointsOf=shape=>shape.type==='line'?[shape.a,shape.b]:shape.points;
  const center=shape=>({x:shape.cx,y:shape.cy});
  const corner=shape=>pointsOf(shape)?.[0]||center(shape);
  const shown=n=>Number(n.toFixed(3)).toLocaleString('ru-RU');
  const bounded=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  function checkPoint(p){
    if(!p||!bounded(p.x,-100000,100000)||!bounded(p.y,-100000,100000))throw new Error('Точка вне рабочей области.');
    return {x:p.x,y:p.y};
  }
  function polygon(at,n,size,mode,angle){
    if(!Number.isInteger(n)||!bounded(n,3,72)||!bounded(size,.04,1600))throw new Error('Задайте от 3 до 72 сторон и размер от 0,01 до 400 мм.');
    const r=mode==='side'?size/(2*Math.sin(Math.PI/n)):mode==='inscribed'?size/Math.cos(Math.PI/n):size;
    const points=Array.from({length:n},(_,i)=>add(at,polar(angle+i*TAU/n),r));
    return path([...points,points[0]]);
  }
  function slot(a,b,width){
    if(!bounded(width,.04,1600))throw new Error('Задайте ширину паза от 0,01 до 400 мм.');
    const d=unit(sub(b,a)),theta=Math.atan2(d.y,d.x),r=width/2;
    const arc=(p,start)=>Array.from({length:25},(_,i)=>add(p,polar(start+i*Math.PI/24),r));
    const points=[...arc(b,theta-Math.PI/2),...arc(a,theta+Math.PI/2)];
    return path([...points,points[0]]);
  }
  function tangents(first,second,internal=false){
    const a=center(first),b=center(second),d=sub(b,a),u=unit(d),r=internal?-second.r:second.r;
    const c=(first.r-r)/length(d);
    if(Math.abs(c)>=1-EPS)throw new Error('У этих окружностей нет двух касательных выбранного типа.');
    const y=Math.sqrt(1-c*c);
    return [1,-1].map(side=>{
      const n=add({x:u.x*c,y:u.y*c},normal(u),side*y);
      return line(add(a,n,first.r),add(b,n,r));
    });
  }
  function bisector(first,second,size,external=false){
    if(!bounded(size,.04,1600))throw new Error('Задайте длину от 0,01 до 400 мм.');
    const u=unit(sub(first.b,first.a)),v=unit(sub(second.b,second.a));
    if(Math.abs(cross(u,v))<EPS)throw new Error('У параллельных прямых нет точки пересечения.');
    const meet=add(first.a,u,cross(sub(second.a,first.a),v)/cross(u,v));
    return {...line(meet,add(meet,unit(add(u,v,external?-1:1)),size)),construction:true};
  }
  function division(a,b,count){
    unit(sub(b,a));
    if(!Number.isInteger(count)||!bounded(count,2,100))throw new Error('Укажите целое число частей от 2 до 100.');
    return path(Array.from({length:count+1},(_,i)=>add(a,sub(b,a),i/count)));
  }
  function translated(shape,d,theta=0,anchor=corner(shape)){
    const move=p=>{
      const {x,y}=sub(p,anchor),c=Math.cos(theta),s=Math.sin(theta);
      return add(add(anchor,d),{x:x*c-y*s,y:x*s+y*c});
    };
    const style={construction:shape.construction};
    if(shape.type==='line')return {...style,...line(move(shape.a),move(shape.b))};
    if(shape.type==='path')return {...style,...path(shape.points.map(move))};
    const p=move(center(shape)),result={...style,type:shape.type,cx:p.x,cy:p.y,r:shape.r};
    if(shape.type==='arc')Object.assign(result,{start:((shape.start+theta*180/Math.PI)%360+360)%360,delta:shape.delta});
    return result;
  }
  function repeatAlong(shape,curve,step,rotate){
    if(!bounded(step,.04,2000))throw new Error('Укажите шаг от 0,01 до 500 мм.');
    const positions=pointsOf(curve),origin=corner(shape),copies=[];
    let traversed=0,next=0;
    for(let i=1;i<positions.length;i++){
      const a=positions[i-1],b=positions[i],direction=sub(b,a),span=length(direction);
      if(span<=EPS)continue;
      while(next<=traversed+span+EPS){
        if(copies.length>=100)throw new Error('Увеличьте шаг. За одно построение можно добавить до 100 копий.');
        const point=add(a,direction,Math.min(1,(next-traversed)/span));
        copies.push(translated(shape,sub(point,origin),rotate?Math.atan2(direction.y,direction.x):0,origin));
        next+=step;
      }
      traversed+=span;
    }
    if(!copies.length)throw new Error('Выберите траекторию с ненулевой длиной.');
    return copies;
  }
  function fitCircle(points){
    const start=points[0],row=points.map(p=>sub(p,start)),n=row.length;
    let xx=0,xy=0,x=0,yy=0,y=0,xv=0,yv=0,v=0;
    for(const p of row){
      const r2=p.x*p.x+p.y*p.y;
      xx+=p.x*p.x;xy+=p.x*p.y;x+=p.x;yy+=p.y*p.y;y+=p.y;xv+=p.x*r2;yv+=p.y*r2;v+=r2;
    }
    const a=xx-x*x/n,b=xy-x*y/n,c=yy-y*y/n,determinant=a*c-b*b;
    if(determinant<EPS)return null;
    const bx=xv-x*v/n,by=yv-y*v/n;
    const at=add(start,{x:(bx*c-by*b)/determinant/2,y:(by*a-bx*b)/determinant/2});
    const radius=points.reduce((sum,p)=>sum+length(sub(p,at)),0)/n;
    return {at,radius};
  }
  function cleanStroke(stroke,kind){
    const points=stroke.points;
    if(!points||points.length<2)throw new Error('Выберите линию, нарисованную карандашом.');
    const first=points[0],last=points.at(-1),d=sub(last,first),chord=length(d);
    const u=chord>EPS?unit(d):{x:0,y:0};
    const spread=points.reduce((largest,p)=>Math.max(largest,Math.abs(dot(sub(p,first),normal(u)))),0);
    if(kind==='line'||(kind==='auto'&&chord>EPS&&spread<=Math.max(.2,chord*.045))){
      if(chord<=EPS)throw new Error('Концы наброска совпадают.');
      return line(first,last);
    }
    const circle=fitCircle(points);
    if(!circle||!bounded(circle.radius,.02,2000))throw new Error('На этом наброске нельзя устойчиво определить окружность.');
    const {at,radius}=circle;
    if(kind==='circle'||(kind==='auto'&&chord<radius*.6))return {type:'circle',cx:at.x,cy:at.y,r:radius};
    const angle=p=>Math.atan2(p.y-at.y,p.x-at.x);
    let previous=angle(first),sweep=0;
    for(const p of points.slice(1)){
      const current=angle(p);
      sweep+=((current-previous+3*Math.PI)%TAU)-Math.PI;
      previous=current;
    }
    if(Math.abs(sweep)<.02||Math.abs(sweep)>TAU+.05)throw new Error('Для дуги проведите один непрерывный неполный оборот.');
    return {type:'arc',cx:at.x,cy:at.y,r:radius,start:angle(first)*180/Math.PI,delta:Math.max(-360,Math.min(360,sweep*180/Math.PI))};
  }
  function blockShape(source){
    if(source?.type==='line')return line(checkPoint(source.a),checkPoint(source.b));
    if(source?.type==='path'&&Array.isArray(source.points)&&bounded(source.points.length,1,4000))return path(source.points.map(checkPoint));
    if(['arc','circle'].includes(source?.type)&&bounded(source.r,.02,2000)){
      const p=checkPoint(center(source)),result={type:source.type,cx:p.x,cy:p.y,r:source.r};
      if(source.type==='arc'){
        if(!bounded(source.start,-360,360)||!bounded(source.delta,-360,360))throw new Error('Неверные параметры дуги блока.');
        Object.assign(result,{start:source.start,delta:source.delta});
      }
      return result;
    }
    throw new Error('Блок должен содержать отрезок, окружность, дугу или ломаную.');
  }
  function fromDefinition(def){
    if(def.kind==='linear-division'){
      const {a,b,count}=def,source={kind:def.kind,a:checkPoint(a),b:checkPoint(b),count};
      return {...division(source.a,source.b,count),sketchDefinition:source};
    }
    if(def.kind==='linked-block'){
      if(!/^[a-z0-9_-]{1,64}$/i.test(def.blockId))throw new Error('Укажите имя блока латиницей.');
      const source={kind:def.kind,blockId:def.blockId,at:checkPoint(def.at),shape:blockShape(def.shape)};
      const {construction,...geometry}=translated(source.shape,sub(source.at,corner(source.shape)));
      return {...geometry,sketchDefinition:source};
    }
    throw new Error('Неизвестное определение эскиза.');
  }
  const api={polygon,slot,tangents,bisector,division,repeatAlong,cleanStroke,fromDefinition};
  root.LabSketchExtra=Object.freeze(api);
  if(typeof module!=='undefined'&&module.exports){module.exports=api;return;}

  const commands=[
    ['polygon','Правильный многоугольник'],['slot','Паз по двум центрам'],['tangent','Общие касательные'],
    ['bisector','Биссектриса угла'],['division','Деление отрезка'],['array','Массив вдоль кривой'],
    ['block','Связанные блоки'],['clean','Преобразование наброска'],['conflicts','Конфликт связей'],['motion','Проверка движением']
  ];
  function sketchPreview(strokes,styleFor){
    const ns='http://www.w3.org/2000/svg';
    const svg=(tag,attributes={})=>{
      const node=document.createElementNS(ns,tag);
      for(const [name,value] of Object.entries(attributes))node.setAttribute(name,String(value));
      return node;
    };
    const picture=svg('svg',{class:'lab-workbench-preview',height:180,width:'100%',role:'img','aria-label':'Предпросмотр эскиза'});
    let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
    for(const stroke of strokes){
      const style=styleFor(stroke),points=pointsOf(stroke);
      const outline=points||(stroke.type==='arc'
        ?Array.from({length:65},(_,i)=>add(center(stroke),polar((stroke.start+stroke.delta*i/64)*Math.PI/180),stroke.r))
        :[add(center(stroke),{x:stroke.r,y:stroke.r}),add(center(stroke),{x:-stroke.r,y:-stroke.r})]);
      for(const p of outline){x=Math.min(x,p.x);y=Math.min(y,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);}
      const shape=stroke.type==='circle'?svg('circle',{cx:stroke.cx,cy:stroke.cy,r:stroke.r}):
        svg('polyline',{points:outline.map(p=>p.x+','+p.y).join(' ')});
      for(const [name,value] of Object.entries({fill:'none',...style,'vector-effect':'non-scaling-stroke'}))shape.setAttribute(name,value);
      picture.append(shape);
    }
    const margin=Math.max(4,(right-x)*.05,(bottom-y)*.05);
    picture.setAttribute('viewBox',[x-margin,y-margin,right-x+margin*2,bottom-y+margin*2].join(' '));
    return picture;
  }
  function mount(body,ui){
    const app=ui.app;
    const menu=ui.el('select');
    menu.setAttribute('aria-label','Дополнительная операция эскиза');
    for(const [value,name] of commands){
      const option=ui.el('option',name);option.value=value;menu.append(option);
    }
    const panel=ui.el('div');
    body.append(menu,panel);
    const update=()=>{panel.replaceChildren();render(menu.value,panel,app);};
    menu.addEventListener('change',update);update();
  }
  function render(kind,panel,app){
    const strokes=app.getVisibleStrokes(),snapshot=app.getState();
    const input=(tag,text,values)=>{
      const node=document.createElement(tag);
      if(values)Object.assign(node,values);
      if(text)node.textContent=text;
      return node;
    };
    const form=input('form'),result=input('div');
    form.className='lab-workbench-grid';
    result.setAttribute('role','status');
    panel.append(form,result);
    const attach=(label,control)=>{
      const field=input('label');field.append(input('span',label),control);form.append(field);return control;
    };
    const n=(label,value,step='any')=>attach(label,input('input',null,{type:'number',value,step,required:true}));
    const choice=(label,options)=>{
      const field=input('select');field.append(...options.map(([value,name])=>input('option',name,{value})));
      return attach(label,field);
    };
    const xy=(label,x,y)=>[n(label+' X, мм',x),n(label+' Y, мм',y)];
    const point=fields=>({x:fields[0].valueAsNumber*MM,y:fields[1].valueAsNumber*MM});
    const shapeName={line:'Отрезок',path:'Контур',arc:'Дуга',circle:'Окружность'};
    const pick=(label,filter=()=>true)=>choice(label,strokes.filter(filter).map((s,i)=>{
      const p=corner(s);
      return [s.id,(i+1)+'. '+shapeName[s.type]+' · '+shown(p.x/MM)+', '+shown(p.y/MM)+' мм'];
    }));
    const shape=field=>{
      const s=app.getSketchShape(field.value);
      if(!s)throw new Error('Сначала начертите подходящее построение на листе.');
      return s;
    };
    const commit=change=>{
      if(!app.applySketchUpgrade(change))throw new Error(app.getSketchUpgradeError()||'Построение не изменено.');
      result.textContent='Изменения внесены. Их можно отменить на листе.';
    };
    let run;
    if(kind==='polygon'){
      const at=xy('Центр',45,45),count=n('Сторон',6,1),size=n('Размер, мм',20);
      const mode=choice('Заданная величина',[['side','Длина стороны'],['outer','Радиус описанной окружности'],['inscribed','Радиус вписанной окружности']]);
      const angle=n('Начальный угол, °',0);
      run=()=>commit({add:[polygon(point(at),count.valueAsNumber,size.valueAsNumber*MM,mode.value,angle.valueAsNumber*Math.PI/180)]});
    }else if(kind==='slot'){
      const a=xy('Первый центр',35,35),b=xy('Второй центр',65,35),width=n('Ширина, мм',10);
      run=()=>commit({add:[slot(point(a),point(b),width.valueAsNumber*MM)]});
    }else if(kind==='tangent'){
      const a=pick('Первая окружность',s=>s.type==='circle'),b=pick('Вторая окружность',s=>s.type==='circle');
      if(b.options.length>1)b.selectedIndex=1;
      const mode=choice('Тип',[['outer','Внешняя'],['inner','Внутренняя']]);
      const side=choice('Вариант',[['first','Первая'],['second','Вторая'],['both','Обе']]);
      run=()=>{
        const lines=tangents(shape(a),shape(b),mode.value==='inner');
        commit({add:(side.value==='both'?lines:[lines[side.value==='second'?1:0]]).map(s=>({...s,construction:true}))});
      };
    }else if(kind==='bisector'){
      const a=pick('Первый отрезок',s=>s.type==='line'),b=pick('Второй отрезок',s=>s.type==='line');
      if(b.options.length>1)b.selectedIndex=1;
      const size=n('Длина биссектрисы, мм',24),mode=choice('Угол',[['inner','Между направлениями отрезков'],['outer','Смежный угол']]);
      run=()=>commit({add:[bisector(shape(a),shape(b),size.valueAsNumber*MM,mode.value==='outer')]});
    }else if(kind==='division'){
      const target=pick('Отрезок или прежнее деление',s=>s.type==='line'||s.sketchDefinition?.kind==='linear-division');
      const count=n('Частей',5,1),newEnd=xy('Новый конец (при изменении)',65,35);
      const edit=attach('Изменить длину деления',input('input',null,{type:'checkbox'}));
      run=()=>{
        const prior=shape(target),[start,end]=prior.type==='line'?[prior.a,prior.b]:[prior.points[0],prior.points.at(-1)];
        const data=fromDefinition({kind:'linear-division',a:start,b:edit.checked?point(newEnd):end,count:count.valueAsNumber});
        const connected=app.getConstraints().some(relation=>[relation.a,relation.b].includes(prior.id));
        const measured=app.getSketchDimensions().some(dimension=>dimension.shapeId===prior.id);
        if(prior.type==='line'&&(connected||measured)){
          commit({add:[{...data,construction:true}]});
        }else commit({replace:[{...prior,...data}]});
      };
    }else if(kind==='array'){
      const source=pick('Образец'),curve=pick('Траектория',s=>['path','line'].includes(s.type)),step=n('Шаг, мм',15);
      const turn=attach('Поворот по касательной',input('input',null,{type:'checkbox',checked:true}));
      run=()=>{
        const original=shape(source),route=shape(curve);
        if(original.id===route.id)throw new Error('Выберите разные образец и траекторию.');
        const copies=repeatAlong(original,route,step.valueAsNumber*MM,turn.checked);
        if(length(sub(corner(original),corner(copies[0])))<=EPS&&!turn.checked)copies.shift();
        if(!copies.length)throw new Error('Уменьшите шаг, чтобы добавить копию.');
        commit({add:copies});
      };
    }else if(kind==='block'){
      const action=choice('Действие',[['insert','Вставить связанный экземпляр'],['update','Обновить существующие экземпляры']]);
      const example=pick('Контур для блока'),name=attach('Имя блока',input('input',null,{type:'text',value:'block-1',maxLength:64,required:true}));
      const at=xy('Точка вставки',50,50);
      run=()=>{
        const blockId=name.value.trim(),matches=app.getState().strokes.filter(s=>s.sketchDefinition?.kind==='linked-block'&&s.sketchDefinition.blockId===blockId);
        const master=blockShape(shape(example));
        if(action.value==='update'&&!matches.length)throw new Error('В этом проекте ещё нет экземпляров с таким именем.');
        if(action.value==='update')commit({replace:matches.map(s=>({...s,...fromDefinition({...s.sketchDefinition,shape:master})}))});
        else commit({add:[fromDefinition({kind:'linked-block',at:point(at),blockId,shape:matches[0]?.sketchDefinition.shape||master})]});
      };
    }else if(kind==='clean'){
      const source=pick('Набросок',s=>s.type==='path'&&s.points.length>2);
      const type=choice('Результат',[['auto','Выбрать по наброску'],['line','Отрезок'],['circle','Окружность'],['arc','Дуга']]);
      let draft=null,confirmed=null;
      for(const field of [source,type])field.addEventListener('change',()=>{draft=null;confirmed=null;result.replaceChildren();});
      run=()=>{
        const prior=shape(source),current=JSON.stringify(prior);
        if(draft&&confirmed===current){
          commit({replace:[{...prior,...draft,sketchDefinition:undefined}]});
          draft=null;confirmed=null;
          return;
        }
        draft=cleanStroke(prior,type.value);confirmed=current;
        const preview=sketchPreview([prior,draft],s=>({stroke:s===prior?'#a46e35':'#1269af',
          'stroke-width':s===prior?1.4:2,'stroke-dasharray':s===prior?'4 3':''}));
        result.replaceChildren(input('p','Синий контур показывает результат. Нажмите «Применить» ещё раз, чтобы заменить набросок.'),preview);
      };
    }else if(kind==='conflicts'){
      run=()=>{
        const {strokes,sketchDimensions}=app.getState(),relations=app.getConstraints();
        if(!relations.length){result.textContent='Добавьте связи через «Мастерская → Связи эскиза».';return;}
        const report=root.LabSketchUpgrade.constraintReport(strokes,relations);
        const flagged=relations.filter(r=>report.unmet.includes(r.id)||report.redundant.includes(r.id));
        const names={center:'общий центр',equal:'равная длина',right:'перпендикулярность',tangent:'касание'};
        const list=input('ul');
        for(const item of flagged){
          const a=strokes.findIndex(s=>s.id===item.a)+1,b=strokes.findIndex(s=>s.id===item.b)+1;
          const text=(report.unmet.includes(item.id)?'Нарушена':'Избыточна')+' связь «'+names[item.kind]+'» у построений '+a+' и '+b+'.';
          list.append(input('li',text));
        }
        const touched=new Set(flagged.flatMap(r=>[r.a,r.b])),related=strokes.filter(s=>touched.has(s.id));
        for(const size of sketchDimensions)if(touched.has(size.shapeId))list.append(input('li','Проверьте размер построения '+(strokes.findIndex(s=>s.id===size.shapeId)+1)+'.'));
        const preview=flagged.length?sketchPreview(related,()=>({stroke:'#ab4a2d','stroke-width':2.2})):null;
        result.replaceChildren(input('p',flagged.length?'Проверьте отмеченные построения.':'Конфликты связей не обнаружены.'),...(preview?[preview,list]:[]));
      };
    }else if(kind==='motion'){
      const target=pick('Проверяемый отрезок',s=>s.type==='line'&&!s.mirrorOf),radius=n('Диапазон движения, мм',12);
      const canvas=input('canvas',null,{width:600,height:310,tabIndex:0});
      canvas.className='lab-workbench-preview';canvas.style.width='100%';canvas.style.touchAction='none';
      canvas.setAttribute('aria-label','Диаграмма допустимого движения. Перетащите вершину или воспользуйтесь стрелками.');
      panel.append(canvas);
      run=()=>{
        const prior=shape(target),all=app.getState().strokes,relations=app.getConstraints();
        const layers=new Map(snapshot.layers.map(layer=>[layer.id,layer]));
        const movable=s=>{const l=layers.get(s.layer);return l?.visible&&!l.locked;};
        if(!movable(prior))throw new Error('Разблокируйте слой выбранного отрезка.');
        const range=radius.valueAsNumber*MM;
        if(!bounded(range,.04,1600))throw new Error('Диапазон должен быть от 0,01 до 400 мм.');
        const scale=140/range,c=canvas.getContext('2d'),origin=prior.b,positions=[];
        const px=p=>[300+(p.x-origin.x)*scale,155+(p.y-origin.y)*scale];
        const connected=new Set([prior.id]),linked=[];
        for(let i=0;i<relations.length;i++){
          let added=0;
          for(const relation of relations)if(connected.has(relation.a)||connected.has(relation.b)){
            const size=connected.size;connected.add(relation.a);connected.add(relation.b);added+=connected.size-size;
          }
          if(!added)break;
        }
        for(const relation of relations)if(connected.has(relation.a))linked.push(relation);
        const neighborhood=all.filter(s=>connected.has(s.id));
        if(neighborhood.length>16)throw new Error('Для проверки движения выберите эскиз с группой до 16 связанных построений.');
        for(let x=-8;x<=8;x++)for(let y=-8;y<=8;y++){
          const b=add(origin,{x:x*range/8,y:y*range/8});
          if(length(sub(b,prior.a))<.04)continue;
          try{
            const moves=new Map([[prior.id,{...prior,b}]]);
            root.LabDesignConstraints.solve(neighborhood,linked,moves,movable,prior.id);
            const candidate=neighborhood.map(s=>moves.get(s.id)||s);
            if(root.LabSketchUpgrade.constraintReport(candidate,linked).unmet.length)continue;
            positions.push({b,moves});
          }catch{ /* An invalid sample is outside the feasible movement region. */ }
        }
        let current=null;
        const trace=()=>{
          c.clearRect(0,0,600,310);c.fillStyle='#e5eef7';c.fillRect(0,0,600,310);
          c.fillStyle='#5084a780';
          for(const {b} of positions){const [x,y]=px(b);c.fillRect(x-3,y-3,6,6);}
          if(!current)return;
          c.strokeStyle='#173f5b';c.lineWidth=2;
          for(const piece of current.moves.values())if(piece.type==='line'){c.beginPath();c.moveTo(...px(piece.a));c.lineTo(...px(piece.b));c.stroke();}
          c.beginPath();c.arc(...px(current.b),5,0,TAU);c.stroke();
        };
        const highlight=p=>{
          current=positions.reduce((best,a)=>!best||length(sub(a.b,p))<length(sub(best.b,p))?a:best,null);trace();
        };
        canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);canvas.onpointermove(e);};
        canvas.onpointermove=e=>{
          if(!e.buttons)return;
          const r=canvas.getBoundingClientRect();
          highlight(add(origin,{x:((e.clientX-r.left)*600/r.width-300)/scale,y:((e.clientY-r.top)*310/r.height-155)/scale}));
        };
        canvas.onkeydown=e=>{
          const directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
          if(!directions[e.key]||!current)return;
          e.preventDefault();const [x,y]=directions[e.key];highlight(add(current.b,{x,y},range/8));
        };
        highlight(origin);
        result.textContent='Проверено 289 положений. Голубые точки показывают '+positions.length+' допустимых положений.';
      };
    }
    form.append(input('button',['motion','conflicts'].includes(kind)?'Проверить':'Применить',{type:'submit',className:'primary-button'}));
    form.addEventListener('submit',e=>{
      e.preventDefault();
      try{run();}catch(error){result.textContent=error.message;}
    });
  }
  document.addEventListener('DOMContentLoaded',()=>{
    root.LabExtensions?.register({id:'sketch',title:'Точный эскиз',mount});
  },{once:true});
})(typeof window==='undefined'?globalThis:window);
