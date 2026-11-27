/* Advanced modelling and assembly tools use the same undoable CAD transactions as the studio. */
(() => {
  'use strict';
  const {LabApp:app,LabCAD:cad,LabAssemblyGeometry:assembly,LabSolid:solid,LabInspectGeometry:queries}=window;
  const canvas=document.getElementById('model-canvas'),menu=document.getElementById('workshop-menu');
  const panel=document.createElement('aside');
  panel.className='workshop-popup glass solid-upgrade-panel';
  panel.id='solid-upgrade-panel';
  panel.hidden=true;
  document.body.append(panel);
  const titles={
    center:'Симметричное вытягивание', 'to-face':'Вытянуть до грани', revolve:'Вращение на угол',
    'edge-bevel':'Фаска ребра','edge-round':'Скругление ребра', 'split-body':'Разделить тело',
    'mirror-body':'Зеркальная деталь','draft-angle':'Уклон стенок',unfold:'Развёртка листа',
    'instance-body':'Связанная копия','catalog-body':'Типовая деталь','import-body':'Вставить проект',
    overlap:'Пересечения деталей',clearance:'Минимальный зазор',gears:'Связь вращения',
    sequence:'Порядок сборки'
  };
  const axes=[['0','X'],['1','Y'],['2','Z']];
  const parts=[['washer','Шайба'],['nut','Гайка'],['spacer','Втулка'],['pin','Штифт'],['screw','Винт с гладким стержнем']];
  const number=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:4});
  const createdUrl=new Set();
  const EPS=1e-6;
  let current=null,selected='',picked=null,temporary=false,frame=0,inspectionRun=0;
  const viewer=()=>app.getModelViewer();
  const bodyById=id=>app.getBodies().find(body=>body.id===id);
  const activeBody=()=>bodyById(selected)||app.getBodies()[0];
  function create(tag,text='',className=''){
    const element=document.createElement(tag);
    element.textContent=text;
    if(className)element.className=className;
    return element;
  }
  function button(text,action,handler){
    const node=create('button',text);
    node.type='button';
    node.dataset.solidAction=action;
    node.addEventListener('click',handler);
    return node;
  }
  function header(title){
    const row=create('header','','workshop-heading');
    const dismiss=button('×','close',close);
    dismiss.setAttribute('aria-label','Закрыть');
    row.append(create('strong',title),dismiss);
    panel.setAttribute('aria-label',title);
    panel.append(row);
  }
  function paragraph(text){
    panel.append(create('p',text,'workshop-hint'));
  }
  function field(form,label,name,value,options={}){
    const row=create('label','','workshop-field');
    const control=create(options.items?'select':'input');
    control.name=name;
    if(options.items){
      for(const [key,text] of options.items){
        const option=create('option',text);
        option.value=key;
        control.append(option);
      }
    }else{
      control.type=options.text?'text':options.range?'range':'number';
      control.required=true;
      if(!options.text){
        control.step=String(options.step??'any');
        control.min=String(options.min??-10000);
        control.max=String(options.max??10000);
      }
    }
    control.value=String(value);
    row.append(create('span',label),control);
    form.append(row);
    return control;
  }
  function status(text=''){
    const node=panel.querySelector('.workshop-status');
    if(node)node.textContent=text;
  }
  function statusNode(){
    const note=create('p','','workshop-status');
    note.setAttribute('role','status');
    return note;
  }
  function restoreView(){
    inspectionRun++;
    cancelAnimationFrame(frame);
    if(temporary&&app.getModelMesh())viewer()?.setMesh(app.getModelMesh(),{animate:false});
    temporary=false;
    viewer()?.setInspectionOverlay();
    viewer()?.setFocusBody(null);
  }
  function close(){
    if(panel.hidden)return;
    restoreView();
    current=null;
    picked=null;
    panel.hidden=true;
  }
  function open(){
    cad.cancel();
    window.LabInspect?.close();
    window.LabDesignEdit?.close();
    window.LabAssemblyTools?.close();
    window.LabDrawingSheet?.close();
    window.LabWorkshop?.cancel();
    menu.hidden=true;
    if(!app.isModelOpen())cad.modelMode(true);
    selected=cad.getState().selected[0]||app.getBodies()[0]?.id;
    panel.hidden=false;
    show();
    panel.querySelector('button')?.focus({preventScroll:true});
  }
  function show(){
    restoreView();
    current=null;
    picked=null;
    panel.replaceChildren();
    header('Моделирование и сборка');
    const bodies=app.getBodies();
    if(!bodies.length){
      paragraph('Сначала начертите замкнутый контур и откройте модель.');
      return;
    }
    selected=activeBody().id;
    const list=create('div','','solid-body-list');
    const links=new Map(app.getState().modelFeatures.filter(f=>f.type==='mate'&&!f.suppressed).map(f=>[f.target,f]));
    const groups=new Map();
    for(const body of bodies){
      const pieces=body.name.split('/'),group=pieces.length>1?pieces[0].trim():'Детали';
      if(!groups.has(group))groups.set(group,[]);
      groups.get(group).push({body,name:pieces.length>1?pieces.slice(1).join('/').trim():body.name});
    }
    for(const [group,items] of groups){
      const subsection=create('section');
      subsection.append(create('h3',group));
      for(const {body,name} of items){
        const link=links.get(body.id);
        const command=button(name,'select-body',()=>{
          selected=body.id;
          cad.select(body.id);
          show();
          viewer()?.setFocusBody(body.id);
        });
        command.dataset.body=body.id;
        command.setAttribute('aria-pressed',String(body.id===selected));
        subsection.append(command);
        const info=body.fixed
          ?'Закреплённая опора'
          :link?.mode==='slide'
          ? `Ход ${number.format(link.min)}…${number.format(link.max)} мм`
          : link
            ? `Стыковка с ${bodyById(link.tool)?.name||'опорой'}`
            : body.derivedFrom
              ? `Источник · ${bodyById(body.derivedFrom)?.name||'деталь'}`
              : 'Свободное перемещение X, Y, Z';
        subsection.append(create('small',info));
      }
      list.append(subsection);
    }
    panel.append(list);
    const details=create('details');
    details.append(create('summary','Имя выбранной детали'));
    const rename=create('form');
    field(rename,'Имя или Узел/Имя','name',activeBody().name,{text:true}).maxLength=48;
    const saveName=button('Сохранить имя','rename',event=>event.currentTarget.form.requestSubmit());
    rename.append(saveName);
    rename.addEventListener('submit',event=>{
      event.preventDefault();
      const name=new FormData(rename).get('name').trim();
      if(name&&app.setBodySetting(selected,'name',name))show();
    });
    details.append(rename);
    panel.append(details);
    const lock=button(activeBody().fixed?'Снять закрепление':'Закрепить выбранную деталь','fixed',()=>{
      if(app.setBodySetting(selected,'fixed',!activeBody().fixed))show();
    });
    panel.append(lock);
    const solidCommands=['center','to-face','revolve','edge-bevel','edge-round','split-body','mirror-body','draft-angle','unfold','instance-body','catalog-body','import-body'];
    const inspectCommands=['overlap','clearance','gears','sequence'];
    for(const [title,commands] of [['Построение',solidCommands],['Осмотр сборки',inspectCommands]]){
      const group=create('section','','workshop-group');
      group.append(create('h3',title));
      for(const key of commands){
        const command=button(titles[key],key,()=>showCommand(key));
        if(inspectCommands.includes(key))command.disabled=bodies.length<2;
        group.append(command);
      }
      panel.append(group);
    }
  }
  function showCommand(key){
    restoreView();
    current=key;
    picked=null;
    panel.replaceChildren();
    header(titles[key]);
    const body=activeBody(),model=app.getState();
    if(!body)return show();
    paragraph(body.name);
    panel.append(button('‹ К списку деталей','back',show));
    const form=create('form');
    const other=app.getBodies().filter(part=>part.id!==body.id).map(part=>[part.id,part.name]);
    const dimension=body.bounds.max.map((v,i)=>v-body.bounds.min[i]);
    const center=body.bounds.min.map((v,i)=>(v+body.bounds.max[i])/2);
    if(key==='center'){
      field(form,'Полная высота, мм','height',body.height,{min:1,max:200});
      field(form,'Координата средней плоскости Z, мм','plane',center[2]);
    }else if(key==='to-face'){
      paragraph('Щёлкните горизонтальную грань другой детали над основанием.');
      pickedLabel('Грань не выбрана');
    }else if(key==='revolve'){
      const axis=model.modelBodies[body.id]?.axis;
      paragraph('Если ось ещё не задана, используйте ось Y слева от исходного контура.');
      field(form,'Угол поворота профиля, °','angle',axis?.angle??180,{min:.5,max:360});
    }else if(['edge-bevel','edge-round'].includes(key)){
      paragraph('Щёлкните наружное выпуклое ребро на холсте.');
      pickedLabel('Ребро не выбрано');
      field(form,key==='edge-bevel'?'Отступ фаски, мм':'Радиус, мм','radius',1,{min:.05,max:20});
    }else if(['split-body','mirror-body'].includes(key)){
      const workingPlanes=availablePlanes(model);
      const choices=[['coordinate','Координатная плоскость'],...workingPlanes.map(item=>[item.id,item.name])];
      const plane=field(form,'Плоскость','plane','coordinate',{items:choices});
      const axis=field(form,'Нормаль плоскости','axis','0',{items:axes});
      const position=key==='split-body'
        ?field(form,'Положение вдоль габарита, %','fraction',50,{min:1,max:99})
        :field(form,'Координата плоскости, мм','position',body.bounds.max[0]+5);
      plane.addEventListener('change',()=>{
        for(const control of [axis,position]){
          const hide=plane.value!=='coordinate';
          control.closest('label').hidden=hide;
          control.disabled=hide;
        }
      });
      if(key==='mirror-body')axis.addEventListener('change',()=>position.value=String(body.bounds.max[Number(axis.value)]+5));
    }else if(key==='draft-angle'){
      field(form,'Уклон внутрь, °','angle',4,{min:.1,max:30});
    }else if(key==='instance-body'){
      ['X','Y','Z'].forEach((axis,i)=>field(form,`Смещение ${axis}, мм`,axis,i===0?dimension[i]+5:0));
    }else if(key==='catalog-body'){
      const select=field(form,'Тип детали','part','washer',{items:parts});
      field(form,'Диаметр отверстия или стержня, мм','diameter',4,{min:.5,max:100});
      const outer=field(form,'Наружный диаметр или ширина под ключ, мм','outer',8,{min:.6,max:200});
      const height=field(form,'Общая высота, мм','height',1.5,{min:.25,max:200});
      select.addEventListener('change',()=>{
        outer.closest('label').hidden=select.value==='pin';
        height.value={washer:1.5,nut:3,spacer:8,pin:12,screw:12}[select.value];
      });
      ['X','Y','Z'].forEach((axis,i)=>field(form,`Положение ${axis}, мм`,axis,i===0?body.bounds.max[i]+8:center[i]));
    }else if(key==='import-body'){
      const file=create('input'),row=create('label','','workshop-field');
      Object.assign(file,{type:'file',accept:'.json,application/json',required:true});
      row.append(create('span','Проект лаборатории'),file);
      form.append(row);
      const choice=field(form,'Деталь из файла','component','',{items:[]});
      ['X','Y','Z'].forEach((axis,i)=>field(form,`Начало габарита ${axis}, мм`,axis,i===0?body.bounds.max[i]+8:body.bounds.min[i]));
      file.addEventListener('change',async()=>{
        picked=null;
        choice.replaceChildren();
        const source=file.files[0];
        if(!source)return;
        try{
          const imported=await readComponentFile(source);
          if(!file.isConnected||file.files[0]!==source)return;
          picked=imported;
          for(const [i,part] of imported.entries()){
            const option=create('option',part.name);
            option.value=String(i);
            option.disabled=part.mesh.positions.length>18000;
            choice.append(option);
          }
          status('Выберите деталь. Поддерживаются сетки до 2000 треугольников.');
        }catch(error){if(file.isConnected&&file.files[0]===source)status(error.message);}
      });
    }else if(key==='gears'){
      field(form,'Ведомая деталь','other',other[0]?.[0],{items:other});
      field(form,'Нормаль осей','axis','2',{items:axes});
      field(form,'Зубья ведущего колеса','first',12,{min:1,max:180,step:1});
      field(form,'Зубья ведомого колеса','second',24,{min:1,max:180,step:1});
      const dial=field(form,'Поворот ведущего, °','angle',0,{min:-360,max:360,step:1,range:true});
      form.addEventListener('input',()=>{if(form.checkValidity())run(key,new FormData(form));});
      dial.setAttribute('aria-describedby','solid-gear-note');
      const note=create('p','Пример для двух наружных колёс. Оси проходят через центры габаритов.');
      note.id='solid-gear-note';
      form.append(note);
    }else if(key==='sequence'){
      const items=app.getBodies().map(part=>[part.id,part.name]);
      const order=document.createElement('ol');
      order.className='solid-assembly-order';
      for(const [id,name] of items){
        const row=create('li');
        row.dataset.body=id;
        row.append(create('span',name));
        const move=(delta,event)=>{
          const other=delta<0?row.previousElementSibling:row.nextElementSibling;
          if(other)delta<0?other.before(row):other.after(row);
          event.currentTarget.focus();
        };
        row.append(button('↑','order-up',event=>move(-1,event)),button('↓','order-down',event=>move(1,event)));
        order.append(row);
      }
      form.append(order);
    }else if(key==='clearance'){
      field(form,'Вторая деталь','other',other[0]?.[0],{items:other});
    }else if(key==='unfold'){
      paragraph('Файл содержит контур плоской заготовки и линии сгибов выбранной детали.');
    }else if(key==='overlap'){
      paragraph('Проверяются пары с пересекающимися габаритами. Зоны взаимного проникновения выделяются на модели.');
    }
    const submit=create('button',key==='unfold'?'Скачать SVG':['overlap','clearance'].includes(key)?'Проверить':key==='sequence'?'Воспроизвести':key==='gears'?'Показать':'Применить');
    submit.type='submit';
    submit.dataset.solidAction='apply';
    form.append(submit,statusNode());
    form.addEventListener('submit',event=>{
      event.preventDefault();
      if(form.reportValidity())run(key,new FormData(form));
    });
    panel.append(form);
  }
  function pickedLabel(text){
    const li=create('p',text,'solid-picked');
    li.setAttribute('aria-live','polite');
    panel.append(li);
  }
  function applyFeature(body,feature){
    if(!app.addModelFeature({...feature,target:body.id}))throw new Error(app.getModelError()||'Операцию не удалось построить.');
  }
  function bodySettings(body,settings){
    app.beginModelEdit();
    for(const [key,value] of Object.entries(settings)){
      if(!app.previewBodySetting(body.id,key,value)){
        const message=app.getModelError();
        app.cancelModelEdit();
        throw new Error(message||'Проверьте параметры модели.');
      }
    }
    if(!app.commitModelEdit()){
      const message=app.getModelError();
      app.cancelModelEdit();
      throw new Error(message||'Изменение не удалось сохранить.');
    }
  }
  function onlyExtrude(body){
    if(body.mode!=='extrude'||body.assemblyTransform)throw new Error('Выберите прямое вытягивание без пространственного сопряжения.');
  }
  function availablePlanes(project){
    return project.modelFeatures.filter(f=>f.type==='workplane'&&!f.suppressed&&bodyById(f.target)).map(f=>{
      const body=bodyById(f.target);
      return {id:f.id,name:`${body.name} · плоскость ${number.format(f.origin[2]+body.offset[2])} мм`,
        origin:assembly.placePoint(body,queries.add(f.origin,body.offset)),normal:assembly.placeDirection(body,f.normal)};
    });
  }
  async function readComponentFile(file){
    if(file.size>15*1024*1024)throw new Error('Файл больше 15 МБ.');
    const project=app.prepareProject(JSON.parse(await file.text()),{geometryOnly:true});
    const layers=new Set(project.layers.filter(layer=>layer.visible).map(layer=>layer.id));
    const strokes=project.strokes.filter(shape=>layers.has(shape.layer||'main')&&!shape.construction);
    const profile=window.LabExtrusion.analyze(strokes,{tolerance:8});
    if(!profile.ok)throw new Error('Сначала исправьте профили в исходном проекте.');
    return solid.build(profile,{height:project.modelHeight,bevel:project.modelBevel,bodies:project.modelBodies,features:project.modelFeatures,strokes}).bodies;
  }
  function run(key,data){
    const body=activeBody();
    if(!body)return;
    const n=name=>Number(data.get(name));
    const xyz=['X','Y','Z'].map(n);
    try{
      if(key==='center'){
        onlyExtrude(body);
        const height=n('height');
        bodySettings(body,{height,offset:[body.offset[0],body.offset[1],n('plane')-height/2]});
      }else if(key==='to-face'){
        onlyExtrude(body);
        if(!picked)throw new Error('Выберите горизонтальную грань второй детали.');
        bodySettings(body,{height:picked.point[2]-body.offset[2]});
      }else if(key==='revolve'){
        if(body.derivedFrom||body.assemblyTransform)throw new Error('Выберите исходный профиль без сопряжения.');
        const axis=app.getState().modelBodies[body.id]?.axis||{point:[body.bounds.min[0]-body.offset[0],0],direction:[0,1]};
        bodySettings(body,{axis:{...axis,angle:n('angle')},mode:'revolve'});
      }else if(['split-body','mirror-body'].includes(key)){
        const selectedPlane=data.get('plane');
        if(selectedPlane==='coordinate'){
          applyFeature(body,key==='split-body'?{type:key,axis:n('axis'),fraction:n('fraction')/100}:{type:key,axis:n('axis'),position:n('position')});
        }else{
          const plane=availablePlanes(app.getState()).find(item=>item.id===selectedPlane);
          if(!plane)throw new Error('Рабочая плоскость недоступна.');
          const options=key==='split-body'
            ?{origin:assembly.unplacePoint(body,plane.origin),normal:assembly.unplaceDirection(body,plane.normal)}
            :{origin:plane.origin,normal:plane.normal};
          applyFeature(body,{type:key,plane:options});
        }
      }
      else if(key==='draft-angle')applyFeature(body,{type:key,angle:n('angle')});
      else if(key==='instance-body')applyFeature(body,{type:key,offset:xyz});
      else if(key==='catalog-body')applyFeature(body,{type:key,part:data.get('part'),diameter:n('diameter'),outer:n('outer'),height:n('height'),origin:xyz});
      else if(key==='import-body'){
        const part=picked?.[n('component')];
        if(!part||part.mesh.positions.length>18000)throw new Error('Выберите деталь, содержащую до 2000 треугольников.');
        applyFeature(body,{type:key,title:part.name,vertices:Array.from(part.mesh.positions),offset:queries.sub(xyz,part.bounds.min)});
      }
      else if(['edge-bevel','edge-round'].includes(key)){
        if(!picked)throw new Error('Выберите наружное ребро на модели.');
        const edge=picked.map(point=>queries.sub(assembly.unplacePoint(body,point),body.offset));
        applyFeature(body,{type:key,edge,radius:n('radius')});
      }else if(key==='overlap'){
        checkOverlap();
        return;
      }else if(key==='clearance'){
        checkClearance(body,bodyById(data.get('other')));
        return;
      }else if(key==='unfold'){
        downloadFlat(body);
        status('Развёртка сохранена.');
        return;
      }else if(key==='gears'){
        rotatePair(body,bodyById(data.get('other')),n('axis'),n('first'),n('second'),n('angle'));
        return;
      }else if(key==='sequence'){
        playSequence();
        return;
      }
      show();
      app.toast('Изменение сохранено.');
    }catch(error){status(error.message);}
  }
  async function checkOverlap(){
    const runId=++inspectionRun;
    const bodies=app.getBodies(),patches=[],rows=[];
    viewer()?.setInspectionOverlay();
    status('Проверяются пересекающиеся габариты…');
    let uncertain=0,checked=0;
    for(let i=0;i<bodies.length;i++){
      for(let j=i+1;j<bodies.length;j++){
        if(checked>=200)break;
        const a=bodies[i],b=bodies[j];
        if(a.bounds.min.some((v,k)=>v>=b.bounds.max[k]-EPS||b.bounds.min[k]>=a.bounds.max[k]-EPS))continue;
        checked++;
        await new Promise(resolve=>setTimeout(resolve,0));
        if(runId!==inspectionRun)return;
        try{
          const region=assembly.interference(a.mesh,b.mesh);
          if(region){
            for(const coordinate of region.positions)patches.push(coordinate);
            rows.push(`${a.name} / ${b.name} · ${number.format(region.stats.volumeMm3)} мм³`);
          }
        }catch{uncertain++;}
      }
    }
    viewer()?.setInspectionOverlay(patches,[],true);
    status([rows.length?rows.join('\n'):'В проверенных парах объём пересечения не обнаружен.',
      uncertain?`Не удалось оценить ${uncertain} пар сложных тел.`:'',
      checked>=200?'Проверены первые 200 пар с пересекающимися габаритами.':''].filter(Boolean).join('\n'));
  }
  function checkClearance(a,b){
    if(!b)throw new Error('Выберите вторую деталь.');
    const intersection=assembly.interference(a.mesh,b.mesh);
    if(intersection){
      viewer()?.setInspectionOverlay(intersection.positions,[],true);
      status(`Детали пересекаются. Объём ${number.format(intersection.stats.volumeMm3)} мм³.`);
      return;
    }
    const result=assembly.minimumClearance(a.mesh,b.mesh);
    if(!result)throw new Error('Нет поверхности для измерения.');
    viewer()?.setInspectionOverlay([],result.points.flat());
    status(`Минимальный зазор ${number.format(result.distance)} мм.`);
  }
  function rotatePair(a,b,axis,first,second,angle){
    if(!b)throw new Error('Выберите ведомую деталь.');
    const pose=(part,degrees)=>{
      const center=queries.center(part.bounds);
      const along=center.map((value,i)=>value+Number(i===axis));
      const motion=queries.rotation([center,along],degrees*Math.PI/180);
      const mesh=solid.transformMesh(part.mesh,motion.apply);
      return {...part,mesh,bounds:mesh.bounds};
    };
    const angle2=-angle*first/second;
    temporary=true;
    viewer()?.setMesh(solid.combine(app.getBodies().map(part=>part===a?pose(a,angle):part===b?pose(b,angle2):part)),{animate:false});
    status(`Ведущее колесо ${number.format(angle)}°. Ведомое колесо ${number.format(angle2)}°.`);
  }
  function playSequence(){
    restoreView();
    const bodies=Array.from(panel.querySelectorAll('.solid-assembly-order [data-body]'),node=>bodyById(node.dataset.body)).filter(Boolean);
    const bounds=app.getModelMesh()?.bounds;
    if(!bounds||bodies.length<2)return;
    const size=bodies.reduce((sum,part)=>sum+part.mesh.positions.length,0);
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches||size>90000;
    const stride=Math.max(8,bounds.max[2]-bounds.min[2]+5),duration=reduced?450:650,start=performance.now();
    temporary=true;
    let lastFrame=-Infinity,lastStep=-1;
    const draw=time=>{
      const elapsed=(time-start)/duration;
      const step=Math.floor(elapsed);
      if(time-lastFrame<33||(reduced&&step===lastStep)){
        frame=requestAnimationFrame(draw);
        return;
      }
      lastFrame=time;
      lastStep=step;
      const parts=bodies.map((part,index)=>{
        const factor=Math.max(0,Math.min(1,index+1-elapsed));
        const mesh=solid.translated(part.mesh,[0,0,stride*(index+1)*(reduced?Number(factor>0):factor)]);
        return {...part,mesh,bounds:mesh.bounds};
      });
      if(elapsed>bodies.length){
        restoreView();
        status('Сборка завершена.');
        return;
      }
      viewer()?.setMesh(solid.combine(parts),{animate:false});
      status(`Установка: ${bodies[Math.max(0,Math.min(bodies.length-1,Math.floor(elapsed)))].name}.`);
      frame=requestAnimationFrame(draw);
    };
    frame=requestAnimationFrame(draw);
  }
  function downloadFlat(body){
    const state=app.getState();
    const folds=state.modelFeatures.filter(feature=>feature.target===body.id&&feature.type==='fold'&&!feature.suppressed);
    if(!folds.length)throw new Error('Добавьте хотя бы один сгиб листовой заготовки.');
    const analysis=app.getAnalysis(),base=analysis.solids.find(profile=>profile.outer===analysis.loops[body.sourceLoop]);
    if(!base)throw new Error('Исходный контур заготовки недоступен.');
    const loops=[base.outer,...base.holes].map(loop=>loop.points.map(p=>[p.x/4,p.y/4]));
    const flat=loops.flat();
    const min=[0,1].map(i=>Math.min(...flat.map(p=>p[i]))),max=[0,1].map(i=>Math.max(...flat.map(p=>p[i])));
    const margin=4,width=max[0]-min[0]+2*margin,height=max[1]-min[1]+2*margin;
    const local=p=>[p[0]-min[0]+margin,p[1]-min[1]+margin];
    const paths=loops.map(loop=>`<polygon points="${loop.map(p=>local(p).join(',')).join(' ')}"/>`).join('');
    const bends=folds.map((fold,index)=>{
      const [a,b]=fold.line.map(p=>local([p[0],-p[1]]));
      const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),extend=width+height;
      const points=[a[0]-dx/length*extend,a[1]-dy/length*extend,b[0]+dx/length*extend,b[1]+dy/length*extend];
      const [x,y]=[0,1].map(i=>Math.min((i?height:width)-4,Math.max(4,(a[i]+b[i])/2)));
      return `<line x1="${points[0]}" y1="${points[1]}" x2="${points[2]}" y2="${points[3]}"/><text x="${x}" y="${y-1}" fill="#366787" stroke="none">${index+1} · ${fold.angle}°</text>`;
    }).join('');
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"><defs><clipPath id="blank"><path fill-rule="evenodd" d="${loops.map(loop=>'M'+loop.map(p=>local(p).join(',')).join(' L')+'Z').join(' ')}"/></clipPath></defs><g fill="none" stroke="#202c35" stroke-width="0.35">${paths}</g><g clip-path="url(#blank)" stroke="#366787" stroke-width="0.25" stroke-dasharray="2 1" font-family="sans-serif" font-size="2.6">${bends}</g></svg>`;
    const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
    createdUrl.add(url);
    const link=create('a');
    link.href=url;
    link.download='razvertka.svg';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(()=>{URL.revokeObjectURL(url);createdUrl.delete(url);},10000);
  }
  function chooseEdge(body,event){
    const edges=body.mesh.edges;
    let best=null,distance=13;
    for(let i=0;i<edges.length;i+=6){
      const points=[0,3].map(offset=>Array.from(edges.subarray(i+offset,i+offset+3)));
      const [a,b]=points.map(point=>viewer()?.project(point));
      if(!a||!b)continue;
      const dx=b.x-a.x,dy=b.y-a.y;
      const fraction=Math.max(0,Math.min(1,((event.clientX-a.x)*dx+(event.clientY-a.y)*dy)/(dx*dx+dy*dy||1)));
      const d=Math.hypot(event.clientX-a.x-fraction*dx,event.clientY-a.y-fraction*dy);
      if(d<distance){distance=d;best=points;}
    }
    return best;
  }
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0||panel.hidden||!['edge-bevel','edge-round','to-face'].includes(current))return;
    if(current==='to-face'){
      const hit=viewer()?.pick(event.clientX,event.clientY);
      if(!hit||hit.bodyId===selected||Math.abs(hit.normal[2])<.999)return;
      picked=hit;
      panel.querySelector('.solid-picked').textContent=`Грань выбрана · Z = ${number.format(hit.point[2])} мм`;
    }else{
      picked=chooseEdge(activeBody(),event);
      if(!picked)return;
      viewer()?.setInspectionOverlay([],picked.flat());
      panel.querySelector('.solid-picked').textContent='Ребро выбрано';
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  },true);
  document.addEventListener('labchange',event=>{
    const {kind,open}=event.detail;
    if((kind==='model'&&!open)||kind==='projectwillload')close();
    if(temporary&&['modelgeometry','modelerror'].includes(kind))restoreView();
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!panel.hidden&&!document.querySelector('dialog[open]')){
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    }
  },true);
  window.addEventListener('pagehide',()=>{for(const url of createdUrl)URL.revokeObjectURL(url);});
  window.LabSolidUpgrade=Object.freeze({open,close,active:()=>!panel.hidden});
})();
