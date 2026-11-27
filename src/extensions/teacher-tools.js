/* Classroom analysis, printable lesson materials and anonymous peer review. */
(function (global) {
  'use strict';

  const names = new Map([
    ['analysis','Карта ошибок и повторение'],['references','Несколько эталонов'],
    ['plan','План урока на 45 минут'],['worksheets','Печатный комплект'],
    ['anonymous','Анонимный разбор и взаимная проверка'],['revisions','История исправлений'],
    ['defence','Защита за минуту'],['skills','Портфолио навыков']
  ]);
  const topics = {
    outline:['Чтение проекций','third','Отметьте, какая координата сохраняется при переносе между видами.'],
    section:['Разрезы','cut','Проведите линию через пустоту и отметьте её на разрезе.'],
    closed:['Моделирование','first','Замкните контур и проверьте, образовалось ли тело.'],
    x:['Обмер','first','Снимите габарит по X и запишите точки, между которыми мерили.'],
    y:['Обмер','first','Снимите габарит по Y и укажите направление измерения.'],
    z:['Обмер','first','Найдите высоту между основанием и верхней гранью.'],
    holes:['Моделирование','restore','Проверьте, проходит ли отверстие через всю деталь.'],
    diameter:['Обмер','mistake','Измерьте отверстие и вычислите радиус для исправления.'],
    center:['Чтение проекций','first','Найдите центр пластины как пересечение двух диагоналей.'],
    volume:['Моделирование','light','Вычислите объём заготовки и оцените изменение после выреза.'],
    drawing:['Оформление','revision','На чертеже подпишите главный размер и размер, который изменился.'],
    wall:['Моделирование','light','Проверьте толщину в самом узком месте конструкции.'],
    measurements:['Обмер','real','Сделайте три замера и добавьте их в журнал.'],
    conclusion:['Обоснование','pair','Назовите одно решение, проверку и ограничение конструкции.'],
    bodies:['Моделирование','restore','Выберите замкнутые контуры, которые образуют отдельные тела.']
  };
  const phases = [
    {title:'Входное задание',time:5,outcome:'Ученик называет два вида и показывает общий размер.'},
    {title:'Показ на проекторе',time:8,outcome:'Ученик объясняет одно действие до его выполнения.'},
    {title:'Самостоятельное построение',time:17,outcome:'Ученик сохраняет эскиз, 3D-модель и размеры.'},
    {title:'Взаимная проверка',time:10,outcome:'Ученик записывает одно точное замечание партнёру.'},
    {title:'Итог урока',time:5,outcome:'Ученик формулирует, как проверил результат.'}
  ];
  const reviewQuestions = [
    'Какой размер или вид позволяет однозначно восстановить деталь?',
    'Можно ли по листу найти расположение отверстия или выреза?',
    'Какое уточнение поможет мастеру изготовить деталь?'
  ];
  const blank = value => typeof value==='string' ? value.trim() : '';
  const fmt = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
  const taskKey = ({id,variant}) => id + ':' + variant;
  const workKey = work => work.taskId + ':' + work.variant;
  const person = ({className,learner}) => JSON.stringify([className.toLocaleLowerCase('ru-RU'),learner.toLocaleLowerCase('ru-RU')]);
  const latestKey = work => JSON.stringify([person(work),workKey(work)]);

  function validateWork(data, school, app) {
    const {id,taskId,variant,learner,className,project} = data||{};
    if (data?.kind!=='lab-submission'||data.version!==1||!/^[a-z0-9-]{1,90}$/i.test(id||'')||
      !/^[a-z0-9_-]{1,80}$/i.test(taskId||'')||!Number.isInteger(variant)||variant<1||variant>999||
      !blank(learner)||!blank(className)) throw new Error('Неверный файл работы ученика.');
    const prepared=app.prepareProject(school.checkProject(project));
    return {kind:data.kind,version:1,id,taskId,variant,project:prepared,
      learner:blank(learner).slice(0,80),className:blank(className).slice(0,24),conclusion:blank(data.conclusion).slice(0,1200),
      created:Number.isFinite(Date.parse(data.created))?new Date(data.created).toISOString():''};
  }

  function latest(works) {
    const distinct = new Map();
    for (const work of [...works].sort((a,b)=>a.created.localeCompare(b.created))) distinct.set(latestKey(work),work);
    return [...distinct.values()];
  }

  function metrics(rows) {
    const criteria = new Map();
    for (const {result,task} of rows) {
      for (const [index,rule] of result.rows.entries()) {
        if (rule.passed===null) continue;
        const key=JSON.stringify([task.id,index,rule.type,rule.name]);
        if (!criteria.has(key)) criteria.set(key,{label:rule.name,type:rule.type,failed:0,total:0});
        const item=criteria.get(key);
        item.total++;
        if (!rule.passed) item.failed++;
      }
    }
    return [...criteria.values()].sort((a,b)=>b.failed/b.total-a.failed/a.total||b.failed-a.failed||a.label.localeCompare(b.label,'ru'));
  }

  function gradeBest(school,task,alternatives,work) {
    return [task,...alternatives].reduce((best,candidate,index)=>{
      const result=school.grade(candidate,work.project,work.conclusion);
      return !best||result.points*best.result.total>best.result.points*result.total?{result,index,task}:best;
    },null);
  }

  function comparable(base,candidate) {
    return taskKey(base)===taskKey(candidate)&&base.criteria.length===candidate.criteria.length
      && base.criteria.every((rule,i) => rule.type===candidate.criteria[i].type &&
        rule.points===candidate.criteria[i].points && rule.label===candidate.criteria[i].label)
      && ['excellent','good','pass'].every(key=>base.scale[key]===candidate.scale[key]);
  }

  function diffs(before,after) {
    const criteria=before.rows.map((rule,i)=>[rule,after.rows[i]]).filter(([a,b])=>b&&a.type===b.type);
    return {
      resolved:criteria.filter(([a,b])=>a.passed===false&&b.passed===true).map(([,rule])=>rule.name),
      regressed:criteria.filter(([a,b])=>a.passed===true&&b.passed===false).map(([,rule])=>rule.name)
    };
  }

  function strongQuestions(result,work) {
    const geometric=result.rows.find(rule=>rule.passed!==null&&['diameter','center','wall','volume','x','y','z','outline','holes'].includes(rule.type));
    const operations=work.project.modelFeatures||[];
    const featureNames={
      'face-cut':'выреза','face-boss':'выступа','round':'скругления','edge-round':'скругления','edge-bevel':'фаски','loft':'перехода по сечениям',
      'shell':'оболочки','bend':'сгиба','linear-pattern':'линейного массива','circular-pattern':'кругового массива','revolve':'вращения'
    };
    const named=operations.map(item=>featureNames[item.type]).find(Boolean);
    return [
      named?`Почему вы выбрали построение ${named} и какую часть детали оно меняет?`:
        'Как вы выбрали исходный контур и какие два размера определяют его форму?',
      geometric?`Как вы проверили критерий «${geometric.name.toLocaleLowerCase('ru-RU')}»? Покажите на чертеже точки замера.`:
        'Какую проверку вы провели, чтобы убедиться, что модель соответствует чертежу?',
      geometric?.passed===false?'Какой первый шаг позволит исправить этот результат?':
        'Какое изменение сделает вашу деталь понятнее на чертеже или удобнее в сборке?'
    ];
  }
  const store = {tasks:new Map(),works:new Map(),alternatives:new Map(),feedback:new Map(),scores:new Map()};
  function resolveTask(school,work) {
    return store.tasks.get(workKey(work))||school.builtIn(work.taskId,work.variant);
  }
  function getGrade(school,work) {
    if (!store.scores.has(work.id)) {
      const task=resolveTask(school,work);
      const grade=gradeBest(school,task,store.alternatives.get(workKey(work))||[],work);
      grade.result.mesh=null;
      store.scores.set(work.id,grade);
    }
    return store.scores.get(work.id);
  }
  function registerFile(file,school,app) {
    if (file?.kind==='lab-task') {
      const task=school.validateTask(file);
      const key=taskKey(task);
      const alternatives=store.alternatives.get(key)||[];
      store.alternatives.set(key,alternatives.filter(candidate=>comparable(task,candidate)));
      store.tasks.set(key,task);
      store.scores.clear();
      return;
    }
    const feedback=file?.kind==='lab-feedback'&&file.version===1;
    const work=validateWork(feedback?file.work:file,school,app);
    if (feedback) {
      const comments=Array.isArray(file.comments)?file.comments.slice(0,35):[];
      store.feedback.set(work.id,{note:blank(file.note).slice(0,1200),comments:comments.map(item=>blank(item?.text).slice(0,300)).filter(Boolean)});
    }
    store.works.set(work.id,work);
    store.scores.delete(work.id);
  }
  async function read(file) {
    if (file.size>15*1024*1024) throw new Error('Поддерживается JSON до 15 МБ.');
    try {return JSON.parse(await file.text());}
    catch {throw new Error('Файл не содержит корректный JSON.');}
  }
  function showPlans() {
    try {
      const saved=JSON.parse(localStorage.getItem('cad-teacher-plan')||'null');
      if (saved&&typeof saved==='object'&&Array.isArray(saved.phases)&&saved.phases.length===phases.length) return saved;
    } catch {}
    return {name:'Урок инженерного черчения',phases:phases.map(phase=>({...phase}))};
  }

  const svgNS='http://www.w3.org/2000/svg';
  function picture(school,segments,label,dashed=[]) {
    const svg=document.createElementNS(svgNS,'svg');
    const all=segments.concat(dashed);
    const bounds=school.segmentBounds(all);
    const set=(node,attrs)=>Object.entries(attrs).forEach(([key,value])=>node.setAttribute(key,String(value)));
    const [x,y,right,bottom]=all.length?bounds:[0,0,16,9];
    const padding=Math.max(1,Math.max(right-x,bottom-y)/15);
    set(svg,{viewBox:[x-padding,y-padding,right-x+2*padding,bottom-y+2*padding].join(' '),
      width:220,height:150,role:'img','aria-label':label,xmlns:svgNS});
    for (const [pieces,isDashed] of [[segments,false],[dashed,true]]) {
      if (!pieces.length) continue;
      const path=document.createElementNS(svgNS,'path');
      set(path,{d:pieces.map(([[a,b],[c,d]])=>`M${a} ${b}L${c} ${d}`).join(' '),
        fill:'none',stroke:'#263d53','stroke-width':1.4,'vector-effect':'non-scaling-stroke'});
      if (isDashed) path.setAttribute('stroke-dasharray','4 3');
      svg.append(path);
    }
    return svg;
  }
  function workbookDocument(title, pages) {
    const doc=document.implementation.createHTMLDocument(title);
    doc.documentElement.lang='ru';
    const meta=doc.createElement('meta');
    meta.setAttribute('charset','utf-8');
    doc.head.prepend(meta);
    const css=doc.createElement('style');
    css.textContent=`@page{size:A4 portrait;margin:14mm}body{color:#122b45;font:15px system-ui}
      h1{font-size:25px;margin:0 0 4mm}h2{font-size:17px}section.page{break-after:page;min-height:240mm}
      section.page:last-child{break-after:auto}svg{width:55mm;height:48mm;vertical-align:middle}
      .figures{display:flex;flex-wrap:wrap;gap:4mm}figure{margin:0}.grid{width:100%;height:143mm}
      .grid line{stroke:#afc1d0;stroke-width:.18}td,th{border:1px solid #9aaab8;padding:2mm}
      table{border-collapse:collapse;width:100%}.answers{break-after:page}p{white-space:pre-wrap}`;
    doc.head.append(css);
    doc.body.append(...pages);
    return '<!DOCTYPE html>\n'+doc.documentElement.outerHTML;
  }
  function gridPaper() {
    const grid=document.createElementNS(svgNS,'svg');
    grid.setAttribute('class','grid');grid.setAttribute('viewBox','0 0 180 140');
    grid.setAttribute('preserveAspectRatio','none');grid.setAttribute('aria-label','Черновик в клетку');
    function line(x1,y1,x2,y2) {
      const item=document.createElementNS(svgNS,'line');
      for (const [key,value] of Object.entries({x1,y1,x2,y2})) item.setAttribute(key,String(value));
      grid.append(item);
    }
    for (let x=0;x<=180;x+=5) line(x,0,x,140);
    for (let y=0;y<=140;y+=5) line(0,y,180,y);
    return grid;
  }
  function nativeExercise(school,type,variant) {
    const topic=topics[type];
    const from=school.builtIn(topic[1],variant);
    const output={...from,id:`review-${type}-${from.variant}`,title:'Повторение · '+topic[0],
      brief:topic[2]+'\n'+from.brief,hints:from.hints.slice(0,2),criteria:from.criteria.filter(rule=>rule.type===type)};
    if (['x','y','z'].includes(type)) {
      const desired=output.criteria[0].value, bad=desired-5;
      const starter=structuredClone(from.starter);
      if (type==='z') starter.modelHeight=bad;
      else {
        const coordinate=type, points=starter.strokes[0].points;
        const base=Math.min(...points.map(point=>point[coordinate]));
        for (const point of points) point[coordinate]=base+(point[coordinate]-base)*bad/desired;
      }
      output.starter=starter;
      output.brief=`${topic[2]} Исправьте размер по ${type.toUpperCase()} до ${desired} мм. Проверьте его в модели.`;
      output.hints=['Выберите нужный габарит на модели и введите требуемое значение.'];
    }
    if (type==='section') {
      const plate=school.builtIn('first',variant).referenceModel;
      output.starter=plate;
      output.referenceModel=plate;
      output.outline=null;
      output.brief='Откройте чертёж А4. На виде сверху проведите линию А–А через ось сквозного отверстия и покажите, где разрез проходит через пустоту.';
      output.hints=['Найдите центр отверстия на виде сверху. Запустите команду «Разрез А–А».'];
      output.criteria=[school.rule('section',1)];
    }
    return school.validateTask(output);
  }

  function mount(body,ui) {
    const school=global.LabTeaching;
    if (!school) throw new Error('Учебный модуль ещё не загружен.');
    const {el,button,app}=ui;
    const p=text=>el('p',text);
    const box=(...nodes)=>{const item=el('div',null,'lab-workbench-actions');item.append(...nodes);return item;};
    const list=items=>{const node=el('ol');node.append(...items.map(text=>el('li',text)));return node;};
    const field=(label,control)=>{const node=el('label');node.append(el('span',label),control);return node;};
    function choose(options) {
      const input=el('select');
      for (const [value,label] of options) {
        const item=el('option',label);item.value=value;input.append(item);
      }
      return input;
    }
    function input(type,value,props={}) {return Object.assign(el('input'),{type,value,...props});}
    function card(title,...nodes) {const node=el('section',null,'lab-workbench-card');node.append(el('h3',title),...nodes);return node;}
    function downloadJSON(data,title) {ui.download(JSON.stringify(data,null,2),title+'.json');}
    function workbook(title,pages) {ui.download(workbookDocument(title,pages),title+'.html','text/html;charset=utf-8');}
    function print(title,pages) {
      const opened=global.open('','_blank');
      if (!opened) {workbook(title,pages);ui.status('Печатное окно недоступно. Сохранён HTML для печати.');return;}
      opened.opener=null;
      opened.document.open();
      opened.document.write(workbookDocument(title,pages));
      opened.document.close();
      opened.focus();
      opened.print();
    }
    function table(headers,rows) {
      const table=el('table'), head=el('thead'),body=el('tbody'),labels=el('tr');
      headers.forEach(label=>{const th=el('th',label);th.scope='col';labels.append(th);});
      head.append(labels);
      for (const row of rows) {
        const tr=el('tr');
        row.forEach(item=>{
          const cell=el('td');
          if (item instanceof Node) cell.append(item);
          else cell.textContent=item;
          tr.append(cell);
        });
        body.append(tr);
      }
      table.append(head,body);
      return table;
    }
    const outlet=el('section');
    const tool=choose(names);
    const file=input('file','',{accept:'.json,application/json',multiple:true}); file.hidden=true;
    const base=box(button('Загрузить задания, работы и отзывы',()=>file.click()),field('Инструмент учителя',tool));
    const imported=p('');
    body.append(base,file,imported,outlet);

    file.addEventListener('change',async()=>{
      const files=Array.from(file.files);file.value='';
      if (files.length>40) {ui.status('Выберите до 40 файлов за один раз.');return;}
      const errors=[];
      for (const source of files) {
        try {registerFile(await read(source),school,app);}
        catch (error) {errors.push(source.name+' — '+error.message);}
      }
      if (!ui.isActive()) return;
      ui.status(errors.join(' · '));
      render();
    });
    tool.addEventListener('change',render);
    function render() {
      imported.textContent=`Во вкладке открыто: заданий ${store.tasks.size}, работ ${store.works.size}, отзывов ${store.feedback.size}.`;
      outlet.replaceChildren();
      switch (tool.value) {
        case 'analysis': analysis();break;
        case 'references': references();break;
        case 'plan': plan();break;
        case 'worksheets': worksheets();break;
        case 'anonymous': anonymous();break;
        case 'revisions': revisions();break;
        case 'defence': defence();break;
        case 'skills': skills();break;
      }
    }

    function usable(works) {
      const valid=[],errors=[];
      for (const work of works) {
        try {valid.push({work,...getGrade(school,work)});}
        catch (error) {errors.push(`${work.taskId}, вариант ${work.variant} — ${error.message}`);}
      }
      return {valid,errors:[...new Set(errors)]};
    }
    function analysis() {
      const works=latest([...store.works.values()]);
      const classes=[...new Set(works.map(work=>work.className))].sort((a,b)=>a.localeCompare(b,'ru'));
      const filter=choose([['','Все классы'],...classes.map(name=>[name,name])]);
      const details=el('div');
      const header=card('Критерии по последним работам',field('Класс',filter),details);
      outlet.append(header);
      function update() {
        const selected=works.filter(work=>!filter.value||work.className===filter.value);
        const {valid,errors}=usable(selected);
        const counted=metrics(valid);
        details.replaceChildren(p(`Проверено работ: ${valid.length} из ${selected.length}.`));
        if (errors.length) details.append(p('Для авторских работ загрузите исходный файл задания.'),list(errors));
        if (!counted.length) return;
        details.append(table(['Критерий','Не выполнен','Всего','Доля ошибок','Упражнение'],counted.map(item=>{
          const type=topics[item.type];
          const practice=type&&item.failed?box(
            button('Практикум по ошибке',()=>downloadJSON(nativeExercise(school,item.type,1),'Повторение — '+type[0])),
            ...(['outline','section','center'].includes(item.type)?[button('Тренировка видов',()=>global.LabExtensions.open('spatial'))]:[])
          ):'—';
          return [item.label,item.failed,item.total,fmt.format(100*item.failed/item.total)+' %',practice];
        })));
      }
      filter.addEventListener('change',update);update();
    }

    const assignments=()=>[...school.list.map(item=>['builtin:'+item.id,item.title]),
      ...[...store.tasks.values()].map(task=>['custom:'+taskKey(task),`${task.title} · вариант ${task.variant}`])];
    function chosenTask(value,variant) {
      const [source,...id]=value.split(':');
      return source==='builtin'?school.builtIn(id[0],variant):store.tasks.get(id.join(':'));
    }
    function references() {
      const picker=choose(assignments()),variant=input('number','1',{min:'1',max:'999',step:'1'});
      const pane=el('div'),altFile=input('file','',{accept:'.json,application/json'});altFile.hidden=true;
      const upload=button('Загрузить дополнительный эталон JSON',()=>altFile.click());
      const snapshot=button('Взять контур текущего листа',()=>{
        const task=selected();
        if (!task.criteria.some(rule=>rule.type==='outline')) throw new Error('У этого задания отсутствует критерий сравнения контура.');
        const segments=school.sketchSegments(app.getState());
        if (!segments.length||segments.length>300) throw new Error('Нужен эскиз на 1–300 отрезков.');
        add({...task,outline:{label:'Дополнительный контур',segments:school.normalizeSegments(segments),dashed:[]}});
      });
      outlet.append(card('Несколько допустимых решений',
        p('Откройте исходное задание и добавьте другой контур или JSON с теми же критериями и баллами. Карта ошибок учитывает лучший зачётный результат.'),
        box(field('Задание',picker),field('Вариант встроенного задания',variant)),box(upload,snapshot),altFile,pane));
      function selected() {return chosenTask(picker.value,variant.valueAsNumber);}
      function add(record,base=selected()) {
        const candidate=school.validateTask(record);
        if (!comparable(base,candidate)) throw new Error('Эталон должен совпадать по заданию, варианту, типам критериев, баллам и шкале.');
        const key=taskKey(base),existing=store.alternatives.get(key)||[];
        if (existing.length>=5) throw new Error('Для одного задания доступно до пяти дополнительных решений.');
        store.alternatives.set(key,[...existing,candidate]);
        store.scores.clear();
        sync();
      }
      altFile.addEventListener('change',async()=>{
        const source=altFile.files[0];altFile.value='';
        if (!source) return;
        try {const base=selected();add(await read(source),base);}
        catch (error) {ui.status(error.message);}
      });
      function sync() {
        try {
          const key=taskKey(selected()),entries=store.alternatives.get(key)||[];
          pane.replaceChildren(p(`Дополнительных решений для этого варианта: ${entries.length}.`));
          entries.forEach((entry,index)=>pane.append(box(
            p(`Вариант решения ${index+2} · ${entry.outline?.label||entry.title}`),
            button('Удалить',()=>{
              store.alternatives.set(key,entries.filter((_,i)=>i!==index));
              store.scores.clear();sync();
            })
          )));
        } catch (error) {pane.replaceChildren(p(error.message));}
      }
      picker.addEventListener('change',sync);variant.addEventListener('change',sync);sync();
    }

    function plan() {
      const saved=showPlans(),name=input('text',saved.name,{maxLength:100});
      const fields=phases.map((item,i)=>({
        title:input('text',blank(saved.phases[i]?.title)||item.title,{maxLength:100}),
        time:input('number',String(saved.phases[i]?.time??item.time),{min:'1',max:'45',step:'1'}),
        outcome:input('text',blank(saved.phases[i]?.outcome)||item.outcome,{maxLength:300})
      }));
      const total=p('');
      const minutes=()=>fields.reduce((sum,item)=>sum+(item.time.valueAsNumber||0),0);
      function sync() {total.textContent=`Распределено ${minutes()} из 45 минут.`;}
      const draft=()=>({name:blank(name.value),phases:fields.map(item=>({
        title:blank(item.title.value),time:item.time.valueAsNumber,outcome:blank(item.outcome.value)}))});
      function checked() {
        const value=draft();
        if (!value.name||minutes()!==45||value.phases.some(item=>!item.title||!item.outcome||!Number.isInteger(item.time)||item.time<1)) {
          throw new Error('Заполните этапы, ожидаемые результаты и ровно 45 минут.');
        }
        return value;
      }
      outlet.append(card('План урока',field('Тема',name),
        ...fields.map((item,i)=>box(field(`Этап ${i+1}`,item.title),field('Минуты',item.time),field('Результат этапа',item.outcome))),total,
        box(button('Сохранить план',()=>{
          localStorage.setItem('cad-teacher-plan',JSON.stringify(checked()));
          ui.status('План урока сохранён в браузере.');
        }),button('Скачать лист урока',()=>{
          const value=checked();
          const page=el('section');page.append(el('h1',value.name),table(['Этап','Время','Ожидаемый результат'],
            value.phases.map(item=>[item.title,item.time+' мин',item.outcome])));
          workbook('План урока', [page]);
        }))));
      fields.forEach(item=>item.time.addEventListener('input',sync));sync();
    }

    function worksheets() {
      const picker=choose(assignments()),start=input('number','1',{min:'1',max:'999',step:'1'}),
        count=input('number','12',{min:'1',max:'40',step:'1'}),mode=input('checkbox','',{checked:true});
      function pages(answers) {
        const builtIn=picker.value.startsWith('builtin:');
        if (builtIn&&(![start,count].every(control=>control.checkValidity()&&control.value)||
          start.valueAsNumber+count.valueAsNumber-1>999)) throw new Error('Используйте варианты 1–999. За один раз доступно до 40 листов.');
        const tasks=builtIn?Array.from({length:count.valueAsNumber},(_,i)=>chosenTask(picker.value,start.valueAsNumber+i)):
          [chosenTask(picker.value)];
        return tasks.map(task=>{
          const page=el('section',null,'page');
          page.append(el('h1',task.title),p('Вариант '+task.variant));
          if (answers) {
            const criteria=task.criteria.map(rule=>{
              if (rule.type==='manual') return [rule.label||school.types[rule.type][0],'Ручная проверка',rule.points];
              const [,unit]=school.types[rule.type];
              const ruleText=(rule.operator==='min'?'≥ ':rule.operator==='max'?'≤ ':'')+
                fmt.format(rule.value)+(rule.tolerance?' ± '+fmt.format(rule.tolerance):'')+(unit?' '+unit:'');
              return [rule.label||school.types[rule.type][0],ruleText,rule.points];
            });
            page.append(table(['Критерий','Ожидаемый результат','Баллы'],criteria));
            if (task.outline?.segments.length) page.append(picture(school,task.outline.segments,task.outline.label));
            if (task.referenceModel) {
              const segments=school.sketchSegments(task.referenceModel);
              if (segments.length) page.append(picture(school,segments,'Эталонный профиль'));
            }
            return page;
          }
          page.append(p('Ученик ________________________   Класс _______'),p(task.brief));
          if (task.reference.length) {
            const figures=el('div',null,'figures');
            for (const diagram of task.reference) {
              const figure=el('figure');
              const view=picture(school,diagram.segments,diagram.label,diagram.dashed);
              figure.append(view,el('figcaption',diagram.label));figures.append(figure);
            }
            page.append(figures);
          }
          if (mode.checked) page.append(gridPaper());
          return page;
        });
      }
      function sync() {start.disabled=count.disabled=picker.value.startsWith('custom:');}
      outlet.append(card('Варианты и ответы для учителя',
        box(field('Задание',picker),field('С первого варианта',start),field('Число листов встроенного задания',count),field('Черновик в клетку',mode)),
        box(button('Скачать листы заданий',()=>workbook('Задания для класса',pages(false))),
          button('Скачать ответы',()=>workbook('Ответы для учителя',pages(true))),
          button('Печатать задания',()=>print('Задания для класса',pages(false))),
          button('Печатать ответы',()=>print('Ответы для учителя',pages(true))))));
      picker.addEventListener('change',sync);sync();
    }

    function anonymous() {
      const works=latest([...store.works.values()]);
      if (works.length<2) {outlet.append(p('Загрузите две работы для сравнения.'));return;}
      const options=works.map((work,i)=>[work.id,`Работа ${i+1} · вариант ${work.variant}`]);
      const left=choose(options),right=choose(options),preview=el('div');
      right.value=options[1][0];
      function comparison() {
        if (left.value===right.value) throw new Error('Выберите две разные работы.');
        const plots=[left,right].map((picker,index)=>{
          const work=store.works.get(picker.value);
          const view=el('figure');
          const segments=school.sketchSegments(work.project);
          view.append(picture(school,segments,`Профиль работы ${index?'Б':'А'}`),el('figcaption',`Работа ${index?'Б':'А'}`));
          return view;
        });
        return box(...plots);
      }
      function sync() {
        try {preview.replaceChildren(comparison());}
        catch (error) {preview.replaceChildren(p(error.message));}
      }
      function packet(index) {
        const page=el('section');
        const gallery=comparison();
        const chosen=gallery.children[index];gallery.replaceChildren(chosen);
        page.append(el('h1','Взаимная проверка чертежа'),gallery,list(reviewQuestions));
        return page;
      }
      outlet.append(card('Анонимные работы у доски',box(field('Работа слева',left),field('Работа справа',right)),preview,
        box(button('Лист рецензии на работу А',()=>workbook('Рецензия — работа А',[packet(0)])),
          button('Лист рецензии на работу Б',()=>workbook('Рецензия — работа Б',[packet(1)])))));
      left.addEventListener('change',sync);right.addEventListener('change',sync);sync();
    }

    function revisions() {
      const groups=new Map();
      for (const work of store.works.values()) {
        const key=latestKey(work);
        if (!groups.has(key)) groups.set(key,[]);
        groups.get(key).push(work);
      }
      const history=new Map([...groups].filter(([,works])=>works.length>1).map(([key,works])=>[key,
        works.sort((a,b)=>a.created.localeCompare(b.created))]));
      if (!history.size) {outlet.append(p('Загрузите две сдачи одного ученика по одному заданию. Отзыв добавит замечания к нужной версии.'));return;}
      const picker=choose([...history].map(([key,works])=>[key,`${works[0].className} · ${works[0].learner} · ${works[0].taskId} · вариант ${works[0].variant}`]));
      const panel=el('div');
      function sync() {
        const works=history.get(picker.value);
        const timeline=el('ol');
        works.forEach((work,i)=>{
          const previous=works[i-1],feedback=store.feedback.get(work.id);
          const entry=el('li');
          entry.append(el('strong',`Сдача ${i+1}${work.created?' · '+new Date(work.created).toLocaleString('ru-RU'):''}`));
          if (feedback) entry.append(p(feedback.note),list(feedback.comments));
          entry.append(picture(school,school.sketchSegments(work.project),`Эскиз сдачи ${i+1}`));
          if (previous) {
            try {
              const delta=diffs(getGrade(school,previous).result,getGrade(school,work).result);
              entry.append(p('Исправлено: '+(delta.resolved.join(', ')||'—')),p('Требует повторной проверки: '+(delta.regressed.join(', ')||'—')));
            } catch (error) {entry.append(p(error.message));}
          }
          timeline.append(entry);
        });
        panel.replaceChildren(timeline);
      }
      outlet.append(card('Замечание, правка, новая сдача',field('Ученик и задание',picker),panel));
      picker.addEventListener('change',sync);sync();
    }

    function defence() {
      const works=latest([...store.works.values()]);
      if (!works.length) {outlet.append(p('Загрузите работу ученика.'));return;}
      const picker=choose(works.map(work=>[work.id,`${work.className} · ${work.learner} · вариант ${work.variant}`]));
      const questions=el('div');
      function sync() {
        const work=store.works.get(picker.value);
        let result;
        try {result=getGrade(school,work).result;}
        catch {result={rows:[]};}
        questions.replaceChildren(list(strongQuestions(result,work)));
      }
      outlet.append(card('Три вопроса для защиты',field('Работа',picker),questions));
      picker.addEventListener('change',sync);sync();
    }

    function skills() {
      const works=latest([...store.works.values()]);
      if (!works.length) {outlet.append(p('Загрузите работы, чтобы собрать портфолио навыков.'));return;}
      const students=new Map(works.map(work=>[person(work),`${work.className} · ${work.learner}`]));
      const picker=choose(students),report=el('div');
      function sync() {
        const {valid,errors}=usable(works.filter(work=>person(work)===picker.value));
        const learned=new Map();
        for (const entry of valid) {
          const title=`${entry.task.title}, вариант ${entry.work.variant}`;
          const byTopic=new Map();
          for (const row of entry.result.rows) {
            if (!topics[row.type]||row.passed===null) continue;
            const topic=topics[row.type][0];
            byTopic.set(topic,(byTopic.get(topic)??true)&&row.passed);
          }
          for (const [topic,passed] of byTopic) {
            if (!learned.has(topic)) learned.set(topic,[[],[]]);
            learned.get(topic)[Number(!passed)].push(title);
          }
        }
        report.replaceChildren(table(['Навык','Подтверждён работой','Требует проверки'],
          [...learned].map(([name,[passed,failed]])=>[name,passed.join('\n')||'—',failed.join('\n')||'—'])));
        if (errors.length) report.append(list(errors));
      }
      outlet.append(card('Навыки по последним работам',field('Ученик',picker),report));picker.addEventListener('change',sync);sync();
    }
    render();
  }

  const api={latest,metrics,gradeBest,comparable,diffs,strongQuestions,nativeExercise,validateWork,mount};
  global.LabTeacherTools=api;
  global.LabExtensions?.register({id:'teacher',title:'Инструменты учителя',mount});
  if (typeof module==='object'&&module.exports) module.exports=api;
})(typeof window==='undefined'?globalThis:window);
