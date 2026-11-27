/* Interactive informatics tools for the drafting laboratory. */
(function () {
  'use strict';

  const Code = window.LabCodeGeometry;
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const number = new Intl.NumberFormat('ru-RU', {maximumFractionDigits:3});
  const defaultContour = 'X;Y\n-25;-15\n25;-15\n25;5\n0;20\n-25;-15';
  const state = {
    panel:'turtle', turtle:Code.examples.squareCycle, prediction:'', codingExercise:false,
    coordinates:defaultContour, operations:'перенос 18 0\nповорот 90', matrix:'0 2 0 2 0\n2 4 6 4 2\n0 4 8 4 0\n2 4 6 4 2\n0 2 0 2 0',
    initials:'ШК', decode:'010011\n001100', tests:'замкнута\nвысота >= 5\nширина <= 100', parameter:'', variants:''
  };

  function vector(tag, attrs, value) {
    const element = document.createElementNS(svgNamespace, tag);
    for (const [key, v] of Object.entries(attrs)) element.setAttribute(key, String(v));
    if (value !== undefined) element.textContent = value;
    return element;
  }

  function drawPlot(plot, series, fallback = 50) {
    const points = series.flatMap(([paths]) => paths.flat());
    const x = Math.max(fallback, ...points.map(point => Math.abs(point[0]) + 8));
    const y = Math.max(fallback*.65, ...points.map(point => Math.abs(point[1]) + 8));
    const divider = Math.max(5, 5*Math.ceil(Math.max(x,y)/35));
    const font = Math.min(x,y)*.085;
    plot.setAttribute('viewBox', `${-x} ${-y} ${x*2} ${y*2}`);
    plot.replaceChildren();
    for (let px = -Math.floor(x/divider)*divider; px < x; px += divider) {
      plot.append(vector('line',{x1:px,y1:-y,x2:px,y2:y,stroke:'currentColor','stroke-opacity':px ? .13 : .55,'vector-effect':'non-scaling-stroke'}));
    }
    for (let py = -Math.floor(y/divider)*divider; py < y; py += divider) {
      plot.append(vector('line',{x1:-x,y1:py,x2:x,y2:py,stroke:'currentColor','stroke-opacity':py ? .13 : .55,'vector-effect':'non-scaling-stroke'}));
    }
    const axes = vector('g',{fill:'currentColor','font-size':font});
    axes.append(vector('text',{x:x-font*1.2,y:-font*.3},'X'),vector('text',{x:font*.4,y:-y+font*1.1},'Y'),vector('text',{x:font*.4,y:font*1.1},'0'));
    plot.append(axes);
    for (const [paths,color,dash] of series) {
      for (const path of paths) {
        if (path.length === 1) {
          plot.append(vector('circle',{cx:path[0][0],cy:-path[0][1],r:font*.42,fill:color}));
          continue;
        }
        plot.append(vector('polyline',{points:path.map(([px,py])=>`${px},${-py}`).join(' '),fill:'none',stroke:color,
          'stroke-width':2.5,'stroke-linejoin':'round','stroke-linecap':'round','stroke-dasharray':dash?'6 4':'none','vector-effect':'non-scaling-stroke'}));
      }
    }
  }

  function plotElement(name) {
    return vector('svg',{class:'lab-workbench-preview',height:240,width:'100%',role:'img','aria-label':name});
  }

  function cellPlot(plot,matrix,binary=false) {
    const rows = matrix.length, columns = matrix[0].length, size = 24;
    plot.setAttribute('viewBox', `0 0 ${columns*size+2} ${rows*size+2}`);
    plot.replaceChildren();
    const max = Math.max(1,...matrix.flat());
    matrix.forEach((row,y)=>row.forEach((height,x)=>{
      const level = 96-height/max*56;
      const rect = vector('rect',{x:x*size+1,y:y*size+1,width:size-2,height:size-2,rx:1.5,fill:`hsl(198 55% ${level}%)`,stroke:'#51859b','stroke-width':.55});
      const label = vector('text',{x:x*size+size/2,y:y*size+size*.66,'text-anchor':'middle','font-size':8,fill:level<55?'white':'#193647'},binary?number.format(height>0?1:0):number.format(height));
      plot.append(rect,label);
    }));
  }

  function mount(page, ui) {
    const el = ui.el;
    const app = ui.app;
    const tabs = el('nav',null,'lab-workbench-actions'); tabs.setAttribute('aria-label','Инструменты CAD и информатики');
    const content = el('div',null,'lab-workbench-grid');
    page.append(tabs,content);

    const card = title => {
      const article = el('section',null,'lab-workbench-card');
      article.append(el('h3',title)); content.append(article);return article;
    };
    function area(parent,title,key,rows=6) {
      const control=el('textarea'); control.rows=rows; control.spellcheck=false;
      control.value=state[key]; control.setAttribute('aria-label',title);
      control.addEventListener('input',()=>{state[key]=control.value;});
      parent.append(el('label',title)); parent.lastElementChild.append(control);
      return control;
    }
    function input(parent,title,kind,value) {
      const control=el('input'); control.type=kind; control.value=value;
      parent.append(el('label',title));parent.lastElementChild.append(control);
      return control;
    }
    function actions(parent,...buttons) {
      const row=el('div',null,'lab-workbench-actions');row.append(...buttons);parent.append(row);
      return row;
    }
    const action=ui.button;
    function toSketch(paths, build=false) {
      if (!paths.length) throw new Error('Сначала постройте контур.');
      const viewport=app.getViewport();
      const shapes=Code.sketchPaths(paths,{x:viewport.width/2,y:viewport.height/2});
      if (shapes.some(shape=>shape.points.some(p=>p.x<0 || p.y<0 || p.x>viewport.width || p.y>viewport.height))) {
        throw new Error('Уменьшите координаты. Часть контура выходит за границы листа.');
      }
      if (build) {
        const analysis=window.LabExtrusion.analyze([...app.getModelStrokes(),...shapes],{tolerance:8});
        if (!analysis.ok) throw new Error(analysis.errors[0]?.message || 'Для объёма замкните контуры.');
      }
      if (!app.applySketchUpgrade({add:shapes})) throw new Error(app.getSketchUpgradeError() || 'Выберите видимый разблокированный слой.');
      ui.close();
      app.setModelOpen(build);
      if (!build) app.toast('Контуры добавлены на лист.');
    }

    function turtle() {
      const editor=card('Черепашка'), view=card('Результат и прогноз');
      editor.append(el('p','Одна команда на строку. Начало координат в центре, угол 0° направлен вправо. После «повтор N» поставьте «конец». Знак # начинает комментарий.'));
      const source=area(editor,'Программа', 'turtle', 10);
      const task=el('p');
      const details=el('details'); details.append(el('summary','Команды'),el('p','вперёд N, налево A, направо A, точка X Y, поднять, опустить, замкнуть, повтор N, конец'));
      const predicted=area(view,'Прогноз, строки X Y','prediction',5);
      predicted.placeholder='-20 -20\n20 -20\n20 20';
      view.append(el('p','Указывайте вершины на сетке или вводите их вручную. Пустая строка начинает новый путь.'));
      const plot=plotElement('График черепашки. Оси X и Y в миллиметрах.');
      const report=el('p');report.setAttribute('role','status');view.append(plot,report);
      let result;
      function render(keepReport = false) {
        let paths=[];
        if (predicted.value.trim()) {
          try { paths=Code.readCoordinates(predicted.value); }
          catch { paths=predicted.value.trim().split('\n').filter(Boolean).map(line=>line.split(/\s+/).slice(0,2).map(Number)).filter(pair=>pair.length===2 && pair.every(Number.isFinite)).map(pair=>[pair]); }
        }
        drawPlot(plot,[[result?.paths || [],'#268a83'],[paths,'#cc673c',true]]);
        if (!keepReport) report.textContent='';
      }
      function choose(name) {
        state.codingExercise = name==='bugProgram';
        source.value=state.turtle=Code.examples[name]; result=undefined;
        task.textContent=state.codingExercise?'Исправьте одну координату в строке, задающей начальную точку отверстия. Требуемый центр отверстия (17, 0) мм.':'Запустите развёрнутый квадрат и вариант с циклом. Сравните число строк и получившийся контур.';
        render();
      }
      function run() {
        result=Code.runTurtle(source.value);
        render(true);
        let message=`Строк программы ${result.lines}. Путей ${result.paths.length}.`;
        if (predicted.value.trim()) {
          const difference=Code.polylineDifference(result.paths,Code.readCoordinates(predicted.value));
          if (difference.matches) message+=' Прогноз совпал.';
          else if (Number.isFinite(difference.separation)) {
            message+=` Отклонение контрольных точек до ${number.format(difference.separation)} мм. Разница длин ${number.format(difference.lengthDifference)} мм.`;
          } else message+=' Прогноз и программа должны содержать линии.';
        }
        if (state.codingExercise) {
          const reference=Code.runTurtle(Code.examples.correctProgram);
          message+=Code.polylineDifference(reference.paths,result.paths).matches?' Отверстие на заданном месте.':' Проверьте центр отверстия.';
        }
        report.textContent=message;
      }
      source.addEventListener('input',()=>{result=undefined;render();});
      predicted.addEventListener('input',()=>render());
      plot.addEventListener('click',event=>{
        const matrix=plot.getScreenCTM?.();
        if (!matrix) return;
        const point=plot.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
        const local=point.matrixTransform(matrix.inverse());
        predicted.value=state.prediction=`${predicted.value.trimEnd()}\n${Math.round(local.x)} ${Math.round(-local.y)}`.trimStart();
        render();
      });
      actions(editor,action('Запустить',run),action('Добавить на чертёж',()=>toSketch(Code.runTurtle(source.value).paths)),
        action('Построить объём',()=>toSketch(Code.runTurtle(source.value).paths,true)));
      actions(editor,action('Квадрат с циклом',()=>choose('squareCycle')),action('Квадрат по шагам',()=>choose('squareExpanded')),action('Исправить ошибку',()=>choose('bugProgram')));
      editor.append(task,details);
      actions(view,action('Очистить прогноз',()=>{predicted.value=state.prediction='';render();}));
      task.textContent=state.codingExercise?'Исправьте начальную точку отверстия. Требуемый центр (17, 0) мм.':'Сравните квадрат по шагам и вариант с циклом.';
      render();
    }

    function coordinates(withTransforms) {
      const editor=card(withTransforms?'Порядок преобразований':'Координаты контура'), preview=card('Предпросмотр');
      editor.append(el('p','В каждой строке две координаты в миллиметрах. CSV, TSV и вставка из таблицы поддерживаются. Пустая строка начинает новый путь. Для замкнутого контура повторите первую точку.'));
      const source=area(editor,'Таблица X и Y','coordinates',7);
      const upload=input(editor,'Открыть таблицу','file','');upload.accept='.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain';
      const read=withTransforms?area(editor,'Преобразования','operations',4):null;
      if (read) editor.append(el('p','Используйте команды «перенос 18 0», «поворот 90» и «отражение X». Поворот выполняется вокруг начала координат.'));
      const plot=plotElement(withTransforms?'Исходный и преобразованный контур':'Координаты на чертеже');preview.append(plot);
      const report=el('p');report.setAttribute('role','status');preview.append(report);
      const paths=()=>Code.readCoordinates(source.value);
      function run() {
        const original=paths();
        const result=read?Code.transform(original,read.value):original;
        const series=read?[[original,'#738295',true],[result,'#268a83']]:[[result,'#268a83']];
        drawPlot(plot,series);
        const first=result[0][0];
        report.textContent=`Контуров ${result.length}. Первая точка (${number.format(first[0])}, ${number.format(first[1])}) мм.`;
        return result;
      }
      function runSafely() {try{run();}catch(error){drawPlot(plot,[]);report.textContent=error.message;}}
      upload.addEventListener('change',async()=>{
        const item=upload.files?.[0];if(!item)return;
        try {
          if (item.size>80000) throw new Error('Размер таблицы должен быть до 80 КБ.');
          const data=await item.text();Code.readCoordinates(data);
          source.value=state.coordinates=data;run();
        } catch(error){ui.status(error.message);} finally{upload.value='';}
      });
      source.addEventListener('input',runSafely);
      read?.addEventListener('input',runSafely);
      actions(editor,action('Добавить на чертёж',()=>toSketch(run())),...(read?[action('Обратить порядок',()=>{
        read.value=state.operations=read.value.split('\n').reverse().join('\n');run();
      })]:[]));
      runSafely();
    }

    function relief(binary) {
      const editor=card(binary?'Буквы в двоичном коде':'Матрица высот'), preview=card('Рельеф');
      const source=binary?input(editor,'Буквы или инициалы','text',state.initials):area(editor,'Высоты в миллиметрах','matrix',8);
      if (binary) {
        source.maxLength=20;
        source.addEventListener('input',()=>{state.initials=source.value;});
        editor.append(el('p','Каждой русской букве соответствует её номер в алфавите с Ё. Записываем номер шестью битами. Единица даёт выступ высотой 2 мм.'));
      } else editor.append(el('p','Введите матрицу до 12 × 12. Каждое значение задаёт высоту одной клетки над общей подложкой.'));
      const pitch=input(editor,'Шаг клеток, мм','number','7'),base=input(editor,'Толщина подложки, мм','number','2');
      pitch.min='3';pitch.max='25';base.min='1';base.max='15';
      const plot=plotElement('Карта высот клеток');preview.append(plot);
      const visualInfo=el('p');preview.append(visualInfo);
      function matrix() {return binary?Code.toBinary(source.value).map(row=>row.map(bit=>bit*2)):Code.readMatrix(source.value);}
      function render() {
        const data=matrix();
        cellPlot(plot,data,binary);
        visualInfo.textContent=`${data[0].length} × ${data.length} клеток. Высота выступов до ${number.format(Math.max(...data.flat()))} мм.`;
        return data;
      }
      function renderSafely() {try{render();}catch(error){plot.replaceChildren();visualInfo.textContent=error.message;}}
      source.addEventListener('input',renderSafely);
      function mesh() {return Code.reliefMesh(render(),Number(pitch.value),Number(base.value));}
      function save() {
        const result=mesh();
        if (!result.stats.closed) throw new Error('Модель подготовлена с разрывом. Проверьте значения.');
        const blob=window.LabModelExport.stl(result);
        ui.download(blob,binary?'binary-ornament.stl':'matrix-relief.stl','model/stl');
        ui.status(`Замкнутая модель объёмом ${number.format(result.stats.volumeMm3)} мм³.`);
      }
      actions(editor,action('Скачать рельеф STL',save),action('Добавить рельеф в сборку',()=>{
        const seed=app.getProjectionMesh()?.bodies?.[0];
        if (!seed) throw new Error('Создайте замкнутый контур и построенную деталь для вставки рельефа.');
        const result=mesh();
        if (!result.stats.closed) throw new Error('В рельефе есть разрыв.');
        if (result.stats.triangles>2000) throw new Error('Для вставки сократите матрицу до 8 × 8 или скачайте рельеф в STL.');
        const vertices=Array.from(result.positions);
        const offset=[seed.bounds.max[0]+6-result.bounds.min[0],seed.bounds.min[1]-result.bounds.min[1],-result.bounds.min[2]];
        if (!app.addModelFeature({type:'import-body',target:seed.id,title:binary?'Двоичный орнамент':'Матричный рельеф',vertices,offset})) {
          throw new Error(app.getModelError() || 'Импорт не выполнен.');
        }
        ui.close();app.setModelOpen(true);
      }));
      if (binary) {
        const decoded=area(preview,'Шесть бит на букву','decode',4);
        const answer=el('p');answer.setAttribute('role','status');preview.append(answer);
        actions(preview,action('Расшифровать',()=>{answer.textContent=Code.fromBinary(decoded.value);}),action('Скопировать код в поле',()=>{
          decoded.value=state.decode=Code.toBinary(source.value).map(row=>row.join('')).join('\n');answer.textContent='';
        }));
      }
      renderSafely();
    }

    function graph() {
      const part=card('Граф сборки');
      part.append(el('p','Детали показаны вершинами, активные стыковки показаны рёбрами. Замкнутые цепочки вычисляются по соединениям текущего проекта.'));
      const viz=plotElement('Граф связей деталей'), info=el('div');part.append(viz,info);
      function render() {
        const mesh=app.getProjectionMesh();
        if (!mesh?.bodies?.length) throw new Error('Откройте проект со сборкой.');
        const {nodes,links,cycles}=Code.assemblyGraph(mesh.bodies,app.getState().modelFeatures);
        if (nodes.length>80) throw new Error('Для читаемого графа оставьте до 80 деталей.');
        const positions=new Map(nodes.map((node,index)=>{
          const angle=2*Math.PI*index/nodes.length-Math.PI/2;
          return [node.id,[150+100*Math.cos(angle),130+100*Math.sin(angle)]];
        }));
        viz.setAttribute('viewBox','0 0 300 260');viz.replaceChildren();
        const index=new Map(nodes.map((node,i)=>[node.id,i+1]));
        for (const link of links) {
          const [x1,y1]=positions.get(link.target),[x2,y2]=positions.get(link.tool);
          viz.append(vector('line',{x1,y1,x2,y2,stroke:'#6d819b','stroke-width':1.4}));
        }
        for (const [key,[x,y]] of positions) {
          viz.append(vector('circle',{cx:x,cy:y,r:Math.max(4,Math.min(12,360/nodes.length)),fill:'#176d70'}));
          viz.append(vector('text',{x,y:y+2.8,'text-anchor':'middle','font-size':Math.max(5,Math.min(9,480/nodes.length)),fill:'white'},index.get(key)));
        }
        const label=new Map(nodes.map(node=>[node.id,node.label]));
        const list=el('ol');nodes.forEach(node=>list.append(el('li',node.label)));
        info.replaceChildren(el('p',`Деталей ${nodes.length}. Стыковок ${links.length}. Найдено независимых циклов ${cycles.length}.`),list);
        for (const cycle of cycles) info.append(el('p',cycle.map(id=>label.get(id)).join(' → ')));
      }
      actions(part,action('Построить граф',render));
    }

    function tests() {
      const part=card('Условия для текущей модели'), summary=card('Результаты');
      part.append(el('p','Укажите свойство, знак сравнения и значение в миллиметрах, кубических миллиметрах или штуках. Доступны ширина, глубина, высота, объём, тел, отверстий и замкнута.'));
      const checks=area(part,'Условия','tests',7);
      const snapshot=app.getState();
      const variables=snapshot.sketchUpgrade?.variables || [];
      const parameter=el('select');
      const current=el('option','Текущая модель');current.value='';parameter.append(current);
      for (const row of variables){const option=el('option',row.name);option.value=row.name;parameter.append(option);}
      parameter.value=variables.some(row=>row.name===state.parameter)?state.parameter:'';
      parameter.addEventListener('change',()=>{state.parameter=parameter.value;});
      const label=el('label','Параметр для перебора');label.append(parameter);part.append(label);
      const variants=area(part,'Значения параметра, по одному на строку','variants',4);
      variants.placeholder='30\n40\n50';
      function run() {
        summary.replaceChildren(el('h3','Результаты'));
        const conditions=Code.readTests(checks.value);
        const values=parameter.value?variants.value.split(/\r?\n/).map(row=>row.trim()).filter(Boolean):[''];
        if (!values.length || values.length>12) throw new Error('Укажите от 1 до 12 значений параметра.');
        const project=app.getState();
        for (const value of values) {
          const group=el('section');group.append(el('h4',value?`${parameter.value} = ${value}`:'Текущая модель'));summary.append(group);
          try {
            let mesh;
            if (value) {
              const next=app.prepareProject({...project,sketchUpgrade:{...project.sketchUpgrade,variables:project.sketchUpgrade.variables.map(item=>
                item.name===parameter.value?{...item,formula:value}:item)}});
              const visible=new Set(next.layers.filter(layer=>layer.visible).map(layer=>layer.id));
              const strokes=next.strokes.filter(shape=>visible.has(shape.layer)&&!shape.construction);
              const analysis=window.LabExtrusion.analyze(strokes,{tolerance:8});
              if (!analysis.ok) throw new Error(analysis.errors[0]?.message || 'Контур не формирует модель.');
              mesh=window.LabSolid.build(analysis,{strokes,height:next.modelHeight,bevel:next.modelBevel,bodies:next.modelBodies,features:next.modelFeatures});
            } else mesh=app.getProjectionMesh();
            const list=el('ul');
            for (const result of Code.testMesh(mesh,conditions)){
              list.append(el('li',`${result.passed?'Выполнено':'Ошибка'} · ${result.title}. Значение ${number.format(result.actual)}.`));
            }
            group.append(list);
          }catch(error){group.append(el('p',error.message));}
        }
      }
      actions(part,action('Проверить',run));
    }

    const modes = [
      ['turtle','Черепашка',turtle], ['coordinates','CSV → эскиз',()=>coordinates(false)], ['transform','Преобразования',()=>coordinates(true)],
      ['matrix','Рельеф из матрицы',()=>relief(false)], ['binary','Двоичный орнамент',()=>relief(true)], ['graph','Граф сборки',graph], ['tests','Проверка модели',tests]
    ];
    const buttons=new Map();
    function render(key) {
      state.panel=key;
      content.replaceChildren();
      for (const [name, button] of buttons) button.setAttribute('aria-pressed',String(key===name));
      modes.find(mode=>mode[0]===key)[2]();
    }
    for (const [key,label] of modes) {
      const button=ui.button(label,()=>render(key)); buttons.set(key,button);tabs.append(button);
    }
    render(state.panel);
  }

  window.LabExtensions.register({id:'cad-code',title:'CAD и информатика',mount});
})();
