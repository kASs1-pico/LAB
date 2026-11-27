/* Виртуальная лаборатория черчения. Полностью локальное приложение. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const I = window.LabInstruments;
  const Constraints = window.LabDesignConstraints;
  const SketchUpgrade=window.LabSketchUpgrade;
  let sketchUpgradeError='';
  const STORAGE_KEY = 'drawing-lab-v1';
  const MM = 4;
  const tools = {
    ruler: {title:'Линейка',number:'01',description:'Прямая линия начинается с точности.',hint:'Двигайте корпус · чертите по краю',instruction:'Корпус перемещает линейку. Круглая ручка поворачивает её. Подсвеченный край направляет линию.'},
    compass: {title:'Циркуль',number:'02',description:'Один центр. Бесконечно много возможностей.',hint:'Центр — двигать · R — радиус · карандаш — дуга',instruction:'Точка центра перемещает циркуль. R меняет радиус. Ведите карандаш по кругу для дуги.'},
    pencil: {title:'Карандаш',number:'03',description:'Дайте своей идее первую форму.',hint:'Рисуйте свободно мышью или пальцем',instruction:'Ведите линию мышью или пальцем. Кнопка отмены убирает целый штрих.'},
    line: {title:'Отрезок',number:'04',description:'Соедините две точки своей идеи.',hint:'Потяните от начала к концу · Shift — шаг 15°',instruction:'Потяните от начала к концу. Shift задаёт угол с шагом 15°. Привязка помогает попасть в сетку.'},
    eraser: {title:'Ластик',number:'05',description:'Каждое построение можно переосмыслить.',hint:'Коснитесь линии или проведите по ней, чтобы удалить',instruction:'Коснитесь линии, чтобы убрать её целиком. Отмена вернёт удалённые фигуры.'},
    contour: {title:'Контур',number:'06',description:'Плоская фигура — начало объёмной модели.',hint:'Отмечайте вершины · первая точка замыкает контур',instruction:'Отмечайте вершины. Нажмите первую точку, чтобы замкнуть фигуру. Контур внутри станет отверстием.'}
  };
  const {
    MAX_STROKES, MAX_STROKE_POINTS, MAX_DRAWING_POINTS, blank, cleanName, validId, checkedAxis,
    checkedTracing, axisProjection, reflectedShape, needsReflection, reflectInto, bodyValue,
    validatedFeature, validateProjectionDimensions, validateSketchDimensions, validateDraftDesign,
    validateExperiment, normalizeMeasurement, variantProject, compactMeasurementBook
  }=window.LabProjectModel;
  const validateProject=(input,options)=>window.LabProjectModel.validateProject(input,tools,options);
  let state = blank('landscape');
  let history = [], future = [], gesture = null, draft = null;
  let zoom = 1, fitScale = 1, selectedOrientation = 'landscape';
  let started = false, saved = null, saveTimer, toastTimer, welcomeIsNew = false, panMode = false;
  let savedSource = null, savedDocument = null, savePending = false, storageWarning = null;
  let contourPoints = [], contourHover = null;
  let modelOpen = false, modelViewer = null, modelAnalysis = null, modelSource = '', modelTimer;
  let displayedModelSource = '', displayedModelHeight = null;
  let modelMesh=null, modelHeightDragging=false, displayedBevel=null, displayedHoles=0, snapTimer;
  let modelJob=null, modelWorkerDisabled=false, modelNeedsBuild=false;
  let modelEditBefore=null, modelError='', pendingValidationError='', displayedCAD='', shapeSerial=0, bodyHeightGesture=null, uploadedMesh=null, editBodyIds=null;
  const canvasTouches=new Map();let pinch=null,heightEditBefore=null;
  const activePointers = new Set();
  const paper = $('paper'), wrap = $('paper-wrap'), stage = $('stage');
  const historyActions=document.querySelector('.history-actions');
  const compactControls=matchMedia('(max-width: 600px)');
  const welcome = $('welcome-dialog'), dialog = $('action-dialog');
  const renderer = window.Lab3D ? new window.Lab3D($('tools-3d')) : null;
  document.documentElement.classList.toggle('webgl-active', Boolean(renderer?.supported));
  $('tools-3d').addEventListener('lab3dchange', (event) => {
    document.documentElement.classList.toggle('webgl-active', event.detail.supported);
    if (!event.detail.supported) toast('3D недоступно. Инструменты продолжают работать в SVG.');
    renderTools();
  });

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const clamp = (v,lo,hi) => Math.min(hi, Math.max(lo,v));
  const num = (v) => Number(Number(v).toFixed(3));
  const rad = (v) => v*Math.PI/180;
  const deg = (v) => v*180/Math.PI;
  const fmt = (v) => Number(v.toFixed(2)).toLocaleString('ru-RU');
  function layerVisible(shape){return state.layers.find(layer=>layer.id===(shape.layer||'main'))?.visible!==false;}
  function visibleStrokes(){return state.strokes.filter(layerVisible);}
  function modelStrokes(){return visibleStrokes().filter(shape=>!shape.construction);}
  function canDraw(){const layer=state.layers.find(l=>l.id===state.activeLayer);if(!layer||layer.locked||!layer.visible){toast('Выберите видимый слой без блокировки.');return false;}return true;}
  function historyEffect(before,after){
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const previous=new Set(before.map(s=>JSON.stringify(s))),next=new Set(after.map(s=>JSON.stringify(s)));
    const removed=before.filter(s=>!next.has(JSON.stringify(s))&&layerVisible(s));
    if(removed.length){const group=document.createElementNS('http://www.w3.org/2000/svg','g');group.innerHTML=removed.map(shapeMarkup).join('');group.classList.add('history-fade');$('history-fx').appendChild(group);setTimeout(()=>group.remove(),230);}
    after.forEach((shape,i)=>{if(!previous.has(JSON.stringify(shape))){const el=$('drawing-layer').querySelector(`[data-shape-index="${i}"]`);el?.classList.add('history-return');setTimeout(()=>el?.classList.remove('history-return'),280);}});
  }
  function showSnap(p){
    const scale=1/(fitScale*zoom);$('snap-layer').innerHTML=`<circle class="snap-ring" cx="${num(p.x)}" cy="${num(p.y)}" r="${7*scale}" style="stroke-width:${1.5*scale}"/>`;
    clearTimeout(snapTimer);snapTimer=setTimeout(()=>$('snap-layer').innerHTML='',220);
  }
  function highlightLoop(index){
    const loop=modelAnalysis?.loops[index];
    if(!loop){$('linked-highlight').innerHTML='';return;}
    $('linked-highlight').innerHTML=`<path d="M ${loop.points.map(p=>`${num(p.x)} ${num(p.y)}`).join(' L ')} Z" fill="none" stroke="#5790BC" stroke-opacity=".85" stroke-width="${3/(fitScale*zoom)}"/>`;
  }
  function highlightHole(){
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const loop=modelAnalysis?.loops.filter(l=>l.depth%2===1).at(-1);if(!loop)return;
    const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',`M ${loop.points.map(v=>`${num(v.x)} ${num(v.y)}`).join(' L ')} Z`);p.classList.add('hole-reveal');$('history-fx').appendChild(p);setTimeout(()=>p.remove(),750);
  }
  function hoverDrawing(p){
    if(!modelOpen||!modelAnalysis?.ok)return;
    const found=getSketchHits(p,8/(fitScale*zoom)).reduce((index,hit)=>Math.max(index,hit.index),-1);
    const contour=modelAnalysis.loops.findIndex(loop=>loop.sourceIndices.includes(found));
    modelViewer?.setHighlight?.(contour);highlightLoop(contour);
  }
  function changeLayer(action,id,value){
    cancelModelEdit();cancelGesture();resetContour();const layer=state.layers.find(l=>l.id===id);
    if(action==='add'){
      if(state.layers.length>=20){toast('Можно создать до 20 слоёв.');return;}
      remember();const newId=`layer-${Date.now().toString(36)}`;state.layers.push({id:newId,name:`Слой ${state.layers.length+1}`,visible:true,locked:false});state.activeLayer=newId;
    }else if(action==='select'&&layer){state.activeLayer=id;}
    else if(action==='name'&&layer){const name=cleanName(value,'Слой',40);if(name!==layer.name){remember();layer.name=name;}}
    else if((action==='visible'||action==='locked')&&layer){remember();layer[action]=Boolean(value);}
    else if(action==='delete'&&layer){
      if(state.layers.length===1){toast('Оставьте хотя бы один слой.');return;}
      const remove=()=>{cancelModelEdit();remember();state.layers=state.layers.filter(l=>l.id!==id);state.strokes=state.strokes.filter(s=>(s.layer||'main')!==id);pruneConstraints();if(state.activeLayer===id)state.activeLayer=state.layers[0].id;renderDrawing();saveSoon();};
      if(state.strokes.some(s=>(s.layer||'main')===id)){confirmAction('Удалить слой?','Построения этого слоя будут удалены. Отмена вернёт слой вместе с рисунком.','Удалить',remove);return;}remove();return;
    }
    renderDrawing();saveSoon();
  }
  function setZoom(value,anchor){
    if(!Number.isFinite(value))return;
    const old=wrap.getBoundingClientRect(),viewport=stage.getBoundingClientRect();const target=anchor||{x:viewport.left+viewport.width/2,y:viewport.top+viewport.height/2};
    const fx=(target.x-old.left)/old.width,fy=(target.y-old.top)/old.height;
    zoom=clamp(value,1,5);fit();const next=wrap.getBoundingClientRect();stage.scrollLeft+=next.left+fx*next.width-target.x;stage.scrollTop+=next.top+fy*next.height-target.y;
  }
  function panTo(p){const r=wrap.getBoundingClientRect(),s=stage.getBoundingClientRect();stage.scrollLeft+=r.left+p.x/state.width*r.width-(s.left+s.width/2);stage.scrollTop+=r.top+p.y/state.height*r.height-(s.top+s.height/2);}
  function setModelSetting(key,value){
    if(key==='material'&&['plastic','aluminum','glass'].includes(value))state.modelMaterial=value;
    if(key==='xray')state.modelXray=Boolean(value);
    if(key==='bevel'){const next=clamp(Number(value)||0,0,2);if(next!==state.modelBevel){remember();state.modelBevel=next;}}
    if(key==='section'&&value&&typeof value==='object')state.modelSection={enabled:Boolean(value.enabled),axis:['x','y','z'].includes(value.axis)?value.axis:'x',position:clamp(Number.isFinite(Number(value.position))?Number(value.position):.5,0,1)};
    updateModel();renderDrawing();saveSoon();
  }
  function setSketchSetting(key,value){
    try{
      const checked=key==='mirrorAxis'?checkedAxis(value):key==='tracing'?checkedTracing(value):undefined;
      if(checked===undefined)return false;
      cancelModelEdit();cancelGesture();remember();state[key]=checked;renderDrawing();saveSoon();return true;
    }catch(error){toast(error.message);return false;}
  }
  let previewFeatureId=null;
  function beginModelEdit(){
    if(modelEditBefore)return true;
    endHeightEdit();cancelGesture();modelEditBefore=snapshot();editBodyIds=new Set((modelMesh?.bodies||[]).map(body=>body.id));previewFeatureId=`op-${Date.now().toString(36)}-${(++shapeSerial).toString(36)}`;
    clearTimeout(saveTimer);modelError='';pendingValidationError='';document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'modelpreview',active:true}}));return true;
  }
  function previewBodySetting(id,key,value){
    try{
      if(!validId(id)||!id.startsWith('body-')||!modelMesh?.bodies?.some(b=>b.id===id))throw new Error('Выберите деталь на холсте.');
      if(key==='offset'&&state.modelBodies[id]?.fixed)throw new Error('Снимите закрепление детали перед перемещением.');
      const next=bodyValue(key,value);beginModelEdit();pendingValidationError='';
      state.modelBodies[id]={...(state.modelBodies[id]||{}),[key]:next};
      const oldHeight=key==='height'?extrusionHeight(modelEditBefore,id):null;
      if(oldHeight!==null){
        const original=modelEditBefore.modelFeatures.filter(feature=>feature.target===id);
        const mounted=remountHeightFeatures(original,oldHeight,next);
        const byId=new Map(mounted.map(feature=>[feature.id,feature]));
        state.modelFeatures=state.modelFeatures.map(feature=>byId.get(feature.id)||feature);
      }
      const valid=updateModel(true)!==false;document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'bodysetting',id,key,preview:true}}));return valid;
    }catch(error){modelError=error.message;pendingValidationError=modelError;toast(modelError);return false;}
  }
  function commitModelEdit({sketchOnly=false}={}){
    if(!modelEditBefore)return true;
    if(pendingValidationError){modelError=pendingValidationError;toast(modelError);return false;}
    if((!sketchOnly||modelOpen)&&(updateModel(true)===false||modelError)){toast(modelError||'Проверьте параметры модели.');return false;}
    const before=modelEditBefore;modelEditBefore=null;previewFeatureId=null;editBodyIds=null;
    if(JSON.stringify({...before,measurementBook:null})!==JSON.stringify({...snapshot(),measurementBook:null}))remember(before);
    renderDrawing();saveSoon();document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'modelpreview',active:false,committed:true}}));return true;
  }
  function cancelModelEdit(){
    if(!modelEditBefore)return false;
    const before=modelEditBefore;modelEditBefore=null;previewFeatureId=null;editBodyIds=null;bodyHeightGesture=null;modelHeightDragging=false;restoreSnapshot(before);modelError='';pendingValidationError='';
    renderDrawing();updateModel(true);saveSoon();document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'modelpreview',active:false,committed:false}}));return true;
  }
  function setBodySetting(id,key,value,options={}){
    if(options.preview)return previewBodySetting(id,key,value);
    const wasEditing=Boolean(modelEditBefore);if(!previewBodySetting(id,key,value)){if(!wasEditing){const error=modelError;cancelModelEdit();modelError=error;toast(error);}return false;}
    return commitModelEdit();
  }
  function previewFeature(value){
    try{
      beginModelEdit();if(modelEditBefore.modelFeatures.length>=64)throw new Error('Можно добавить до 64 операций.');
      const feature=validatedFeature(value,previewFeatureId);
      const ids=editBodyIds||new Set((modelMesh?.bodies||[]).map(body=>body.id));if(!ids.has(feature.target)||feature.tool&&!ids.has(feature.tool))throw new Error('Выберите доступные детали на холсте.');
      pendingValidationError='';state.modelFeatures=[...clone(modelEditBefore.modelFeatures),feature];return updateModel(true)!==false;
    }catch(error){modelError=error.message;pendingValidationError=modelError;toast(modelError);return false;}
  }
  function addModelFeature(value,options={}){
    if(options.preview)return previewFeature(value);
    const wasEditing=Boolean(modelEditBefore);if(!previewFeature(value)){if(!wasEditing){const error=modelError;cancelModelEdit();modelError=error;toast(error);}return false;}return commitModelEdit();
  }
  function removeModelFeature(id){
    if(modelEditBefore){toast('Завершите текущий предпросмотр.');return false;}
    if(!state.modelFeatures.some(feature=>feature.id===id))return false;
    beginModelEdit();
    state.modelFeatures=state.modelFeatures.filter(feature=>feature.id!==id);
    if(commitModelEdit())return true;
    const error=modelError;
    cancelModelEdit();
    modelError=error;return false;
  }
  const mountTolerance=.001;
  function moveMountedFeature(feature, move, touches){
    if(['add','cut'].includes(feature.type)&&feature.points.every(touches))return {...feature,points:feature.points.map(move)};
    if(['text','fastener'].includes(feature.type)&&touches(feature.origin))return {...feature,origin:move(feature.origin)};
    if(feature.type==='pattern'&&feature.source.points.every(touches)){
      return {...feature,source:{...feature.source,points:feature.source.points.map(move)},
        ...(feature.center?{center:move(feature.center)}:{})};
    }
    return feature;
  }
  function mountChange(before,after){
    const oldDepth=before.type==='add'?before.depth:before.type==='cut'?-before.depth:null;
    if(oldDepth===null||before.type!==after.type)return null;
    const newDepth=after.type==='add'?after.depth:-after.depth;
    const oldOrigin=before.points[0],newOrigin=after.points[0],normal=before.normal;
    const delta=newOrigin.map((v,i)=>v-oldOrigin[i]+normal[i]*(newDepth-oldDepth));
    if(Math.hypot(...delta)<1e-7)return null;
    const axis=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
    const project=p=>p.filter((_,i)=>i!==axis);
    const outline=before.points.map(project);
    function touches(point){
      const separation=normal.reduce((sum,n,i)=>sum+n*(point[i]-oldOrigin[i]),0)-oldDepth;
      if(Math.abs(separation)>mountTolerance)return false;
      const [x,y]=project(point);
      let inside=false;
      for(let i=0,j=outline.length-1;i<outline.length;j=i++){
        const [a,b]=outline[i],[c,d]=outline[j];
        if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)inside=!inside;
      }
      return inside;
    }
    return {move:p=>p.map((x,i)=>x+delta[i]),touches};
  }
  function followMounts(feature, mounts){
    for(const {move,touches} of mounts){
      const moved=moveMountedFeature(feature,move,touches);
      if(moved!==feature)return moved;
    }
    return feature;
  }
  function previewExistingFeature(id, patch){
    beginModelEdit();
    try{
      const original=modelEditBefore.modelFeatures.find(feature=>feature.id===id);
      if(!original)throw new Error('Операция отсутствует в проекте.');
      const changed=validatedFeature({...original,...clone(patch),id,target:original.target},id);
      const near=(a,b)=>a.length===b.length&&a.every((x,i)=>Math.abs(x-b[i])<1e-6);
      const samePoints=(a,b)=>a.length===b.length&&a.every((p,i)=>near(p,b[i]));
      let updated=false;
      const mounts=[mountChange(original,changed)].filter(Boolean);
      state.modelFeatures=modelEditBefore.modelFeatures.map(feature=>{
        if(feature.id===id){updated=true;return changed;}
        if(!updated||feature.target!==original.target)return feature;
        if(feature.type==='pattern'&&
            ['add','cut'].includes(original.type)&&['add','cut'].includes(changed.type)&&
            feature.source.type===original.type&&feature.source.depth===original.depth&&
            samePoints(feature.source.points,original.points)&&near(feature.source.normal,original.normal)){
          return {...feature,source:{type:changed.type,points:changed.points,normal:changed.normal,depth:changed.depth}};
        }
        const moved=followMounts(feature,mounts),next=mountChange(feature,moved);
        if(next)mounts.push(next);
        return moved;
      });
      pendingValidationError='';
      return updateModel(true)!==false;
    }catch(error){pendingValidationError=modelError=error.message;return false;}
  }
  function extrusionHeight(project,id){
    const settings=project.modelBodies[id];
    return settings?.mode&&settings.mode!=='extrude'?null:settings?.height??project.modelHeight;
  }
  function remountHeightFeatures(features,oldHeight,newHeight){
    if(oldHeight===newHeight)return features;
    const atTop=point=>Math.abs(point[2]-oldHeight)<mountTolerance;
    const atBottom=point=>Math.abs(point[2])<mountTolerance;
    const lift=p=>[p[0],p[1],p[2]+newHeight-oldHeight];
    const mounts=[{move:lift,touches:atTop}];
    const throughCap=feature=>feature.type==='cut'&&feature.depth>=oldHeight-mountTolerance&&
      (feature.normal[2]>.99999&&feature.points.every(atTop)||feature.normal[2]<-.99999&&feature.points.every(atBottom));
    const resizedDepth=depth=>Math.min(200,newHeight+Math.max(0,depth-oldHeight));
    return features.map(feature=>{
      let moved=followMounts(feature,mounts);
      if(throughCap(feature))moved={...moved,depth:resizedDepth(feature.depth)};
      if(feature.type==='pattern'&&throughCap(feature.source)){
        moved={...moved,source:{...moved.source,depth:resizedDepth(feature.source.depth)}};
      }
      const next=mountChange(feature,moved);
      if(next)mounts.push(next);
      return moved;
    });
  }
  function sketchMovable(shape){
    const layer=state.layers.find(item=>item.id===shape.layer);
    return Boolean(layer?.visible&&!layer.locked);
  }
  function pruneConstraints(){
    const ids=new Set(state.strokes.map(shape=>shape.id));
    state.constraints=state.constraints.filter(({a,b})=>ids.has(a)&&ids.has(b));
    state.sketchDimensions=state.sketchDimensions.filter(dimension=>ids.has(dimension.shapeId));
  }
  function addConstraint(kind,a,b){
    if(!Constraints)return false;
    cancelModelEdit();
    try{
      const next=Constraints.validate([...state.constraints,{id:`link-${Date.now().toString(36)}-${(++shapeSerial).toString(36)}`,kind,a,b}],state.strokes);
      const source=state.strokes.find(shape=>shape.id===a);
      const target=state.strokes.find(shape=>shape.id===b);
      if(!sketchMovable(source)||!sketchMovable(target))throw new Error('Выберите построения на открытых и разблокированных слоях.');
      const solved=Constraints.solve(state.strokes,next,new Map([[a,source]]),sketchMovable,a);
      remember();
      state.strokes=state.strokes.map(shape=>solved.get(shape.id)||shape);
      state.constraints=next;renderDrawing();saveSoon();return true;
    }catch(error){toast(error.message);return false;}
  }
  function removeConstraint(id){
    cancelModelEdit();
    if(!state.constraints.some(relation=>relation.id===id))return false;
    remember();state.constraints=state.constraints.filter(relation=>relation.id!==id);
    renderDrawing();saveSoon();return true;
  }
  function setProjectionDimensions(values){
    if(modelEditBefore){toast('Завершите текущий предпросмотр.');return false;}
    try{
      const next=validateProjectionDimensions(values);
      if(JSON.stringify(next)===JSON.stringify(state.projectionDimensions))return true;
      remember();state.projectionDimensions=next;renderDrawing();saveSoon();return true;
    }catch(error){toast(error.message);return false;}
  }
  function removeSketchDimension(shapeId){
    if(modelEditBefore||!state.sketchDimensions.some(dimension=>dimension.shapeId===shapeId))return false;
    remember();state.sketchDimensions=state.sketchDimensions.filter(dimension=>dimension.shapeId!==shapeId);
    renderDrawing();saveSoon();return true;
  }
  function setDraftDesign(value){
    if(modelEditBefore){toast('Завершите текущий предпросмотр.');return false;}
    try{
      const next=validateDraftDesign(value);
      if(JSON.stringify(next)===JSON.stringify(state.draftDesign))return true;
      remember();state.draftDesign=next;saveSoon();
      document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'draftdesign'}}));
      return true;
    }catch(error){toast(error.message);return false;}
  }
  function setExperiment(value){
    if(modelEditBefore||heightEditBefore){toast('Завершите текущий предпросмотр.');return false;}
    try{
      const next=validateExperiment(value);
      if(JSON.stringify(next)===JSON.stringify(state.experiment))return true;
      remember();state.experiment=next;saveSoon();
      document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'experiment'}}));
      return true;
    }catch(error){toast(error.message);return false;}
  }
  function measurementId(prefix){
    return `${prefix}-${Date.now().toString(36)}-${(++shapeSerial).toString(36)}`;
  }
  function captureMeasurementVariant(book,value){
    const matches=record=>record.id===value?.id&&record.variantId===value?.variantId;
    const known=book.measurements.some(matches)||book.entries.some(entry=>matches(entry.sample));
    const stored=known&&book.variants.find(variant=>variant.id===value.variantId);
    if(stored)return {variant:stored,variants:book.variants};
    const project=variantProject(state),serialized=JSON.stringify(project);
    const matching=book.variants.find(variant=>JSON.stringify(variant.project)===serialized);
    if(matching)return {variant:matching,variants:book.variants};
    const variant={id:measurementId('variant'),project:JSON.parse(serialized)};
    return {variant,variants:[...book.variants,variant]};
  }
  function updateMeasurementBook(book,{removedMeasurement}={}){
    remember();state.measurementBook=book;
    if(removedMeasurement){
      state.draftDesign={...state.draftDesign,notes:state.draftDesign.notes.filter(note=>
        note.kind!=='measurement'||note.measurementId!==removedMeasurement)};
    }
    saveSoon();
    document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'measurement'}}));
  }
  function getCurrentMeasurements(){
    const book=state.measurementBook;
    if(!book.measurements.length)return [];
    const drawing=JSON.stringify(variantProject(state));
    const variants=new Set(book.variants.filter(variant=>JSON.stringify(variant.project)===drawing).map(variant=>variant.id));
    return clone(book.measurements.filter(record=>variants.has(record.variantId)));
  }
  function addMeasurement(value){
    if(modelEditBefore){toast('Завершите текущий предпросмотр.');return null;}
    try{
      const book=state.measurementBook;
      const existing=book.measurements.find(sample=>sample.id===value?.id);
      if(existing)return clone(existing);
      if(book.measurements.length>=100)throw new Error('Можно закрепить до 100 замеров.');
      const {variant,variants}=captureMeasurementVariant(book,value);
      const record=normalizeMeasurement(value,measurementId('measure'),variant.id);
      updateMeasurementBook({...book,measurements:[...book.measurements,record],variants});
      return clone(record);
    }catch(error){toast(error.message);return null;}
  }
  function addMeasurementEntry(value,{variant:variantName,expected,tolerance=null,note=''}={}){
    if(modelEditBefore){toast('Завершите текущий предпросмотр.');return null;}
    try{
      const book=state.measurementBook;
      if(book.entries.length>=100)throw new Error('В журнале помещается до 100 записей.');
      const {variant,variants}=captureMeasurementVariant(book,value);
      const sample=normalizeMeasurement(value,measurementId('measure'),variant.id);
      window.LabMeasurements.compare(sample.value,expected,tolerance);
      const entry={id:measurementId('entry'),sample,variant:cleanName(variantName,'Вариант',64),expected,tolerance,
        note:cleanName(note,'',240),createdAt:new Date().toISOString()};
      updateMeasurementBook({...book,entries:[...book.entries,entry],variants});
      return clone(entry);
    }catch(error){toast(error.message);return null;}
  }
  function removeMeasurementItem(key,id){
    const book=state.measurementBook,items=book[key];
    if(modelEditBefore||!items.some(item=>item.id===id))return false;
    updateMeasurementBook(compactMeasurementBook({...book,[key]:items.filter(item=>item.id!==id)}),{
      removedMeasurement:key==='measurements'?id:null
    });
    return true;
  }
  function replaceSketchShapes(values,options={}){
    if(!Array.isArray(values)||!values.length||values.length>MAX_STROKES)return false;
    try{
      const ids=new Set(),replacements=[];
      for(const value of values){
        const index=state.strokes.findIndex(shape=>shape.id===value?.id);if(index<0||ids.has(value.id))throw new Error('Не найдено исходное построение.');ids.add(value.id);
        const previous=state.strokes[index],layer=state.layers.find(l=>l.id===previous.layer);
        if(!layer?.visible||layer.locked)throw new Error('Для редактирования откройте и разблокируйте слой контура.');
        const candidate={...previous,...clone(value),id:previous.id,layer:previous.layer,color:previous.color,width:previous.width};
        delete candidate.mirrorOf;delete candidate.mirrorAxis;delete candidate.sketchDefinition;
        const checked=validateProject({...state,tracing:null,strokes:[candidate],constraints:[],modelBodies:{},modelFeatures:[]},{geometryOnly:true}).strokes[0];
        if(previous.mirrorOf){checked.mirrorOf=previous.mirrorOf;checked.mirrorAxis=previous.mirrorAxis;}
        if(JSON.stringify([checked.points,checked.a,checked.b,checked.cx,checked.cy,checked.r,checked.start,checked.delta])!==JSON.stringify([previous.points,previous.a,previous.b,previous.cx,previous.cy,previous.r,previous.start,previous.delta]))replacements.push({index,shape:checked});
      }
      beginModelEdit();pendingValidationError='';
      const changed=new Map(replacements.map(item=>[item.shape.id,item.shape]));
      Constraints?.solve(state.strokes,state.constraints,changed,sketchMovable,options.driverId);
      for(const shape of changed.values())delete shape.sketchDefinition;
      for(const reflected of state.strokes.filter(shape=>shape.mirrorOf)){
        const source=state.strokes.find(shape=>shape.id===reflected.mirrorOf);
        if(!source)continue;
        const edited=changed.get(source.id)||changed.get(reflected.id);
        if(!edited)continue;
        const original=edited.id===source.id?source:reflected,other=edited.id===source.id?reflected:source;
        if(edited.points&&original.points&&original.points.length===edited.points.length){
          for(const i of [0,edited.points.length-1]){
            if(I.distance(original.points[i],axisProjection(original.points[i],reflected.mirrorAxis))<.001)edited.points[i]=axisProjection(edited.points[i],reflected.mirrorAxis);
          }
        }
        changed.set(other.id,reflectInto(edited,other,reflected.mirrorAxis));
      }
      const strokes=state.strokes.map(shape=>changed.get(shape.id)||shape);
      if(pathPointCount(strokes)>Math.max(MAX_DRAWING_POINTS,pathPointCount(state.strokes)))throw new Error(drawingPointLimitMessage);
      if(options.sketchDimension){
        const dimension=options.sketchDimension;
        state.sketchDimensions=validateSketchDimensions([
          ...state.sketchDimensions.filter(item=>item.shapeId!==dimension.shapeId),dimension
        ],strokes);
      }
      state.strokes=strokes;
      renderDrawing();const valid=options.sketchOnly&&!modelOpen||updateModel(true)!==false;
      if(options.preview)return valid;if(valid)return commitModelEdit(options);const error=modelError;cancelModelEdit();modelError=error;return false;
    }catch(error){modelError=error.message;pendingValidationError=modelError;toast(modelError);return false;}
  }
  function replaceSketchShape(id,value,options={}){return replaceSketchShapes([{...value,id}],options);}
  function applySketchUpgrade({add=[],replace=[],settings}={}){
    sketchUpgradeError='';
    try{
      if(!SketchUpgrade||modelEditBefore||heightEditBefore)throw new Error('Завершите текущий предпросмотр.');
      if(!Array.isArray(add)||!Array.isArray(replace)||add.length+replace.length>MAX_STROKES)throw new Error('Проверьте список построений.');
      if(add.length&&!canDraw())return false;
      const sketchUpgrade=SketchUpgrade.settings(settings??state.sketchUpgrade);
      const values=SketchUpgrade.parameterValues(sketchUpgrade);
      const edits=new Map();
      for(const value of replace){
        const prior=state.strokes.find(shape=>shape.id===value?.id);
        if(!prior||edits.has(prior.id)||!sketchMovable(prior))throw new Error('Выберите построение на видимом разблокированном слое.');
        if(prior.mirrorOf)throw new Error('Для изменения зеркальной пары выберите исходное построение.');
        edits.set(prior.id,{...prior,...value,id:prior.id,layer:prior.layer,color:prior.color,width:prior.width});
      }
      const raw=state.strokes.map(shape=>{
        const next=edits.get(shape.id)||shape;
        if(!settings||!next.sketchDefinition)return next;
        const generated=SketchUpgrade.fromDefinition(next.sketchDefinition,values);
        if(JSON.stringify([next.points,next.a,next.b])!==JSON.stringify([generated.points,generated.a,generated.b])&&!sketchMovable(next)){
          throw new Error('Разблокируйте и покажите слой параметрического построения.');
        }
        return {...next,...generated};
      });
      for(const sketch of add){
        const id=`shape-${Date.now().toString(36)}-${(++shapeSerial).toString(36)}`;
        const source={color:state.color,width:state.strokeWidth,...sketch,id,layer:state.activeLayer};
        raw.push(source);
        if(state.mirrorAxis&&needsReflection(source,state.mirrorAxis)){
          raw.push({...reflectedShape(source,state.mirrorAxis),id:`${id}-m`,mirrorOf:id,mirrorAxis:clone(state.mirrorAxis)});
        }
      }
      const next=validateProject({...state,sketchUpgrade,strokes:raw,tracing:null},{geometryOnly:true});
      if(pathPointCount(next.strokes)>Math.max(MAX_DRAWING_POINTS,pathPointCount(state.strokes)))throw new Error(drawingPointLimitMessage);
      if(next.constraints.length&&(replace.length||settings)){
        const checked=new Map(next.strokes.map(shape=>[shape.id,shape]));
        const residual=SketchUpgrade.constraintReport(next.strokes,next.constraints);
        const alreadyUnmet=new Set(SketchUpgrade.constraintReport(state.strokes,state.constraints).unmet);
        if(residual.unmet.some(id=>!alreadyUnmet.has(id))){
          const adjusted=new Map([...edits.keys()].map(id=>[id,checked.get(id)]));
          if(settings||!adjusted.size)throw new Error('Параметры конфликтуют со связями эскиза.');
          Constraints?.solve(state.strokes,state.constraints,adjusted,sketchMovable,replace[0].id);
          for(const [id,shape] of adjusted)if(!edits.has(id))delete shape.sketchDefinition;
          next.strokes=next.strokes.map(shape=>adjusted.get(shape.id)||shape);
          if(SketchUpgrade.constraintReport(next.strokes,next.constraints).unmet.some(id=>!alreadyUnmet.has(id))){
            throw new Error('Построение конфликтует со связями эскиза.');
          }
        }
      }
      const oldHeight=state.modelHeight;
      if(sketchUpgrade.height&&settings&&next.modelHeight!==oldHeight){
        const mounted=new Map();
        for(const id of new Set(state.modelFeatures.map(feature=>feature.target))){
          if(extrusionHeight(state,id)!==oldHeight||state.modelBodies[id]?.height!==undefined)continue;
          for(const feature of remountHeightFeatures(state.modelFeatures.filter(feature=>feature.target===id),oldHeight,next.modelHeight))mounted.set(feature.id,feature);
        }
        next.modelFeatures=state.modelFeatures.map(feature=>mounted.get(feature.id)||feature);
      }
      if(settings&&window.LabExtrusion){
        const before=modelStrokes();
        if(before.length&&window.LabExtrusion.analyze(before,{tolerance:8}).ok){
          const visibleLayers=new Set(next.layers.filter(layer=>layer.visible).map(layer=>layer.id));
          const strokes=next.strokes.filter(shape=>!shape.construction&&visibleLayers.has(shape.layer));
          const analysis=window.LabExtrusion.analyze(strokes,{tolerance:8});
          if(!analysis.ok)throw new Error(analysis.errors?.[0]?.message||'Формулы нарушают замкнутый контур.');
          if(next.modelFeatures.length||Object.keys(next.modelBodies).length){
            window.LabSolid?.build(analysis,{strokes,height:next.modelHeight,bevel:next.modelBevel,bodies:next.modelBodies,features:next.modelFeatures});
          }
        }
      }
      cancelGesture();remember();state.strokes=next.strokes;state.sketchUpgrade=sketchUpgrade;
      state.modelHeight=next.modelHeight;state.modelFeatures=next.modelFeatures;
      syncModelHeight();renderDrawing();saveSoon();return true;
    }catch(error){sketchUpgradeError=error.message;toast(sketchUpgradeError);return false;}
  }
  function saveCamera(name){
    const camera=modelViewer?.getCamera?.();if(!camera)return;
    if(state.savedViews.length>=12){toast('Можно сохранить до 12 видов.');return;}
    state.savedViews.push({id:Date.now().toString(36),name:cleanName(name,`Вид ${state.savedViews.length+1}`,32),camera});saveSoon();document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'views'}}));toast('Положение камеры сохранено.');
  }
  function deleteCamera(id){state.savedViews=state.savedViews.filter(view=>view.id!==id);saveSoon();document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'views'}}));}
  function exportModel(format){
    if(modelEditBefore){toast('Подтвердите или отмените предпросмотр перед скачиванием.');return;}
    if(modelNeedsBuild&&updateModel(true,{forProjection:true})!==true){toast('Завершите построение модели перед скачиванием.');return;}
    if(!modelMesh){toast('Сначала создайте объём из замкнутого контура.');return;}
    try{
      const output=window.LabModelExport;
      const options={material:state.modelMaterial};
      const blob=format==='stl'?output.stl(modelMesh):format==='3mf'?output.threeMF(modelMesh,options):output.glb(modelMesh,options);
      download(blob,format);toast(`Модель ${format.toUpperCase()} передана в загрузки.`);
    }catch{toast('Не удалось сохранить 3D-модель. Проверьте построение.');}
  }
  function toast(message) { $('toast').textContent=message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4200); }
  function clearGuides(){if($('smart-guides'))$('smart-guides').replaceChildren();}
  const spatialIndex=window.LabSketchSpatialIndex.create(()=>state);
  const {getSketchHits}=spatialIndex;
  const {hits}=window.LabSketchSpatialIndex;
  function smartPoint(raw){
    const origin=draft?.type==='line'?draft.a:state.tool==='contour'?contourPoints.at(-1):null;
    const {result,guides,labels}=spatialIndex.snap(raw,origin,10/(fitScale*zoom));
    const layer=$('smart-guides');
    if(layer){
      const scale=1/(fitScale*zoom),color='#7599B8';
      layer.innerHTML=guides.map(([a,b])=>`<line x1="${num(a.x)}" y1="${num(a.y)}" x2="${num(b.x)}" y2="${num(b.y)}" stroke="${color}" stroke-width="${scale}" stroke-dasharray="${4*scale} ${4*scale}"/>`).join('')+(labels.length?`<text x="${num(result.x+13*scale)}" y="${num(result.y-12*scale)}" font-family="sans-serif" font-size="${10*scale}" fill="#527B9D">${labels.join(' · ')}</text>`:'');
    }
    return result;
  }
  function point(event, snap=false) {
    const p = new DOMPoint(event.clientX,event.clientY).matrixTransform(paper.getScreenCTM().inverse());
    let value={x:clamp(p.x,0,state.width),y:clamp(p.y,0,state.height)};
    if(snap&&state.snap){value=smartPoint(value);showSnap(value);}else if(snap)clearGuides();
    if(snap&&state.mirrorAxis){const q=axisProjection(value,state.mirrorAxis);if(I.distance(q,value)<7/(fitScale*zoom))value=q;}
    return value;
  }
  function style() { return {color:state.color,width:state.strokeWidth}; }
  function arcPath(shape) {
    const start=I.pointOnCircle({x:shape.cx,y:shape.cy},shape.r,shape.start);
    let d=`M ${num(start.x)} ${num(start.y)}`;
    const count=Math.max(1,Math.ceil(Math.abs(shape.delta)/170));
    for(let j=1;j<=count;j++){
      const end=I.pointOnCircle({x:shape.cx,y:shape.cy},shape.r,shape.start+shape.delta*j/count);
      d+=` A ${num(shape.r)} ${num(shape.r)} 0 0 ${shape.delta>0?1:0} ${num(end.x)} ${num(end.y)}`;
    }
    return d;
  }
  function shapeMarkup(shape) {
    const attributes=`fill="none" stroke="${shape.color}" stroke-width="${shape.width}" stroke-linecap="round" stroke-linejoin="round"${shape.construction?' stroke-dasharray="7 5"':''}`;
    if(shape.type==='circle') return `<circle cx="${num(shape.cx)}" cy="${num(shape.cy)}" r="${num(shape.r)}" ${attributes}/>`;
    if(shape.type==='line') return `<line x1="${num(shape.a.x)}" y1="${num(shape.a.y)}" x2="${num(shape.b.x)}" y2="${num(shape.b.y)}" ${attributes}/>`;
    if(shape.type==='arc') return `<path d="${arcPath(shape)}" ${attributes}/>`;
    if(shape.type==='path'){
      if(shape.points.length===1)return `<circle cx="${num(shape.points[0].x)}" cy="${num(shape.points[0].y)}" r="${shape.width/2}" fill="${shape.color}"/>`;
      return `<polyline points="${shape.points.map(p=>`${num(p.x)},${num(p.y)}`).join(' ')}" ${attributes}/>`;
    }
    return '';
  }
  function draftMarkup(shape){
    if(!shape)return '';
    const markup=shapeMarkup(shape),axis=state.mirrorAxis;
    if(!axis||!needsReflection(shape,axis))return markup;
    return markup+`<g opacity=".65">${shapeMarkup(reflectedShape(shape,axis))}</g>`;
  }
  function gridDefs(forExport=false) {
    if(forExport)return `<pattern id="grid-small" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 H 0 V 20" fill="none" stroke="#EDF1F5" stroke-width=".7"/></pattern><pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#grid-small)"/><path d="M 100 0 H 0 V 100" fill="none" stroke="#DCE4EC" stroke-width=".9"/></pattern>`;
    return `<pattern id="grid-fine" width="4" height="4" patternUnits="userSpaceOnUse"><path id="grid-fine-lines" d="M 4 0 H 0 V 4" fill="none" stroke="#E4EBF2" stroke-width=".25" opacity="0"/></pattern><pattern id="grid-small" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="url(#grid-fine)"/><path id="grid-minor-lines" d="M 20 0 H 0 V 20" fill="none" stroke="#E3EAF1" stroke-width=".7"/></pattern><pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#grid-small)"/><path d="M 100 0 H 0 V 100" fill="none" stroke="#DCE4EC" stroke-width=".9"/></pattern>`;
  }
  function updateGrid(){
    const spacing=20*fitScale*zoom;
    $('grid-minor-lines')?.setAttribute('opacity',String(clamp((spacing-3)/14,.15,1)));
    $('grid-fine-lines')?.setAttribute('opacity',String(zoom>2.5?clamp((zoom-2.5)/2.5,0,.7):0));
  }
  function readableStrokes(draftOnly=false){
    // Keep fine lines legible when an entire A4 sheet fits a phone. Export uses
    // the original stroke-width attributes and retains the specified millimetres.
    for(const id of (draftOnly?['draft-layer']:['drawing-layer','draft-layer']))for(const shape of $(id).children){
      const width=Number(shape.getAttribute('stroke-width'));
      if(width>0){shape.style.vectorEffect='non-scaling-stroke';shape.style.strokeWidth=`${Math.max(.72,width*fitScale*zoom)}px`;}
    }
  }
  function syncHistoryControls(){
    $('undo').disabled=history.length===0&&contourPoints.length===0;
    $('redo').disabled=future.length===0||contourPoints.length>0;
  }
  function renderDrawing() {
    $('drawing-layer').innerHTML=state.strokes.map((shape,index)=>layerVisible(shape)?shapeMarkup(shape).replace(/^<(\w+)/,`<$1 data-shape-index="${index}"`):'').join('');
    $('draft-layer').innerHTML=draftMarkup(draft);
    $('grid-layer').style.display=state.grid?'':'none';
    $('sheet-name').textContent=state.strokes.length?'Мой чертёж':'Чистый лист';
    syncHistoryControls();
    $('clear').disabled=state.strokes.length===0;
    readableStrokes();
    scheduleModel();
    document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'drawing'}}));
  }
  function renderTools() {
    const scale=Math.max(1,1/(fitScale*zoom));
    $('instrument-layer').innerHTML=state.tool==='ruler'?I.renderRuler(state.ruler,scale):state.tool==='compass'?I.renderCompass(state.compass,scale):'';
    renderer?.render({width:state.width,height:state.height,tool:state.tool,ruler:state.ruler,compass:state.compass});
  }
  function fit() {
    const padding=getComputedStyle(stage);
    fitScale=Math.max(.05,Math.min((stage.clientWidth-parseFloat(padding.paddingLeft)-parseFloat(padding.paddingRight))/state.width,(stage.clientHeight-parseFloat(padding.paddingTop)-parseFloat(padding.paddingBottom))/state.height));
    wrap.style.width=`${state.width*fitScale*zoom}px`;wrap.style.height=`${state.height*fitScale*zoom}px`;
    $('zoom-label').textContent=`${Math.round(zoom*100)}%`;
    $('zoom-out').disabled=zoom<=1;$('zoom-in').disabled=zoom>=5;
    renderTools();renderContour();readableStrokes();updateGrid();
    document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'viewport'}}));
  }
  function renderAll() {
    paper.setAttribute('viewBox',`0 0 ${state.width} ${state.height}`);
    $('instrument-svg').setAttribute('viewBox',`0 0 ${state.width} ${state.height}`);
    $('paper-defs').innerHTML=gridDefs()+I.defs();
    $('sheet-meta').textContent=`А4 · ${state.orientation==='landscape'?'горизонтальный':'вертикальный'}`;
    $('snap').checked=state.snap;
    $('toggle-grid').classList.toggle('active',state.grid);$('toggle-grid').setAttribute('aria-pressed',String(state.grid));
    renderDrawing(); renderInspector(); fit();
    document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'project'}}));
  }
  function renderInspector() {
    const tool=tools[state.tool];
    $('tool-title').textContent=tool.title;$('instrument-number').textContent=tool.number;$('tool-description').textContent=tool.description;
    $('tool-hint').lastElementChild.textContent=tool.hint;$('instruction-text').textContent=tool.instruction;
    document.querySelectorAll('[data-tool]').forEach(button=>{const chosen=button.dataset.tool===state.tool;button.classList.toggle('active',chosen);button.setAttribute('aria-pressed',String(chosen));});
    wrap.style.cursor=state.tool==='eraser'?'cell':state.tool==='ruler'||state.tool==='compass'?'default':'crosshair';
    if(state.tool==='ruler') $('tool-options').innerHTML=`<label class="section-label" for="angle">Угол поворота <span>0–359°</span></label><div class="value-field"><input id="angle" type="number" min="0" max="359" step="1" value="${Math.round(state.ruler.angle)}" aria-label="Угол линейки"><span>°</span></div><div class="angle-presets"><button data-rotate="-15" title="Повернуть на 15° влево">−15°</button><button data-angle="0">0°</button><button data-angle="45">45°</button><button data-angle="90">90°</button><button data-rotate="15" title="Повернуть на 15° вправо">+15°</button></div><button class="small-button" id="center-tool">По центру листа</button>`;
    else if(state.tool==='compass') $('tool-options').innerHTML=`<label class="section-label" for="radius">Радиус <span>на листе</span></label><div class="value-field"><input id="radius" type="number" min="8" max="${Math.floor(maxRadius()/MM)}" step="1" value="${num(state.compass.radius/MM)}" aria-label="Радиус окружности"><span>мм</span></div><button class="small-button" id="draw-circle">Начертить окружность</button>`;
    else if(state.tool==='eraser') $('tool-options').innerHTML='<p>Удаляет целое построение.<br>Отмена всегда под рукой.</p>';
    else if(state.tool==='contour') $('tool-options').innerHTML='<p class="contour-counter" id="contour-counter">Нажмите на лист, чтобы начать.</p><div class="contour-actions"><button id="close-contour" disabled>Замкнуть</button><button id="cancel-contour" disabled>Сбросить</button></div><p class="contour-note">Вершины — касанием. Первая точка замыкает фигуру.</p><button id="contour-to-model" class="contour-start-button">Создать объём ↗</button>';
    else $('tool-options').innerHTML=`<p>${state.tool==='line'?'От точки к точке.<br>Удерживайте Shift для шага 15°.':'Свободная линия.<br>Нажмите на лист и рисуйте.'}</p>`;
    $('stroke-settings').style.opacity=state.tool==='eraser'?'.35':'1';
    $('model-tool-name').textContent=tool.title;
    updateStyleControls();syncContourControls();
  }
  function updateStyleControls() {
    document.querySelectorAll('[data-color]').forEach(button=>{const chosen=button.dataset.color===state.color;button.classList.toggle('selected',chosen);button.setAttribute('aria-pressed',String(chosen));if(chosen)$('color-name').textContent=button.dataset.name;});
    $('stroke-width').value=state.strokeWidth;$('width-label').textContent=`${fmt(state.strokeWidth/MM)} мм`;
    $('line-preview').style.height=`${state.strokeWidth}px`;$('line-preview').style.background=state.color;
  }
  function syncMeasure() {
    if($('angle'))$('angle').value=Math.round(state.ruler.angle);
    if($('radius'))$('radius').value=num(state.compass.radius/MM);
  }
  function snapshot(strokes=state.strokes){
    const {mirrorAxis,constraints,projectionDimensions,sketchDimensions,sketchUpgrade,draftDesign,layers,activeLayer,
      modelHeight,modelBevel,modelBodies,modelFeatures,tracing,measurementBook,experiment}=state;
    return {...clone({mirrorAxis,strokes,constraints,projectionDimensions,sketchDimensions,sketchUpgrade,draftDesign,layers,activeLayer,
      modelHeight,modelBevel,modelBodies,modelFeatures,experiment}),tracing,measurementBook};
  }
  function restoreSnapshot(value){Object.assign(state,value);syncModelHeight();}
  function documentSnapshot(){return {project:clone(state)};}
  function historyPreviews(makeThumbnail) {
    if (typeof makeThumbnail !== 'function') return [];
    return history.slice(-8).reverse().map((entry,index) => {
      const project=entry.project||{...state,...entry};
      return {steps:index+1,shapes:project.strokes.length,operations:project.modelFeatures.length,thumbnail:makeThumbnail(project)};
    });
  }
  function restoreHistoryPreview(steps) {
    if (!Number.isInteger(steps)||steps<1||steps>8||modelEditBefore||gesture||contourPoints.length) return false;
    const entry=history[history.length-steps];
    if (!entry) return false;
    return loadProject(entry.project||{...state,...entry});
  }
  function restoreHistoryItem(item){
    if(!item.project){restoreSnapshot(item);return false;}
    dispatchProject('projectwillload');
    state=item.project;zoom=1;renderAll();dispatchProject('projectload');return true;
  }
  function remember(before=state.strokes) {
    if(Array.isArray(before))history.push(snapshot(before));
    else{
      const {tracing,measurementBook,...geometry}=before;
      history.push({...clone(geometry),tracing,measurementBook});
    }
    if(history.length>60)history.shift();
    future=[];
    syncHistoryControls();
  }
  const drawingPointLimitMessage='На листе достигнут предел в 250 000 точек. Удалите лишние штрихи или начните новый лист.';
  function pathPointCount(strokes){return strokes.reduce((count,shape)=>count+(shape.points?.length||0),0);}
  function addShape(shape) {
    if(!canDraw())return;
    const mirror=state.mirrorAxis&&needsReflection(shape,state.mirrorAxis),copies=mirror?2:1;
    if(state.strokes.length+copies>MAX_STROKES){toast('Лист заполнен. Сохраните проект и начните новый.');return;}
    if(shape.points?.length&&pathPointCount(state.strokes)+shape.points.length*copies>MAX_DRAWING_POINTS){toast(drawingPointLimitMessage);return;}
    cancelModelEdit();const id=`shape-${Date.now().toString(36)}-${(++shapeSerial).toString(36)}`;remember();const source={...clone(shape),id,layer:state.activeLayer};state.strokes.push(source);
    if(mirror){
      const mirrored=reflectedShape(source,state.mirrorAxis);
      state.strokes.push({...mirrored,id:`${id}-m`,mirrorOf:id,mirrorAxis:clone(state.mirrorAxis)});
    }
    renderDrawing();saveSoon();return id;
  }
  function undo() {cancelModelEdit();endHeightEdit();cancelGesture();if(contourPoints.length){contourPoints.pop();contourHover=null;renderContour();renderDrawing();syncContourControls();return;}if(!history.length)return;const before=clone(state.strokes),item=history.pop();future.push(item.project?documentSnapshot():snapshot());if(!restoreHistoryItem(item)){renderDrawing();historyEffect(before,state.strokes);}saveSoon();}
  function redo() {cancelModelEdit();endHeightEdit();cancelGesture();if(contourPoints.length||!future.length)return;const before=clone(state.strokes),item=future.pop();history.push(item.project?documentSnapshot():snapshot());if(!restoreHistoryItem(item)){renderDrawing();historyEffect(before,state.strokes);}saveSoon();}
  function saveSoon() {
    if(!started||modelEditBefore)return;
    savePending=true;
    clearTimeout(saveTimer);
    $('save-status').lastChild.textContent=' Сохраняется…';
    saveTimer=setTimeout(saveNow,350);
  }
  function showStorageWarning(kind) {
    $('save-status').lastChild.textContent=' Сохраните проект в файл';
    if(storageWarning===kind)return;
    storageWarning=kind;
    toast(kind==='conflict'
      ? 'Проект в браузере изменился в другой вкладке. Скачайте этот чертёж в JSON, чтобы сохранить его отдельно.'
      : 'Автосохранение недоступно. Скачайте JSON через «Сохранить».');
  }
  function saveNow() {
    if(!started||!savePending)return false;
    clearTimeout(saveTimer);
    try {
      const committed=modelEditBefore?{...state,...modelEditBefore}:state;
      const source=JSON.stringify(committed);
      if(source!==savedDocument){
        // Compare with the copy this tab opened before replacing the shared autosave.
        if(localStorage.getItem(STORAGE_KEY)!==savedSource){showStorageWarning('conflict');return false;}
        localStorage.setItem(STORAGE_KEY,source);
        savedSource=savedDocument=source;
      }
      savePending=false;
      storageWarning=null;
      $('save-status').lastChild.textContent=' Сохранено в браузере';
      return true;
    } catch {
      showStorageWarning('unavailable');
      return false;
    }
  }
  function maxRadius(){return Math.min(state.width,state.height)*.44;}
  function setTool(tool){if(!Object.hasOwn(tools,tool))return;cancelGesture();if(tool!==state.tool&&contourPoints.length){resetContour();toast('Незавершённый контур сброшен. Готовые фигуры на месте.');}panMode=false;$('pan').setAttribute('aria-pressed','false');state.tool=tool;renderInspector();renderTools();saveSoon();document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'tool'}}));}
  function constrainCenter(p){return {x:clamp(p.x,20,state.width-20),y:clamp(p.y,20,state.height-20)};}
  function placeHistoryControls(){
    const header=document.querySelector('.header-actions');header.insertBefore(historyActions,header.firstElementChild);
    fit();
  }

  function syncContourControls(){
    if($('contour-counter'))$('contour-counter').textContent=contourPoints.length?`Вершин: ${contourPoints.length}. ${contourPoints.length<3?'Добавьте ещё точки.':'Можно замкнуть фигуру.'}`:'Нажмите на лист, чтобы начать.';
    if($('close-contour'))$('close-contour').disabled=contourPoints.length<3;
    if($('cancel-contour'))$('cancel-contour').disabled=contourPoints.length===0;
    if($('contour-to-model'))$('contour-to-model').hidden=modelOpen;
  }
  function renderContour(){
    if(!contourPoints.length){$('contour-layer').innerHTML='';return;}
    const scale=1/(fitScale*zoom),first=contourPoints[0],last=contourPoints.at(-1);
    const close=contourPoints.length>=3&&contourHover&&I.distance(contourHover,first)<16*scale;
    const hover=close?first:contourHover;
    let markup=`<polyline points="${contourPoints.map(p=>`${num(p.x)},${num(p.y)}`).join(' ')}" fill="none" stroke="${state.color}" stroke-width="${state.strokeWidth}" stroke-linejoin="round"/>`;
    if(hover)markup+=`<line x1="${num(last.x)}" y1="${num(last.y)}" x2="${num(hover.x)}" y2="${num(hover.y)}" stroke="#7F98B2" stroke-width="${1.2*scale}" stroke-dasharray="${5*scale} ${4*scale}"/>`;
    markup+=`<circle cx="${num(first.x)}" cy="${num(first.y)}" r="${14*scale}" fill="${close?'#AEC4DA':'#DFE8F0'}" fill-opacity=".65"/>`;
    contourPoints.forEach((p,i)=>{markup+=`<circle cx="${num(p.x)}" cy="${num(p.y)}" r="${(i===0?5:3.2)*scale}" fill="${i===0?'#566F89':'white'}" stroke="#566F89" stroke-width="${1.4*scale}"/>`;});
    if(contourPoints.length>=3)markup+=`<text x="${num(first.x+19*scale)}" y="${num(first.y-12*scale)}" font-family="sans-serif" font-size="${10*scale}" fill="#566F89">Замкнуть</text>`;
    if(state.mirrorAxis){
      const preview={type:'path',points:hover?[...contourPoints,hover]:contourPoints,...style()};
      if(needsReflection(preview,state.mirrorAxis))markup+=`<g opacity=".65">${shapeMarkup(reflectedShape(preview,state.mirrorAxis))}</g>`;
    }
    $('contour-layer').innerHTML=markup;
  }
  function addContourPoint(p){
    if(contourPoints.length>=3&&I.distance(p,contourPoints[0])<16/(fitScale*zoom)){finishContour();return;}
    if(contourPoints.length&&I.distance(p,contourPoints.at(-1))<1)return;
    if(contourPoints.length>=500){toast('В контуре уже 500 вершин. Замкните фигуру.');return;}
    contourPoints.push(p);contourHover=null;renderContour();syncContourControls();renderDrawing();
  }
  function finishContour(){
    if(contourPoints.length<3)return;clearGuides();
    const points=contourPoints.map(p=>({...p})),axis=state.mirrorAxis;
    const half=axis&&[points[0],points.at(-1)].every(p=>I.distance(p,axisProjection(p,axis))<7/(fitScale*zoom));
    if(half){points[0]=axisProjection(points[0],axis);points[points.length-1]=axisProjection(points.at(-1),axis);}else points.push({...points[0]});
    contourPoints=[];contourHover=null;renderContour();syncContourControls();
    const shapeId=addShape({type:'path',points,...style()});
    if(!shapeId)return;
    document.dispatchEvent(new CustomEvent('labcontourclosed',{detail:{shapeId}}));
    toast('Контур замкнут. Внутри можно начертить отверстие.');
  }
  function resetContour(){clearGuides();contourPoints=[];contourHover=null;renderContour();syncContourControls();renderDrawing();}
  function setModelOpen(open){
    cancelGesture();if(!open){modelViewer?.finishHeightGesture?.();endHeightEdit();}modelOpen=Boolean(open);
    document.querySelector('.workspace').classList.toggle('model-open',open);
    $('model-panel').hidden=!open;
    if(open){
      if(!modelViewer&&window.LabModelViewer)modelViewer=new window.LabModelViewer($('model-canvas'));
      syncModelHeight();syncContourControls();fit();updateModel();
      requestAnimationFrame(()=>modelViewer?.resize());
    }else{
      abortModelJob();
      $('diagnostic-layer').innerHTML='';$('profile-layer').innerHTML='';
      syncContourControls();fit();$('open-model').focus();
    }
    document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'model',open}}));
  }
  function syncWorkspaceView(){
    const current=window.LabDrawingSheet?.active()?'draft':modelOpen?'model':'sheet';
    for(const button of $('workspace-views').querySelectorAll('[data-view]')){
      button.setAttribute('aria-pressed',String(button.dataset.view===current));
    }
  }
  function getProjectionMesh(){
    if(modelEditBefore||heightEditBefore||contourPoints.length||window.LabCAD?.getState().task){
      toast('Завершите текущий контур или операцию перед построением видов.');
      return null;
    }
    if(updateModel(true,{forProjection:true})===true)return modelMesh;
    toast(modelError||'Начертите замкнутый контур, чтобы получить виды на листе А4.');
    return null;
  }
  function syncModelHeight(){
    $('model-height').value=state.modelHeight;$('model-height-range').value=state.modelHeight;
    if($('model-height-hud')){$('model-height-hud').textContent=`${fmt(state.modelHeight)} мм`;$('model-height-hud').hidden=!modelHeightDragging;}
  }
  function beginHeightEdit(){if(modelEditBefore)cancelModelEdit();if(!heightEditBefore)heightEditBefore=snapshot();}
  function applyModelHeight(value){
    if(!Number.isFinite(value))return;
    if(!heightEditBefore)beginHeightEdit();
    const height=Math.round(clamp(value,1,200)*10)/10;
    const currentHeight=state.modelHeight,currentFeatures=state.modelFeatures;
    const groups=new Map();
    for(const feature of heightEditBefore.modelFeatures){
      if(heightEditBefore.modelBodies[feature.target]?.height!==undefined||extrusionHeight(heightEditBefore,feature.target)===null)continue;
      if(!groups.has(feature.target))groups.set(feature.target,[]);
      groups.get(feature.target).push(feature);
    }
    const mounted=new Map();
    for(const features of groups.values()){
      for(const feature of remountHeightFeatures(features,heightEditBefore.modelHeight,height))mounted.set(feature.id,feature);
    }
    state.modelHeight=height;
    state.modelFeatures=heightEditBefore.modelFeatures.map(feature=>mounted.get(feature.id)||feature);
    if(updateModel()===false){
      const error=modelError;
      state.modelHeight=currentHeight;state.modelFeatures=currentFeatures;
      updateModel();toast(error);return;
    }
    syncModelHeight();saveSoon();
    document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'height'}}));
  }
  function endHeightEdit(){
    if(!heightEditBefore)return;
    const before=heightEditBefore;heightEditBefore=null;
    if(before.modelHeight!==state.modelHeight){
      if(state.sketchUpgrade?.height)state.sketchUpgrade={...state.sketchUpgrade,height:''};
      remember(before);renderDrawing();saveSoon();
    }
  }
  function scheduleModel(){
    if(!modelOpen)return;
    clearTimeout(modelTimer);
    abortModelJob();
    modelNeedsBuild=true;
    modelTimer=setTimeout(backgroundModel,130);
  }
  function abortModelJob(){
    if(!modelJob)return;
    modelJob.terminate();
    modelJob=null;
    const button=$('model-cancel-build');
    if(button)button.hidden=true;
  }
  function backgroundModel(){
    const strokes=modelStrokes();
    const complexity=strokes.reduce((score,stroke)=>score+(stroke.points?.length||2),0);
    const heavy=complexity>=450||state.modelFeatures.length>=2;
    if(!heavy||!modelOpen||contourPoints.length||modelEditBefore||heightEditBefore||
       typeof Worker!=='function'||typeof location==='undefined'||location.protocol==='file:'||modelWorkerDisabled){
      updateModel();return;
    }
    const source=JSON.stringify(strokes), cad=JSON.stringify([state.modelBodies,state.modelFeatures]);
    const {modelHeight:height,modelBevel:bevel}=state;
    if(displayedModelSource===source&&displayedCAD===cad&&displayedModelHeight===state.modelHeight&&displayedBevel===state.modelBevel&&modelMesh){
      updateModel();return;
    }
    let job;
    const finish=()=>{
      if(modelJob!==job)return false;
      abortModelJob();
      return true;
    };
    const fallback=()=>{
      modelWorkerDisabled=true;
      if(finish())updateModel();
    };
    try{
      job=new Worker('./src/workers/model-worker.js');
      modelJob=job;
      const button=$('model-cancel-build');
      if(button)button.hidden=false;
      $('model-status').textContent='Рассчитывается модель…';
      job.onmessage=({data})=>{
        if(!finish())return;
        if(modelOpen)updateModel(false,{prepared:{...data,source,cad,height,bevel}});
      };
      job.onerror=fallback;
      job.onmessageerror=fallback;
      job.postMessage({strokes,height,bevel,bodies:state.modelBodies,features:state.modelFeatures});
    }catch{
      if(job)fallback();
      else {modelWorkerDisabled=true;updateModel();}
    }
  }
  function modelEmpty(title,message){
    modelViewer?.clear();$('model-empty').hidden=false;$('model-empty-title').textContent=title;$('model-empty-text').textContent=message;
    displayedModelSource='';displayedModelHeight=null;
    modelMesh=null;uploadedMesh=null;displayedBevel=null;displayedHoles=0;displayedCAD='';
    $('model-canvas').dataset.valid='false';$('model-canvas').dataset.triangles='0';
    document.querySelectorAll('.model-view-controls button').forEach(b=>b.disabled=true);
    document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'modelgeometry'}}));
  }
  function markModelErrors(errors){
    $('diagnostic-layer').innerHTML='';
    const scale=1/(fitScale*zoom);
    const points=errors.flatMap(error=>error.points||[]).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)).slice(0,30);
    $('diagnostic-layer').innerHTML=points.map(p=>`<circle cx="${num(p.x)}" cy="${num(p.y)}" r="${8*scale}" fill="#f7e4d8" fill-opacity=".7" stroke="#c48761" stroke-width="${1.5*scale}"/>`).join('');
  }
  function updateModel(force=false,{forProjection=false,prepared=null}={}){
    clearTimeout(modelTimer);abortModelJob();if(!modelOpen&&force!==true)return;
    modelNeedsBuild=false;
    modelError='';
    // A contour under construction is not part of the committed drawing yet.
    // Keep its last valid solid so completing an inner loop can reveal the hole.
    if(contourPoints.length&&modelMesh&&modelViewer?.mesh){$('model-status').textContent='Завершите текущий контур';return;}
    $('model-errors').replaceChildren();$('model-stats').textContent='';$('diagnostic-layer').innerHTML='';$('profile-layer').innerHTML='';
    $('model-feedback').classList.remove('invalid');syncModelHeight();
    if(contourPoints.length){$('model-status').textContent='Завершите текущий контур';modelEmpty('Ещё несколько линий','Нажмите на первую точку или «Замкнуть», чтобы построить объём.');return;}
    const strokes=modelStrokes();
    if(!strokes.length){$('model-status').textContent='Начертите замкнутый контур';modelEmpty('Начните с контура','Внутренние контуры станут отверстиями.');return;}
    if(!window.LabExtrusion){$('model-status').textContent='Не удалось загрузить построение';modelEmpty('Не все файлы загружены','Обновите страницу. Для локального запуска сохраните все файлы приложения рядом.');return;}
    try{
      const source=JSON.stringify(strokes);
      if(source!==modelSource||!modelAnalysis){
        modelAnalysis=prepared?.source===source&&prepared.analysis?prepared.analysis:window.LabExtrusion.analyze(strokes,{tolerance:8});
        modelSource=source;
      }
      if(!modelAnalysis.ok){
        const errors=modelAnalysis.errors||[];modelError=errors[0]?.message||'Нужно поправить контур';
        $('model-feedback').classList.add('invalid');$('model-status').textContent='Нужно поправить контур';
        if(!modelEditBefore||!modelMesh)modelEmpty('Проверим чертёж','Исправьте отмеченные места — модель появится автоматически.');else $('model-canvas').dataset.valid='false';
        [...new Set(errors.map(error=>error.message))].slice(0,3).forEach(message=>{const li=document.createElement('li');li.textContent=message;$('model-errors').appendChild(li);});
        markModelErrors(errors);document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'modelerror',message:modelError}}));return false;
      }
      const cad=JSON.stringify([state.modelBodies,state.modelFeatures]);
      const geometryChanged=displayedModelSource!==source||displayedModelHeight!==state.modelHeight||displayedBevel!==state.modelBevel||displayedCAD!==cad||!modelMesh;
      const beforeHeight=modelEditBefore||heightEditBefore;
      const heightChanges=new Set();
      if(geometryChanged&&beforeHeight){
        for(const {target} of state.modelFeatures){
          const old=extrusionHeight(beforeHeight,target),current=extrusionHeight(state,target);
          if(old!==null&&current!==null&&old!==current)heightChanges.add(target);
        }
      }
      const fromWorker=prepared?.source===source&&prepared.cad===cad&&prepared.height===state.modelHeight&&prepared.bevel===state.modelBevel&&!heightChanges.size;
      if(fromWorker&&prepared.error)throw new Error(prepared.error);
      const mesh=geometryChanged?(fromWorker&&prepared.mesh?prepared.mesh:window.LabSolid?
        window.LabSolid.build(modelAnalysis,{strokes,height:state.modelHeight,bevel:state.modelBevel,bodies:state.modelBodies,features:state.modelFeatures,heightChanges}):
        window.LabExtrusion.extrude(modelAnalysis,state.modelHeight,{bevel:state.modelBevel})):modelMesh;
      if(!mesh?.positions?.length)throw new Error('Операция не оставляет объёма. Измените параметры или положение деталей.');
      modelMesh=mesh;
      const loops=modelAnalysis.loops||[];
      if(modelOpen||!forProjection){
        const d=loops.map(loop=>`M ${loop.points.map(p=>`${num(p.x)} ${num(p.y)}`).join(' L ')} Z`).join(' ');
        $('profile-layer').innerHTML=`<path d="${d}" class="profile-surface"/>`;
      }
      const bodies=mesh.bodies?.length??modelAnalysis.stats.solids;
      const sourceHoles=modelAnalysis.stats.holes,holes=mesh.stats?.holes??sourceHoles;
      const noun=(n,one,few,many)=>n%100>=11&&n%100<=14?many:n%10===1?one:n%10>=2&&n%10<=4?few:many;
      const heights=[...new Set((mesh.bodies||[]).map(body=>fmt(body.bounds.max[2]-body.bounds.min[2])))];
      const height=heights[0]??fmt(mesh.stats?.heightMm??state.modelHeight);
      $('model-stats').textContent=`${bodies} ${noun(bodies,'тело','тела','тел')} · ${holes} ${noun(holes,'отверстие','отверстия','отверстий')} · ${heights.length>1?'разная высота':`высота ${height} мм`}`;
      [...(modelAnalysis.warnings||[]),...(mesh.warnings||[])].slice(0,3).forEach(message=>{const li=document.createElement('li');li.textContent=message;$('model-errors').appendChild(li);});
      if(!modelOpen||(forProjection&&!modelViewer?.supported)){displayedModelSource=source;displayedModelHeight=state.modelHeight;displayedBevel=state.modelBevel;displayedCAD=cad;displayedHoles=sourceHoles;document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'modelgeometry'}}));return true;}
      if(!modelViewer?.supported){$('model-status').textContent='Контуры готовы · 3D недоступно';modelEmpty('Нужен WebGL','Этот браузер не может показать объём. Чертёж и высота сохраняются в проекте.');return;}
      const newHole=displayedModelSource&&sourceHoles>displayedHoles;
      const animation=modelHeightDragging||modelEditBefore?false:displayedModelSource!==source?(newHole?'holes':'intro'):displayedModelHeight!==state.modelHeight?'height':false;
      if(geometryChanged||!modelViewer.mesh||uploadedMesh!==mesh){modelViewer.setMesh(mesh,{animate:animation});uploadedMesh=mesh;}
      else modelViewer.resize();
      displayedModelSource=source;displayedModelHeight=state.modelHeight;displayedBevel=state.modelBevel;displayedCAD=cad;displayedHoles=sourceHoles;
      modelViewer.setMaterial?.(state.modelMaterial);modelViewer.setXray?.(state.modelXray);modelViewer.setSection?.(state.modelSection);
      if(newHole)highlightHole();
      $('model-empty').hidden=true;$('model-status').textContent='Модель готова';
      $('model-canvas').dataset.valid='true';$('model-canvas').dataset.triangles=String(mesh.positions.length/9);
      document.querySelectorAll('.model-view-controls button').forEach(b=>b.disabled=false);
      document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'modelgeometry'}}));return true;
    }catch(error){
      modelError=error.message||'Не удалось построить объём.';
      $('model-status').textContent='Не удалось построить объём';$('model-feedback').classList.add('invalid');
      if(!modelEditBefore||!modelMesh)modelEmpty('Проверьте контуры','Попробуйте более простой контур без пересечений.');else{$('model-empty').hidden=true;$('model-canvas').dataset.valid='false';}
      const li=document.createElement('li');li.textContent=modelError;$('model-errors').appendChild(li);document.dispatchEvent(new CustomEvent('labchange',{detail:{kind:'modelerror',message:modelError}}));return false;
    }
  }

  function startGesture(event) {
    if(event.defaultPrevented)return;
    if(!started || event.button>0)return;
    event.preventDefault();
    wrap.focus({preventScroll:true});
    if(event.pointerType==='touch'){
      canvasTouches.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(canvasTouches.size===2){cancelGesture(true);const [a,b]=canvasTouches.values(),r=wrap.getBoundingClientRect();pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom,x:((a.x+b.x)/2-r.left)/r.width,y:((a.y+b.y)/2-r.top)/r.height};wrap.setPointerCapture(event.pointerId);document.body.classList.add('is-drawing');return;}
      if(canvasTouches.size>2){wrap.setPointerCapture(event.pointerId);return;}
    }
    activePointers.add(event.pointerId);
    if(activePointers.size>1){cancelGesture();return;}
    event.preventDefault();
    wrap.setPointerCapture(event.pointerId);
    const penOnlyTouch=event.pointerType==='touch'&&document.body.classList.contains('project-pen-mode');
    const p=point(event),handle=event.target.closest('[data-handle]')?.dataset.handle;
    const base={id:event.pointerId,start:p,beforeRuler:clone(state.ruler),beforeCompass:clone(state.compass)};
    if(!panMode&&!penOnlyTouch&&!handle&&!canDraw()){activePointers.delete(event.pointerId);canvasTouches.delete(event.pointerId);if(wrap.hasPointerCapture(event.pointerId))wrap.releasePointerCapture(event.pointerId);return;}
    document.body.classList.add('is-drawing');
    if(panMode||penOnlyTouch){gesture={...base,type:'pan',clientX:event.clientX,clientY:event.clientY,scrollX:stage.scrollLeft,scrollY:stage.scrollTop};return;}
    if(state.tool==='contour'){gesture={...base,type:'contour-point',clientX:event.clientX,clientY:event.clientY};return;}
    if(handle?.startsWith('ruler-')) {
      gesture={...base,type:handle};
      if(handle==='ruler-rotate')gesture.offset=deg(Math.atan2(p.y-state.ruler.y,p.x-state.ruler.x))-state.ruler.angle;
      if(handle==='ruler-draw') {const a=I.projectOnRuler(p,state.ruler);draft={type:'line',a:{x:a.x,y:a.y},b:{x:a.x,y:a.y},...style()};}
    } else if(handle?.startsWith('compass-')) {
      gesture={...base,type:handle};
      if(handle==='compass-sweep'){
        gesture.lastAngle=deg(Math.atan2(p.y-state.compass.y,p.x-state.compass.x));gesture.total=0;
        draft={type:'arc',cx:state.compass.x,cy:state.compass.y,r:state.compass.radius,start:state.compass.angle,delta:0,...style()};
      }
    } else if(state.tool==='pencil'){gesture={...base,type:'pencil'};draft={type:'path',points:[p],...style()};}
    else if(state.tool==='line'){const a=point(event,true);gesture={...base,type:'line'};draft={type:'line',a,b:a,...style()};}
    else if(state.tool==='eraser'){gesture={...base,type:'eraser',before:clone(state.strokes),changed:false};eraseAt(p);}
    else {gesture=null;toast(state.tool==='ruler'?'Проведите по подсвеченному краю линейки.':'Потяните карандаш циркуля или нажмите «Начертить окружность».');}
    $('draft-layer').innerHTML=draftMarkup(draft);
    readableStrokes(true);
  }
  function moveGesture(event) {
    if(event.pointerType==='touch'&&canvasTouches.has(event.pointerId))canvasTouches.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pinch&&canvasTouches.size>=2){event.preventDefault();const [a,b]=canvasTouches.values();zoom=clamp(pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance),1,5);fit();const r=wrap.getBoundingClientRect();stage.scrollLeft+=r.left+pinch.x*r.width-(a.x+b.x)/2;stage.scrollTop+=r.top+pinch.y*r.height-(a.y+b.y)/2;return;}
    if(!gesture||gesture.id!==event.pointerId){if(state.tool==='contour'&&contourPoints.length&&!panMode&&event.pointerType!=='touch'){contourHover=point(event,true);renderContour();}else hoverDrawing(point(event));return;}
    event.preventDefault();const p=point(event),g=gesture;
    if(g.type==='contour-point'){contourHover=point(event,true);renderContour();return;}
    if(g.type==='pan'){stage.scrollLeft=g.scrollX+g.clientX-event.clientX;stage.scrollTop=g.scrollY+g.clientY-event.clientY;return;}
    if(g.type==='ruler-move'){state.ruler.x=clamp(g.beforeRuler.x+p.x-g.start.x,40,state.width-40);state.ruler.y=clamp(g.beforeRuler.y+p.y-g.start.y,35,state.height-70);}
    else if(g.type==='ruler-rotate'){
      let angle=deg(Math.atan2(p.y-state.ruler.y,p.x-state.ruler.x))-g.offset;
      if(event.shiftKey)angle=Math.round(angle/15)*15;
      state.ruler.angle=I.normalizeAngle(angle);
    } else if(g.type==='ruler-draw'){const b=I.projectOnRuler(p,state.ruler);draft.b={x:b.x,y:b.y};}
    else if(g.type==='compass-move'||g.type==='compass-center')Object.assign(state.compass,constrainCenter({x:g.beforeCompass.x+p.x-g.start.x,y:g.beforeCompass.y+p.y-g.start.y}));
    else if(g.type==='compass-radius'){
      const movement=(p.x-g.start.x)*Math.cos(rad(g.beforeCompass.angle))+(p.y-g.start.y)*Math.sin(rad(g.beforeCompass.angle));
      state.compass.radius=clamp(g.beforeCompass.radius+movement/.6,32,maxRadius());
      if(state.snap)state.compass.radius=clamp(Math.round(state.compass.radius/20)*20,32,maxRadius());
    } else if(g.type==='compass-sweep'){
      const a=deg(Math.atan2(p.y-state.compass.y,p.x-state.compass.x));
      let delta=a-g.lastAngle;if(delta>180)delta-=360;if(delta< -180)delta+=360;
      g.total=clamp(g.total+delta,-360,360);g.lastAngle=a;draft.delta=g.total;
      state.compass.angle=I.normalizeAngle(draft.start+g.total);
    } else if(g.type==='pencil'){
      if(draft.points.length<MAX_STROKE_POINTS && I.distance(p,draft.points.at(-1))>.65)draft.points.push(p);
    } else if(g.type==='line'){
      let b=point(event,true);
      if(event.shiftKey){
        let length=I.distance(draft.a,b);
        const angle=rad(Math.round(deg(Math.atan2(b.y-draft.a.y,b.x-draft.a.x))/15)*15);
        const dx=Math.cos(angle),dy=Math.sin(angle);
        if(Math.abs(dx)>1e-9)length=Math.min(length,((dx>0?state.width:0)-draft.a.x)/dx);
        if(Math.abs(dy)>1e-9)length=Math.min(length,((dy>0?state.height:0)-draft.a.y)/dy);
        b={x:draft.a.x+length*dx,y:draft.a.y+length*dy};
      }
      draft.b={x:clamp(b.x,0,state.width),y:clamp(b.y,0,state.height)};
    } else if(g.type==='eraser'){eraseAt(p);}
    if(g.type.startsWith('ruler-')||g.type.startsWith('compass-')){renderTools();syncMeasure();}
    $('draft-layer').innerHTML=draftMarkup(draft);
    readableStrokes(true);
  }
  function endGesture(event) {
    canvasTouches.delete(event.pointerId);
    if(pinch){if(canvasTouches.size<2){pinch=null;gesture=null;document.body.classList.remove('is-drawing');}activePointers.delete(event.pointerId);if(wrap.hasPointerCapture(event.pointerId))wrap.releasePointerCapture(event.pointerId);return;}
    document.body.classList.remove('is-drawing');
    activePointers.delete(event.pointerId);
    if(!gesture||gesture.id!==event.pointerId)return;
    moveGesture(event);
    const g=gesture;gesture=null;
    if(['ruler-move','ruler-rotate','compass-move','compass-center','compass-radius'].includes(g.type))document.dispatchEvent(new CustomEvent('labcontext',{detail:{x:event.clientX,y:event.clientY}}));
    if(g.type==='contour-point'){
      if(Math.hypot(event.clientX-g.clientX,event.clientY-g.clientY)<12)addContourPoint(point(event,true));
      if(wrap.hasPointerCapture(event.pointerId))wrap.releasePointerCapture(event.pointerId);
      return;
    }
    if(draft){
      const shape=draft;draft=null;
      if(shape.type==='path' || (shape.type==='line'&&I.distance(shape.a,shape.b)>.5) || (shape.type==='arc'&&Math.abs(shape.delta)>.2))addShape(shape);
    }
    if(g.type==='eraser'&&g.changed){remember(g.before);pruneConstraints();renderDrawing();}
    $('draft-layer').innerHTML='';clearGuides();saveSoon();
    if(wrap.hasPointerCapture(event.pointerId))wrap.releasePointerCapture(event.pointerId);
  }
  function cancelGesture(keepTouches=false) {
    clearGuides();document.body.classList.remove('is-drawing');
    if(gesture){
      state.ruler=gesture.beforeRuler;state.compass=gesture.beforeCompass;
      if(gesture.type==='eraser')state.strokes=gesture.before;
    }
    gesture=null;draft=null;
    const captures=new Set([...activePointers,...canvasTouches.keys()]);activePointers.clear();
    if(!keepTouches){canvasTouches.clear();pinch=null;for(const id of captures)if(wrap.hasPointerCapture(id))wrap.releasePointerCapture(id);}
    $('draft-layer').innerHTML='';renderDrawing();renderTools();syncMeasure();
  }
  function eraseAt(p){
    const tolerance=11/(fitScale*zoom);
    if(state.layers.find(l=>l.id===state.activeLayer)?.locked)return;
    const removed=new Set(state.strokes.filter(shape=>(shape.layer||'main')===state.activeLayer&&layerVisible(shape)&&hits(shape,p,tolerance+shape.width/2)).map(shape=>shape.mirrorOf||shape.id));
    const remaining=state.strokes.filter(shape=>!removed.has(shape.mirrorOf||shape.id));
    if(remaining.length!==state.strokes.length){gesture.changed=true;state.strokes=remaining;renderDrawing();}
  }

  wrap.addEventListener('pointerdown',startGesture);wrap.addEventListener('pointermove',moveGesture);wrap.addEventListener('pointerup',endGesture);
  wrap.addEventListener('pointercancel',()=>cancelGesture());
  wrap.addEventListener('lostpointercapture',event=>{const cancelled=gesture?.id===event.pointerId||Boolean(pinch&&canvasTouches.has(event.pointerId));activePointers.delete(event.pointerId);canvasTouches.delete(event.pointerId);if(cancelled)cancelGesture();});
  wrap.addEventListener('pointerleave',()=>{if(!gesture&&!pinch){clearGuides();contourHover=null;renderContour();highlightLoop(-1);modelViewer?.setHighlight?.(-1);}});
  wrap.addEventListener('contextmenu',event=>event.preventDefault());
  window.addEventListener('pointerup',event=>{activePointers.delete(event.pointerId);canvasTouches.delete(event.pointerId);if(pinch&&canvasTouches.size<2){pinch=null;document.body.classList.remove('is-drawing');}});
  window.addEventListener('blur',()=>{cancelGesture();endHeightEdit();});
  document.querySelectorAll('[data-tool]').forEach(button=>button.addEventListener('click',()=>setTool(button.dataset.tool)));
  document.querySelectorAll('[data-color]').forEach(button=>button.addEventListener('click',()=>{state.color=button.dataset.color;updateStyleControls();saveSoon();}));
  $('stroke-width').addEventListener('input',event=>{state.strokeWidth=Number(event.target.value);updateStyleControls();saveSoon();});
  $('tool-options').addEventListener('change',event=>{
    const value=Number(event.target.value);
    if(event.target.id==='angle'){state.ruler.angle=Number.isFinite(value)?I.normalizeAngle(value):0;}
    if(event.target.id==='radius'){state.compass.radius=Number.isFinite(value)?clamp(value*MM,32,maxRadius()):160;}
    syncMeasure();renderTools();saveSoon();
  });
  $('tool-options').addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.rotate)state.ruler.angle=I.normalizeAngle(state.ruler.angle+Number(button.dataset.rotate));
    if(button.dataset.angle!==undefined)state.ruler.angle=Number(button.dataset.angle);
    if(button.id==='center-tool'){state.ruler={x:state.width/2-20,y:state.height*.55,angle:0};}
    if(button.id==='draw-circle')addShape({type:'circle',cx:state.compass.x,cy:state.compass.y,r:state.compass.radius,...style()});
    if(button.id==='close-contour')finishContour();
    if(button.id==='cancel-contour')resetContour();
    if(button.id==='contour-to-model')setModelOpen(true);
    renderTools();syncMeasure();saveSoon();
  });
  $('undo').addEventListener('click',undo);$('redo').addEventListener('click',redo);
  $('toggle-grid').addEventListener('click',()=>{state.grid=!state.grid;$('toggle-grid').classList.toggle('active',state.grid);$('toggle-grid').setAttribute('aria-pressed',String(state.grid));renderDrawing();saveSoon();});
  $('snap').addEventListener('change',event=>{state.snap=event.target.checked;saveSoon();});
  $('zoom-in').addEventListener('click',()=>setZoom(zoom+.25));
  $('zoom-out').addEventListener('click',()=>setZoom(zoom-.25));
  $('zoom-fit').addEventListener('click',()=>{zoom=1;fit();stage.scrollTo(0,0);});
  $('pan').addEventListener('click',()=>{cancelGesture();panMode=!panMode;$('pan').setAttribute('aria-pressed',String(panMode));wrap.style.cursor=panMode?'grab':'crosshair';$('tool-hint').lastElementChild.textContent=panMode?'Перетаскивайте увеличенный лист мышью или пальцем':tools[state.tool].hint;});
  new ResizeObserver(fit).observe(stage);
  compactControls.addEventListener('change',placeHistoryControls);
  $('workspace-views').addEventListener('click',event=>{
    const button=event.target.closest('[data-view]');
    if(!button||button.getAttribute('aria-pressed')==='true')return;
    const view=button.dataset.view;
    if(view==='draft'){window.LabDrawingSheet?.open();return;}
    window.LabDrawingSheet?.close({restoreFocus:false});
    if(modelOpen!==(view==='model'))setModelOpen(view==='model');
    button.focus({preventScroll:true});
  });
  document.addEventListener('labchange',event=>{
    if(event.detail.kind==='model'||event.detail.kind==='draftview')syncWorkspaceView();
  });
  $('model-close').addEventListener('click',()=>setModelOpen(false));
  $('model-cancel-build')?.addEventListener('click',()=>{
    abortModelJob();
    $('model-status').textContent='Расчёт остановлен. Возобновите построение, открыв 3D заново.';
  });
  $('choose-contour').addEventListener('click',()=>setTool('contour'));
  $('model-canvas').addEventListener('labmodelchange',updateModel);
  $('model-canvas').addEventListener('labmodelhover',event=>highlightLoop(event.detail.contourIndex));
  $('model-canvas').addEventListener('labmodelstage',event=>{
    const labels={contour:'01 · КОНТУР',base:'02 · ОСНОВАНИЕ',walls:'03 · СТЕНКИ',complete:'ОБЪЁМ · 3D'};
    if($('model-phase-label'))$('model-phase-label').textContent=labels[event.detail.stage]||labels.complete;
  });
  $('model-canvas').addEventListener('labmodelheight',event=>{
    const {height,phase,bodyId}=event.detail;
    if(bodyId&&modelMesh?.bodies?.some(body=>body.id===bodyId)){
      if(phase==='start'){const own=!modelEditBefore;beginModelEdit();bodyHeightGesture={id:bodyId,own};modelHeightDragging=true;}
      else if(!bodyHeightGesture||bodyHeightGesture.id!==bodyId)return;
      if(phase==='move'||phase==='end'){
        if(Number.isFinite(height))previewBodySetting(bodyId,'height',Math.round(clamp(height,1,200)*10)/10);
      }
      if($('model-height-hud')){$('model-height-hud').textContent=`${fmt(Number(height)||20)} мм`;$('model-height-hud').hidden=phase==='end';}
      if(phase==='end'){const own=bodyHeightGesture.own;bodyHeightGesture=null;modelHeightDragging=false;if(own&&!commitModelEdit())cancelModelEdit();}
      return;
    }
    if(phase==='start'){endHeightEdit();beginHeightEdit();modelHeightDragging=true;syncModelHeight();}
    else if(phase==='move'){if(!heightEditBefore)beginHeightEdit();modelHeightDragging=true;applyModelHeight(height);}
    else if(phase==='end'){
      if(Number.isFinite(height)&&height!==state.modelHeight)applyModelHeight(height);
      modelHeightDragging=false;syncModelHeight();endHeightEdit();
    }
  });
  for(const id of ['model-height-range','model-height']){
    $(id).addEventListener('focus',beginHeightEdit);
    $(id).addEventListener('pointerdown',beginHeightEdit);
    $(id).addEventListener('blur',endHeightEdit);
  }
  $('model-height-range').addEventListener('input',event=>{beginHeightEdit();applyModelHeight(Number(event.target.value));});
  $('model-height-range').addEventListener('change',endHeightEdit);
  $('model-height').addEventListener('input',event=>{
    const value=Number(event.target.value);
    if(event.target.value!==''&&Number.isFinite(value)&&value>=1&&value<=200){beginHeightEdit();applyModelHeight(value);}
  });
  $('model-height').addEventListener('change',event=>{beginHeightEdit();const value=Number(event.target.value);applyModelHeight(Number.isFinite(value)?value:20);endHeightEdit();});
  $('model-reset').addEventListener('click',()=>modelViewer?.resetView());
  $('model-zoom-in').addEventListener('click',()=>modelViewer?.zoom(1.2));
  $('model-zoom-out').addEventListener('click',()=>modelViewer?.zoom(1/1.2));
  $('model-rotate-left').addEventListener('click',()=>modelViewer?.orbit(-55,0));
  $('model-rotate-right').addEventListener('click',()=>modelViewer?.orbit(55,0));

  function showDialog(html){
    cancelGesture();
    const content=$('dialog-content');
    content.innerHTML=html;
    content.querySelector('h2').id='action-dialog-title';
    dialog.showModal();
  }
  function confirmAction(title,message,label,callback){
    showDialog(`<span class="eyebrow">ВАШ ЛИСТ</span><h2>${title}</h2><p>${message}</p><div class="dialog-actions"><button class="secondary-button" id="confirm-cancel">Оставить</button><button class="primary-button danger-button" id="confirm-ok">${label}</button></div>`);
    $('confirm-cancel').onclick=()=>dialog.close();$('confirm-ok').onclick=()=>{dialog.close();callback();};
  }
  $('close-dialog').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  $('clear').addEventListener('click',()=>{if(!state.strokes.length)return;confirmAction('Очистить лист?','Все построения исчезнут с листа. Их можно будет вернуть кнопкой отмены.','Очистить',()=>{cancelModelEdit();remember();state.strokes=[];state.constraints=[];state.projectionDimensions=[];state.sketchDimensions=[];state.draftDesign={section:null,notes:[]};state.measurementBook=compactMeasurementBook({...state.measurementBook,measurements:[]});state.modelBodies={};state.modelFeatures=[];renderDrawing();saveSoon();toast('Лист очищен. Отмена вернёт рисунок.');});});
  $('help').addEventListener('click',showHelp);
  function showHelp(){showDialog(`<span class="eyebrow">ОСВОИТЬСЯ ЗА МИНУТУ</span><h2>От контура к объёму</h2><ul class="help-list"><li><strong>Холст на первом месте.</strong> Инструменты выбираются в компактной панели. Настройки и слои открываются по запросу, чтобы рисунок оставался в центре внимания.</li><li><strong>Замкните контур.</strong> Выберите «Контур», отметьте вершины и нажмите первую точку или Enter. Подойдут также окружности и замкнутые цепочки отрезков и дуг.</li><li><strong>Действия на холсте.</strong> Пробел или долгое нажатие открывают меню операций. Выберите деталь: рядом появятся размеры, рукоятки и нужные действия. V включает выбор контура в 2D; двойное нажатие на модель возвращает редактирование её исходного чертежа.</li><li><strong>Задайте высоту.</strong> Переключитесь в «3D». Меняйте высоту ползунком или включите вытягивание за верхнюю грань и потяните её вверх или вниз. Один жест отменяется одним действием.</li><li><strong>Добавьте отверстия.</strong> Замкнутый контур внутри другого становится сквозным отверстием. Слои помогают отделять построения: в модель входят только видимые слои.</li><li><strong>Рассмотрите модель.</strong> Вращайте мышью или пальцем, приближайте колёсиком или двумя пальцами. Выберите вид сверху, спереди, сбоку или изометрию; удачные положения камеры можно сохранить.</li><li><strong>Исследуйте форму.</strong> Скругляйте верхние и нижние рёбра, задавайте толщину стенок, вращайте профиль вокруг оси или ведите его вдоль траектории. На выбранной плоской грани можно начертить новый контур и вытянуть его либо вырезать карман заданной глубины. Перемещение позволяет совместить две детали для объединения, вычитания или пересечения.</li><li><strong>Подтвердите результат.</strong> Полупрозрачный объём показывает предпросмотр. «Применить» сохраняет операцию одним действием истории, «Отмена» или Esc возвращают исходную форму. До подтверждения временные изменения не попадают в автосохранение.</li><li><strong>Покажите идею.</strong> Чертёжный вид подчёркивает рёбра. Презентация скрывает интерфейс, включает автовращение и позволяет сохранить прозрачный PNG или короткое видео. Материалы, X-ray и сечения остаются в настройках модели.</li><li><strong>Работайте точно.</strong> Линейка направляет линию по краю. Циркуль строит окружности и дуги. Привязка помогает соединять концы, а Shift задаёт отрезку угол с шагом 15°.</li><li><strong>Масштаб и слои.</strong> Приближайте лист до 500%, используйте жест двумя пальцами или режим перемещения. Блокировка защищает слой от изменений; миникарта помогает перемещаться по увеличенному листу.</li><li><strong>Сохраните результат.</strong> JSON хранит весь проект, слои и виды камеры. PNG и SVG содержат видимые построения; STL и GLB сохраняют объёмную модель. Автосохранение работает в этом браузере.</li></ul><p class="key-row"><kbd>P</kbd> карандаш · <kbd>L</kbd> отрезок · <kbd>R</kbd> линейка · <kbd>C</kbd> циркуль · <kbd>E</kbd> ластик · <kbd>K</kbd> контур<br><kbd>Ctrl / ⌘ Z</kbd> отменить · <kbd>Ctrl / ⌘ Shift Z</kbd> повторить · <kbd>Enter</kbd> замкнуть · <kbd>Space</kbd> операции · <kbd>V</kbd> выбор · <kbd>Esc</kbd> отменить · <kbd>?</kbd> помощь</p><p class="unit-note">Миллиметры относятся к листу А4. Для объёма нужно замкнуть все контуры видимых слоёв. Незавершённые вершины не сохраняются до замыкания. Приложение работает без подключения к интернету.</p>`);}
  function showAbout(){showDialog(`<span class="eyebrow">ВИРТУАЛЬНАЯ ЛАБОРАТОРИЯ ЧЕРЧЕНИЯ</span><h2>Идея обретает форму</h2><p>От точного чертежа до вращаемой 3D-модели — в одном рабочем пространстве.</p><p class="about-author">Проект ученика 8 «Е» класса — Тимофей М.</p><p class="unit-note">Работает локально. Чертёж, слои, параметры модели и сохранённые виды остаются в вашем браузере; отдельную копию проекта можно скачать в JSON.</p>`);}

  function dispatchProject(kind){document.dispatchEvent(new CustomEvent('labchange',{detail:{kind}}));}
  function beginNew(){cancelModelEdit();dispatchProject('projectwillnew');modelError='';pendingValidationError='';heightEditBefore=null;modelHeightDragging=false;contourPoints=[];contourHover=null;state=blank(selectedOrientation);history=[];future=[];zoom=1;started=true;welcome.close();renderAll();dispatchProject('projectnew');savePending=true;if(saveNow())toast('Лист готов. Потяните линейку за корпус.');}
  document.querySelectorAll('[data-orientation]').forEach(button=>button.addEventListener('click',()=>{selectedOrientation=button.dataset.orientation;document.querySelectorAll('[data-orientation]').forEach(item=>{item.classList.toggle('selected',item===button);item.setAttribute('aria-pressed',String(item===button));});}));
  $('start').addEventListener('click',()=>{
    if(!started)readSavedProject();
    if((welcomeIsNew&&(state.strokes.length||state.tracing))||(!started&&(saved?.strokes.length||saved?.tracing))){
      welcome.close();confirmAction('Начать новый рисунок?','Автосохранение будет заменено новым листом. Если нужен прежний рисунок, сначала сохраните его в файл.','Новый лист',beginNew);
      $('confirm-cancel').onclick=()=>{dialog.close();welcome.showModal();};
      dialog.addEventListener('close',()=>{if(!started&&!welcome.open)welcome.showModal();},{once:true});
    }else beginNew();
  });
  $('continue').addEventListener('click',()=>{
    readSavedProject();if(!saved)return;
    modelEditBefore=null;modelError='';pendingValidationError='';heightEditBefore=null;modelHeightDragging=false;
    state=clone(saved);savedDocument=JSON.stringify(state);history=[];future=[];started=true;zoom=1;
    welcome.close();renderAll();dispatchProject('projectload');toast('Сохранённый рисунок открыт.');
  });
  $('cancel-welcome').addEventListener('click',()=>welcome.close());
  $('new-sheet').addEventListener('click',()=>{cancelModelEdit();cancelGesture();welcomeIsNew=true;$('continue').hidden=true;$('cancel-welcome').hidden=false;welcome.showModal();});
  welcome.addEventListener('cancel',event=>{if(!started)event.preventDefault();});

  function svgExport(){return `<svg xmlns="http://www.w3.org/2000/svg" width="${state.width/MM}mm" height="${state.height/MM}mm" viewBox="0 0 ${state.width} ${state.height}"><title>Чертёж — Виртуальная лаборатория черчения</title><defs>${gridDefs(true)}</defs><rect width="100%" height="100%" fill="#fff"/>${state.grid?'<rect width="100%" height="100%" fill="url(#grid)"/>':''}${visibleStrokes().map(shapeMarkup).join('')}</svg>`;}
  function download(blob,extension){const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`Чертёж-${new Date().toISOString().slice(0,10)}.${extension}`;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  async function exportFile(format){
    if(modelEditBefore){toast('Подтвердите или отмените предпросмотр перед скачиванием.');return;}
    try{
      if(format==='json')download(new Blob([JSON.stringify(state)],{type:'application/json'}),'json');
      else if(format==='svg')download(new Blob([svgExport()],{type:'image/svg+xml;charset=utf-8'}),'svg');
      else {
        const url=URL.createObjectURL(new Blob([svgExport()],{type:'image/svg+xml;charset=utf-8'}));
        try{const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});const canvas=document.createElement('canvas');canvas.width=state.width*2;canvas.height=state.height*2;const context=canvas.getContext('2d');context.drawImage(img,0,0,canvas.width,canvas.height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error();download(blob,'png');}finally{URL.revokeObjectURL(url);}
      }
      toast('Файл подготовлен и передан в загрузки.');
    }catch{toast('Не удалось сохранить файл. Попробуйте другой формат.');}
  }
  $('export').addEventListener('click',()=>{
    showDialog(`<span class="eyebrow">СОХРАНИТЬ И ПОДЕЛИТЬСЯ</span><h2>Ваша идея — с вами</h2><p>Инструменты не попадут в рисунок. Сетка сохранится, если она включена на листе.</p><button class="export-option" data-format="png"><span class="format-badge">PNG</span><span><strong>Изображение</strong><small>Для презентации или отправки учителю</small></span></button><button class="export-option" data-format="svg"><span class="format-badge">SVG</span><span><strong>Векторный чертёж</strong><small>Чёткие линии при любом увеличении</small></span></button><button class="export-option" data-format="json"><span class="format-badge">JSON</span><span><strong>Проект лаборатории</strong><small>Чтобы продолжить на другом устройстве</small></span></button><button class="import-button" id="import-button">↗ Открыть сохранённый проект JSON</button><p class="unit-note">Автосохранение хранится только в этом браузере. Скачайте JSON, чтобы сохранить отдельную копию.</p>`);
    document.querySelectorAll('[data-format]').forEach(button=>button.onclick=()=>exportFile(button.dataset.format));
    $('import-button').onclick=()=>$('import-file').click();
  });
  function loadPreparedProject(next,{keepUndo=false}={}){
    cancelModelEdit();endHeightEdit();cancelGesture();
    dispatchProject('projectwillload');
    if(!started)readSavedProject();
    if(started&&keepUndo)remember(documentSnapshot());else{history=[];future=[];}
    modelError='';pendingValidationError='';heightEditBefore=null;modelHeightDragging=false;contourPoints=[];contourHover=null;
    state=next;zoom=1;started=true;if(welcome.open)welcome.close();
    renderAll();dispatchProject('projectload');savePending=true;
    if(saveNow())toast('Проект открыт. Можно продолжать.');
    return true;
  }
  function loadProject(source,options={keepUndo:true}){
    try{return loadPreparedProject(validateProject(source),options);}catch(error){toast(error.message||'Не удалось открыть проект.');return false;}
  }
  function loadSharedAutosave(){
    try{
      const source=localStorage.getItem(STORAGE_KEY);
      if(source===null)throw new Error('В общем автосохранении нет проекта.');
      const next=validateProject(JSON.parse(source));
      saved=next;
      savedSource=source;
      savedDocument=null;
      return loadPreparedProject(next,{keepUndo:true});
    }catch(error){toast(error.message||'Не удалось открыть общее автосохранение.');return false;}
  }
  $('import-file').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    try{
      if(file.size>15*1024*1024)throw new Error('Файл больше 15 МБ');
      const next=validateProject(JSON.parse(await file.text()));
      const load=()=>loadPreparedProject(next);
      dialog.close();
      if(state.strokes.length||state.tracing)confirmAction('Открыть другой проект?','Текущий лист будет заменён. Сохраните его в файл, если хотите оставить отдельную копию.','Открыть',load);else load();
    }catch{toast('Не удалось открыть JSON. Проверьте формат и размер до 15 МБ.');}
  });
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||welcome.open||dialog.open||document.querySelector('dialog[open]')||window.LabDrawingSheet?.active()||
      window.LabMeasurementJournal?.active()||window.LabExperimentUI?.active())return;
    if(event.key==='Escape'&&modelEditBefore){event.preventDefault();cancelModelEdit();return;}
    if(event.key==='Escape'&&gesture){event.preventDefault();cancelGesture();return;}
    if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))return;
    if(state.tool==='contour'&&contourPoints.length){
      if(event.key==='Escape'){event.preventDefault();resetContour();return;}
      if(event.key==='Enter'){event.preventDefault();finishContour();return;}
      if(event.key==='Backspace'){event.preventDefault();undo();return;}
    }
    if((event.ctrlKey||event.metaKey)&&event.code==='KeyZ'){event.preventDefault();event.shiftKey?redo():undo();return;}
    if((event.ctrlKey||event.metaKey)&&event.code==='KeyY'){event.preventDefault();redo();return;}
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    const keys={KeyP:'pencil',KeyL:'line',KeyR:'ruler',KeyC:'compass',KeyE:'eraser',KeyK:'contour'};
    if(keys[event.code]){event.preventDefault();setTool(keys[event.code]);}
    if(event.key==='?')showHelp();
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelGesture();modelViewer?.finishHeightGesture?.();endHeightEdit();saveNow();}});
  window.addEventListener('pagehide',saveNow);
  // The studio shell uses this small public surface instead of mutating app state.
  window.LabApp={
    getState:()=>{
      const {tracing,measurementBook}=state;
      const project=clone({...state,tracing:null,measurementBook:null});
      project.tracing=tracing?{...tracing}:null;
      Object.defineProperty(project,'measurementBook',{enumerable:true,get:()=>clone(measurementBook)});
      return project;
    },
    getSketchSettings:()=>({mirrorAxis:clone(state.mirrorAxis),tracing:state.tracing?{...state.tracing}:null}),setSketchSetting,getModelViewer:()=>modelViewer,getModelMesh:()=>modelMesh,getAnalysis:()=>modelAnalysis,
    getViewport:()=>{const p=wrap.getBoundingClientRect(),s=stage.getBoundingClientRect();return {zoom,width:state.width,height:state.height,paperRect:{x:p.x,y:p.y,width:p.width,height:p.height},stageRect:{x:s.x,y:s.y,width:s.width,height:s.height}};},
    getDrawingMarkup:()=>visibleStrokes().map(shapeMarkup).join(''),getVisibleStrokes:()=>clone(visibleStrokes()),getModelStrokes:()=>clone(modelStrokes()),getSketchShape:id=>clone(state.strokes.find(shape=>shape.id===id)||null),getPaperPoint:event=>point(event,true),
    applySketchUpgrade,getSketchUpgradeError:()=>sketchUpgradeError,getSketchHits,prepareProject:validateProject,loadProject,loadSharedAutosave,
    getBodies:()=>modelMesh?.bodies||[],getModelError:()=>pendingValidationError||modelError,isModelEditing:()=>Boolean(modelEditBefore),getProjectionMesh,
    beginModelEdit,previewBodySetting,setBodySetting,commitModelEdit,cancelModelEdit,previewFeature,addModelFeature,removeModelFeature,commitFeature:commitModelEdit,cancelFeature:cancelModelEdit,replaceSketchShape,replaceSketchShapes,previewExistingFeature,
    getConstraints:()=>clone(state.constraints),addConstraint,removeConstraint,getProjectionDimensions:()=>clone(state.projectionDimensions),setProjectionDimensions,
    getSketchDimensions:()=>clone(state.sketchDimensions),removeSketchDimension,
    getDraftDesign:()=>clone(state.draftDesign),setDraftDesign,
    getExperiment:()=>clone(state.experiment),setExperiment,
    getMeasurements:()=>clone(state.measurementBook.measurements),getCurrentMeasurements,addMeasurement,removeMeasurement:id=>removeMeasurementItem('measurements',id),
    getMeasurementEntries:()=>clone(state.measurementBook.entries),addMeasurementEntry,removeMeasurementEntry:id=>removeMeasurementItem('entries',id),
    getMeasurementVariant:id=>clone(state.measurementBook.variants.find(variant=>variant.id===id)?.project||null),
    getMeasurementEndpoints:value=>window.LabMeasurements.displayPoints(value),
    setTool,setModelOpen,isModelOpen:()=>modelOpen,
    fit,setZoom,panTo,changeLayer,setModelSetting,saveCamera,deleteCamera,exportModel,toast,showAbout,undo,redo,
    historyPreviews,restoreHistoryPreview
  };
  function readSavedProject() {
    let source;
    try {source=localStorage.getItem(STORAGE_KEY);} catch {return;}
    if(source!==savedSource){
      savedSource=source;
      try {saved=source===null?null:validateProject(JSON.parse(source));} catch {saved=null;}
    }
    $('continue').hidden=!saved;
  }
  readSavedProject();
  window.addEventListener('storage',event=>{
    if(!started&&(event.key===STORAGE_KEY||event.key===null))readSavedProject();
  });
  placeHistoryControls();renderAll();welcome.showModal();
})();
