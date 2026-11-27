/* Exact sketch commands, project dimensions and constraint diagnostics. */
(function (global) {
  'use strict';
  const MM=4, EPS=1e-7, TAU=Math.PI*2, namePattern=/^[\p{L}][\p{L}\p{N}_]{0,23}$/u;
  const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
  const add=(a,b,t=1)=>({x:a.x+b.x*t,y:a.y+b.y*t});
  const length=p=>Math.hypot(p.x,p.y);
  const cross=(a,b)=>a.x*b.y-a.y*b.x;
  const dot=(a,b)=>a.x*b.x+a.y*b.y;
  const distance=(a,b)=>length(sub(a,b));
  const norm=a=>(a%TAU+TAU)%TAU;
  const checkedPoint=p=>{
    if(!p||![p.x,p.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=100000))throw new Error('Координаты выходят за допустимые пределы.');
    return {x:p.x,y:p.y};
  };
  const formula=value=>{
    if(typeof value!=='string'||!value.trim()||value.length>100)throw new Error('Введите размер или формулу длиной до 100 знаков.');
    return value.trim();
  };
  function calculate(source,lookup){
    const tokens=formula(source).match(/(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:e[+-]?\d+)?|[\p{L}][\p{L}\p{N}_]*|\S/giu)||[];
    let index=0;
    function take(token){if(tokens[index]!==token)return false;index++;return true;}
    function atom(){
      if(take('(')){const value=expression();if(!take(')'))throw new Error('Закройте скобку в формуле.');return value;}
      const token=tokens[index++];
      if(token===undefined)throw new Error('Формула заканчивается раньше, чем ожидалось.');
      if(/^(?:\d|[.,]\d)/u.test(token))return Number(token.replace(',','.'));
      if(!namePattern.test(token))throw new Error('Ожидалось число или имя параметра.');
      const name=token.toLowerCase();
      if(name==='pi'||name==='π')return Math.PI;
      return lookup(name);
    }
    function power(){
      if(take('+'))return power();
      if(take('-')||take('−'))return -power();
      const value=atom();
      return take('^')?value**power():value;
    }
    function product(){
      let value=power();
      while(index<tokens.length){
        if(take('*')||take('×'))value*=power();
        else if(take('/')||take('÷'))value/=power();
        else break;
      }
      return value;
    }
    function expression(){
      let value=product();
      while(index<tokens.length){
        if(take('+'))value+=product();
        else if(take('-')||take('−'))value-=product();
        else break;
      }
      return value;
    }
    const result=expression();
    if(index!==tokens.length||!Number.isFinite(result))throw new Error('Проверьте формулу. Результат должен быть конечным числом.');
    return result;
  }
  function settings(source){
    if(source===undefined||source===null)return {variables:[],height:''};
    if(!Array.isArray(source.variables)||source.variables.length>24)throw new Error('Допускается до 24 параметров проекта.');
    const names=new Set();
    const variables=source.variables.map(row=>{
      const name=typeof row?.name==='string'?row.name.trim().toLowerCase():'';
      if(!namePattern.test(name)||name==='pi'||name==='π'||names.has(name))throw new Error('Имена параметров должны быть уникальными и начинаться с буквы.');
      names.add(name);
      return {name,formula:formula(row.formula)};
    });
    const height=source.height?formula(source.height):'';
    const next={variables,height};
    const values=parameterValues(next);
    if(height){const v=read(height,values);if(v<1||v>200)throw new Error('Высота модели по формуле должна быть от 1 до 200 мм.');}
    return next;
  }
  function parameterValues(source){
    const formulas=new Map(source.variables.map(row=>[row.name,row.formula]));
    const values=new Map(), visiting=new Set();
    const get=name=>{
      if(values.has(name))return values.get(name);
      if(!formulas.has(name))throw new Error(`Неизвестный параметр «${name}».`);
      if(visiting.has(name))throw new Error(`Циклическая ссылка на параметр «${name}».`);
      visiting.add(name);
      try{const value=calculate(formulas.get(name),get);values.set(name,value);return value;}
      finally{visiting.delete(name);}
    };
    for(const name of formulas.keys())get(name);
    return values;
  }
  function read(source,values){
    return calculate(source,name=>{
      if(!values.has(name))throw new Error(`Неизвестный параметр «${name}».`);
      return values.get(name);
    });
  }
  function positive(value,label){
    if(!Number.isFinite(value)||value<.01||value>1000)throw new Error(`${label} должен быть от 0,01 до 1000 мм.`);
    return value*MM;
  }
  function definition(source){
    if(!source||typeof source!=='object')throw new Error('Некорректные параметры построения.');
    if(source.kind==='rectangle')return {kind:source.kind,start:checkedPoint(source.start),center:source.center===true,width:formula(source.width),height:formula(source.height)};
    if(source.kind==='polar')return {kind:source.kind,start:checkedPoint(source.start),length:formula(source.length),angle:formula(source.angle)};
    if((source.kind==='ellipse'||source.kind==='spline')&&Array.isArray(source.controls)&&source.controls.length===(source.kind==='ellipse'?3:4)){
      return {kind:source.kind,controls:source.controls.map(checkedPoint)};
    }
    throw new Error('Неизвестная форма построения.');
  }
  function fromDefinition(raw,values){
    if(['linear-division','linked-block'].includes(raw?.kind)){
      const extra=global.LabSketchExtra||(typeof require==='function'&&require('./sketch-tools-extra.js'));
      return extra.fromDefinition(raw);
    }
    const def=definition(raw);
    if(def.kind==='rectangle'){
      const w=positive(read(def.width,values),'Ширина'),h=positive(read(def.height,values),'Высота');
      const x=def.start.x-(def.center?w/2:0),y=def.start.y-(def.center?h/2:0);
      const first={x,y};
      return {type:'path',points:[first,{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h},first].map(checkedPoint),sketchDefinition:def};
    }
    if(def.kind==='polar'){
      const angle=read(def.angle,values)*Math.PI/180;
      const size=positive(read(def.length,values),'Длина');
      return {type:'line',a:def.start,b:checkedPoint(add(def.start,{x:Math.cos(angle),y:Math.sin(angle)},size)),sketchDefinition:def};
    }
    const [a,b,c,d]=def.controls;
    let points;
    if(def.kind==='ellipse'){
      const u=sub(b,a),v=sub(c,a);
      if(length(u)<.04||length(v)<.04||Math.abs(cross(u,v))<.02*length(u)*length(v))throw new Error('Укажите два независимых направления от центра эллипса.');
      points=Array.from({length:97},(_,i)=>{
        const t=i/96*TAU;
        return checkedPoint(add(add(a,u,Math.cos(t)),v,Math.sin(t)));
      });
      points[points.length-1]=points[0];
    }else{
      if(Math.max(distance(a,b),distance(a,c),distance(a,d))<.04)throw new Error('Раздвиньте управляющие точки кривой.');
      points=Array.from({length:65},(_,i)=>{
        const t=i/64,q=1-t;
        return checkedPoint({x:q**3*a.x+3*q*q*t*b.x+3*q*t*t*c.x+t**3*d.x,y:q**3*a.y+3*q*q*t*b.y+3*q*t*t*c.y+t**3*d.y});
      });
    }
    return {type:'path',points,sketchDefinition:def};
  }
  function arc(a,b,c){
    const u=sub(b,a),v=sub(c,a),divisor=2*cross(u,v);
    if(length(u)<.04||length(v)<.04||distance(b,c)<.04||Math.abs(divisor)<EPS*length(u)*length(v))throw new Error('Укажите три различные точки, которые не лежат на одной прямой.');
    const center=checkedPoint(add(a,{x:(dot(u,u)*v.y-dot(v,v)*u.y)/divisor,y:(dot(v,v)*u.x-dot(u,u)*v.x)/divisor}));
    const r=distance(center,a);
    if(r>2000||r<.02)throw new Error('Радиус дуги выходит за рабочий диапазон.');
    const angle=p=>Math.atan2(p.y-center.y,p.x-center.x);
    const start=angle(a),span=norm(angle(c)-start),middle=norm(angle(b)-start);
    return {type:'arc',cx:center.x,cy:center.y,r,start:start*180/Math.PI,delta:(middle<span?span:span-TAU)*180/Math.PI};
  }
  function intersect(a,u,b,v){
    const divisor=cross(u,v);
    if(Math.abs(divisor)<EPS*length(u)*length(v))throw new Error('У параллельных отрезков нет единственного пересечения.');
    return add(a,u,cross(sub(b,a),v)/divisor);
  }
  function trim(line,reference,end){
    const p=checkedPoint(intersect(line.a,sub(line.b,line.a),reference.a,sub(reference.b,reference.a)));
    if(distance(p,line[end==='a'?'b':'a'])<.04)throw new Error('После операции у отрезка должна остаться длина.');
    return {...line,[end]:p,sketchDefinition:undefined};
  }
  function fillet(first,second,radius){
    const near=(line,p)=>distance(line.a,p)<distance(line.b,p)?'a':'b';
    const vertex=checkedPoint(intersect(first.a,sub(first.b,first.a),second.a,sub(second.b,second.a)));
    const ends=[near(first,vertex),near(second,vertex)];
    const [p,q]=[first,second].map((line,i)=>line[ends[i]==='a'?'b':'a']);
    const vectors=[p,q].map(point=>{const v=sub(point,vertex),n=length(v);if(n<.04)throw new Error('Выберите отрезки с разными концами.');return {x:v.x/n,y:v.y/n};});
    const [u,v]=vectors;
    const half=Math.acos(Math.max(-1,Math.min(1,dot(u,v))))/2;
    const run=radius/Math.tan(half),bisector=add(u,v),shift=radius/(Math.sin(half)*length(bisector));
    if(run+.04>=Math.min(distance(p,vertex),distance(q,vertex)))throw new Error('Радиус слишком велик для этих отрезков.');
    const a=checkedPoint(add(vertex,u,run)), c=checkedPoint(add(vertex,v,run)), center=checkedPoint(add(vertex,bisector,shift));
    const m=sub(vertex,center);
    const b=add(center,m,radius/length(m));
    return {replace:[{...first,[ends[0]]:a,sketchDefinition:undefined},{...second,[ends[1]]:c,sketchDefinition:undefined}],shape:arc(a,b,c)};
  }
  function offset(stroke,millimetres){
    const amount=millimetres*MM;
    if(!Number.isFinite(amount)||Math.abs(amount)<.04||Math.abs(amount)>4000)throw new Error('Задайте смещение от 0,01 до 1000 мм по модулю.');
    if(stroke.type==='arc'||stroke.type==='circle'){
      const r=stroke.r+amount;
      if(r<.02||r>2000)throw new Error('Радиус нового построения выходит за рабочий диапазон.');
      return {...stroke,r};
    }
    const pts=stroke.type==='line'?[stroke.a,stroke.b]:stroke.points;
    if(pts.length<2||pts.length>800)throw new Error('Выберите отрезок или ломаную длиной до 800 точек.');
    const closed=distance(pts[0],pts.at(-1))<EPS, points=closed?pts.slice(0,-1):pts;
    if(closed&&points.length<3)throw new Error('У замкнутого контура должно быть не менее трёх вершин.');
    const edges=points.slice(0,closed?points.length:-1).map((a,i)=>{
      const b=points[(i+1)%points.length],d=sub(b,a),size=length(d);
      if(size<.001)throw new Error('В контуре есть совпадающие соседние точки.');
      const n={x:d.y/size,y:-d.x/size};
      return {a:add(a,n,amount),b:add(b,n,amount),d};
    });
    const shifted=points.map((point,i)=>{
      const before=i?edges[i-1]:closed?edges.at(-1):null, after=edges[i];
      if(!before)return checkedPoint(after.a);
      if(!after)return checkedPoint(before.b);
      if(distance(before.b,after.a)<EPS)return checkedPoint(after.a);
      const miter=checkedPoint(intersect(before.a,before.d,after.a,after.d));
      if(distance(miter,point)>Math.abs(amount)*16)throw new Error('На остром углу смещение слишком велико. Уменьшите значение.');
      return miter;
    });
    if(closed){
      const edges=points.map((p,i)=>sub(points[(i+1)%points.length],p));
      if(shifted.some((p,i)=>dot(sub(shifted[(i+1)%shifted.length],p),edges[i])<=EPS))throw new Error('Смещение сворачивает контур. Уменьшите значение.');
      shifted.push(shifted[0]);
      if(selfCrosses(shifted))throw new Error('Смещённый контур пересекает сам себя. Уменьшите значение.');
    }
    return stroke.type==='line'?{type:'line',a:shifted[0],b:shifted[1]}:{type:'path',points:shifted};
  }
  function selfCrosses(points){
    for(let i=0;i<points.length-1;i++){
      const a=points[i],u=sub(points[i+1],a);
      for(let j=i+2;j<points.length-1;j++){
        if(i===0&&j===points.length-2)continue;
        const b=points[j],v=sub(points[j+1],b),start=sub(b,a),divisor=cross(u,v);
        if(Math.abs(divisor)<EPS*length(u)*length(v)){
          if(Math.abs(cross(start,u))>EPS*length(u))continue;
          const positions=[start,add(start,v)].map(d=>dot(d,u)/dot(u,u));
          if(Math.max(...positions)>=0&&Math.min(...positions)<=1)return true;
        }else{
          const t=cross(start,v)/divisor,q=cross(start,u)/divisor;
          if(t>=-EPS&&t<=1+EPS&&q>=-EPS&&q<=1+EPS)return true;
        }
      }
    }
    return false;
  }
  function constraintReport(strokes,relations,movable,solve=Boolean(movable)){
    const shapes=new Map(strokes.map(shape=>[shape.id,shape]));
    const links=relations.filter(relation=>shapes.has(relation.a)&&shapes.has(relation.b));
    const shapesWithLinks=new Set(links.flatMap(link=>[link.a,link.b]));
    const linked=[...shapesWithLinks].map(id=>shapes.get(id));
    const fields=shape=>shape.type==='line'?['a.x','a.y','b.x','b.y']:['cx','cy','r'];
    const data=linked.map(shape=>Object.fromEntries(fields(shape).map(key=>{
      const [first,second]=key.split('.');
      return [key,second?shape[first][second]:shape[first]];
    })));
    const variables=data.flatMap((shape,index)=>!movable||movable(linked[index])?Object.keys(shape).map(key=>({index,key})):[]);
    const indices=new Map(linked.map((shape,index)=>[shape.id,index]));
    function residual(link){
      const a=data[indices.get(link.a)],b=data[indices.get(link.b)];
      const delta=s=>({x:s['b.x']-s['a.x'],y:s['b.y']-s['a.y']});
      if(link.kind==='center')return [a.cx-b.cx,a.cy-b.cy];
      if(link.kind==='equal')return [length(delta(a))-length(delta(b))];
      if(link.kind==='right')return [dot(delta(a),delta(b))/Math.max(EPS,length(delta(a)),length(delta(b)))];
      const line=a.cx===undefined?a:b,circle=a.cx===undefined?b:a;
      const anchor={x:line['a.x'],y:line['a.y']},d=delta(line),v=sub({x:circle.cx,y:circle.cy},anchor);
      const foot=Math.max(0,Math.min(1,dot(v,d)/Math.max(EPS,dot(d,d))));
      return [distance(v,add({x:0,y:0},d,foot))-circle.r];
    }
    const values=links.map(residual);
    function jacobian(equations,vector){
      const rows=vector.map(()=>[]);
      for(const {index,key} of variables){
        const prior=data[index][key];
        data[index][key]=prior+.001;
        const upper=equations();
        data[index][key]=prior-.001;
        equations().forEach((value,row)=>rows[row].push((upper[row]-value)/.002));
        data[index][key]=prior;
      }
      return rows;
    }
    if(solve){
      // Coincident endpoints stay together, even if only one belongs to an explicit link.
      const joints=[];
      const points=new Map();
      for(const shape of strokes){
        if(shape.type!=='line'&&shape.type!=='path')continue;
        const ends=shape.type==='line'?[shape.a,shape.b]:[shape.points[0],shape.points.at(-1)];
        ends.forEach((p,index)=>{
          const key=`${Math.round(p.x*200)},${Math.round(p.y*200)}`;
          if(!points.has(key))points.set(key,[]);
          const found=indices.get(shape.id),fields=index===0?['a.x','a.y']:['b.x','b.y'];
          const dynamic=found!==undefined&&shape.type==='line';
          points.get(key).push({read:dynamic?()=>fields.map(field=>data[found][field]):()=>[p.x,p.y],active:dynamic&&movable(shape)});
        });
      }
      for(const group of points.values())if(group.length>1&&group.some(point=>point.active)){
        const [base,...neighbors]=group;
        for(const point of neighbors)if(base.active||point.active){
          const original=point.read().map((value,i)=>value-base.read()[i]);
          joints.push(()=>point.read().map((value,i)=>value-base.read()[i]-original[i]));
        }
      }
      const equations=()=>[...links.flatMap(residual),...joints.flatMap(row=>row())];
      let vector=equations();
      if(vector.every(value=>Math.abs(value)<=.005))return [];
      if(!variables.length||vector.length>260)throw new Error('Разблокируйте связанные слои или уменьшите число связанных построений.');
      for(let i=0;i<18&&vector.some(value=>Math.abs(value)>.005);i++){
        const rows=jacobian(equations,vector),gram=rows.map((row,r)=>[
          ...rows.map((column,c)=>row.reduce((sum,value,j)=>sum+value*column[j],r===c?1e-5:0)),
          -vector[r]
        ]);
        const multipliers=eliminate(gram);
        const movement=variables.map((_,column)=>rows.reduce((sum,row,r)=>sum+row[column]*multipliers[r],0));
        const old=variables.map(({index,key})=>data[index][key]);
        const error=Math.hypot(...vector);
        for(const step of [1,.5,.25,.125,.0625]){
          variables.forEach(({index,key},j)=>{data[index][key]=old[j]+step*movement[j];});
          const after=equations();
          if(Math.hypot(...after)<error){vector=after;break;}
          variables.forEach(({index,key},j)=>{data[index][key]=old[j];});
        }
      }
      if(vector.some(value=>Math.abs(value)>.005))throw new Error('Связи не сошлись. Проверьте форму построений и блокировку слоёв.');
      return linked.flatMap((shape,i)=>{
        if(!movable(shape))return [];
        const row=data[i];
        if(shape.type==='line'){
          const a=checkedPoint({x:row['a.x'],y:row['a.y']}),b=checkedPoint({x:row['b.x'],y:row['b.y']});
          if(distance(a,b)<.04)throw new Error('Связи сводят отрезок к точке.');
          return distance(a,shape.a)+distance(b,shape.b)>EPS?[{...shape,a,b}]:[];
        }
        if(row.r<.02||row.r>2000)throw new Error('Радиус выходит за рабочий диапазон.');
        const center=checkedPoint({x:row.cx,y:row.cy});
        return distance(center,{x:shape.cx,y:shape.cy})+Math.abs(row.r-shape.r)>EPS?
          [{...shape,cx:row.cx,cy:row.cy,r:row.r}]:[];
      });
    }
    const vector=values.flat();
    const rows=jacobian(()=>links.flatMap(residual),vector);
    const basis=[];
    const redundant=[],unmet=[];
    let offset=0;
    links.forEach((link,i)=>{
      if(values[i].some(value=>Math.abs(value)>.01))unmet.push(link.id);
      let additions=0;
      for(let j=0;j<values[i].length;j++){
        const row=rows[offset++];
        for(const base of basis){
          const projection=row.reduce((sum,value,k)=>sum+value*base[k],0);
          row.forEach((value,k)=>{row[k]=value-projection*base[k];});
        }
        const magnitude=Math.hypot(...row);
        if(magnitude>1e-5){basis.push(row.map(value=>value/magnitude));additions++;}
      }
      if(!additions)redundant.push(link.id);
    });
    const free=new Map(linked.map(shape=>[shape.id,new Set()]));
    variables.forEach(({index,key},i)=>{
      if(1-basis.reduce((sum,row)=>sum+row[i]**2,0)<1e-4)return;
      free.get(linked[index].id).add(key.startsWith('a.')?'начало':key.startsWith('b.')?'конец':key==='r'?'радиус':'центр');
    });
    return {freedom:variables.length-basis.length,related:linked.length,rank:basis.length,redundant,unmet,free};
  }
  function eliminate(matrix){
    const size=matrix.length;
    for(let column=0;column<size;column++){
      let pivot=column;
      for(let r=column+1;r<size;r++)if(Math.abs(matrix[r][column])>Math.abs(matrix[pivot][column]))pivot=r;
      [matrix[pivot],matrix[column]]=[matrix[column],matrix[pivot]];
      const divisor=matrix[column][column];
      for(let c=column;c<=size;c++)matrix[column][c]/=divisor;
      for(let r=column+1;r<size;r++){
        const amount=matrix[r][column];
        for(let c=column;c<=size;c++)matrix[r][c]-=amount*matrix[column][c];
      }
    }
    const solution=Array(size);
    for(let i=size-1;i>=0;i--)solution[i]=matrix[i].slice(i+1,size).reduce((value,term,j)=>value-term*solution[i+j+1],matrix[i][size]);
    return solution;
  }
  const api=Object.freeze({settings,parameterValues,read,fromDefinition,arc,trim,fillet,offset,constraintReport});
  global.LabSketchUpgrade=api;
  if(typeof module!=='undefined'&&module.exports){module.exports=api;return;}
  document.addEventListener('DOMContentLoaded',()=>install(global.LabApp),{once:true});

  function install(app){
    if(!app?.applySketchUpgrade)return;
    const $=id=>document.getElementById(id);
    const node=(tag,text='')=>Object.assign(document.createElement(tag),{textContent:text});
    const dialog=node('dialog');
    dialog.id='sketch-upgrade-dialog';
    dialog.className='action-dialog';
    dialog.setAttribute('aria-labelledby','sketch-upgrade-title');
    const heading=node('h2','Точное черчение');
    heading.id='sketch-upgrade-title';
    const close=node('button','×');
    close.className='dialog-close icon-button';close.type='button';close.setAttribute('aria-label','Закрыть');
    close.addEventListener('click',()=>dialog.close());
    const mode=node('select');
    mode.id='sketch-upgrade-mode';
    mode.setAttribute('aria-label','Операция эскиза');
    const form=node('form'), fields=node('div'), actions=node('div'), status=node('p');
    fields.className='sketch-upgrade-fields';actions.className='sketch-upgrade-actions';
    status.setAttribute('role','status');
    const choose=node('button','Точки на листе');choose.type='button';
    const handles=node('button','Перетащить точки');handles.type='button';handles.hidden=true;
    const apply=node('button','Применить');apply.type='submit';apply.className='primary-button';apply.id='sketch-upgrade-apply';
    actions.append(choose,handles,apply);form.append(fields,actions,status);dialog.append(close,heading,mode,form);document.body.append(dialog);
    const overlay=document.createElementNS('http://www.w3.org/2000/svg','g');
    overlay.id='sketch-upgrade-handles';overlay.setAttribute('aria-hidden','true');$('paper').append(overlay);
    const floating=node('div'),finish=node('button','Применить'),discard=node('button','Отмена');
    floating.className='sketch-upgrade-floating glass';floating.hidden=true;
    finish.className='primary-button';finish.type='button';discard.type='button';
    floating.append(node('strong','Управляющие точки'),discard,finish);document.body.append(floating);
    const menuButton=node('button','Точное черчение');menuButton.id='sketch-upgrade-launch';menuButton.type='button';
    $('workshop-launch').before(menuButton);
    const rail=$('tool-palette');
    const railButton=node('button');railButton.className='tool-button';railButton.type='button';
    railButton.innerHTML='<svg aria-hidden="true"><use href="#i-contour"/></svg><span>Точные формы</span>';
    rail.querySelector('.rail-bottom')?.before(railButton);
    const modes={
      rectangle:'Прямоугольник',arc:'Дуга через три точки',ellipse:'Эллипс',spline:'Сплайн',
      trim:'Обрезать или продлить отрезок',offset:'Сместить контур',fillet:'Сопрячь отрезки',
      construction:'Вспомогательные линии',polar:'Отрезок по длине и углу',report:'Свобода эскиза',
      parameters:'Параметры проекта'
    };
    Object.entries(modes).forEach(([value,text])=>mode.add(new Option(text,value)));
    let inputs={},pick=null,drag=null;
    const controlsOf={rectangle:1,polar:1,arc:3,ellipse:3,spline:4};
    const fmt=n=>String(Number(n.toFixed(4))).replace('.',',');
    function field(key,label,value,type='text',options={}){
      const row=node('label'), input=node(type==='textarea'?'textarea':type==='select'?'select':'input');
      row.append(node('span',label),input);
      if(type==='select'){for(const [value,text] of options.items||[])input.add(new Option(text,value));}
      else if(type!=='textarea'){input.type=type;if(type==='text')input.spellcheck=false;}
      if(type==='checkbox')input.checked=Boolean(value);else input.value=value??'';
      if(options.placeholder)input.placeholder=options.placeholder;
      input.id=`sketch-upgrade-${key}`;fields.append(row);inputs[key]=input;
      return input;
    }
    function pointFields(labels,points){
      labels.forEach((label,i)=>{
        const p=points[i]||{x:100+i*80,y:100+i*60};
        field(`x${i}`,`${label} · X, мм`,fmt(p.x/MM));
        field(`y${i}`,`${label} · Y, мм`,fmt(p.y/MM));
      });
    }
    function describe(shape,index){
      const types={line:'Отрезок',arc:'Дуга',circle:'Окружность',path:'Ломаная'};
      const start=shape.type==='line'?shape.a:shape.type==='path'?shape.points[0]:{x:shape.cx,y:shape.cy};
      return `${index+1}. ${types[shape.type]} · ${fmt(start.x/MM)}, ${fmt(start.y/MM)} мм${shape.construction?' · вспом.' : ''}`;
    }
    function list(key,label,shapes,none=false){
      const items=[...(none?[['','Новое построение']]:[]),...shapes.map((shape,index)=>[shape.id,describe(shape,index)])];
      return field(key,label,items[0]?.[0]??'','select',{items});
    }
    function picked(id){return app.getSketchShape(inputs[id].value);}
    function freeShapes(strokes,layers){
      const lockedLayers=new Set(layers.filter(layer=>layer.locked).map(layer=>layer.id));
      const mirrors=new Set(strokes.filter(shape=>shape.mirrorOf).flatMap(shape=>[shape.id,shape.mirrorOf]));
      return shape=>!mirrors.has(shape.id)&&!shape.sketchDefinition&&!lockedLayers.has(shape.layer);
    }
    function render(){
      fields.replaceChildren();inputs={};status.textContent='';
      const kind=mode.value, state=app.getState();
      const shapes=app.getVisibleStrokes().filter(shape=>!state.layers.find(layer=>layer.id===shape.layer)?.locked);
      const lines=shapes.filter(shape=>shape.type==='line');
      choose.hidden=!(kind in controlsOf);handles.hidden=true;apply.hidden=false;apply.disabled=false;apply.textContent='Применить';
      if(kind==='rectangle'){
        pointFields(['Начало'],[{x:200,y:180}]);
        field('width','Ширина или формула','60');
        field('height','Высота или формула','40');
        field('center','От центра',false,'checkbox');
      }else if(kind==='polar'){
        pointFields(['Начало'],[{x:200,y:180}]);
        field('length','Длина или формула','50');
        field('angle','Угол в градусах по часовой стрелке','30');
      }else if(kind==='arc')pointFields(['Начало','Точка на дуге','Конец'],[{x:200,y:300},{x:300,y:200},{x:400,y:300}]);
      else if(kind==='ellipse'||kind==='spline'){
        const labels=kind==='ellipse'?['Центр','Первая полуось','Вторая полуось']:['Начало','Направление от начала','Направление к концу','Конец'];
        const defaults=kind==='ellipse'?[{x:350,y:270},{x:470,y:270},{x:350,y:345}]:[{x:160,y:360},{x:220,y:100},{x:410,y:100},{x:480,y:360}];
        const select=list('curve','Изменить форму',shapes.filter(shape=>shape.sketchDefinition?.kind===kind),true);
        const update=()=>{
          fields.querySelectorAll('label').forEach(label=>{if(!label.contains(select))label.remove();});
          const selected=picked('curve');
          pointFields(labels,selected?.sketchDefinition?.controls||defaults);
          handles.hidden=!selected||Boolean(selected.mirrorOf);
        };
        select.addEventListener('change',update);update();
      }else if(kind==='trim'||kind==='fillet'){
        list('first','Первый отрезок',lines);
        const second=list('second','Второй отрезок',lines);second.selectedIndex=lines.length>1?1:0;
        if(kind==='trim')field('end','Конец первого отрезка','b','select',{items:[['a','Начальная точка'],['b','Конечная точка']]});
        else field('radius','Радиус, мм','5');
        apply.disabled=lines.length<2;
      }else if(kind==='offset'){
        list('first','Исходное построение',shapes);
        field('distance','Смещение, мм','5');
        status.textContent='Для окружности положительное число увеличивает радиус. Для ломаной знак задаёт сторону относительно направления её точек.';
        apply.disabled=!shapes.length;
      }else if(kind==='construction'){
        list('first','Построение на листе',shapes);
        const enabled=field('enabled','Вспомогательное построение',!shapes[0]?.construction,'checkbox');
        inputs.first.addEventListener('change',()=>{enabled.checked=!picked('first')?.construction;});
        apply.disabled=!shapes.length;
      }else if(kind==='parameters'){
        const project=state.sketchUpgrade||settings();
        field('variables','Параметры по одному в строке',project.variables.map(row=>`${row.name} = ${row.formula}`).join('\n'),'textarea',{placeholder:'стенка = 3\nширина = 20 * стенка'});
        field('height','Формула высоты детали, мм',project.height,'text',{placeholder:'2 * стенка'});
        status.textContent='Имена можно использовать вместо размеров прямоугольника и отрезка. При правке параметров эти построения пересчитываются.';
      }else{
        const related=app.getConstraints(), visible=app.getVisibleStrokes();
        const result=constraintReport(visible,related,freeShapes(visible,state.layers),false);
        apply.hidden=!result.unmet.length;apply.textContent='Уточнить связи';
        fields.append(node('p',result.related?`Связанных построений: ${result.related}. Степеней свободы в приближении: ${result.freedom}.`:'Добавьте связи через «Мастерская → Связи эскиза».'));
        const problemIds=[...new Set([...result.unmet,...result.redundant])];
        if(problemIds.length){
          const list=node('ul');
          const ids=new Map(visible.map((shape,index)=>[shape.id,index+1]));
          related.filter(link=>problemIds.includes(link.id)).forEach(link=>{
            const type={equal:'Равная длина',right:'Перпендикулярность',tangent:'Касание',center:'Общий центр'};
            list.append(node('li',`${type[link.kind]} · № ${ids.get(link.a)} и № ${ids.get(link.b)} · ${result.unmet.includes(link.id)?'проверьте геометрию':'избыточная связь'}`));
          });
          fields.append(list);
        }
        if(result.related){
          const details=node('details'),list=node('ul');
          details.append(node('summary','Точки и размеры с оставшейся свободой'));
          visible.forEach((shape,index)=>{
            const names=result.free.get(shape.id);
            if(names?.size)list.append(node('li',`№ ${index+1} · ${[...names].join(', ')}`));
          });
          details.append(list.childElementCount?list:node('p','Свободных параметров нет.'));fields.append(details);
        }
        status.textContent='Оценка относится к явным связям отрезков и окружностей.';
      }
    }
    const readPoint=(index,values)=>checkedPoint({x:read(inputs[`x${index}`].value,values)*MM,y:read(inputs[`y${index}`].value,values)*MM});
    function parseVariables(value){
      return value.split(/\r?\n/u).filter(line=>line.trim()).map(line=>{
        const match=line.match(/^\s*(\S+)\s*=\s*(.+)\s*$/u);
        if(!match)throw new Error('Запишите параметр в виде «имя = значение».');
        return {name:match[1],formula:match[2]};
      });
    }
    form.addEventListener('submit',event=>{
      event.preventDefault();
      try{
        const kind=mode.value,current=app.getState().sketchUpgrade||settings(), values=parameterValues(current);
        let change;
        if(kind==='rectangle'||kind==='polar'){
          const start=readPoint(0,values);
          const def=kind==='rectangle'?{kind,start,center:inputs.center.checked,width:inputs.width.value,height:inputs.height.value}:
            {kind,start,length:inputs.length.value,angle:inputs.angle.value};
          change={add:[fromDefinition(def,values)]};
        }else if(kind==='arc')change={add:[arc(...[0,1,2].map(i=>readPoint(i,values)))]};
        else if(kind==='ellipse'||kind==='spline'){
          const shape=fromDefinition({kind,controls:Array.from({length:controlsOf[kind]},(_,i)=>readPoint(i,values))},values);
          const prior=picked('curve');
          change=prior?{replace:[{...prior,...shape}]}:{add:[shape]};
        }else if(kind==='offset'){
          const source=picked('first');
          const {id,layer,mirrorOf,mirrorAxis,sketchDefinition,...shape}=offset(source,read(inputs.distance.value,values));
          change={add:[{...shape,construction:source.construction}]};
        }else if(kind==='trim'||kind==='fillet'){
          const first=picked('first'),second=picked('second');
          if(!first||!second||first.id===second.id)throw new Error('Выберите два разных отрезка.');
          if(kind==='trim')change={replace:[trim(first,second,inputs.end.value)]};
          else{
            const result=fillet(first,second,positive(read(inputs.radius.value,values),'Радиус'));
            change={replace:result.replace,add:[{...result.shape,construction:first.construction&&second.construction}]};
          }
        }else if(kind==='construction')change={replace:[{...picked('first'),construction:inputs.enabled.checked}]};
        else if(kind==='parameters')change={settings:settings({variables:parseVariables(inputs.variables.value),height:inputs.height.value})};
        else if(kind==='report'){
          const latest=app.getState(),strokes=app.getVisibleStrokes();
          const replace=constraintReport(strokes,app.getConstraints(),freeShapes(strokes,latest.layers));
          change={replace};
        }
        if(!change)return;
        if(!app.applySketchUpgrade(change)){status.textContent=app.getSketchUpgradeError()||'Проверьте выбранный слой и размеры.';return;}
        dialog.close();
        app.toast('Построение обновлено.');
      }catch(error){status.textContent=error.message;}
    });
    function open(){
      if(app.isModelOpen())app.setModelOpen(false);
      global.LabDrawingSheet?.close?.({restoreFocus:false});
      $('studio-menu').hidden=true;$('studio-menu-toggle').setAttribute('aria-expanded','false');
      document.body.classList.remove('tools-open');$('tool-launch').setAttribute('aria-expanded','false');
      render();dialog.showModal();
    }
    menuButton.addEventListener('click',open);railButton.addEventListener('click',open);mode.addEventListener('change',render);
    function finishPick(){
      const points=pick?.points||[];
      pick=null;
      document.body.classList.remove('sketch-upgrade-picking');
      if(!dialog.open)dialog.showModal();
      points.forEach((p,i)=>{inputs[`x${i}`].value=fmt(p.x/MM);inputs[`y${i}`].value=fmt(p.y/MM);});
    }
    choose.addEventListener('click',()=>{
      pick={count:controlsOf[mode.value],points:[]};
      document.body.classList.add('sketch-upgrade-picking');
      dialog.close();app.toast(`Отметьте точки на листе. Осталось: ${pick.count}.`);
    });
    function drawHandles(){
      if(!drag)return;
      const svg=(tag,attrs)=>{
        const element=document.createElementNS('http://www.w3.org/2000/svg',tag);
        for(const [key,value] of Object.entries(attrs))element.setAttribute(key,String(value));
        return element;
      };
      const pointList=points=>points.map(p=>`${p.x},${p.y}`).join(' ');
      const {controls,kind}=drag.definition;
      overlay.replaceChildren();
      const guides=kind==='ellipse'?[controls[1],controls[0],controls[2]]:controls;
      overlay.append(svg('polyline',{points:pointList(guides),class:'sketch-upgrade-control-line'}));
      try{
        drag.preview=fromDefinition(drag.definition,drag.values);
        overlay.append(svg('polyline',{points:pointList(drag.preview.points),class:'sketch-upgrade-preview-line'}));
        finish.disabled=false;
      }catch(error){drag.preview=null;finish.disabled=true;finish.title=error.message;}
      const zoom=$('paper').getScreenCTM()?.a||1;
      controls.forEach((p,i)=>overlay.append(svg('circle',{cx:p.x,cy:p.y,r:8/zoom,'data-sketch-handle':i,class:'sketch-upgrade-handle'})));
    }
    function finishDrag(applyEdit){
      if(!drag)return;
      const {shape,preview}=drag;
      if(applyEdit&&(!preview||!app.applySketchUpgrade({replace:[{...shape,...preview}]})))return;
      drag=null;overlay.replaceChildren();floating.hidden=true;
      finish.title='';
      document.body.classList.remove('sketch-upgrade-picking');
      render();inputs.curve.value=shape.id;inputs.curve.dispatchEvent(new Event('change'));dialog.showModal();
    }
    handles.addEventListener('click',()=>{
      const shape=picked('curve');
      if(!shape||shape.mirrorOf)return;
      drag={shape,definition:shape.sketchDefinition,values:parameterValues(app.getState().sketchUpgrade||settings())};
      document.body.classList.add('sketch-upgrade-picking');
      dialog.close();floating.hidden=false;drawHandles();
    });
    finish.addEventListener('click',()=>finishDrag(true));discard.addEventListener('click',()=>finishDrag(false));
    let handledPointer=null;
    document.addEventListener('pointerdown',event=>{
      if(drag&&event.button===0&&event.target.closest('#paper-wrap')){
        event.preventDefault();event.stopImmediatePropagation();
        const point=event.target.dataset.sketchHandle;
        if(point!==undefined){
          drag.index=Number(point);drag.pointer=event.pointerId;$('paper-wrap').setPointerCapture(event.pointerId);
        }
        return;
      }
      if(!pick||event.button>0||!event.target.closest('#paper-wrap'))return;
      handledPointer=event.pointerId;event.preventDefault();event.stopImmediatePropagation();
    },true);
    document.addEventListener('pointermove',event=>{
      if(!drag||drag.pointer!==event.pointerId)return;
      event.preventDefault();event.stopImmediatePropagation();
      drag.definition.controls[drag.index]=app.getPaperPoint(event);drawHandles();
    },true);
    document.addEventListener('pointerup',event=>{
      if(drag&&drag.pointer===event.pointerId){
        event.preventDefault();event.stopImmediatePropagation();drag.pointer=null;
        return;
      }
      if(handledPointer!==event.pointerId)return;
      handledPointer=null;
      if(!pick)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(!event.target.closest('#paper-wrap'))return;
      pick.points.push(app.getPaperPoint(event));
      if(pick.points.length===pick.count)finishPick();
      else app.toast(`Осталось точек: ${pick.count-pick.points.length}.`);
    },true);
    document.addEventListener('pointercancel',event=>{handledPointer=null;if(drag?.pointer===event.pointerId)drag.pointer=null;},true);
    document.addEventListener('keydown',event=>{
      if(drag&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finishDrag(false);return;}
      if(pick&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finishPick();}
    },true);
  }
})(typeof window==='undefined'?globalThis:window);
