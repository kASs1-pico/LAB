/* Offline parametric solids. Millimetres, right-handed XYZ; sketch Y is inverted.
 * Polygon BSP booleans and boundary stitching are implemented locally. No network dependencies.
 */
(function(global){
  'use strict';
  const EPS=1e-6, MM=4, TAU=Math.PI*2;
  const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s);
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const length=a=>Math.hypot(...a),unit=a=>{const n=length(a);if(n<EPS)throw new Error('Направление должно иметь ненулевую длину.');return mul(a,1/n);};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),num=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
  const key=p=>p.map(v=>Math.round(v*1e5)).join(','),point=p=>p.map(v=>Math.abs(v)<1e-9?0:v);
  const finite=p=>Array.isArray(p)&&p.length===3&&p.every(v=>Number.isFinite(v)&&Math.abs(v)<100000);
  const area=r=>r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+p.x*q.y-p.y*q.x;},0)/2;
  function inside(p,r){let inRing=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inRing=!inRing;}return inRing;}
  function cleanPoints(points){const out=[];for(const p of points)if(!out.length||length(sub(p,out.at(-1)))>EPS)out.push(p.slice());if(out.length>2&&length(sub(out[0],out.at(-1)))<EPS)out.pop();return out;}
  function builder(){
    const positions=[],normals=[],contourIds=[],surfaceTypes=[];
    function triangle(a,b,c,contour=-1,surface=2){a=point(a).map(Math.fround);b=point(b).map(Math.fround);c=point(c).map(Math.fround);const n=cross(sub(b,a),sub(c,a)),len=length(n);if(len<1e-9)return;positions.push(...a,...b,...c);for(let k=0;k<3;k++)normals.push(...mul(n,1/len));contourIds.push(contour);surfaceTypes.push(surface);}
    const quad=(a,b,c,d,id,surface)=>{triangle(a,b,c,id,surface);triangle(a,c,d,id,surface);};
    function finish(extra={}){
      const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};let signedVolume=0;const map=new Map(),parents=new Map();const root=k=>{if(!parents.has(k))parents.set(k,k);let p=k;while(parents.get(p)!==p)p=parents.get(p);while(parents.get(k)!==k){const q=parents.get(k);parents.set(k,p);k=q;}return p;};
      for(let i=0;i<positions.length;i+=9){const p=[0,3,6].map(n=>positions.slice(i+n,i+n+3)),normal=normals.slice(i,i+3);signedVolume+=dot(p[0],cross(p[1],p[2]))/6;for(const v of p)for(let a=0;a<3;a++){bounds.min[a]=Math.min(bounds.min[a],v[a]);bounds.max[a]=Math.max(bounds.max[a],v[a]);}
        for(let j=0;j<3;j++){const a=p[j],b=p[(j+1)%3],ka=key(a),kb=key(b),id=ka<kb?ka+'|'+kb:kb+'|'+ka;const ra=root(ka),rb=root(kb);if(ra!==rb)parents.set(ra,rb);const e=map.get(id);if(e){e.count++;e.direction+=ka<kb?1:-1;if(dot(e.normal,normal)<.94)e.sharp=true;}else map.set(id,{a,b,normal,sharp:false,count:1,direction:ka<kb?1:-1});}}
      const edges=[];let closed=true;for(const e of map.values()){if(e.sharp||e.count!==2)edges.push(...e.a,...e.b);if(e.count!==2||e.direction!==0)closed=false;}const components=new Set([...parents.keys()].map(root)).size,genus=closed?Math.max(0,Math.round((2*components-parents.size+map.size-positions.length/9)/2)):0;
      const ids=new Int32Array(contourIds);return {positions:new Float32Array(positions),normals:new Float32Array(normals),edges:new Float32Array(edges),contourIds:ids,faceContours:ids,surfaceTypes:new Uint8Array(surfaceTypes),bounds:positions.length?bounds:{min:[0,0,0],max:[0,0,0]},contours:[],warnings:[],...extra,stats:{...(extra.stats||{}),holes:extra.stats?.holes??genus,closed,components,triangles:positions.length/9,volumeMm3:Math.abs(signedVolume),signedVolumeMm3:signedVolume}};
    }
    return {triangle,quad,finish};
  }
  function cap(out,rings,z,up=true,ids){const flat=[],holes=[],points=[];rings.forEach((r,i)=>{if(i)holes.push(points.length);for(const p of r){flat.push(p.x,p.y);points.push([p.x,p.y,z]);}});const tris=global.earcut(flat,holes,2);if(!tris.length||global.earcut.deviation(flat,holes,2,tris)>1e-6)throw new Error('Не удалось заполнить поверхность. Упростите контур.');for(let i=0;i<tris.length;i+=3){let [a,b,c]=tris.slice(i,i+3).map(n=>points[n]);if((cross(sub(b,a),sub(c,a))[2]>0)!==up)[b,c]=[c,b];out.triangle(a,b,c,-1,up?1:0);}}
  function offsetRing(r,amount){return r.map((p,i)=>{const prev=r[(i+r.length-1)%r.length],next=r[(i+1)%r.length],u=unit([p.x-prev.x,p.y-prev.y,0]),v=unit([next.x-p.x,next.y-p.y,0]),a=[-u[1],u[0]],b=[-v[1],v[0]],d=1+a[0]*b[0]+a[1]*b[1];if(d<1e-5)throw new Error('Слишком острый угол.');const dx=amount*(a[0]+b[0])/d,dy=amount*(a[1]+b[1])/d;if(Math.hypot(dx,dy)>amount*8)throw new Error('Слишком острый угол.');return {x:p.x+dx,y:p.y+dy};});}
  const ringStroke=r=>({type:'path',points:[...r,r[0]].map(p=>({x:p.x*MM,y:-p.y*MM}))});
  function checkedInset(rings,amount){
    const inset=rings.map(r=>offsetRing(r,amount));
    for(let k=0;k<rings.length;k++)for(let i=0;i<rings[k].length;i++){const j=(i+1)%rings[k].length,a=rings[k][i],b=rings[k][j],p=inset[k][i],q=inset[k][j];if((b.x-a.x)*(q.x-p.x)+(b.y-a.y)*(q.y-p.y)<=EPS)throw new Error('Стенка пересекает короткое ребро.');if(rings.filter(r=>inside(p,r)).length%2!==1)throw new Error('Стенка выходит за контур.');}
    const analysis=global.LabExtrusion.analyze(inset.map(ringStroke),{tolerance:.05});if(!analysis.ok||analysis.stats.solids!==1||analysis.stats.holes!==rings.length-1)throw new Error('Толщина перекрывает отверстие или узкий участок.');return inset;
  }
  function roundedShell(analysis,height,options={}){
    const base=global.LabExtrusion.extrude(analysis,height),contours=base.contours,rings=contours.map(c=>c.points),ids=contours.map(c=>c.index),warnings=[];
    const requestedShell=clamp(num(options.shell),0,100),requestedRadius=clamp(num(options.fillet),0,100);
    let shell=Math.min(requestedShell,height*.9),inner=null,radius=Math.min(requestedRadius,height*(options.filletSide==='top'||options.filletSide==='bottom'?.9:.45));
    if(shell){for(let i=0;i<12;i++){try{inner=checkedInset(rings,shell);break;}catch{shell*=.5;}}if(!inner)throw new Error('Не удалось построить полость: уменьшите толщину или упростите контур.');if(shell<requestedShell-1e-5)warnings.push(`Толщина стенок уменьшена до ${Number(shell.toFixed(3))} мм на узких участках.`);radius=Math.min(radius,shell*.8);}
    let capInset=null;if(radius){for(let i=0;i<12;i++){try{capInset=checkedInset(rings,radius);break;}catch{radius*=.5;}}if(!capInset){radius=0;warnings.push('Скругление отключено: острый или узкий участок контура.');}else if(radius<requestedRadius-1e-5)warnings.push(`Радиус скругления уменьшен до ${Number(radius.toFixed(3))} мм.`);}
    const bottom=radius&&options.filletSide!=='top',top=radius&&options.filletSide!=='bottom',levels=[];
    if(bottom)for(let i=0;i<=10;i++){const t=Math.PI/2*(1-i/10);levels.push({z:radius-radius*Math.sin(t),inset:radius*(1-Math.cos(t)),round:true});}else levels.push({z:0,inset:0});
    if(top){if(height-radius>levels.at(-1).z+EPS)levels.push({z:height-radius,inset:0});for(let i=1;i<=10;i++){const t=Math.PI/2*i/10;levels.push({z:height-radius+radius*Math.sin(t),inset:radius*(1-Math.cos(t)),round:true});}}else levels.push({z:height,inset:0});
    const lr=levels.map(l=>rings.map(r=>l.inset>EPS?offsetRing(r,l.inset):r)),out=builder();
    for(let n=0;n<levels.length-1;n++)for(let r=0;r<rings.length;r++)for(let i=0;i<rings[r].length;i++){const j=(i+1)%rings[r].length,a=lr[n][r][i],b=lr[n][r][j],c=lr[n+1][r][j],d=lr[n+1][r][i];out.quad([a.x,a.y,levels[n].z],[b.x,b.y,levels[n].z],[c.x,c.y,levels[n+1].z],[d.x,d.y,levels[n+1].z],ids[r],levels[n].inset||levels[n+1].inset?3:2);}
    cap(out,lr[0],0,false);
    if(shell){cap(out,inner,shell,true);for(let r=0;r<rings.length;r++)for(let i=0;i<rings[r].length;i++){const j=(i+1)%rings[r].length,p=inner[r][i],q=inner[r][j],a=lr.at(-1)[r][i],b=lr.at(-1)[r][j];out.quad([q.x,q.y,shell],[p.x,p.y,shell],[p.x,p.y,height],[q.x,q.y,height],ids[r],2);out.quad([a.x,a.y,height],[b.x,b.y,height],[q.x,q.y,height],[p.x,p.y,height],ids[r],1);}}
    else cap(out,lr.at(-1),height,true);
    return out.finish({contours,warnings,stats:{...analysis.stats,heightMm:height,filletMm:radius,filletRequestedMm:requestedRadius,filletSide:options.filletSide||'both',shellMm:shell,shellRequestedMm:requestedShell}});
  }
  function translated(mesh,offset){if(!offset?.some(v=>Math.abs(v)>EPS))return mesh;const out=builder();for(let i=0;i<mesh.positions.length;i+=9){const t=[0,3,6].map(j=>add(Array.from(mesh.positions.slice(i+j,i+j+3)),offset));out.triangle(...t,mesh.contourIds?.[i/9]??-1,mesh.surfaceTypes?.[i/9]??2);}return out.finish({contours:(mesh.contours||[]).map(c=>({...c,points:c.points.map(p=>({x:p.x+offset[0],y:p.y+offset[1]}))})),warnings:mesh.warnings||[],stats:mesh.stats});}
  function revolve(analysis,axis){
    const base=global.LabExtrusion.extrude(analysis,1),rings=base.contours.map(c=>c.points),all=rings.flat(),minX=Math.min(...all.map(p=>p.x));let origin=axis?.point||[minX,0],direction=axis?.direction||[0,1];
    if(!Array.isArray(origin)||origin.length!==2||!origin.every(Number.isFinite)||!Array.isArray(direction)||direction.length!==2||!direction.every(Number.isFinite))throw new Error('Задайте ось вращения двумя точками.');
    let D=unit([direction[0],direction[1],0]),R=[D[1],-D[0],0];origin=[...origin,0];
    let radial=all.map(p=>dot(sub([p.x,p.y,0],origin),R));if(Math.max(...radial)<EPS){D=mul(D,-1);R=mul(R,-1);radial=radial.map(v=>-v);}if(Math.min(...radial)<-1e-4)throw new Error('Профиль пересекает ось вращения. Перенесите ось к краю или за пределы контура.');if(Math.max(...radial)<.05)throw new Error('Профиль слишком близок к оси вращения.');
    const degrees=axis?.angle??360;
    if(!Number.isFinite(degrees)||degrees<.5||degrees>360)throw new Error('Угол вращения должен быть от 0,5 до 360°.');
    const turn=degrees*TAU/360,full=degrees===360,segments=Math.max(2,Math.ceil(64*degrees/360));
    const out=builder(),p3=(p,t)=>{const d=sub([p.x,p.y,0],origin),r=Math.max(0,dot(d,R)),a=dot(d,D);return point(add(add(origin,mul(D,a)),add(mul(R,r*Math.cos(t)),[0,0,r*Math.sin(t)])));};
    rings.forEach((ring,id)=>{for(let n=0;n<segments;n++){const t=n/segments*turn,s=(full&&n+1===segments?0:(n+1)/segments*turn);for(let i=0;i<ring.length;i++){const j=(i+1)%ring.length;out.quad(p3(ring[i],t),p3(ring[j],t),p3(ring[j],s),p3(ring[i],s),base.contours[id].index,2);}}});
    if(!full){
      for(let i=0;i<base.positions.length;i+=9){
        if(base.surfaceTypes[i/9]!==1)continue;
        const points=[0,3,6].map(n=>({x:base.positions[i+n],y:base.positions[i+n+1]}));
        out.triangle(...points.slice().reverse().map(p=>p3(p,0)),-1,0);
        out.triangle(...points.map(p=>p3(p,turn)),-1,1);
      }
    }
    const mesh=out.finish({contours:base.contours,stats:{...analysis.stats,holes:undefined,mode:'revolve',segments,axis:{point:origin.slice(0,2),direction:D.slice(0,2),angle:degrees}}});
    if(!mesh.stats.closed||mesh.stats.signedVolumeMm3<=EPS)throw new Error('Тело вращения не замкнулось. Проверьте ось и исходный профиль.');
    return mesh;
  }
  function rotateVector(vector,from,to){const axis=cross(from,to),s=length(axis),c=clamp(dot(from,to),-1,1);if(s<EPS)return vector.slice();const n=mul(axis,1/s);return add(add(mul(vector,c),mul(cross(n,vector),s)),mul(n,dot(n,vector)*(1-c)));}
  function segmentDistance(a,b,c,d){const u=sub(b,a),v=sub(d,c),w=sub(a,c),A=dot(u,u),B=dot(u,v),C=dot(v,v),D=dot(u,w),E=dot(v,w),den=A*C-B*B;let s=den>EPS?clamp((B*E-C*D)/den,0,1):0;let t=C>EPS?clamp((B*s+E)/C,0,1):0;s=A>EPS?clamp((B*t-D)/A,0,1):0;return length(sub(add(a,mul(u,s)),add(c,mul(v,t))));}
  function sweep(analysis,inputPath){
    if(!Array.isArray(inputPath)||inputPath.length<2||inputPath.length>256||!inputPath.every(finite))throw new Error('Начертите путь из 2–256 точек для вытягивания.');
    if(length(sub(inputPath[0],inputPath.at(-1)))<EPS)throw new Error('Для вытягивания нужен открытый путь: разомкните его концы.');const path=cleanPoints(inputPath);if(path.length<2)throw new Error('Путь должен иметь длину.');
    const base=global.LabExtrusion.extrude(analysis,1),rings=base.contours.map(c=>c.points),all=rings.flat(),cx=(Math.min(...all.map(p=>p.x))+Math.max(...all.map(p=>p.x)))/2,cy=(Math.min(...all.map(p=>p.y))+Math.max(...all.map(p=>p.y)))/2;
    const radius=Math.max(...all.map(p=>Math.hypot(p.x-cx,p.y-cy))),segments=path.slice(1).map((p,i)=>unit(sub(p,path[i]))),tangents=path.map((p,i)=>i===0?segments[0]:i===path.length-1?segments.at(-1):unit(add(segments[i-1],segments[i])));
    for(let i=1;i<segments.length;i++){const c=dot(segments[i-1],segments[i]);if(c<-.8)throw new Error('Путь слишком резко разворачивается. Уменьшите угол поворота.');const needed=radius*Math.tan(Math.acos(clamp(c,-1,1))/2);if(Math.min(length(sub(path[i],path[i-1])),length(sub(path[i+1],path[i])))<needed*.95)throw new Error('Профиль слишком большой для короткого поворота пути. Уменьшите профиль или удлините путь.');}
    const cumulative=[0];for(let i=1;i<path.length;i++)cumulative.push(cumulative.at(-1)+length(sub(path[i],path[i-1])));
    for(let i=0;i<path.length-1;i++)for(let j=i+2;j<path.length-1;j++)if(cumulative[j]-cumulative[i+1]>radius*2&&segmentDistance(path[i],path[i+1],path[j],path[j+1])<radius*2)throw new Error('Путь приближается сам к себе: профиль может пересечься. Разведите ветви пути.');
    let U=unit(cross(Math.abs(tangents[0][2])<.9?[0,0,1]:[0,1,0],tangents[0]));const frames=[];for(let i=0;i<path.length;i++){if(i)U=unit(rotateVector(U,tangents[i-1],tangents[i]));frames.push({u:U.slice(),v:unit(cross(tangents[i],U))});}
    const pos=(p,n)=>add(path[n],add(mul(frames[n].u,p.x-cx),mul(frames[n].v,p.y-cy))),out=builder();
    rings.forEach((ring,id)=>{for(let n=0;n<path.length-1;n++)for(let i=0;i<ring.length;i++){const j=(i+1)%ring.length;out.quad(pos(ring[i],n),pos(ring[j],n),pos(ring[j],n+1),pos(ring[i],n+1),base.contours[id].index,2);}});
    const flat=[],holes=[],pts=[];rings.forEach((r,i)=>{if(i)holes.push(pts.length);for(const p of r){pts.push(p);flat.push(p.x,p.y);}});const indices=global.earcut(flat,holes,2);
    for(let i=0;i<indices.length;i+=3){const t=indices.slice(i,i+3).map(k=>pts[k]);if(area(t)<0)[t[1],t[2]]=[t[2],t[1]];out.triangle(pos(t[2],0),pos(t[1],0),pos(t[0],0),-1,0);out.triangle(pos(t[0],path.length-1),pos(t[1],path.length-1),pos(t[2],path.length-1),-1,1);}
    const mesh=out.finish({contours:base.contours,stats:{...analysis.stats,mode:'sweep',pathLengthMm:cumulative.at(-1)}});
    const problem='Поверхности вытягивания пересекаются или касаются. Разведите ветви пути или уменьшите профиль.';
    if(!mesh.stats.closed||mesh.stats.signedVolumeMm3<=EPS)throw new Error(problem);
    if(path.length>2){
      const queries=global.LabInspectGeometry ||
        (typeof module!=='undefined'&&module.exports ? require('../inspection/inspect-geometry.js') : null);
      if(!queries)throw new Error('Не удалось загрузить проверку геометрии вытягивания.');
      if(queries.hasSelfCrossing(queries.triangles(mesh),{includeCoplanar:true}))throw new Error(problem);
    }
    return mesh;
  }
  function extrudeFace(inputPoints,normal,depth){
    if(!Array.isArray(inputPoints)||inputPoints.length<3||inputPoints.length>256||!inputPoints.every(finite))throw new Error('Замкните контур на грани (3–256 вершин).');
    if(!Number.isFinite(depth)||Math.abs(depth)<.01||Math.abs(depth)>1000)throw new Error('Глубина должна быть от 0,01 до 1000 мм.');
    const N=unit(normal),points=cleanPoints(inputPoints),origin=points[0],U=unit(sub(points[1],origin)),V=unit(cross(N,U));
    if(Math.abs(dot(U,N))>.001||points.some(p=>Math.abs(dot(sub(p,origin),N))>.01))throw new Error('Все точки должны находиться в одной плоской грани.');
    let local=points.map(p=>({x:dot(sub(p,origin),U),y:dot(sub(p,origin),V)}));
    const check=global.LabExtrusion.analyze([ringStroke(local)],{tolerance:.05});if(!check.ok)throw new Error('Контур на грани пересекает себя или не задаёт площадь.');
    if(area(local)<0){points.reverse();local.reverse();}
    const travel=mul(N,depth),out=builder(),up=depth>0,indices=global.earcut(local.flatMap(p=>[p.x,p.y]),null,2);
    for(let i=0;i<indices.length;i+=3){const t=indices.slice(i,i+3).map(k=>points[k]);if(up){out.triangle(t[2],t[1],t[0],-1,0);out.triangle(...t.map(p=>add(p,travel)),-1,1);}else{out.triangle(...t,-1,1);out.triangle(...[t[2],t[1],t[0]].map(p=>add(p,travel)),-1,0);}}
    for(let i=0;i<points.length;i++){const p=points[i],q=points[(i+1)%points.length];if(up)out.quad(p,q,add(q,travel),add(p,travel),-1,2);else out.quad(q,p,add(p,travel),add(q,travel),-1,2);}
    return out.finish({stats:{mode:'face',heightMm:Math.abs(depth)}});
  }
  // Convex polygon BSP, with explicit signed halfspaces and immutable input meshes.
  class Polygon{
    constructor(vertices,meta={}){this.vertices=vertices;this.meta=meta;const n=cross(sub(vertices[1],vertices[0]),sub(vertices[2],vertices[0]));this.normal=mul(n,1/length(n));this.w=dot(this.normal,vertices[0]);}
    clone(){return new Polygon(this.vertices.map(p=>p.slice()),this.meta);}
    flip(){this.vertices.reverse();this.normal=mul(this.normal,-1);this.w=-this.w;}
  }
  function polygon(vertices,meta){const clean=cleanPoints(vertices);if(clean.length<3)return null;let normal=null;for(let i=1;i<clean.length-1;i++){const n=cross(sub(clean[i],clean[0]),sub(clean[i+1],clean[0]));if(length(n)>1e-9){normal=n;break;}}if(!normal)return null;while(length(cross(sub(clean[1],clean[0]),sub(clean[2],clean[0])))<1e-9)clean.push(clean.shift());return new Polygon(clean,meta);}
  function split(poly,plane,coplanarFront,coplanarBack,front,back){
    const types=poly.vertices.map(p=>{const d=dot(plane.normal,p)-plane.w;return d>EPS?1:d< -EPS?2:0;});const type=types.reduce((a,b)=>a|b,0);
    if(type===0)(dot(plane.normal,poly.normal)>0?coplanarFront:coplanarBack).push(poly);
    else if(type===1)front.push(poly);else if(type===2)back.push(poly);
    else{const f=[],b=[];for(let i=0;i<poly.vertices.length;i++){const j=(i+1)%poly.vertices.length,a=poly.vertices[i],z=poly.vertices[j],ta=types[i],tb=types[j];if(ta!==2)f.push(a);if(ta!==1)b.push(a);if((ta|tb)===3){const t=(plane.w-dot(plane.normal,a))/dot(plane.normal,sub(z,a)),p=add(a,mul(sub(z,a),t));f.push(p);b.push(p);}}const fp=polygon(f,poly.meta),bp=polygon(b,poly.meta);if(fp)front.push(fp);if(bp)back.push(bp);}
  }
  class BSP{
    constructor(polygons=[],depth=0){this.plane=null;this.polygons=[];this.front=null;this.back=null;if(polygons.length)this.build(polygons,depth);}
    invert(){for(const p of this.polygons)p.flip();if(this.plane){this.plane.normal=mul(this.plane.normal,-1);this.plane.w=-this.plane.w;}this.front?.invert();this.back?.invert();[this.front,this.back]=[this.back,this.front];}
    all(){return [...this.polygons,...(this.front?.all()||[]),...(this.back?.all()||[])];}
    clip(polys){if(!this.plane)return polys.slice();let front=[],back=[];for(const p of polys)split(p,this.plane,front,back,front,back);if(this.front)front=this.front.clip(front);if(this.back)back=this.back.clip(back);else back=[];return front.concat(back);}
    clipTo(other){this.polygons=other.clip(this.polygons);this.front?.clipTo(other);this.back?.clipTo(other);}
    build(polys,depth=0){if(!polys.length)return;if(depth>220)throw new Error('Слишком сложное пересечение тел. Упростите контуры.');if(!this.plane){let best=polys[0],score=Infinity;for(let i=0;i<Math.min(10,polys.length);i++){const p=polys[Math.floor(i*polys.length/Math.min(10,polys.length))];let f=0,b=0,sp=0;for(let j=0;j<polys.length;j+=Math.max(1,Math.floor(polys.length/100))){let type=0;for(const v of polys[j].vertices){const d=dot(p.normal,v)-p.w;type|=d>EPS?1:d< -EPS?2:0;}if(type===3)sp++;else if(type===1)f++;else if(type===2)b++;}const s=sp*5+Math.abs(f-b);if(s<score){score=s;best=p;}}this.plane={normal:best.normal.slice(),w:best.w};}
      const f=[],b=[];for(const p of polys)split(p,this.plane,this.polygons,this.polygons,f,b);if(f.length){if(!this.front)this.front=new BSP();this.front.build(f,depth+1);}if(b.length){if(!this.back)this.back=new BSP();this.back.build(b,depth+1);}}
  }
  function polygons(mesh){const out=[];for(let i=0;i<mesh.positions.length;i+=9){const p=polygon([0,3,6].map(j=>Array.from(mesh.positions.slice(i+j,i+j+3))),{contour:mesh.contourIds?.[i/9]??-1,surface:mesh.surfaceTypes?.[i/9]??2});if(p)out.push(p);}return out;}
  function stitchedMesh(polys,extra={}){
    if(polys.length>30000)throw new Error('После операции получилось слишком много поверхностей. Упростите тела.');
    const canonical=new Map();for(const p of polys)for(let i=0;i<p.vertices.length;i++){const k=key(p.vertices[i]);if(!canonical.has(k))canonical.set(k,p.vertices[i]);p.vertices[i]=canonical.get(k);}
    const vertices=[...canonical.values()];if(vertices.length>16000)throw new Error('Слишком подробная геометрия операции. Упростите контуры.');const out=builder();
    for(const p of polys){
      const boundary=[];
      for(let j=0;j<p.vertices.length;j++){const a=p.vertices[j],b=p.vertices[(j+1)%p.vertices.length],ab=sub(b,a),l2=dot(ab,ab);if(l2<EPS*EPS)continue;const candidates=[{p:a,t:0}];
        const min=a.map((v,i)=>Math.min(v,b[i])-EPS*3),max=a.map((v,i)=>Math.max(v,b[i])+EPS*3);
        for(const v of vertices){if(v===a||v===b||v.some((n,i)=>n<min[i]||n>max[i]))continue;const av=sub(v,a),t=dot(av,ab)/l2;if(t<=1e-6||t>=1-1e-6)continue;if(length(sub(av,mul(ab,t)))<EPS*3)candidates.push({p:v,t});}
        candidates.sort((a,b)=>a.t-b.t);for(const q of candidates)if(!boundary.length||key(q.p)!==key(boundary.at(-1)))boundary.push(q.p);
      }
      if(boundary.length<3)continue;if(boundary.length===3){out.triangle(...boundary,p.meta.contour,p.meta.surface);continue;}
      const center=mul(boundary.reduce((s,p)=>add(s,p),[0,0,0]),1/boundary.length);for(let j=0;j<boundary.length;j++)out.triangle(center,boundary[j],boundary[(j+1)%boundary.length],p.meta.contour,p.meta.surface);
    }
    return out.finish(extra);
  }
  // Local surface arrangement is used for highly tessellated curved solids.
  // Each face is split at all potentially intersecting face planes. Membership
  // on its two sides determines whether it belongs to the Boolean boundary.
  function arrangementBoolean(a,b,operation){
    const triangles=mesh=>polygons(mesh).map(poly=>({poly,min:[0,1,2].map(i=>Math.min(...poly.vertices.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...poly.vertices.map(p=>p[i])))}));
    const A=triangles(a),B=triangles(b),extent=Math.max(...a.bounds.max.map((v,i)=>v-a.bounds.min[i]),...b.bounds.max.map((v,i)=>v-b.bounds.min[i]),1),delta=Math.max(1e-5,extent*1e-6),direction=[.9238795325,.331413574,.191341716];
    const overlaps=(a,b)=>a.min.every((v,i)=>v<=b.max[i]+EPS&&a.max[i]>=b.min[i]-EPS);
    function contains(p,mesh,tris){
      if(p.some((v,i)=>v<mesh.bounds.min[i]-EPS||v>mesh.bounds.max[i]+EPS))return false;
      const hits=[];
      for(const {poly:t} of tris){
        const [a,b,c]=t.vertices,e1x=b[0]-a[0],e1y=b[1]-a[1],e1z=b[2]-a[2],e2x=c[0]-a[0],e2y=c[1]-a[1],e2z=c[2]-a[2],hx=direction[1]*e2z-direction[2]*e2y,hy=direction[2]*e2x-direction[0]*e2z,hz=direction[0]*e2y-direction[1]*e2x,det=e1x*hx+e1y*hy+e1z*hz;
        if(Math.abs(det)<1e-10)continue;const inv=1/det,sx=p[0]-a[0],sy=p[1]-a[1],sz=p[2]-a[2],u=(sx*hx+sy*hy+sz*hz)*inv;if(u< -1e-8||u>1+1e-8)continue;
        const qx=sy*e1z-sz*e1y,qy=sz*e1x-sx*e1z,qz=sx*e1y-sy*e1x,v=(direction[0]*qx+direction[1]*qy+direction[2]*qz)*inv;if(v< -1e-8||u+v>1+1e-8)continue;
        const distance=(e2x*qx+e2y*qy+e2z*qz)*inv;if(distance>EPS)hits.push(distance);
      }
      hits.sort((a,b)=>a-b);return hits.filter((v,i)=>i===0||v-hits[i-1]>EPS*8).length%2===1;
    }
    function onTriangle(p,poly){if(Math.abs(dot(poly.normal,p)-poly.w)>EPS*4)return false;const a=poly.vertices[0],u=sub(poly.vertices[1],a),v=sub(poly.vertices[2],a),w=sub(p,a),uu=dot(u,u),uv=dot(u,v),vv=dot(v,v),wu=dot(w,u),wv=dot(w,v),den=uu*vv-uv*uv;if(Math.abs(den)<1e-12)return false;const x=(vv*wu-uv*wv)/den,y=(uu*wv-uv*wu)/den;return x>=-1e-7&&y>=-1e-7&&x+y<=1+1e-7;}
    const evaluate=(insideA,insideB)=>operation==='union'?insideA||insideB:operation==='subtract'?insideA&&!insideB:insideA&&insideB;
    const result=[];
    for(const [source,other,otherMesh,isA]of [[A,B,b,true],[B,A,a,false]])for(const item of source){
      const candidates=other.filter(t=>overlaps(item,t)),planes=new Map();for(const t of candidates){const n=t.poly.normal,w=t.poly.w,k=[...n,w].map(v=>Math.round(v*1e6)).join(',');if(!planes.has(k))planes.set(k,{normal:n,w});}
      let pieces=[item.poly];for(const plane of planes.values()){
        const next=[];for(const piece of pieces){const f=[],back=[],coplanar=[];split(piece,plane,coplanar,coplanar,f,back);next.push(...coplanar,...f,...back);}pieces=next;if(pieces.length>1800)throw new Error('Слишком много пересечений в одной грани. Упростите тела.');
      }
      for(const piece of pieces){
        const center=mul(piece.vertices.reduce((sum,p)=>add(sum,p),[0,0,0]),1/piece.vertices.length),front=add(center,mul(piece.normal,delta)),back=add(center,mul(piece.normal,-delta));
        if(!isA&&candidates.some(t=>Math.abs(dot(t.poly.normal,piece.normal))>1-1e-6&&onTriangle(center,t.poly)))continue;
        const otherBack=contains(back,otherMesh,other),otherFront=contains(front,otherMesh,other),insideBack=isA?evaluate(true,otherBack):evaluate(otherBack,true),insideFront=isA?evaluate(false,otherFront):evaluate(otherFront,false);
        if(insideBack===insideFront)continue;if(!insideBack)piece.flip();result.push(piece);
      }
    }
    return stitchedMesh(result,{contours:[],warnings:[],stats:{operation}});
  }
  function boolean(a,b,operation){
    if(!['union','subtract','intersect'].includes(operation))throw new Error('Неизвестная операция над телами.');
    if(!a?.positions?.length||!b?.positions?.length)throw new Error('Для операции нужны два объёмных тела.');
    if(a.positions.length+b.positions.length>160000)throw new Error('Для операции упростите подробные тела: слишком много треугольников.');
    if(a.positions.length/9>900||b.positions.length/9>900){const curved=arrangementBoolean(a,b,operation);if(!curved.stats.closed)throw new Error('Пересечение дало неоднозначную границу. Немного сдвиньте тела или упростите контуры.');return curved;}const A=new BSP(polygons(a)),B=new BSP(polygons(b));
    if(operation==='union'){A.clipTo(B);B.clipTo(A);B.invert();B.clipTo(A);B.invert();A.build(B.all());}
    if(operation==='subtract'){A.invert();A.clipTo(B);B.clipTo(A);B.invert();B.clipTo(A);B.invert();A.build(B.all());A.invert();}
    if(operation==='intersect'){A.invert();B.clipTo(A);B.invert();A.clipTo(B);B.clipTo(A);A.build(B.all());A.invert();}
    const result=stitchedMesh(A.all(),{contours:[],warnings:[],stats:{operation}});if(!result.stats.closed)throw new Error('Пересечение дало неоднозначную границу. Немного сдвиньте тела или упростите их контуры.');return result;
  }
  function bodyKey(loop,strokes=[]){return 'body-'+String(strokes[loop?.sourceIndices?.[0]]?.id??loop?.sourceIndices?.[0]??'0');}
  function combine(bodies){
    const out=builder(),bodyIds=[],warnings=[],contours=[];
    bodies.forEach((body,index)=>{const mesh=body.mesh;warnings.push(...(mesh.warnings||[]));contours.push(...(mesh.contours||[]));for(let i=0;i<mesh.positions.length;i+=9){out.triangle(...[0,3,6].map(j=>Array.from(mesh.positions.slice(i+j,i+j+3))),mesh.contourIds?.[i/9]??-1,mesh.surfaceTypes?.[i/9]??2);bodyIds.push(index);}});
    return out.finish({bodyIds:new Int32Array(bodyIds),bodies,contours,warnings,stats:{solids:bodies.length,holes:bodies.reduce((sum,b)=>sum+(b.mesh.stats.holes||0),0),heightMm:bodies.length?Math.max(...bodies.map(b=>b.bounds.max[2]))-Math.min(...bodies.map(b=>b.bounds.min[2])):0}});
  }
  function transformMesh(mesh,transform,reverse=false){
    const out=builder();
    for(let i=0;i<mesh.positions.length;i+=9){
      const vertices=[0,3,6].map(j=>transform(Array.from(mesh.positions.subarray(i+j,i+j+3))));
      if(reverse)[vertices[1],vertices[2]]=[vertices[2],vertices[1]];
      out.triangle(...vertices,mesh.contourIds?.[i/9]??-1,mesh.surfaceTypes?.[i/9]??2);
    }
    return out.finish({warnings:mesh.warnings||[],stats:mesh.stats});
  }
  function reflected(mesh,axis,position){
    return transformMesh(mesh,p=>p.map((v,i)=>i===axis?2*position-v:v),true);
  }
  function reflectInPlane(mesh,{origin,normal}){
    return transformMesh(mesh,p=>sub(p,mul(normal,2*dot(sub(p,origin),normal))),true);
  }
  function clipToPlane(mesh,origin,normal){
    const z=unit(normal),x=unit(cross(Math.abs(z[2])>.8?[0,1,0]:[0,0,1],z)),y=cross(z,x);
    const local=transformMesh(mesh,p=>[x,y,z].map(axis=>dot(sub(p,origin),axis)));
    const low=local.bounds.min[2],high=local.bounds.max[2];
    if(high<EPS)return mesh;
    if(low>=-EPS)throw new Error('Размер обработки удаляет всю деталь.');
    const sliced=global.LabExtrusion.section(local,{axis:'z',position:-low/(high-low)});
    return transformMesh(sliced,p=>add(origin,add(add(mul(x,p[0]),mul(y,p[1])),mul(z,p[2]))));
  }
  function splitBody(mesh,axis,fraction,plane){
    let low,high;
    if(plane){
      low=clipToPlane(mesh,plane.origin,plane.normal);
      high=clipToPlane(mesh,plane.origin,mul(plane.normal,-1));
    }else{
      const name=['x','y','z'][axis],other=reflected(mesh,axis,0);
      low=global.LabExtrusion.section(mesh,{axis:name,position:fraction});
      high=reflected(global.LabExtrusion.section(other,{axis:name,position:1-fraction}),axis,0);
    }
    const results=[low,high].map(part=>transformMesh(part,p=>p));
    if(results.some(part=>!part.stats.closed||part.stats.signedVolumeMm3<=EPS))throw new Error('Сдвиньте плоскость, чтобы получить две замкнутые части.');
    const combined=results.reduce((sum,part)=>sum+part.stats.volumeMm3,0);
    if(Math.abs(combined-mesh.stats.volumeMm3)>Math.max(1e-4,mesh.stats.volumeMm3*1e-5))throw new Error('Сдвиньте плоскость: объёмы частей не согласованы.');
    return results;
  }
  const derivedBodyId=feature=>'body-derived-'+feature.id;
  function derivedBody(feature,source,mesh,settings,defaultName){
    const id=derivedBodyId(feature),s=settings[id]||{};
    const offset=finite(s.offset)?s.offset.slice():[0,0,0];
    mesh=translated(mesh,offset);
    return {id,name:s.name||defaultName,fixed:s.fixed===true,offset,mesh,bounds:mesh.bounds,
      height:mesh.bounds.max[2]-mesh.bounds.min[2],mode:'derived',sourceIndices:[],sourceLoop:-1,contours:[],assemblyCylinders:[],derivedFrom:source.id};
  }
  function build(analysis,options={}){
    if(!analysis?.ok)throw new Error('Сначала замкните контуры.');const strokes=options.strokes||[],settings=options.bodies||{},warnings=[],bodies=[];
    for(let index=0;index<analysis.solids.length;index++){
      const solid=analysis.solids[index],sourceLoops=[solid.outer,...solid.holes],sourceIndices=[...new Set(sourceLoops.flatMap(l=>l.sourceIndices))],id=bodyKey(solid.outer,strokes),s=settings[id]||{},height=clamp(num(s.height,num(options.height,20)),.1,1000),mode=['extrude','revolve','sweep'].includes(s.mode)?s.mode:'extrude';
      const loops=sourceLoops.map((loop,n)=>({...loop,points:loop.points.map(p=>({...p})),depth:n?1:0,parent:n?0:-1})),local={ok:true,loops,solids:[{outer:loops[0],holes:loops.slice(1)}],warnings:[],stats:{contours:loops.length,solids:1,holes:loops.length-1,points:loops.reduce((sum,l)=>sum+l.points.length,0),areaMm2:sourceLoops.reduce((sum,l,n)=>sum+(n?-1:1)*Math.abs(area(l.points)),0)/16}};
      let mesh;
      if(mode==='revolve')mesh=revolve(local,s.axis);
      else if(mode==='sweep')mesh=sweep(local,s.path);
      else if(num(s.fillet)>0||num(s.shell)>0)mesh=roundedShell(local,height,s);
      else mesh=global.LabExtrusion.extrude(local,height,{bevel:num(s.bevel,num(options.bevel))});
      const map=sourceLoops.map(loop=>analysis.loops.indexOf(loop));for(let n=0;n<mesh.contourIds.length;n++)if(mesh.contourIds[n]>=0)mesh.contourIds[n]=map[mesh.contourIds[n]]??-1;mesh.faceContours=mesh.contourIds;for(const c of mesh.contours||[])c.index=map[c.index]??c.index;
      if(mode!=='extrude'&&(num(s.fillet)>0||num(s.shell)>0))mesh.warnings.push('Скругление рёбер и толщина стенок применяются к прямому вытягиванию. Для полого тела вращения или трубы используйте профиль с отверстием.');const offset=finite(s.offset)?s.offset.slice():[0,0,0];mesh=translated(mesh,offset);
      bodies.push({id,name:String(s.name||`Тело ${index+1}`),fixed:s.fixed===true,mesh,bounds:mesh.bounds,height,mode,offset,sourceIndices,sourceLoop:analysis.loops.indexOf(solid.outer),contours:mesh.contours,fillet:mesh.stats.filletMm||0,shell:mesh.stats.shellMm||0});
    }
    const assembly=global.LabAssemblyGeometry;
    if(assembly){
      for(const body of bodies){
        const solid=analysis.solids.find(item=>item.outer===analysis.loops[body.sourceLoop]);
        body.assemblyCylinders=body.mode==='extrude'?assembly.circleSupports(solid,strokes,body.offset,body.height):[];
      }
    }
    const modifiedBodies = new Set(), mates=[], copies=[];
    const linked=new Set((options.features||[]).filter(f=>['mirror-body','instance-body'].includes(f.type)&&!f.suppressed).map(derivedBodyId));
    for(const feature of options.features||[]){
      if(feature.suppressed)continue;
      if(['mirror-body','instance-body'].includes(feature.type)){
        copies.push(global.LabForms.validateFeature(feature,'operation'));
        continue;
      }
      if(linked.has(feature.target)||linked.has(feature.tool))throw new Error('Для этой операции выберите исходную деталь связанной копии.');
      const target=bodies.find(b=>b.id===feature.target);if(!target){warnings.push('Операция скрытого или удалённого тела временно пропущена.');continue;}
      if(feature.type==='mate'){
        mates.push(global.LabForms.validateFeature(feature,'operation'));
        continue;
      }
      if(feature.type==='split-body'){
        const prepared=global.LabForms.validateFeature(feature,'operation');
        const [low,high]=splitBody(target.mesh,prepared.axis,prepared.fraction,prepared.plane);
        target.mesh=low;target.bounds=low.bounds;target.contours=low.contours;target.assemblyCylinders=[];
        bodies.push(derivedBody(prepared,target,high,settings,target.name+' (часть 2)'));
        modifiedBodies.add(target.id);
        continue;
      }
      if(feature.type==='catalog-body'){
        const prepared=global.LabForms.validateFeature(feature,'operation');
        const {mesh,name,cylinders}=global.LabForms.catalogBody(prepared);
        const part=derivedBody(prepared,target,mesh,settings,name);
        part.assemblyCylinders=cylinders.map(ref=>({...ref,origin:add(ref.origin,part.offset)}));
        bodies.push(part);
        continue;
      }
      if(feature.type==='import-body'){
        const prepared=global.LabForms.validateFeature(feature,'operation');
        const mesh=global.LabForms.importedBody(prepared);
        bodies.push(derivedBody(prepared,target,mesh,settings,prepared.title));
        continue;
      }
      if (global.LabForms?.types.includes(feature.type)) {
        const prepared = global.LabForms.validateFeature(feature, 'operation');
        if (prepared.type === 'loft' && modifiedBodies.has(target.id)) throw new Error('Постройте переход по сечениям перед другими операциями с деталью.');
        target.mesh = global.LabForms.apply(target, prepared);
        target.bounds = target.mesh.bounds;
        target.contours = target.mesh.contours;
        if (['loft','fold','helical-spring','space-sweep','dome','multi-shell'].includes(prepared.type)){
          target.mode=prepared.type;
          target.assemblyCylinders=[];
        }
        if(prepared.type==='fastener')target.assemblyCylinders=(target.assemblyCylinders||[]).concat(global.LabAssemblyGeometry.fastenerSupports(target,prepared));
      } else if(['add','cut'].includes(feature.type)){
        const normal=unit(feature.normal||[0,0,1]),depth=clamp(num(feature.depth,5),.01,1000),points=feature.points?.map(p=>add(p,target.offset));if(!points)throw new Error('У операции отсутствует контур на грани.');
        const overlap=Math.max(.002,depth*.00001),start=points.map(p=>add(p,mul(normal,feature.type==='cut'?overlap:-overlap))),cutter=extrudeFace(start,normal,feature.type==='cut'?-(depth+overlap):depth+overlap);
        const changed=boolean(target.mesh,cutter,feature.type==='cut'?'subtract':'union');
        if(!changed.positions.length)throw new Error('Вырез удаляет всё тело. Уменьшите глубину или размер контура.');
        if(options.heightChanges?.has(target.id)){
          const before=target.mesh.stats,after=changed.stats;
          const detached=feature.type==='add'&&after.components>(before.components??1);
          if(detached||Math.abs(after.volumeMm3-before.volumeMm3)<1e-5){
            throw new Error('При этой высоте операция на грани теряет контакт с деталью. Измените высоту или положение контура.');
          }
        }
        target.mesh=changed;target.bounds=target.mesh.bounds;target.contours=target.mesh.contours;
      }else if(['union','subtract','intersect'].includes(feature.type)){
        const tool=bodies.find(b=>b.id===feature.tool);if(!tool||tool===target){warnings.push('Второе тело операции скрыто или отсутствует.');continue;}
        if(mates.some(mate=>[mate.target,mate.tool].some(id=>id===target.id||id===tool.id)))throw new Error('Для логической операции сначала снимите стыковку этих деталей.');
        const result=boolean(target.mesh,tool.mesh,feature.type);if(!result.positions.length)throw new Error('Результат операции пуст. Переместите тела так, чтобы они пересекались.');
        target.mesh=result;target.bounds=result.bounds;target.contours=result.contours;target.sourceIndices=[...new Set([...target.sourceIndices,...tool.sourceIndices])];bodies.splice(bodies.indexOf(tool),1);
      }
      modifiedBodies.add(target.id);
    }
    if(mates.length)global.LabAssemblyGeometry.solveMates(bodies,mates,warnings);
    for(const feature of copies){
      const source=bodies.find(b=>b.id===feature.target);
      if(!source){warnings.push('Копия скрыта, пока исходная деталь недоступна.');continue;}
      const mirror=feature.type==='mirror-body';
      const mesh=mirror
        ?feature.plane?reflectInPlane(source.mesh,feature.plane):reflected(source.mesh,feature.axis,feature.position)
        :translated(source.mesh,feature.offset);
      bodies.push(derivedBody(feature,source,mesh,settings,source.name+(mirror?' (зеркало)':' (копия)')));
    }
    const combined=combine(bodies);combined.warnings.unshift(...(analysis.warnings||[]),...warnings);return combined;
  }
  const API=Object.freeze({createMeshBuilder:builder,bodyKey,build,combine,boolean,extrudeFace,revolve,sweep,roundedShell,translated,transformMesh,splitBody,clipToPlane,checkedInset,derivedBodyId});global.LabSolid=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})(typeof window==='undefined'?globalThis:window);
