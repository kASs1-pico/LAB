/* Geometry and coordinate systems used by drawing sheets. */
(function (root) {
  'use strict';
  const G=root.LabDrawingGeometry;
  const layout = {
    top:   {x:11,y:12,w:133,h:83,name:'Вид сверху'},
    front: {x:11,y:99,w:133,h:83,name:'Вид спереди'},
    side:  {x:150,y:99,w:135,h:83,name:'Вид справа'}
  };
  const sectionLayout = {x:150,y:12,w:135,h:83,name:'Разрез А–А'};
  const scaleSteps = [100,50,20,10,5,2,1,.5,.25,.2,.1,.05,.02,.01,.005,.002,.001];
  function sheetSize(settings){
    const dimensions=settings.format==='А3'?[420,297]:[297,210];
    return settings.orientation==='portrait'?dimensions.reverse():dimensions;
  }
  function draftModel(mesh,settings,previous) {
    const [width,height]=sheetSize(settings);
    const viewBox=(r,offset={x:0,y:0})=>({...r,x:r.x*width/297+offset.x,y:r.y*(height-20)/190+offset.y,
      w:r.w*width/297,h:r.h*(height-20)/190});
    const rects=Object.fromEntries(Object.entries(layout).map(([id,r])=>[id,viewBox(r,settings.views[id])]));
    rects.section=viewBox(sectionLayout);
    const views=previous?.mesh===mesh?previous.views:Object.fromEntries(Object.keys(layout).map(view=>[view,G.orthographic(mesh,view)]));
    const maximum = Math.min(...Object.keys(layout).flatMap(view=>{
      const r=rects[view], [minX,minY,maxX,maxY]=views[view].bounds;
      return [(r.w-41)/Math.max(maxX-minX,.001),(r.h-32)/Math.max(maxY-minY,.001)];
    }));
    const scale = scaleSteps.find(value=>value<=maximum)||maximum;
    const maps = {};
    for (const view of Object.keys(layout)) {
      const r=rects[view],ratio=settings.views[view].scale||scale;
      const [a,b,c,d]=views[view].bounds;
      maps[view] = {x:r.x+r.w/2-ratio*(a+c)/2,y:r.y+r.h/2+ratio*(b+d)/2,scale:ratio};
    }
    return {mesh,views,maps,scale,rects,width,height,settings,
      features:previous?.mesh===mesh?previous.features:new Map(),section:null,edgePaths:new Map(),
      iso:previous?.mesh===mesh?previous.iso:null};
  }
  function toSheet(scene,view,p) {
    const {x,y,scale}=scene.maps[view];
    return [x+p[0]*scale,y-p[1]*scale];
  }
  function toProjection(scene,view,p) {
    const {x,y,scale}=scene.maps[view];
    return [(p.x-x)/scale,(y-p.y)/scale];
  }
  function paths(scene,view,segments) {
    const parts = [];
    for (const [a,b] of segments) {
      const [x0,y0] = toSheet(scene,view,a), [x1,y1] = toSheet(scene,view,b);
      parts.push(`M${x0.toFixed(3)} ${y0.toFixed(3)}L${x1.toFixed(3)} ${y1.toFixed(3)}`);
    }
    return parts.join('');
  }
  function projectedEdgePaths(scene,view,includeHidden){
    let result=scene.edgePaths.get(view);
    const projection=scene.views[view];
    if(!result){
      const normal=[],silhouette=[];
      for(const segment of projection.visible){
        (segment[2]?silhouette:normal).push(segment);
      }
      result={normal:paths(scene,view,normal),silhouette:paths(scene,view,silhouette)};
      scene.edgePaths.set(view,result);
    }
    if(includeHidden&&result.hidden===undefined)result.hidden=paths(scene,view,projection.hidden);
    return result;
  }
  function features(scene,id) {
    if(!scene.features.has(id)){
      const projection=scene.views[id];
      scene.features.set(id,{
        circles:G.projectedCylinders(scene.mesh,id,projection),
        corners:G.projectedCorners(scene.mesh,id,projection)
      });
    }
    return scene.features.get(id);
  }
  function sectionScene(scene,descriptor) {
    const key=JSON.stringify(descriptor);
    if(scene.section?.key===key)return scene.section.value;
    let value=null;
    if(descriptor){
      try {
        const model=G.crossSection(scene.mesh,descriptor),r=scene.rects.section;
        const [a,b,c,d]=model.bounds;
        const maximum=Math.min((r.w-27)/Math.max(c-a,.001),(r.h-28)/Math.max(d-b,.001));
        const scale=scaleSteps.find(n=>n<=maximum)||maximum;
        const x=r.x+r.w/2-scale*(a+c)/2,y=r.y+(r.h+8)/2+scale*(b+d)/2;
        value={...model,scale,x,y};
      } catch { /* The model may have changed since the cut was defined. */ }
    }
    scene.section={key,value};
    return value;
  }
  const sectionPoint=(section,p)=>[section.x+p[0]*section.scale,section.y-p[1]*section.scale];
  function regionBox(bounds){
    const [a,b]=bounds;
    return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
  }
  function segmentInRegion(a,b,box){
    let start=0,end=1;
    for(let i=0;i<2;i++){
      const delta=b[i]-a[i];
      if(Math.abs(delta)<1e-8){
        if(a[i]<box[i]||a[i]>box[i+2])return false;
        continue;
      }
      const low=(box[i]-a[i])/delta,high=(box[i+2]-a[i])/delta;
      start=Math.max(start,Math.min(low,high));end=Math.min(end,Math.max(low,high));
      if(end<start)return false;
    }
    return true;
  }
  function holeRecords(scene){
    const inner=new Map(scene.mesh.bodies.flatMap(body=>(body.assemblyCylinders||[]).filter(cylinder=>cylinder.inner)
      .map(cylinder=>[body.id+'|'+cylinder.key,cylinder])));
    const seen=new Set(),records=[];
    for(const id of Object.keys(layout)){
      if(!inner.size)break;
      const [x,y]=scene.views[id].bounds;
      for(const record of features(scene,id).circles){
        const key=record.bodyId+'|'+record.key,cylinder=inner.get(key);
        if(!cylinder||seen.has(key))continue;
        seen.add(key);
        records.push({...record,view:id,x:record.center[0]-x,y:record.center[1]-y,depth:cylinder.length});
      }
    }
    return records;
  }
  function shapeKey(body){
    const mesh=body.mesh,points=[];
    for(let i=0;i<mesh.positions.length;i+=3){
      const point=mesh.positions.subarray(i,i+3);
      points.push(root.LabAssemblyGeometry?.unplacePoint(body,point)||Array.from(point));
    }
    const origin=[Infinity,Infinity,Infinity];
    for(const point of points)for(let j=0;j<3;j++)origin[j]=Math.min(origin[j],point[j]);
    const vertices=points.map(p=>p.map((n,i)=>Math.round((n-origin[i])*1000)).join(','));
    const triangles=[];
    for(let i=0;i<vertices.length;i+=3)triangles.push(vertices.slice(i,i+3).sort().join(':'));
    return triangles.sort().join(';');
  }
  function componentRows(scene){
    const counts=new Map(),bodies=scene.mesh.bodies;
    for(const body of bodies)counts.set(body.name,(counts.get(body.name)||0)+1);
    const groups=new Map();
    for(const body of bodies){
      const key=counts.get(body.name)>1?body.name+'|'+shapeKey(body):body.id;
      if(!groups.has(key))groups.set(key,{name:body.name,bodies:[]});
      groups.get(key).bodies.push(body);
    }
    return [...groups.values()];
  }
  root.LabDrawingSheetScene=Object.freeze({
    layout,scaleSteps,draftModel,toSheet,toProjection,paths,projectedEdgePaths,features,
    sectionScene,sectionPoint,regionBox,segmentInRegion,holeRecords,componentRows
  });
})(typeof window==='undefined'?globalThis:window);
