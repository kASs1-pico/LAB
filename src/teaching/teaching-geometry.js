/* Offline assignments and geometry-based assessment for the drafting lab. */
(function (global) {
  'use strict';
  const mm = 4;
  const paint = {color:'#263c46',width:2};
  const types = {
    closed:['Замкнутое тело',''],x:['Габарит по X','мм'],y:['Габарит по Y','мм'],z:['Высота','мм'],
    bodies:['Количество тел',''],holes:['Количество сквозных отверстий',''],diameter:['Диаметр ближайшего к центру отверстия','мм'],
    center:['Смещение центра отверстия','мм'],volume:['Объём','мм³'],wall:['Толщина стенок по выборочным замерам','мм'],
    drawing:['Размеры на листе',''],
    section:['Линия разреза',''],measurements:['Замеры в журнале',''],conclusion:['Длина вывода','симв.'],
    outline:['Совпадение контуров','%'],manual:['Ручная проверка','']
  };
  const integer = (value,min,max) => Number.isInteger(value) && value>=min && value<=max;
  const bounded = (value,min,max) => Number.isFinite(value) && value>=min && value<=max;
  const clean = (value,max) => typeof value === 'string' ? value.trim().slice(0,max) : '';
  const standardScale = Object.freeze({excellent:90,good:75,pass:50});
  const project = (strokes=[],modelHeight=20) => ({version:1,orientation:'landscape',strokes,modelHeight});
  const point = ([x,y]) => ({x:x*mm,y:y*mm});
  const polygon = (vertices,id) => ({...paint,type:'path',id,points:[...vertices,vertices[0]].map(point)});
  const circle = (x,y,diameter,id) => ({...paint,type:'circle',id,cx:x*mm,cy:y*mm,r:diameter*mm/2});
  const corners = (x,y,w,h) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
  const edges = (vertices) => vertices.map((position,i)=>[position,vertices[(i+1)%vertices.length]]);
  const rect = (x,y,w,h) => edges(corners(x,y,w,h));
  function plate(length,width,height,diameter=0) {
    const strokes=[polygon(corners(50,55,length,width),'plate')];
    if(diameter>0)strokes.push(circle(50+length/2,55+width/2,diameter,'bore'));
    return project(strokes,height);
  }
  function choose(variant,step,cycle,offset=0) { return ((variant-1+offset)%cycle)*step; }
  function baseSize(variant) {
    return {length:60+choose(variant,5,7),width:40+choose(variant,5,5,2),height:10+choose(variant,2,8,4),
      diameter:10+choose(variant,2,9,3)};
  }
  const rule = (type,value=1,tolerance=0,points=1,operator='near',label='') => ({type,value,tolerance,points,operator,label});
  const dimensions = (length,width,height) => [rule('x',length,1),rule('y',width,1),rule('z',height,.5)];
  const boreRules = diameter => [rule('holes',1),rule('diameter',diameter,.65,2),rule('center',0,1.2)];
  const plateVolume = (length,width,height,diameter) => {
    const volume=(length*width-Math.PI*diameter**2/4)*height;
    return rule('volume',volume,Math.max(15,volume*.015),1);
  };
  const atLeast = (type,value,points=1) => rule(type,value,0,points,'min');
  const atMost = (type,value,points=1) => rule(type,value,0,points,'max');
  const conclusion = () => rule('conclusion',18,0,1,'min');
  const view = (label,segments,dashed=[]) => ({label,segments,dashed});
  function threeViews(length,width,height,diameter) {
    const x=(length-diameter)/2,y=(width-diameter)/2, r=diameter/2;
    const ring = diameter ? edges(Array.from({length:48},(_,i)=>{
      const t=i*2*Math.PI/48;
      return [length/2+r*Math.cos(t),width/2+r*Math.sin(t)];
    })) : [];
    return [
      view('Сверху',rect(0,0,length,width).concat(ring)),
      view('Спереди',rect(0,0,length,height),diameter ? [[[x,0],[x,height]],[[x+diameter,0],[x+diameter,height]]] : []),
      view('Справа',rect(0,0,width,height),diameter ? [[[y,0],[y,height]],[[y+diameter,0],[y+diameter,height]]] : [])
    ];
  }
  const list = [
    ['first','Первая деталь','51'],
    ['third','Дострой третий вид','52'],
    ['cut','Предскажи разрез','53'],
    ['restore','Восстанови деталь','54'],
    ['mistake','Найди ошибку инженера','55'],
    ['real','Обмер с натуры','56'],
    ['light','Облегчи конструкцию','57'],
    ['revision','Внеси изменение по заказу','59'],
    ['pair','Конструктор и мастер','60']
  ];
  function builtIn(id,variant=1) {
    const card=list.find(entry=>entry[0]===id);
    if(!card)throw new Error('Неизвестный практикум.');
    if(!integer(variant,1,999))throw new Error('Укажите номер варианта от 1 до 999.');
    const {length:l,width:w,height:h,diameter:d}=baseSize(variant);
    const valid=rule('closed');
    const answer=plate(l,w,h,d);
    const views=threeViews(l,w,h,d);
    const defaults={
      kind:'lab-task',version:1,id,variant,title:card[1],mode:'practice',maxAttempts:0,
      reveal:'after',toolLimit:false,scale:standardScale,starter:project(),reference:[],outline:null,referenceModel:null,
      hints:[],criteria:[],brief:''
    };
    if(id==='first')return {...defaults,
      brief:`Постройте пластину ${l} × ${w} мм. Добавьте в центре сквозное отверстие Ø${d} мм. Задайте высоту ${h} мм и поставьте на чертеже минимум два размера.`,
      starter:plate(l,w,h),referenceModel:answer,
      hints:['На листе уже есть внешний контур. Начните с отверстия.','Найдите центр прямоугольника по диагоналям. Радиус окружности равен половине диаметра.',
        `Начертите окружность радиуса ${d/2} мм в центре, откройте 3D и проверьте высоту ${h} мм. В режиме «Чертёж» нажмите на вид, чтобы добавить размеры.`],
      criteria:[valid,...dimensions(l,w,h),...boreRules(d),atLeast('drawing',2,2)]
    };
    if(id==='third')return {...defaults,
      brief:`На карточке показаны вид сверху и вид спереди цельной прямоугольной детали. Постройте на чистом листе внешний контур вида справа в масштабе 1:1. Размеры тела ${l} × ${w} × ${h} мм.`,
      reference:threeViews(l,w,h,0).slice(0,2),outline:view('Эталон вида справа',rect(0,0,w,h)),
      hints:['Глубину найдите на виде сверху.','Высоту перенесите с вида спереди.','Начертите один замкнутый прямоугольник. Горизонтальное направление на листе соответствует глубине.'],
      criteria:[atLeast('outline',94,5)]
    };
    if(id==='cut'){
      const gap=(l-d)/2;
      const cutView=structuredClone(views[0]);
      cutView.dashed.push([[-4,w/2],[l+4,w/2]]);
      return {...defaults,
        brief:`Линия А–А проходит через центр сквозного отверстия детали ${l} × ${w} × ${h} мм. Диаметр отверстия ${d} мм. На чистом листе изобразите границы двух участков материала в масштабе 1:1. Сечение рисуйте двумя замкнутыми прямоугольниками.`,
        reference:[{...cutView,label:'Вид сверху и линия А–А'}],
        outline:view('Эталон сечения А–А',rect(0,0,gap,h).concat(rect(gap+d,0,gap,h))),
        hints:['Разрез проходит вдоль длинной стороны. Найдите, где он пересечёт пустоту.','Промежуток между участками материала равен диаметру отверстия.',
          `Оба участка имеют высоту ${h} мм. Ширина каждого равна (${l} − ${d}) ÷ 2 мм.`],
        criteria:[atLeast('outline',94,5)]
      };
    }
    if(id==='restore')return {...defaults,
      brief:`Восстановите модель по трём видам. Габариты ${l} × ${w} × ${h} мм, диаметр сквозного отверстия ${d} мм. Центр отверстия совпадает с центром пластины.`,
      reference:views,referenceModel:answer,
      hints:['Вид сверху определяет плоский профиль.','Пунктир на боковых видах обозначает границы отверстия.','Начертите внешний прямоугольник и внутреннюю окружность. Вытяните полученный профиль на высоту, указанную на задании.'],
      criteria:[valid,rule('bodies',1),...dimensions(l,w,h),...boreRules(d),plateVolume(l,w,h,d)]
    };
    if(id==='mistake')return {...defaults,
      brief:`Проверьте деталь ${l} × ${w} × ${h} мм. На листе оставлено сквозное отверстие неверного размера. Выставьте Ø${d} мм и кратко объясните, как нашли ошибку.`,
      starter:plate(l,w,h,d+6),referenceModel:answer,
      hints:['Начните с измерения окружности.','Сравните результат с диаметром из условия.','Выберите окружность на листе и измените её управляющий размер. После перестроения проверьте модель.'],
      criteria:[...dimensions(l,w,h),...boreRules(d),conclusion()]
    };
    if(id==='real')return {...defaults,
      brief:'Выберите безопасную для обмера деталь небольшого размера. Добавьте её фото как кальку, измерьте крайние габариты и построите упрощённую 3D-модель. В журнале запишите три замера. Опишите, какие элементы вы упростили.',
      hints:['Начните с детали простой формы и фотографии сверху.','Калибруйте кальку по отрезку известной длины.','Уберите кромки и мелкие элементы из эскиза, если они мешают собрать надёжную упрощённую модель.'],
      criteria:[valid,atLeast('measurements',3,3),conclusion(),rule('manual',0,0,2,'near','Соответствие модели и исходной детали')]
    };
    if(id==='light'){
      const referenceVolume=l*w*h;
      return {...defaults,
        brief:`Облегчите заготовку ${l} × ${w} × ${h} мм. Сохраните внешние габариты, сделайте центральное сквозное отверстие Ø${d} мм и уберите материал карманами. Итоговый объём должен составлять от 70% до 90% исходного. Стенки — от 2 мм. Объясните, как сохранили форму.`,
        starter:plate(l,w,h),referenceModel:null,
        hints:['Вычислите исходный объём перемножением трёх габаритов.','Сначала задайте отверстие, затем снимите материал одним или несколькими глухими карманами.',
          `Минимум ${Math.floor(referenceVolume*.7)} мм³, максимум ${Math.ceil(referenceVolume*.9)} мм³. Меняйте размеры кармана небольшими шагами.`],
        criteria:[valid,...dimensions(l,w,h),...boreRules(d),atLeast('volume',referenceVolume*.7),atMost('volume',referenceVolume*.9),atLeast('wall',2),conclusion()]
      };
    }
    if(id==='revision')return {...defaults,
      brief:`Заказчик изменил высоту детали с ${h} до ${h+6} мм и диаметр отверстия с ${d} до ${d+4} мм. Сохраните длину, ширину и положение отверстия. Обновите размеры на чертеже и запишите, что поменяли.`,
      starter:answer,referenceModel:plate(l,w,h+6,d+4),
      hints:['Проверьте, какие значения следует изменить, а какие сохранить.','Высоту удобнее изменить на 3D-модели, диаметр окружности — на листе.',
        `В конце проверьте высоту ${h+6} мм и диаметр ${d+4} мм. Добавьте на чертёж эти два размера.`],
      criteria:[...dimensions(l,w,h+6),...boreRules(d+4),atLeast('drawing',2,2),conclusion()]
    };
    return {...defaults,
      brief:`Конструктор оформляет чертёж пластины ${l} × ${w} × ${h} мм с центральным отверстием Ø${d} мм и отдаёт лист мастеру. Мастер строит по чертежу модель. В выводе укажите, какие размеры пришлось уточнять.`,
      referenceModel:answer,
      hints:['Начните с вида сверху и вида спереди.','Добавьте размер, определяющий положение или центр отверстия.','Проверьте габариты, высоту, диаметр и центр. Запишите уточнения при обмене работами.'],
      criteria:[valid,...dimensions(l,w,h),...boreRules(d),atLeast('drawing',3,2),conclusion(),rule('manual',0,0,2,'near','Читаемость чертежа для партнёра')]
    };
  }

  function checkProject(project, optional=false) {
    if(optional && project==null)return null;
    if(!project || project.version!==1 || !['landscape','portrait'].includes(project.orientation) ||
      !Array.isArray(project.strokes) || project.strokes.length>1024 || (project.modelFeatures?.length||0)>64) {
      throw new Error('Укажите корректный проект CAD.');
    }
    let points=0;
    for(const shape of project.strokes){
      if(!shape || !Object.hasOwn({line:1,path:1,circle:1,arc:1},shape.type))throw new Error('В проекте неизвестный тип построения.');
      if(shape.type==='path'&&(!Array.isArray(shape.points)||shape.points.length>12000))throw new Error('Слишком сложный контур проекта.');
      points+=shape.points?.length||2;
      if(points>50000)throw new Error('Слишком много точек для проверки работы.');
    }
    return project;
  }
  function validateTask(input) {
    if(!input || input.kind!=='lab-task' || input.version!==1 || !/^[a-z0-9_-]{1,80}$/i.test(input.id||'') ||
      !integer(input.variant,1,999) || !clean(input.title,100) || !clean(input.brief,1800) ||
      !Array.isArray(input.criteria) || input.criteria.length<1 || input.criteria.length>25)throw new Error('Неверный файл задания.');
    const criteria=input.criteria.map(item=>{
      if(!item || !Object.hasOwn(types,item.type) || !bounded(item.value,0,1e12) ||
        !bounded(item.tolerance,0,1e12) || !integer(item.points,1,20) ||
        !['near','min','max'].includes(item.operator))throw new Error('Неверный критерий проверки.');
      return {...rule(item.type,item.value,item.tolerance,item.points,item.operator,clean(item.label,100))};
    });
    if(criteria.every(item=>item.type==='manual'))throw new Error('Добавьте хотя бы один автоматический критерий.');
    const scale=input.scale??standardScale;
    if(![scale.excellent,scale.good,scale.pass].every(value=>integer(value,1,100))
      ||scale.excellent<=scale.good||scale.good<=scale.pass)throw new Error('Для шкалы укажите возрастающие пороги для оценок 3, 4 и 5.');
    const vector=point=>Array.isArray(point)&&point.length===2&&point.every(n=>bounded(n,-1e4,1e4));
    const segments=items=>{
      if(!Array.isArray(items)||items.length>300||items.some(item=>!Array.isArray(item)||item.length!==2||!item.every(vector)))throw new Error('Неверное изображение в задании.');
      return items;
    };
    const diagram=schema=>{
      if(!schema || typeof schema!=='object')throw new Error('Неверное изображение в задании.');
      return {label:clean(schema.label,70),segments:segments(schema.segments),dashed:segments(schema.dashed||[])};
    };
    const outline=input.outline==null?null:diagram(input.outline);
    if(criteria.some(item=>item.type==='outline')&&!outline?.segments.length)throw new Error('Добавьте эталонный контур.');
    return {kind:'lab-task',version:1,id:input.id,title:clean(input.title,100),brief:clean(input.brief,1800),
      variant:input.variant,mode:input.mode==='test'?'test':'practice',maxAttempts:integer(input.maxAttempts,0,20)?input.maxAttempts:0,
      reveal:['always','after','never'].includes(input.reveal)?input.reveal:'after',toolLimit:input.toolLimit===true,
      scale:{excellent:scale.excellent,good:scale.good,pass:scale.pass},
      hints:(Array.isArray(input.hints)?input.hints:[]).slice(0,3).map(item=>clean(item,300)).filter(Boolean),
      starter:checkProject(input.starter,true)||project(),criteria,
      reference:(Array.isArray(input.reference)?input.reference:[]).slice(0,4).map(diagram),outline,
      referenceModel:checkProject(input.referenceModel,true)};
  }
  function strokesFor(project,allowConstruction=false) {
    const hidden=new Set((project.layers||[]).filter(layer=>layer?.visible===false).map(layer=>layer.id));
    return project.strokes.filter(s=>!hidden.has(s.layer)&&(allowConstruction||!s.construction));
  }
  function build(project) {
    const strokes=strokesFor(checkProject(project));
    const analysis=global.LabExtrusion.analyze(strokes,{tolerance:8});
    if(!analysis.ok)throw new Error(analysis.errors[0]?.message||'Не удалось построить 3D-модель.');
    const mesh=global.LabSolid.build(analysis,{strokes,height:project.modelHeight,
      bevel:project.modelBevel,bodies:project.modelBodies,features:project.modelFeatures});
    if(!mesh.positions.length)throw new Error('Модель не содержит объёма.');
    return mesh;
  }
  function key([x,y]){return Math.round(x*1e4)+','+Math.round(y*1e4);}
  function covers(mesh,[x,y],top) {
    const p=mesh.positions, lower=mesh.bounds.min[2], length=top-lower;
    for(let i=0;i<p.length;i+=9){
      const [ax,ay,az,bx,by,bz,cx,cy,cz]=p.subarray(i,i+9);
      const d=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
      if(Math.abs(d)<1e-7)continue;
      const a=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/d;
      const b=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/d;
      if(a>=-1e-7&&b>=-1e-7&&a+b<=1+1e-7){
        const z=a*az+b*bz+(1-a-b)*cz;
        if(z>=lower-1e-6&&z<=top+length*1e-6)return true;
      }
    }
    return false;
  }
  function roundBores(mesh) {
    const results=[];
    for(const body of mesh.bodies||[]){
      const {min,max}=body.bounds, p=body.mesh.positions, top=max[2];
      const capEdges=new Map();
      for(let i=0;i<p.length;i+=9){
        if([2,5,8].some(offset=>Math.abs(p[i+offset]-top)>1e-4))continue;
        const points=[0,3,6].map(offset=>[p[i+offset],p[i+offset+1]]);
        for(const [a,b] of edges(points)){
          const id=[key(a),key(b)].sort().join('|');
          if(capEdges.has(id))capEdges.delete(id);else capEdges.set(id,[a,b]);
        }
      }
      const nodes=new Map();
      for(const pair of capEdges.values())for(let i=0;i<2;i++){
        const vertex=key(pair[i]);
        if(!nodes.has(vertex))nodes.set(vertex,[]);
        nodes.get(vertex).push(pair[1-i]);
      }
      for(const start of nodes.keys()){
        const neighbors=nodes.get(start);
        if(neighbors.length!==2)continue;
        const ring=[neighbors[0]];
        let last=start,current=key(neighbors[0]);
        while(current!==start){
          const adjacent=nodes.get(current);
          if(adjacent?.length!==2)break;
          const next=adjacent.find(item=>key(item)!==last);
          nodes.delete(current);
          if(!next)break;
          ring.push(next);last=current;current=key(next);
        }
        nodes.delete(start);
        if(current!==start || ring.length<8)continue;
        const low=[Infinity,Infinity],high=[-Infinity,-Infinity];
        ring.forEach(value=>value.forEach((axis,j)=>{low[j]=Math.min(low[j],axis);high[j]=Math.max(high[j],axis);}));
        if(low.some((value,j)=>value<=min[j]+1e-4||high[j]>=max[j]-1e-4))continue;
        const center=low.map((value,i)=>(value+high[i])/2);
        const radii=ring.map(([x,y])=>Math.hypot(x-center[0],y-center[1]));
        const radius=radii.reduce((a,b)=>a+b,0)/radii.length;
        if(radius<=.1||radii.some(r=>Math.abs(r-radius)>Math.max(.08,radius*.02))||covers(body.mesh,center,top))continue;
        results.push({diameter:radius*2,centerDistance:Math.hypot(...center.map((value,i)=>value-(min[i]+max[i])/2))});
      }
    }
    return results.sort((a,b)=>a.centerDistance-b.centerDistance);
  }

  function segmentBounds(segments) {
    const bounds=[Infinity,Infinity,-Infinity,-Infinity];
    for(const segment of segments)for(const [x,y] of segment){
      bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);
      bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);
    }
    return bounds;
  }
  function normalizeSegments(segments) {
    const [x,y]=segmentBounds(segments);
    return segments.map(pair=>pair.map(([a,b])=>[a-x,b-y]));
  }
  function sketchSegments(project) {
    return strokesFor(project).flatMap(shape=>{
      const pair=p=>[p.x/mm,p.y/mm];
      if(shape.type==='path')return shape.points.slice(1).map((p,index)=>[pair(shape.points[index]),pair(p)]);
      if(shape.type==='line')return [[pair(shape.a),pair(shape.b)]];
      const count=Math.max(8,Math.round(Math.abs(shape.delta||360)/5));
      const points=Array.from({length:count+1},(_,index)=>{
        const a=((shape.start||0)+(shape.delta||360)*index/count)*Math.PI/180;
        return [(shape.cx+shape.r*Math.cos(a))/mm,(shape.cy+shape.r*Math.sin(a))/mm];
      });
      return points.slice(1).map((p,index)=>[points[index],p]);
    });
  }
  function distanceToLine([x,y],[[ax,ay],[bx,by]]) {
    const dx=bx-ax,dy=by-ay,d=dx**2+dy**2;
    const t=d?Math.min(1,Math.max(0,((x-ax)*dx+(y-ay)*dy)/d)):0;
    return Math.hypot(x-ax-t*dx,y-ay-t*dy);
  }
  function overlap(first,second,tolerance=1.25) {
    if(!first.length||!second.length)return 0;
    if(first.length>2048||second.length>2048)throw new Error('Упростите эскиз до 2048 отрезков для сравнения контуров.');
    const left=normalizeSegments(first),right=normalizeSegments(second);
    const agreement=(source,target)=>{
      let total=0,correct=0;
      for(const [[ax,ay],[bx,by]] of source) {
        const length=Math.hypot(bx-ax,by-ay),n=Math.max(2,Math.min(24,Math.ceil(length/2)));
        for(let i=0;i<n;i++){
          const p=[ax+(bx-ax)*(i+.5)/n,ay+(by-ay)*(i+.5)/n];
          if(target.some(segment=>distanceToLine(p,segment)<=tolerance))correct+=length/n;
        }
        total+=length;
      }
      return total?correct/total:0;
    };
    return Math.min(1,agreement(left,right),agreement(right,left))*100;
  }
  function minimumWall(mesh) {
    const I=global.LabInspectGeometry;
    if(!I)return null;
    let minimum=Infinity;
    for(const {mesh:part} of mesh.bodies){
      const triangles=I.triangles(part);
      if(!triangles.length)continue;
      for(const {distance} of I.wallSamples(triangles,I.tree(triangles))){
        if(Number.isFinite(distance))minimum=Math.min(minimum,distance);
      }
    }
    return Number.isFinite(minimum)?minimum:null;
  }
  function grade(task,project,summary='') {
    checkProject(project);
    const record=validateTask(task);
    const geometric=new Set(['closed','x','y','z','bodies','holes','diameter','center','volume','wall']);
    let mesh=null,error='';
    if(record.criteria.some(item=>geometric.has(item.type)))try{mesh=build(project);}catch(failure){error=failure.message;}
    const bores=mesh && record.criteria.some(item=>['diameter','center'].includes(item.type))?roundBores(mesh):[];
    const max=mesh?.bounds.max,min=mesh?.bounds.min;
    const values={
      closed:Number(mesh?.stats.closed===true),x:mesh?max[0]-min[0]:null,y:mesh?max[1]-min[1]:null,z:mesh?max[2]-min[2]:null,
      bodies:mesh?.bodies?.length??null,holes:mesh?.stats.holes??null,diameter:bores[0]?.diameter??null,
      center:bores[0]?.centerDistance??null,volume:mesh?.stats.volumeMm3??null,
      wall:mesh&&record.criteria.some(item=>item.type==='wall')?minimumWall(mesh):null,
      drawing:(project.projectionDimensions?.length||0)+(project.draftDesign?.notes?.length||0),
      section:Number(Boolean(project.draftDesign?.section)),
      measurements:project.measurementBook?.entries?.length||0,conclusion:clean(summary,1200).length,
      outline:record.outline?overlap(sketchSegments(project),record.outline.segments):null,manual:null
    };
    const rows=record.criteria.map(item=>{
      const got=values[item.type];
      const passed=item.type==='manual'?null:got===null?false:item.operator==='min'?got>=item.value-1e-6:
        item.operator==='max'?got<=item.value+1e-6:Math.abs(got-item.value)<=item.tolerance+1e-6;
      return {...item,got,passed,name:item.label||types[item.type][0],unit:types[item.type][1]};
    });
    const total=rows.reduce((sum,row)=>sum+row.points,0),points=rows.reduce((sum,row)=>sum+(row.passed?row.points:0),0);
    return {rows,points,total,error,mesh,scale:record.scale};
  }
  function mark(points,total,scale=standardScale) {
    const share=total?points/total*100:0;
    return share>=scale.excellent?5:share>=scale.good?4:share>=scale.pass?3:2;
  }
  const api={list:list.map(([id,title,number])=>({id,title,number})),types,builtIn,validateTask,checkProject,project,
    standardScale,rule,grade,mark,build,roundBores,segmentBounds,normalizeSegments,sketchSegments,overlap};
  global.LabTeaching=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
