/* Additional annotations, views and checks for the live drawing sheet. */
(function (root) {
  'use strict';
  const X=root.LabDrawingExtra;
  const G=root.LabDrawingGeometry;
  const sheetTools=root.LabDrawingSheetScene;
  const fmt=n=>Number(n.toFixed(3)).toLocaleString('ru-RU');
  const svgNS='http://www.w3.org/2000/svg';
  const commands=[
    ['auxiliary','Вид наклонной грани'],['local','Местный разрез'],['break','Разрыв длинного вида'],
    ['ordinates','Ординатные размеры'],['chain','Размерная цепь'],['roughness','Обозначение шероховатости'],
    ['thread','Выноска резьбы'],['baseline','Лист изменений'],['review','Проверка читаемости'],
    ['calibration','Контроль масштаба печати']
  ];
  function svg(tag,attributes={},text=''){
    const node=document.createElementNS(svgNS,tag);
    for(const [name,value] of Object.entries(attributes))node.setAttribute(name,String(value));
    node.textContent=text;
    return node;
  }
  function path(a,b,attributes={}){
    return svg('path',{d:'M'+a.join(' ')+'L'+b.join(' '),fill:'none',stroke:'#365b77','stroke-width':.36,...attributes});
  }
  function label([x,y],text,attributes={}){
    return svg('text',{x,y,fill:'#263f56','font-size':3.2,'paint-order':'stroke',stroke:'#fff','stroke-width':.6,...attributes},text);
  }
  function scaleText(scale){return scale>=1?fmt(scale)+':1':'1:'+fmt(1/scale);}
  function renderProjection(scene,projection){
    const [a,b,c,d]=projection.bounds;
    const maximum=Math.min((scene.width-40)/Math.max(.001,c-a),(scene.height-82)/Math.max(.001,d-b));
    const scale=sheetTools.scaleSteps.find(n=>n<=maximum)||maximum;
    const map={x:scene.width/2-scale*(a+c)/2,y:(scene.height-6)/2+scale*(b+d)/2,scale};
    const render={maps:{extra:map}};
    return {
      at:p=>sheetTools.toSheet(render,'extra',p),scale,
      outline:svg('path',{d:sheetTools.paths(render,'extra',projection.visible),
        fill:'none',stroke:'#29465e','stroke-width':.45,'stroke-linejoin':'round'})
    };
  }
  function render(view,stored,{extraPage,tablePages}){
    const extras=stored.extras;
    if(!extras)return [];
    const {scene,sheet}=view,pages=[];
    const main=svg('g',{'aria-label':'Дополнительные обозначения','pointer-events':'none'});
    const points=(id,list)=>list.map(p=>sheetTools.toSheet(scene,id,p));
    if(extras.local){
      const spec=extras.local,[x0,y0,x1,y1]=spec.box;
      const [a,b]=points(spec.view,[[x0,y1],[x1,y0]]);
      const inset=(b[0]-a[0])/18, rise=(b[1]-a[1])/18;
      const wave=[
        a,[a[0]+inset*4,a[1]+rise],[a[0]+inset*8,a[1]-rise],
        [a[0]+inset*12,a[1]+rise],[b[0],a[1]],[b[0]-inset,a[1]+rise*9],b,
        [b[0]-inset*5,b[1]-rise],[b[0]-inset*13,b[1]+rise],[a[0],b[1]],[a[0]+inset,a[1]+rise*9]
      ];
      const boundary='M'+wave.map(p=>p.join(' ')).join('L')+'Z';
      const cut=scene.localCut?.spec===JSON.stringify(spec)?scene.localCut.cut:X.localSection(scene.mesh,spec);
      scene.localCut={spec:JSON.stringify(spec),cut};
      const layer=svg('g',{'aria-label':'Местный разрез','pointer-events':'none'});
      const clip=svg('clipPath',{id:'draft-local-boundary'});
      clip.append(svg('path',{d:boundary}));layer.append(clip);
      if(cut.triangles.length){
        layer.append(svg('path',{d:boundary,fill:'#fff'}));
        const group=svg('g',{'clip-path':'url(#draft-local-boundary)','pointer-events':'none'});
        const at=p=>sheetTools.toSheet(scene,spec.view,p);
        const hatch=cut.triangles.map(triangle=>'M'+triangle.map(p=>at(p).join(' ')).join('L')+'Z').join('');
        group.append(svg('path',{d:hatch,fill:'url(#draft-hatch)'}),svg('path',{
          d:sheetTools.paths(scene,spec.view,cut.segments),fill:'none',stroke:'#29465e','stroke-width':.45
        }));
        layer.append(group);
      }
      layer.append(svg('path',{d:boundary,fill:'none',stroke:'#587892','stroke-width':.35}));
      sheet.insertBefore(layer,view.annotation);
    }
    if(extras.auxiliary){
      const name='Вид наклонной грани',page=extraPage(scene,name);
      const key=extras.auxiliary.normal.join(',');
      const projection=scene.auxiliary?.key===key?scene.auxiliary.projection:G.orthographic(scene.mesh,X.basis(extras.auxiliary.normal));
      scene.auxiliary={key,projection};
      const drawing=renderProjection(scene,projection);
      page.append(drawing.outline);
      pages.push({name,page,scale:scaleText(drawing.scale)});
    }
    if(extras.break){
      const name='Вид с разрывом',page=extraPage(scene,name),spec=extras.break;
      const shortened=X.breakProjection(scene.views[spec.view],spec),drawing=renderProjection(scene,shortened);
      page.append(drawing.outline);
      const {axis,bounds,cuts,length}=shortened,other=1-axis;
      for(const cut of cuts){
        const zigzag=Array.from({length:15},(_,i)=>{
          const p=[0,0];
          p[axis]=cut+(i%2?1:-1)*.65/drawing.scale;
          p[other]=bounds[other]-(2/drawing.scale)+(bounds[other+2]-bounds[other]+4/drawing.scale)*i/14;
          return drawing.at(p);
        });
        page.append(svg('path',{d:'M'+zigzag.map(p=>p.join(' ')).join('L'),fill:'none',stroke:'#365b77','stroke-width':.38}));
      }
      const [left,top]=drawing.at([bounds[0],bounds[3]]),[right,bottom]=drawing.at([bounds[2],bounds[1]]);
      const y=Math.min(scene.height-27,bottom+11);
      const x=Math.max(13,left-8),a=axis===0?[left,y]:[x,top],b=axis===0?[right,y]:[x,bottom];
      page.append(path(a,b),...([a,b].map(([x,y])=>path([x-1,y+1],[x+1,y-1]))),
        label(axis===0?[(left+right)/2,y-1.4]:[x+3,(top+bottom)/2],fmt(length)+' мм',{'text-anchor':axis===0?'middle':'start'}),
        label([15,27],'Штрихованные линии показывают пропущенный участок.'));
      pages.push({name,page,scale:scaleText(drawing.scale)});
    }
    if(extras.ordinates){
      const {view:id,origin,targets}=extras.ordinates;
      const [at,...locations]=points(id,[origin,...targets]);
      main.append(path([at[0]-2,at[1]],[at[0]+2,at[1]]),path([at[0],at[1]-2],[at[0],at[1]+2]),label([at[0]+2,at[1]+4],'0'));
      for(let i=0;i<locations.length;i++)main.append(label([locations[i][0]+2,locations[i][1]-2],'К'+(i+1)));
      const rows=targets.map((p,i)=>['К'+(i+1),fmt(p[0]-origin[0]),fmt(p[1]-origin[1])]);
      pages.push(...tablePages(scene,'Координаты от базы',[['Точка',1],['X, мм',2],['Y, мм',2]],rows,'Отметьте контролируемые точки.'));
    }
    if(extras.chain){
      const sums=X.dimensionChain(extras.chain);
      const interval=row=>[row.nominal+row.lower,row.nominal+row.upper];
      const rows=extras.chain.map((row,i)=>[row.name||'Звено '+(i+1),row.sign===1?'+':'−',fmt(row.nominal),...interval(row).map(fmt)]);
      rows.push(['Замыкающий размер','',fmt(sums.nominal),fmt(sums.min),fmt(sums.max)]);
      pages.push(...tablePages(scene,'Размерная цепь',[['Звено',4],['Знак',1],['Номинал',2],['Минимум',2],['Максимум',2]],rows,''));
    }
    for(const spec of extras.callouts||[]){
      const at=spec.bodyId?sheetTools.features(scene,spec.view).circles
        .find(c=>c.bodyId===spec.bodyId&&c.key===spec.key)?.center:spec.at;
      if(!at)continue;
      const [a]=points(spec.view,[at]),b=[a[0]+6,a[1]-7];
      main.append(path(a,b));
      if(spec.kind==='roughness'){
        main.append(path([b[0]-1,b[1]-1],[b[0]+1,b[1]+2]),path([b[0]+1,b[1]+2],[b[0]+4,b[1]-4]),
          label([b[0]+5,b[1]],'Ra '+fmt(spec.ra)));
      }else main.append(path(b,[b[0]+9,b[1]]),label([b[0]+1,b[1]-1],'M'+fmt(spec.diameter)+'×'+fmt(spec.pitch)+' / '+fmt(spec.depth)));
    }
    if(extras.baseline){
      const name='Лист изменений',current=X.snapshot(scene.views);
      const results=X.views.map(id=>({id,...X.changes(extras.baseline.views[id],current[id])}));
      const rows=results.map(({id,added,removed})=>[sheetTools.layout[id].name,added.length,removed.length]);
      pages.push(...tablePages(scene,name,[['Относительно «'+(extras.baseline.name||'исходная редакция')+'»',4],
        ['Добавлено отрезков',2],['Удалено отрезков',2]],rows,''));
      for(const {id,added,removed} of results){
        if(!added.length&&!removed.length)continue;
        const rect=scene.rects[id];
        const meshSegments=[...added,...removed].flat();
        if(meshSegments.length>25000)continue;
        const p=points(id,meshSegments);
        const min=[Math.min(...p.map(v=>v[0])),Math.min(...p.map(v=>v[1]))];
        const max=[Math.max(...p.map(v=>v[0])),Math.max(...p.map(v=>v[1]))];
        if(max[0]<rect.x||min[0]>rect.x+rect.w||max[1]<rect.y||min[1]>rect.y+rect.h)continue;
        const a=[Math.max(rect.x,min[0]-2),Math.max(rect.y,min[1]-2)];
        const b=[Math.min(rect.x+rect.w,max[0]+2),Math.min(rect.y+rect.h,max[1]+2)];
        main.append(svg('rect',{x:a[0],y:a[1],width:b[0]-a[0],height:b[1]-a[1],rx:2,fill:'none',
          stroke:'#a45325','stroke-dasharray':'1.4 .75','stroke-width':.32,'pointer-events':'none'}));
      }
    }
    if(extras.calibration){
      const {length,measured}=extras.calibration;
      const y=scene.height-27,x=13;
      main.append(path([x,y],[x+length,y]),path([x,y-1.5],[x,y+1.5]),path([x+length,y-1.5],[x+length,y+1.5]),
        label([x+length/2,y-1.4],fmt(length)+' мм · отпечаток '+fmt(100*measured/length)+'%',{'text-anchor':'middle'}));
    }
    sheet.append(main);
    return pages;
  }
  function review(view){
    const {sheet,scene}=view,selector='[data-draft-dimension] text,[data-draft-note] text,[aria-label="Дополнительные обозначения"] text';
    const inverse=sheet.getCTM()?.inverse();
    if(!inverse)throw new Error('Откройте первый лист чертежа.');
    const labels=[...sheet.querySelectorAll(selector)].flatMap(node=>{
      if(!node.textContent.trim()||!node.getBBox)return [];
      const {x,y,width,height}=node.getBBox(),matrix=node.getCTM();
      if(!matrix||!width||!height)return [];
      const points=[[x,y],[x+width,y],[x,y+height],[x+width,y+height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix).matrixTransform(inverse));
      const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
      return [{text:node.textContent,box:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]}];
    });
    const issues=X.occupied(labels,scene.width,scene.height);
    const marked=new Set([...issues.out,...issues.pairs.flat()]);
    view.preview?.replaceChildren(...[...marked].map(({box:[x,y,a,b]})=>svg('rect',{
      x:x-.5,y:y-.5,width:a-x+1,height:b-y+1,fill:'none',stroke:'#ae5225','stroke-dasharray':'1 .8','stroke-width':.32
    })));
    return issues;
  }

  function mount(body,ui){
    const app=ui.app;
    if(!app.getProjectionMesh()){body.append(ui.el('p','Сначала постройте объёмную деталь.'));return;}
    const menu=ui.el('select');
    menu.setAttribute('aria-label','Инструмент оформления');
    for(const [value,name] of commands){const option=ui.el('option',name);option.value=value;menu.append(option);}
    const panel=ui.el('div');
    body.append(menu,panel);
    const refresh=()=>{panel.replaceChildren();renderControls(menu.value,panel,ui);};
    menu.addEventListener('change',refresh);refresh();
  }
  function renderControls(kind,panel,ui){
    const app=ui.app,mesh=app.getProjectionMesh(),stored=app.getDraftDesign(),old=stored.extras||{};
    const scene=sheetTools.draftModel(mesh,stored.layout||G.validatePage({format:'А4',orientation:'landscape'}));
    const form=ui.el('form',null,'lab-workbench-grid');
    const outputs=ui.el('div');outputs.setAttribute('role','status');
    panel.append(form,outputs);
    const field=(name,input)=>{
      const label=ui.el('label');label.append(ui.el('span',name),input);form.append(label);return input;
    };
    const number=(name,value,step='any')=>field(name,Object.assign(ui.el('input'),{type:'number',value,step,required:true}));
    const text=(name,value)=>field(name,Object.assign(ui.el('input'),{type:'text',value}));
    const choice=(name,values)=>{
      const input=ui.el('select');
      for(const [value,name] of values){const option=ui.el('option',name);option.value=value;input.append(option);}
      return field(name,input);
    };
    const save=(key,value)=>{
      const current=app.getDraftDesign(),extras={...current.extras};
      if(value===null)delete extras[key];else extras[key]=value;
      if(!app.setDraftDesign({...current,extras:X.validate(extras)}))throw new Error('Параметры чертежа не сохранены.');
      ui.status('Параметры сохранены в проекте.');
    };
    const chooseView=()=>choice('Проекция',X.views.map(id=>[id,sheetTools.layout[id].name]));
    const pair=(name,[x,y])=>[number(name+' X, мм',x),number(name+' Y, мм',y)];
    const read=inputs=>inputs.map(input=>input.valueAsNumber);
    const show=ui.button('Открыть чертёж',()=>{ui.close();queueMicrotask(()=>root.LabDrawingSheet.open());});
    let run, key=kind;
    if(kind==='auxiliary'){
      const normals=X.normals(mesh);
      const source=choice('Нормаль плоской грани',normals.map((n,i)=>[i,n.map(fmt).join(' / ')]));
      const nonCartesian=normals.findIndex(n=>n.filter(v=>Math.abs(v)>.02).length>1);
      if(nonCartesian>=0)source.value=String(nonCartesian);
      run=()=>save(kind,{normal:normals[Number(source.value)]});
    }else if(kind==='local'){
      const view=chooseView(),first=pair('Первый угол',[0,0]),last=pair('Противоположный угол',[1,1]);
      const depth=number('Глубина от ближайшей поверхности, %',45);
      const update=()=>{
        const [a,b,c,d]=scene.views[view.value].bounds;
        [first[0].value,first[1].value,last[0].value,last[1].value]=[a+(c-a)*.25,b+(d-b)*.25,c-(c-a)*.25,d-(d-b)*.25].map(n=>Math.round(n*1000)/1000);
      };
      view.addEventListener('change',update);update();
      run=()=>{
        const [a,b]=read(first),[c,d]=read(last);
        const spec={view:view.value,box:[Math.min(a,c),Math.min(b,d),Math.max(a,c),Math.max(b,d)],depth:depth.valueAsNumber/100};
        X.validate({local:spec});
        const cut=X.localSection(mesh,spec);
        if(!cut.triangles.length||!cut.triangles.some(triangle=>triangle.some(p=>p[0]>=spec.box[0]&&p[0]<=spec.box[2]&&p[1]>=spec.box[1]&&p[1]<=spec.box[3])||
          triangle.some((p,i)=>sheetTools.segmentInRegion(p,triangle[(i+1)%3],spec.box)))){
          const [x,y,z,w]=spec.box,center=[(x+z)/2,(y+w)/2];
          const inTri=t=>{
            const sign=([a,b],[u,v])=>(u-a)*(center[1]-b)-(v-b)*(center[0]-a);
            const sides=t.map((p,i)=>sign(p,t[(i+1)%3]));
            return sides.every(n=>n>=0)||sides.every(n=>n<=0);
          };
          if(!cut.triangles.some(inTri))throw new Error('Выбранная область не пересекает материал на этой глубине.');
        }
        save(kind,spec);
      };
    }else if(kind==='break'){
      const view=chooseView(),axis=choice('Направление',[['x','По горизонтали'],['y','По вертикали']]);
      const start=number('Начало пропуска, %',25),end=number('Конец пропуска, %',75);
      run=()=>save(kind,{view:view.value,axis:axis.value,start:start.valueAsNumber/100,end:end.valueAsNumber/100});
    }else if(kind==='ordinates'){
      const view=chooseView();
      const origin=choice('Нулевая точка',[]),target=choice('Контролируемые точки',[]);
      target.multiple=true;target.size=7;
      let list=[];
      const update=()=>{
        const projection=scene.views[view.value],seen=new Map();
        for(const [a,b] of projection.visible)for(const point of [a,b]){
          const p=point.slice(0,2);seen.set(p.map(n=>Math.round(n*100)).join('/'),p);
        }
        for(const circle of G.projectedCylinders(mesh,view.value,projection))seen.set(circle.center.map(n=>Math.round(n*100)).join('/'),circle.center);
        list=[...seen.values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]).slice(0,250);
        for(const select of [origin,target])select.replaceChildren(...list.map((p,i)=>{
          const option=ui.el('option',p.map(fmt).join(' / ')+' мм');option.value=String(i);return option;
        }));
      };
      view.addEventListener('change',update);update();
      run=()=>{
        const targets=[...target.selectedOptions].map(option=>list[Number(option.value)]);
        if(!targets.length)throw new Error('Выберите минимум одну контролируемую точку.');
        save(kind,{view:view.value,origin:list[Number(origin.value)],targets});
      };
    }else if(kind==='chain'){
      const input=ui.el('textarea');input.rows=5;
      input.value=(old.chain||[{name:'Проём',sign:1,nominal:30,lower:-.1,upper:.1},{name:'Вставка',sign:-1,nominal:29.5,lower:-.05,upper:.05}])
        .map(r=>[r.name,r.sign,r.nominal,r.lower,r.upper].join(' / ')).join('\n');
      field('Строка для каждого звена. Название / знак 1 или −1 / номинал / нижнее и верхнее отклонения, мм',input);
      run=()=>{
        const rows=input.value.split('\n').filter(line=>line.trim()).map(line=>{
          const [name,...values]=line.split('/');
          if(values.length!==4||values.some(v=>!v.trim()))throw new Error('Каждая строка должна содержать пять заполненных полей.');
          const [sign,nominal,lower,upper]=values.map(n=>Number(n.replace(',','.').replace('−','-')));
          return {name,sign,nominal,lower,upper};
        });
        X.validate({chain:rows});save(kind,rows);
        const sum=X.dimensionChain(rows);
        outputs.textContent='Номинал '+fmt(sum.nominal)+' мм. Возможный интервал '+fmt(sum.min)+'–'+fmt(sum.max)+' мм.';
      };
    }else if(kind==='roughness'||kind==='thread'){
      key='callouts';
      const view=chooseView(),target=choice(kind==='thread'?'Круглое отверстие':'Ребро поверхности',[]);
      let candidates=[];
      const update=()=>{
        const projection=scene.views[view.value];
        candidates=kind==='thread'?G.projectedCylinders(mesh,view.value,projection)
          .filter(c=>mesh.bodies.find(body=>body.id===c.bodyId)?.assemblyCylinders?.some(cylinder=>cylinder.key===c.key&&cylinder.inner))
          .map(c=>({at:c.center,diameter:c.radius*2,bodyId:c.bodyId,key:c.key})):
          projection.visible.slice(0,250).map(([a,b])=>({at:[(a[0]+b[0])/2,(a[1]+b[1])/2]}));
        target.replaceChildren(...candidates.map(({at,diameter},i)=>{
          const option=ui.el('option',(i+1)+'. '+at.map(fmt).join(' / ')+(diameter?' · ⌀ '+fmt(diameter):''));option.value=String(i);return option;
        }));
      };
      view.addEventListener('change',update);update();
      const fields=kind==='thread'?{diameter:number('Диаметр резьбы, мм',6),pitch:number('Шаг, мм',1),depth:number('Глубина резьбы, мм',8)}:
        {ra:number('Ra, мкм',3.2)};
      run=()=>{
        const selected=candidates[Number(target.value)];
        if(!selected)throw new Error('На выбранном виде нет подходящего объекта.');
        const {at,bodyId,key:circleKey}=selected;
        const spec={kind,view:view.value,at,...Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.valueAsNumber]))};
        if(bodyId)Object.assign(spec,{bodyId,key:circleKey});
        const existing=app.getDraftDesign().extras?.callouts||[];
        const same=n=>n.kind===spec.kind&&n.view===spec.view&&(bodyId?n.bodyId===bodyId&&n.key===circleKey:n.at.every((v,i)=>v===spec.at[i]));
        save(key,[...existing.filter(n=>!same(n)),spec]);
      };
    }else if(kind==='baseline'){
      const name=text('Название исходной редакции',old.baseline?.name||'Редакция 1');
      const button=ui.button('Сохранить текущую геометрию как исходную',()=>{
        save(kind,{name:name.value,views:X.snapshot(scene.views)});
        outputs.textContent='Измените модель. На листе появится сравнение с сохранённой редакцией.';
      });
      form.append(button);
    }else if(kind==='review'){
      const b=ui.button('Проверить основной лист',()=>{
        ui.close();
        queueMicrotask(()=>{
          if(!root.LabDrawingSheet.open())return;
          try{
            const issues=root.LabDrawingSheet.review(),messages=[];
            if(issues.out.length)messages.push('За пределами рамки '+issues.out.length);
            if(issues.pairs.length)messages.push('Перекрытия подписей '+issues.pairs.length);
            root.LabDrawingSheet.report(messages.length?messages.join('. ')+'. Проверьте отмеченные подписи.':'Перекрытий и выхода за рамку не найдено.');
          }catch(error){root.LabDrawingSheet.report(error.message);}
        });
      });
      form.append(b);
    }else if(kind==='calibration'){
      const length=number('Длина контрольной линии, мм',old.calibration?.length||100);
      const measured=number('Фактическая длина на бумаге, мм',old.calibration?.measured||100);
      run=()=>{
        save(kind,{length:length.valueAsNumber,measured:measured.valueAsNumber});
        const ratio=measured.valueAsNumber/length.valueAsNumber;
        outputs.textContent='Отпечаток '+fmt(ratio*100)+'%. Для следующей печати используйте '+fmt(100/ratio)+'% от предыдущего масштаба.';
      };
    }
    if(run){
      form.append(Object.assign(ui.el('button','Применить'),{type:'submit',className:'primary-button'}));
      form.addEventListener('submit',e=>{e.preventDefault();try{run();}catch(error){ui.status(error.message);}});
    }
    const actions=ui.el('div',null,'lab-workbench-actions');
    actions.append(show);
    if(old[key])actions.append(ui.button(key==='callouts'?'Убрать все выноски':'Убрать с чертежа',()=>save(key,null)));
    panel.append(actions);
  }
  root.LabDrawingExtraUI=Object.freeze({render,review});
  root.LabExtensions.register({id:'drawing',title:'Оформление чертежа',mount});
})(window);
