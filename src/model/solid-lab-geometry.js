/* Extra solid operations in the body's millimetre coordinates. */
(function (global) {
  'use strict';
  const EPS = 1e-6;
  const types = Object.freeze(['helical-spring','space-sweep','reinforcing-rib','dome','multi-shell','edge-round-variable']);
  const titles = Object.freeze({
    'helical-spring':'Винтовая пружина', 'space-sweep':'Вытянуть по 3D-пути',
    'reinforcing-rib':'Ребро жёсткости', dome:'Купол', 'multi-shell':'Оболочка с открытыми гранями',
    'edge-round-variable':'Переменное скругление'
  });
  const add = (a,b) => a.map((v,i)=>v+b[i]);
  const sub = (a,b) => a.map((v,i)=>v-b[i]);
  const scale = (a,k) => a.map(v=>v*k);
  const dot = (a,b) => a.reduce((sum,v,i)=>sum+v*b[i],0);
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const length = a => Math.hypot(...a);
  const midpoint = (a,b) => scale(add(a,b),.5);
  const pick = (v,a,b) => Number.isFinite(v)&&v>=a&&v<=b;
  const solid = () => global.LabSolid;
  const extrusion = () => global.LabExtrusion;

  function check(value,message) {
    if(!value)throw new Error(message);
  }
  function unit(v) {
    const l=length(v);
    check(l>EPS,'Укажите разные точки.');
    return scale(v,1/l);
  }
  function vector(value,dimensions=3) {
    check(Array.isArray(value)&&value.length===dimensions&&value.every(v=>pick(v,-10000,10000)), 'Проверьте координаты точек.');
    return value.slice();
  }
  function number(value,min,max,label) {
    check(pick(value,min,max),`${label} от ${min} до ${max}.`);
    return value;
  }
  function closed(mesh) {
    check(mesh?.stats.closed&&mesh.stats.signedVolumeMm3>EPS,'Операция не образует замкнутую деталь. Проверьте габариты.');
    return mesh;
  }
  function validate(input,feature) {
    switch(input.type){
      case 'helical-spring': {
        const diameter=number(input.diameter,2,300,'Диаметр осевой линии витка, мм');
        const wire=number(input.wire,.2,40,'Диаметр проволоки, мм');
        const pitch=number(input.pitch,.5,100,'Шаг витка, мм');
        const turns=number(input.turns,1,8,'Количество витков');
        check(wire<diameter/2&&pitch>=wire*1.2,'Уменьшите толщину проволоки или увеличьте диаметр и шаг витка.');
        check(Number.isInteger(turns*2),'Укажите целое число витков или половину витка.');
        return {...feature,diameter,wire,pitch,turns,leftHand:input.leftHand===true};
      }
      case 'space-sweep': {
        check(Array.isArray(input.path)&&input.path.length>=2&&input.path.length<=80,'Введите от 2 до 80 точек пути.');
        const path=input.path.map(p=>vector(p));
        check(path.slice(1).every((p,i)=>length(sub(p,path[i]))>.01),'Уберите совпадающие соседние точки.');
        return {...feature,path};
      }
      case 'reinforcing-rib': {
        const line=input.line;
        check(Array.isArray(line)&&line.length===2,'Укажите две точки оси ребра.');
        const [a,b]=line.map(point=>vector(point,2));
        check(length(sub(a,b))>=.5,'Длина оси ребра должна быть не менее 0,5 мм.');
        return {...feature,line:[a,b],width:number(input.width,.2,100,'Толщина ребра, мм'),height:number(input.height,.2,200,'Высота ребра, мм')};
      }
      case 'dome': return {...feature,height:number(input.height,.25,300,'Высота купола, мм')};
      case 'multi-shell': {
        const faces=input.faces;
        check(Array.isArray(faces)&&faces.length>=1&&faces.length<=5&&new Set(faces).size===faces.length&&
          faces.every(face=>Number.isInteger(face)&&face>=0&&face<6),'Выберите от одной до пяти граней.');
        return {...feature,faces:faces.slice().sort(),thickness:number(input.thickness,.1,50,'Толщина стенки, мм')};
      }
      case 'edge-round-variable': {
        check(Array.isArray(input.edge)&&input.edge.length===2,'Выберите наружное ребро.');
        const edge=input.edge.map(p=>vector(p));
        check(length(sub(...edge))>.05,'Ребро слишком короткое.');
        return {...feature,edge,radius:number(input.radius,.05,20,'Начальный радиус, мм'),radiusEnd:number(input.radiusEnd,.05,20,'Конечный радиус, мм')};
      }
      default: throw new Error('Неизвестная операция.');
    }
  }

  function springMesh(body,feature) {
    const center=midpoint(body.mesh.bounds.min,body.mesh.bounds.max);
    const [x,y]=center,r=feature.diameter/2,base=body.mesh.bounds.min[2]+feature.wire/2;
    const count=feature.turns*28;
    const direction=feature.leftHand?-1:1;
    const path=Array.from({length:count+1},(_,i)=>{
      const turn=i/28,a=direction*turn*2*Math.PI;
      return [x+r*Math.cos(a),y+r*Math.sin(a),base+turn*feature.pitch];
    });
    const profile=extrusion().analyze([{type:'circle',cx:0,cy:0,r:feature.wire*2}],{tolerance:.01});
    return closed(solid().sweep(profile,path));
  }

  function spaceSweep(body,feature) {
    check(body.mode==='extrude'&&!body.shell&&!body.fillet&&!body.mesh.stats.bevelMm&&body.mesh.contours?.length,
      'Для 3D-пути выберите простой вытянутый профиль.');
    const strokes=body.mesh.contours.map(({points})=>{
      const path=points.map(({x,y})=>({x:x*4,y:-y*4}));
      return {type:'path',points:[...path,path[0]]};
    });
    const profile=extrusion().analyze(strokes,{tolerance:.01});
    check(profile.ok,'Исходный профиль не замкнут.');
    return closed(solid().sweep(profile,feature.path.map(p=>add(p,body.offset))));
  }

  function rib(body,feature) {
    const z=body.mesh.bounds.max[2];
    const line=feature.line.map(([x,y])=>[x+body.offset[0],y+body.offset[1],z]);
    const axis=unit(sub(...line)),normal=[-axis[1],axis[0],0];
    const atSide=p=>sub(p,scale(normal,feature.width/2));
    const penetration=.2;
    const [a,b]=line.map(p=>atSide(add(p,[0,0,-penetration])));
    const peak=add(b,[0,0,feature.height+penetration]);
    const tool=solid().extrudeFace([a,b,peak,add(a,[0,0,penetration])],normal,feature.width);
    const contact=solid().boolean(body.mesh,tool,'intersect');
    check(contact.stats.volumeMm3>EPS,'Ребро должно пересекать верхнюю грань выбранной детали.');
    const mesh=closed(solid().boolean(body.mesh,tool,'union'));
    check(mesh.stats.components===(body.mesh.stats.components??1)&&mesh.stats.volumeMm3>body.mesh.stats.volumeMm3+EPS,
      'Ребро должно соединяться с цельной деталью.');
    return mesh;
  }

  function dome(body,feature) {
    const {mesh}=body;
    check(body.mode==='extrude'&&!body.shell&&!body.fillet&&!mesh.stats.bevelMm&&mesh.contours?.length===1,
      'Для купола нужен прямой вытянутый выпуклый профиль без отверстий, фасок и скруглений.');
    // Align the new rim with the old Float32 cap seam, including translated rings.
    const ring=mesh.contours[0].points.map(({x,y})=>[x,y].map((v,i)=>Math.fround(Math.fround(v-body.offset[i])+body.offset[i])));
    const convex=ring.every((a,i)=>{
      const b=ring[(i+1)%ring.length],c=ring[(i+2)%ring.length];
      return cross([...sub(b,a),0],[...sub(c,b),0])[2]>=-EPS;
    });
    check(convex,'Для купола выберите выпуклый исходный контур.');
    const out=solid().createMeshBuilder(),z=mesh.bounds.max[2];
    for(let i=0;i<mesh.positions.length;i+=9){
      const points=[0,3,6].map(j=>Array.from(mesh.positions.subarray(i+j,i+j+3)));
      if(points.every(p=>Math.abs(p[2]-z)<EPS))continue;
      out.triangle(...points,mesh.contourIds[i/9],mesh.surfaceTypes[i/9]);
    }
    const origin=scale(ring.reduce(add),1/ring.length),steps=12;
    const layer=i=>{
      const angle=i/steps*Math.PI/2;
      return ring.map(p=>[...add(origin,scale(sub(p,origin),Math.cos(angle))),z+feature.height*Math.sin(angle)]);
    };
    let previous=layer(0);
    for(let i=1;i<steps;i++){
      const next=layer(i);
      previous.forEach((p,j)=>out.quad(p,previous[(j+1)%ring.length],next[(j+1)%ring.length],next[j],-1,3));
      previous=next;
    }
    const peak=[...origin,z+feature.height];
    previous.forEach((p,j)=>out.triangle(p,previous[(j+1)%ring.length],peak,-1,3));
    return closed(out.finish());
  }

  function boxShell(body,feature) {
    const {mesh}=body,{min,max}=mesh.bounds;
    const size=sub(max,min),volume=size.reduce((product,v)=>product*v,1);
    check(mesh.stats.closed!==false&&(mesh.stats.components??1)===1&&Math.abs(volume-mesh.stats.volumeMm3)<Math.max(1e-5,volume*1e-6),
      'Открытие нескольких граней поддерживает прямоугольный параллелепипед.');
    const faces=new Set(feature.faces),t=feature.thickness;
    const low=min.map((v,i)=>v+(faces.has(2*i)?-.02:t));
    const high=max.map((v,i)=>v+(faces.has(2*i+1)?.02:-t));
    check(low.every((v,i)=>v<high[i]-.05),'Толщина слишком велика для полости.');
    const [x,y,z]=low,[u,v,w]=high;
    const tool=solid().extrudeFace([[x,y,z],[u,y,z],[u,v,z],[x,v,z]],[0,0,1],w-z);
    return closed(solid().boolean(mesh,tool,'subtract'));
  }

  function apply(body,feature){
    switch(feature.type){
      case 'helical-spring':return springMesh(body,feature);
      case 'space-sweep':return spaceSweep(body,feature);
      case 'reinforcing-rib':return rib(body,feature);
      case 'dome':return dome(body,feature);
      case 'multi-shell':return boxShell(body,feature);
      default:throw new Error('Неизвестная операция.');
    }
  }
  function pointRows(source){
    const rows=String(source).trim().split(/\r?\n/).filter(line=>line.trim());
    check(rows.length>=2&&rows.length<=80,'Укажите от 2 до 80 строк координат.');
    return rows.map((line,i)=>{
      const parts=line.trim().split(/\s*;\s*|\s+/);
      check(parts.length===3&&parts.every(part=>/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(part)),`Строка ${i+1} должна содержать три координаты X Y Z.`);
      return vector(parts.map(v=>Number(v.replace(',','.'))));
    });
  }
  function planeProfile(vertices,width,height,reverse=false){
    const [a,b,c]=vertices.map(v=>vector(v));
    const along=sub(b,a),toward=sub(c,a),u=unit(along),side=cross(u,toward);
    check(length(side)>.0001,'Три точки должны лежать вне одной прямой.');
    const normal=scale(unit(side),reverse?-1:1),v=cross(normal,u);
    const origin=scale(add(add(a,b),c),1/3);
    const points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([i,j])=>add(add(origin,scale(u,i*width/2)),scale(v,j*height/2)));
    return {origin,normal,u,points};
  }
  function familyRows(source,knownVariables){
    const rows=String(source).trim().split(/\r?\n/).filter(line=>line.trim()).map(line=>line.split(';').map(s=>s.trim()));
    check(rows.length>=2&&rows.length<=13,'Добавьте заголовок и от 1 до 12 строк вариантов.');
    const columns=rows.shift().slice(1).map(name=>name.toLowerCase());
    check(columns.length&&new Set(columns).size===columns.length&&columns.every(name=>name==='@height'||knownVariables.includes(name)),
      'Заголовок должен содержать имя и существующие параметры или @height.');
    return rows.map((row,i)=>{
      const [name,...cells]=row;
      check(name&&name.length<=48&&cells.length===columns.length&&cells.every(Boolean),`Заполните все столбцы строки ${i+2}.`);
      return {name,values:Object.fromEntries(columns.map((column,j)=>[column,cells[j]]))};
    });
  }
  const api=Object.freeze({types,titles,validate,apply,pointRows,planeProfile,familyRows});
  global.LabSolidLabGeometry=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
