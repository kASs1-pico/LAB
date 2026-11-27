/* Project comparison and publication checks. Millimetres unless a field says otherwise. */
(function (global) {
  'use strict';

  function build(project) {
    const visible = new Set(project.layers.filter(layer => layer.visible).map(layer => layer.id));
    const strokes = project.strokes.filter(shape => !shape.construction && visible.has(shape.layer));
    const analysis = global.LabExtrusion.analyze(strokes, {tolerance:8});
    if (!analysis.ok) throw new Error(analysis.errors[0]?.message || 'В проекте есть незамкнутые контуры.');
    const mesh = global.LabSolid.build(analysis,{
      strokes, height:project.modelHeight, bevel:project.modelBevel, bodies:project.modelBodies, features:project.modelFeatures
    });
    return {mesh, analysis};
  }

  function metrics(project, mesh) {
    const range = axis => mesh ? mesh.bounds.max[axis] - mesh.bounds.min[axis] : null;
    const hidden = new Set(project.layers.filter(layer => !layer.visible).map(layer => layer.id));
    const holes = new Map(project.strokes.filter(shape=>shape.type==='circle'&&!shape.construction&&!hidden.has(shape.layer))
      .map(shape => [shape.id,{diameter:shape.r/2,x:shape.cx/4,y:shape.cy/4}]));
    return {
      dimensions:[...Array.from({length:3},(_,i)=>range(i)), mesh?.stats.volumeMm3??null, mesh?.stats.holes??null],
      holes,
      walls:project.modelFeatures.filter(feature=>!feature.suppressed&&feature.type==='multi-shell').map(feature=>feature.thickness)
        .concat(Object.values(project.modelBodies).map(settings=>settings.shell).filter(value=>value>0))
    };
  }

  function validatePack(data) {
    if (data?.kind!=='lab-lesson-package'||data.version!==1||typeof data.notes!=='string'||data.notes.length>6000||
      !Array.isArray(data.materials)||data.materials.length>8) throw new Error('Выберите корректный комплект урока.');
    const materials=data.materials.map(file=>{
      if (typeof file?.name!=='string'||!file.name||file.name.length>200||/[\\/\u0000-\u001f]/.test(file.name)||
        typeof file.base64!=='string'||file.base64.length>2800000||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64))
        throw new Error('В комплекте повреждён вложенный файл.');
      return {name:file.name,base64:file.base64};
    });
    return {kind:data.kind,version:1,task:global.LabTeaching.validateTask(data.task),notes:data.notes,materials};
  }

  function references() {
    const ink={layer:'main',color:'#263c46',width:2};
    const rect={...ink,id:'plate',type:'path',points:[[40,40],[240,40],[240,160],[40,160],[40,40]].map(([x,y])=>({x,y}))};
    const circle={...ink,id:'bore',type:'circle',cx:140,cy:100,r:16};
    return [
      {name:'Пластина 50 × 30 × 8',strokes:[rect],height:8,bounds:[50,30,8],volume:12000,holes:0,
        edges:[[4,4],[4,4],[4,4]]},
      {name:'Пластина с отверстием Ø8',strokes:[rect,circle],height:8,bounds:[50,30,8],volume:(1500-16*Math.PI)*8,holes:1,
        edges:[[52,52],[4,54],[4,54]]},
      {name:'Рамка 60 × 40 × 6',strokes:[
        {...rect,points:[[40,40],[280,40],[280,200],[40,200],[40,40]].map(([x,y])=>({x,y}))},
        {...rect,id:'inner',points:[[60,60],[260,60],[260,180],[60,180],[60,60]].map(([x,y])=>({x,y}))}
      ],height:6,bounds:[60,40,6],volume:5400,holes:1,edges:[[8,8],[4,8],[4,8]]}
    ];
  }

  function referenceReport(reference, prepare) {
    const project=prepare({version:1,orientation:'landscape',strokes:reference.strokes,modelHeight:reference.height});
    const {mesh}=build(prepare(JSON.parse(JSON.stringify(project))));
    const {dimensions}=metrics(project,mesh);
    const geometry=global.LabDrawingGeometry;
    const views=['top','front','side'].map((view,index)=>{
      const projection=geometry.orthographic(mesh,view);
      const [visible,hidden]=reference.edges[index];
      return projection.visible.length===visible&&projection.hidden.length===hidden;
    });
    const dxf=global.LabProjectFormats.dxf(global.LabProjectFormats.toDXF(project));
    return {
      volume:mesh.stats.volumeMm3,segments:views.filter(Boolean).length,triangles:mesh.stats.triangles,
      passed:mesh.stats.closed&&dimensions.slice(0,3).every((size,index)=>Math.abs(size-reference.bounds[index])<.001)&&
        Math.abs(mesh.stats.volumeMm3-reference.volume)<2&&mesh.stats.holes===reference.holes&&views.every(Boolean)&&
        dxf.project.strokes.length===project.strokes.length
    };
  }

  const api={build,metrics,validatePack,references,referenceReport};
  global.LabWorkbenchData=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
