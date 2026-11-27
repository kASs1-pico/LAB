(function (global) {
  'use strict';

  const key='drawing-lab-workbench-preferences-v1';
  let settings={};
  try {
    const stored=JSON.parse(localStorage.getItem(key));
    if(stored&&typeof stored==='object'&&!Array.isArray(stored))settings=stored;
  } catch { /* Use session values. */ }
  document.body.classList.toggle('lab-left-hand',settings.leftHand===true);
  const app=global.LabApp;
  const data=global.LabWorkbenchData;
  const preview=global.LabProjectPreview;
  const gallery=global.LabGalleryStore;
  const mm=new Intl.NumberFormat('ru',{maximumFractionDigits:3});
  const show=value=>Number.isFinite(value)?mm.format(value):'—';

  function persist(ui) {
    try { localStorage.setItem(key,JSON.stringify(settings)); }
    catch { ui.status('Настройки действуют до закрытия страницы.'); }
  }

  const commands=[
    ['line','Отрезок'],['compass','Циркуль'],['contour','Контур'],['cad-select','Выбрать контур'],
    ['open-model','3D-модель'],['view-draft','Чертёж'],['cad-measure','Штангенциркуль'],
    ['teaching-launch','Практикумы'],['experiment-launch','Эксперимент']
  ];
  const commandNode=id=>document.getElementById(id)||document.querySelector('#tool-palette [data-tool="'+id+'"]');
  const commandIds=ids=>Array.isArray(ids)?[...new Set(ids)].filter(id=>commands.some(([value])=>value===id)).slice(0,5):[];

  const quick=document.createElement('div');
  quick.className='lab-workbench-commands';
  quick.setAttribute('aria-label','Команды урока');
  document.getElementById('tool-palette')?.append(quick);
  function paintCommands() {
    quick.replaceChildren(...commandIds(settings.commands).map(id=>{
      const button=document.createElement('button');
      button.type='button';
      button.textContent=commands.find(item=>item[0]===id)[1];
      button.addEventListener('click',()=>commandNode(id)?.click());
      return button;
    }));
    quick.hidden=!quick.children.length;
  }
  paintCommands();

  function card(parent,ui,title) {
    const section=ui.el('section',null,'lab-workbench-card');
    section.append(ui.el('h3',title));
    parent.append(section);
    return section;
  }
  function field(ui,parent,title,type) {
    const label=ui.el('label',title), input=ui.el('input');
    input.type=type;
    label.append(input);
    parent.append(label);
    return input;
  }
  function fileField(ui,parent,title,accept) {
    const input=field(ui,parent,title,'file');
    input.accept=accept;
    return input;
  }
  async function readJson(file,megabytes=40) {
    if (!file||file.size>megabytes*1024*1024) throw new Error('Выберите файл JSON размером до '+megabytes+' МБ.');
    return JSON.parse(await file.text());
  }

  function controls(parent,ui) {
    const section=card(parent,ui,'Панель урока');
    const selected=new Set(commandIds(settings.commands));
    const labels=ui.el('div',null,'lab-workbench-actions');
    section.append(ui.el('p','Выберите до пяти команд. Они появятся в меню «Инструменты».'),labels);
    for(const [id,name] of commands) {
      const check=field(ui,labels,name,'checkbox');
      check.checked=selected.has(id);
      check.addEventListener('change',()=>{
        if(check.checked&&selected.size>=5){check.checked=false;ui.status('Снимите одну из пяти отметок.');return;}
        if(check.checked)selected.add(id);
        else selected.delete(id);
        settings.commands=[...selected];
        persist(ui);
        paintCommands();
      });
    }
    const left=field(ui,section,'Панели справа и лупа справа от касания','checkbox');
    left.checked=settings.leftHand===true;
    left.addEventListener('change',()=>{
      settings.leftHand=left.checked;
      document.body.classList.toggle('lab-left-hand',left.checked);
      persist(ui);
    });
  }

  function ruler(parent,ui) {
    const section=card(parent,ui,'Масштаб 1:1');
    section.append(ui.el('p','Приложите линейку к экрану. Настройте ширину шкалы так, чтобы между 0 и 100 было ровно 100 мм.'));
    const range=field(ui,section,'Ширина шкалы в CSS-пикселях','range');
    range.min=180;range.max=640;range.step=1;
    range.value=Number.isFinite(settings.ruler)?settings.ruler:378;
    const frame=ui.el('div',null,'lab-workbench-ruler');
    const namespace='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(namespace,'svg');
    svg.setAttribute('height','44');
    svg.setAttribute('role','img');
    svg.setAttribute('aria-label','Калибровочная шкала 100 мм');
    const draw=()=>{
      const width=Number(range.value);
      svg.setAttribute('width',String(width+32));
      svg.replaceChildren();
      for(let i=0;i<=100;i++){
        const x=16+width*i/100;
        const line=document.createElementNS(namespace,'line');
        line.setAttribute('x1',String(x));line.setAttribute('x2',String(x));
        line.setAttribute('y1','8');line.setAttribute('y2',String(i%10===0?23:i%5===0?18:13));
        line.setAttribute('stroke','currentColor');svg.append(line);
        if(i%10===0){
          const caption=document.createElementNS(namespace,'text');
          caption.setAttribute('x',String(x));caption.setAttribute('y','38');
          caption.setAttribute('fill','currentColor');caption.setAttribute('font-size','11');
          caption.setAttribute('text-anchor','middle');caption.textContent=String(i);svg.append(caption);
        }
      }
    };
    frame.append(svg);section.append(frame);
    range.addEventListener('input',draw);draw();
    section.append(ui.button('Откалибровать и показать лист 1:1',()=>{
      settings.ruler=Number(range.value);
      persist(ui);
      global.LabDrawingSheet?.close({restoreFocus:false});
      if(app.isModelOpen())global.LabCAD?.modelMode(false,false);
      const view=app.getViewport();
      const pixelsPerMm=view.paperRect.width/(view.width/4);
      const zoom=view.zoom*settings.ruler/100/pixelsPerMm;
      if (!Number.isFinite(zoom)||zoom<.999||zoom>5.001) {
        ui.status('Калибровка сохранена. Размер окна не позволяет показать лист 1:1 в диапазоне доступного масштаба.');
        return;
      }
      ui.close();
      app.setZoom(zoom);
      app.toast('Лист показан в откалиброванном масштабе 1:1.');
    }));
  }

  function history(parent,ui) {
    const section=card(parent,ui,'История с миниатюрами');
    const entries=app.historyPreviews(preview.thumbnail);
    if(!entries.length){section.append(ui.el('p','Миниатюры появятся после первого изменения листа.'));return;}
    section.append(ui.el('p','Выбор состояния открывает его на листе. Текущую версию можно вернуть через «Отменить».'));
    const strip=ui.el('div',null,'lab-workbench-grid');
    for (const entry of entries) {
      const control=ui.button('Шаг −'+entry.steps+' · объекты '+entry.shapes+' · операции '+entry.operations,()=>{
        if (!app.restoreHistoryPreview(entry.steps)) throw new Error('Завершите построение, затем снова откройте историю.');
        ui.close();
      });
      control.className='lab-workbench-thumb';
      control.prepend(preview.sketchSVG(entry.thumbnail));
      strip.append(control);
    }
    section.append(strip);
  }

  function reportTable(ui,metrics) {
    const table=ui.el('table'), head=ui.el('thead'), headings=ui.el('tr'), rows=ui.el('tbody');
    for(const caption of ['Параметр','Сохранённая версия','Текущий лист','Изменение'])headings.append(ui.el('th',caption));
    head.append(headings);table.append(head,rows);
    function row(label,before,after) {
      const tr=ui.el('tr');
      [label,show(before),show(after),show(Number.isFinite(before)&&Number.isFinite(after)?after-before:null)].forEach(value=>tr.append(ui.el('td',value)));
      rows.append(tr);
    }
    const [prior,next]=metrics;
    ['Ширина, мм','Глубина, мм','Высота, мм','Объём, мм³','Сквозные полости'].forEach((label,i)=>row(label,prior.dimensions[i],next.dimensions[i]));
    for(let i=0;i<Math.max(prior.walls.length,next.walls.length);i++)row('Заданная стенка '+(i+1)+', мм',prior.walls[i],next.walls[i]);
    const ids=new Set([...prior.holes.keys(),...next.holes.keys()]);
    for(const [index,id] of [...ids].slice(0,30).entries()) {
      for(const [label,property] of [['Диаметр','diameter'],['X центра','x'],['Y центра','y']])
        row(label+' окружности '+(index+1)+', мм',prior.holes.get(id)?.[property],next.holes.get(id)?.[property]);
    }
    return table;
  }

  async function versions(parent,ui) {
    const section=card(parent,ui,'Версии проекта');
    section.append(ui.el('p','Выберите сохранённый проект, контрольную точку или файл JSON. Сравнение использует текущий лист.'));
    const picker=ui.el('select');
    picker.setAttribute('aria-label','Сохранённый проект или контрольная точка');
    const file=fileField(ui,section,'Файл прошлой версии','.json');
    const label=field(ui,section,'Название ответвления','text');
    label.maxLength=64;
    section.append(picker);
    const choices=[];
    try {
      for(const record of await gallery.cards(()=>null)){
        choices.push({id:record.id,label:record.name});
        record.checkpoints.forEach((point,index)=>choices.push({id:record.id,index,label:record.name+' · '+point.name}));
      }
    }catch { picker.disabled=true; }
    if(!ui.isActive())return;
    choices.forEach((choice,index)=>{
      const option=ui.el('option',choice.label);option.value=String(index);picker.append(option);
    });
    picker.disabled=!choices.length;
    let uploaded=null,oldModel=null;
    picker.addEventListener('change',()=>{uploaded=null;file.value='';oldModel=null;});
    file.addEventListener('change',()=>{uploaded=file.files[0]||null;oldModel=null;});
    const getVersion=async()=>{
      if(uploaded)return {title:uploaded.name,project:app.prepareProject(await readJson(uploaded))};
      const choice=choices[Number(picker.value)];
      if(!choice)throw new Error('Сохраните проект в галерею или выберите файл JSON.');
      const record=await gallery.get(choice.id);
      const project=choice.index===undefined?record?.project:record?.checkpoints[choice.index]?.project;
      if(!project)throw new Error('Версия больше не доступна.');
      return {title:choice.label,id:choice.id,project:app.prepareProject(project)};
    };
    const result=ui.el('div');
    const actions=ui.el('div',null,'lab-workbench-actions');
    actions.append(ui.button('Сохранить ответвление',async()=>{
      const {id,title,project}=await getVersion();
      const now=Date.now();
      const branchId=global.crypto?.randomUUID?.()||'branch-'+now+'-'+Math.random().toString(36).slice(2);
      await gallery.insert([{id:branchId,name:(label.value.trim()||title+' · ответвление').slice(0,64),created:now,updated:now,project,checkpoints:[],forkOf:id}]);
      const option=ui.el('option',(label.value.trim()||title+' · ответвление').slice(0,64));
      option.value=String(choices.length);choices.push({id:branchId,label:option.textContent});picker.append(option);
      picker.disabled=false;
      ui.status('Ответвление сохранено отдельным проектом.');
    }),ui.button('Сравнить размеры',async()=>{
      const {project}=await getVersion(), current=app.prepareProject(app.getState());
      if(!ui.isActive())return;
      function describe(value) {
        let mesh=null;
        try { mesh=data.build(value).mesh; } catch { /* A 2D revision still has circle coordinates. */ }
        return data.metrics(value,mesh);
      }
      const panels=ui.el('div',null,'lab-workbench-grid');
      panels.append(preview.sketchSVG(preview.thumbnail(project)),preview.sketchSVG(preview.thumbnail(current)));
      result.replaceChildren(panels,reportTable(ui,[describe(project),describe(current)]));
    }),ui.button('Выбрать деталь из версии',async()=>{
      const {project}=await getVersion();
      if(!ui.isActive())return;
      oldModel=data.build(project).mesh;
      const parts=ui.el('select');parts.setAttribute('aria-label','Деталь для восстановления');
      oldModel.bodies.forEach((part,index)=>{const option=ui.el('option',part.name);option.value=String(index);parts.append(option);});
      result.replaceChildren(parts,ui.button('Добавить деталь в текущую сборку',()=>{
        if(app.isModelEditing())throw new Error('Примените или отмените изменение модели.');
        const source=oldModel?.bodies[Number(parts.value)];
        if(!source||source.mesh.positions.length>18000)throw new Error('Выберите деталь до 2000 треугольников.');
        const mesh=app.getProjectionMesh(), target=mesh?.bodies[0];
        if(!target)throw new Error('Откройте лист с замкнутым профилем перед добавлением к нему детали.');
        const offset=[mesh.bounds.max[0]+10-source.bounds.min[0],0,0];
        const ok=app.addModelFeature({type:'import-body',target:target.id,title:source.name,vertices:Array.from(source.mesh.positions),offset});
        if(!ok)throw new Error(app.getModelError()||'Деталь не добавлена.');
        ui.close();global.LabCAD?.modelMode(true,false);app.toast('Восстановленная деталь добавлена справа от сборки.');
      }));
    }));
    section.append(actions,result);
  }

  function schoolPack(parent,ui) {
    const section=card(parent,ui,'Комплект урока');
    const assignment=fileField(ui,section,'Файл задания','.json');
    const attachments=fileField(ui,section,'Материалы до 2 МБ каждый','');
    attachments.multiple=true;
    const notes=ui.el('textarea');notes.maxLength=6000;
    notes.setAttribute('aria-label','План и заметки к уроку');
    notes.placeholder='План и заметки к уроку';
    section.append(notes);
    const uploaded=fileField(ui,section,'Открыть комплект','.json'), list=ui.el('div');
    section.append(ui.button('Скачать комплект',async()=>{
      const task=await readJson(assignment.files[0],8);
      const files=[...attachments.files];
      if(files.length>8||files.some(file=>file.size>2*1024*1024))throw new Error('Выберите до восьми материалов до 2 МБ каждый.');
      const materials=[];
      for(const file of files){
        const bytes=new Uint8Array(await file.arrayBuffer());
        let binary='';
        for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        materials.push({name:file.name,base64:btoa(binary)});
      }
      const pack=data.validatePack({kind:'lab-lesson-package',version:1,task,materials,notes:notes.value,panel:settings.commands});
      ui.download(JSON.stringify({...pack,panel:commandIds(settings.commands)}),'Комплект-урока.json');
    }),ui.button('Показать комплект',async()=>{
      const original=await readJson(uploaded.files[0],32);
      const pack=data.validatePack(original);
      if(!ui.isActive())return;
      list.replaceChildren(ui.el('h4',pack.task.title),ui.el('p',pack.notes),ui.button('Открыть задание в практикумах',()=>{
        if(Array.isArray(original.panel)){settings.commands=commandIds(original.panel);persist(ui);paintCommands();}
        ui.close();global.LabTeachingUI.importTask(pack.task);
      }));
      for(const file of pack.materials){
        list.append(ui.button('Скачать '+file.name,()=>{
          const bytes=Uint8Array.from(atob(file.base64),value=>value.charCodeAt(0));
          ui.download(bytes,file.name,'application/octet-stream');
        }));
      }
    }),list);
  }

  function verification(parent,ui) {
    const section=card(parent,ui,'Контрольные модели и быстродействие'), output=ui.el('ul');
    const clock=()=>performance.now();
    section.append(ui.button('Проверить контрольные чертежи',()=>{
      output.replaceChildren();
      for(const reference of data.references()){
        const stats=data.referenceReport(reference,app.prepareProject);
        output.append(ui.el('li',reference.name+' · '+(stats.passed?'пройдено':'есть расхождения')+
          ' · '+stats.segments+' из 3 проекций · '+show(stats.volume)+' мм³'));
      }
    }),ui.button('Измерить на контрольной пластине',()=>{
      const reference=data.references()[1];
      const openStart=clock();
      const source=JSON.stringify({version:1,orientation:'landscape',strokes:reference.strokes,modelHeight:reference.height});
      const model=app.prepareProject(JSON.parse(source));
      const openTime=clock()-openStart;
      const buildStart=clock(), {mesh}=data.build(model);
      const buildTime=clock()-buildStart;
      const drawingStart=clock();
      for(const view of ['top','front','side'])global.LabDrawingGeometry.orthographic(mesh,view);
      const drawingTime=clock()-drawingStart;
      output.replaceChildren(ui.el('li','Чтение и проверка JSON · '+show(openTime)+' мс'),
        ui.el('li','Перестроение геометрии · '+show(buildTime)+' мс'),
        ui.el('li','Расчёт трёх проекций · '+show(drawingTime)+' мс'));
      const viewer=app.getModelViewer();
      if(!viewer||!app.isModelOpen()){output.append(ui.el('li','Откройте 3D-модель для замера времени вращения.'));return;}
      const camera=viewer.getCamera(), start=clock();
      try { for(let i=0;i<24;i++)viewer.orbit(10,0); }
      finally { viewer.setCamera(camera,false); }
      output.append(ui.el('li','Обработка 24 шагов вращения текущей модели · '+show(clock()-start)+' мс'));
    }),output);
  }

  global.LabExtensions.register({id:'workspace',title:'Рабочее место',mount(parent,ui){
    controls(parent,ui);
    ruler(parent,ui);
    history(parent,ui);
    versions(parent,ui);
    schoolPack(parent,ui);
    verification(parent,ui);
  }});
})(window);
