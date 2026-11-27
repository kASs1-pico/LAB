/* Assignments, individual assessment and classroom review without a server. */
(() => {
  'use strict';
  const app = window.LabApp;
  const school = window.LabTeaching;
  if (!app || !school) return;
  const $ = id => document.getElementById(id);
  const storageKey = 'drawing-lab-teaching-v1';
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const decimal = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
  const number = value => typeof value === 'number' ? decimal.format(value) : '—';
  let memory = {assignments:[],active:null};
  let rows = [], tab = 'tasks', taskId = school.list[0].id, selectedVariant = 1;
  let viewFocus, currentResult, currentReview, draftCriteria, draftStarter, draftAnswer, editingId;
  let feedbackDetails, isProjector = false, pendingAttachment = false;
  let constructorEditor, submissionBusy = false;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey)||'null');
    if (saved && Array.isArray(saved.assignments)) {
      memory.assignments = saved.assignments.slice(0,20).flatMap(item=>{
        try { return [school.validateTask(item)]; } catch { return []; }
      });
      if (saved.active) {
        const task=school.validateTask(saved.active.task);
        const attempts=Number(saved.active.attempts);
        memory.active={
          task,
          attempts:Number.isInteger(attempts)&&attempts>=0?attempts:0,
          hints:Math.max(0,Math.min(Number(saved.active.hints)||0,task.hints.length)),
          learner:text(saved.active.learner,80),
          className:text(saved.active.className,24),
          conclusion:text(saved.active.conclusion,1200)
        };
      }
    }
  } catch { /* The gallery still works in the current session. */ }
  function keep() {
    try {
      localStorage.setItem(storageKey,JSON.stringify(memory));
      return true;
    } catch {
      app.toast('Память браузера недоступна. Сохраните задание или работу в файл.');
      return false;
    }
  }
  function text(value,length) {
    return typeof value==='string'?value.trim().slice(0,length):'';
  }
  function make(tag,props={},children=[]) {
    const el=Object.assign(document.createElement(tag),props);
    el.append(...children);
    return el;
  }
  const p = (textContent,className='') => make('p',{textContent,className});
  const h = (textContent) => make('h3',{textContent});
  function button(label,action,emphasis=false) {
    const control=make('button',{type:'button',textContent:label,className:emphasis?'teaching-primary':''});
    control.addEventListener('click',action);
    return control;
  }
  function field(label,control) {
    return make('label',{className:'teaching-field'},[make('span',{textContent:label}),control]);
  }
  function textField(value,maxLength) {
    return make('input',{type:'text',value,maxLength});
  }
  function area(value,maxLength,rows=3) {
    return make('textarea',{value,maxLength,rows});
  }
  function numeric(value,min,max,step='any') {
    return make('input',{type:'number',value:String(value),min:String(min),max:String(max),step:String(step),required:true});
  }
  function select(values,current) {
    const control=make('select',{},values.map(([value,label])=>make('option',{value,textContent:label})));
    control.value=current;
    return control;
  }
  const card = (...children) => make('section',{className:'teaching-card'},children);
  const actions = (...children) => make('div',{className:'teaching-actions'},children);
  const inputFile = (multiple=false)=>make('input',{type:'file',accept:'.json,application/json',hidden:true,multiple});
  function show(message='',error=false) {
    status.textContent=message;
    status.hidden=!message;
    status.classList.toggle('teaching-error',error);
  }
  function attempt(action) {
    try { action(); } catch(error) { show(error.message,true); }
  }
  function portraitProject(project,entry=null) {
    try {
      const mesh=entry?.result.mesh||school.build(project);
      return projectionFor(mesh,'top','Вид сверху');
    } catch {
      return {segments:school.sketchSegments(project),label:'Контур на листе'};
    }
  }
  function download(data,name) {
    const filename=name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'-').slice(0,110)||'Лаборатория';
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const link=make('a',{href:url,download:`${filename}.json`});
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),3000);
  }
  async function read(file) {
    if(!file||file.size>15*1024*1024)throw new Error('Допустим файл JSON размером до 15 МБ.');
    try { return JSON.parse(await file.text()); }
    catch { throw new Error(`Не удалось прочитать JSON «${file.name}».`); }
  }
  const dialog=make('dialog',{id:'teaching-lab',className:'teaching-dialog'});
  const title=make('h2',{id:'teaching-title',textContent:'Практикумы'});
  dialog.setAttribute('aria-labelledby',title.id);
  const close=button('Закрыть',()=>dialog.close());
  const tabs=make('nav',{className:'teaching-tabs'});
  tabs.setAttribute('aria-label','Разделы практикумов');
  const outlet=make('div',{className:'teaching-content'});
  const status=make('p',{className:'teaching-status',hidden:true});
  status.setAttribute('role','status');
  const fileAssignment=inputFile(),fileClass=inputFile(true),fileFeedback=inputFile();
  dialog.append(make('header',{className:'teaching-head'},[title,close]),tabs,status,outlet,fileAssignment,fileClass,fileFeedback);
  document.body.append(dialog);
  const bar=make('div',{className:'teaching-live',hidden:true});
  const resume=button('Открыть задание',()=>open('active'));
  const projectionToggle=button('Завершить показ',()=>projector(false));
  projectionToggle.hidden=true;
  const anchorAction=button('Завершить расстановку замечаний',()=>{pendingAttachment=false;open('class');});
  anchorAction.hidden=true;
  bar.append(resume,projectionToggle,anchorAction);
  const cursor=make('div',{className:'teaching-projector-pointer',hidden:true});
  const markerOverlay=make('div',{className:'teaching-marker-overlay',hidden:true});
  document.body.append(bar,cursor,markerOverlay);
  const launch=button('Практикумы и класс',()=>{$('menu-close')?.click();open();});
  launch.id='teaching-launch';
  $('experiment-launch')?.after(launch);
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  dialog.addEventListener('close',()=>{
    if(viewFocus?.getClientRects().length)viewFocus.focus({preventScroll:true});
  });
  function open(destination=memory.active?'active':'tasks') {
    if(!dialog.open) {
      viewFocus=document.activeElement;
      dialog.showModal();
    }
    navigate(destination);
  }
  function navigate(destination) {
    tab=destination;
    show();
    render();
  }
  function syncBar() {
    bar.hidden=!memory.active&&!isProjector&&!pendingAttachment;
    resume.hidden=!memory.active;
    projectionToggle.hidden=!isProjector;
    anchorAction.hidden=!pendingAttachment;
    if(memory.active)resume.textContent=memory.active.task.title;
    document.body.classList.toggle('teaching-limited',memory.active?.task.mode==='test'&&memory.active?.task.toolLimit===true);
  }
  function render() {
    const entries=[['tasks','Задания'],['active','Моя работа'],['editor','Конструктор'],['class','Работы класса']];
    tabs.replaceChildren();
    for(const [id,label] of entries) {
      const el=button(label,()=>navigate(id));
      el.setAttribute('aria-current',id===tab?'page':'false');
      if(id==='active'&&!memory.active)el.disabled=true;
      tabs.append(el);
    }
    outlet.replaceChildren();
    if(tab==='active'&&memory.active)renderActive();
    else if(tab==='editor')renderEditor();
    else if(tab==='class')renderClass();
    else renderLibrary();
    syncBar();
  }
  function selectedTask() {
    return memory.assignments.find(item=>item.id===taskId)||school.builtIn(taskId,selectedVariant);
  }
  function quickTitle(task) { return `${task.title} · вариант ${task.variant}`; }
  function taskDiagram(item,overlay=null) {
    const all=item.segments.concat(item.dashed||[],overlay||[]);
    if(!all.length)return make('div');
    const [minX,minY,maxX,maxY]=school.segmentBounds(all);
    const width=Math.max(1,maxX-minX),height=Math.max(1,maxY-minY);
    const stroke=Math.max(width,height)/110||.5;
    const margin=Math.max(width,height)*.085;
    const svg=document.createElementNS(svgNamespace,'svg');
    svg.setAttribute('viewBox',`${minX-margin} ${minY-margin} ${width+2*margin} ${height+2*margin}`);
    svg.setAttribute('role','img');svg.setAttribute('aria-label',item.label);
    const draw=(lines,color,dash=false)=>{
      const path=document.createElementNS(svgNamespace,'path');
      path.setAttribute('d',lines.map(([a,b])=>`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`).join(' '));
      path.setAttribute('fill','none');
      path.setAttribute('stroke',color);path.setAttribute('stroke-width',String(stroke));
      if(dash)path.setAttribute('stroke-dasharray',`${2.7*stroke} ${2*stroke}`);
      svg.append(path);
    };
    draw(item.dashed||[],'#617e9b',true);
    draw(item.segments,'#263c46');
    if(overlay)draw(overlay,'#b44632');
    return make('figure',{className:'teaching-diagram'},[svg,make('figcaption',{textContent:item.label})]);
  }
  function diagrams(list) {
    return make('div',{className:'teaching-diagrams'},list.map(item=>taskDiagram(item)));
  }
  function prepareLoad() {
    if(typeof app.loadProject!=='function')throw new Error('Команда загрузки учебных проектов недоступна.');
    if(app.isModelEditing())throw new Error('Примените или отмените текущую операцию CAD.');
    window.LabDrawingSheet?.close({restoreFocus:false});
  }
  function start(task) {
    const active=memory.active;
    if(active?.task.id===task.id&&active.task.variant===task.variant){
      navigate('active');return;
    }
    if((app.getState().strokes.length||active)&&!window.confirm('Открыть задание на холсте? Текущий проект можно сохранить отдельно через меню экспорта.'))return;
    prepareLoad();
    if(app.loadProject(task.starter)===false)throw new Error('Начальный проект не открылся.');
    currentResult=null;currentReview=null;
    memory.active={task,attempts:0,hints:0,learner:active?.learner||'',className:active?.className||'',conclusion:''};
    keep();syncBar();navigate('active');
  }
  function renderLibrary() {
    const ids=school.list.map(item=>[item.id,item.title]);
    const custom=memory.assignments.map(item=>[item.id,item.title]);
    const src=select(ids.concat(custom),taskId);
    const variant=numeric(selectedVariant,1,999,1);
    variant.disabled=custom.some(([id])=>id===taskId);
    const openFile=button('Открыть файл задания',()=>fileAssignment.click());
    const selected=card(h('Задание'),actions(field('Практикум',src),field('Номер варианта',variant)),openFile);
    const details=card();
    outlet.append(make('div',{className:'teaching-layout'},[selected,details]));
    function refresh() {
      attempt(()=>{
        const task=selectedTask();
        variant.disabled=custom.some(([id])=>id===taskId);
        details.replaceChildren(h(quickTitle(task)),p(task.brief),diagrams(task.reference),
          actions(button('Открыть на холсте',()=>attempt(()=>start(task)),true),button('Скачать задание',()=>download(task,quickTitle(task)))));
      });
    }
    src.addEventListener('change',()=>{taskId=src.value;refresh();});
    variant.addEventListener('change',()=>{
      if(!variant.reportValidity())return;
      selectedVariant=variant.valueAsNumber;refresh();
    });
    refresh();
  }
  function importTask(input) {
    const task=school.validateTask(input);
    if(school.list.some(item=>item.id===task.id)){
      taskId=task.id;selectedVariant=task.variant;
    }else{
      memory.assignments=memory.assignments.filter(item=>item.id!==task.id);
      memory.assignments.unshift(task);memory.assignments=memory.assignments.slice(0,20);
      taskId=task.id;keep();
    }
    open('tasks');
    show('Файл задания открыт. Нажмите «Открыть на холсте», чтобы начать.');
  }
  fileAssignment.addEventListener('change',async()=>{
    const file=fileAssignment.files[0];fileAssignment.value='';
    if(!file)return;
    try { importTask(await read(file)); } catch(error){show(error.message,true);}
  });
  function reportSummary(result,hideMarks=false) {
    const table=make('table',{className:'teaching-results'});
    table.append(make('thead',{},[make('tr',{},['Критерий','Условие','Результат','Баллы'].map(value=>make('th',{scope:'col',textContent:value})))]));
    const body=make('tbody');
    result.rows.forEach(row=>{
      const target=row.type==='manual'?'Проверяет учитель':(row.operator==='min'?'≥ ':row.operator==='max'?'≤ ':'')+
        number(row.value)+(row.tolerance&&row.operator==='near'?` ± ${number(row.tolerance)}`:'')+(row.unit?` ${row.unit}`:'');
      const outcome=row.type==='manual'?'—':row.got===null?'—':`${number(row.got)}${row.unit?` ${row.unit}`:''}`;
      const value=row.type==='manual'&&row.manual===undefined?'—':row.type==='manual'?row.manual:row.passed?row.points:0;
      const cells=[row.name,target,outcome,`${value} / ${row.points}`].map((value,index)=>make(index===0?'th':'td',
        index===0?{scope:'row',textContent:value}:{textContent:value}));
      const line=make('tr',{className:row.passed===false?'teaching-mismatch':''},cells);
      body.append(line);
    });
    table.append(body);
    const rate=hideMarks?'':` · оценка ${school.mark(result.points,result.total,result.scale)}`;
    const resultTitle=`${result.points} из ${result.total} баллов${rate}`;
    return make('div',{className:'teaching-report'},[p(resultTitle,'teaching-score'),result.error?p(result.error,'teaching-error'):p(''),
      make('div',{className:'teaching-table-scroll'},[table])]);
  }
  function renderActive() {
    const active=memory.active,{task}=active;
    const heading=card(h(quickTitle(task)),p(task.brief),diagrams(task.reference));
    const student=card(h('Данные работы'));
    const learner=textField(active.learner,80),className=textField(active.className,24);
    learner.autocomplete='name';
    const conclusion=area(active.conclusion,1200);
    function updateLearner() {
      active.learner=text(learner.value,80);active.className=text(className.value,24);
      const next=text(conclusion.value,1200);
      if(active.conclusion!==next){active.conclusion=next;currentResult=null;refreshReport();}
    }
    for(const field of [learner,className,conclusion])field.addEventListener('change',()=>{updateLearner();keep();});
    student.append(actions(field('Имя и фамилия',learner),field('Класс',className)),field('Вывод или пояснение',conclusion));
    const hints=make('ol',{className:'teaching-hints'},task.hints.slice(0,active.hints).map(value=>make('li',{textContent:value})));
    const hint=button('Следующая подсказка',()=>{
      if(active.hints>=task.hints.length)return;
      hints.append(make('li',{textContent:task.hints[active.hints++]}));
      hint.disabled=active.hints>=task.hints.length;keep();
    });
    const hintSection=card(h('Подсказки'),hints,hint);
    hintSection.hidden=!task.hints.length||task.mode==='test';
    hint.disabled=active.hints>=task.hints.length;
    const operation=card(h('Проверка и сдача'));
    const mount=make('div');
    const preview=button('Лист сдачи А4',()=>attempt(()=>{
      updateLearner();requireIdentity(active);showReceipt(workFromActive());
    }));
    const save=button('Скачать работу',()=>attempt(()=>{
      updateLearner();requireIdentity(active);
      const result=workFromActive();
      download(result,`${active.learner} — ${quickTitle(task)}`);
      show('Работа сохранена. Передайте файл учителю.');
    }));
    const check=button('Проверить работу',()=>attempt(()=>{
      updateLearner();
      if(app.isModelEditing())throw new Error('Примените или отмените операцию CAD перед проверкой.');
      if(task.maxAttempts&&active.attempts>=task.maxAttempts)throw new Error('Лимит проверок достигнут. Скачайте работу для учителя.');
      const project=app.getState();
      const result=school.grade(task,project,active.conclusion);
      active.attempts++;
      currentResult=result;
      keep();refreshReport();
    }),true);
    const progress=p('');
    progress.setAttribute('aria-live','polite');
    const canReveal=()=>task.reveal==='always'||task.reveal==='after'&&active.attempts>0;
    const compare=button('Сравнить с эталоном',()=>attempt(()=>{
      const reference=task.outline;
      if(reference){
        const sketch=school.normalizeSegments(school.sketchSegments(app.getState()));
        mount.append(taskDiagram({...reference,label:'Эталон — графит · работа ученика — красная'},sketch));
        compare.disabled=true;
      }else if(task.referenceModel){
        if(!window.confirm('Открыть эталон на холсте? Текущую работу можно предварительно скачать.'))return;
        prepareLoad();
        download(workFromActive(),`${active.learner||'Моя работа'} — ${quickTitle(task)}`);
        app.loadProject(task.referenceModel);
        memory.active=null;currentResult=null;keep();syncBar();dialog.close();
      }
    }));
    compare.hidden=true;
    function refreshReport() {
      mount.replaceChildren();
      progress.textContent=task.maxAttempts?`Проверки ${active.attempts} из ${task.maxAttempts}`:`Проверок ${active.attempts}`;
      check.disabled=Boolean(task.maxAttempts&&active.attempts>=task.maxAttempts);
      compare.hidden=!canReveal()||!(task.outline||task.referenceModel);
      compare.disabled=false;
      if(currentResult){
        if(task.mode==='test'&&task.reveal!=='always')mount.append(p('Результаты доступны в файле работы для учителя.'));
        else mount.append(reportSummary(currentResult,currentResult.rows.some(row=>row.type==='manual')));
      }
    }
    const exit=button('Завершить практикум',()=>{
      if(!window.confirm('Завершить практикум? Текущий чертёж останется на холсте.'))return;
      memory.active=null;currentResult=null;keep();navigate('tasks');
    });
    const review=button('Открыть отзыв учителя',()=>fileFeedback.click());
    const followUp=actions(review,exit);
    if(task.id==='pair')followUp.prepend(button('Открыть чертёж для передачи мастеру',()=>{
      dialog.close();window.LabDrawingSheet?.open();
    }));
    operation.append(progress,actions(check,save,preview,compare),mount,followUp);
    heading.append(actions(button('Вернуться к построению',()=>dialog.close(),true)));
    outlet.append(heading,make('div',{className:'teaching-layout'},[student,hintSection]),operation);
    refreshReport();
  }
  function requireIdentity(active) {
    if(!active.learner||!active.className)throw new Error('Введите имя, фамилию и класс.');
  }
  function workFromActive() {
    const active=memory.active;
    if(app.isModelEditing())throw new Error('Завершите текущую операцию перед сохранением.');
    return {kind:'lab-submission',version:1,id:cryptoId('work'),taskId:active.task.id,
      variant:active.task.variant,learner:active.learner,className:active.className,conclusion:active.conclusion,
      attempts:active.attempts,hints:active.hints,project:app.getState(),created:new Date().toISOString()};
  }
  function cryptoId(prefix) {
    return prefix+'-'+Array.from(crypto.getRandomValues(new Uint32Array(3)),part=>part.toString(36)).join('-');
  }
  function snapshotProject() {
    const project=app.getState();
    if(app.isModelEditing())throw new Error('Завершите текущую операцию перед копированием проекта.');
    return school.checkProject(project);
  }
  function resetEditor() {
    draftCriteria=[school.rule('closed',1,0,1),school.rule('x',60,1,2),school.rule('drawing',2,0,1,'min')];
    draftStarter=null;draftAnswer=null;editingId=null;constructorEditor=null;
  }
  function renderEditor() {
    if(!draftCriteria)resetEditor();
    const title=textField(constructorEditor?.title||'',100);title.required=true;
    const brief=area(constructorEditor?.brief||'',1800,5);brief.required=true;
    const variant=numeric(constructorEditor?.variant||1,1,999,1);
    const maxAttempts=numeric(constructorEditor?.maxAttempts||0,0,20,1);
    const mode=select([['practice','Практикум'],['test','Самостоятельная работа']],constructorEditor?.mode||'practice');
    const reveal=select([['after','После проверки'],['always','С начала работы'],['never','Скрыт']],constructorEditor?.reveal||'after');
    const limit=make('input',{type:'checkbox',checked:constructorEditor?.toolLimit||false});
    const scale=Object.fromEntries(Object.entries(constructorEditor?.scale||school.standardScale)
      .map(([key,value])=>[key,numeric(value,1,100,1)]));
    const hintFields=[0,1,2].map(i=>area(constructorEditor?.hints?.[i]||'',300,2));
    const criteriaMount=make('div',{className:'teaching-criteria'});
    const form=make('form');
    const assignment=card(h('Условие'),field('Название',title),field('Что должен сделать ученик',brief),
      actions(field('Номер варианта',variant),field('Режим',mode),field('Лимит проверок · 0 без ограничения',maxAttempts),
        field('Когда доступен эталон',reveal),field('Отключить расширенные команды в самостоятельной работе',limit)));
    const modelState=make('p');
    function refreshModels() {
      modelState.textContent=`Стартовый проект — ${draftStarter?(draftStarter.strokes.length+' построений'):'чистый лист'}. Эталон — ${draftAnswer?(draftAnswer.strokes.length+' построений'):'не прикреплён'}.`;
    }
    const projects=card(h('Проекты и подсказки'),modelState,
      actions(button('Взять текущий лист как стартовый',()=>attempt(()=>{draftStarter=snapshotProject();refreshModels();})),
        button('Взять текущий лист как эталон',()=>attempt(()=>{draftAnswer=snapshotProject();refreshModels();})),
        button('Очистить вложения',()=>{draftStarter=null;draftAnswer=null;refreshModels();})),
      ...hintFields.map((control,index)=>field(`Подсказка ${index+1}`,control)));
    const criteria=card(h('Критерии и баллы'),criteriaMount);
    const gradeScale=card(h('Пороги оценок'),actions(field('Оценка 3, %',scale.pass),
      field('Оценка 4, %',scale.good),field('Оценка 5, %',scale.excellent)));
    const typeValues=Object.entries(school.types).filter(([id])=>id!=='outline').map(([id,[label,unit]])=>[id,label+(unit?` · ${unit}`:'')]);
    function syncFields() {
      constructorEditor={title:title.value,brief:brief.value,mode:mode.value,reveal:reveal.value,
        maxAttempts:maxAttempts.valueAsNumber,variant:variant.valueAsNumber,toolLimit:limit.checked,
        scale:Object.fromEntries(Object.entries(scale).map(([key,input])=>[key,input.valueAsNumber])),
        hints:hintFields.map(input=>input.value)};
    }
    function renderCriteria() {
      criteriaMount.replaceChildren();
      draftCriteria.forEach((item,index)=>{
        const kind=select(typeValues,item.type);
        const operator=select([['near','Равно с допуском'],['min','Не меньше'],['max','Не больше']],item.operator);
        const value=numeric(item.value,0,1e12);
        const tolerance=numeric(item.tolerance,0,1e12);
        const points=numeric(item.points,1,20,1);
        const label=textField(item.label,100);
        function syncCriteria() {
          const manual=kind.value==='manual';
          Object.assign(item,{type:kind.value,operator:manual?'near':operator.value,value:manual?0:value.valueAsNumber,
            tolerance:manual||operator.value!=='near'?0:tolerance.valueAsNumber,points:points.valueAsNumber,label:label.value});
          updateVisibility();
        }
        const operatorField=field('Сравнение',operator),valueField=field('Цель',value),toleranceField=field('Допуск ±',tolerance);
        const updateVisibility=()=>{
          const manual=kind.value==='manual';
          operatorField.hidden=manual;valueField.hidden=manual;toleranceField.hidden=manual||operator.value!=='near';
          operator.disabled=manual;value.disabled=manual;tolerance.disabled=toleranceField.hidden;
          label.placeholder=kind.value==='manual'?'Например, читаемость разреза':'По умолчанию используется название';
        };
        [kind,operator,value,tolerance,points,label].forEach(el=>el.addEventListener('change',syncCriteria));
        criteriaMount.append(make('fieldset',{className:'teaching-criterion'},[make('legend',{textContent:`Критерий ${index+1}`}),
          field('Проверка',kind),operatorField,valueField,toleranceField,field('Баллы',points),
          field('Подпись',label),button('Убрать',()=>{if(draftCriteria.length>1){draftCriteria.splice(index,1);renderCriteria();}})]));
        updateVisibility();
      });
    }
    criteria.append(button('Добавить критерий',()=>{
      if(draftCriteria.length>=25){show('Допустимо до 25 критериев.',true);return;}
      draftCriteria.push(school.rule('x',60,1,2));
      renderCriteria();
    }));
    const save=make('button',{type:'submit',textContent:'Сохранить и скачать задание',className:'teaching-primary'});
    form.append(assignment,projects,criteria,gradeScale,actions(save,button('Новое задание',()=>{resetEditor();render();})));
    form.addEventListener('change',syncFields);
    form.addEventListener('submit',event=>{
      event.preventDefault();
      attempt(()=>{
        syncFields();
        const task=school.validateTask({kind:'lab-task',version:1,id:editingId||cryptoId('assignment'),
          ...constructorEditor,criteria:draftCriteria,starter:draftStarter,referenceModel:draftAnswer});
        editingId=task.id;
        taskId=task.id;
        memory.assignments=[task,...memory.assignments.filter(item=>item.id!==task.id)].slice(0,20);
        keep();
        download(task,quickTitle(task));
        show('Задание сохранено. Передайте JSON классу.');
      });
    });
    refreshModels();renderCriteria();
    const previous=select([['','Выберите задание'],...memory.assignments.map(item=>[item.id,quickTitle(item)])],'');
    previous.addEventListener('change',()=>{
      const task=memory.assignments.find(item=>item.id===previous.value);
      if(!task)return;
      constructorEditor={...task};editingId=task.id;draftCriteria=structuredClone(task.criteria);
      draftStarter=task.starter;draftAnswer=task.referenceModel;
      render();
    });
    outlet.append(card(field('Редактировать своё задание',previous)),form);
  }
  function validateWork(data) {
    if(!data||data.kind!=='lab-submission'||data.version!==1||!/^[a-z0-9-]{1,90}$/i.test(data.id||'')||
      !/^[a-z0-9_-]{1,80}$/i.test(data.taskId||'')||!Number.isInteger(data.variant)||data.variant<1||data.variant>999||
      !text(data.learner,80)||!text(data.className,24))throw new Error('Неверный файл работы ученика.');
    const project=school.checkProject(data.project);
    const prepared=app.prepareProject?.(project)??project;
    return {kind:'lab-submission',version:1,id:data.id,taskId:data.taskId,variant:data.variant,
      learner:text(data.learner,80),className:text(data.className,24),conclusion:text(data.conclusion,1200),
      project:prepared,hints:Number.isInteger(data.hints)?Math.max(0,Math.min(data.hints,3)):0,
      created:Number.isFinite(Date.parse(data.created))?new Date(data.created).toISOString():'',
      attempts:Number.isInteger(data.attempts)?Math.max(0,Math.min(data.attempts,1000)):0};
  }
  function trustedTask(work) {
    const custom=memory.assignments.find(task=>task.id===work.taskId&&task.variant===work.variant);
    return custom||school.builtIn(work.taskId,work.variant);
  }
  function identity(work) {return `${work.className.toLocaleUpperCase('ru-RU')} · ${work.learner.toLocaleLowerCase('ru-RU')} · ${work.taskId} · ${work.variant}`;}
  fileClass.addEventListener('change',async()=>{
    const files=Array.from(fileClass.files);
    fileClass.value='';
    if(!files.length||submissionBusy)return;
    if(files.length>40){show('Загрузите до 40 работ за один раз.',true);return;}
    submissionBusy=true;
    show('Проверка файлов…');
    const failures=[];
    for(const file of files){
      await new Promise(resolve=>setTimeout(resolve,0));
      try {
        const work=validateWork(await read(file));
        if(rows.some(entry=>entry.work.id===work.id))continue;
        const task=trustedTask(work);
        const result=school.grade(task,work.project,work.conclusion);
        result.mesh=null;
        rows.push({work,task,result,comments:[],teacherNote:''});
      }catch(error){failures.push(`${file.name} — ${error.message}`);}
    }
    submissionBusy=false;
    if(tab==='class')render();
    show(failures.length?`Принято работ ${rows.length}. ${failures.join(' · ')}`:`В списке работ ${rows.length}.`,Boolean(failures.length));
  });
  function markTotal(entry) {
    entry.result.points=entry.result.rows.reduce((sum,row)=>sum+(row.type==='manual'?(row.manual||0):row.passed?row.points:0),0);
    return school.mark(entry.result.points,entry.result.total,entry.result.scale);
  }
  function scoresCsv() {
    const columns=[['Класс','Ученик','Задание','Вариант','Баллы','Максимум','Оценка']];
    const latest=new Map();
    rows.slice().sort((a,b)=>a.work.created.localeCompare(b.work.created)).forEach(entry=>latest.set(identity(entry.work),entry));
    for(const entry of latest.values()){
      const {work,task,result}=entry;
      columns.push([work.className,work.learner,task.title,work.variant,result.points,result.total,markTotal(entry)]);
    }
    const cell=value=>'"'+String(value).replace(/^([=@+\-\t\r])/,"'$1").replace(/"/g,'""')+'"';
    const csv='\ufeff'+columns.map(line=>line.map(cell).join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const a=make('a',{href:url,download:'Результаты класса.csv'});
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),3000);
  }
  function latestRows() {
    const newest=new Map();
    rows.slice().sort((a,b)=>a.work.created.localeCompare(b.work.created)).forEach(entry=>newest.set(identity(entry.work),entry));
    return [...newest.values()].sort((a,b)=>a.work.className.localeCompare(b.work.className,'ru')||a.work.learner.localeCompare(b.work.learner,'ru'));
  }
  function renderClass() {
    const overview=card(h('Работы класса'),p('Выберите JSON, скачанные учениками. Для авторских заданий откройте исходный файл задания в разделе «Задания».'),
      actions(button('Загрузить работы',()=>fileClass.click(),true),button('Скачать таблицу оценок',()=>attempt(scoresCsv)),
        button(isProjector?'Завершить показ':'Режим проектора',()=>{projector(!isProjector);if(isProjector)dialog.close();else render();})));
    const latest=latestRows();
    outlet.append(overview);
    if(!latest.length){outlet.append(card(p('Работ в списке пока нет.')));return;}
    const statistics=new Map();
    latest.forEach(entry=>entry.result.rows.forEach(rule=>{
      if(rule.passed===false)statistics.set(rule.name,(statistics.get(rule.name)||0)+1);
    }));
    const errors=[...statistics].sort((a,b)=>b[1]-a[1]);
    const summary=card(h('Что разобрать с классом'),p(`Последних работ ${latest.length}. Всего загружено ${rows.length}.`));
    if(errors.length)summary.append(make('ol',{},errors.slice(0,8).map(([name,count])=>make('li',{textContent:`${name} — ${count}` }))));
    else summary.append(p('Все автоматические критерии последних работ выполнены.'));
    outlet.append(summary);
    const list=card(h('Список работ'));
    for(const entry of latest) {
      const {work,task,result}=entry;
      const previous=rows.filter(item=>item!==entry&&identity(item.work)===identity(work)&&item.work.created<=work.created)
        .sort((a,b)=>b.work.created.localeCompare(a.work.created))[0];
      const header=make('strong',{textContent:`${work.className} · ${work.learner}`});
      const summaryLine=make('summary',{},[header,p(`${quickTitle(task)} · ${result.points}/${result.total}`)]);
      const details=make('details',{className:'teaching-submission',open:feedbackDetails===entry.work.id},[summaryLine]);
      const score=make('div');
      function refreshScore() {
        markTotal(entry);
        summaryLine.replaceChildren(header,p(`${quickTitle(task)} · ${result.points}/${result.total}`));
        score.replaceChildren(reportSummary(result));
      }
      const note=area(entry.teacherNote,1200);
      note.addEventListener('change',()=>{entry.teacherNote=text(note.value,1200);});
      const manual=result.rows.filter(row=>row.type==='manual').map(row=>{
        const points=numeric(row.manual||0,0,row.points,1);
        points.addEventListener('change',()=>{
          if(points.reportValidity()){row.manual=points.valueAsNumber;refreshScore();}
        });
        return field(`${row.name} · до ${row.points}`,points);
      });
      refreshScore();
      const commentRows=make('ol',{},entry.comments.map((item,index)=>make('li',{},[
        p(item.text),button('Удалить отметку',()=>{entry.comments.splice(index,1);render();})
      ])));
      const previousResult=previous?p(`Предыдущая сдача — ${previous.result.points} из ${previous.result.total}. Текущая — ${result.points} из ${result.total}.`):null;
      const showWork=button('Открыть модель для проверки',()=>attempt(()=>review(entry)));
      showWork.disabled=false;
      details.append(p(`Проверок ${work.attempts} · подсказок ${work.hints}`));
      if(work.conclusion)details.append(p(work.conclusion,'teaching-conclusion'));
      if(previousResult){
        const revision=make('div');
        const comparePrevious=button('Сравнить виды сверху',()=>attempt(()=>{
          const before=portraitProject(previous.work.project,previous),after=portraitProject(work.project,entry);
          revision.replaceChildren(diagrams([
            {...before,label:'Предыдущая сдача'}, {...after,label:'Текущая сдача'}
          ]));
        }));
        details.append(previousResult,comparePrevious,revision);
      }
      details.append(score,...manual,field('Общий отзыв',note),commentRows,
        actions(showWork,button('Лист сдачи',()=>attempt(()=>showReceipt(work,entry))),
          button('Скачать отзыв',()=>download({kind:'lab-feedback',version:1,work,note:entry.teacherNote,
            comments:entry.comments,mark:markTotal(entry)},`Отзыв — ${work.learner}`))));
      details.addEventListener('toggle',()=>{if(details.open)feedbackDetails=entry.work.id;});
      list.append(details);
    }
    outlet.append(list);
  }
  function review(entry) {
    if(!window.confirm('Открыть проект ученика на холсте для проверки и расстановки замечаний?'))return;
    prepareLoad();
    if(app.loadProject(entry.work.project)===false)throw new Error('Проект ученика не открылся.');
    memory.active=null;keep();
    feedbackDetails=entry.work.id;
    currentReview=entry;
    pendingAttachment=true;
    currentResult=null;
    app.setModelOpen(true);
    dialog.close();syncBar();drawMarkers();
    app.toast('Нажмите на грань, чтобы добавить замечание.');
  }
  const markerDialog=make('dialog',{className:'teaching-dialog teaching-note-dialog'});
  const markerTitle=h('Замечание на модели');markerTitle.id='teaching-marker-title';
  markerDialog.setAttribute('aria-labelledby',markerTitle.id);
  document.body.append(markerDialog);
  $('model-canvas')?.addEventListener('labmodelselect',event=>{
    const hit=event.detail?.hit;
    if(!pendingAttachment||!currentReview||!Array.isArray(hit?.point)||hit.point.length!==3||!hit.point.every(Number.isFinite))return;
    if(currentReview.comments.length>=35){app.toast('В работе уже 35 замечаний.');return;}
    const entry=currentReview,input=area('',300);
    const cancel=button('Отмена',()=>markerDialog.close());
    const add=button('Закрепить замечание',()=>{
      const value=text(input.value,300);
      if(!value){input.focus();return;}
      entry.comments.push({point:hit.point.slice(),text:value});
      markerDialog.close();
      drawMarkers();
    },true);
    markerDialog.replaceChildren(markerTitle,field('Текст для ученика',input),actions(cancel,add));
    markerDialog.showModal();input.focus();
  });
  markerDialog.addEventListener('keydown',event=>event.stopPropagation());
  function drawMarkers() {
    markerOverlay.replaceChildren();
    const viewer=app.getModelViewer();
    markerOverlay.hidden=!currentReview?.comments?.length||!app.isModelOpen()||!viewer?.mesh;
    if(markerOverlay.hidden)return;
    for(let i=0;i<currentReview.comments.length;i++){
      const item=currentReview.comments[i],pos=viewer.project(item.point);
      if(!pos)continue;
      const pin=button(String(i+1),()=>app.toast(item.text));
      pin.title=item.text;pin.setAttribute('aria-label',`Замечание ${i+1}. ${item.text}`);
      pin.style.left=`${pos.x}px`;pin.style.top=`${pos.y}px`;
      markerOverlay.append(pin);
    }
  }
  let markerFrame=0;
  function queueMarkers() {
    if(markerFrame||!currentReview)return;
    markerFrame=requestAnimationFrame(()=>{markerFrame=0;drawMarkers();});
  }
  for(const event of ['labmodelchange','labmodelrender'])$('model-canvas')?.addEventListener(event,queueMarkers);
  window.addEventListener('resize',queueMarkers);
  fileFeedback.addEventListener('change',async()=>{
    const file=fileFeedback.files[0];fileFeedback.value='';
    if(!file)return;
    try {
      const item=await read(file);
      if(item.kind!=='lab-feedback'||item.version!==1||!Array.isArray(item.comments)||item.comments.length>35)throw new Error('Неверный файл отзыва.');
      const work=validateWork(item.work),comments=item.comments.map(comment=>{
        if(!Array.isArray(comment?.point)||comment.point.length!==3||!comment.point.every(value=>Number.isFinite(value)&&Math.abs(value)<=100000))throw new Error('Неверная отметка на модели.');
        return {point:comment.point,text:text(comment.text,300)};
      });
      const note=text(item.note,1200);
      const panel=card(h('Отзыв учителя'),p(note),p(`Оценка ${Number.isInteger(item.mark)&&item.mark>=2&&item.mark<=5?item.mark:'—'}`),
        make('ol',{},comments.map(comment=>make('li',{textContent:comment.text}))),
        button('Открыть модель с отметками',()=>attempt(()=>{
          if(!window.confirm('Открыть модель из отзыва на холсте?'))return;
          prepareLoad();
          if(app.loadProject(work.project)===false)throw new Error('Проект из отзыва не открылся.');
          currentReview={work,comments};pendingAttachment=false;
          app.setModelOpen(true);dialog.close();drawMarkers();
        }),true));
      outlet.prepend(panel);panel.scrollIntoView({block:'nearest'});
    }catch(error){show(error.message,true);}
  });
  const receipt=make('section',{className:'teaching-receipt',hidden:true});
  document.body.append(receipt);
  function finishPrint() {
    receipt.hidden=true;document.body.classList.remove('teaching-printing');
  }
  window.addEventListener('afterprint',finishPrint);
  function projectionFor(mesh,name,label) {
    const projection=window.LabDrawingGeometry.orthographic(mesh,name),map=p=>[p[0],-p[1]];
    const segments=projection.visible.map(([a,b])=>[map(a),map(b)]);
    const dashed=projection.hidden.map(([a,b])=>[map(a),map(b)]);
    return {label,segments,dashed};
  }
  function showReceipt(work,entry=null) {
    const task=entry?.task||memory.active?.task;
    if(!task)throw new Error('Задание не открыто.');
    const pictures=[];
    try {
      const mesh=entry?.result?.mesh||school.build(work.project);
      pictures.push(projectionFor(mesh,'top','Вид сверху'));
      const section=work.project.draftDesign?.section;
      if(section){
        try{
          const cut=window.LabDrawingGeometry.crossSection(mesh,section);
          const segments=cut.segments.map(pair=>pair.map(([x,y])=>[x,-y]));
          pictures.push({label:'Разрез А–А',segments});
        }catch{pictures.push(projectionFor(mesh,'front','Вид спереди'));}
      }else pictures.push(projectionFor(mesh,'front','Вид спереди'));
    }catch{
      const segments=school.sketchSegments(work.project);
      if(segments.length)pictures.push({label:'Контур на листе',segments});
    }
    const measurements=work.project.measurementBook?.entries||[];
    const list=make('ol',{},measurements.slice(0,8).map(entry=>make('li',{textContent:
      `${text(entry.variant,64)} · ${number(entry.sample?.value)} мм`})));
    receipt.replaceChildren(make('h1',{textContent:task.title}),p(`Вариант ${work.variant} · ${work.className} · ${work.learner}`),
      p(task.brief),diagrams(pictures),h('Измерения'),measurements.length?list:p('Замеры не записаны.'),h('Вывод'),p(work.conclusion||'—'));
    if(entry?.teacherNote)receipt.append(h('Отзыв'),p(entry.teacherNote));
    receipt.hidden=false;document.body.classList.add('teaching-printing');
    try { window.print(); } catch(error) { finishPrint(); throw error; }
  }
  function projector(enabled) {
    isProjector=enabled;
    document.body.classList.toggle('teaching-projector',enabled);
    cursor.hidden=!enabled;
    syncBar();
  }
  document.addEventListener('pointermove',event=>{
    if(!isProjector)return;
    cursor.style.transform=`translate(${event.clientX}px,${event.clientY}px)`;
  },{passive:true});
  document.addEventListener('click',event=>{
    if(!document.body.classList.contains('teaching-limited'))return;
    const command=event.target.closest?.('#cad-actions,#workshop-launch,#experiment-launch,#sketch-upgrade-launch,[data-workshop-shortcut],#tool-palette [data-tool="pencil"]');
    if(!command)return;
    event.preventDefault();event.stopImmediatePropagation();
    app.toast('Команда отключена для самостоятельной работы.');
  },true);
  document.addEventListener('keydown',event=>{
    if(!document.body.classList.contains('teaching-limited')||dialog.open||markerDialog.open||
      event.target.closest?.('input,textarea,select,[contenteditable]'))return;
    if(event.key===' '||event.code==='KeyP'){
      event.preventDefault();event.stopImmediatePropagation();
    }
  },true);
  document.addEventListener('labchange',event=>{
    if(['drawing','projectload','projectnew','height','draftdesign','measurement'].includes(event.detail?.kind))currentResult=null;
    if(['projectload','projectnew'].includes(event.detail.kind)){
      currentReview=null;pendingAttachment=false;markerOverlay.hidden=true;
      syncBar();
    }
    if(['model','modelgeometry'].includes(event.detail.kind))queueMarkers();
  });
  window.LabTeachingUI={open,importTask,active:()=>dialog.open};
  syncBar();
})();
