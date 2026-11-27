(function () {
  'use strict';
  const app=window.LabApp, formats=window.LabProjectFormats;
  if (!app||!formats) return;
  const previews=window.LabProjectPreview, gallery=window.LabGalleryStore;
  const $=id=>document.getElementById(id);
  const create=(tag,text,className)=>{
    const node=document.createElement(tag);
    if(text)node.textContent=text;
    if(className)node.className=className;
    return node;
  };
  const button=(text,handler)=>{
    const node=create('button',text);
    node.type='button';
    node.addEventListener('click',handler);
    return node;
  };
  const dateFormat=new Intl.DateTimeFormat('ru',{dateStyle:'short',timeStyle:'short'});
  const date=value=>dateFormat.format(value);
  const preferencesKey='drawing-lab-preferences-v1', activeKey='drawing-lab-gallery-active-v1';
  const autosaveKey='drawing-lab-v1';
  const getStored=(storage,key,fallback)=>{
    try { return JSON.parse(storage().getItem(key))??fallback; } catch { return fallback; }
  };
  const persist=(storage,key,value)=>{
    try { storage().setItem(key,JSON.stringify(value)); return true; } catch { return false; }
  };
  const local=()=>window.localStorage, session=()=>window.sessionStorage;
  const uid=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  let preferences=getStored(local,preferencesKey,{});
  let activeId=getStored(session,activeKey,null);
  let pending=null, rendering=0, cameraTimer, viewTimer, conflicting=false, switchingId=null, continuing=false;
  let selectedPage='gallery', commands=[], pinRefresh, sketchReferenceOpen=false;
  let objectCandidates=null, selectedObject=null;

  function setActive(id){
    activeId=id;
    persist(session,activeKey,id);
  }

  const dialog=create('dialog',null,'project-workspace');
  dialog.id='project-workspace';
  dialog.setAttribute('aria-labelledby','project-workspace-title');
  const header=create('header',null,'project-workspace-header');
  const title=create('h2','Проекты');title.id='project-workspace-title';
  const close=button('×',()=>dialog.close());close.setAttribute('aria-label','Закрыть');
  header.append(title,close);
  const navigation=create('nav',null,'project-workspace-tabs');
  navigation.setAttribute('aria-label','Разделы рабочей области');
  const body=create('section',null,'project-workspace-body');
  const feedback=create('p',null,'project-workspace-feedback');
  feedback.setAttribute('role','status');
  dialog.append(header,navigation,body,feedback);
  document.body.append(dialog);

  const menu=$('studio-menu');
  function start(page){
    menu.hidden=true;
    $('studio-menu-toggle').setAttribute('aria-expanded','false');
    selectedPage=page;
    if(!dialog.open)dialog.showModal();
    return render();
  }
  const pages={gallery:'Проекты',files:'Файлы',commands:'Команды',settings:'Интерфейс',objects:'Объекты'};
  for (const [id,label] of Object.entries(pages)){
    const tab=button(label,()=>{selectedPage=id;render();});
    tab.dataset.page=id;
    navigation.append(tab);
  }
  for (const [id,label,target] of [['project-gallery-launch','Проекты','gallery'],['project-commands-launch','Поиск команд','commands']]){
    const control=button(label,()=>start(target));control.id=id;menu.append(control);
  }
  const welcomeLink=button('Открыть проекты и файлы',()=>start('gallery'));
  welcomeLink.className='continue-button';
  $('welcome-dialog').querySelector('.welcome-author').before(welcomeLink);
  function note(message){feedback.textContent=message;}
  function instruction(message){body.append(create('p',message,'project-workspace-note'));}
  function download(data, name, type='application/json'){
    const url=URL.createObjectURL(new Blob([data],{type})), link=create('a');
    link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  const nameOf=value=>String(value||'').trim().replace(/[\u0000-\u001f]/g,'').slice(0,64);
  function activeMode(){
    if(window.LabDrawingSheet?.active())return 'draft';
    return app.isModelOpen()?'model':'sheet';
  }
  function captureView(){
    const v=app.getViewport();
    const remembered=activeId?storedView(activeId):null;
    let middle={x:(v.stageRect.x+v.stageRect.width/2-v.paperRect.x)/v.paperRect.width*v.width,y:(v.stageRect.y+v.stageRect.height/2-v.paperRect.y)/v.paperRect.height*v.height};
    const camera=app.getModelViewer()?.getCamera();
    if(!Number.isFinite(middle.x)||!Number.isFinite(middle.y))middle=remembered?.middle||{x:v.width/2,y:v.height/2};
    return {mode:activeMode(),zoom:v.zoom,middle,camera};
  }
  function storedView(id){return getStored(local,preferencesKey+'-view-'+id,null);}
  function scheduleView(){
    if(!activeId||switchingId)return;
    clearTimeout(viewTimer);
    const id=activeId;
    viewTimer=setTimeout(()=>{
      if(activeId===id)persist(local,preferencesKey+'-view-'+id,captureView());
    },400);
  }
  function restoreView(value){
    if(!value)return;
    if(Number.isFinite(value.zoom))app.setZoom(value.zoom);
    if(value.middle&&Number.isFinite(value.middle.x)&&Number.isFinite(value.middle.y))app.panTo(value.middle);
    if(value.mode==='draft')window.LabDrawingSheet?.open();
    else if(value.mode==='model'){
      window.LabCAD?.modelMode(true,false);
      if(value.camera)app.getModelViewer()?.setCamera(value.camera,false);
    } else {
      window.LabDrawingSheet?.close();
      window.LabCAD?.modelMode(false,false);
    }
  }
  function currentProject(){
    if(app.isModelEditing()) throw new Error('Примените или отмените незавершённую операцию.');
    return app.prepareProject(app.getState());
  }
  function addCheckpoint(label){
    const input=create('input');
    input.value=label;input.maxLength=64;input.setAttribute('aria-label','Название проекта или контрольной точки');
    return input;
  }
  async function saveGallery(label, overwrite){
    try{
      const project=currentProject(), now=Date.now();
      const id=overwrite&&activeId?activeId:uid();
      if(overwrite&&activeId){
        await gallery.update(id,record=>{
          record.name=nameOf(label)||record.name;
          record.updated=now;
          record.project=project;
        });
      }else{
        await gallery.insert([{id,name:nameOf(label)||'Чертёж '+date(now),created:now,updated:now,project,checkpoints:[]}]);
      }
      if(conflicting&&!overwrite)conflicting=false;
      setActive(id);
      persist(local,preferencesKey+'-view-'+id,captureView());
      await render();note('Сохранено в локальной галерее.');
    }catch(error){note(error.message||'Сохранение недоступно.');}
  }
  function loadProject(project,id=null,view=null){
    if(app.isModelEditing()) {note('Примените или отмените незавершённую операцию.');return false;}
    switchingId=id||'new-project';
    try{
      const opened=app.loadProject(project);
      if(opened===false)return false;
      setActive(id);
      if(dialog.open)dialog.close();
      if($('welcome-dialog').open)$('welcome-dialog').close();
      requestAnimationFrame(()=>restoreView(view));
      return true;
    }finally{switchingId=null;}
  }
  function replaceWith(project,id=null,view=null){
    const existing=app.getState();
    if(!$('welcome-dialog').open&&(existing.strokes.length||existing.tracing||existing.modelFeatures.length)){
      confirmStep('Открыть другой проект?', 'Текущий лист можно сохранить в галерею или вернуть через «Отменить».',()=>loadProject(project,id,view));
    } else loadProject(project,id,view);
  }
  function confirmStep(question,detail,action){
    let panel=body.querySelector('.project-confirm');
    if(!panel){panel=create('div',null,'project-confirm');body.prepend(panel);}
    panel.replaceChildren(create('strong',question),create('p',detail),button('Подтвердить',async()=>{
      try{await action();}catch(error){note(error.message);}
    }),button('Вернуться',()=>panel.remove()));
    panel.scrollIntoView({block:'nearest'});
    panel.querySelector('button').focus();
  }
  async function openSavedProject(id,checkpointIndex){
    try{
      const record=await gallery.get(id);
      const project=checkpointIndex===undefined?record?.project:record?.checkpoints[checkpointIndex]?.project;
      if(!project)throw new Error('Сохранённый проект больше не доступен.');
      replaceWith(project,id,storedView(id));
    }catch(error){note(error.message);}
  }
  async function showGallery(token){
    const records=await gallery.cards(previews.thumbnail);
    if(token!==rendering)return;
    const active=records.find(record=>record.id===activeId), editing=addCheckpoint(active?.name||'');
    editing.placeholder='Название проекта';
    const tools=create('div',null,'project-workspace-actions');
    tools.append(editing,button('Сохранить как новый',()=>saveGallery(editing.value,false)));
    if(active)tools.append(button('Обновить проект',()=>saveGallery(editing.value,true)));
    body.append(tools);
    if(conflicting) {
      const conflict=create('div',null,'project-confirm');
      conflict.append(create('strong','Автосохранение обновилось в другой вкладке'),create('p','Откройте общую версию или сохраните текущий лист отдельным проектом.'),
        button('Открыть общую версию',()=>{
          confirmStep('Загрузить общее автосохранение?', 'Версию этой вкладки можно сохранить в галерею или вернуть через «Отменить».',()=>{
            if(app.isModelEditing()){note('Сначала примените или отмените текущую операцию.');return;}
            if(app.loadSharedAutosave()){
              conflicting=false;
              setActive(null);
              dialog.close();
            }
          });
        }));
      body.prepend(conflict);
    }
    if(!records.length){instruction('Сохраните открытый чертёж или импортируйте проект через «Файлы».');return;}
    const grid=create('div',null,'project-grid');
    for(const record of records.sort((a,b)=>b.updated-a.updated)){
      const item=create('article',null,'project-card');
      const open=button('Открыть',()=>openSavedProject(record.id));
      open.prepend(previews.sketchSVG(record.thumbnail));open.setAttribute('aria-label','Открыть проект '+record.name);
      item.append(open,create('strong',record.name),create('small',date(record.updated)));
      const revisions=create('details');
      revisions.append(create('summary','Контрольные точки · '+record.checkpoints.length));
      if(record.id===activeId){
        const checkpoint=addCheckpoint('');
        checkpoint.placeholder='Например, эскиз готов';
        revisions.append(checkpoint,button('Запомнить состояние',async()=>{
          try{
            const project=currentProject(), name=nameOf(checkpoint.value);
            await gallery.update(record.id,fresh=>{
              if(fresh.checkpoints.length>=12)throw new Error('Достигнут предел в 12 контрольных точек.');
              fresh.checkpoints.push({name:name||'Точка '+(fresh.checkpoints.length+1),created:Date.now(),project});
            });
            await render();note('Контрольная точка сохранена.');
          }catch(error){note(error.message);}
        }));
      }
      for(let index=record.checkpoints.length-1;index>=0;index--){
        const checkpoint=record.checkpoints[index];
        revisions.append(button(checkpoint.name+' · '+date(checkpoint.created),()=>openSavedProject(record.id,index)));
      }
      item.append(revisions);
      item.append(button('Удалить из галереи',()=>confirmStep('Удалить «'+record.name+'»?', 'Проект и его контрольные точки исчезнут из галереи.',async()=>{
        await gallery.remove(record.id);
        if(activeId===record.id)setActive(null);
        await render();
      })));
      grid.append(item);
    }
    body.append(grid);
  }
  function showPending(){
    if(!pending)return;
    const result=create('article',null,'project-file-preview');
    result.append(create('h3',pending.name),create('p',pending.note));
    if(pending.mesh){
      previews.renderSTL(result,pending.mesh,{app,create,button,note,confirmStep,dialog});
    }else{
      const project=pending.project;
      result.append(previews.sketchSVG(previews.thumbnail(formats.fitProject(project,true))));
      result.append(create('p',(project.orientation==='portrait'?'Вертикальный':'Горизонтальный')+' лист · '
        +project.strokes.length+' построений · '+project.layers.length+' слоёв · версия '+project.version));
      const row=create('div',null,'project-workspace-actions');
      row.append(button('Открыть в исходном масштабе',()=>replaceWith(pending.project)));
      if(pending.vector)row.append(button('Вписать в лист',()=>replaceWith(app.prepareProject(formats.fitProject(project,true)))));
      result.append(row);
    }
    body.append(result);
  }
  async function importGallery(data){
    if(data.format!=='drawing-lab-gallery'||data.version!==1||!Array.isArray(data.projects)||data.projects.length>250)
      throw new Error('Формат архива галереи не поддерживается.');
    const records=data.projects.map(record=>{
      if(!Array.isArray(record?.checkpoints)||record.checkpoints.length>12)throw new Error('Повреждены контрольные точки.');
      const validTime=n=>Number.isFinite(n)&&n>0&&n<=Date.now()+86400000?n:Date.now();
      return {id:uid(),name:nameOf(record.name)||'Импортированный проект',created:validTime(record.created),updated:validTime(record.updated),
        project:app.prepareProject(record.project),checkpoints:record.checkpoints.map(point=>({
          name:nameOf(point.name)||'Контрольная точка',created:validTime(point.created),project:app.prepareProject(point.project)
        }))};
    });
    await gallery.insert(records);
    selectedPage='gallery';await render();note('Добавлено проектов: '+records.length+'.');
  }
  async function inspectFile(file){
    const ext=file.name.split('.').pop().toLowerCase();
    const sizeLimit=ext==='json'?40*1024*1024:12*1024*1024;
    if(file.size>sizeLimit)throw new Error('Файл слишком большой. Предел для этого формата — '+sizeLimit/1024/1024+' МБ.');
    pending=null;
    if(ext==='stl') {
      const mesh=formats.stl(await file.arrayBuffer());
      pending={name:file.name,mesh,note:mesh.triangles.length+' треугольников · координаты считаются миллиметрами'};
    }else if(ext==='svg'||ext==='dxf'){
      const imported=formats[ext](await file.text());
      pending={name:file.name,project:app.prepareProject(formats.fitProject(imported.project)),note:imported.note,vector:true};
    }else if(ext==='json'){
      const data=JSON.parse(await file.text());
      if(data?.format==='drawing-lab-gallery'){
        await importGallery(data);return;
      }
      pending={name:file.name,project:app.prepareProject(data),note:'Проверен формат проекта лаборатории.'};
    }else throw new Error('Выберите JSON, SVG, DXF или STL.');
    await render();
  }
  function showFiles(){
    instruction('Откройте JSON, SVG, текстовый DXF или STL. Размеры и состав можно проверить перед открытием.');
    const file=create('input');file.type='file';file.accept='.json,.svg,.dxf,.stl';file.setAttribute('aria-label','Выбрать файл для просмотра');
    file.addEventListener('change',async()=>{
      if(!file.files[0])return;
      try{await inspectFile(file.files[0]);}
      catch(error){await render();note(error.message||'Не удалось открыть файл.');}
    });
    body.append(file);
    const row=create('div',null,'project-workspace-actions');
    row.append(button('Скачать эскиз DXF',()=>{
      try{download(formats.toDXF(currentProject()),'Эскиз.dxf','application/dxf');}catch(error){note(error.message);}
    }),button('Скачать галерею',async()=>{
      try{
        const projects=await gallery.all();
        if(!projects.length){note('В галерее пока нет проектов.');return;}
        download(JSON.stringify({format:'drawing-lab-gallery',version:1,projects}),'Галерея-лаборатории.json');
      }catch(error){note(error.message);}
    }));
    body.append(row);
    showPending();
  }
  const aliases={contour:'контур профиль фигура',pencil:'карандаш линия штрих',line:'отрезок прямая',ruler:'линейка угол',
    compass:'циркуль окружность круг дуга',eraser:'ластик удалить стереть',caliper:'измерить штангенциркуль расстояние замер',
    'contour-check':'проверка эскиза разрыв контур исправить', 'driving-dimension':'размер параметр длина диаметр',
    'advanced-modeling':'отверстие дырка просверлить вырез зенковка сборка', 'project-gallery-launch':'галерея сохранить открыть',
    'experiment-launch':'эксперимент пластина график формула'};
  const listCommands=()=>{
    const source=Array.from(document.querySelectorAll('#tool-palette button[data-tool],#tool-palette button[data-workshop-shortcut],#studio-menu > button[id],#workspace-views button'));
    const available=source.filter(node=>node.id!=='project-commands-launch'&&!node.disabled&&node.id!=='fullscreen-toggle').map(node=>{
      const id=node.dataset.tool||node.dataset.workshopShortcut||node.id;
      const label=node.querySelector('span')?.textContent||node.textContent.trim();
      return {id,label,search:(label+' '+(aliases[id]||'')).toLowerCase(),node};
    });
    if(window.LabSolidUpgrade)available.push({id:'advanced-modeling',label:'Расширенное моделирование',search:'расширенное моделирование '+aliases['advanced-modeling'],run:()=>window.LabWorkshop.run('advanced-modeling')});
    return available;
  };
  function execute(command) {
    if(command.run)command.run();
    else command.node.click();
  }
  function runCommand(command) {
    if(command.id==='project-gallery-launch'){start('gallery');return;}
    dialog.close();
    execute(command);
  }
  function drawPins(){
    commands=listCommands();
    const available=Array.isArray(preferences.pins)?preferences.pins:[];
    const row=$('project-pinned')||create('div',null,'project-pinned');
    row.id='project-pinned';row.setAttribute('aria-label','Избранные команды');
    row.replaceChildren();
    for(const id of available){
      const found=commands.find(command=>command.id===id);
      if(found)row.append(button(found.label,()=>execute(found)));
    }
    row.hidden=!row.childElementCount;
    if(!row.isConnected)$('tool-palette').append(row);
  }
  function showCommands(){
    commands=listCommands();
    const field=create('input');field.type='search';field.placeholder='Найти команду';
    field.setAttribute('aria-label','Поиск команд');
    const results=create('div',null,'project-command-list');
    function fill(){
      const q=field.value.toLowerCase().trim().split(/\s+/), pins=preferences.pins||[];
      results.replaceChildren();
      for(const command of commands.filter(command=>q.every(part=>command.search.includes(part)))){
        const row=create('div',null,'project-command');
        const pin=button(pins.includes(command.id)?'Убрать':'Закрепить',()=>{
          preferences.pins=pins.includes(command.id)?pins.filter(id=>id!==command.id):[...pins,command.id].slice(-6);
          persist(local,preferencesKey,preferences);
          fill();drawPins();
        });
        pin.setAttribute('aria-label',pin.textContent+' команду «'+command.label+'»');
        row.append(button(command.label,()=>runCommand(command)),pin);
        results.append(row);
      }
      if(!results.children.length)results.append(create('p','Команда не найдена.'));
    }
    field.addEventListener('input',fill);
    field.addEventListener('keydown',event=>{
      if(event.key==='Enter'){event.preventDefault();results.querySelector('button')?.click();}
    });
    body.append(field,results);fill();field.focus();
  }
  function setting(label,key,change){
    const input=create('input');input.type='checkbox';input.checked=preferences[key]===true;
    const wrap=create('label',null,'project-setting');wrap.append(input,document.createTextNode(label));
    input.addEventListener('change',()=>{
      preferences[key]=input.checked;persist(local,preferencesKey,preferences);change();
    });body.append(wrap);
  }
  function applyPreferences(){
    document.body.classList.toggle('project-high-contrast',preferences.contrast===true);
    document.body.classList.toggle('project-beginner',preferences.beginner===true);
    document.body.classList.toggle('project-pen-mode',preferences.pen===true);
    drawPins();
  }
  function diagnostics(){
    const result=[];
    try{
      const canvas=create('canvas'), gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
      result.push('3D‑графика · '+(gl?'доступна':'недоступна'));
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    }catch{result.push('3D‑графика · недоступна');}
    result.push('Автосохранение · '+(persist(local,preferencesKey,preferences)?'доступно':'недоступно'));
    result.push('Скачивание · '+(typeof URL.createObjectURL==='function'&&'download' in create('a')?'поддерживается браузером':'недоступно'));
    return gallery.open().then(()=>[...result,'Локальная галерея · доступна'],()=>[...result,'Локальная галерея · недоступна']);
  }
  function showSettings(){
    setting('Режим новичка', 'beginner',applyPreferences);
    setting('Высокий контраст', 'contrast',applyPreferences);
    setting('Перо рисует, пальцы перемещают лист', 'pen',applyPreferences);
    const split=button(sketchReferenceOpen?'Скрыть эскиз рядом с моделью':'Показать эскиз рядом с моделью',()=>{
      sketchReferenceOpen=!sketchReferenceOpen;dialog.close();scheduleSide();
      if(sketchReferenceOpen&&!app.isModelOpen())window.LabCAD?.modelMode(true,false);
    });
    const row=create('div',null,'project-workspace-actions');
    row.append(split,button('Проверить компьютер',async()=>{
      const previous=body.querySelector('.project-diagnostics');previous?.remove();
      const report=create('ul',null,'project-diagnostics');
      for(const line of await diagnostics())report.append(create('li',line));
      if(selectedPage==='settings')body.append(report);
    }));
    body.append(row);
  }
  function pointsOf(shape){
    if(shape.type==='line')return [shape.a,shape.b];
    if(shape.type==='path')return shape.points;
    return [{x:shape.cx,y:shape.cy}];
  }
  function moveVertex(id,index,x,y){
    if(!Number.isFinite(x)||!Number.isFinite(y))return false;
    const shape=app.getSketchShape(id);
    if(!shape)return false;
    const p={x:x*4,y:y*4};
    if(shape.type==='line')shape[index===0?'a':'b']=p;
    else if(shape.type==='path'){
      const first=shape.points[0],last=shape.points.at(-1),closed=first.x===last.x&&first.y===last.y;
      shape.points[index]=p;
      if(closed&&index===0)shape.points[shape.points.length-1]=p;
      if(closed&&index===shape.points.length-1)shape.points[0]=p;
      if(shape.curve)delete shape.curve;
    }else {shape.cx=p.x;shape.cy=p.y;}
    return app.replaceSketchShape(id,shape,{driverId:id,sketchOnly:true});
  }
  function nearObjects(clientX,clientY){
    const v=app.getViewport(), rect=v.paperRect;
    const x=(clientX-rect.x)/rect.width*v.width,y=(clientY-rect.y)/rect.height*v.height;
    return app.getSketchHits({x,y},12*v.width/rect.width).map(hit=>hit.id);
  }
  function showObjects(){
    const shapes=app.getVisibleStrokes(), labels={line:'Отрезок',path:'Контур',circle:'Окружность',arc:'Дуга'};
    const byId=objectCandidates&&new Map(shapes.map(shape=>[shape.id,shape]));
    const list=byId?objectCandidates.map(id=>byId.get(id)).filter(Boolean):shapes;
    const row=create('div',null,'project-workspace-actions');
    if(objectCandidates)row.append(button('Все объекты листа',()=>{objectCandidates=null;render();}));
    body.append(row);
    if(!list.length){instruction('В выбранном месте листа построений нет.');return;}
    const select=create('select');select.setAttribute('aria-label','Построение');
    select.className='project-select';
    for(const [i,shape] of list.entries()){
      const option=create('option',(labels[shape.type]||'Построение')+' '+(i+1)+(shape.construction?' · вспомогательное':''));
      option.value=shape.id;select.append(option);
    }
    select.value=list.some(shape=>shape.id===selectedObject)?selectedObject:list[0].id;
    body.append(select);
    const detail=create('div',null,'project-object-detail');
    const live=create('p');live.setAttribute('role','status');body.append(detail,live);
    function describe(){
      selectedObject=select.value;
      const shape=app.getSketchShape(selectedObject);
      const vertices=pointsOf(shape);
      detail.replaceChildren();
      const vertex=create('select');vertex.className='project-select';vertex.setAttribute('aria-label','Вершина или центр');
      vertices.forEach((_,i)=>{
        const option=create('option',shape.type==='circle'||shape.type==='arc'?'Центр':'Точка '+(i+1));
        option.value=i;vertex.append(option);
      });
      const fields=create('div',null,'project-object-fields'), coordinateInputs=[];
      for(const key of ['X','Y']){
        const label=create('label',key+', мм'), field=create('input');
        field.type='number';field.step='any';field.setAttribute('aria-label',key+' в миллиметрах');
        coordinateInputs.push(field);label.append(field);fields.append(label);
      }
      function update(){
        const p=pointsOf(app.getSketchShape(selectedObject))[Number(vertex.value)];
        coordinateInputs[0].value=Number((p.x/4).toFixed(4));
        coordinateInputs[1].value=Number((p.y/4).toFixed(4));
        live.textContent='Точка '+(Number(vertex.value)+1)+'. X '+coordinateInputs[0].value+' мм, Y '+coordinateInputs[1].value+' мм.';
      }
      function apply(x,y){
        try{
          if(!moveVertex(selectedObject,Number(vertex.value),x,y)){note('Изменение отклонено. Проверьте блокировку слоя и связи.');return;}
          update();
        }catch(error){note(error.message);}
      }
      vertex.addEventListener('change',update);
      const step=create('input');step.type='number';step.min='0.01';step.max='100';step.step='any';step.value='0.5';step.setAttribute('aria-label','Шаг сдвига в миллиметрах');
      const nudge=create('button','Сдвиг стрелками');nudge.type='button';nudge.title='Удерживайте Shift для шага ×10';
      nudge.addEventListener('keydown',event=>{
        const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
        if(!direction)return;
        event.preventDefault();event.stopPropagation();
        if(!step.reportValidity())return;
        const delta=Number(step.value)*(event.shiftKey?10:1);
        apply(Number(coordinateInputs[0].value)+direction[0]*delta,Number(coordinateInputs[1].value)+direction[1]*delta);
      });
      const measure=create('ul');
      for(const entry of (typeof app.getMeasurements==='function'?app.getMeasurements():[]).filter(m=>m.shapeId===shape.id||m.a?.shapeId===shape.id||m.b?.shapeId===shape.id)){
        if(Number.isFinite(entry.value))measure.append(create('li','Измерение · '+entry.value+' мм'));
      }
      if(shape.type==='circle'||shape.type==='arc')measure.append(create('li','Радиус · '+Number((shape.r/4).toFixed(3))+' мм'));
      if(shape.type==='line')measure.append(create('li','Длина · '+Number((Math.hypot(shape.a.x-shape.b.x,shape.a.y-shape.b.y)/4).toFixed(3))+' мм'));
      detail.append(vertex,fields,button('Применить координаты',()=>apply(...coordinateInputs.map(field=>field.valueAsNumber))),step,nudge,measure);
      update();
    }
    select.addEventListener('change',describe);describe();
  }

  async function render(){
    const token=++rendering;
    title.textContent=pages[selectedPage];
    for(const tab of navigation.children)tab.setAttribute('aria-current',tab.dataset.page===selectedPage?'page':'false');
    body.replaceChildren();note('');
    try {
      if(selectedPage==='gallery')await showGallery(token);
      if(selectedPage==='files')showFiles();
      if(selectedPage==='commands')showCommands();
      if(selectedPage==='settings')showSettings();
      if(selectedPage==='objects')showObjects();
    }catch(error){
      if(token!==rendering)return;
      instruction('Локальная галерея недоступна. Файлы проекта можно открыть и выгрузить через вкладку «Файлы».');
    }
  }

  let sideFrame=0, sideDirty=true, sideSourceIds=[], sideSelection=null;
  const side=create('aside',null,'project-split');
  side.hidden=true;
  side.setAttribute('aria-label','Эскиз рядом с моделью');
  const sideHeader=create('div',null,'project-split-header'), sideContent=create('div');
  sideHeader.append(create('strong','Исходный эскиз'),button('×',()=>{sketchReferenceOpen=false;scheduleSide();}));
  side.append(sideHeader,sideContent);
  document.body.append(side);
  function scheduleSide(){
    if(sideFrame)return;
    sideFrame=requestAnimationFrame(()=>{
      sideFrame=0;
      const cad=window.LabCAD?.getState();
      side.hidden=!sketchReferenceOpen||!app.isModelOpen()||activeMode()==='draft'||cad?.presenting;
      if(side.hidden){
        if(sideContent.childElementCount){
          sideContent.replaceChildren();
          sideSourceIds=[];
          sideSelection=null;
          sideDirty=true;
        }
        return;
      }
      if(sideDirty){
        const strokes=app.getModelStrokes(), view=app.getViewport();
        sideSourceIds=strokes.map(shape=>shape.id);
        const thumb=previews.thumbnail({orientation:view.width<view.height?'portrait':'landscape',strokes});
        sideContent.replaceChildren(previews.sketchSVG(thumb,'project-reference'));
      }
      const selected=cad?.selected||[];
      const signature=selected.join('|');
      if(sideDirty||signature!==sideSelection){
        const ids=new Set(app.getBodies().filter(part=>selected.includes(part.id))
          .flatMap(part=>(part.sourceIndices||[]).map(i=>sideSourceIds[i])));
        for(const path of sideContent.querySelectorAll('path'))path.classList.toggle('project-shape-focus',ids.has(path.dataset.shape));
        sideSelection=signature;
      }
      sideDirty=false;
    });
  }
  sideContent.addEventListener('click',event=>{
    const id=event.target.dataset?.shape;
    if(!id)return;
    const target=app.getBodies().find(part=>(part.sourceIndices||[]).some(i=>sideSourceIds[i]===id));
    if(target){window.LabCAD?.select(target.id);scheduleSide();}
  });
  window.addEventListener('storage',event=>{
    if(event.key===autosaveKey||event.key===null){
      conflicting=true;
      if(dialog.open&&selectedPage==='gallery')render();
    }
  });
  document.addEventListener('labchange',event=>{
    const kind=event.detail?.kind;
    if(kind==='projectload'&&continuing){
      const view=activeId&&storedView(activeId);
      if(view)requestAnimationFrame(()=>restoreView(view));
    } else if((kind==='projectload'||kind==='projectnew')&&!switchingId)setActive(null);
    if(['viewport','model','projectload','project','drawing','draftview'].includes(kind))scheduleView();
    if(kind==='drawing'||kind==='project')sideDirty=true;
    if(kind==='modelgeometry')sideSelection=null;
    if(sketchReferenceOpen)scheduleSide();
  });
  $('continue').addEventListener('click',()=>{continuing=true;queueMicrotask(()=>{continuing=false;});},{capture:true});
  $('model-canvas').addEventListener('labmodelrender',()=>{
    if(!sketchReferenceOpen&&!activeId)return;
    if(sketchReferenceOpen)scheduleSide();
    if(activeId&&!cameraTimer)cameraTimer=setTimeout(()=>{cameraTimer=0;scheduleView();},800);
  });
  $('stage').addEventListener('scroll',scheduleView,{passive:true});
  $('paper-wrap').addEventListener('contextmenu',event=>{
    if(event.shiftKey||app.isModelEditing()||document.querySelector('dialog[open]'))return;
    objectCandidates=nearObjects(event.clientX,event.clientY);
    if(objectCandidates.length)start('objects');
  });
  $('export-3mf')?.addEventListener('click',()=>app.exportModel('3mf'));
  for(const id of ['view-draft','view-sheet','open-model'])$(id).addEventListener('click',scheduleView);
  document.addEventListener('keydown',event=>{
    if((event.ctrlKey||event.metaKey)&&event.code==='KeyK'&&!event.shiftKey&&!event.altKey&&
      ![...document.querySelectorAll('dialog[open]')].some(modal=>modal!==dialog)){
      event.preventDefault();start('commands');
    }
  });
  dialog.addEventListener('close',()=>{if(!document.querySelector('dialog[open]'))$('studio-menu-toggle').focus({preventScroll:true});});
  applyPreferences();
  new MutationObserver(()=>{
    clearTimeout(pinRefresh);pinRefresh=setTimeout(drawPins,0);
  }).observe(menu,{childList:true});
  if(navigator.serviceWorker&&location.protocol!=='file:') {
    window.addEventListener('load',()=>navigator.serviceWorker.register('./offline.js').catch(()=>{}),{once:true});
  }
})();
