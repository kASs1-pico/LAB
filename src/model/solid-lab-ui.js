/* Workbench controls for persisted solid operations and model analysis. */
(function (global) {
  'use strict';
  const G=global.LabSolidLabGeometry,Solid=global.LabSolid,Mesh=global.LabInspectGeometry;
  const Assembly=global.LabAssemblyGeometry,Sketch=global.LabSketchUpgrade;
  const fmt=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3});
  const options=[...Object.entries(G.titles),['plane','Плоскость по трём точкам'],['family','Семейство деталей из таблицы'],
    ['dependencies','Отключение операции'],['thickness','Карта толщины']];
  const featureNames={...G.titles,loft:'Переход по сечениям',fold:'Сгиб',pattern:'Массив',text:'Надпись',workplane:'Выступ на плоскости',
    add:'Выступ',cut:'Карман',union:'Объединение',subtract:'Вычитание',intersect:'Пересечение',mate:'Стыковка',fastener:'Крепёжное отверстие',
    'split-body':'Разделение','mirror-body':'Зеркало','instance-body':'Копия','catalog-body':'Типовая деталь','import-body':'Вставка детали',
    'draft-angle':'Уклон','edge-bevel':'Фаска','edge-round':'Скругление'};
  const labelOf=feature=>featureNames[feature.type]||feature.type;
  const span=(min,max)=>max.map((v,i)=>v-min[i]);
  const showPoint=p=>p.map(value=>fmt.format(value)).join(' / ');
  const toLocal=(body,point)=>Assembly.unplacePoint(body,point).map((value,i)=>value-body.offset[i]);
  const ensure=(condition,message)=>{if(!condition)throw new Error(message);};
  const awaitFrame=()=>new Promise(resolve=>setTimeout(resolve,0));

  function mount(host,ui) {
    const {el,app,button,status}=ui;
    const card=el('section',null,'lab-workbench-card');
    const form=el('form');
    const fields=el('section');
    const result=el('section',null,'lab-workbench-preview');
    const actions=el('div',null,'lab-workbench-actions');
    const controls=el('div',null,'lab-workbench-grid');
    card.append(controls,form,result);
    host.append(card);

    const bodySelect=selectField(controls,'Деталь',[]);
    const mode=selectField(controls,'Операция',options);
    const primary=el('button','Применить');
    primary.type='submit';
    actions.append(primary);
    form.append(fields,actions);
    let revision=0, run;
    function field(parent,label,input){
      const row=el('label');
      row.append(el('span',label),input);
      parent.append(row);
      return input;
    }
    function selectField(parent,label,items){
      const select=el('select');
      choices(select,items);
      return field(parent,label,select);
    }
    function choices(select,items){
      select.replaceChildren(...items.map(([value,name])=>Object.assign(el('option',name),{value})));
    }
    function numeric(label,value,min,max,step='any'){
      const input=Object.assign(el('input'),{type:'number',value:String(value),min:String(min),max:String(max),step:String(step),required:true});
      field(fields,label,input);
      return ()=>input.valueAsNumber;
    }
    function textArea(label,value){
      const control=Object.assign(el('textarea'),{rows:4,value,maxLength:20000,required:true});
      return field(fields,label,control);
    }
    function toggle(label,value=false){
      const input=Object.assign(el('input'),{type:'checkbox',checked:value});
      field(fields,label,input);
      return input;
    }
    function note(text){fields.append(el('p',text));}
    function bodies(){return app.getProjectionMesh()?.bodies||[];}
    function feature(body,spec){
      ensure(!app.isModelEditing(),'Завершите текущий предпросмотр перед добавлением операции.');
      const success=app.addModelFeature({target:body.id,...spec});
      ensure(success,app.getModelError()||'Не удалось построить операцию.');
      ui.close();
      global.LabCAD?.modelMode(true);
    }
    function updateBodies(preferred=bodySelect.value){
      const parts=bodies();
      choices(bodySelect,parts.map(item=>[item.id,item.name]));
      if(parts.some(item=>item.id===preferred))bodySelect.value=preferred;
      bodySelect.disabled=!parts.length;
      render(parts.find(item=>item.id===bodySelect.value));
    }
    function render(body){
      revision++;
      run=null;
      status('');
      fields.replaceChildren();result.replaceChildren();
      primary.textContent='Применить';
      primary.disabled=false;
      const kind=mode.value;
      if(!body&&!['family','dependencies'].includes(kind)){
        note('Начертите и замкните контур, чтобы получить исходную деталь.');
        primary.disabled=true;
        return;
      }
      if(kind==='family'){ setupFamily();return; }
      if(kind==='dependencies'){ setupDependencies(body);return; }
      if(kind==='thickness'){ setupThickness(body);return; }
      const localBounds=localBox(body);
      const center=localBounds.min.map((v,i)=>(v+localBounds.max[i])/2);
      const size=span(localBounds.min,localBounds.max);
      if(kind==='helical-spring'){
        note('Пружина займёт место выбранной детали. Ось проходит через центр её основания.');
        const diameter=numeric('Диаметр осевой линии витка, мм',16,2,300);
        const wire=numeric('Диаметр проволоки, мм',1.2,.2,40);
        const pitch=numeric('Шаг витка, мм',5,.5,100);
        const turns=numeric('Число витков',3,1,8,.5);
        const leftHand=toggle('Левая навивка');
        run=()=>feature(body,{type:kind,diameter:diameter(),wire:wire(),pitch:pitch(),turns:turns(),leftHand:leftHand.checked});
      }else if(kind==='space-sweep'){
        note('Исходный замкнутый эскиз образует поперечное сечение. В каждой строке укажите X Y Z в миллиметрах в локальных координатах детали.');
        const reach=Math.ceil(Math.max(...size,10)*2);
        const source=textArea('Координаты пути',`0 0 0\n${reach} 0 0\n${2*reach} ${reach} ${reach}`);
        run=()=>feature(body,{type:kind,path:G.pointRows(source.value)});
      }else if(kind==='reinforcing-rib'){
        note('Задайте ось на верхней грани. Высота ребра линейно растёт от первой точки ко второй.');
        const [x1,y1,x2,y2]=[numeric('Начало X, мм',rounded(center[0]-size[0]/4),-10000,10000),numeric('Начало Y, мм',rounded(center[1]),-10000,10000),
          numeric('Конец X, мм',rounded(center[0]+size[0]/4),-10000,10000),numeric('Конец Y, мм',rounded(center[1]),-10000,10000)];
        const width=numeric('Толщина ребра, мм',Math.max(.2,rounded(size[1]/10)),.2,100);
        const height=numeric('Высота, мм',Math.max(.2,rounded(size[2]/2)),.2,200);
        run=()=>feature(body,{type:kind,line:[[x1(),y1()],[x2(),y2()]],width:width(),height:height()});
      }else if(kind==='dome'){
        note('Купол строится над выпуклым вытянутым профилем без отверстий.');
        const height=numeric('Высота купола, мм',10,.25,300);
        run=()=>feature(body,{type:kind,height:height()});
      }else if(kind==='multi-shell'){
        note('Для прямоугольного параллелепипеда отметьте стороны, которые должны открыться.');
        const faces=['−X','+X','−Y','+Y','−Z','+Z'].map((axis,i)=>toggle('Открыть '+axis,i===5));
        const thickness=numeric('Толщина стенок, мм',Math.max(.1,rounded(Math.min(2,...size.map(v=>v/6)))),.1,50);
        run=()=>feature(body,{type:kind,faces:faces.flatMap((control,i)=>control.checked?[i]:[]),thickness:thickness()});
      }else if(kind==='edge-round-variable'){
        const edges=bodyEdges(body);
        const edge=selectField(fields,'Наружное ребро',edges.map(([a,b],i)=>[String(i),`${showPoint(a)} → ${showPoint(b)}`]));
        const radius=numeric('Радиус в начале, мм',1,.05,20);
        const radiusEnd=numeric('Радиус в конце, мм',2,.05,20);
        note('Размер плавно изменяется вдоль выпуклого наружного ребра.');
        run=()=>feature(body,{type:kind,edge:edges[Number(edge.value)],radius:radius(),radiusEnd:radiusEnd()});
        if(!edges.length)primary.disabled=true;
      }else if(kind==='plane'){
        note('По трём координатам плоскости постройте прямоугольный выступ. Центр прямоугольника совпадёт с центром выбранного треугольника.');
        const [min,max]=[localBounds.min,localBounds.max];
        const [a,b,c]=[[min[0],min[1],max[2]],[max[0],min[1],max[2]],[max[0],max[1],max[2]]];
        const source=textArea('Три точки X Y Z, мм',[a,b,c].map(p=>p.map(rounded).join(' ')).join('\n'));
        const vertices=bodyVertices(body);
        const list=selectField(fields,'Вставить координаты вершины',[[ '', 'Выберите вершину' ],...vertices.map((p,i)=>[String(i),showPoint(p)])]);
        list.addEventListener('change',()=>{
          if(list.value==='')return;
          source.setRangeText(vertices[Number(list.value)].map(rounded).join(' '),source.selectionStart,source.selectionEnd,'end');
          list.value='';source.focus();
        });
        const width=numeric('Ширина профиля, мм',Math.max(.2,rounded(size[0]/4)),.2,500);
        const length=numeric('Высота профиля, мм',Math.max(.2,rounded(size[1]/4)),.2,500);
        const depth=numeric('Длина вытягивания, мм',4,-500,500);
        const reverse=toggle('Обратить нормаль плоскости');
        run=()=>{
          const points=G.pointRows(source.value);
          ensure(points.length===3,'Нужны ровно три точки плоскости.');
          const plane=G.planeProfile(points,width(),length(),reverse.checked);
          feature(body,{type:'workplane',...plane,depth:depth()});
        };
      }
    }
    function setupFamily(){
      const project=app.getState();
      const settings=project.sketchUpgrade;
      const known=settings.variables.map(v=>v.name);
      note('Через точку с запятой укажите имя варианта, затем значения существующих параметров. Столбец @height задаёт общую высоту вытягивания.');
      if(known.length)note('Параметры проекта · '+known.join(', '));
      const source=textArea('Таблица типоразмеров',`Имя;@height\nНизкая;${Math.max(1,Math.round(project.modelHeight*.8))}\nВысокая;${Math.min(200,Math.round(project.modelHeight*1.2))}`);
      primary.textContent='Построить варианты';
      run=async()=>{
        const current=revision;
        const rows=G.familyRows(source.value,known);
        result.replaceChildren();
        for(const row of rows){
          await awaitFrame();
          if(!ui.isActive()||current!==revision)return;
          const article=el('article',null,'lab-workbench-card');
          article.append(el('h3',row.name));
          try{
            const variables=settings.variables.map(column=>({...column,formula:row.values[column.name]??column.formula}));
            const sketchUpgrade={variables,height:row.values['@height']??settings.height};
            const variant=app.prepareProject({...project,sketchUpgrade,measurementBook:undefined});
            const mesh=projectMesh(variant);
            article.append(el('p',`${showPoint(span(mesh.bounds.min,mesh.bounds.max))} мм · ${fmt.format(mesh.stats.volumeMm3)} мм³`));
            article.append(button('Скачать JSON',()=>ui.download(JSON.stringify(variant,null,2),fileName(row.name)+'.json')));
          }catch(error){article.append(el('p',error.message));}
          result.append(article);
        }
        status(`Проверено вариантов: ${rows.length}.`);
      };
    }
    function setupDependencies(body){
      const project=app.getState();
      const features=project.modelFeatures.filter(item=>!body||item.target===body.id);
      primary.textContent='Проверить отключение';
      if(!features.length){
        note('Для выбранной детали ещё нет операций, которые можно отключить.');
        primary.disabled=true;return;
      }
      const select=selectField(fields,'Операция в истории',features.map((item,i)=>[item.id,`${i+1}. ${labelOf(item)}${item.suppressed?' · отключена':''}`]));
      run=async()=>{
        ensure(!app.isModelEditing(),'Завершите активный предпросмотр.');
        const initial=revision;
        const selected=project.modelFeatures.find(item=>item.id===select.value);
        const index=project.modelFeatures.indexOf(selected);
        const changed={...selected,suppressed:!selected.suppressed};
        const items=project.modelFeatures.map(item=>item.id===selected.id?changed:item);
        result.replaceChildren();
        status('Проверяются последующие шаги…');
        await awaitFrame();
        if(!ui.isActive()||initial!==revision)return;
        const before=projectMesh(project);
        const issues=[];
        const generatedId=Solid.derivedBodyId(selected);
        if(changed.suppressed){
          const references=items.slice(index+1).filter(item=>!item.suppressed&&[item.target,item.tool].includes(generatedId));
          for(const item of references)issues.push(`${labelOf(item)} использует созданную деталь.`);
        }
        let after;
        try{after=projectMesh({...project,modelFeatures:items});}
        catch(error){
          let conflict=selected;
          for(let cursor=index;cursor<items.length;cursor++){
            await awaitFrame();
            if(!ui.isActive()||initial!==revision)return;
            try{projectMesh({...project,modelFeatures:items.slice(0,cursor+1)});}
            catch{conflict=items[cursor];break;}
          }
          issues.push(`${labelOf(conflict)} · ${error.message}`);
        }
        if(after){
          const warnings=after.warnings.filter(warning=>!before.warnings.includes(warning));
          issues.push(...warnings);
          result.append(el('p',`Тела: ${before.bodies.length} → ${after.bodies.length}. Объём: ${fmt.format(before.stats.volumeMm3)} → ${fmt.format(after.stats.volumeMm3)} мм³.`));
          result.append(button(changed.suppressed?'Отключить операцию':'Включить операцию',()=>{
            ensure(!app.isModelEditing(),'Завершите текущий предпросмотр.');
            ensure(JSON.stringify(app.getState().modelFeatures)===JSON.stringify(project.modelFeatures),'История изменилась. Откройте раздел заново.');
            if(!app.previewExistingFeature(selected.id,changed)||!app.commitModelEdit()){
              const error=app.getModelError();app.cancelModelEdit();throw new Error(error||'Не удалось изменить историю.');
            }
            updateBodies();
            status(changed.suppressed?'Операция отключена.':'Операция включена.');
          }));
        }
        if(issues.length){const list=el('ul');list.append(...issues.map(issue=>el('li',issue)));result.append(list);}
        status(issues.length?'Найдены зависимости.':'Проверка истории завершена.');
      };
    }
    function setupThickness(body){
      note('Цвет показывает расстояние от поверхности до противоположной стенки по нормали. Карта строится по выборочным замерам.');
      primary.textContent='Построить карту';
      run=async()=>{
        const version=revision;
        status('Рассчитывается толщина поверхности…');
        await awaitFrame();
        if(!ui.isActive()||version!==revision)return;
        ensure(body.mesh.stats.closed!==false,'Для карты нужна замкнутая деталь.');
        const triangles=Mesh.triangles(body.mesh);
        ensure(triangles.length&&triangles.length<=24000,'Выберите деталь с сеткой до 24 000 треугольников.');
        const samples=Mesh.wallSamples(triangles,Mesh.tree(triangles));
        const dimensions=samples.reduce((range,sample)=>Number.isFinite(sample.distance)
          ?[Math.min(range[0],sample.distance),Math.max(range[1],sample.distance)]:range,[Infinity,-Infinity]);
        ensure(Number.isFinite(dimensions[0]),'Для карты нужна замкнутая деталь.');
        result.replaceChildren();
        const canvas=Object.assign(el('canvas'),{width:680,height:400});
        canvas.style.width='100%';
        canvas.setAttribute('role','img');
        canvas.setAttribute('aria-label',`Карта толщины, от ${fmt.format(dimensions[0])} до ${fmt.format(dimensions[1])} мм`);
        const orbit=Object.assign(el('input'),{type:'range',min:'-180',max:'180',value:'35'});
        const pitch=Object.assign(el('input'),{type:'range',min:'-88',max:'88',value:'32'});
        const [min,max]=dimensions;
        const legend=el('div',null,'lab-workbench-actions');
        const ticks=max-min<.001?[.5]:[0,.25,.5,.75,1];
        for(const tick of ticks){
          const label=el('span',fmt.format(min+(max-min)*tick)+' мм');
          label.style.color='white';label.style.background=heat(tick);label.style.padding='.25rem .45rem';
          legend.append(label);
        }
        result.append(canvas,legend);
        field(result,'Поворот',orbit);field(result,'Наклон',pitch);
        let frame;
        const paint=()=>{
          if(frame)cancelAnimationFrame(frame);
          frame=requestAnimationFrame(()=>{
            if(ui.isActive()&&version===revision)paintMap(canvas,samples,body.bounds,dimensions,orbit.valueAsNumber,pitch.valueAsNumber);
          });
        };
        ui.onCleanup(()=>cancelAnimationFrame(frame));
        orbit.addEventListener('input',paint);pitch.addEventListener('input',paint);paint();
        status(`${samples.length} участков · от ${fmt.format(min)} до ${fmt.format(max)} мм.`);
      };
    }
    mode.addEventListener('change',()=>updateBodies());
    bodySelect.addEventListener('change',()=>updateBodies());
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(!run||!form.reportValidity())return;
      const current=revision;
      primary.disabled=true;
      try{await run();}catch(error){if(current===revision)status(error.message);}
      finally{if(ui.isActive()&&current===revision)primary.disabled=false;}
    });
    updateBodies(global.LabCAD?.getState().selected?.[0]);
  }
  function rounded(value){return Number(value.toFixed(4));}
  function fileName(name){return name.replace(/[^\p{L}\p{N}_-]+/gu,'_')||'variant';}
  function bodyEdges(body){
    const {edges}=body.mesh,items=[];
    for(let i=0;i<edges.length&&items.length<180;i+=6){
      const points=[0,3].map(j=>toLocal(body,Array.from(edges.subarray(i+j,i+j+3))));
      items.push(points);
    }
    return items;
  }
  function bodyVertices(body){
    const seen=new Map();
    for(const edge of bodyEdges(body))for(const p of edge){seen.set(p.map(rounded).join(' '),p);}
    return [...seen.values()];
  }
  function localBox(body){
    if(body.baseBounds)return {min:body.baseBounds.min.map((v,i)=>v-body.offset[i]),max:body.baseBounds.max.map((v,i)=>v-body.offset[i])};
    return {min:body.bounds.min.map((v,i)=>v-body.offset[i]),max:body.bounds.max.map((v,i)=>v-body.offset[i])};
  }
  function projectMesh(project){
    const visible=new Set(project.layers.filter(layer=>layer.visible).map(layer=>layer.id));
    const strokes=project.strokes.filter(shape=>!shape.construction&&visible.has(shape.layer));
    const analysis=global.LabExtrusion.analyze(strokes,{tolerance:8});
    ensure(analysis.ok,analysis.errors?.[0]?.message||'Нужен замкнутый эскиз.');
    if(project.constraints?.length){
      const report=Sketch.constraintReport(project.strokes,project.constraints);
      ensure(!report.unmet.length,'Значения нарушают связи эскиза.');
    }
    return Solid.build(analysis,{strokes,height:project.modelHeight,bevel:project.modelBevel,bodies:project.modelBodies,features:project.modelFeatures});
  }
  function heat(value){return `hsl(${Math.round(225*(1-value))}, 72%, 37%)`;}
  function paintMap(canvas,samples,bounds,[min,max],yaw,pitch){
    const context=canvas.getContext('2d');
    if(!context)return;
    const a=yaw*Math.PI/180,b=pitch*Math.PI/180;
    const ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b);
    const size=span(bounds.min,bounds.max);
    const center=bounds.min.map((v,i)=>v+size[i]/2);
    const scale=.83*Math.min(canvas.width,canvas.height)/Math.hypot(...size);
    const project=p=>{
      const [x,y,z]=p.map((v,i)=>v-center[i]);
      const horizontal=ca*x-sa*y,other=sa*x+ca*y;
      return [canvas.width/2+horizontal*scale,canvas.height/2-(cb*z-sb*other)*scale,cb*other+sb*z];
    };
    const rows=samples.map(({vertices,distance})=>{
      const points=[0,3,6].map(i=>project(vertices.slice(i,i+3)));
      return {points,distance,z:points.reduce((sum,p)=>sum+p[2],0)};
    }).sort((a,b)=>a.z-b.z);
    context.clearRect(0,0,canvas.width,canvas.height);
    context.lineWidth=.6;
    for(const {points:[a,b,c],distance} of rows){
      const color=Number.isFinite(distance)?heat(max-min<.001?.5:(distance-min)/(max-min)):'#718096';
      context.beginPath();context.moveTo(a[0],a[1]);context.lineTo(b[0],b[1]);context.lineTo(c[0],c[1]);context.closePath();
      context.fillStyle=color;context.strokeStyle=color;context.fill();context.stroke();
    }
  }
  global.LabExtensions.register({id:'solid',title:'3D-операции',mount});
})(window);
