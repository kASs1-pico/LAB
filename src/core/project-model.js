/* Project data and validation shared by editing, import, undo and autosave. */
(function (global) {
  'use strict';
  const I=global.LabInstruments;
  const Constraints=global.LabDesignConstraints;
  const SketchUpgrade=global.LabSketchUpgrade;
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  const MAX_STROKES = 5000;
  const MAX_STROKE_POINTS = 12000;
  const MAX_DRAWING_POINTS = 250000;
  const colors = ['#263c46','#168d83','#457ad1','#d36e54','#9866b3'];

  function blank(orientation) {
    const width = orientation === 'landscape' ? 1188 : 840;
    const height = orientation === 'landscape' ? 840 : 1188;
    return {version:1,orientation,width,height,mirrorAxis:null,tracing:null,strokes:[],constraints:[],projectionDimensions:[],
      sketchDimensions:[],sketchUpgrade:SketchUpgrade?.settings(),draftDesign:{section:null,notes:[]},measurementBook:emptyMeasurementBook(),experiment:validateExperiment(),
      tool:'ruler',color:colors[0],strokeWidth:2,grid:true,snap:false,modelHeight:20,modelBevel:0,modelMaterial:'plastic',modelXray:false,modelSection:{enabled:false,axis:'x',position:.5},modelBodies:{},modelFeatures:[],savedViews:[],layers:[{id:'main',name:'Основной',visible:true,locked:false}],activeLayer:'main',
      ruler:{x:width/2-20,y:height*.61,angle:0},compass:{x:width*.4,y:height*.53,radius:160,angle:0}};
  }

  const cleanName=(value,fallback,length)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f-\u009f]/g,'').trim().slice(0,length)||fallback:fallback;

  const validId=(value,max=96)=>typeof value==='string'&&value.length<=max&&/^[a-zA-Z0-9_-]+$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
  const finiteNumber=(value,limit=100000)=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=limit;
  const vector=(value,size=3,limit=10000)=>Array.isArray(value)&&value.length===size&&value.every(v=>finiteNumber(v,limit));
  function checkedAxis(axis){
    if(axis==null)return null;
    if(![axis.a,axis.b].every(p=>p&&finiteNumber(p.x)&&finiteNumber(p.y))||I.distance(axis.a,axis.b)<.05)throw new Error('Отметьте две разные точки оси.');
    return {a:{x:axis.a.x,y:axis.a.y},b:{x:axis.b.x,y:axis.b.y}};
  }
  function checkedTracing(value){
    if(value==null)return null;
    const {image,x,y,width,height,opacity}=value;
    if(typeof image!=='string'||image.length>1800000||!/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+=*$/i.test(image)||![x,y,width,height].every(v=>finiteNumber(v,100000))||width<=0||height<=0||!finiteNumber(opacity,1)||opacity<0)throw new Error('Неверные размеры или формат фотографии.');
    return {image,x,y,width,height,opacity,visible:value.visible!==false};
  }

  function axisProjection(p,axis){
    const dx=axis.b.x-axis.a.x,dy=axis.b.y-axis.a.y;
    const fraction=((p.x-axis.a.x)*dx+(p.y-axis.a.y)*dy)/(dx*dx+dy*dy);
    return {x:axis.a.x+fraction*dx,y:axis.a.y+fraction*dy};
  }
  function reflectedShape(shape,axis){
    const reflect=p=>{const q=axisProjection(p,axis);return {x:2*q.x-p.x,y:2*q.y-p.y};};
    const result={...shape};
    if(result.sketchDefinition)delete result.sketchDefinition;
    if(shape.points)result.points=shape.points.map(reflect);
    if(shape.a){result.a=reflect(shape.a);result.b=reflect(shape.b);}
    if(shape.cx!==undefined){const center=reflect({x:shape.cx,y:shape.cy});result.cx=center.x;result.cy=center.y;}
    if(shape.type==='arc'){
      const angle=Math.atan2(axis.b.y-axis.a.y,axis.b.x-axis.a.x)*180/Math.PI;
      result.start=I.normalizeAngle(2*angle-shape.start);result.delta=-shape.delta;
    }
    return result;
  }
  function needsReflection(shape,axis){
    const pts=shape.points||(shape.a?[shape.a,shape.b]:[{x:shape.cx,y:shape.cy}]);
    return shape.type==='arc'||pts.some(p=>I.distance(p,axisProjection(p,axis))>.001);
  }
  function reflectInto(shape,target,axis){
    const result=reflectedShape(shape,axis);
    delete result.mirrorOf;delete result.mirrorAxis;
    const copy={...target,...result,id:target.id,layer:target.layer};
    delete copy.sketchDefinition;
    if(!shape.construction)delete copy.construction;
    return copy;
  }
  function bodyValue(key,value){
    if(key==='name'&&typeof value==='string')return cleanName(value,'',48);
    if(key==='fixed'&&typeof value==='boolean')return value;
    if(['height','fillet','shell'].includes(key)){
      const n=Number(value),limits={height:[1,200],fillet:[0,20],shell:[0,50]}[key];
      if(!Number.isFinite(n)||n<limits[0]||n>limits[1])throw new Error(`Параметр вне диапазона ${limits[0]}–${limits[1]} мм.`);return n;
    }
    if(key==='mode'&&['extrude','revolve','sweep'].includes(value))return value;
    if(key==='filletSide'&&['top','bottom','both'].includes(value))return value;
    if(key==='offset'&&vector(value))return value.slice();
    if(key==='axis'&&value&&vector(value.point,2)&&vector(value.direction,2,1e4)&&Math.hypot(...value.direction)>1e-7){
      const axis={point:value.point.slice(),direction:value.direction.slice()};
      if(value.angle!==undefined){
        if(!finiteNumber(value.angle,360)||value.angle<.5)throw new Error('Угол вращения должен быть от 0,5 до 360°.');
        axis.angle=value.angle;
      }
      return axis;
    }
    if(key==='path'&&Array.isArray(value)&&value.length>=2&&value.length<=256&&value.every(v=>vector(v)))return value.map(v=>v.slice());
    throw new Error('Некорректный параметр детали.');
  }
  function validatedBody(value){
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Неверные параметры детали');
    const result={};for(const key of Object.keys(value)){if(!['height','fillet','shell','filletSide','mode','axis','path','offset','name','fixed'].includes(key))continue;result[key]=bodyValue(key,value[key]);}return result;
  }
  function validatedFeature(value,fallbackId){
    const feature=normalizeFeature(value,fallbackId);
    return value?.suppressed===true?{...feature,suppressed:true}:feature;
  }
  function normalizeFeature(value,fallbackId){
    if(global.LabForms?.types.includes(value?.type))return global.LabForms.validateFeature(value,fallbackId);
    if(!value||!['add','cut','union','subtract','intersect'].includes(value.type)||!validId(value.target)||!value.target.startsWith('body-'))throw new Error('Некорректная операция с деталью.');
    const id=value.id||fallbackId;if(!validId(id,64))throw new Error('Неверный идентификатор операции.');
    const feature={id,type:value.type,target:value.target};
    if(['union','subtract','intersect'].includes(value.type)){
      if(!validId(value.tool)||!value.tool.startsWith('body-')||value.tool===value.target)throw new Error('Для операции нужны две разные детали.');feature.tool=value.tool;
    }else{
      if(!Array.isArray(value.points)||value.points.length<3||value.points.length>256||!value.points.every(p=>vector(p))||!vector(value.normal,3,1e4)||Math.hypot(...value.normal)<1e-7||!finiteNumber(value.depth,200)||value.depth<=0)throw new Error('Замкните контур на грани и задайте глубину от 0 до 200 мм.');
      feature.points=value.points.map(p=>p.slice());const length=Math.hypot(...value.normal);feature.normal=value.normal.map(v=>v/length);feature.depth=value.depth;
    }
    return feature;
  }

  function validateProjectionDimensions(values){
    if(values===undefined)return [];
    if(!Array.isArray(values)||values.length>30)throw new Error('На листе разрешено до 30 размеров.');
    return values.map(value=>{
      if(!value||!['front','top','side'].includes(value.view)||!['horizontal','vertical'].includes(value.axis)||
          (value.bodyId!==null&&(!validId(value.bodyId)||!value.bodyId.startsWith('body-')))||
          !Number.isFinite(value.offset)||Math.abs(value.offset)>16)throw new Error('Некорректное положение размера на листе.');
      const {view,axis,bodyId,offset}=value;return {view,axis,bodyId,offset};
    });
  }

  function validateSketchDimensions(values,strokes){
    if(values===undefined)return [];
    if(!Array.isArray(values)||values.length>MAX_STROKES)throw new Error('Некорректный список размеров эскиза.');
    const shapes=new Map(strokes.map(shape=>[shape.id,shape.type])),seen=new Set();
    const dimensions=[];
    for(const value of values){
      const {shapeId,kind}=value||{};
      if(!validId(shapeId)||!['length','diameter'].includes(kind)||seen.has(shapeId))throw new Error('Некорректный размер эскиза.');
      if(shapes.get(shapeId)!==(kind==='length'?'line':'circle'))continue;
      seen.add(shapeId);dimensions.push({shapeId,kind});
    }
    return dimensions;
  }

  function validateDraftDesign(value){
    return global.LabDrawingGeometry?.validateDraftDesign?.(value)??{section:null,notes:[]};
  }

  function validateExperiment(value){
    return global.LabExperimentGeometry?.validateState(value)??null;
  }

  function emptyMeasurementBook(){return {measurements:[],entries:[],variants:[]};}

  function normalizeMeasurement(value,fallbackId,variantId){
    const sample=global.LabMeasurements.measure(value);
    const id=value.id??fallbackId;
    const bodyIds=value.bodyIds??[null,null];
    if(!validId(id,64)||!Array.isArray(bodyIds)||bodyIds.length!==2||
      bodyIds.some(body=>body!==null&&(!validId(body)||!body.startsWith('body-')))){
      throw new Error('Некорректная ссылка на точки или детали замера.');
    }
    return {id,...sample,bodyIds:bodyIds.slice(),label:cleanName(value.label,'',80),variantId};
  }
  function variantProject(value){
    const {version,orientation,strokes,layers,activeLayer,mirrorAxis,constraints,sketchUpgrade,modelHeight,modelBevel,modelBodies,modelFeatures}=value;
    return {version,orientation,strokes,layers,activeLayer,mirrorAxis,constraints,sketchUpgrade,modelHeight,modelBevel,modelBodies,modelFeatures};
  }
  function compactMeasurementBook(book){
    const used=new Set([...book.measurements.map(record=>record.variantId),...book.entries.map(entry=>entry.sample.variantId)]);
    return {...book,variants:book.variants.filter(variant=>used.has(variant.id))};
  }
  function validateMeasurementBook(book,tools){
    if(book===undefined)return emptyMeasurementBook();
    if(!book||!Array.isArray(book.measurements)||!Array.isArray(book.entries)||!Array.isArray(book.variants)||
      book.measurements.length>100||book.entries.length>100||book.variants.length>200){
      throw new Error('Некорректный журнал измерений.');
    }
    const variantIds=new Set();
    const variants=book.variants.map(variant=>{
      if(!variant||!validId(variant.id,64)||variantIds.has(variant.id))throw new Error('Некорректный вариант детали.');
      variantIds.add(variant.id);
      return {id:variant.id,project:variantProject(validateProject(variant.project,tools,{geometryOnly:true}))};
    });
    const readSample=value=>{
      if(!variantIds.has(value?.variantId))throw new Error('В журнале отсутствует вариант детали.');
      return normalizeMeasurement(value,undefined,value.variantId);
    };
    const measurementIds=new Set(),entryIds=new Set();
    const measurements=book.measurements.map(value=>{
      const sample=readSample(value);
      if(measurementIds.has(sample.id))throw new Error('Повторный замер.');
      measurementIds.add(sample.id);
      return sample;
    });
    const entries=book.entries.map(entry=>{
      if(!entry||!validId(entry.id,64)||entryIds.has(entry.id)||typeof entry.createdAt!=='string'||
        entry.createdAt.length>35||!Number.isFinite(Date.parse(entry.createdAt)))throw new Error('Некорректная запись журнала.');
      entryIds.add(entry.id);
      const sample=readSample(entry.sample),tolerance=entry.tolerance??null;
      global.LabMeasurements.compare(sample.value,entry.expected,tolerance);
      return {id:entry.id,sample,variant:cleanName(entry.variant,'Вариант',64),expected:entry.expected,tolerance,
        note:cleanName(entry.note,'',240),createdAt:entry.createdAt};
    });
    return compactMeasurementBook({measurements,entries,variants});
  }

  function validateProject(input,tools,{geometryOnly=false}={}){
    if(!input||input.version!==1||!['landscape','portrait'].includes(input.orientation)||!Array.isArray(input.strokes)||input.strokes.length>MAX_STROKES)throw new Error('Неверный формат проекта');
    const result=blank(input.orientation);
    if(SketchUpgrade)result.sketchUpgrade=SketchUpgrade.settings(input.sketchUpgrade);
    const variables=SketchUpgrade?.parameterValues(result.sketchUpgrade);
    const validPoint=p=>p&&finiteNumber(p.x)&&finiteNumber(p.y);
    const safeId=value=>validId(value,64);
    if(input.layers!==undefined){
      if(!Array.isArray(input.layers)||input.layers.length<1||input.layers.length>20)throw new Error('Неверный список слоёв');
      const ids=new Set();
      result.layers=input.layers.map((layer,index)=>{
        if(!layer||!safeId(layer.id)||ids.has(layer.id))throw new Error('Неверный слой');ids.add(layer.id);
        return {id:layer.id,name:cleanName(layer.name,`Слой ${index+1}`,40),visible:layer.visible!==false,locked:layer.locked===true};
      });
      result.activeLayer=ids.has(input.activeLayer)?input.activeLayer:result.layers[0].id;
    }
    const layerIds=new Set(result.layers.map(layer=>layer.id));
    const shapeIds=new Set();
    for(const item of input.strokes){
      const generated=item?.sketchDefinition&&SketchUpgrade?SketchUpgrade.fromDefinition(item.sketchDefinition,variables):null;
      const shape=generated?{...item,...generated}:item;
      if(!shape||!colors.includes(shape.color)||!finiteNumber(shape.width,8)||shape.width<1)throw new Error('Неверный стиль линии');
      const layer=shape.layer===undefined?(layerIds.has('main')?'main':result.layers[0].id):shape.layer;
      if(!layerIds.has(layer))throw new Error('Построение ссылается на отсутствующий слой');
      const id=shape.id===undefined?`shape-${result.strokes.length}`:shape.id;if(!safeId(id)||shapeIds.has(id))throw new Error('Неверный идентификатор построения');shapeIds.add(id);
      const common={id,type:shape.type,color:shape.color,width:shape.width,layer};
      if(shape.construction===true)common.construction=true;
      if(generated)common.sketchDefinition=generated.sketchDefinition;
      if(shape.type==='path'){
        if(!Array.isArray(shape.points)||!shape.points.length||shape.points.length>MAX_STROKE_POINTS||!shape.points.every(validPoint))throw new Error('Неверная линия');
        result.strokes.push({...common,points:shape.points.map(p=>({x:p.x,y:p.y}))});
      } else if(shape.type==='line'&&validPoint(shape.a)&&validPoint(shape.b))result.strokes.push({...common,a:{x:shape.a.x,y:shape.a.y},b:{x:shape.b.x,y:shape.b.y}});
      else if(['circle','arc'].includes(shape.type)&&finiteNumber(shape.cx)&&finiteNumber(shape.cy)&&finiteNumber(shape.r,2000)&&shape.r>0){
        const s={...common,cx:shape.cx,cy:shape.cy,r:shape.r};
        if(shape.type==='arc'){if(!finiteNumber(shape.start,360)||!finiteNumber(shape.delta,360))throw new Error('Неверная дуга');Object.assign(s,{start:shape.start,delta:shape.delta});}
        result.strokes.push(s);
      }else throw new Error('Неизвестное построение');
    }
    result.mirrorAxis=checkedAxis(input.mirrorAxis);result.tracing=checkedTracing(input.tracing);
    const sources=new Map(result.strokes.map(shape=>[shape.id,shape])),paired=new Set();
    const mirrors=new Set(input.strokes.filter(shape=>shape.mirrorOf!==undefined).map(shape=>shape.id));
    input.strokes.forEach((shape,index)=>{
      if(shape.mirrorOf===undefined)return;
      const copy=result.strokes[index],source=sources.get(shape.mirrorOf);
      if(!source||source===copy||source.layer!==copy.layer||source.type!==copy.type||mirrors.has(source.id)||paired.has(source.id))throw new Error('Повреждена зеркальная связь.');
      const axis=checkedAxis(shape.mirrorAxis);if(!axis)throw new Error('Не задана ось зеркала.');
      paired.add(source.id);result.strokes[index]={...reflectInto(source,copy,axis),mirrorOf:source.id,mirrorAxis:axis};
    });
    result.constraints=Constraints?.validate(input.constraints,result.strokes)||[];
    if(!geometryOnly){
      result.projectionDimensions=validateProjectionDimensions(input.projectionDimensions);
      result.sketchDimensions=validateSketchDimensions(input.sketchDimensions,result.strokes);
      result.draftDesign=validateDraftDesign(input.draftDesign);
      result.measurementBook=validateMeasurementBook(input.measurementBook,tools);
      result.experiment=validateExperiment(input.experiment);
    }
    if(input.modelBodies!==undefined){
      if(!input.modelBodies||typeof input.modelBodies!=='object'||Array.isArray(input.modelBodies)||Object.keys(input.modelBodies).length>160)throw new Error('Слишком много параметров деталей');
      for(const [id,value] of Object.entries(input.modelBodies)){if(!validId(id)||!id.startsWith('body-'))throw new Error('Неверная ссылка на деталь');result.modelBodies[id]=validatedBody(value);}
    }
    if(input.modelFeatures!==undefined){
      if(!Array.isArray(input.modelFeatures)||input.modelFeatures.length>64)throw new Error('Слишком много операций модели');
      const ids=new Set();
      let coordinates=0, importedCoordinates=0;
      result.modelFeatures=input.modelFeatures.map((value,index)=>{
        const feature=validatedFeature(value,'op-'+index);
        if(ids.has(feature.id))throw new Error('Повторная операция модели');
        ids.add(feature.id);
        coordinates+=(feature.points?.length||0)+(feature.source?.points?.length||0)+(feature.sections||[]).reduce((n,section)=>n+section.points.length,0);
        if(coordinates>12000)throw new Error('Слишком подробные операции модели');
        importedCoordinates+=feature.vertices?.length||0;
        if(importedCoordinates>90000)throw new Error('Слишком большая суммарная сетка импортированных деталей');
        return feature;
      });
    }
    if(Object.hasOwn(tools,input.tool))result.tool=input.tool;if(colors.includes(input.color))result.color=input.color;
    if(finiteNumber(input.strokeWidth,8)&&input.strokeWidth>=1)result.strokeWidth=input.strokeWidth;
    result.grid=input.grid!==false;result.snap=input.snap===true;
    if(finiteNumber(input.modelHeight,200)&&input.modelHeight>=1)result.modelHeight=input.modelHeight;
    if(result.sketchUpgrade?.height)result.modelHeight=SketchUpgrade.read(result.sketchUpgrade.height,variables);
    if(finiteNumber(input.modelBevel,2)&&input.modelBevel>=0)result.modelBevel=input.modelBevel;
    if(['plastic','aluminum','glass'].includes(input.modelMaterial))result.modelMaterial=input.modelMaterial;
    result.modelXray=input.modelXray===true;
    if(input.modelSection&&typeof input.modelSection==='object'){
      const section=input.modelSection;
      result.modelSection={enabled:section.enabled===true,axis:['x','y','z'].includes(section.axis)?section.axis:'x',position:finiteNumber(section.position,1)&&section.position>=0?section.position:.5};
    }
    if(Array.isArray(input.savedViews)){
      const ids=new Set();
      result.savedViews=input.savedViews.slice(0,12).flatMap((view,index)=>{
        const camera=view?.camera;
        if(!view||!safeId(view.id)||ids.has(view.id)||!camera||!finiteNumber(camera.yaw)||!finiteNumber(camera.pitch,Math.PI/2)||!finiteNumber(camera.zoom,5)||camera.zoom<.3)return [];
        ids.add(view.id);return [{id:view.id,name:cleanName(view.name,`Вид ${index+1}`,32),camera:{yaw:camera.yaw%(2*Math.PI),pitch:camera.pitch,zoom:camera.zoom}}];
      });
    }
    if(input.ruler&&validPoint(input.ruler)&&finiteNumber(input.ruler.angle,360))result.ruler={x:clamp(input.ruler.x,40,result.width-40),y:clamp(input.ruler.y,35,result.height-70),angle:I.normalizeAngle(input.ruler.angle)};
    if(input.compass&&validPoint(input.compass)&&finiteNumber(input.compass.angle,360)&&finiteNumber(input.compass.radius,2000))result.compass={x:clamp(input.compass.x,20,result.width-20),y:clamp(input.compass.y,20,result.height-20),radius:clamp(input.compass.radius,32,Math.min(result.width,result.height)*.44),angle:I.normalizeAngle(input.compass.angle)};
    return result;
  }

  global.LabProjectModel=Object.freeze({
    MAX_STROKES, MAX_STROKE_POINTS, MAX_DRAWING_POINTS, blank, cleanName, validId, checkedAxis,
    checkedTracing, axisProjection, reflectedShape, needsReflection, reflectInto, bodyValue,
    validatedFeature, validateProjectionDimensions, validateSketchDimensions, validateDraftDesign,
    validateExperiment, normalizeMeasurement, variantProject, compactMeasurementBook,
    validateProject
  });
})(typeof window==="undefined"?globalThis:window);
