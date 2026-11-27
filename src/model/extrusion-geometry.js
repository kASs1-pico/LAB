/* Closed contour recognition and real solid extrusion in millimetres.
 * Top/bottom triangulation: bundled Mapbox Earcut (ISC, vendor/earcut-LICENSE).
 * Contours are validated before triangulation; overlapping/touching rings are rejected.
 */
(function (global) {
  'use strict';
  // CONTACT covers curve tessellation/simplification error (<0.1 paper unit per boundary).
  // Distances below 0.0625 mm are intentionally treated as touching boundaries.
  const MM = 4, EPS = 1e-7, CONTACT = 0.25;
  const LIMITS = { strokes: 1024, points: 4000, contours: 160, rawPoints: 250000 };
  const point = p => ({ x: p.x, y: p.y });
  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const cross = (a, b, c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const finitePoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x)<1e6 && Math.abs(p.y)<1e6;
  const area = points => points.reduce((sum,p,i) => { const q=points[(i+1)%points.length]; return sum+p.x*q.y-q.x*p.y; },0)/2;
  const midpoint = (a,b) => ({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const error = (code,message,points=[]) => ({code,message,points:points.filter(finitePoint).slice(0,24).map(point)});

  function segmentDistance2(p,a,b) {
    const dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
    return (p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2;
  }
  function simplify(points,tolerance=.1) {
    const clean=[];
    for(const p of points) if(!clean.length||dist2(p,clean.at(-1))>EPS*EPS)clean.push(point(p));
    if(clean.length<4)return clean;
    const keep=new Uint8Array(clean.length);keep[0]=keep[clean.length-1]=1;
    const stack=[[0,clean.length-1]], threshold=tolerance*tolerance;
    while(stack.length){
      const [a,b]=stack.pop();let max=threshold,index=-1;
      for(let i=a+1;i<b;i++){const d=segmentDistance2(clean[i],clean[a],clean[b]);if(d>max){max=d;index=i;}}
      if(index!==-1){keep[index]=1;stack.push([a,index],[index,b]);}
    }
    return clean.filter((_,i)=>keep[i]);
  }
  function cleanRing(points) {
    const clean=[];
    for(const p of points)if(!clean.length||dist2(p,clean.at(-1))>EPS*EPS)clean.push(point(p));
    if(clean.length>1&&dist2(clean[0],clean.at(-1))<EPS*EPS)clean.pop();
    let changed=true;
    while(changed&&clean.length>3){
      changed=false;
      for(let i=0;i<clean.length;i++){
        const a=clean[(i+clean.length-1)%clean.length],b=clean[i],c=clean[(i+1)%clean.length];
        if(Math.abs(cross(a,b,c))<=EPS && (b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y)>=0){clean.splice(i,1);changed=true;break;}
      }
    }
    return clean;
  }
  function sampleArc(s,full=false) {
    const start=full?0:s.start,delta=full?360:s.delta;
    // Multiple of four includes all cardinal points; sagitta is at most 0.05 unit.
    const fullSegments=Math.ceil(Math.max(48,Math.PI*Math.sqrt(Math.max(1,s.r)/.1))/4)*4;
    const segments=Math.max(2,Math.ceil(fullSegments*Math.abs(delta)/360));
    return Array.from({length:segments+1},(_,i)=>{
      const angle=(start+delta*i/segments)*Math.PI/180;
      return {x:s.cx+s.r*Math.cos(angle),y:s.cy+s.r*Math.sin(angle)};
    });
  }
  function intersect(a,b,c,d) {
    if(Math.max(a.x,b.x)+CONTACT<Math.min(c.x,d.x)||Math.max(c.x,d.x)+CONTACT<Math.min(a.x,b.x)||Math.max(a.y,b.y)+CONTACT<Math.min(c.y,d.y)||Math.max(c.y,d.y)+CONTACT<Math.min(a.y,b.y))return null;
    const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
    if(((abC>EPS&&abD< -EPS)||(abC< -EPS&&abD>EPS))&&((cdA>EPS&&cdB< -EPS)||(cdA< -EPS&&cdB>EPS))){
      const t=abC/(abC-abD);return {x:c.x+(d.x-c.x)*t,y:c.y+(d.y-c.y)*t};
    }
    for(const [p,u,v] of [[a,c,d],[b,c,d],[c,a,b],[d,a,b]])if(segmentDistance2(p,u,v)<=CONTACT*CONTACT)return point(p);
    return null;
  }
  function inside(p,ring) {
    let value=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[i],b=ring[j];
      if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)value=!value;
    }
    return value;
  }
  function analyze(strokes,options={}) {
    const tolerance=Number.isFinite(options.tolerance)?Math.max(.05,Math.min(8,options.tolerance)):8;
    const result={ok:false,loops:[],solids:[],errors:[],warnings:[],stats:{contours:0,solids:0,holes:0,points:0,areaMm2:0}};
    const fail=e=>{if(result.errors.length<12)result.errors.push(e);};
    if(!Array.isArray(strokes)||!strokes.length){fail(error('empty','Начертите замкнутый контур: многоугольник или окружность.'));return result;}
    if(strokes.length>LIMITS.strokes){fail(error('complexity','Слишком много линий для 3D. Оставьте не больше 1024 построений.'));return result;}
    const chains=[];let rawCount=0,processedCount=0,approximateClosures=0;
    for(let index=0;index<strokes.length;index++){
      const s=strokes[index];let pts,closed=false;
      if(!s){fail(error('invalid','В чертеже есть повреждённое построение.'));continue;}
      if(s.type==='line'&&finitePoint(s.a)&&finitePoint(s.b))pts=[point(s.a),point(s.b)];
      else if(s.type==='path'&&Array.isArray(s.points)&&s.points.every(finitePoint)){
        rawCount+=s.points.length;
        if(rawCount>LIMITS.rawPoints){fail(error('complexity','Контур слишком подробный. Упростите линии перед созданием объёма.'));return result;}
        pts=simplify(s.points);
      } else if((s.type==='circle'||s.type==='arc')&&Number.isFinite(s.cx)&&Number.isFinite(s.cy)&&Number.isFinite(s.r)&&s.r>0&&s.r<1e6&&(s.type==='circle'||(Number.isFinite(s.start)&&Number.isFinite(s.delta)&&Math.abs(s.delta)<=360.01))){
        closed=s.type==='circle'||Math.abs(s.delta)>=359.999;
        pts=sampleArc(s,closed);
      }else{fail(error('invalid','Это построение нельзя превратить в замкнутый контур.'));continue;}
      processedCount+=pts?.length||0;
      if(processedCount>LIMITS.points+LIMITS.strokes*2){fail(error('complexity','Контур слишком подробный. Упростите линии перед созданием объёма.'));return result;}
      if(!pts||pts.length<2||pts.every(p=>dist2(p,pts[0])<EPS)){fail(error('point','Отдельная точка не задаёт объём. Удалите её или соедините линиями.',pts||[]));continue;}
      if(closed||dist2(pts[0],pts.at(-1))<=tolerance*tolerance){
        if(!closed&&dist2(pts[0],pts.at(-1))>EPS)approximateClosures++;
        const join=midpoint(pts[0],pts.at(-1));pts[0]=join;pts[pts.length-1]=join;
        result.loops.push({points:cleanRing(pts),depth:0,parent:-1,sourceIndices:[index]});
      }else chains.push({points:pts,sourceIndex:index});
    }
    // Connect both ends of open strokes. Exactly two incident ends are required at a join.
    if(chains.length){
      const ends=chains.flatMap((chain,i)=>[{p:chain.points[0],chain:i,side:0},{p:chain.points.at(-1),chain:i,side:1}]);
      const parent=ends.map((_,i)=>i);
      const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
      for(let i=0;i<ends.length;i++)for(let j=i+1;j<ends.length;j++)if(dist2(ends[i].p,ends[j].p)<=tolerance*tolerance){const a=root(i),b=root(j);if(a!==b)parent[b]=a;}
      const groups=new Map();ends.forEach((end,i)=>{const r=root(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(i);});
      const nodes=[];const endpointNode=[];
      for(const group of groups.values()){
        const p={x:0,y:0};group.forEach(i=>{p.x+=ends[i].p.x/group.length;p.y+=ends[i].p.y/group.length;});
        const n=nodes.length;nodes.push({p,ends:group});group.forEach(i=>endpointNode[i]=n);
        if(group.length===1)fail(error('open','Контур не замкнут. Соедините отмеченные концы линий.',group.map(i=>ends[i].p)));
        else if(group.length>2)fail(error('branch','В одной точке сходятся больше двух линий. Удалите лишнюю ветку.',[p]));
        else if(dist2(ends[group[0]].p,ends[group[1]].p)>EPS)approximateClosures++;
      }
      if(!result.errors.some(e=>e.code==='open'||e.code==='branch')){
        const visited=new Set();
        for(let seed=0;seed<chains.length;seed++){
          if(visited.has(seed))continue;
          let chainIndex=seed,entrySide=0;const points=[],sourceIndices=[];const startNode=endpointNode[seed*2];let guard=0;
          do{
            if(visited.has(chainIndex)||guard++>chains.length){fail(error('branch','Не удалось однозначно обойти контур. Проверьте соединения.'));break;}
            visited.add(chainIndex);sourceIndices.push(chains[chainIndex].sourceIndex);
            const chain=chains[chainIndex].points.map(point);if(entrySide===1)chain.reverse();
            const entryNode=endpointNode[chainIndex*2+entrySide],exitNode=endpointNode[chainIndex*2+1-entrySide];
            chain[0]=point(nodes[entryNode].p);chain[chain.length-1]=point(nodes[exitNode].p);
            points.push(...(points.length?chain.slice(1):chain));
            if(exitNode===startNode){result.loops.push({points:cleanRing(points),depth:0,parent:-1,sourceIndices});break;}
            const next=nodes[exitNode].ends.map(i=>ends[i]).find(end=>end.chain!==chainIndex);
            if(!next){fail(error('branch','Неправильное соединение линий.',[nodes[exitNode].p]));break;}
            chainIndex=next.chain;entrySide=next.side;
          }while(true);
        }
      }
    }
    if(result.errors.length)return result;
    const pointCount=result.loops.reduce((sum,loop)=>sum+loop.points.length,0);
    if(pointCount>LIMITS.points||result.loops.length>LIMITS.contours){fail(error('complexity','Слишком сложный контур. Для 3D оставьте до 160 контуров и 4000 вершин.'));return result;}
    for(const loop of result.loops){
      const p=loop.points;
      if(p.length<3){fail(error('small','Для контура нужны как минимум три разные вершины.',p));continue;}
      // Check crossings before signed area: a bow tie has a zero signed area.
      for(let i=0;i<p.length;i++){
        const prev=p[(i+p.length-1)%p.length],a=p[i],b=p[(i+1)%p.length];
        if(Math.abs(cross(prev,a,b))<EPS&&(a.x-prev.x)*(b.x-a.x)+(a.y-prev.y)*(b.y-a.y)<0){fail(error('self-intersection','Контур возвращается по той же линии. Уберите наложение.',[a]));break;}
        for(let j=i+2;j<p.length;j++){
          if(i===0&&j===p.length-1)continue;
          const collision=intersect(a,b,p[j],p[(j+1)%p.length]);
          if(collision){fail(error('self-intersection','Контур пересекает сам себя. Исправьте отмеченное место.',[collision]));i=p.length;break;}
        }
      }
      loop.area=Math.abs(area(p));
      if(loop.area<1)fail(error('small','Контур слишком мал или не имеет площади.',p.slice(0,3)));
    }
    if(result.errors.length)return result;
    for(let i=0;i<result.loops.length;i++)for(let j=i+1;j<result.loops.length;j++){
      const a=result.loops[i].points,b=result.loops[j].points;let collision=null;
      for(let k=0;k<a.length&&!collision;k++)for(let l=0;l<b.length&&!collision;l++)collision=intersect(a[k],a[(k+1)%a.length],b[l],b[(l+1)%b.length]);
      if(collision)fail(error('contours-touch','Контуры пересекаются или касаются. Отверстие должно целиком находиться внутри детали.',[collision]));
    }
    if(result.errors.length)return result;
    result.loops.forEach((loop,i)=>{
      const containers=result.loops.map((other,j)=>({other,j})).filter(({other,j})=>i!==j&&inside(loop.points[0],other.points));
      loop.depth=containers.length;
      if(containers.length)loop.parent=containers.reduce((best,c)=>c.other.area<best.other.area?c:best).j;
    });
    result.loops.forEach((loop,i)=>{
      if(loop.depth%2===0)result.solids.push({outer:loop,holes:result.loops.filter(other=>other.parent===i&&other.depth===loop.depth+1)});
    });
    if(!result.solids.length){fail(error('empty','Начертите внешний замкнутый контур.'));return result;}
    result.stats={contours:result.loops.length,solids:result.solids.length,holes:result.loops.filter(loop=>loop.depth%2===1).length,points:pointCount,areaMm2:result.loops.reduce((sum,loop)=>sum+(loop.depth%2?-1:1)*loop.area,0)/(MM*MM)};
    if(approximateClosures)result.warnings.push(`Близкие концы линий соединены автоматически (до ${tolerance/MM} мм).`);
    result.ok=true;return result;
  }

  // Flat triangle data is deliberately shared by the renderer and file exporters.
  // Surface codes: 0 bottom, 1 top, 2 wall, 3 bevel, 4 section cap.
  function meshBuilder() {
    const positions=[],normals=[],edges=[],contourIds=[],surfaceTypes=[];
    const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
    function triangle(a,b,c,contour=-1,surface=2){
      a=a.map(Math.fround);b=b.map(Math.fround);c=c.map(Math.fround);
      const u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);
      const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n);
      if(len<1e-10)return;
      contourIds.push(contour);surfaceTypes.push(surface);
      for(const p of [a,b,c]){positions.push(...p);normals.push(...n.map(q=>q/len));for(let i=0;i<3;i++){bounds.min[i]=Math.min(bounds.min[i],p[i]);bounds.max[i]=Math.max(bounds.max[i],p[i]);}}
    }
    function quad(a,b,c,d,contour,surface){triangle(a,b,c,contour,surface);triangle(a,c,d,contour,surface);}
    function finish(extra={}){
      let volume=0;
      for(let i=0;i<positions.length;i+=9){const a=positions.slice(i,i+3),b=positions.slice(i+3,i+6),c=positions.slice(i+6,i+9);volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}
      const faceContours=new Int32Array(contourIds);
      return {positions:new Float32Array(positions),normals:new Float32Array(normals),edges:new Float32Array(edges),contourIds:faceContours,faceContours,surfaceTypes:new Uint8Array(surfaceTypes),bounds:positions.length?bounds:{min:[0,0,0],max:[0,0,0]},...extra,stats:{...(extra.stats||{}),volumeMm3:Math.abs(volume),triangles:positions.length/9}};
    }
    return {positions,normals,edges,triangle,quad,finish};
  }
  function offsetRing(points,amount){
    return points.map((p,i)=>{
      const prev=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length];
      const ux=p.x-prev.x,uy=p.y-prev.y,vx=next.x-p.x,vy=next.y-p.y;
      const ul=Math.hypot(ux,uy),vl=Math.hypot(vx,vy);
      const a={x:-uy/ul,y:ux/ul},b={x:-vy/vl,y:vx/vl};
      const denominator=1+a.x*b.x+a.y*b.y;
      if(denominator<1e-5)throw new Error('Угол слишком острый для фаски.');
      const dx=amount*(a.x+b.x)/denominator,dy=amount*(a.y+b.y)/denominator;
      if(Math.hypot(dx,dy)>amount*5)throw new Error('Угол слишком острый для фаски.');
      return {x:p.x+dx,y:p.y+dy};
    });
  }
  function triangulateRings(rings){
    const flat=[],holes=[],points=[];
    rings.forEach((ring,i)=>{if(i)holes.push(points.length);for(const p of ring){points.push(p);flat.push(p.x,p.y);}});
    const indices=global.earcut(flat,holes,2);
    if(!indices.length||global.earcut.deviation(flat,holes,2,indices)>1e-6)throw new Error('Не удалось построить поверхность. Упростите узкие участки контура.');
    return {points,indices};
  }
  function extrude(analysis,heightMm,options={}) {
    if(!analysis?.ok)throw new Error('Сначала замкните и проверьте контуры.');
    if(!Number.isFinite(heightMm)||heightMm<.1||heightMm>1000)throw new Error('Задайте высоту от 0,1 до 1000 мм.');
    if(typeof global.earcut!=='function')throw new Error('Не загружена локальная библиотека построения поверхности.');
    const requested=Number.isFinite(options.bevel)?Math.max(0,Math.min(2,options.bevel)):0;
    let bevel=Math.min(requested,heightMm*.45),insets=null;
    const warnings=[];
    const contours=analysis.loops.map((loop,index)=>{
      const points=loop.points.map(p=>({x:p.x/MM,y:-p.y/MM}));
      if((area(points)>0)!==(loop.depth%2===0))points.reverse();
      return {index,depth:loop.depth,parent:loop.parent,points,sourceIndices:loop.sourceIndices?.slice()||[]};
    });
    if(bevel>0){
      for(let attempt=0;attempt<10;attempt++){
        try{
          const candidate=contours.map(ring=>offsetRing(ring.points,bevel));
          if(candidate.some((ring,i)=>area(ring)*area(contours[i].points)<=0))throw new Error('Фаска перекрывает узкий участок.');
          for(let n=0;n<candidate.length;n++)for(let i=0;i<candidate[n].length;i++){
            const j=(i+1)%candidate[n].length,a=contours[n].points[i],b=contours[n].points[j],p=candidate[n][i],q=candidate[n][j];
            if((q.x-p.x)*(b.x-a.x)+(q.y-p.y)*(b.y-a.y)<=EPS)throw new Error('Фаска перекрывает короткое ребро.');
          }
          const check=analyze(candidate.map(ring=>({type:'path',points:[...ring,ring[0]].map(p=>({x:p.x*MM,y:-p.y*MM}))})),{tolerance:.05});
          if(!check.ok||check.loops.some((loop,i)=>loop.depth!==contours[i].depth))throw new Error('Фаска пересекает узкие участки.');
          for(const ring of candidate)for(const p of ring){if(contours.filter(c=>inside(p,c.points)).length%2!==1)throw new Error('Фаска выходит за пределы материала.');}
          insets=candidate;break;
        }catch(_){bevel/=2;}
      }
      if(!insets){bevel=0;warnings.push('Фаска отключена: контур слишком узкий или имеет острые углы.');}
      else if(bevel<requested-1e-6)warnings.push(`Фаска уменьшена до ${Number(bevel.toFixed(3))} мм, чтобы сохранить отверстия и узкие участки.`);
    }
    const out=meshBuilder();
    const p3=(p,z)=>[p.x,p.y,z];
    for(const solid of analysis.solids){
      const indices=[solid.outer,...solid.holes].map(loop=>analysis.loops.indexOf(loop));
      const rings=indices.map(i=>contours[i].points),capRings=indices.map(i=>insets?insets[i]:contours[i].points);
      const cap=triangulateRings(capRings);
      for(let i=0;i<cap.indices.length;i+=3){
        let a=p3(cap.points[cap.indices[i]],heightMm),b=p3(cap.points[cap.indices[i+1]],heightMm),c=p3(cap.points[cap.indices[i+2]],heightMm);
        if((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])<0)[b,c]=[c,b];
        out.triangle(a,b,c,-1,1);out.triangle([c[0],c[1],0],[b[0],b[1],0],[a[0],a[1],0],-1,0);
      }
      rings.forEach((points,ringIndex)=>{
        const id=indices[ringIndex],capPoints=capRings[ringIndex];
        for(let i=0;i<points.length;i++){
          const j=(i+1)%points.length,p=points[i],q=points[j],previous=points[(i+points.length-1)%points.length];
          const a=p3(p,bevel),b=p3(q,bevel),c=p3(q,heightMm-bevel),d=p3(p,heightMm-bevel);
          out.quad(a,b,c,d,id,2);
          if(bevel){
            out.quad(p3(capPoints[i],0),p3(capPoints[j],0),b,a,id,3);
            out.quad(d,c,p3(capPoints[j],heightMm),p3(capPoints[i],heightMm),id,3);
            out.edges.push(...p3(capPoints[i],0),...p3(capPoints[j],0),...p3(capPoints[i],heightMm),...p3(capPoints[j],heightMm));
          }
          out.edges.push(...a,...b,...d,...c);
          const u={x:p.x-previous.x,y:p.y-previous.y},v={x:q.x-p.x,y:q.y-p.y};
          const cosine=(u.x*v.x+u.y*v.y)/(Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y)||1);
          if(cosine<Math.cos(Math.PI/24))out.edges.push(...a,...d);
        }
      });
    }
    return out.finish({contours,warnings,stats:{...analysis.stats,heightMm,bevelMm:bevel,bevelRequestedMm:requested}});
  }

  // A triangulator can omit collinear ring vertices. Its cap must still share
  // the exact edges of adjoining walls. Follow the original ring order so
  // unrelated nearby vertices never end up splitting a cap diagonal.
  function boundaryChains(rings,usedPoints,axes=[0,1]){
    const chains=new Map();
    function add(a,b,points){
      if(!chains.has(a))chains.set(a,new Map());
      chains.get(a).set(b,points);
    }
    for(const ring of rings){
      const survivors=ring.map((p,i)=>usedPoints.has(p)?i:-1).filter(i=>i>=0);
      for(let j=0;j<survivors.length;j++){
        const first=survivors[j],last=survivors[(j+1)%survivors.length],chain=[];
        for(let k=(first+1)%ring.length;k!==last;k=(k+1)%ring.length)chain.push(ring[k]);
        if(chain.length){
          add(ring[first],ring[last],chain);
          add(ring[last],ring[first],chain.slice().reverse());
        }
      }
    }
    const [x,y]=axes,points=rings.flat();
    const sorted=new Map(axes.map(axis=>[axis,points.slice().sort((a,b)=>a[axis]-b[axis])]));
    return function between(a,b){
      const known=chains.get(a)?.get(b);
      if(known)return known;
      // A diagonal introduced when bridging holes can run exactly along
      // other ring vertices. This occurs in letters with horizontal arms.
      const dx=b[x]-a[x],dy=b[y]-a[y],l2=dx*dx+dy*dy;
      const axis=Math.abs(dx)>Math.abs(dy)?x:y,order=sorted.get(axis);
      const lo=Math.min(a[axis],b[axis]),hi=Math.max(a[axis],b[axis]);
      let start=0,end=order.length;
      while(start<end){const mid=Math.floor((start+end)/2);if(order[mid][axis]<lo)start=mid+1;else end=mid;}
      const collinear=[];
      for(let i=start;i<order.length&&order[i][axis]<=hi;i++){
        const p=order[i];
        if(p===a||p===b)continue;
        const px=p[x]-a[x],py=p[y]-a[y],t=(px*dx+py*dy)/l2;
        if(t>1e-9 && t<1-1e-9 && Math.abs(dx*py-dy*px)<=1e-9*Math.sqrt(l2))collinear.push({p,t});
      }
      const chain=collinear.sort((a,b)=>a.t-b.t).map(c=>c.p);
      add(a,b,chain);add(b,a,chain.slice().reverse());
      return chain;
    };
  }
  // Clip a closed solid against one axis-aligned plane, then close every cut loop.
  // The original mesh remains untouched. The kept side is coordinate <= planeValue.
  function section(mesh,options={}){
    if(!mesh?.positions?.length)throw new Error('Нет модели для разреза.');
    const axis={x:0,y:1,z:2}[options.axis]??2;
    const fraction=Number.isFinite(options.position)?Math.max(0,Math.min(1,options.position)):.5;
    const bounds=mesh.bounds,planeValue=bounds.min[axis]+(bounds.max[axis]-bounds.min[axis])*fraction;
    if(fraction>=1)return {...mesh,planeValue,capPositions:new Float32Array(),capNormals:new Float32Array()};
    if(fraction<=0){const result=meshBuilder().finish({contours:mesh.contours||[],stats:{...mesh.stats}});return {...result,planeValue,capPositions:new Float32Array(),capNormals:new Float32Array()};}
    const extent=Math.max(...bounds.max.map((v,i)=>v-bounds.min[i]),1),tolerance=extent*1e-7;
    const key=p=>p.map(v=>Math.round(v/tolerance)).join(',');
    const out=meshBuilder(),segments=new Map(),canonical=new Map();
    // The mesh stores Float32 coordinates. Triangulate those same positions
    // to avoid hairline cap triangles that collapse when written to the mesh.
    const canon=p=>{const stored=p.map(Math.fround),k=key(stored);if(!canonical.has(k))canonical.set(k,stored);return canonical.get(k);};
    const distance=p=>p[axis]-planeValue;
    const edgeCut=(a,b)=>{const da=distance(a),db=distance(b),t=da/(da-db);const p=a.map((v,i)=>v+(b[i]-v)*t);p[axis]=planeValue;return canon(p);};
    for(let i=0;i<mesh.positions.length;i+=9){
      const tri=[0,3,6].map(offset=>Array.from(mesh.positions.slice(i+offset,i+offset+3)));
      const ds=tri.map(distance);
      if(ds.every(d=>d>tolerance))continue;
      if(ds.every(d=>Math.abs(d)<=tolerance))continue; // replaced by a consistent cut cap
      const clipped=[];
      for(let j=0;j<3;j++){
        const a=tri[j],b=tri[(j+1)%3],da=ds[j],db=ds[(j+1)%3],aIn=da<=tolerance,bIn=db<=tolerance;
        if(aIn)clipped.push(Math.abs(da)<=tolerance?canon(a):a);
        if(aIn!==bIn)clipped.push(edgeCut(a,b));
      }
      const clean=[];for(const p of clipped)if(!clean.length||key(p)!==key(clean.at(-1)))clean.push(p);
      if(clean.length>1&&key(clean[0])===key(clean.at(-1)))clean.pop();
      for(let j=1;j<clean.length-1;j++)out.triangle(clean[0],clean[j],clean[j+1],mesh.contourIds?.[i/9]??-1,mesh.surfaceTypes?.[i/9]??2);
    }
    // The boundary comes from the retained triangles, not from intersections
    // with discarded triangles. This handles a plane exactly on a hole wall.
    for(let i=0;i<out.positions.length;i+=9){
      const tri=[0,3,6].map(offset=>out.positions.slice(i+offset,i+offset+3));
      for(let j=0;j<3;j++){
        const a=tri[j],b=tri[(j+1)%3];if(Math.abs(distance(a))>tolerance||Math.abs(distance(b))>tolerance)continue;
        const ka=key(a),kb=key(b);if(ka===kb)continue;const k=ka<kb?ka+'|'+kb:kb+'|'+ka;
        if(segments.has(k))segments.delete(k);else segments.set(k,[canon(a),canon(b)]);
      }
    }
    const graph=new Map();
    for(const [a,b] of segments.values())for(const [p,q] of [[a,b],[b,a]]){const k=key(p);if(!graph.has(k))graph.set(k,{p,neighbors:[]});if(!graph.get(k).neighbors.some(n=>key(n)===key(q)))graph.get(k).neighbors.push(q);}
    const used=new Set(),loops=[];
    for(const node of graph.values()){
      if(used.has(key(node.p)))continue;
      let current=node.p,previous=null;const loop=[];let guard=0;
      do{
        const k=key(current),entry=graph.get(k);if(!entry||entry.neighbors.length!==2)throw new Error('Разрез проходит через неоднозначную вершину. Немного сдвиньте плоскость.');
        loop.push(current);used.add(k);const next=entry.neighbors.find(p=>!previous||key(p)!==key(previous));previous=current;current=next;
        if(++guard>graph.size+1)throw new Error('Не удалось замкнуть линию разреза.');
      }while(key(current)!==key(node.p));
      if(loop.length>=3)loops.push(loop);
    }
    const axes=axis===0?[1,2]:axis===1?[2,0]:[0,1]; // cross(u,v) points along positive axis
    const project=p=>({x:p[axes[0]],y:p[axes[1]]});
    const rings=loops.map(points=>({points,flat:points.map(project),depth:0,parent:-1}));
    rings.forEach((ring,i)=>{const containers=rings.map((r,j)=>({r,j})).filter(({r,j})=>j!==i&&inside(ring.flat[0],r.flat));ring.depth=containers.length;if(containers.length)ring.parent=containers.reduce((a,b)=>Math.abs(area(a.r.flat))<Math.abs(area(b.r.flat))?a:b).j;});
    const capStart=out.positions.length;
    for(let k=0;k<rings.length;k++){
      if(rings[k].depth%2)continue;
      const capRings=[rings[k],...rings.filter(r=>r.parent===k&&r.depth===rings[k].depth+1)];
      const flat=[],holeIndices=[],points=[];
      capRings.forEach((ring,j)=>{
        // Float32 source coordinates can make an otherwise straight bevel edge
        // zigzag by a few microns. Remove those near-collinear points for Earcut;
        // the exact cut vertices are restored on the cap boundary below.
        const clean=ring.points.slice();let changed=true;
        while(changed&&clean.length>3){changed=false;for(let n=0;n<clean.length;n++){
          const a=project(clean[(n+clean.length-1)%clean.length]),b=project(clean[n]),c=project(clean[(n+1)%clean.length]);
          if(segmentDistance2(b,a,c)<=tolerance*tolerance*4&&(b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y)>=0){clean.splice(n,1);changed=true;break;}
        }}
        if(j)holeIndices.push(points.length);for(const p of clean){const q=project(p);points.push(p);flat.push(q.x,q.y);}
      });
      const indices=global.earcut(flat,holeIndices,2);
      if(global.earcut.deviation(flat,holeIndices,2,indices)>1e-5)throw new Error('Не удалось закрыть разрез. Немного сдвиньте плоскость.');
      const between=boundaryChains(capRings.map(r=>r.points),new Set(indices.map(i=>points[i])),axes);
      for(let i=0;i<indices.length;i+=3){
        let tri=indices.slice(i,i+3).map(index=>points[index]);
        if(cross(...tri.map(project))<0)[tri[1],tri[2]]=[tri[2],tri[1]];
        const boundary=[];
        for(let j=0;j<3;j++){
          const a=tri[j],b=tri[(j+1)%3];
          boundary.push(a,...between(a,b));
        }
        if(boundary.length===3){out.triangle(...boundary,-1,4);continue;}
        const center=tri[0].map((v,j)=>(v+tri[1][j]+tri[2][j])/3);
        for(let j=0;j<boundary.length;j++)out.triangle(center,boundary[j],boundary[(j+1)%boundary.length],-1,4);
      }
    }
    for(const [a,b] of segments.values())out.edges.push(...a,...b);
    const result=out.finish({contours:mesh.contours||[],warnings:[],stats:{...mesh.stats,sectionAxis:['x','y','z'][axis],sectionPosition:fraction}});
    result.planeValue=planeValue;result.capPositions=result.positions.slice(capStart);result.capNormals=result.normals.slice(capStart);
    return result;
  }
  const api=Object.freeze({analyze,extrude,section,boundaryChains,limits:Object.freeze(LIMITS)});
  global.LabExtrusion=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
