/* Live drawing sheets linked to the current 3D mesh. */
(() => {
  'use strict';
  const root=typeof window==='undefined'?globalThis:window;
  if(typeof module!=='undefined'&&module.exports){
    const {buildPDF}=require('./drawing-sheet-export.js');
    module.exports={buildPDF};
    return;
  }
  const {layout,scaleSteps,draftModel,toSheet,toProjection,paths,projectedEdgePaths,features,
    sectionScene,sectionPoint,regionBox,segmentInRegion,holeRecords,componentRows}=root.LabDrawingSheetScene;
  const {save,download,exportPDF}=root.LabDrawingSheetExport;
  const app=root.LabApp;
  const G=root.LabDrawingGeometry;
  const svgNS = 'http://www.w3.org/2000/svg';
  const initialPage=()=>G.validatePage({format:'А4',orientation:'landscape'});
  const draftTools = {
    radius:['Радиус','Нажмите на окружность одной из проекций.'],
    diameter:['Диаметр','Нажмите на окружность одной из проекций.'],
    centerline:['Осевые линии','Нажмите на центр или край окружности.'],
    angle:['Угол','Нажмите на вершину между двумя видимыми рёбрами.'],
    section:['Разрез А–А','Отметьте первую точку линии разреза на проекции.'],
    'step-section':['Ступенчатый разрез','Отметьте начало первой линии разреза.'],
    detail:['Выносной вид','Отметьте первый угол увеличиваемой области.'],
    move:['Переместить вид','Перетащите проекцию. Стрелки сдвигают выбранный вид, Shift увеличивает шаг.'],
    'section-length':['Размер на разрезе','Отметьте первую границу толщины или глубины на разрезе.']
  };
  const clamp = (n,a,b) => Math.min(b,Math.max(a,n));
  const fmt = value => Number(value.toFixed(2)).toLocaleString('ru-RU');
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const linePath=(a,b)=>`M${a.join(' ')}L${b.join(' ')}`;
  let current = null;

  function element(tag, attrs={}, text='') {
    const node = document.createElement(tag);
    for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,String(value));
    node.textContent = text;
    return node;
  }
  function svg(tag, attrs={}, text='') {
    const node = document.createElementNS(svgNS,tag);
    for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,String(value));
    if (text) node.textContent = text;
    return node;
  }
  function button(id,label,click) {
    const node = element('button',{type:'button',id},label);
    node.addEventListener('click',click);
    return node;
  }
  const scaleText=s=>s>=1?fmt(s)+':1':'1:'+fmt(1/s);
  const design=()=>app.getDraftDesign();
  function noteAt(index,label){
    return svg('g',{'data-draft-note':index,tabindex:0,role:'button','aria-label':label,class:'draft-note'});
  }
  function labelAt(p,text){
    return svg('text',{x:p[0],y:p[1],fill:'#355774','font-size':3.25,'text-anchor':'middle',
      'paint-order':'stroke',stroke:'#fff','stroke-width':.85,'stroke-linejoin':'round','font-weight':600},text);
  }
  function notePath(d,attributes={}){
    return svg('path',{d,fill:'none',stroke:'#425f79','stroke-width':.28,...attributes});
  }
  function linearNote(points,text,index){
    const [a,b]=points,length=distance(a,b);
    if(length<.06)return null;
    const group=noteAt(index,text+' — параметры обозначения');
    const offset=[-(b[1]-a[1])*4/length,(b[0]-a[0])*4/length];
    const [p,q]=[a,b].map(v=>[v[0]+offset[0],v[1]+offset[1]]);
    const short=length<6,mid=[(p[0]+q[0])/2,(p[1]+q[1])/2-1.1];
    group.append(notePath(linePath(a,p)+linePath(b,q),{stroke:'#8496a7','stroke-width':.21}),
      notePath(linePath(p,q),short?{}:{'marker-start':'url(#draft-start)','marker-end':'url(#draft-end)'}),
      labelAt(short?[mid[0]+5,mid[1]-1]:mid,text));
    return group;
  }
  function circleNote(scene,note,index){
    const circle=features(scene,note.view).circles.find(c=>c.bodyId===note.bodyId&&c.key===note.key);
    if(!circle)return null;
    const [x,y]=toSheet(scene,note.view,circle.center),radius=circle.radius*scene.maps[note.view].scale;
    if(note.kind==='centerline'){
      const group=noteAt(index,'Осевые линии — параметры обозначения'),span=radius+2.5;
      const d=linePath([x-span,y],[x+span,y])+linePath([x,y-span],[x,y+span]);
      group.append(notePath(d,{'stroke-width':.22,'stroke-dasharray':'2.8 .8 .55 .8'}),
        notePath(d,{class:'draft-note-target',stroke:'transparent','stroke-width':4}));
      return group;
    }
    const diameter=note.kind==='diameter',text=(diameter?'⌀':'R')+fmt(circle.radius*(diameter?2:1));
    const group=noteAt(index,text+' — параметры обозначения'),diag=Math.SQRT1_2;
    const rim=[x+radius*diag,y-radius*diag],start=diameter?[x-radius*diag,y+radius*diag]:[x,y];
    const elbow=[rim[0]+5,rim[1]-4],tip=[elbow[0]+10,elbow[1]];
    group.append(notePath(linePath(start,rim),{'marker-end':'url(#draft-end)',...(diameter?{'marker-start':'url(#draft-start)'}:{})}),
      notePath(linePath(rim,elbow)+linePath(elbow,tip)),labelAt([(elbow[0]+tip[0])/2,elbow[1]-1.15],text));
    return group;
  }
  function angleNote(scene,note,index){
    const candidates=features(scene,note.view).corners.filter(c=>c.bodyId===note.bodyId);
    const corner=candidates.reduce((best,c)=>!best||distance(c.anchor,note.anchor)<distance(best.anchor,note.anchor)?c:best,null);
    if(!corner||distance(corner.anchor,note.anchor)>.09)return null;
    const rays=G.angleRays(corner,note.rays);
    if(!rays)return null;
    const [a,b]=rays.map(([x,y])=>[x,-y]),p=toSheet(scene,note.view,corner.origin);
    const angle=Math.acos(clamp(a[0]*b[0]+a[1]*b[1],-1,1)),sweep=a[0]*b[1]-a[1]*b[0]>0?1:0;
    const text=fmt(angle*180/Math.PI)+'°',group=noteAt(index,text+' — параметры обозначения');
    const start=Math.atan2(a[1],a[0]),middle=start+(sweep?1:-1)*angle/2,radius=8;
    const tip=(ray,length)=>[p[0]+ray[0]*length,p[1]+ray[1]*length];
    const u=tip(a,radius),v=tip(b,radius);
    group.append(notePath(linePath(p,tip(a,radius+2))+linePath(p,tip(b,radius+2)),{'stroke-width':.21}),
      notePath(`M${u.join(' ')}A${radius} ${radius} 0 0 ${sweep} ${v.join(' ')}`),
      labelAt(tip([Math.cos(middle),Math.sin(middle)],radius+3.8),text));
    return group;
  }
  function measurementPoints(record) {
    return app.getMeasurementEndpoints(record);
  }
  function measurementNote(scene,note,index,records){
    const record=records.get(note.measurementId);
    if(!record)return null;
    const projected=measurementPoints(record).map(point=>G.projectPoint(note.view,point));
    const points=projected.map(point=>toSheet(scene,note.view,point));
    const shortened=Math.abs(distance(...projected)-record.value)>.01;
    return linearNote(points,(record.label?record.label.slice(0,24)+' · ':'')+fmt(record.value)+' мм'+(shortened?' (3D)':''),index);
  }
  function sectionNote(section,note,index){
    if(!section)return null;
    const span=Math.hypot(section.bounds[2]-section.bounds[0],section.bounds[3]-section.bounds[1]);
    const endpoints=note.anchors.map(anchor=>G.closestOnSegments(G.pointFromNormalized(anchor,section.bounds),section.segments));
    if(endpoints.some(p=>!p||p.distance>span*.065))return null;
    const points=endpoints.map(p=>p.point),value=distance(...points);
    if(value<.005)return null;
    return linearNote(points.map(p=>sectionPoint(section,p)),fmt(value)+' мм',index);
  }
  function drawSection(view,stored,section){
    const {sheet,scene}=view,r=scene.rects.section;
    const group=svg('g',{'data-projection-view':'section',tabindex:0,role:'button','aria-label':'Разрез А–А'});
    group.append(svg('rect',{x:r.x,y:r.y,width:r.w,height:r.h,fill:'transparent',class:'draft-view-hit',rx:1.2}));
    group.append(svg('text',{x:r.x+3,y:r.y+6,fill:'#566f89','font-size':3.6},r.name));
    if(section){
      const draw=p=>sectionPoint(section,p).map(n=>Number(n.toFixed(3)));
      const cap=section.triangles.map(triangle=>'M'+triangle.map(p=>draw(p).join(' ')).join('L')+'Z').join('');
      group.append(svg('path',{d:cap,fill:'url(#draft-hatch)',class:'draft-section-cap'}));
      group.append(notePath(section.segments.map(([a,b])=>linePath(draw(a),draw(b))).join(''),{'stroke-width':.42}));
      if(Math.abs(section.scale-scene.scale)>1e-6){
        group.append(svg('text',{x:r.x+r.w-3,y:r.y+6,fill:'#566f89','font-size':3.2,'text-anchor':'end'},scaleText(section.scale)));
      }
    }else group.append(svg('text',{x:r.x+3,y:r.y+14,fill:'#855435','font-size':3.2},'Линия не пересекает материал'));
    sheet.append(group);
    const [a,b]=stored.points.map(p=>toSheet(scene,stored.view,p)),length=distance(a,b);
    const d=[(b[0]-a[0])/length,(b[1]-a[1])/length],n=[d[1],-d[0]];
    const [x0,y0,x1,y1]=scene.views[stored.view].bounds;
    const along=[[x0,y0],[x0,y1],[x1,y0],[x1,y1]].map(p=>{
      const q=toSheet(scene,stored.view,p);
      return (q[0]-a[0])*d[0]+(q[1]-a[1])*d[1];
    });
    const onLine=t=>[a[0]+d[0]*t,a[1]+d[1]*t];
    const rect=scene.rects[stored.view],p=onLine(Math.min(...along)-3),q=onLine(Math.max(...along)+3);
    const constrain=v=>[clamp(v[0],rect.x+2,rect.x+rect.w-2),clamp(v[1],rect.y+3,rect.y+rect.h-2)];
    // Clipping the trace to the view region preserves the cut direction.
    const limits=[0,1];
    for(let i=0;i<2;i++){
      if(Math.abs(q[i]-p[i])<1e-8)continue;
      const lo=[rect.x+3,rect.y+9][i],hi=[rect.x+rect.w-3,rect.y+rect.h-3][i];
      const t=[(lo-p[i])/(q[i]-p[i]),(hi-p[i])/(q[i]-p[i])].sort((a,b)=>a-b);
      limits[0]=Math.max(limits[0],t[0]);limits[1]=Math.min(limits[1],t[1]);
    }
    if(limits[1]<limits[0])return;
    let endpoints=limits.map(t=>[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);
    let tracePoints=endpoints;
    if(stored.points.length===3){
      const step=G.steppedTrace(stored.points),next=toSheet(scene,stored.view,step.next);
      const offset=[next[0]-b[0],next[1]-b[1]],end=endpoints[1];
      endpoints=[endpoints[0],constrain([end[0]+offset[0],end[1]+offset[1]])];
      tracePoints=[endpoints[0],b,next,endpoints[1]];
    }
    const trace=svg('g',{'aria-label':'Линия разреза А–А'});
    trace.append(notePath('M'+tracePoints.map(point=>point.join(' ')).join('L'),{'stroke-width':.4,'stroke-dasharray':'3 1 .6 1'}));
    for(const end of endpoints){
      const arrow=[end[0]+n[0]*3,end[1]+n[1]*3];
      trace.append(notePath(linePath(end,arrow),{'marker-end':'url(#draft-end)'}),labelAt(constrain([arrow[0]+n[0]*2,arrow[1]+n[1]*2]),'А'));
    }
    sheet.append(trace);
  }
  function drawNotes(view,stored,section){
    const records=new Map((stored.notes.some(note=>note.kind==='measurement')?app.getCurrentMeasurements():[]).map(record=>[record.id,record]));
    stored.notes.forEach((note,index)=>{
      const node=note.kind==='measurement'?measurementNote(view.scene,note,index,records)
        :note.kind==='section-length'?sectionNote(section,note,index)
        :note.kind==='angle'?angleNote(view.scene,note,index):circleNote(view.scene,note,index);
      if(node)view.noteAnnotations.append(node);
    });
  }
  function dimensionGeometry(scene,descriptor) {
    const body = descriptor.bodyId ? scene.mesh.bodies.find(b=>b.id===descriptor.bodyId) : null;
    if (descriptor.bodyId && !body) return null;
    const bounds = body?.bounds || scene.mesh.bounds;
    const [minX,minY,maxX,maxY] = G.projectedBounds(bounds,descriptor.view);
    const [left,top] = toSheet(scene,descriptor.view,[minX,maxY]);
    const [right,bottom] = toSheet(scene,descriptor.view,[maxX,minY]);
    const offset=descriptor.offset, horizontal=descriptor.axis==='horizontal';
    return {left,top,right,bottom,offset,horizontal,value:horizontal?maxX-minX:maxY-minY};
  }
  function drawDimension(scene, descriptor, index, highlight) {
    const size=dimensionGeometry(scene,descriptor);
    if (!size||size.value<.005) return null;
    const {left,top,right,bottom,offset,horizontal,value}=size;
    const group=svg('g',{'data-draft-dimension':index,tabindex:0,role:'button','aria-label':fmt(value)+' мм, настройки размера',class:highlight?'draft-dimension active':'draft-dimension'});
    const positive=offset>=0, sign=positive?1:-1;
    const anchor=horizontal?(positive?bottom:top):(positive?right:left);
    const span=anchor+offset;
    const points=horizontal?[[left,span],[right,span]]:[[span,top],[span,bottom]];
    const line=(a,b)=>`M${a.join(' ')}L${b.join(' ')}`;
    const guide = horizontal
      ? line([left,anchor+sign*.7],[left,span+sign*.9])+line([right,anchor+sign*.7],[right,span+sign*.9])
      : line([anchor+sign*.7,top],[span+sign*.9,top])+line([anchor+sign*.7,bottom],[span+sign*.9,bottom]);
    group.append(svg('path',{d:guide,fill:'none',stroke:'#8496a7','stroke-width':.21}));
    const stroke=highlight?'#255b91':'#425f79';
    const short=horizontal?right-left<6:bottom-top<6;
    const measure=svg('path',{d:line(...points),fill:'none',stroke,'stroke-width':.3});
    if(short){
      for(const [i,end] of points.entries()){
        const tail=end.slice();
        tail[horizontal?0:1]+=i===0?-3.7:3.7;
        group.append(svg('path',{d:line(tail,end),fill:'none',stroke,'stroke-width':.3,'marker-end':'url(#draft-end)'}));
      }
    }else{
      measure.setAttribute('marker-start','url(#draft-start)');
      measure.setAttribute('marker-end','url(#draft-end)');
    }
    group.append(measure, svg('path',{d:line(...points),class:'draft-drag-target',stroke:'transparent','stroke-width':6}));
    const label=dimensionLabel(size,span,short);
    const attrs={x:label[0],y:label[1],fill:'#355774','font-size':3.25,'text-anchor':'middle','paint-order':'stroke',stroke:'#fff','stroke-width':.85,'stroke-linejoin':'round','font-weight':600};
    if (!horizontal) attrs.transform=`rotate(-90 ${label[0]} ${label[1]})`;
    group.append(svg('text',attrs,fmt(value)));
    return group;
  }
  function dimensionLabel({left,right,top,bottom,horizontal},span,short){
    return horizontal?[short?right+6:(left+right)/2,span-1.35]:
      [span-1.35,short?top-4.2:(top+bottom)/2];
  }
  function updateDimensions(view) {
    view.annotation.replaceChildren();
    const dimensions=view.drag?.draft||app.getProjectionDimensions();
    dimensions.forEach((descriptor,i)=>{
      const annotation=drawDimension(view.scene,descriptor,i,view.pick?.index===i);
      if(annotation)view.annotation.append(annotation);
    });
  }
  function pageFrame(scene){
    const {width,height}=scene;
    return [
      svg('rect',{width,height,fill:'#fff'}),
      svg('rect',{x:6,y:6,width:width-12,height:height-12,fill:'#fff',stroke:'#61758a','stroke-width':.28})
    ];
  }
  function pageFooter(sheet,scene,page,scale=''){
    const {width,height,settings}=scene,top=height-23,right=width-77;
    const title=settings.title||'Лаборатория черчения';
    const identity=[settings.author,settings.className&&('Класс '+settings.className)].filter(Boolean).join(' · ');
    sheet.append(svg('path',{d:`M6 ${top}H${width-6}M${right} ${top}V${height-6}`,
      stroke:'#61758a','stroke-width':.26}));
    sheet.append(svg('text',{x:12,y:top+6,fill:'#344d65','font-size':4,'font-weight':600},title));
    if(identity)sheet.append(svg('text',{x:12,y:top+12,fill:'#344d65','font-size':3.2},identity));
    sheet.append(svg('text',{x:right+5,y:top+6,fill:'#344d65','font-size':3.5},
      [settings.format,scale,'мм'].filter(Boolean).join('  ·  ')));
    const number=settings.sheetNumber&&page===1?settings.sheetNumber:
      settings.sheetNumber?`${settings.sheetNumber}.${page-1}`:page;
    sheet.append(svg('text',{x:right+5,y:top+12,fill:'#344d65','font-size':3.2},'Лист '+number));
  }
  function extraPage(scene,name){
    const page=svg('svg',{class:'draft-page',viewBox:`0 0 ${scene.width} ${scene.height}`,
      'font-family':'system-ui, sans-serif','aria-label':name});
    page.append(...pageFrame(scene),svg('text',{x:15,y:18,fill:'#2d4b65','font-size':5,'font-weight':650},name));
    return page;
  }
  function drawDetailMark(view,descriptor){
    const [x0,y0,x1,y1]=regionBox(descriptor.points);
    const a=toSheet(view.scene,descriptor.view,[x0,y1]),b=toSheet(view.scene,descriptor.view,[x1,y0]);
    view.sheet.append(svg('rect',{x:a[0],y:a[1],width:b[0]-a[0],height:b[1]-a[1],fill:'none',
      stroke:'#5b7895','stroke-width':.25,'stroke-dasharray':'2 1'}),labelAt([a[0]+3,a[1]-1.5],'Б'));
  }
  function projectedPage(scene,id,descriptor){
    const name=id==='iso'?'Изометрия':'Выносной вид Б';
    const page=extraPage(scene,name);
    const projection=id==='iso'?(scene.iso??=G.orthographic(scene.mesh,'iso')):scene.views[descriptor.view];
    const [a,b,c,d]=descriptor?regionBox(descriptor.points):projection.bounds;
    const maximum=Math.min((scene.width-42)/Math.max(.001,c-a),(scene.height-74)/Math.max(.001,d-b));
    const scale=scaleSteps.find(n=>n<=maximum)||maximum;
    const render={maps:{extra:{x:scene.width/2-scale*(a+c)/2,y:(scene.height-8)/2+scale*(b+d)/2,scale}}};
    const [left,top]=toSheet(render,'extra',[a,d]),[right,bottom]=toSheet(render,'extra',[c,b]);
    const defs=svg('defs'),clip=svg('clipPath',{id:'draft-extra-'+id});
    clip.append(svg('rect',{x:left,y:top,width:right-left,height:bottom-top}));
    defs.append(clip);page.append(defs);
    page.append(svg('path',{d:paths(render,'extra',projection.visible),fill:'none',stroke:'#29465e',
      'stroke-width':.48,'stroke-linejoin':'round','clip-path':`url(#draft-extra-${id})`}));
    return {name,page,scale:scaleText(scale)};
  }
  function tablePages(scene,name,columns,rows,empty){
    const perPage=Math.max(1,Math.floor((scene.height-65)/7));
    const pages=[];
    for(let start=0;start<Math.max(1,rows.length);start+=perPage){
      const page=extraPage(scene,name+(start?' · продолжение':''));
      const width=scene.width-30,total=columns.reduce((sum,c)=>sum+c[1],0);
      const write=(cells,y,header=false)=>{
        page.append(svg('rect',{x:15,y:y-5,width,height:7,fill:header?'#e6edf3':'#fff',
          stroke:'#90a2b3','stroke-width':.19}));
        let x=15;
        cells.forEach((cell,i)=>{
          const w=width*columns[i][1]/total;
          const value=String(cell),max=Math.floor((w-4)/1.85);
          page.append(svg('text',{x:x+2,y,fill:'#304c65','font-size':3.25,'font-weight':header?600:400},
            value.length>max?value.slice(0,Math.max(1,max-1))+'…':value));
          x+=w;
          if(i<cells.length-1)page.append(svg('path',{d:linePath([x,y-5],[x,y+2]),stroke:'#90a2b3','stroke-width':.19}));
        });
      };
      write(columns.map(c=>c[0]),30,true);
      rows.slice(start,start+perPage).forEach((row,i)=>write(row,37+i*7));
      if(!rows.length)page.append(svg('text',{x:17,y:39,fill:'#566f89','font-size':3.25},empty));
      pages.push({name:page.getAttribute('aria-label'),page});
    }
    return pages;
  }
  function setPage(view,index){
    const value=Number(index);
    view.pageIndex=Number.isInteger(value)?clamp(value,0,view.pages.length):0;
    view.pageSelect.value=String(view.pageIndex);
    view.sheet.classList.toggle('draft-page--hidden',view.pageIndex!==0);
    view.pages.forEach(({page},i)=>page.classList.toggle('draft-page--hidden',view.pageIndex!==i+1));
    view.toolSelect.disabled=view.pageIndex!==0;
    if(view.pageIndex!==0){closePicker(view);setDraftTool(view);}
  }
  function updatePages(view,stored){
    const {scene}=view,settings=scene.settings,pages=[];
    if(settings.iso)pages.push(projectedPage(scene,'iso'));
    if(settings.detail){
      drawDetailMark(view,settings.detail);
      pages.push(projectedPage(scene,'detail',settings.detail));
    }
    if(settings.holes){
      const rows=holeRecords(scene).map((record,i)=>{
        const center=toSheet(scene,record.view,record.center);
        view.sheet.append(labelAt([center[0],center[1]+1],'О'+(i+1)));
        return ['О'+(i+1),layout[record.view].name,fmt(record.x),fmt(record.y),fmt(record.radius*2),fmt(record.depth)];
      });
      pages.push(...tablePages(scene,'Таблица отверстий',[['Поз.',1],['Проекция',3],['X, мм',1.5],['Y, мм',1.5],
        ['Диаметр, мм',2],['Глубина, мм',2]],rows,'Номинальные круглые отверстия на трёх проекциях не найдены.'));
    }
    if(settings.specification){
      const rows=componentRows(scene).map((item,i)=>{
        for(const body of item.bodies){
          const {min,max}=body.bounds;
          const center=toSheet(scene,'front',G.projectPoint('front',min.map((n,k)=>(n+max[k])/2)));
          view.sheet.append(labelAt([center[0],center[1]+1],String(i+1)));
        }
        return [i+1,item.name,item.bodies.length];
      });
      pages.push(...tablePages(scene,'Спецификация сборки',[['Поз.',1],['Наименование',5],['Количество',2]],
        rows,'В сборке пока нет деталей.'));
    }
    if(stored.extras)pages.push(...(root.LabDrawingExtraUI?.render(view,stored,{extraPage,tablePages})||[]));
    view.pages=pages;
    view.supplements.replaceChildren(...pages.map(({page,scale},i)=>{
      pageFooter(page,scene,i+2,scale);
      return page;
    }));
    view.pageSelect.replaceChildren(element('option',{value:0},'Основной лист'),
      ...pages.map(({name},i)=>element('option',{value:i+1},name)));
    view.pageSelect.hidden=!pages.length;
    setPage(view,view.pageIndex);
  }
  function draw(view,mesh) {
    const stored=design(),settings=stored.layout||initialPage(),layoutKey=JSON.stringify(settings);
    if(mesh!==view.scene?.mesh||layoutKey!==view.layoutKey){
      view.scene=draftModel(mesh,settings,view.scene);
      view.layoutKey=layoutKey;
    }
    const {scene,sheet}=view, defs=svg('defs');
    sheet.setAttribute('viewBox',`0 0 ${scene.width} ${scene.height}`);
    view.stage.style.setProperty('--draft-page-ratio',scene.width/scene.height);
    view.stage.style.setProperty('--draft-page-width',scene.width+'mm');
    view.stage.style.setProperty('--draft-page-height',scene.height+'mm');
    view.printStyle.textContent=`@page { size: ${scene.width}mm ${scene.height}mm; margin: 0; }`;
    for (const [key,path] of [['start','M0 1.5L3 0L3 3Z'],['end','M3 1.5L0 0L0 3Z']]) {
      const marker=svg('marker',{id:'draft-'+key,viewBox:'0 0 3 3',refX:key==='start'?0:3,refY:1.5,markerWidth:2.6,markerHeight:2.6,markerUnits:'userSpaceOnUse',orient:'auto'});
      marker.append(svg('path',{d:path,fill:'#425f79'}));defs.append(marker);
    }
    const hatch=svg('pattern',{id:'draft-hatch',width:2.4,height:2.4,patternUnits:'userSpaceOnUse',patternTransform:'rotate(45)'});
    hatch.append(svg('path',{d:'M0 0V2.4',stroke:'#839bad','stroke-width':.38}));
    defs.append(hatch);
    sheet.replaceChildren(defs,...pageFrame(scene));
    for (const id of Object.keys(layout)) {
      const r=scene.rects[id];
      const edges=projectedEdgePaths(scene,id,view.hiddenEdges);
      const group=svg('g',{'data-projection-view':id,tabindex:0,role:'button','aria-label':r.name+' — добавить размеры'});
      group.append(svg('rect',{x:r.x,y:r.y,width:r.w,height:r.h,fill:'transparent',class:'draft-view-hit',rx:1.2}));
      if (view.hiddenEdges) group.append(svg('path',{d:edges.hidden,fill:'none',stroke:'#8396a6','stroke-width':.25,'stroke-dasharray':'1.25 .9'}));
      group.append(
        svg('path',{d:edges.normal,fill:'none',stroke:'#44586d','stroke-width':.39,'stroke-linejoin':'round'}),
        svg('path',{d:edges.silhouette,fill:'none',stroke:'#263f56','stroke-width':.54,'stroke-linejoin':'round'}),
        svg('text',{x:r.x+3,y:r.y+6,fill:'#566f89','font-size':3.6},r.name)
      );
      if(settings.views[id].scale)group.append(svg('text',{x:r.x+r.w-3,y:r.y+6,fill:'#566f89',
        'font-size':3.2,'text-anchor':'end'},scaleText(scene.maps[id].scale)));
      sheet.append(group);
    }
    const section=sectionScene(scene,stored.section);
    view.designKey=JSON.stringify(stored);
    view.toolSelect.querySelector('[value="section-length"]').disabled=!section;
    if(stored.section)drawSection(view,stored.section,section);
    pageFooter(sheet,scene,1,scaleText(scene.scale));
    view.annotation=svg('g',{'aria-label':'Размеры'});
    view.noteAnnotations=svg('g',{'aria-label':'Обозначения'});
    view.preview=svg('g',{class:'draft-temporary','aria-hidden':'true','pointer-events':'none'});
    sheet.append(view.annotation,view.noteAnnotations,view.preview);updateDimensions(view);
    if(stored.notes.length)drawNotes(view,stored,section);
    updatePages(view,stored);
  }
  function sheetPoint(view,event) {
    return new DOMPoint(event.clientX,event.clientY).matrixTransform(view.sheet.getScreenCTM().inverse());
  }
  function closePicker(view) {
    view.pick=null;view.chooser.hidden=true;updateDimensions(view);
  }
  function setDraftTool(view,kind='',message=''){
    if(view.moving){
      const {pointer}=view.moving;
      view.moving=null;
      if(view.sheet.hasPointerCapture(pointer))view.sheet.releasePointerCapture(pointer);
      for(const node of view.sheet.querySelectorAll('[data-projection-view][transform]'))node.removeAttribute('transform');
    }
    view.tool=kind;
    view.firstPoint=null;
    view.cursor=null;
    view.stage.classList.toggle('draft-tool-active',Boolean(kind));
    view.toolSelect.value=kind;
    view.stage.classList.toggle('draft-moving-views',kind==='move');
    view.preview?.replaceChildren();
    setDraftMessage(view,message||draftTools[kind]?.[1]||'');
  }
  function setDraftMessage(view,text){
    view.message.textContent=text;
    view.message.hidden=!text;
  }
  function addNote(view,note){
    const stored=design();
    if(stored.notes.length>=50){setDraftMessage(view,'На чертеже уже 50 обозначений. Удалите одно перед добавлением.');return false;}
    if(stored.notes.some(value=>JSON.stringify(value)===JSON.stringify(note))){
      setDraftTool(view,'','Это обозначение уже есть на чертеже.');
      return true;
    }
    if(!app.setDraftDesign({...stored,notes:[...stored.notes,note]}))return false;
    setDraftTool(view,'','Обозначение добавлено на чертёж.');
    return true;
  }
  function nearest(items,score){
    let item=null,distance=Infinity;
    for(const candidate of items){const value=score(candidate);if(value<distance){item=candidate;distance=value;}}
    return {item,distance};
  }
  function previewDraftTool(view,p){
    const first=view.firstPoint;
    view.preview.replaceChildren();
    if(!first)return;
    const a=first.onSheet,b=[p.x,p.y];
    view.preview.replaceChildren(svg('circle',{cx:a[0],cy:a[1],r:1.25,fill:'#285d8e'}));
    if(view.tool==='detail'){
      view.preview.append(svg('rect',{x:Math.min(a[0],b[0]),y:Math.min(a[1],b[1]),width:Math.abs(a[0]-b[0]),
        height:Math.abs(a[1]-b[1]),fill:'#4c8bbc26',stroke:'#2b6c9b','stroke-width':.28,'stroke-dasharray':'2 1'}));
    }else if(first.bend){
      const bend=first.bend.onSheet;
      const {next}=G.steppedTrace([a,bend,b]);
      view.preview.append(notePath(linePath(a,bend)+linePath(bend,next),{stroke:'#2b6c9b','stroke-dasharray':'2 1'}));
    }else if(distance(a,b)>.1)view.preview.append(notePath(linePath(a,b),{stroke:'#2b6c9b','stroke-dasharray':'2 1'}));
  }
  function useDraftKeyboard(view,event){
    const target=event.target.closest('[data-projection-view]');
    if(!view.tool||!target)return false;
    const keys={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    const delta=keys[event.key],accept=event.key==='Enter'||event.key===' ';
    if(!delta&&!accept)return false;
    event.preventDefault();
    const id=target.dataset.projectionView,r=view.scene.rects[id];
    if(view.tool==='move'){
      if(delta&&Object.hasOwn(layout,id)){
        const step=event.shiftKey?5:1,changed=offsetLayout(view,id,delta[0]*step,delta[1]*step);
        app.setDraftDesign({...design(),layout:changed});
        view.sheet.querySelector(`[data-projection-view="${id}"]`)?.focus({preventScroll:true});
      }
      return true;
    }
    if(view.cursor?.id!==id)view.cursor={id,x:r.x+r.w/2,y:r.y+r.h/2};
    const p=view.cursor;
    if(delta){
      const step=event.shiftKey?5:1;
      p.x=clamp(p.x+delta[0]*step,r.x+1,r.x+r.w-1);p.y=clamp(p.y+delta[1]*step,r.y+1,r.y+r.h-1);
    }else useDraftTool(view,id,p);
    if(view.tool){
      previewDraftTool(view,p);
      view.preview.append(notePath(linePath([p.x-2,p.y],[p.x+2,p.y])+linePath([p.x,p.y-2],[p.x,p.y+2]),{stroke:'#2b6c9b','stroke-width':.65}));
    }
    return true;
  }
  function useDraftTool(view,id,p){
    const kind=view.tool,scene=view.scene;
    const allowed=kind==='section-length'?id==='section':Object.hasOwn(layout,id);
    if(!allowed){setDraftMessage(view,kind==='section-length'?'Отметьте точку на разрезе А–А.':'Отметьте точку на виде сверху, спереди или справа.');return;}
    if(kind==='move')return;
    if(['section','step-section','detail'].includes(kind)){
      const world=toProjection(scene,id,p);
      if(!view.firstPoint){
        view.firstPoint={id,point:world,onSheet:[p.x,p.y]};
        previewDraftTool(view,p);
        const message=kind==='detail'?'Отметьте противоположный угол на той же проекции.':
          kind==='step-section'?'Отметьте точку перехода на второй участок линии.':'Отметьте вторую точку линии на той же проекции.';
        setDraftMessage(view,message);
        return;
      }
      if(id!==view.firstPoint.id){setDraftMessage(view,'Вторая точка должна быть на той же проекции.');return;}
      const first=view.firstPoint,stored=design();
      if(kind==='detail'){
        const [x0,y0,x1,y1]=regionBox([first.point,world]);
        if(Math.min(x1-x0,y1-y0)<.01){setDraftMessage(view,'Отметьте прямоугольную область ненулевой ширины и высоты.');return;}
        const fits=scene.views[id].visible.some(([a,b])=>segmentInRegion(a,b,[x0,y0,x1,y1]));
        if(!fits){setDraftMessage(view,'В выделенной области нет контурных линий. Увеличьте область.');return;}
        if(app.setDraftDesign({...stored,layout:{...scene.settings,detail:{view:id,points:[first.point,world]}}})){
          setDraftTool(view);
          setPage(view,view.pages.findIndex(item=>item.name==='Выносной вид Б')+1);
        }
        return;
      }
      if(kind==='step-section'&&!first.bend){
        if(distance(first.point,world)<.01){setDraftMessage(view,'Отметьте другую точку линии разреза.');return;}
        first.bend={point:world,onSheet:[p.x,p.y]};
        setDraftMessage(view,'Укажите, на какое расстояние сместить второй параллельный участок.');
        previewDraftTool(view,p);
        return;
      }
      const section={view:id,points:first.bend?[first.point,first.bend.point,world]:[first.point,world]};
      if(distance(section.points[0],section.points[1])<.01){setDraftMessage(view,'Отметьте другую точку линии разреза.');return;}
      if(first.bend&&Math.abs(G.steppedTrace(section.points).shift)<.01){setDraftMessage(view,'Вторая линия должна быть смещена относительно первой.');return;}
      if(!sectionScene(scene,section)){setDraftMessage(view,'Линия должна проходить через материал. Выберите другую вторую точку.');return;}
      if(app.setDraftDesign({...stored,section,notes:stored.notes.filter(note=>note.kind!=='section-length')})){
        setDraftTool(view,'','Разрез А–А добавлен. Команда «Размер на разрезе» измеряет расстояние между его границами.');
      }
      return;
    }
    const screenScale=view.sheet.getScreenCTM().a;
    if(kind==='section-length'){
      const section=sectionScene(scene,design().section);
      if(!section){setDraftMessage(view,'Сначала постройте разрез через материал детали.');return;}
      const point=[(p.x-section.x)/section.scale,(section.y-p.y)/section.scale];
      const snapped=G.closestOnSegments(point,section.segments);
      if(!snapped||snapped.distance>10/(section.scale*screenScale)){
        setDraftMessage(view,'Нажмите ближе к границе материала на разрезе.');
        return;
      }
      const anchor=G.normalizedPoint(snapped.point,section.bounds);
      if(!view.firstPoint){
        view.firstPoint={point:anchor,onSheet:sectionPoint(section,snapped.point)};
        previewDraftTool(view,p);
        setDraftMessage(view,'Отметьте вторую границу толщины или глубины.');
      }else if(distance(anchor,view.firstPoint.point)<1e-5)setDraftMessage(view,'Отметьте другую границу.');
      else addNote(view,{kind,anchors:[view.firstPoint.point,anchor]});
      return;
    }
    const point=toProjection(scene,id,p),threshold=12/(scene.maps[id].scale*screenScale);
    if(kind==='angle'){
      const detail=nearest(features(scene,id).corners,corner=>distance(point,corner.origin));
      if(!detail.item||detail.distance>threshold){setDraftMessage(view,'Нажмите ближе к углу двух видимых рёбер.');return;}
      const {bodyId,anchor}=detail.item,rays=G.angleRays(detail.item);
      if(rays)addNote(view,{kind,view:id,bodyId,anchor,rays});
      return;
    }
    const match=nearest(features(scene,id).circles,circle=>{
      const d=distance(point,circle.center);
      return kind==='centerline'?Math.min(d,Math.abs(d-circle.radius)):Math.abs(d-circle.radius);
    });
    if(!match.item||match.distance>threshold){setDraftMessage(view,'Нажмите на видимую окружность.');return;}
    const {bodyId,key}=match.item;
    addNote(view,{kind,view:id,bodyId,key});
  }
  function positionPicker(view,x,y){
    const {chooser}=view;
    chooser.hidden=false;
    chooser.style.left=clamp(x,8,innerWidth-chooser.offsetWidth-8)+'px';
    chooser.style.top=clamp(y,65,innerHeight-chooser.offsetHeight-8)+'px';
  }
  function chooseNote(view,element){
    const index=Number(element.dataset.draftNote),stored=design();
    if(!stored.notes[index])return;
    closePicker(view);
    const heading=element.getAttribute('aria-label').split(' — ')[0];
    view.chooser.replaceChildren(
      document.createTextNode(heading),
      button('draft-remove-note','Удалить обозначение',()=>{app.setDraftDesign({...stored,notes:stored.notes.filter((_,i)=>i!==index)});closePicker(view);}),
      button('draft-dismiss','Готово',()=>closePicker(view)));
    const bbox=element.getBoundingClientRect();
    positionPicker(view,bbox.right+8,bbox.top);
    view.chooser.querySelector('button')?.focus();
  }
  function chooseSection(view,element){
    closePicker(view);
    view.chooser.replaceChildren(
      document.createTextNode('Разрез А–А'),
      button('draft-section-measure','Поставить размер',()=>{closePicker(view);setDraftTool(view,'section-length');}),
      button('draft-remove-section','Удалить разрез',()=>{
        const stored=design();
        app.setDraftDesign({...stored,section:null,notes:stored.notes.filter(note=>note.kind!=='section-length')});
        closePicker(view);
      }),
      button('draft-dismiss','Готово',()=>closePicker(view)));
    const bbox=element.getBoundingClientRect();
    positionPicker(view,bbox.right+5,bbox.top+8);
  }
  function choose(view,id,bodyId,index) {
    const r=view.scene.rects[id], matrix=view.sheet.getScreenCTM();
    view.pick={id,bodyId,index};
    const {chooser}=view;
    chooser.replaceChildren(element('strong',{},r.name));
    const select=element('select',{'aria-label':'Объект для размера'});
    select.append(element('option',{value:''},'Вся модель'));
    for (const b of view.scene.mesh.bodies) select.append(element('option',{value:b.id},b.name));
    select.value=bodyId||'';
    if(view.scene.mesh.bodies.length>1)chooser.append(select);
    select.addEventListener('change',()=>view.pick.bodyId=select.value||null);
    function add(axis) {
      const {pick}=view, dimensions=app.getProjectionDimensions();
      const existing=dimensions.findIndex(d=>d.view===id&&d.axis===axis&&d.bodyId===pick.bodyId);
      if (existing!==-1) {
        choose(view,id,pick.bodyId,existing);
        return;
      }
      if (dimensions.length>=30){app.toast('На листе уже 30 размеров. Удалите лишний размер.');return;}
      dimensions.push({view:id,axis,bodyId:pick.bodyId,offset:7});
      app.setProjectionDimensions(dimensions);
      closePicker(view);
    }
    chooser.append(button('draft-horizontal','Горизонтальный размер',()=>add('horizontal')),button('draft-vertical','Вертикальный размер',()=>add('vertical')));
    if (index!==undefined) chooser.append(button('draft-remove','Удалить размер',()=>{
      app.setProjectionDimensions(app.getProjectionDimensions().filter((_,i)=>i!==index));closePicker(view);
    }));
    chooser.append(button('draft-dismiss','Готово',()=>closePicker(view)));
    const corner=new DOMPoint(r.x+r.w+4,r.y+6).matrixTransform(matrix);
    positionPicker(view,corner.x,corner.y);
    updateDimensions(view);
  }
  function openPicker(view,event,keyboard=false) {
    const note=event.target.closest('[data-draft-note]');
    if(note&&!view.tool){chooseNote(view,note);return;}
    const descriptor=event.target.closest('[data-draft-dimension]');
    if(descriptor&&!view.tool){
      const index=Number(descriptor.dataset.draftDimension), d=app.getProjectionDimensions()[index];
      if(d)choose(view,d.view,d.bodyId,index);
      return;
    }
    const target=event.target.closest('[data-projection-view]');
    if(!target){closePicker(view);return;}
    const id=target.dataset.projectionView;
    if(view.tool){
      if(!keyboard){useDraftTool(view,id,sheetPoint(view,event));return;}
      setDraftMessage(view,draftTools[view.tool][1]);
      return;
    }
    if(id==='section'){chooseSection(view,target);return;}
    const bodyId=keyboard?null:view.scene.views[id].pick(toProjection(view.scene,id,sheetPoint(view,event)));
    choose(view,id,bodyId);
  }
  function bind(view) {
    const {stage,sheet,events}=view, signal=events.signal;
    stage.addEventListener('pointerdown',e=>{
      if(!view.chooser.hidden&&!e.target.closest('#draft-chooser,[data-projection-view],[data-draft-dimension],[data-draft-note]'))closePicker(view);
    },{signal});
    sheet.addEventListener('click',e=>{
      if(view.suppressClick){view.suppressClick=false;return;}
      openPicker(view,e);
    },{signal});
    sheet.addEventListener('keydown',e=>{
      if(useDraftKeyboard(view,e))return;
      if(e.key==='Enter'||e.key===' '){e.preventDefault();openPicker(view,e,true);}
    },{signal});
    sheet.addEventListener('pointerdown',e=>{
      view.suppressClick=false;
      if(view.tool==='move'&&e.button===0){
        const id=e.target.closest('[data-projection-view]')?.dataset.projectionView;
        if(!Object.hasOwn(layout,id))return;
        view.moving={id,pointer:e.pointerId,start:sheetPoint(view,e),settings:view.scene.settings};
        sheet.setPointerCapture(e.pointerId);
        return;
      }
      const node=e.target.closest('[data-draft-dimension]');
      if(view.tool||!node||e.button!==0)return;
      const index=Number(node.dataset.draftDimension),draft=app.getProjectionDimensions();
      if(!draft[index])return;
      view.drag={index,id:e.pointerId,first:sheetPoint(view,e),draft,offset:draft[index].offset,moved:false};
      sheet.setPointerCapture(e.pointerId);
    },{signal});
    sheet.addEventListener('pointermove',e=>{
      if(view.moving?.pointer===e.pointerId){
        const moving=view.moving,where=sheetPoint(view,e);
        moving.next=offsetLayout(view,moving.id,where.x-moving.start.x,where.y-moving.start.y);
        for(const id of Object.keys(layout)){
          const before=moving.settings.views[id],after=moving.next.views[id];
          sheet.querySelector(`[data-projection-view="${id}"]`).setAttribute('transform',
            `translate(${after.x-before.x} ${after.y-before.y})`);
        }
        e.preventDefault();
        return;
      }
      const {drag}=view;
      if(view.tool&&view.firstPoint)previewDraftTool(view,sheetPoint(view,e));
      if(drag?.id!==e.pointerId)return;
      const point=sheetPoint(view,e),dim=drag.draft[drag.index],delta=dim.axis==='horizontal'?point.y-drag.first.y:point.x-drag.first.x;
      if(!drag.moved&&Math.abs(delta)<.65)return;
      drag.moved=true;
      const value=clamp(drag.offset+delta,-16,16);
      dim.offset=Math.abs(value)<2?(value<0?-2:2):Math.round(value*10)/10;
      e.preventDefault();
      updateDimensions(view);
    },{signal});
    for(const type of ['pointerup','pointercancel'])sheet.addEventListener(type,e=>{
      if(view.moving?.pointer===e.pointerId){
        const {next,pointer}=view.moving;
        view.moving=null;
        if(sheet.hasPointerCapture(pointer))sheet.releasePointerCapture(pointer);
        if(type==='pointerup'&&next)app.setDraftDesign({...design(),layout:next});
        for(const node of sheet.querySelectorAll('[data-projection-view][transform]'))node.removeAttribute('transform');
        return;
      }
      const {drag}=view;
      if(drag?.id!==e.pointerId)return;
      view.drag=null;
      if(sheet.hasPointerCapture(drag.id))sheet.releasePointerCapture(drag.id);
      if(drag.moved){
        view.suppressClick=true;
        if(type==='pointerup')app.setProjectionDimensions(drag.draft);
        closePicker(view);
      } else if (type==='pointerup') {
        const dim=drag.draft[drag.index];
        view.suppressClick=true;
        choose(view,dim.view,dim.bodyId,drag.index);
      } else updateDimensions(view);
    },{signal});
    document.addEventListener('keydown',e=>{
      if(e.key!=='Escape'||document.querySelector('dialog[open]'))return;
      e.preventDefault();e.stopImmediatePropagation();
      if(view.tool)setDraftTool(view);
      else if(!view.chooser.hidden)closePicker(view);
      else close();
    },{capture:true,signal});
    document.addEventListener('labchange',e=>{
      if(e.detail.kind==='project'){close();return;}
      if(e.detail.kind==='modelgeometry'){
        const mesh=app.getModelMesh();
        if(mesh?.positions.length&&mesh!==view.scene.mesh){closePicker(view);draw(view,mesh);}
      } else if(e.detail.kind==='draftdesign'||e.detail.kind==='measurement'||
        (e.detail.kind==='drawing'&&JSON.stringify(design())!==view.designKey))draw(view,view.scene.mesh);
      else if(e.detail.kind==='drawing'||e.detail.kind==='projectiondimensions')updateDimensions(view);
    },{signal});
  }
  function setZoom(view,zoom) {
    const viewport=view.viewport, old=view.zoom;
    view.zoom=clamp(zoom,1,4);
    const factor=view.zoom/(old||1);
    const x=(viewport.scrollLeft+viewport.clientWidth/2)*factor-viewport.clientWidth/2;
    const y=(viewport.scrollTop+viewport.clientHeight/2)*factor-viewport.clientHeight/2;
    view.stage.style.setProperty('--draft-zoom',view.zoom);
    viewport.scrollTo(x,y);
    view.zoomIn.disabled=view.zoom>=4;view.zoomOut.disabled=view.zoom<=1;
    if(view.pick)closePicker(view);
  }
  function offsetLayout(view,id,dx,dy){
    const {scene}=view,settings=scene.settings,views=Object.fromEntries(Object.entries(settings.views)
      .map(([key,value])=>[key,{...value}]));
    const move=(ids,axis,delta)=>{
      const index=axis==='x'?0:1,border=8,limit=(axis==='x'?scene.width:scene.height-25)-border;
      let min=-120,max=120;
      for(const id of ids){
        const [x0,y0,x1,y1]=scene.views[id].bounds;
        const values=[toSheet(scene,id,[x0,y0])[index],toSheet(scene,id,[x1,y1])[index]];
        min=Math.max(min,Math.min(0,border-Math.min(...values)));
        max=Math.min(max,Math.max(0,limit-Math.max(...values)));
      }
      for(const key of ids)views[key][axis]=Math.round((views[key][axis]+clamp(delta,min,max))*10)/10;
    };
    move(id==='side'?['side']:['top','front'],'x',dx);
    move(id==='top'?['top']:['front','side'],'y',dy);
    return {...settings,views};
  }
  function arrangeDimensions(view){
    const {scene}=view,used=[],warnings=[],dimensions=app.getProjectionDimensions();
    if(!dimensions.length){setDraftMessage(view,'Сначала добавьте размеры проекций.');return;}
    const overlaps=(a,b)=>a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1];
    const modelBoxes=Object.keys(layout).map(id=>{
      const [a,b,c,d]=scene.views[id].bounds,[x0,y0]=toSheet(scene,id,[a,d]),[x1,y1]=toSheet(scene,id,[c,b]);
      return [x0-.5,y0-.5,x1+.5,y1+.5];
    });
    for(const item of dimensions){
      const size=dimensionGeometry(scene,item);
      if(!size)continue;
      const {left,right,top,bottom,horizontal,value}=size,textWidth=Math.max(5,fmt(value).length*2.15);
      let chosen=null;
      for(const offset of [5,9,13,16,-5,-9,-13,-16]){
        const anchor=horizontal?(offset>0?bottom:top):(offset>0?right:left);
        const span=anchor+offset,short=horizontal?right-left<6:bottom-top<6;
        const [x,y]=dimensionLabel(size,span,short);
        const label=horizontal?[x-textWidth/2,y-3.3,x+textWidth/2,y+.9]:
          [x-3.3,y-textWidth/2,x+.9,y+textWidth/2];
        const line=horizontal?[left,span-.25,right,span+.25]:[span-.25,top,span+.25,bottom];
        const score=(label[0]<8||label[1]<8||label[2]>scene.width-8||label[3]>scene.height-24?20:0)+
          modelBoxes.filter(box=>overlaps(box,label)||overlaps(box,line)).length*6+
          used.filter(box=>overlaps(box,label)||overlaps(box,line)).length*4;
        if(!chosen||score<chosen.score)chosen={offset,label,line,score};
        if(score===0)break;
      }
      item.offset=chosen.offset;used.push(chosen.label,chosen.line);
      if(chosen.score>0)warnings.push(chosen.label);
    }
    if(app.setProjectionDimensions(dimensions)){
      view.preview.replaceChildren(...warnings.map(([x,y,x1,y1])=>svg('rect',{x,y,width:x1-x,height:y1-y,
        fill:'none',stroke:'#aa542d','stroke-width':.38,'stroke-dasharray':'1 .8',rx:.4})));
      setDraftMessage(view,warnings.length?`Проверьте отмеченные размеры (${warnings.length}) и при необходимости сдвиньте их.`:
        'Размерные линии разложены. Любой размер можно сдвинуть вручную.');
    }
  }
  function editPage(view){
    if(view.settingsDialog?.open)return;
    const settings=view.scene.settings,dialog=element('dialog',{class:'draft-page-settings','aria-labelledby':'draft-page-heading'});
    const form=element('form',{method:'dialog'});
    form.append(element('h2',{id:'draft-page-heading'},'Оформление листа'));
    const controls={};
    const field=(name,label,input)=>{
      const row=element('label',{},label);
      row.append(input);form.append(row);controls[name]=input;
    };
    const options=(name,entries,value)=>{
      const select=element('select',{name});
      select.append(...entries.map(([value,label])=>element('option',{value},label)));select.value=String(value);
      return select;
    };
    field('format','Формат',options('format',[['А4','А4'],['А3','А3']],settings.format));
    field('orientation','Ориентация',options('orientation',[['landscape','Альбомная'],['portrait','Книжная']],settings.orientation));
    for(const [key,label,max] of [['title','Название детали',54],['author','Автор',42],['className','Класс',18],['sheetNumber','Номер листа',14]])
      field(key,label,element('input',{type:'text',name:key,value:settings[key],maxlength:max,autocomplete:'off'}));
    for(const [id,r] of Object.entries(layout)){
      const values=[[0,'Авто'],...G.pageScales.map(n=>[n,scaleText(n)])];
      field(id,r.name+' · масштаб',options(id,values,settings.views[id].scale));
    }
    for(const [key,label] of [['iso','Лист с изометрией'],['holes','Таблица отверстий'],['specification','Спецификация сборки']]){
      const input=element('input',{type:'checkbox',name:key});
      input.checked=settings[key];field(key,label,input);
    }
    const actions=element('div',{class:'draft-page-actions'});
    let detail=settings.detail,resetOffsets=false;
    if(detail)actions.append(button('draft-clear-detail','Убрать выносной вид',()=>{
      detail=null;dialog.querySelector('#draft-clear-detail').disabled=true;
    }));
    actions.append(button('draft-reset-views','Вернуть расположение видов',()=>{
      resetOffsets=true;dialog.querySelector('#draft-reset-views').disabled=true;
    }));
    actions.append(button('draft-dismiss-settings','Отмена',()=>dialog.close()),element('button',{type:'submit'},'Применить'));
    form.append(actions);
    form.addEventListener('submit',e=>{
      e.preventDefault();
      const chosen={...settings,detail,views:{}};
      for(const key of ['format','orientation','title','author','className','sheetNumber'])chosen[key]=controls[key].value;
      for(const key of ['iso','holes','specification'])chosen[key]=controls[key].checked;
      for(const id of Object.keys(layout))chosen.views[id]={x:resetOffsets?0:settings.views[id].x,
        y:resetOffsets?0:settings.views[id].y,scale:Number(controls[id].value)};
      if(app.setDraftDesign({...design(),layout:chosen}))dialog.close();
    });
    dialog.append(form);view.stage.append(dialog);view.settingsDialog=dialog;
    dialog.addEventListener('close',()=>{dialog.remove();view.settingsDialog=null;},{once:true});
    dialog.showModal();
  }
  async function savePDF(view){
    const {scene}=view,button=view.exportPDF;
    const sheets=[view.sheet,...view.pages.map(({page})=>page)];
    button.disabled=true;setDraftMessage(view,'Подготовка PDF…');
    try{
      const pdf=await exportPDF(sheets,scene.width,scene.height,view.events.signal);
      if(!pdf)return;
      download(pdf,`Чертёж-${scene.settings.format}.pdf`);
      setDraftMessage(view,`PDF подготовлен · страниц ${sheets.length}`);
    }catch{
      setDraftMessage(view,'Не удалось подготовить PDF. Воспользуйтесь кнопкой «Печать».');
    }finally{button.disabled=false;}
  }
  function close({restoreFocus=true}={}) {
    if(!current)return;
    const {stage,events,returnFocus,modes,modeHome,modeAnchor,covered}=current;
    current=null;events.abort();
    modeHome.insertBefore(modes,modeAnchor);
    stage.remove();
    for(const element of covered)element.removeAttribute('inert');
    document.body.classList.remove('draft-sheet-open');
    document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'draftview',open:false}}));
    if(restoreFocus){
      const focus=returnFocus?.getClientRects().length?returnFocus:modes.querySelector('[aria-pressed="true"]');
      focus?.focus({preventScroll:true});
    }
  }
  function open() {
    if(current)return true;
    const mesh=app.getProjectionMesh();
    if(!mesh)return false;
    const stage=element('section',{id:'draft-sheet-stage','aria-label':'Чертёж модели на листе А4'});
    const header=element('div',{class:'draft-header'});
    const toolbar=element('div',{class:'draft-toolbar glass'});
    const viewport=element('div',{class:'draft-viewport'});
    const sheet=svg('svg',{id:'draft-a4',class:'draft-page',viewBox:'0 0 297 210','font-family':'system-ui, sans-serif','aria-label':'Три проекции модели'});
    const supplements=element('div',{class:'draft-supplements'});
    const printStyle=element('style');
    const pageSelect=element('select',{id:'draft-page-select','aria-label':'Листы чертежа',hidden:''});
    const chooser=element('div',{id:'draft-chooser',class:'glass',hidden:'','aria-label':'Размеры проекции'});
    const toolSelect=element('select',{id:'draft-tool','aria-label':'Обозначения чертежа'});
    toolSelect.append(element('option',{value:''},'Обозначения'));
    for(const [key,[name]] of Object.entries(draftTools))toolSelect.append(element('option',{value:key},name));
    const message=element('div',{id:'draft-message',role:'status','aria-live':'polite',hidden:''});
    const modes=document.getElementById('workspace-views');
    const view={stage,sheet,chooser,viewport,toolSelect,message,supplements,printStyle,pageSelect,pageIndex:0,pages:[],
      tool:'',events:new AbortController(),zoom:1,hiddenEdges:false,returnFocus:document.activeElement,
      modes,modeHome:modes.parentNode,modeAnchor:modes.nextSibling,
      covered:[...document.body.children].filter(element=>element.tagName!=='SCRIPT'&&!element.hasAttribute('inert'))};
    view.zoomOut=button('draft-zoom-out','−',()=>setZoom(view,view.zoom/1.45));
    view.zoomOut.setAttribute('aria-label','Уменьшить чертёж');
    view.zoomIn=button('draft-zoom-in','+',()=>setZoom(view,view.zoom*1.45));
    view.zoomIn.setAttribute('aria-label','Увеличить чертёж');
    const hidden=button('draft-hidden','Скрытые рёбра',()=>{view.hiddenEdges=!view.hiddenEdges;hidden.setAttribute('aria-pressed',String(view.hiddenEdges));draw(view,view.scene.mesh);});
    hidden.setAttribute('aria-pressed','false');
    const back=button('draft-close',app.isModelOpen()?'← Модель':'← Лист',()=>close());
    toolSelect.addEventListener('change',()=>{closePicker(view);setDraftTool(view,toolSelect.value);});
    pageSelect.addEventListener('change',()=>setPage(view,pageSelect.value));
    view.exportPDF=button('draft-save-pdf','↓ PDF',()=>savePDF(view));
    toolbar.append(back,view.zoomOut,view.zoomIn,hidden,toolSelect,button('draft-settings','Лист',()=>editPage(view)));
    if(root.LabExtensions&&root.LabDrawingExtraUI)toolbar.append(button('draft-advanced','Оформление',()=>root.LabExtensions.open('drawing')));
    toolbar.append(
      button('draft-arrange','Разложить размеры',()=>{setPage(view,0);arrangeDimensions(view);}),
      pageSelect,button('draft-save','↓ SVG',()=>save(view)),view.exportPDF,button('draft-print','Печать',()=>window.print()));
    header.append(modes,toolbar);
    viewport.append(sheet,supplements);stage.append(printStyle,header,viewport,chooser,message);
    document.body.append(stage);document.body.classList.add('draft-sheet-open');
    for(const element of view.covered)element.setAttribute('inert','');
    current=view;draw(view,mesh);bind(view);setZoom(view,1);
    document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'draftview',open:true}}));
    const focus=modes.contains(view.returnFocus)?modes.querySelector('[aria-pressed="true"]'):back;
    focus?.focus({preventScroll:true});
    return true;
  }
  function addMeasurement(measurementId){
    const record=app.getCurrentMeasurements().find(item=>item.id===measurementId);
    if(!record){app.toast('Закрепите измерение текущего варианта детали.');return false;}
    const stored=design(),already=stored.notes.find(note=>note.kind==='measurement'&&note.measurementId===measurementId);
    if(already)return open();
    if(stored.notes.length>=50){
      const message='На чертеже уже 50 обозначений. Удалите одно перед добавлением.';
      if(current)setDraftMessage(current,message);else app.toast(message);
      return false;
    }
    const points=measurementPoints(record);
    const view=Object.keys(layout).reduce((best,id)=>{
      const span=name=>distance(...points.map(p=>G.projectPoint(name,p)));
      return span(id)>span(best)+1e-6?id:best;
    },'top');
    if(!open())return false;
    return addNote(current,{kind:'measurement',view,measurementId});
  }
  function review(){
    if(!current||!root.LabDrawingExtraUI)return {out:[],pairs:[]};
    setPage(current,0);
    return root.LabDrawingExtraUI.review(current);
  }
  root.LabDrawingSheet={open,close,addMeasurement,review,report:message=>{if(current)setDraftMessage(current,message);},active:()=>Boolean(current)};
})();
