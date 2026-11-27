// Persistent geometric relationships between line segments and full circles.
(function (global) {
  'use strict';
  const EPS = 1e-6;
  const limit = 120;
  const types = Object.freeze(['equal', 'right', 'tangent', 'center']);
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
  const delta = (b, a) => ({x:b.x-a.x, y:b.y-a.y});
  const shift = (a, d, t=1) => ({x:a.x+d.x*t, y:a.y+d.y*t});
  const dot = (a,b) => a.x*b.x+a.y*b.y;
  const len = p => Math.hypot(p.x,p.y);
  const rotate = d => ({x:-d.y,y:d.x});
  const circle = s => s?.type==='circle'||(s?.type==='arc'&&Math.abs(s.delta)>=359.8);
  const line = s => s?.type==='line'&&len(delta(s.b,s.a))>EPS;
  const center = s => ({x:s.cx,y:s.cy});
  const inside = p => Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=100000&&Math.abs(p.y)<=100000;
  function unit(d) {
    const length=len(d);
    if(length<=EPS)throw new Error('Связанному отрезку нужна ненулевая длина.');
    return {x:d.x/length,y:d.y/length};
  }
  function supports(kind, a, b) {
    if(kind==='center')return circle(a)&&circle(b);
    if(kind==='tangent')return (line(a)&&circle(b))||(circle(a)&&line(b));
    return ['equal','right'].includes(kind)&&line(a)&&line(b);
  }

  function validate(input, strokes) {
    if(input===undefined)return [];
    if(!Array.isArray(input)||input.length>limit)throw new Error('В проекте разрешено до 120 связей.');
    const shapes=new Map(strokes.map(shape=>[shape.id,shape]));
    const mirrored=new Set(strokes.filter(s=>s.mirrorOf).flatMap(s=>[s.id,s.mirrorOf]));
    const groups=new Map(), ids=new Set(), parents=new Map();
    function root(id) {
      let node=id;
      while(parents.has(node))node=parents.get(node);
      return node;
    }
    return input.map(item=>{
      const {id,kind,a,b}=item||{};
      if(!validId(id)||ids.has(id)||!validId(a)||!validId(b)||a===b||!supports(kind,shapes.get(a),shapes.get(b)))throw new Error('Выберите два подходящих построения для связи.');
      if(mirrored.has(a)||mirrored.has(b))throw new Error('Эта связь доступна для построений без зеркальной пары.');
      const pair=[a,b].sort().join('/');
      if(!groups.has(pair)){
        const first=root(a),second=root(b);
        if(first===second)throw new Error('Связь замкнула бы цепочку. Сначала удалите одну из связей в цепочке.');
        parents.set(first,second);groups.set(pair,new Set());
      }
      if(groups.get(pair).has(kind))throw new Error('Между этими построениями уже есть такая связь.');
      groups.get(pair).add(kind);ids.add(id);return {id,kind,a,b};
    });
  }

  function tangent(base, other) {
    if(line(base)){
      const d=delta(base.b,base.a),size=len(d),u=unit(d),n=rotate(u);
      const v=delta(center(other),base.a),distance=Math.max(0,Math.min(size,dot(v,u)));
      const p=shift(shift(base.a,u,distance),n,other.r*(dot(v,n)<0?-1:1));
      return {...other,cx:p.x,cy:p.y};
    }
    const d=delta(other.b,other.a),size=len(d),u=unit(d),n=rotate(u);
    const v=delta(center(base),other.a),along=dot(v,u),away=dot(v,n);
    // Keep the direction and length of the line; translate until the foot is on the segment.
    const a=shift(shift(other.a,u,along-Math.max(0,Math.min(size,along))),n,away+(away<0?base.r:-base.r));
    return {...other,a,b:shift(a,u,size)};
  }
  function align(kinds, base, other) {
    if(kinds.includes('center'))return {...other,cx:base.cx,cy:base.cy};
    if(kinds.includes('tangent'))return tangent(base,other);
    const d=unit(delta(other.b,other.a)),source=delta(base.b,base.a);
    const n=rotate(unit(source));
    const u=kinds.includes('right')?(dot(n,d)<0?{x:-n.x,y:-n.y}:n):d;
    const size=kinds.includes('equal')?len(source):len(delta(other.b,other.a));
    const endJoined=[base.a,base.b].some(p=>len(delta(p,other.b))<EPS);
    const startJoined=[base.a,base.b].some(p=>len(delta(p,other.a))<EPS);
    return endJoined&&!startJoined?{...other,a:shift(other.b,u,-size)}:{...other,b:shift(other.a,u,size)};
  }
  function sameGeometry(a,b) {
    if(a.type==='line')return len(delta(a.a,b.a))<EPS&&len(delta(a.b,b.b))<EPS;
    return Math.hypot(a.cx-b.cx,a.cy-b.cy)<EPS&&Math.abs(a.r-b.r)<EPS;
  }
  function solve(strokes, relations, replacements, movable, preferredId) {
    if(!relations.length||!replacements.size)return replacements;
    const original=new Map(strokes.map(s=>[s.id,s]));
    const graph=new Map();
    for(const {kind,a,b} of relations){
      for(const [here,there] of [[a,b],[b,a]]){
        if(!graph.has(here))graph.set(here,new Map());
        const row=graph.get(here);
        if(!row.has(there))row.set(there,[]);
        row.get(there).push(kind);
      }
    }
    const done=new Set();
    const order=[...new Set([preferredId,...replacements.keys()])];
    for(const id of order){
      if(!id||done.has(id)||!graph.has(id))continue;
      const next=[id];done.add(id);
      for(const sourceId of next){
        const source=replacements.get(sourceId)||original.get(sourceId);
        for(const [targetId,kinds] of graph.get(sourceId)){
          if(done.has(targetId))continue;
          const prior=original.get(targetId), shape=replacements.get(targetId)||prior;
          if(!kinds.every(kind=>supports(kind,source,shape)))throw new Error('У связанного построения исчезла длина или радиус.');
          const result=align(kinds,source,shape);
          if(!(result.type==='line'?[result.a,result.b]:[center(result)]).every(inside))throw new Error('Связанное построение вышло за допустимые координаты.');
          if(!sameGeometry(prior,result)&&!movable(prior))throw new Error('Откройте и разблокируйте слой связанного построения.');
          if(!sameGeometry(prior,result))replacements.set(targetId,result);
          else replacements.delete(targetId);
          done.add(targetId);next.push(targetId);
        }
      }
    }
    return replacements;
  }

  const api=Object.freeze({types,limit,validate,supports,solve});
  global.LabDesignConstraints=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
