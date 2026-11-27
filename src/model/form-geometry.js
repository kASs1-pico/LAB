// Document coordinates use millimetres. Operations describe source geometry before
// the body's translation; input solids and their saved sketches remain immutable.
(function (global) {
  'use strict';
  const Solid = global.LabSolid;
  const MeshQueries = global.LabInspectGeometry ||
    (typeof module!=='undefined' && module.exports ? require('../inspection/inspect-geometry.js') : null);
  const Assembly = () => global.LabAssemblyGeometry ||
    (typeof module!=='undefined' && module.exports ? require('./assembly-geometry.js') : null);
  const Lab = global.LabSolidLabGeometry ||
    (typeof module!=='undefined' && module.exports ? require('./solid-lab-geometry.js') : null);
  const types = Object.freeze(['loft', 'fold', 'pattern', 'text', 'workplane', 'fastener', 'mate',
    'split-body', 'mirror-body', 'instance-body', 'draft-angle', 'catalog-body', 'import-body', 'edge-bevel', 'edge-round',
    ...(Lab?.types||[])]);
  const EPS = 1e-6;
  const plus = (a, b) => a.map((v, i) => v + b[i]);
  const minus = (a, b) => a.map((v, i) => v - b[i]);
  const times = (v, n) => v.map(x => x * n);
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const norm = v => Math.hypot(...v);
  const distance = (a, b) => norm(minus(a, b));
  const mean = pts => times(pts.reduce(plus), 1 / pts.length);
  const xyArea = ring => ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return sum + p[0]*q[1] - p[1]*q[0];
  }, 0) / 2;
  function requireValue(valid, message) { if (!valid) throw new Error(message); }
  function unit(v) {
    const length = norm(v);
    requireValue(length > EPS, 'Направление должно иметь ненулевую длину.');
    return times(v, 1 / length);
  }
  function number(x, min, max, message) {
    requireValue(Number.isFinite(x) && x >= min && x <= max, message);
    return x;
  }
  function vector(v, n = 3) {
    requireValue(Array.isArray(v) && v.length === n && v.every(x => Number.isFinite(x) && Math.abs(x) <= 10000), 'Неверные координаты построения.');
    return v.slice();
  }
  function polygonPoints(points, dimensions) {
    requireValue(Array.isArray(points) && points.length >= 3 && points.length <= 256, 'Для профиля требуется от 3 до 256 вершин.');
    const ring = points.map(p => vector(p, dimensions));
    if (distance(ring[0], ring.at(-1)) < EPS) ring.pop();
    requireValue(ring.length >= 3 && ring.every((p,i) => distance(p, ring[(i+1) % ring.length]) > EPS), 'Уберите совпадающие вершины профиля.');
    return ring;
  }
  function validId(id, max) {
    return typeof id === 'string' && id.length <= max && /^[a-zA-Z0-9_-]+$/.test(id);
  }
  function validateFeature(input, fallbackId) {
    requireValue(input && types.includes(input.type) && validId(input.target,96) && input.target.startsWith('body-'), 'Выберите деталь для операции.');
    const feature = { id:input.id || fallbackId, target:input.target, type:input.type };
    requireValue(validId(feature.id,64), 'Неверный идентификатор операции.');
    if(Lab?.types.includes(input.type))return Lab.validate(input,feature);
    if (['workplane','fastener','mate'].includes(input.type)) {
      return Assembly().validateFeature(input,feature);
    }
    if (['split-body','mirror-body'].includes(input.type)) {
      if(input.plane){
        feature.plane={origin:vector(input.plane.origin),normal:unit(vector(input.plane.normal))};
        return feature;
      }
      feature.axis=number(input.axis,0,2,'Выберите ось X, Y или Z.');
      requireValue(Number.isInteger(feature.axis),'Выберите ось X, Y или Z.');
      if(input.type==='split-body')feature.fraction=number(input.fraction,.01,.99,'Положение разреза должно быть в пределах от 1 до 99%.');
      else feature.position=number(input.position,-10000,10000,'Координата плоскости выходит за рабочий диапазон.');
      return feature;
    }
    if(input.type==='instance-body'){
      feature.offset=vector(input.offset);
      requireValue(norm(feature.offset)>.01,'Сместите копию относительно исходной детали.');
      return feature;
    }
    if(input.type==='draft-angle'){
      feature.angle=number(input.angle,.1,30,'Задайте угол уклона от 0,1 до 30°.');
      return feature;
    }
    if(input.type==='catalog-body'){
      requireValue(['washer','nut','spacer','pin','screw'].includes(input.part),'Выберите тип детали.');
      const diameter=number(input.diameter,.5,100,'Задайте диаметр от 0,5 до 100 мм.');
      const outer=number(input.outer,.6,200,'Задайте наружный диаметр или размер головки от 0,6 до 200 мм.');
      const height=number(input.height,.25,200,'Задайте высоту от 0,25 до 200 мм.');
      requireValue(outer>diameter+.05||input.part==='pin','Наружный диаметр должен превышать внутренний.');
      return {...feature,part:input.part,diameter,outer,height,origin:vector(input.origin)};
    }
    if(input.type==='import-body'){
      const vertices=input.vertices;
      requireValue(Array.isArray(vertices)&&vertices.length>=36&&vertices.length<=18000&&vertices.length%9===0
        &&vertices.every(n=>Number.isFinite(n)&&Math.abs(n)<=10000),'Для импортируемой детали нужно от 4 до 2000 треугольников с допустимыми координатами.');
      const title=typeof input.title==='string'?input.title.trim().slice(0,48):'';
      return {...feature,title:title||'Деталь из проекта',vertices:vertices.slice(),offset:vector(input.offset)};
    }
    if(['edge-bevel','edge-round'].includes(input.type)){
      requireValue(Array.isArray(input.edge)&&input.edge.length===2,'Выберите ребро.');
      const edge=input.edge.map(p=>vector(p));
      requireValue(distance(...edge)>.05,'Ребро слишком короткое.');
      return {...feature,edge,radius:number(input.radius,.05,20,'Задайте размер от 0,05 до 20 мм.')};
    }
    if (input.type === 'loft') {
      requireValue(Array.isArray(input.sections) && input.sections.length >= 1 && input.sections.length <= 7, 'Добавьте от одного до семи сечений над исходным профилем.');
      let previousZ = 0;
      feature.sections = input.sections.map(section => {
        const z = number(section.z, .1, 500, 'Задайте высоту сечения от 0,1 до 500 мм.');
        requireValue(z > previousZ + .001, 'Каждое сечение должно быть выше предыдущего.');
        const result={z,points:polygonPoints(section.points,2)};
        if(section.angle!==undefined)result.angle=number(section.angle,-180,180,'Поворот сечения должен быть в пределах ±180°.');
        previousZ=z;
        return result;
      });
    } else if (input.type === 'fold') {
      requireValue(Array.isArray(input.line) && input.line.length === 2, 'Отметьте две точки линии сгиба.');
      feature.line = input.line.map(p => vector(p, 2));
      requireValue(distance(...feature.line) > .1, 'Линия сгиба слишком короткая.');
      feature.angle = number(input.angle, -150, 150, 'Угол сгиба должен быть в пределах ±150°.');
    } else if (input.type === 'pattern') {
      const s = input.source;
      requireValue(s && ['add','cut'].includes(s.type), 'Выберите отверстие или выступ для повтора.');
      feature.source = { type:s.type, points:polygonPoints(s.points,3), normal:unit(vector(s.normal)), depth:number(s.depth,.01,1000,'Глубина элемента должна быть от 0,01 до 1000 мм.') };
      const plane=frame(feature.source.points[0],feature.source.normal);
      const projected=feature.source.points.map(plane.project);
      requireValue(projected.every(p=>Math.abs(p[2])<.001), 'Все вершины элемента массива должны лежать на одной грани.');
      checkRing(projected.map(p=>p.slice(0,2)));
      requireValue(['linear','circular'].includes(input.layout), 'Выберите прямой или круговой массив.');
      requireValue(Number.isInteger(input.count) && input.count >= 2 && input.count <= 24, 'Массив содержит от 2 до 24 элементов.');
      Object.assign(feature,{layout:input.layout,count:input.count,skipFirst:input.skipFirst !== false});
      if (input.layout === 'linear') {
        feature.step = vector(input.step);
        requireValue(norm(feature.step) >= .05, 'Расстояние между элементами слишком мало.');
      } else {
        feature.center = vector(input.center);
        feature.sweep = number(input.sweep ?? 360,-360,360,'Угол массива должен быть в пределах ±360°.');
        requireValue(Math.abs(feature.sweep) >= .1, 'Угол массива слишком мал.');
      }
    } else {
      requireValue(typeof input.text === 'string' && input.text.length <= 32 && input.text.trim().length, 'Введите надпись длиной до 32 знаков.');
      requireValue([...input.text].every(c => Object.hasOwn(global.LabEngravingGlyphs || {},c)), 'Для надписи доступны русские и латинские буквы, цифры и основные знаки.');
      requireValue(['add','cut'].includes(input.operation),'Выберите рельеф или гравировку.');
      const normal = unit(vector(input.normal)), baseline = vector(input.u);
      const u = unit(minus(baseline,times(normal,dot(baseline,normal))));
      return {...feature, text:input.text, size:number(input.size,.5,100,'Высота букв должна быть от 0,5 до 100 мм.'), depth:number(input.depth,.05,200,'Глубина надписи должна быть от 0,05 до 200 мм.'), operation:input.operation, origin:vector(input.origin), normal, u};
    }
    return feature;
  }

  function pointInside(p, ring) {
    let inside = false;
    for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
      const a=ring[i],b=ring[j];
      if ((a[1]>p[1]) !== (b[1]>p[1]) && p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
    }
    return inside;
  }
  function orient(a,b,c) { return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]); }
  function onSegment(p,a,b) {
    return Math.abs(orient(a,b,p)) < EPS && dot(minus(p,a),minus(p,b)) <= EPS;
  }
  function crosses(a,b,c,d) {
    return onSegment(a,c,d)||onSegment(b,c,d)||onSegment(c,a,b)||onSegment(d,a,b)||
      (orient(a,b,c)*orient(a,b,d)<0 && orient(c,d,a)*orient(c,d,b)<0);
  }
  function checkRing(ring) {
    requireValue(Math.abs(xyArea(ring)) > 1e-5, 'Сечение должно ограничивать площадь.');
    for (let i=0;i<ring.length;i++) for(let j=i+2;j<ring.length;j++){
      if(i===0 && j===ring.length-1) continue;
      requireValue(!crosses(ring[i],ring[(i+1)%ring.length],ring[j],ring[(j+1)%ring.length]), 'Линии сечения пересекаются.');
    }
  }
  function triangulate(outer, holes, emit) {
    const rings=[outer,...holes],indices=[],points=[];
    for(const ring of rings){
      const simple=ring.slice();
      let changed=true;
      while(changed && simple.length>3){
        changed=false;
        for(let i=0;i<simple.length;i++){
          const a=simple[(i+simple.length-1)%simple.length],b=simple[i],c=simple[(i+1)%simple.length];
          if(Math.abs(orient(a,b,c)) < EPS*distance(a,c) && dot(minus(b,a),minus(b,c))<0){simple.splice(i,1);changed=true;break;}
        }
      }
      if(points.length) indices.push(points.length);
      points.push(...simple);
    }
    const flat=points.flatMap(p=>p.slice(0,2));
    const triangles=global.earcut(flat,indices,2);
    requireValue(triangles.length && global.earcut.deviation(flat,indices,2,triangles)<1e-5,'Не удалось замкнуть границу поверхности.');
    const between=global.LabExtrusion.boundaryChains(rings,new Set(triangles.map(i=>points[i])));
    for(let i=0;i<triangles.length;i+=3){
      let [a,b,c]=triangles.slice(i,i+3).map(n=>points[n]);
      if(orient(a,b,c)<0) [b,c]=[c,b];
      // Preserve collinear ring vertices omitted by triangulators. These are
      // shared with the side wall and must exist on both sides of each seam.
      const bounds=[];
      for(const [p,q] of [[a,b],[b,c],[c,a]]){
        bounds.push(p,...between(p,q));
      }
      if(bounds.length===3) emit(a,b,c);
      else{const mid=mean([a.slice(0,2),b.slice(0,2),c.slice(0,2)]);for(let j=0;j<bounds.length;j++)emit(mid,bounds[j],bounds[(j+1)%bounds.length]);}
    }
  }
  function preparedSection(section) {
    const ring = section.points.map(p=>p.slice());
    checkRing(ring);
    if (xyArea(ring)<0)ring.reverse();
    // Start at the same bearing, including the middle of a rectangle's
    // right edge. Aligning to a corner would twist a circle-to-square duct.
    const [cx,cy]=areaCenter(ring);
    let first=0,hit=null;
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length];
      if(a[0]>ring[first][0])first=i;
      if((a[1]>cy)===(b[1]>cy))continue;
      const x=a[0]+(cy-a[1])*(b[0]-a[0])/(b[1]-a[1]);
      if(x>=cx && (!hit || x>hit.point[0]))hit={i,point:[x,cy]};
    }
    if(hit){
      const next=(hit.i+1)%ring.length;
      if(distance(hit.point,ring[hit.i])<=EPS)first=hit.i;
      else if(distance(hit.point,ring[next])<=EPS)first=next;
      else{first=hit.i+1;ring.splice(first,0,hit.point);}
    }
    const angle=(section.angle||0)*Math.PI/180;
    const points=[...ring.slice(first),...ring.slice(0,first)].map(p=>{
      const x=p[0]-cx,y=p[1]-cy;
      return angle?[cx+x*Math.cos(angle)-y*Math.sin(angle),cy+x*Math.sin(angle)+y*Math.cos(angle)]:p;
    }),lengths=[0];
    for(let i=0;i<points.length;i++)lengths.push(lengths.at(-1)+distance(points[i],points[(i+1)%points.length]));
    return {z:section.z,points,knots:lengths.map(s=>s/lengths.at(-1))};
  }
  function areaCenter(points) {
    // Integrate relative to a vertex to retain precision on translated parts.
    const anchor=points[0], total=[0,0];let area=0;
    for(let i=1;i+1<points.length;i++){
      const a=minus(points[i],anchor),b=minus(points[i+1],anchor),w=a[0]*b[1]-a[1]*b[0];
      area+=w;total[0]+=w*(a[0]+b[0]);total[1]+=w*(a[1]+b[1]);
    }
    return plus(anchor,times(total,1/(3*area)));
  }
  function pointEdgeDistance(p,a,b) {
    const edge=minus(b,a),length2=dot(edge,edge);
    const t=Math.max(0,Math.min(1,dot(minus(p,a),edge)/length2));
    return distance(p,plus(a,times(edge,t)));
  }
  function scaledSection(points,center,scale) {
    return points.map(p=>plus(center,times(minus(p,center),scale)));
  }
  function regularRadius(ring,center,tolerance) {
    if(ring.length<8)return 0;
    const radii=ring.map(p=>distance(p,center)),radius=radii.reduce((a,b)=>a+b,0)/radii.length;
    // Circular sketch tools tessellate larger and smaller radii differently.
    // Require the vertices to trace a circle with no large missing arc.
    return radii.every(r=>Math.abs(r-radius)<=tolerance) &&
      ring.every((p,i)=>distance(p,ring[(i+1)%ring.length])<=radius*.8) ? radius:0;
  }
  function holeScale(outer,inner) {
    checkRing(inner);
    const center=areaCenter(outer),innerCenter=areaCenter(inner);
    const extent=Math.max(...outer.map(p=>distance(p,center))),tolerance=Math.max(.0001,extent*1e-6);
    const message='Для сквозного перехода нужен один соосный внутренний контур той же формы, что и внешний.';
    requireValue(distance(center,innerCenter)<=tolerance,message);
    const outerRadius=regularRadius(outer,center,tolerance),innerRadius=regularRadius(inner,innerCenter,tolerance);
    let scale;
    if(outerRadius && innerRadius)scale=innerRadius/outerRadius;
    else{
      scale=Math.sqrt(Math.abs(xyArea(inner)/xyArea(outer)));
      const expected=scaledSection(outer,center,scale);
      const follows=(a,b)=>a.every(p=>b.some((q,i)=>pointEdgeDistance(p,q,b[(i+1)%b.length])<=tolerance));
      requireValue(follows(expected,inner)&&follows(inner,expected),message);
    }
    requireValue(scale>0 && scale<1,message);
    return scale;
  }
  function resampleLayer(layer,knots) {
    let i=0;
    return knots.map(k=>{
      while(i+1<layer.points.length && layer.knots[i+1]<=k+1e-9)i++;
      const t=(k-layer.knots[i])/(layer.knots[i+1]-layer.knots[i]);
      return plus(layer.points[i],times(minus(layer.points[(i+1)%layer.points.length],layer.points[i]),t));
    });
  }
  function loft(sections,{baseHole=null,contourIds=[0,1]}={}) {
    requireValue(sections.length>=2,'Для перехода нужны два сечения.');
    const layers=sections.map(preparedSection);
    const scale=baseHole?holeScale(layers[0].points,baseHole):0;
    const innerLayers=scale?layers.map((layer,i)=>i===0?preparedSection({z:layer.z,points:baseHole}):
      {...layer,points:scaledSection(layer.points,areaCenter(layer.points),scale)}):[];
    const allLayers=[...layers,...innerLayers];
    const knots=allLayers.flatMap(s=>s.knots.slice(0,-1)).sort((a,b)=>a-b).filter((k,i,list)=>!i||k-list[i-1]>1e-7);
    requireValue(knots.length*allLayers.length<18000,'Упростите контуры сечений.');
    const rings=layers.map(layer=>resampleLayer(layer,knots)),inner=innerLayers.map(layer=>resampleLayer(layer,knots));
    const out=Solid.createMeshBuilder();
    const checkClearance=(outer,hole)=>requireValue(
      pointInside(hole[0],outer) && footprintsDisjoint([outer],[hole]),
      'Стенки перехода пересекаются. Измените форму или смещение сечений.'
    );
    for(let i=0;i<inner.length;i++)checkClearance(rings[i],inner[i]);
    for (let i=0;i<rings.length-1;i++) {
      const low=layers[i].z,high=layers[i+1].z;
      requireValue(high>low,'Сечения должны последовательно подниматься.');
      for(const t of [.25,.5,.75]){
        const interpolate=rows=>rows[i].map((p,j)=>plus(p,times(minus(rows[i+1][j],p),t)));
        const outer=interpolate(rings);
        checkRing(outer);
        if(scale)checkClearance(outer,interpolate(inner));
      }
      const surfaces=scale?[rings,inner]:[rings];
      let turn=0;
      for(let j=0;j<knots.length;j++){
        const k=(j+1)%knots.length,e=minus(rings[i][k],rings[i][j]),f=minus(rings[i+1][k],rings[i+1][j]);
        turn=Math.max(turn,Math.atan2(Math.abs(e[0]*f[1]-e[1]*f[0]),dot(e,f)));
      }
      // A single diagonal across a twisted ruled quad would look like a long
      // sharp crease. Subdivide only where the directions of the edges change.
      const bands=Math.max(1,Math.min(8,Math.floor(16000/(knots.length*allLayers.length)),Math.ceil(turn/(Math.PI/18))));
      for(const [surface,rows] of surfaces.entries()){
        let previous=rows[i].map(p=>[...p,low]);
        for(let band=1;band<=bands;band++){
          const t=band/bands,z=low+t*(high-low);
          const next=rows[i].map((p,j)=>band===bands?[...rows[i+1][j],high]:[...plus(p,times(minus(rows[i+1][j],p),t)),z]);
          for(let j=0;j<knots.length;j++){
            const k=(j+1)%knots.length,a=previous[j],b=previous[k],c=next[k],d=next[j];
            if(surface===0)out.quad(a,b,c,d,contourIds[0],2);
            else out.quad(a,d,c,b,contourIds[1],2);
          }
          previous=next;
        }
      }
    }
    for(const [i,up] of [[0,false],[rings.length-1,true]])triangulate(rings[i],scale?[inner[i]]:[],(a,b,c)=>{
      if(!up)[b,c]=[c,b];out.triangle([...a,layers[i].z],[...b,layers[i].z],[...c,layers[i].z],-1,up?1:0);
    });
    const result=closed(out.finish({stats:{mode:'loft',sectionCount:layers.length,innerScale:scale}}));
    // Both caps bound the height interval, so only the transition walls can
    // cross at an intermediate height.
    const walls=MeshQueries.triangles(result).filter(face=>result.surfaceTypes[face.index]===2);
    requireValue(!MeshQueries.hasSelfCrossing(walls),'Стенки перехода пересекаются. Измените форму или смещение сечений.');
    return result;
  }
  function closed(mesh) {
    requireValue(mesh.stats.closed && mesh.stats.signedVolumeMm3>EPS,'Операция не замкнула объём. Измените контур или положение операции.');
    return mesh;
  }
  function fold(mesh,line,degrees,thickness,baseZ=0) {
    if(Math.abs(degrees)<.001)return mesh;
    const origin=line[0],axis=unit(minus(line[1],line[0])),across=[-axis[1],axis[0]];
    const q=p=>dot(minus(p.slice(0,2),origin),across);
    const angle=degrees*Math.PI/180,sign=Math.sign(angle),radius=thickness*1.5;
    const arc=radius*Math.abs(angle),start=-arc/2,end=arc/2,middleZ=baseZ+thickness/2;
    const steps=Math.max(2,Math.ceil(Math.abs(degrees)/7.5));
    // Split every crossed face at the same neutral-surface stations. Mapping
    // each thickness fibre to a concentric arc preserves joined faces.
    const cuts=Array.from({length:steps+1},(_,i)=>start+arc*i/steps);
    function deform(p){
      const s=q(p);if(s<=start+1e-8)return p;
      const t=Math.min((s-start)/radius,Math.abs(angle)),extra=Math.max(0,s-end);
      const h=p[2]-middleZ,x=start+radius*Math.sin(t)+extra*Math.cos(t)-sign*h*Math.sin(t);
      const z=middleZ+sign*(radius*(1-Math.cos(t))+extra*Math.sin(t))+h*Math.cos(t);
      return [p[0]+(x-s)*across[0],p[1]+(x-s)*across[1],z];
    }
    const out=Solid.createMeshBuilder();
    const zTolerance=Math.max(1,Math.abs(baseZ),thickness)*EPS;
    function emit(poly,id,surface) {
      if(poly.length<3)return;
      const outsideSheet=poly.some(p=>p[2]<baseZ-zTolerance || p[2]>baseZ+thickness+zTolerance);
      if(outsideSheet){
        const acrossCoordinates=poly.map(q);
        const inBend=Math.min(...acrossCoordinates)<end-EPS && Math.max(...acrossCoordinates)>start+EPS;
        requireValue(!inBend,'Зона сгиба пересекает уже согнутую или выступающую часть. Перенесите линию на плоский участок.');
      }
      for(let j=1;j<poly.length-1;j++)out.triangle(deform(poly[0]),deform(poly[j]),deform(poly[j+1]),id,surface);
    }
    let min=Infinity,max=-Infinity;
    for(let i=0;i<mesh.positions.length;i+=9){
      let remaining=[0,3,6].map(k=>Array.from(mesh.positions.slice(i+k,i+k+3)));
      const id=mesh.contourIds[i/9],surface=mesh.surfaceTypes[i/9];
      const ds=remaining.map(q);min=Math.min(min,...ds);max=Math.max(max,...ds);
      for(const cut of cuts){
        if(!remaining.length)break;
        const distances=remaining.map(p=>q(p)-cut);
        if(distances.every(d=>d>=-1e-9))continue;
        if(distances.every(d=>d<=1e-9)){emit(remaining,id,surface);remaining=[];break;}
        const low=[],high=[];
        for(let j=0;j<remaining.length;j++){
          const a=remaining[j],b=remaining[(j+1)%remaining.length],da=distances[j],db=distances[(j+1)%remaining.length];
          if(da<=1e-9)low.push(a);if(da>=-1e-9)high.push(a);
          if(da*db<0 && Math.abs(da)>1e-9 && Math.abs(db)>1e-9){const p=plus(a,times(minus(b,a),da/(da-db)));low.push(p);high.push(p);}
        }
        emit(low,id,surface);remaining=high;
      }
      emit(remaining,id,surface);
    }
    requireValue(min<start && max>end,'С обеих сторон линии должно хватать листа для радиуса сгиба. Уменьшите толщину или угол.');
    const result=closed(out.finish({stats:{mode:'fold',angle:degrees,neutralRadiusMm:radius}}));
    const previouslyRaised=mesh.bounds.min[2]<baseZ-zTolerance || mesh.bounds.max[2]>baseZ+thickness+zTolerance;
    requireValue(!previouslyRaised||!MeshQueries.hasSelfCrossing(MeshQueries.triangles(result)),'После сгиба части детали пересекаются. Уменьшите угол или перенесите линию.');
    return result;
  }
  function planarGroups(rings) {
    const records=rings.map(points=>({points,parents:[],area:Math.abs(xyArea(points))}));
    for(const record of records)record.parents=records.filter(r=>r.area>record.area && pointInside(record.points[0],r.points)).sort((a,b)=>a.area-b.area);
    return records.filter(r=>r.parents.length%2===0).map(outer=>{
      const holes=records.filter(r=>r.parents[0]===outer);
      return {outer:outer.points,holes:holes.map(h=>h.points)};
    });
  }
  function frame(origin,normal,baseline) {
    const n=unit(normal);
    const direction=baseline || cross(Math.abs(n[2])>.9?[0,1,0]:[0,0,1],n);
    const u=unit(minus(direction,times(n,dot(n,direction)))),v=unit(cross(n,u));
    return {
      project:p=>{const d=minus(p,origin);return [dot(d,u),dot(d,v),dot(d,n)];},
      world:(p,z)=>plus(origin,plus(times(u,p[0]),plus(times(v,p[1]),times(n,z)))),
      normal:n
    };
  }
  function sideWalls(out,rings,plane,from,to) {
    for(const {outer,holes} of planarGroups(rings)){
      for(const [index,points] of [outer,...holes].entries()){
        const ring=(xyArea(points)>0)===(index===0)?points:points.slice().reverse();
        for(let i=0;i<ring.length;i++){
          const a=ring[i],b=ring[(i+1)%ring.length];
          // Winding follows outward XY boundary and the signed height change.
          out.quad(plane.world(a,from),plane.world(b,from),plane.world(b,to),plane.world(a,to),-1,2);
        }
      }
    }
  }
  function fill(out,rings,plane,height,up) {
    for(const {outer,holes} of planarGroups(rings))triangulate(outer,holes,(a,b,c)=>{
      if(!up)[b,c]=[c,b];out.triangle(plane.world(a,height),plane.world(b,height),plane.world(c,height),-1,up?1:0);
    });
  }
  function textLayout(text,size) {
    let advance=0;const rings=[],scale=size/100;
    for(const c of text){
      const glyph=global.LabEngravingGlyphs?.[c];
      requireValue(glyph,'Символ недоступен для гравировки.');
      rings.push(...glyph[1].map(r=>r.map(([x,y])=>[x*scale+advance,y*scale])));
      advance+=glyph[0]*scale;
    }
    const points=rings.flat();
    const min=[0,1].map(i=>points.length?Math.min(...points.map(p=>p[i])):0);
    const max=[0,1].map(i=>points.length?Math.max(...points.map(p=>p[i])):0);
    return {rings,width:advance,height:size,inkBounds:{min,max}};
  }
  const pkey=p=>p.map(v=>Math.round(v*100000)).join(',');
  // Coplanar triangles can contain many CAD features. Removing their interior
  // edges recovers the true face outline, including existing holes.
  function planarFace(mesh,plane,z,outward) {
    const boundary=new Map(),triangles=new Set(),coords=new Map();
    for(let t=0;t<mesh.positions.length;t+=9){
      const normal=Array.from(mesh.normals.slice(t,t+3));
      if(dot(normal,plane.normal)*outward<.99999)continue;
      const pts=[0,3,6].map(i=>plane.project(Array.from(mesh.positions.slice(t+i,t+i+3))));
      if(pts.some(p=>Math.abs(p[2]-z)>.00005))continue;
      triangles.add(t);if(outward<0)pts.reverse();
      for(let i=0;i<3;i++){
        const a=pts[i].slice(0,2),b=pts[(i+1)%3].slice(0,2),ka=pkey(a),kb=pkey(b);
        coords.set(ka,a);coords.set(kb,b);
        if(boundary.has(kb+'|'+ka))boundary.delete(kb+'|'+ka);
        else boundary.set(ka+'|'+kb,[ka,kb]);
      }
    }
    const next=new Map();
    for(const [a,b] of boundary.values()){if(next.has(a))return null;next.set(a,b);}
    const rings=[];
    while(next.size){
      const first=next.keys().next().value,ring=[];let at=first;
      do{if(!next.has(at))return null;ring.push(coords.get(at));const following=next.get(at);next.delete(at);at=following;}while(at!==first);
      if(ring.length<3)return null;rings.push(ring);
    }
    return {rings,triangles};
  }
  function footprintsDisjoint(a,b) {
    // Crossing or touching loops need the full solid Boolean.
    for(const p of a)for(const q of b)for(let i=0;i<p.length;i++)for(let j=0;j<q.length;j++)
      if(crosses(p[i],p[(i+1)%p.length],q[j],q[(j+1)%q.length]))return false;
    return true;
  }
  function withinFace(rings,face) {
    if(!face?.rings.length || !footprintsDisjoint(rings,face.rings))return false;
    const included=(p,list)=>list.reduce((count,r)=>count+Number(pointInside(p,r)),0)%2===1;
    return rings.every(r=>included(r[0],face.rings)) && face.rings.every(r=>!included(r[0],rings));
  }
  function footprintOverlapTriangle(rings,tri) {
    const included=p=>rings.reduce((n,r)=>n+Number(pointInside(p,r)),0)%2===1;
    if(tri.some(included))return true;
    for(const ring of rings)if(pointInside(ring[0],tri))return true;
    return !footprintsDisjoint(rings,[tri]);
  }
  function planarStamp(mesh,rings,plane,depth) {
    const top=planarFace(mesh,plane,0,1);
    if(!withinFace(rings,top))return null;
    const out=Solid.createMeshBuilder();
    const minZ=Math.min(0,depth),maxZ=Math.max(0,depth);
    let bottom=null,actualDepth=depth;
    if(depth<0){
      // Through cut across a parallel rear face: cut matching holes on both
      // caps and join their boundaries rather than leave a floor outside.
      let min=Infinity;
      for(let i=0;i<mesh.positions.length;i+=3)min=Math.min(min,plane.project(Array.from(mesh.positions.slice(i,i+3)))[2]);
      if(depth<=min+EPS){
        bottom=planarFace(mesh,plane,min,-1);
        if(!withinFace(rings,bottom))return null;
        actualDepth=min;
      }
    }
    for(let i=0;i<mesh.positions.length;i+=9){
      if(top.triangles.has(i)||bottom?.triangles.has(i))continue;
      const p=[0,3,6].map(j=>Array.from(mesh.positions.slice(i+j,i+j+3))),local=p.map(plane.project),zs=local.map(q=>q[2]);
      if(Math.max(...zs)>minZ+EPS && Math.min(...zs)<maxZ-EPS && footprintOverlapTriangle(rings,local.map(q=>q.slice(0,2))))return null;
      out.triangle(...p,mesh.contourIds[i/9],mesh.surfaceTypes[i/9]);
    }
    fill(out,[...top.rings,...rings],plane,0,true);
    if(bottom)fill(out,[...bottom.rings,...rings],plane,actualDepth,false);
    else fill(out,rings,plane,actualDepth,true);
    sideWalls(out,rings,plane,0,actualDepth);
    const result=out.finish({stats:{operation:depth>0?'union':'subtract'}});
    return result.stats.closed?result:null;
  }
  function buildCutter(rings,plane,depth) {
    const out=Solid.createMeshBuilder(),a=depth<0?depth:-.002,b=depth<0?.002:depth;
    fill(out,rings,plane,a,false); fill(out,rings,plane,b,true); sideWalls(out,rings,plane,a,b);
    return closed(out.finish());
  }
  function fastenerHole(mesh,origin,normal,diameter,headDiameter,headDepth,countersink=false) {
    const plane=frame(origin,normal);
    const circle=radius=>Array.from({length:48},(_,i)=>{
      const a=i*Math.PI/24;
      return [radius*Math.cos(a),radius*Math.sin(a)];
    });
    const shaft=circle(diameter/2),head=circle(headDiameter/2);
    let back=Infinity;
    for(let i=0;i<mesh.positions.length;i+=3){
      const p=mesh.positions.subarray(i,i+3);
      back=Math.min(back,dot(minus(p,origin),plane.normal));
    }
    requireValue(back < -headDepth-.01,'Уступ под головку должен заканчиваться внутри детали.');
    const topFace=planarFace(mesh,plane,0,1),backFace=planarFace(mesh,plane,back,-1);
    requireValue(withinFace([head],topFace),'Поместите окружность под головку целиком на плоскую грань.');
    const cleanTunnel=withinFace([shaft],backFace)&&!MeshQueries.triangles(mesh).some(triangle=>{
      const i=triangle.index*9;
      if(topFace.triangles.has(i)||backFace.triangles.has(i))return false;
      const local=[triangle.a,triangle.b,triangle.c].map(plane.project);
      const zs=local.map(p=>p[2]);
      if(Math.max(...zs)<=back+EPS||Math.min(...zs)>=-EPS)return false;
      const profile=Math.max(...zs)>-headDepth-EPS?head:shaft;
      return footprintOverlapTriangle([profile],local.map(p=>p.slice(0,2)));
    });
    const out=Solid.createMeshBuilder();
    const cone=(upperHeight,inward)=>{
      for(let i=0;i<shaft.length;i++){
        const j=(i+1)%shaft.length;
        const a=plane.world(shaft[i],-headDepth),b=plane.world(shaft[j],-headDepth);
        const c=plane.world(head[j],upperHeight),d=plane.world(head[i],upperHeight);
        if(inward)out.quad(a,d,c,b,-1,2);
        else out.quad(a,b,c,d,-1,2);
      }
    };
    if(cleanTunnel){
      for(let i=0;i<mesh.positions.length;i+=9)if(!topFace.triangles.has(i)&&!backFace.triangles.has(i)){
        const p=[0,3,6].map(j=>Array.from(mesh.positions.subarray(i+j,i+j+3)));
        out.triangle(...p,mesh.contourIds[i/9],mesh.surfaceTypes[i/9]);
      }
      fill(out,[...topFace.rings,head],plane,0,true);
      fill(out,[...backFace.rings,shaft],plane,back,false);
      if(countersink)cone(0,true);
      else {
        fill(out,[head,shaft],plane,-headDepth,true);
        sideWalls(out,[head],plane,0,-headDepth);
      }
      sideWalls(out,[shaft],plane,-headDepth,back);
      return closed(out.finish({stats:{operation:'subtract'}}));
    }
    const spatial=MeshQueries.tree(MeshQueries.triangles(mesh));
    requireValue(MeshQueries.thickness(spatial,origin,normal)>headDepth+.01,'Под уступом должно оставаться достаточно материала.');
    const beyond=back-Math.max(.02,Math.abs(back)*.0001);
    fill(out,[shaft],plane,beyond,false);
    fill(out,[head],plane,.01,true);
    sideWalls(out,[shaft],plane,beyond,-headDepth);
    if(countersink)cone(.01,false);
    else {
      fill(out,[head,shaft],plane,-headDepth,false);
      sideWalls(out,[head],plane,-headDepth,.01);
    }
    const result=Solid.boolean(mesh,closed(out.finish()),'subtract');
    requireValue(result.positions.length && result.stats.volumeMm3<mesh.stats.volumeMm3-EPS,'Крепёжное отверстие должно пересекать материал детали.');
    return closed(result);
  }
  function applyStamp(mesh,rings,plane,depth,skipOutside=false){
    const local=planarStamp(mesh,rings,plane,depth);
    if(local)return local;
    const cutter=buildCutter(rings,plane,depth);
    const overlap=mesh.bounds.min.every((v,i)=>v<cutter.bounds.max[i] && mesh.bounds.max[i]>cutter.bounds.min[i]);
    if(!overlap && skipOutside)return mesh;
    requireValue(overlap,'Контур операции должен попадать на поверхность детали.');
    if(depth>0){
      const contact=Solid.boolean(mesh,cutter,'intersect');
      if(contact.stats.volumeMm3<EPS && skipOutside)return mesh;
      requireValue(contact.stats.volumeMm3>EPS,'Надпись или выступ должны соприкасаться с выбранной деталью.');
    }
    const result=Solid.boolean(mesh,cutter,depth>0?'union':'subtract');
    requireValue(result.positions.length,'Вырез полностью удаляет деталь.');
    if(Math.abs(mesh.stats.volumeMm3-result.stats.volumeMm3)<EPS){
      if(skipOutside)return mesh;
      throw new Error('Надпись не пересекает материал. Переместите её на грань детали.');
    }
    if(depth>0 && !skipOutside)requireValue(result.stats.components<=(mesh.stats.components??1),'Все буквы рельефной надписи должны касаться поверхности детали.');
    return result;
  }
  function rotate(p,center,n,angle) {
    const d=minus(p,center),c=Math.cos(angle),s=Math.sin(angle);
    return plus(center,plus(times(d,c),plus(times(cross(n,d),s),times(n,dot(n,d)*(1-c)))));
  }
  function applyPattern(body,f) {
    const source=f.source,normal=source.normal,depth=source.type==='cut'?-source.depth:source.depth;
    let result=body.mesh,applied=0;
    const divisor=f.layout==='circular' && Math.abs(f.sweep)===360 ? f.count:f.count-1;
    for(let i=f.skipFirst?1:0;i<f.count;i++){
      const local=source.points.map(p=>f.layout==='linear'?plus(p,times(f.step,i)):rotate(p,f.center,normal,i*f.sweep/divisor*Math.PI/180));
      const points=local.map(p=>plus(p,body.offset));
      const plane=frame(points[0],normal);
      const profile=points.map(p=>plane.project(p).slice(0,2));
      const next=applyStamp(result,[profile],plane,depth,true);
      if(Math.abs(next.stats.volumeMm3-result.stats.volumeMm3)>1e-4)applied++;
      result=next;
    }
    requireValue(applied>0,'Ни одна новая копия не попала на материал. Измените шаг или центр массива.');
    return result;
  }
  function draft(body,angle) {
    requireValue(body.mode==='extrude'&&!body.fillet&&!body.shell&&body.mesh.contours?.length,'Уклон начинается с простого вытянутого профиля.');
    const contours=body.mesh.contours,rings=contours.map(c=>c.points);
    const top=Solid.checkedInset(rings,body.height*Math.tan(angle*Math.PI/180));
    const baseZ=body.offset[2],topZ=baseZ+body.height,out=Solid.createMeshBuilder();
    const xy=p=>[p.x,p.y];
    for(const [index,ring] of rings.entries()){
      for(let i=0;i<ring.length;i++){
        const j=(i+1)%ring.length;
        out.quad([...xy(ring[i]),baseZ],[...xy(ring[j]),baseZ],[...xy(top[index][j]),topZ],[...xy(top[index][i]),topZ],contours[index].index,2);
      }
    }
    for(const [profile,z,up] of [[rings,baseZ,false],[top,topZ,true]]){
      triangulate(profile[0].map(xy),profile.slice(1).map(r=>r.map(xy)),(a,b,c)=>{
        if(!up)[b,c]=[c,b];
        out.triangle([...a,z],[...b,z],[...c,z],-1,up?1:0);
      });
    }
    return closed(out.finish({stats:{operation:'draft-angle',angle}}));
  }
  function finishEdge(body,feature) {
    const edge=feature.edge.map(p=>plus(p,body.offset)),mesh=body.mesh.stats.components
      ?body.mesh:Solid.transformMesh(body.mesh,p=>p);
    const touches=p=>edge.some(q=>distance(p,q)<.001);
    const relevant=MeshQueries.triangles(mesh).filter(face=>[face.a,face.b,face.c].filter(touches).length===2);
    const normals=relevant.map(face=>face.normal);
    const first=normals[0],second=first&&normals.find(n=>Math.abs(dot(first,n))<.9999);
    requireValue(second&&mesh.stats.components===1,'Выберите наружное ребро между двумя гранями одной детали.');
    for(let i=0;i<mesh.positions.length;i+=3){
      const delta=minus(mesh.positions.subarray(i,i+3),edge[0]);
      requireValue(dot(delta,first)<.002&&dot(delta,second)<.002,'Скругление и фаска на этом ребре доступны для выпуклых наружных граней.');
    }
    let result=mesh;
    const axis=unit(cross(first,second)),opening=Math.acos(Math.max(-1,Math.min(1,dot(first,second))));
    if(feature.type==='edge-bevel'){
      const bisector=unit(plus(first,second));
      result=Solid.clipToPlane(mesh,minus(edge[0],times(bisector,feature.radius*Math.sin(opening/2))),bisector);
    }else{
      const axial=unit(minus(edge[1],edge[0]));
      const gradient=((feature.radiusEnd??feature.radius)-feature.radius)/distance(...edge);
      const bisector=times(plus(first,second),1/(1+dot(first,second)));
      for(let i=1;i<8;i++){
        const normal=rotate(first,[0,0,0],axis,opening*i/8);
        const k=1-dot(bisector,normal);
        const localNormal=minus(normal,times(axial,k*gradient));
        result=Solid.clipToPlane(result,plus(edge[0],times(normal,k*feature.radius)),localNormal);
      }
    }
    requireValue(result.stats.volumeMm3<mesh.stats.volumeMm3-EPS,'Размер обработки слишком мал для выбранного ребра.');
    return closed(result);
  }
  function catalogBody(feature){
    const {part,diameter,outer,height,origin}=feature;
    const names={washer:'Шайба',nut:'Гайка',spacer:'Втулка',pin:'Штифт',screw:'Винт'};
    const cylinder=(id,length,radius,z,inner)=>({key:'f:'+feature.id+':'+id,origin:plus(origin,[0,0,z]),normal:[0,0,1],length,radius,inner});
    let mesh,cylinders;
    if(part==='screw'){
      const headHeight=Math.min(height/2,diameter*.6),shaft=diameter/2,head=outer/2;
      const section=[[0,0],[shaft,0],[shaft,height-headHeight],[head,height-headHeight],[head,height],[0,height]];
      const points=[...section,section[0]].map(([x,y])=>({x:x*4,y:-y*4}));
      const profile=global.LabExtrusion.analyze([{type:'path',points}],{tolerance:.01});
      mesh=Solid.transformMesh(Solid.revolve(profile,{point:[0,0],direction:[0,1]}),p=>[p[0],-p[2],p[1]]);
      cylinders=[cylinder('shaft',height-headHeight,shaft,0,false),cylinder('head',headHeight,head,height-headHeight,false)];
    }else{
      const radius=(part==='pin'?diameter:outer)/2;
      const circle=r=>({type:'circle',cx:0,cy:0,r:r*4});
      const outline=part==='nut'?Array.from({length:6},(_,i)=>({x:outer*4/Math.sqrt(3)*Math.cos(i*Math.PI/3),y:outer*4/Math.sqrt(3)*Math.sin(i*Math.PI/3)})):null;
      const strokes=[outline?{type:'path',points:[...outline,outline[0]]}:circle(radius)];
      if(part!=='pin')strokes.push(circle(diameter/2));
      const profile=global.LabExtrusion.analyze(strokes,{tolerance:.01});
      mesh=Solid.transformMesh(global.LabExtrusion.extrude(profile,height),p=>p);
      cylinders=part==='pin'?[cylinder('shaft',height,radius,0,false)]:
        [cylinder('shaft',height,diameter/2,0,true)];
    }
    return {mesh:Solid.translated(closed(mesh),origin),name:names[part]+' ⌀'+diameter,cylinders};
  }
  function importedBody(feature){
    const out=Solid.createMeshBuilder();
    for(let i=0;i<feature.vertices.length;i+=9){
      out.triangle(...[0,3,6].map(j=>plus(feature.vertices.slice(i+j,i+j+3),feature.offset)));
    }
    return closed(out.finish());
  }
  function apply(body,f) {
    if(f.type==='draft-angle')return draft(body,f.angle);
    if(['edge-bevel','edge-round','edge-round-variable'].includes(f.type))return finishEdge(body,f);
    if(Lab?.types.includes(f.type))return Lab.apply(body,f);
    if(f.type==='workplane'){
      const plane=frame(plus(f.origin,body.offset),f.normal,f.u);
      const rings=[f.points.map(p=>plane.project(plus(p,body.offset)).slice(0,2))];
      const protrusion=f.depth>0?planarStamp(body.mesh,rings,plane,f.depth):null;
      if(protrusion)return protrusion;
      // Signed length controls the direction of the extrusion. A working plane
      // can start above the part and extrude back to it.
      const out=Solid.createMeshBuilder(),from=Math.min(0,f.depth)-.002,to=Math.max(0,f.depth)+.002;
      fill(out,rings,plane,from,false);fill(out,rings,plane,to,true);sideWalls(out,rings,plane,from,to);
      const tool=closed(out.finish());
      const intersection=Solid.boolean(body.mesh,tool,'intersect');
      requireValue(intersection.stats.volumeMm3>EPS,'Выступ должен доходить до детали. Измените высоту, длину или направление.');
      const result=closed(Solid.boolean(body.mesh,tool,'union'));
      requireValue(result.stats.volumeMm3>body.mesh.stats.volumeMm3+EPS,'Выступ полностью внутри детали. Измените высоту или длину.');
      return result;
    }
    if(f.type==='fastener')return fastenerHole(body.mesh,plus(f.origin,body.offset),f.normal,f.diameter,f.headDiameter,f.headDepth,f.headStyle==='cone');
    if(f.type==='loft'){
      requireValue(body.mode==='extrude' && !body.fillet && !body.shell,'Переход начинается с плоского исходного контура.');
      const contours=body.mesh.contours||[];
      requireValue(contours.length>=1 && contours.length<=2,'Для перехода выберите один внешний контур и не более одного соосного отверстия.');
      const local=contours.map(c=>c.points.map(p=>[p.x-body.offset[0],p.y-body.offset[1]]));
      const mesh=loft([{points:local[0],z:0},...f.sections],{baseHole:local[1],contourIds:contours.map(c=>c.index)});
      return Solid.translated(mesh,body.offset);
    }
    if(f.type==='fold'){
      requireValue(body.mode==='extrude' || body.mode==='fold','Выберите вытянутую листовую заготовку.');
      return fold(body.mesh,f.line.map(p=>plus(p,body.offset.slice(0,2))),f.angle,body.height,body.offset[2]);
    }
    if(f.type==='pattern')return applyPattern(body,f);
    const plane=frame(plus(f.origin,body.offset),f.normal,f.u);
    return applyStamp(body.mesh,textLayout(f.text,f.size).rings,plane,f.operation==='cut'?-f.depth:f.depth);
  }
  const api=Object.freeze({types,validateFeature,loft,fold,textLayout,apply,catalogBody,importedBody});
  global.LabForms=api;
  if(typeof module!=='undefined' && module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
