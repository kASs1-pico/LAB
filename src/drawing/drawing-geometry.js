/* Orthographic mesh drawing and print-bed analysis in millimetres. */
(function (global) {
  'use strict';

  const EPS = 1e-6;
  const views = {
    front: p => [p[0], p[2], -p[1]],
    top: p => [p[0], p[1], p[2]],
    side: p => [p[1], p[2], p[0]],
    iso: ([x,y,z]) => [(x+y)/Math.sqrt(2),(-x+y+2*z)/Math.sqrt(6),(x-y+z)/Math.sqrt(3)]
  };
  const orthogonalViews=['top','front','side'];
  const pageScales=[.1,.2,.25,.5,1,2,4,5,10];
  const cross2 = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const vertexKey = p => p.map(n => Math.round(n * 1e5)).join(',');
  const edgeKey = (a, b) => {
    const p = vertexKey(a), q = vertexKey(b);
    return p < q ? p + '|' + q : q + '|' + p;
  };
  const interpolate = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  const boxOverlap = (a, b) => a[0] <= b[2] + EPS && a[2] + EPS >= b[0] && a[1] <= b[3] + EPS && a[3] + EPS >= b[1];
  const box2 = points => [
    Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])),
    Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))
  ];

  function projectedBounds(bounds, view) {
    const project = typeof view==='function'?view:views[view];
    const points = [];
    for (const x of [bounds.min[0], bounds.max[0]]) {
      for (const y of [bounds.min[1], bounds.max[1]]) {
        for (const z of [bounds.min[2], bounds.max[2]]) points.push(project([x,y,z]));
      }
    }
    return box2(points);
  }

  function facesFor(mesh, project) {
    const faces = [], edges = new Map();
    const sharp = new Set();
    for (let i = 0; i < mesh.edges.length; i += 6) {
      sharp.add(edgeKey(Array.from(mesh.edges.subarray(i,i+3)), Array.from(mesh.edges.subarray(i+3,i+6))));
    }
    for (let i = 0; i < mesh.positions.length; i += 9) {
      const world = [0,3,6].map(k => Array.from(mesh.positions.subarray(i+k,i+k+3)));
      const [a,b,c] = world.map(project);
      const orientation = cross2(a,b,c);
      const body = mesh.bodies?.[mesh.bodyIds?.[i/9]]?.id || null;
      for (let j = 0; j < 3; j++) {
        const key = edgeKey(world[j],world[(j+1)%3]);
        if (!edges.has(key)) edges.set(key,{points:[project(world[j]),project(world[(j+1)%3])],front:false,back:false,count:0,sharp:sharp.has(key),body});
        const edge = edges.get(key);
        edge.count++;
        edge.front ||= orientation > EPS;
        edge.back ||= orientation < -EPS;
      }
      if (orientation <= EPS) continue;
      const dx = ((b[2]-a[2])*(c[1]-a[1]) - (c[2]-a[2])*(b[1]-a[1])) / orientation;
      const dy = ((b[0]-a[0])*(c[2]-a[2]) - (c[0]-a[0])*(b[2]-a[2])) / orientation;
      faces.push({points:[a,b,c],box:box2([a,b,c]),depth:p=>a[2]+dx*(p[0]-a[0])+dy*(p[1]-a[1]),maxDepth:Math.max(a[2],b[2],c[2]),body});
    }
    return {faces, edges:[...edges.values()].filter(e=>e.sharp||e.count===1||e.front&&e.back)};
  }

  function tree(items) {
    if (!items.length) return null;
    const box = [Infinity,Infinity,-Infinity,-Infinity];
    let depth = -Infinity;
    for (const item of items) {
      for (const i of [0,1]) {
        box[i] = Math.min(box[i],item.box[i]);
        box[i+2] = Math.max(box[i+2],item.box[i+2]);
      }
      depth = Math.max(depth,item.maxDepth);
    }
    if (items.length <= 12) return {box,depth,items};
    const axis = box[2]-box[0] >= box[3]-box[1] ? 0 : 1;
    const mid = Math.floor(items.length/2);
    items.sort((x,y)=>x.box[axis]+x.box[axis+2]-y.box[axis]-y.box[axis+2]);
    return {box,depth,left:tree(items.slice(0,mid)),right:tree(items.slice(mid))};
  }

  function limit(range, a, b) {
    if (a >= 0 && b >= 0) return true;
    if (a < 0 && b < 0) return false;
    const cut = a / (a-b);
    if (a < 0) range[0] = Math.max(range[0],cut);
    else range[1] = Math.min(range[1],cut);
    return range[1]-range[0] > EPS;
  }

  function coveringIntervals(index, a, b) {
    const box = box2([a,b]), minDepth = Math.min(a[2],b[2]);
    const intervals = [];
    function visit(node) {
      if (!node || node.depth <= minDepth+EPS || !boxOverlap(node.box,box)) return;
      if (!node.items) {
        visit(node.left);
        visit(node.right);
        return;
      }
      for (const face of node.items) {
        if (face.maxDepth <= minDepth+EPS || !boxOverlap(face.box,box)) continue;
        const range = [0,1];
        if (!limit(range,face.depth(a)-a[2]-EPS,face.depth(b)-b[2]-EPS)) continue;
        if (face.points.every((p,i)=>{
          const q = face.points[(i+1)%3];
          return limit(range,cross2(p,q,a)+EPS,cross2(p,q,b)+EPS);
        })) intervals.push(range);
      }
    }
    visit(index);
    intervals.sort((x,y)=>x[0]-y[0]);
    const joined=[];
    for(const interval of intervals){
      const previous=joined.at(-1);
      if(previous&&interval[0]<=previous[1]+EPS)previous[1]=Math.max(previous[1],interval[1]);
      else joined.push(interval);
    }
    return joined;
  }

  function orthographic(mesh, view) {
    const {faces, edges} = facesFor(mesh,typeof view==='function'?view:views[view]);
    const index = tree(faces);
    const visible = [], hidden = [], hiddenKeys = new Set();
    for (const edge of edges) {
      const [a,b] = edge.points;
      if (Math.hypot(a[0]-b[0],a[1]-b[1]) <= EPS) continue;
      const cuts = coveringIntervals(index,a,b);
      let end = 0;
      for (const [start,stop] of cuts) {
        if (start > end+EPS) visible.push([interpolate(a,b,end),interpolate(a,b,start),edge.front&&edge.back,edge.body]);
        if (stop > end+EPS) {
          const from=interpolate(a,b,Math.max(end,start)),to=interpolate(a,b,stop);
          const key=edgeKey(from.slice(0,2),to.slice(0,2));
          if(!hiddenKeys.has(key)){hiddenKeys.add(key);hidden.push([from,to,false,edge.body]);}
        }
        end = Math.max(end,stop);
      }
      if (end < 1-EPS) visible.push([interpolate(a,b,end),b,edge.front&&edge.back,edge.body]);
    }
    function pick(p) {
      const box = [p[0],p[1],p[0],p[1]];
      let bestDepth = -Infinity, body = null;
      function visit(node) {
        if (!node || node.depth < bestDepth || !boxOverlap(node.box,box)) return;
        if (!node.items) { visit(node.left);visit(node.right);return; }
        for (const face of node.items) {
          if (!boxOverlap(face.box,box)||!face.points.every((a,i)=>cross2(a,face.points[(i+1)%3],p)>=-EPS)) continue;
          const depth = face.depth(p);
          if(depth>bestDepth){bestDepth=depth;body=face.body;}
        }
      }
      visit(index);
      return body;
    }
    return {visible,hidden,pick,bounds:projectedBounds(mesh.bounds,view)};
  }

  const length2 = ([x,y]) => Math.hypot(x,y);
  const distance2 = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
  const dot2 = (a,b) => a[0]*b[0]+a[1]*b[1];
  const unit2 = vector => vector.map(value=>value/length2(vector));
  const projectPoint = (view,point) => views[view](point);
  const normalizedPoint = (point,bounds) => point.slice(0,2).map((value,i)=>
    Math.max(0,Math.min(1,(value-bounds[i])/Math.max(EPS,bounds[i+2]-bounds[i]))));
  const pointFromNormalized = (point,bounds) => point.map((value,i)=>bounds[i]+value*(bounds[i+2]-bounds[i]));

  function projectedCylinders(mesh, view, projection) {
    const assembly = global.LabAssemblyGeometry;
    if (!assembly) return [];
    const edgesByBody=new Map();
    for(const [a,b,,id] of projection.visible){
      if(!edgesByBody.has(id))edgesByBody.set(id,[]);
      edgesByBody.get(id).push([a,b]);
    }
    return (mesh.bodies||[]).flatMap(body => (body.assemblyCylinders||[]).flatMap(cylinder => {
      const position = assembly.placePoint(body,cylinder.origin);
      const direction = projectPoint(view,assembly.placeDirection(body,cylinder.normal));
      if (Math.abs(direction[2]) < .99999) return [];
      const center=projectPoint(view,position).slice(0,2),radius=cylinder.radius;
      // Check that the corresponding round edge still exists on the final mesh.
      const tolerance=Math.max(.002,radius*.004);
      const rim=edgesByBody.get(body.id)?.filter(segment=>segment.every(point=>Math.abs(distance2(point,center)-radius)<tolerance));
      if(!rim?.length)return [];
      return [{bodyId:body.id,key:cylinder.key,center,radius}];
    }));
  }

  function projectedCorners(mesh,view,projection) {
    const byPoint=new Map();
    const bounds=new Map((mesh.bodies||[]).map(body=>[body.id,projectedBounds(body.bounds,view)]));
    for(const [a,b,,bodyId] of projection.visible){
      if(!bounds.has(bodyId))continue;
      for(const [origin,end] of [[a,b],[b,a]]){
        const p=origin.slice(0,2),q=end.slice(0,2),key=bodyId+':'+vertexKey(p),vector=[q[0]-p[0],q[1]-p[1]];
        if(length2(vector)<=EPS)continue;
        if(!byPoint.has(key))byPoint.set(key,{bodyId,origin:p,rays:[]});
        const {rays}=byPoint.get(key),direction=unit2(vector);
        if(!rays.some(ray=>dot2(ray,direction)>1-EPS))rays.push(direction);
      }
    }
    return [...byPoint.values()].filter(corner=>corner.rays.some((ray,i)=>corner.rays.slice(i+1).some(other=>Math.abs(dot2(ray,other))<1-1e-5)))
      .map(corner=>({...corner,anchor:normalizedPoint(corner.origin,bounds.get(corner.bodyId))}));
  }

  function angleRays(corner, preferred) {
    let result=null,score=-Infinity;
    for(let i=0;i<corner.rays.length;i++)for(let j=i+1;j<corner.rays.length;j++){
      const a=corner.rays[i],b=corner.rays[j],alignment=dot2(a,b);
      if(Math.abs(alignment)>=1-1e-5)continue;
      const ranking=preferred?Math.max(dot2(a,preferred[0])+dot2(b,preferred[1]),dot2(a,preferred[1])+dot2(b,preferred[0])):1-Math.abs(alignment);
      if(ranking>score){score=ranking;result=[a,b];}
    }
    return result;
  }

  function closestOnSegments(point,segments) {
    let closest=null;
    for(const [start,end] of segments){
      const a=start.slice(0,2),d=[end[0]-a[0],end[1]-a[1]];
      const span=dot2(d,d);
      if(span<=EPS*EPS)continue;
      const t=Math.max(0,Math.min(1,dot2([point[0]-a[0],point[1]-a[1]],d)/span));
      const snapped=[a[0]+d[0]*t,a[1]+d[1]*t],distance=distance2(point,snapped);
      if(!closest||distance<closest.distance)closest={point:snapped,distance};
    }
    return closest;
  }

  function planeSection(mesh,view,a,b) {
    const I=global.LabInspectGeometry,E=global.LabExtrusion;
    if(distance2(a,b)<=EPS)throw new Error('Отметьте две разные точки линии разреза.');
    const [u,v]=unit2([b[0]-a[0],b[1]-a[1]]);
    function transform([x,y,z]){
      return [u*x+v*y,z,v*x-u*y];
    }
    const point=p=>{
      const q=projectPoint(view,p);
      return transform([q[0]-a[0],q[1]-a[1],q[2]]);
    };
    const local=I.transformed(mesh,point,p=>transform(projectPoint(view,p)));
    const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
    for(let i=0;i<local.positions.length;i++){
      const k=i%3,value=local.positions[i];
      bounds.min[k]=Math.min(bounds.min[k],value);
      bounds.max[k]=Math.max(bounds.max[k],value);
    }
    const [low,high]=[bounds.min[2],bounds.max[2]];
    if(low>=-EPS||high<=EPS)throw new Error('Линия разреза должна проходить через материал детали.');
    local.bounds=bounds;
    const sliced=E.section(local,{axis:'z',position:-low/(high-low)});
    if(!sliced.capPositions.length)throw new Error('Линия разреза не пересекает материал.');
    const segments=[],triangles=[];
    for(let i=0;i<sliced.edges.length;i+=6){
      segments.push([Array.from(sliced.edges.subarray(i,i+2)),Array.from(sliced.edges.subarray(i+3,i+5))]);
    }
    for(let i=0;i<sliced.capPositions.length;i+=9){
      triangles.push([0,3,6].map(j=>Array.from(sliced.capPositions.subarray(i+j,i+j+2))));
    }
    return {segments,triangles,bounds:sectionBounds(triangles)};
  }

  function sectionBounds(triangles){
    const bounds=[Infinity,Infinity,-Infinity,-Infinity];
    for(const triangle of triangles)for(const [x,y] of triangle){
      bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);
      bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);
    }
    return bounds;
  }

  function steppedTrace(points){
    const [a,b,c]=points,d=unit2([b[0]-a[0],b[1]-a[1]]);
    const n=[-d[1],d[0]],shift=dot2([c[0]-b[0],c[1]-b[1]],n);
    const offset=p=>[p[0]+n[0]*shift,p[1]+n[1]*shift];
    return {start:a,bend:b,next:offset(b),secondStart:offset(a),direction:d,length:distance2(a,b),shift};
  }

  function clipAtStep(points,cutoff,direction){
    const result=[];
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length];
      const x=direction*(a[0]-cutoff),y=direction*(b[0]-cutoff);
      if(x>=0)result.push(a);
      if((x<0)!==(y<0))result.push([cutoff,a[1]+(b[1]-a[1])*x/(x-y)]);
    }
    return result;
  }

  function sliceHalf(mesh,view,a,b,cutoff,direction){
    let slice;
    try{slice=planeSection(mesh,view,a,b);}
    catch(error){
      if(!/через материал|не пересекает материал/.test(error.message))throw error;
      return {triangles:[],segments:[]};
    }
    const triangles=[],segments=[];
    for(const triangle of slice.triangles){
      const points=clipAtStep(triangle,cutoff,direction);
      for(let i=1;i+1<points.length;i++)
        if(Math.abs(cross2(points[0],points[i],points[i+1]))>EPS)triangles.push([points[0],points[i],points[i+1]]);
    }
    for(const [p,q] of slice.segments){
      const a=direction*(p[0]-cutoff),b=direction*(q[0]-cutoff);
      if(a<0&&b<0)continue;
      const start=a<0?interpolate(p,q,a/(a-b)):p,end=b<0?interpolate(q,p,b/(b-a)):q;
      if(distance2(start,end)>EPS)segments.push([start,end]);
    }
    return {triangles,segments};
  }
  function seamEdges(left,right,x){
    const occupied=triangles=>triangles.flatMap(triangle=>{
      const ends=triangle.filter(point=>Math.abs(point[0]-x)<EPS).map(point=>point[1]).sort((a,b)=>a-b);
      return ends.length>1&&ends.at(-1)-ends[0]>EPS?[[ends[0],ends.at(-1)]]:[];
    });
    const sides=[occupied(left),occupied(right)];
    const levels=sides.flat().flat().sort((a,b)=>a-b),segments=[];
    for(let i=1;i<levels.length;i++){
      const low=levels[i-1],high=levels[i];
      if(high-low<EPS)continue;
      const mid=(low+high)/2;
      const [l,r]=sides.map(intervals=>intervals.some(([a,b])=>mid>=a&&mid<=b));
      if(l!==r)segments.push([[x,low],[x,high]]);
    }
    return segments;
  }

  function crossSection(mesh, {view,points}){
    const [a,b]=points;
    if(points.length===2)return planeSection(mesh,view,a,b);
    const step=steppedTrace(points);
    const left=sliceHalf(mesh,view,step.start,step.bend,step.length,-1);
    const right=sliceHalf(mesh,view,step.secondStart,step.next,step.length,1);
    const triangles=left.triangles.concat(right.triangles);
    const segments=left.segments.concat(right.segments,seamEdges(left.triangles,right.triangles,step.length));
    if(!triangles.length)throw new Error('Линия разреза не пересекает материал.');
    return {triangles,segments,bounds:sectionBounds(triangles)};
  }

  function validatePage(value){
    if(!value||typeof value!=='object'||!['А4','А3'].includes(value.format)||
      !['landscape','portrait'].includes(value.orientation))throw new Error('Выберите формат и ориентацию листа.');
    const text=(key,max)=>typeof value[key]==='string'?value[key].trim().slice(0,max):'';
    const layout={format:value.format,orientation:value.orientation,title:text('title',54),author:text('author',42),
      className:text('className',18),sheetNumber:text('sheetNumber',14),iso:Boolean(value.iso),
      holes:Boolean(value.holes),specification:Boolean(value.specification),views:{},detail:null};
    for(const id of orthogonalViews){
      const v=value.views?.[id];
      const offset=n=>Number.isFinite(n)?Math.max(-120,Math.min(120,n)):0;
      layout.views[id]={x:offset(v?.x),y:offset(v?.y),scale:pageScales.includes(v?.scale)?v.scale:0};
    }
    if(value.detail){
      const {view,points}=value.detail;
      if(!orthogonalViews.includes(view)||!Array.isArray(points)||points.length!==2||
        !points.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e6))||
        points[0].some((n,i)=>Math.abs(n-points[1][i])<.005))throw new Error('Отметьте прямоугольную область выносного вида.');
      layout.detail={view,points:points.map(p=>p.slice())};
    }
    return layout;
  }

  function validateDraftDesign(input) {
    const design=input===undefined?{section:null,notes:[]}:input;
    const validView=view=>orthogonalViews.includes(view);
    const id=value=>typeof value==='string'&&/^[a-z0-9_-]{1,96}$/i.test(value);
    const points=(value,limit=1e6)=>Array.isArray(value)&&value.length===2&&value.every(n=>Number.isFinite(n)&&Math.abs(n)<=limit);
    const pair=(value,valid)=>Array.isArray(value)&&value.length===2&&value.every(valid);
    const normalized=value=>points(value,1)&&value.every(n=>n>=0);
    const check=(condition,message='Неверное обозначение чертежа.')=>{if(!condition)throw new Error(message);};
    check(design&&Array.isArray(design.notes)&&design.notes.length<=50,'На чертеже можно сохранить до 50 обозначений.');
    const raw=design.section;
    let section=null;
    if(raw!==null&&raw!==undefined){
      check(validView(raw.view)&&Array.isArray(raw.points)&&[2,3].includes(raw.points.length)&&
        raw.points.every(p=>points(p))&&distance2(...raw.points)>EPS,'Неверная линия разреза А–А.');
      if(raw.points.length===3)check(Math.abs(steppedTrace(raw.points).shift)>.005,'Укажите ненулевую величину ступени.');
      section={view:raw.view,points:raw.points.map(p=>p.slice())};
    }
    const notes=design.notes.map(note=>{
      check(note&&typeof note.kind==='string');
      const {kind,view,bodyId,key}=note;
      if(kind==='section-length'){
        check(section&&pair(note.anchors,normalized)&&distance2(...note.anchors)>EPS);
        return {kind,anchors:note.anchors.map(p=>p.slice())};
      }
      check(validView(view));
      if(kind==='measurement'){
        check(id(note.measurementId));
        return {kind,view,measurementId:note.measurementId};
      }
      check(id(bodyId)&&bodyId.startsWith('body-'));
      if(kind==='angle'){
        check(normalized(note.anchor)&&pair(note.rays,p=>points(p,1)&&Math.abs(length2(p)-1)<.001));
        return {kind,view,bodyId,anchor:note.anchor.slice(),rays:note.rays.map(p=>p.slice())};
      }
      check(['radius','diameter','centerline'].includes(kind)&&typeof key==='string'&&/^[sf]:[a-z0-9_-]{1,96}(?::(?:shaft|head))?$/i.test(key));
      return {kind,view,bodyId,key};
    });
    const result={section,notes,...(design.layout?{layout:validatePage(design.layout)}:{})};
    if(design.extras){
      const extra=global.LabDrawingExtra||(typeof require==='function'&&require('./drawing-tools-extra.js'));
      result.extras=extra.validate(design.extras);
    }
    return result;
  }

  function printOrientation(mesh, up, threshold=45) {
    const G = global.LabInspectGeometry;
    const n = G.unit(up);
    const u = G.unit(G.cross(Math.abs(n[0])<.9?[1,0,0]:[0,1,0],n));
    const v = G.cross(n,u);
    const vector = p => [G.dot(p,u),G.dot(p,v),G.dot(p,n)];
    const origin = G.center(mesh.bounds);
    const centerPoint = p => G.sub(p,origin);
    let floor = Infinity;
    for (let i=0;i<mesh.positions.length;i+=3) floor=Math.min(floor,G.dot(centerPoint(Array.from(mesh.positions.subarray(i,i+3))),n));
    const points = p => {
      const q = vector(centerPoint(p));
      q[2] -= floor;
      return q;
    };
    const oriented = G.transformed(mesh,points,vector);
    const triangles = G.triangles(oriented);
    oriented.bounds = G.bounds(triangles.flatMap(t=>[t.a,t.b,t.c]));
    oriented.bodyIds = mesh.bodyIds;
    const patches = [], supports = [];
    let contactArea = 0, overhangArea = 0;
    const limit = -Math.sin(threshold*Math.PI/180);
    const planeTolerance = Math.max(1e-5,Math.hypot(...G.sub(oriented.bounds.max,oriented.bounds.min))*3e-7);
    for (const t of triangles) {
      if (t.normal[2] >= -EPS) continue;
      const area = Math.hypot(...G.cross(G.sub(t.b,t.a),G.sub(t.c,t.a)))/2;
      if (t.bounds.max[2] <= planeTolerance) {
        contactArea += area;
        supports.push(...t.a,...t.b,...t.b,...t.c,...t.c,...t.a);
      } else if(t.normal[2] <= limit) {
        overhangArea += area;
        patches.push(...t.a,...t.b,...t.c);
      }
    }
    const {min,max} = oriented.bounds,span=Math.max(max[0]-min[0],max[1]-min[1],5);
    const step = 10**Math.floor(Math.log10(span/6));
    const loX = Math.floor((min[0]-span*.15)/step)*step, hiX = Math.ceil((max[0]+span*.15)/step)*step;
    const loY = Math.floor((min[1]-span*.15)/step)*step, hiY = Math.ceil((max[1]+span*.15)/step)*step;
    const guides = [], z = -.04;
    for(let x=loX;x<=hiX+EPS;x+=step) guides.push(x,loY,z,x,hiY,z);
    for(let y=loY;y<=hiY+EPS;y+=step) guides.push(loX,y,z,hiX,y,z);
    return {mesh:oriented,patches,guides,supports,contactArea,overhangArea,unorient:p=>G.add(G.add(G.scale(u,p[0]),G.scale(v,p[1])),G.scale(n,p[2]))};
  }

  const api={orthographic,projectedBounds,projectPoint,projectedCylinders,projectedCorners,angleRays,
    normalizedPoint,pointFromNormalized,closestOnSegments,crossSection,steppedTrace,validateDraftDesign,validatePage,pageScales,printOrientation};
  global.LabDrawingGeometry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
