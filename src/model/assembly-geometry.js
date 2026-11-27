/* Working plane, stepped fastener and assembly feature descriptors.
   Geometric references live in the base part's millimetre coordinates. */
(function(global) {
  'use strict';
  const EPS=1e-7;
  const plus=(a,b)=>a.map((x,i)=>x+b[i]);
  const minus=(a,b)=>a.map((x,i)=>x-b[i]);
  const times=(a,s)=>a.map(x=>x*s);
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const norm=a=>Math.hypot(...a);
  const identity=[[1,0,0],[0,1,0],[0,0,1]];
  function check(value,message){if(!value)throw new Error(message);}
  function unit(a){
    const magnitude=norm(a);
    check(magnitude>EPS,'Укажите направление ненулевой длины.');
    return times(a,1/magnitude);
  }
  function vector(value){
    check(Array.isArray(value)&&value.length===3&&value.every(n=>Number.isFinite(n)&&Math.abs(n)<=10000),'Неверные координаты операции.');
    return value.slice();
  }
  function range(value,min,max,message){
    check(Number.isFinite(value)&&value>=min&&value<=max,message);
    return value;
  }
  function frame(origin,normal,basis) {
    const n=unit(normal),direction=basis||cross(Math.abs(n[2])>.9?[0,1,0]:[0,0,1],n);
    const u=unit(minus(direction,times(n,dot(n,direction)))),v=cross(n,u);
    return {
      origin,normal:n,u,v,
      project(p){const d=minus(p,origin);return [dot(d,u),dot(d,v),dot(d,n)];},
      world(x,y,z=0){return plus(origin,plus(times(u,x),plus(times(v,y),times(n,z))));}
    };
  }
  function reference(value,mode){
    if(mode==='axis'){
      check(value?.kind==='cylinder'&&typeof value.key==='string'&&/^([sf]):[a-zA-Z0-9_-]+(?::(?:shaft|head))?$/.test(value.key)&&value.key.length<=104,'Выберите цилиндрическую стенку.');
      return {kind:'cylinder',key:value.key};
    }
    check(value?.kind==='face','Отметьте плоскую грань.');
    const ref={kind:'face',point:vector(value.point),normal:unit(vector(value.normal))};
    if(['top','bottom'].includes(value.cap))ref.cap=value.cap;
    return ref;
  }
  function validateFeature(input,feature){
    if(input.type==='mate'){
      check(typeof input.tool==='string'&&/^body-[a-zA-Z0-9_-]+$/.test(input.tool)&&input.tool.length<=96&&input.tool!==input.target,'Выберите две разные детали.');
      check(['axis','faces','slide'].includes(input.mode),'Выберите способ стыковки.');
      const result={...feature,tool:input.tool,mode:input.mode,moving:reference(input.moving,input.mode),fixed:reference(input.fixed,input.mode),
        distance:range(input.distance,-500,500,'Задайте сдвиг от −500 до 500 мм.')};
      if(input.mode==='slide'){
        result.min=range(input.min,-500,500,'Нижняя граница хода вне диапазона.');
        result.max=range(input.max,result.min+.05,500,'Верхняя граница должна быть больше нижней.');
        check(result.distance>=result.min&&result.distance<=result.max,'Сдвиг должен находиться в пределах хода.');
      }
      return result;
    }
    const origin=vector(input.origin),normal=unit(vector(input.normal));
    if(input.type==='fastener'){
      const diameter=range(input.diameter,.2,150,'Сквозной диаметр должен быть от 0,2 до 150 мм.');
      const headDiameter=range(input.headDiameter,.3,200,'Диаметр под головку должен быть от 0,3 до 200 мм.');
      check(headDiameter>=diameter+.05,'Диаметр под головку должен быть больше диаметра отверстия.');
      if(input.headStyle==='cone'){
        const headAngle=range(input.headAngle,30,150,'Задайте угол зенковки от 30 до 150°.');
        const headDepth=range((headDiameter-diameter)/2/Math.tan(headAngle*Math.PI/360),.01,200,'Расчётная глубина зенковки выходит за пределы 0,01–200 мм.');
        return {...feature,origin,normal,diameter,headDiameter,headDepth,headStyle:'cone',headAngle};
      }
      const headDepth=range(input.headDepth,.1,200,'Глубина уступа должна быть от 0,1 до 200 мм.');
      return {...feature,origin,normal,diameter,headDiameter,headDepth};
    }
    const plane=frame(origin,normal,vector(input.u));
    check(Array.isArray(input.points)&&input.points.length>=3&&input.points.length<=256,'Отметьте от 3 до 256 вершин рабочего контура.');
    const points=input.points.map(vector),profile=points.map(plane.project);
    check(profile.every(p=>Math.abs(p[2])<.001),'Все вершины должны лежать на рабочей плоскости.');
    const path=profile.map(p=>({x:p[0]*4,y:p[1]*4}));
    const inspected=global.LabExtrusion.analyze([{type:'path',points:[...path,path[0]]}],{tolerance:.01});
    check(inspected.ok,'Контур рабочего выступа должен быть простым и замкнутым.');
    const depth=range(input.depth,-500,500,'Задайте длину выступа от −500 до 500 мм.');
    check(Math.abs(depth)>=.1,'Длина выступа должна быть не меньше 0,1 мм.');
    return {...feature,origin,normal,u:plane.u,points,depth};
  }

  function applyRotation(basis,p){return [0,1,2].map(i=>basis[0][i]*p[0]+basis[1][i]*p[1]+basis[2][i]*p[2]);}
  const placeDirection=(body,vector)=>body?.assemblyTransform?applyRotation(body.assemblyTransform.basis,vector):vector.slice();
  const unplaceDirection=(body,vector)=>body?.assemblyTransform?body.assemblyTransform.basis.map(axis=>dot(axis,vector)):vector.slice();
  const placePoint=(body,point)=>body?.assemblyTransform?plus(placeDirection(body,point),body.assemblyTransform.translation):point.slice();
  const unplacePoint=(body,point)=>body?.assemblyTransform?unplaceDirection(body,minus(point,body.assemblyTransform.translation)):point.slice();
  function alignment(from,to){
    const w=cross(from,to),s=norm(w),c=Math.max(-1,Math.min(1,dot(from,to)));
    if(s<=EPS&&c>0)return identity;
    const axis=s>EPS?times(w,1/s):frame([0,0,0],from).u;
    return identity.map(p=>plus(plus(times(p,c),times(cross(axis,p),s)),times(axis,dot(axis,p)*(1-c))));
  }
  function circleSupports(solid,strokes,offset,height){
    return [solid.outer,...solid.holes].flatMap((loop,index)=>{
      if(loop.sourceIndices.length!==1)return [];
      const shape=strokes[loop.sourceIndices[0]];
      if(shape?.type!=='circle'||!shape.id)return [];
      const center=[shape.cx/4,-shape.cy/4,0];
      return [{key:'s:'+shape.id,origin:plus(center,offset),normal:[0,0,1],radius:shape.r/4,length:height,inner:index>0}];
    });
  }
  function fastenerSupports(body,f) {
    const entry=plus(f.origin,body.offset),back=times(f.normal,-1);
    let distance=0;
    for(let i=0;i<body.mesh.positions.length;i+=3){
      distance=Math.max(distance,dot(minus(body.mesh.positions.subarray(i,i+3),entry),back));
    }
    const shaft={key:'f:'+f.id+':shaft',origin:plus(entry,times(back,distance)),normal:f.normal,length:distance-f.headDepth,radius:f.diameter/2,inner:true};
    if(f.headStyle==='cone')return [shaft];
    return [{key:'f:'+f.id+':head',origin:plus(entry,times(back,f.headDepth)),normal:f.normal,length:f.headDepth,radius:f.headDiameter/2,inner:true},shaft];
  }
  function surfaceReference(body,hit,mode) {
    const point=unplacePoint(body,hit.point),normal=unit(unplaceDirection(body,hit.normal)),bounds=body.baseBounds||body.bounds;
    if(mode==='axis'){
      const viable=(body.assemblyCylinders||[]).filter(s=>{
        const q=minus(point,s.origin),z=dot(q,s.normal),radial=minus(q,times(s.normal,z));
        return Math.abs(dot(normal,s.normal))<.005&&z>-.02&&z<s.length+.02&&Math.abs(norm(radial)-s.radius)<Math.max(.035,s.radius*.016)&&
          dot(normal,radial)*(s.inner?-1:1)>.8*s.radius;
      });
      check(viable.length,'Нажмите на боковую стенку круглого штифта или цилиндрического отверстия.');
      return {kind:'cylinder',key:viable[0].key};
    }
    const ref={kind:'face',point:minus(point,body.offset),normal};
    if(normal[2]>.99999&&Math.abs(point[2]-bounds.max[2])<.001)ref.cap='top';
    else if(normal[2]<-.99999&&Math.abs(point[2]-bounds.min[2])<.001)ref.cap='bottom';
    return ref;
  }
  function baseAnchor(body,ref,moving){
    if(ref.kind==='face'){
      const bounds=body.baseBounds||body.bounds;
      const point=plus(ref.point,body.offset);
      if(ref.cap==='top')point[2]=bounds.max[2];
      if(ref.cap==='bottom')point[2]=bounds.min[2];
      return {point,normal:ref.normal};
    }
    const cylinder=(body.assemblyCylinders||[]).find(s=>s.key===ref.key);
    check(cylinder,'Цилиндрическая опора изменилась. Выберите опоры снова.');
    const point=moving?cylinder.origin:plus(cylinder.origin,times(cylinder.normal,cylinder.length));
    return {point,normal:cylinder.normal,radius:cylinder.radius};
  }
  function axisOf(body,ref,moving){
    const anchor=baseAnchor(body,ref,moving);
    return {...anchor,point:placePoint(body,anchor.point),normal:placeDirection(body,anchor.normal)};
  }
  function placeMesh(body,transform){
    const mesh=body.mesh,out=global.LabSolid.createMeshBuilder();
    const pose=p=>plus(applyRotation(transform.basis,p),transform.translation);
    for(let i=0;i<mesh.positions.length;i+=9){
      const points=[0,3,6].map(j=>pose(Array.from(mesh.positions.subarray(i+j,i+j+3))));
      out.triangle(...points,mesh.contourIds?.[i/9]??-1,mesh.surfaceTypes?.[i/9]??2);
    }
    return out.finish({warnings:mesh.warnings||[],stats:mesh.stats});
  }
  function solveMates(bodies,mates,warnings) {
    const byId=new Map(bodies.map(body=>[body.id,body]));
    const operation=new Map(mates.map(mate=>[mate.target,mate]));
    const visiting=new Set(),finished=new Set();
    function solve(id){
      const feature=operation.get(id);
      if(!feature||finished.has(id))return;
      check(!visiting.has(id),'Стыковки образуют цикл. Подвижная деталь не может быть своей опорой.');
      visiting.add(id);
      const body=byId.get(id),support=byId.get(feature.tool);
      if(!body||!support)warnings.push('Стыковка временно скрыта, пока одна из деталей недоступна.');
      else {
        check(!body.fixed,'Снимите закрепление с подвижной детали или используйте её как опору.');
        solve(support.id);
        const moving=baseAnchor(body,feature.moving,true),fixed=axisOf(support,feature.fixed,false);
        const direction=feature.mode==='axis'?fixed.normal:times(fixed.normal,-1);
        const basis=alignment(moving.normal,direction);
        const target=plus(fixed.point,times(fixed.normal,feature.distance));
        const translation=minus(target,applyRotation(basis,moving.point));
        const transform={basis,translation},mesh=placeMesh(body,transform);
        body.baseBounds=body.bounds;body.assemblyTransform=transform;
        body.mesh=mesh;body.bounds=mesh.bounds;body.contours=mesh.contours;
        if(feature.mode==='axis'&&moving.radius>fixed.radius+.02){
          warnings.push('Подвижный цилиндр шире опорного отверстия. Проверьте посадку и диаметры.');
        }
      }
      visiting.delete(id);finished.add(id);
    }
    for(const id of operation.keys())solve(id);
  }

  function closestOnSegment(p,a,b){
    const direction=minus(b,a),length2=dot(direction,direction);
    const t=length2?Math.max(0,Math.min(1,dot(minus(p,a),direction)/length2)):0;
    return plus(a,times(direction,t));
  }
  function closestOnTriangle(p,{a,b,c,normal}){
    const q=minus(p,times(normal,dot(minus(p,a),normal)));
    const vertices=[a,b,c];
    const edges=vertices.map((v,i)=>[v,vertices[(i+1)%3]]);
    if(edges.every(([x,y])=>dot(cross(minus(y,x),minus(q,x)),normal)>=-EPS))return q;
    const points=edges.map(([x,y])=>closestOnSegment(p,x,y));
    return points.reduce((best,v)=>norm(minus(p,v))<norm(minus(p,best))?v:best);
  }
  function closestOnEdges(a,b,c,d){
    const u=minus(b,a),v=minus(d,c),w=minus(a,c);
    const uu=dot(u,u),uv=dot(u,v),vv=dot(v,v),uw=dot(u,w),vw=dot(v,w),denominator=uu*vv-uv*uv;
    if(denominator<=EPS)return null;
    const s=(uv*vw-vv*uw)/denominator,t=(uu*vw-uv*uw)/denominator;
    if(s<0||s>1||t<0||t>1)return null;
    return [plus(a,times(u,s)),plus(c,times(v,t))];
  }
  function minimumClearance(a,b){
    const G=global.LabInspectGeometry;
    const first=G.tree(G.triangles(a)),second=G.tree(G.triangles(b));
    if(!first||!second)return null;
    const gap=(x,y)=>Math.hypot(...x.min.map((v,i)=>Math.max(0,v-y.max[i],y.min[i]-x.max[i])));
    let best=Infinity,points=null;
    function compare(p,q){
      const distance=norm(minus(p,q));
      if(distance<best){best=distance;points=[p,q];}
    }
    function pair(x,y){
      const a=[x.a,x.b,x.c],b=[y.a,y.b,y.c];
      for(const p of a)compare(p,closestOnTriangle(p,y));
      for(const q of b)compare(closestOnTriangle(q,x),q);
      for(let i=0;i<3;i++)for(let j=0;j<3;j++){
        const result=closestOnEdges(a[i],a[(i+1)%3],b[j],b[(j+1)%3]);
        if(result)compare(...result);
      }
    }
    function visit(x,y){
      if(gap(x.box,y.box)>=best)return;
      if(x.items&&y.items){for(const a of x.items)for(const b of y.items)pair(a,b);return;}
      const children=!x.items?[[x.left,y],[x.right,y]]:[[x,y.left],[x,y.right]];
      children.sort((a,b)=>gap(a[0].box,a[1].box)-gap(b[0].box,b[1].box));
      for(const item of children)visit(...item);
    }
    visit(first,second);
    return {distance:best,points};
  }
  function interference(a,b){
    if(a.bounds.min.some((v,i)=>v>=b.bounds.max[i]-EPS||b.bounds.min[i]>=a.bounds.max[i]-EPS))return null;
    const mesh=global.LabSolid.boolean(a,b,'intersect');
    return mesh.stats.volumeMm3>EPS?mesh:null;
  }

  const api=Object.freeze({validateFeature,frame,circleSupports,fastenerSupports,surfaceReference,axisOf,
    placePoint,placeDirection,unplacePoint,unplaceDirection,solveMates,minimumClearance,interference});
  global.LabAssemblyGeometry=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
