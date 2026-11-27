/* Offline spatial reasoning exercises and exact voxel projections. */
(function (global) {
  'use strict';

  const svgNS = 'http://www.w3.org/2000/svg';
  const axes = {top:[0,1], front:[0,2], right:[1,2], back:[0,2], left:[1,2]};
  const viewNames = {top:'Сверху',front:'Спереди',right:'Справа',back:'Сзади',left:'Слева'};
  const key = point => point.join(',');
  const unique = points => [...new Map(points.map(point => [key(point),point])).values()];

  function quarterTurn([x,y,z], axis) {
    if (axis === 'X') return [x,-z,y];
    if (axis === 'Y') return [z,y,-x];
    return [-y,x,z];
  }
  function rotate(point, moves) {
    return moves.reduce((position,axis) => quarterTurn(position,axis), point);
  }
  function rotateCube(cell,moves) {
    const vertices=Array.from({length:8},(_,index)=>
      rotate(cell.map((value,axis)=>value+(index>>axis&1)),moves));
    return [0,1,2].map(axis=>Math.min(...vertices.map(point=>point[axis])));
  }
  function signature(points) {
    const offsets = [0,1,2].map(axis => Math.min(...points.map(point => point[axis])));
    return points.map(point => key(point.map((value,axis) => value-offsets[axis]))).sort().join('|');
  }
  function rotationSignatures(points) {
    const queue = [points], seen = new Set();
    for (let i=0; i<queue.length; i++) {
      const pose = queue[i], stamp = signature(pose);
      if (seen.has(stamp)) continue;
      seen.add(stamp);
      for (const axis of ['X','Y','Z']) queue.push(pose.map(point => quarterTurn(point,axis)));
    }
    return seen;
  }
  function projection(points, view) {
    const [horizontal,vertical] = axes[view];
    const sign = ['back','left'].includes(view) ? -1 : 1;
    return unique(points.map(point => [sign*point[horizontal],point[vertical]]));
  }
  function signature2(points) {
    return points.map(key).sort().join('|');
  }
  function fromHeights(heights, width) {
    return heights.flatMap((height,index) => Array.from({length:height},
      (_,z) => [index%width,Math.floor(index/width),z]));
  }
  function rotateFlat(points, turns) {
    let pose = points;
    for (let index=0; index<turns; index++) pose = pose.map(([x,y]) => [-y,x]);
    const min = [0,1].map(axis => Math.min(...pose.map(point => point[axis])));
    return pose.map(([x,y]) => [x-min[0],y-min[1]]);
  }
  function fitPosition(piece, opening) {
    const allowed = new Set(opening.map(key));
    const max = [0,1].map(axis => Math.max(...opening.map(point => point[axis])));
    for (let x=0; x<=max[0]; x++) {
      for (let y=0; y<=max[1]; y++) {
        if (piece.every(([u,v]) => allowed.has(key([x+u,y+v])))) return [x,y];
      }
    }
    return null;
  }
  const fits=(piece,opening)=>fitPosition(piece,opening)!==null;

  function surfacePaths(width, depth, height, x, z) {
    return [
      {name:'Через верх',length:depth+2*(height-z),edge:height-z,cross:width,offset:x},
      {name:'Через низ',length:depth+2*z,edge:z,cross:width,offset:x},
      {name:'Через левую грань',length:depth+2*x,edge:x,cross:height,offset:z},
      {name:'Через правую грань',length:depth+2*(width-x),edge:width-x,cross:height,offset:z}
    ];
  }
  const catalogue = [
    ['same-views','Одинаковые виды — разные детали'], ['turn','Поворот по памяти'],
    ['mirror','Двойник или отражение?'], ['hidden','Скрытые кубики'],
    ['net','Сложи коробку'], ['thread','Кратчайшая нить'],
    ['fit','Пройдёт ли в проём?'], ['point','Найди точку на трёх видах'],
    ['observer','Что увидит наблюдатель?'], ['questions','Минимум вопросов конструктору']
  ];

  function element(tag, value, properties={}) {
    const item = Object.assign(document.createElement(tag),properties);
    if (value!==undefined) item.textContent = value;
    return item;
  }
  function button(label, handler) {
    const item = element('button',label,{type:'button'});
    item.addEventListener('click',handler);
    return item;
  }
  function field(label, input) {
    const item = element('label');
    item.append(element('span',label),input);
    return item;
  }
  function row(...nodes) {
    const item = element('div');
    item.className = 'lab-workbench-actions';
    item.append(...nodes);
    return item;
  }
  function select(options,value=options[0][0]) {
    const input = element('select');
    for (const [id,label] of options) input.append(element('option',label,{value:String(id)}));
    input.value=String(value);
    return input;
  }
  function number(value,min,max) {
    return element('input',undefined,{type:'number',value:String(value),min:String(min),max:String(max),step:'1'});
  }
  function svgNode(tag,attrs) {
    const item=document.createElementNS(svgNS,tag);
    for (const [name,value] of Object.entries(attrs)) item.setAttribute(name,String(value));
    return item;
  }
  function picture(label,size=[240,174]) {
    const item=svgNode('svg',{viewBox:'0 0 '+size.join(' '),role:'img','aria-label':label,
      width:size[0],height:size[1]});
    item.style.maxWidth='100%';
    item.style.height='auto';
    return item;
  }
  function figure(label,content) {
    const item=element('figure');
    item.style.margin='0';
    item.append(content,element('figcaption',label));
    return item;
  }
  function svgText(x,y,text,attrs={}) {
    const item=svgNode('text',{x,y,fill:'currentColor','font-size':13,'text-anchor':'middle',...attrs});
    item.textContent=text;
    return item;
  }
  function iso(points, name='Изометрия', mark=null) {
    const shape=picture(name);
    const extents = points.length ? points : [[0,0,0]];
    const [xmin,ymin,zmin] = [0,1,2].map(axis=>Math.min(0,...extents.map(point=>point[axis])));
    const [xmax,ymax,zmax] = [0,1,2].map(axis=>Math.max(1,...extents.map(point=>point[axis]+1)));
    const size=Math.min(29,77/Math.max(xmax-xmin,ymax-ymin,zmax-zmin));
    const project=([x,y,z])=>[120+(x-y-(xmin+xmax-ymin-ymax)/2)*size,
      86+((x+y)/2-z-(xmin+xmax+ymin+ymax)/4+(zmin+zmax)/2)*size];
    const faces=[
      {offset:[1,0,0],vertices:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]],color:'#6386a8'},
      {offset:[0,1,0],vertices:[[0,1,0],[1,1,0],[1,1,1],[0,1,1]],color:'#8badc7'},
      {offset:[0,0,1],vertices:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]],color:'#e2effa'}
    ];
    const occupied=new Set(points.map(key));
    const depth=point=>point.reduce((a,b)=>a+b,0);
    for (const cube of [...points].sort((a,b)=>depth(a)-depth(b))) {
      const move=offset=>offset.map((value,axis)=>cube[axis]+value);
      for (const face of faces) {
        if (occupied.has(key(move(face.offset)))) continue;
        shape.append(svgNode('polygon',{points:face.vertices.map(move).map(project).map(key).join(' '),
          fill:face.color,stroke:'#26415d','stroke-width':1.1}));
      }
    }
    if (mark) {
      const [x,y]=project(mark);
      shape.append(svgNode('circle',{cx:x,cy:y,r:5,fill:'#fa8749',stroke:'#56271a','stroke-width':1.1}));
    }
    return shape;
  }
  function ortho(points,label, {flipY=true,mark=null,overlay=[]}={}) {
    const shape = picture(label,[155,124]);
    const range=mark?[...points,mark]:points;
    const min=[0,1].map(axis=>Math.min(0,...range.map(point=>point[axis])));
    const max=[0,1].map(axis=>Math.max(1,...range.map(point=>point[axis]+1)));
    const size = Math.min(28,100/Math.max(...max.map((value,index)=>value-min[index])));
    const [width,height]=max.map((value,index)=>(value-min[index])*size);
    const coords=([x,y])=>[(155-width)/2+(x-min[0])*size,
      (124-height)/2+(flipY ? max[1]-1-y : y-min[1])*size];
    for (const point of points) {
      const [x,y]=coords(point);
      shape.append(svgNode('rect',{x,y,width:size,height:size,fill:'#accce4',stroke:'#315573','stroke-width':1}));
    }
    for (const point of overlay) {
      const [x,y]=coords(point);
      shape.append(svgNode('rect',{x:x+2,y:y+2,width:size-4,height:size-4,fill:'#acdec7',
        stroke:'#28694c','stroke-width':1.4}));
    }
    if (mark) {
      const [x,y]=coords(mark);
      shape.append(svgNode('circle',{cx:x+size/2,cy:y+size/2,r:4,fill:'#fa8749',stroke:'#56271a'}));
    }
    return shape;
  }
  function answerLine(container) {
    const status=element('p','');
    status.setAttribute('role','status');
    container.append(status);
    return (correct,explanation) => {
      status.textContent=(correct===null?'':correct?'Верно. ':'Попробуйте ещё. ')+explanation;
    };
  }
  function boxes(container, label, options, multiple=false) {
    const controls=options.map(([value,title])=>[value,element('input',undefined,
      {type:multiple?'checkbox':'radio',name:label,value:String(value)})]);
    const set=element('fieldset'); set.append(element('legend',label));
    for (let index=0; index<options.length; index++) {
      const item=element('label');
      item.append(controls[index][1],document.createTextNode(' '+options[index][1]));
      set.append(item,element('br'));
    }
    container.append(set);
    return ()=>controls.filter(([,input])=>input.checked).map(([value])=>value);
  }

  function sameViews(panel,variant) {
    const front=2+variant%2;
    panel.append(element('p',`Постройте две разные детали из трёх столбцов. Ближайший столбец у обеих имеет высоту ${front}. Задние столбцы могут быть ниже. Видимые спереди границы задаёт ближайший столбец. Сравните проекции.`));
    const heights=[0,1].map(()=>[number(1,1,front),number(1,1,front)]);
    const graphics=element('div');
    const direction=select([['top','Сверху'],['front','Спереди'],['right','Справа']]);
    const controls=heights.map(([middle,back],i)=>row(field(`Деталь ${i+1} · средний столбец`,middle),field('Дальний столбец',back)));
    panel.append(...controls,field('Сравнить проекцию',direction),graphics);
    const check=button('Проверить построения',()=>update(true));
    panel.append(check);
    const reply=answerLine(panel);
    function update(report=false) {
      const models=heights.map(([middle,back])=>fromHeights([front,
        Math.max(1,Math.min(front,Number(middle.value)||1)),Math.max(1,Math.min(front,Number(back.value)||1))],1));
      graphics.replaceChildren(...models.map((shape,i)=>{
        const name=`Деталь ${i+1}`;
        return row(figure(name,iso(shape,name)),
          figure(viewNames[direction.value],ortho(projection(shape,direction.value),viewNames[direction.value])));
      }));
      if (!report) return;
      const differ=(view)=>signature2(projection(models[0],view))!==signature2(projection(models[1],view));
      const correct=differ(direction.value)&&!differ('top')&&!differ('front');
      reply(correct,correct?'Глубина и высота видны одновременно справа.':
        differ('right')?'Формы различаются. Выберите проекцию, которая показывает различие.':'Измените высоту одного из задних столбцов.');
    }
    controls.forEach(control=>control.addEventListener('input',()=>update()));
    direction.addEventListener('change',()=>update());
    update();
  }

  function turnQuestion(panel,variant) {
    const point=[1,variant%2+1,2], moves=variant%2?['X','Y']:['Y','X'];
    const shell=fromHeights([1,1,2,2,1,2],3);
    panel.append(element('p',`В правой системе координат отмеченная точка находится в (${point.join('; ')}). Поверните её на +90° вокруг ${moves[0]}, затем на +90° вокруг ${moves[1]}. Вращение вокруг X заменяет (y; z) на (−z; y). Вокруг Y пара (x; z) превращается в (z; −x).`));
    const [x,y,z]=[number(0,-9,9),number(0,-9,9),number(0,-9,9)];
    const stage=row(figure('Исходная поза',iso(shell,'Модель с отмеченной точкой',point)));
    panel.append(stage,row(field('X',x),field('Y',y),field('Z',z)));
    panel.append(button('Проверить и повернуть',()=>{
      const values=[x,y,z].map(input=>input.valueAsNumber);
      const result=rotate(point,moves);
      if (key(values)!==key(result)) {
        reply(false,'Проверьте координаты по очереди после первого и второго поворота.');
        return;
      }
      stage.replaceChildren(figure('Исходная поза',iso(shell,'Исходная точка',point)),
        figure('После поворотов',iso(shell.map(cell=>rotateCube(cell,moves)), 'Повернутая модель',result)));
      reply(true,`После первого поворота координаты (${rotate(point,moves.slice(0,1)).join('; ')}). В обратном порядке получится (${rotate(point,[...moves].reverse()).join('; ')}).`);
    }));
    const reply=answerLine(panel);
  }

  function mirrorQuestion(panel,variant) {
    const sample=[[0,0,0],[1,0,0],[2,0,0],[0,1,0],[0,0,1],[0,0,2],[0,0,3]];
    const reflected=sample.map(([x,y,z])=>[-x,y,z]);
    const correct=sample.map(point=>rotate(point,variant%2?['X','Y']:['Z','X']));
    const different=sample.map(point=>key(point)==='2,0,0'?[1,1,0]:point);
    const choices=[reflected,different,correct];
    for (let index=0; index<variant%3; index++) choices.push(choices.shift());
    panel.append(element('p','Найдите модель, которую можно совместить с образцом переносом и вращением. Сравните длины трёх ветвей и их порядок вокруг общей вершины.'),
      row(figure('Образец',iso(sample,'Образец')), ...choices.map((points,i)=>figure(`Модель ${i+1}`,iso(points,`Модель ${i+1}`)))));
    const pick=boxes(panel,'Какая модель совпадает с образцом?',choices.map((_,i)=>[i,`Модель ${i+1}`]));
    panel.append(button('Проверить совпадение',()=>{
      const id=pick()[0];
      const ok=id!==undefined&&rotationSignatures(sample).has(signature(choices[id]));
      reply(ok,ok?'При вращении относительный порядок ветвей сохраняется. Отражение меняет этот порядок.':'Сначала найдите три ветви той же длины, затем проверьте их порядок.');
    }));
    const reply=answerLine(panel);
  }

  function hiddenQuestion(panel,variant) {
    const height=2+variant%3;
    const cells=fromHeights([0,height,height,height],2);
    panel.append(element('p',`В трёх видимых столбцах по ${height} куб. Образец стоит на основании 2×2. Для дальнего столбца известно, что нижняя клетка занята, а высота не превышает высоту остальных. Каждый куб опирается на основание или на другой куб. Сколько кубиков может быть во всей постройке?`),
      row(figure('Изометрия видимой части',iso(cells)),figure('План · оранжевая точка отмечает дальний столбец',ortho([[0,1],[1,1],[1,0]],'План столбцов',{mark:[0,0]}))));
    const min=number(0,0,35),max=number(0,0,35);
    const extent=row();
    panel.append(row(field('Минимум',min),field('Максимум',max)),extent,button('Проверить границы',()=>{
      const ok=min.valueAsNumber===3*height+1&&max.valueAsNumber===4*height;
      if (ok) extent.replaceChildren(figure('Минимум',iso(fromHeights([1,height,height,height],2))),
        figure('Максимум',iso(fromHeights([height,height,height,height],2))));
      reply(ok,ok?`Дальний столбец может иметь любую высоту от 1 до ${height}.`:
        'В трёх видимых столбцах суммарно три высоты. Прибавьте сначала один обязательный куб, затем максимально допустимое число.');
    }));
    const reply=answerLine(panel);
  }

  function netFigure(labels) {
    const net=picture('Крестообразная развёртка куба',[235,175]);
    const squares=[[1,0],[0,1],[1,1],[2,1],[1,2],[1,3]];
    squares.forEach(([x,y],i)=>{
      const left=52+x*43,top=1+y*43;
      net.append(svgNode('rect',{x:left,y:top,width:43,height:43,fill:'#d8eaff',stroke:'#375875'}),
        svgText(left+21.5,top+27,labels[i],{fill:'#183658'}));
    });
    return net;
  }
  function foldedPair(labels, selected, opposite, angle) {
    const view=picture('Интерактивное складывание развёртки');
    const radians=angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
    const transforms=[
      ([u,v])=>[u-.5,.5+v*c,v*s],
      ([u,v])=>[-.5-u*c,v-.5,u*s],
      ([u,v])=>[u-.5,v-.5,0],
      ([u,v])=>[.5+u*c,v-.5,u*s],
      ([u,v])=>[u-.5,-.5-v*c,v*s],
      ([u,v])=>[u-.5,-.5-c-v*Math.cos(2*radians),s+v*Math.sin(2*radians)]
    ];
    const project=([x,y,z])=>[112+(x-y)*38,73+(x+y)*21-z*51];
    const faces=transforms.map((transform,index)=>({index,
      center:transform([.5,.5]),points:[[0,0],[1,0],[1,1],[0,1]].map(transform).map(project)}));
    const depth=({center:[x,y,z]})=>x+y+2*z;
    for (const {index,center,points} of faces.sort((a,b)=>depth(a)-depth(b))) {
      const [x,y]=project(center);
      view.append(svgNode('polygon',{points:points.map(key).join(' '),stroke:'#315573',
        fill:index===selected?'#fec883':index===opposite?'#a8ddc9':'#d7eafb'}),
      svgText(x,y+4,labels[index],{fill:'#183658','font-weight':700}));
    }
    view.append(svgText(120,160,`${labels[selected]} и ${labels[opposite]} · угол сгиба ${angle}°`));
    return view;
  }
  function netQuestion(panel,variant) {
    const labels=Array.from({length:6},(_,i)=>'АБВГДЕ'[(i+variant)%6]);
    const index=variant%6, opposites=[4,3,5,1,0,2];
    panel.append(element('p',`Назовите грань напротив «${labels[index]}». Представьте, как соседние квадраты поднимаются на 90° вокруг общего ребра.`),
      figure('Развёртка с шестью гранями',netFigure(labels)));
    const pick=select(labels.map(label=>[label,label]));
    const proof=row();
    panel.append(field('Противоположная грань',pick),button('Сложить и проверить',()=>{
      const match=opposites[index];
      const correct=pick.value===labels[match];
      if (correct) {
        const angle=element('input',undefined,{type:'range',min:'0',max:'90',step:'1',value:'30'});
        const frame=element('div');
        const update=()=>frame.replaceChildren(foldedPair(labels,index,match,Number(angle.value)));
        angle.addEventListener('input',update);
        proof.replaceChildren(field('Угол сгиба, градусы',angle),frame);
        update();
      }
      reply(correct,correct?'Эти квадраты в сложенном кубе лежат в параллельных плоскостях по разные стороны центра.':
        'Сначала мысленно выберите центральный квадрат крестовины в качестве основания.');
    }),proof);
    const reply=answerLine(panel);
  }

  function routeFigure(path,depth) {
    const shape=picture(path.name,[255,135]);
    const scale=Math.min(185/path.length,83/path.cross);
    const margin=(255-path.length*scale)/2,top=(135-path.cross*scale)/2;
    const band=path.edge*scale,length=depth*scale;
    const y=top+path.offset*scale;
    shape.append(svgNode('rect',{x:margin,y:top,width:path.length*scale,height:path.cross*scale,fill:'#e0edf9',stroke:'#3b5e80'}),
      svgNode('path',{d:`M ${margin+band} ${top}v${path.cross*scale}m ${length} 0v${-path.cross*scale}`,
        fill:'none',stroke:'#466987','stroke-dasharray':'4 3'}),
      svgNode('line',{x1:margin,x2:255-margin,y1:y,y2:y,stroke:'#c64730','stroke-width':3}),
      svgNode('circle',{cx:margin,cy:y,r:4,fill:'#c64730'}),
      svgNode('circle',{cx:255-margin,cy:y,r:4,fill:'#c64730'}));
    return shape;
  }
  function threadQuestion(panel,variant) {
    const width=8+variant%3,depth=12+variant%4,height=6+variant%2,x=2+variant%4,z=1+variant%3;
    const routes=surfacePaths(width,depth,height,x,z);
    const best=Math.min(...routes.map(path=>path.length));
    const front=picture('Метка на грани коробки',[200,130]);
    const scale=Math.min(150/width,90/height), left=(200-width*scale)/2, bottom=111;
    front.append(svgNode('rect',{x:left,y:bottom-height*scale,width:width*scale,height:height*scale,
      fill:'#e0edf9',stroke:'#3b5e80'}),
      svgNode('path',{d:`M ${left} ${bottom-z*scale}H${left+x*scale}V${bottom}`,
        fill:'none',stroke:'#466987','stroke-dasharray':'3 2'}),
      svgNode('circle',{cx:left+x*scale,cy:bottom-z*scale,r:4,fill:'#c64730'}));
    panel.append(element('p',`Коробка ${width} × ${depth} × ${height} см. На передней и задней гранях точки расположены одинаково — в ${x} см от левого ребра и ${z} см от нижнего. Выберите боковую грань для кратчайшего пути. Запишите его длину.`));
    const choice=select(routes.map((route,index)=>[index,route.name]));
    const length=number(0,0,120); const diagram=row();
    panel.append(row(figure('Положение метки на передней и задней гранях',front),diagram),
      row(field('Путь',choice),field('Длина, см',length)),button('Проверить путь',()=>{
      const chosen=routes[Number(choice.value)];
      const correct=chosen.length===best&&length.valueAsNumber===best;
      if (correct) diagram.replaceChildren(figure(chosen.name,routeFigure(chosen,depth)));
      reply(correct,correct?`В развёртке соединяем метки прямой. Длина ${chosen.edge} + ${depth} + ${chosen.edge} = ${best} см.`:
        'В выбранную длину входят два одинаковых подхода к ребру и глубина коробки.');
    }));
    const reply=answerLine(panel);
  }

  function fitQuestion(panel,variant) {
    const piece=[[0,0],[0,1],[0,2],[1,0]];
    const opening=rotateFlat(piece,variant%4).map(([x,y])=>[x+1,y+1]);
    const editor=number(0,0,3),preview=row();
    panel.append(element('p','Поверните профиль Г-образной детали против часовой стрелки на нужное число четвертей оборота. Деталь можно сместить в плоскости проёма.'),
      field('Четверть оборота ×',editor),preview,button('Проверить прохождение',()=>{
        const turned=rotateFlat(piece,valid()?editor.valueAsNumber:0);
        const shift=valid()?fitPosition(turned,opening):null;
        if (shift) refresh(turned.map(([x,y])=>[x+shift[0],y+shift[1]]));
        reply(Boolean(shift),shift?'Все четыре клетки детали помещаются в проём после смещения.':
          'Сравните направление длинной ветви и сторону, в которую отходит короткая.');
    }));
    const reply=answerLine(panel);
    function valid() {return Number.isInteger(editor.valueAsNumber)&&editor.valueAsNumber>=0&&editor.valueAsNumber<=3;}
    function refresh(overlay=[]) {
      preview.replaceChildren(figure('Проём',ortho(opening,'Профиль проёма',{overlay})),
        figure('Деталь после поворота',ortho(rotateFlat(piece,valid()?editor.valueAsNumber:0),'Профиль детали')));
    }
    editor.addEventListener('input',()=>refresh());refresh();
  }

  function grid(label, columns, rows, multi=false, flipY=true) {
    const active=new Set();
    const layout=element('div');
    layout.style.display='grid';
    layout.style.gridTemplateColumns=`repeat(${columns}, minmax(2.25em, 1fr))`;
    layout.style.gap='.2rem';
    layout.style.maxWidth='16rem';
    const group=element('fieldset');
    group.append(element('legend',label),layout);
    const list=[];
    function update() {
      list.forEach(([point,control])=>control.setAttribute('aria-pressed',String(active.has(key(point)))));
    }
    for (let i=0; i<rows; i++) {
      const y=flipY?rows-1-i:i;
      for (let x=0; x<columns; x++) {
        const point=[x,y],stamp=key(point);
        const control=button(`${x+1} · ${y+1}`,()=>{
          const toggle=active.has(stamp);
          if (!multi) active.clear();
          if (toggle) active.delete(stamp);
          else active.add(stamp);
          update();
        });
        list.push([point,control]);layout.append(control);
      }
    }
    update();
    return {group,active,show(points){active.clear();points.forEach(point=>active.add(key(point)));update();}};
  }
  function pointQuestion(panel,variant) {
    const width=3,depth=2,height=3;
    const target=[variant%width,variant%depth,(variant*2+1)%height];
    const solid=fromHeights(Array(width*depth).fill(height),width);
    panel.append(element('p',`Метка находится в кубике с индексом (X=${target[0]+1}, Y=${target[1]+1}, Z=${target[2]+1}). Выберите соответствующую клетку на каждом виде. Первое число растёт вправо, второе вверх.`),
      figure('Модель с меткой',iso(solid,'Проекции отмеченного кубика',target.map(value=>value+.5))));
    const sizes={top:[width,depth],front:[width,height],right:[depth,height]};
    const views=Object.entries(sizes).map(([view,size])=>[view,grid(viewNames[view],...size)]);
    panel.append(row(...views.map(([,view])=>view.group)),button('Проверить три проекции',()=>{
      const errors=views.filter(([view,control])=>!control.active.has(key(projection([target],view)[0])));
      reply(!errors.length,errors.length?`Проверьте виды: ${errors.map(([view])=>viewNames[view].toLowerCase()).join(', ')}.`:
        'Каждый ортогональный вид использует две координаты из трёх.');
    }));
    const reply=answerLine(panel);
  }
  function observerQuestion(panel,variant) {
    const solid=fromHeights([1,2,3,1,1,2],3);
    const views=['front','right','back','left'];
    const view=views[variant%views.length];
    const points=projection(solid,view);
    const offset=Math.min(...points.map(point=>point[0]));
    const expected=points.map(([u,v])=>[u-offset,v]);
    const flags=grid('Силуэт наблюдателя',Math.max(...expected.map(point=>point[0]))+1,3,true);
    const plan=ortho(projection(solid,'top'),'План — вид сверху');
    const position={front:[77,113],right:[136,62],back:[77,17],left:[21,62]}[view];
    const signs={front:'↑',right:'←',back:'↓',left:'→'};
    plan.append(svgText(...position,signs[view],{'font-size':24,fill:'#c64730'}));
    panel.append(element('p','Стрелка на плане показывает место и направление взгляда. Отметьте клетки, которые будут заняты на силуэте с этой стороны.'),
      row(figure('Вид сверху и наблюдатель',plan),figure('Модель',iso(solid))),flags.group,
      button('Проверить силуэт',()=>{
        const correct=[...flags.active].sort().join('|')===signature2(expected);
        reply(correct,correct?`Получился вид «${viewNames[view].toLowerCase()}». На каждой вертикали видна самая высокая колонна по направлению взгляда.`:
          'Для каждой вертикали мысленно наложите все колонки, расположенные по одной линии взгляда.');
      }));
    const reply=answerLine(panel);
  }
  function questionsQuestion(panel,variant) {
    const all=[
      ['width','Ширина пластины',60+variant],['depth','Глубина пластины',38+variant%12],
      ['height','Толщина пластины',7+variant%4],['diameter','Диаметр отверстия',8+variant%5],
      ['x','Расстояние от левого края до оси',20+variant%5],['y','Расстояние от нижнего края до оси',14+variant%5]
    ];
    const missing=all.filter((_,i)=>[variant%6,(variant+2)%6,(variant+4)%6].includes(i));
    const given=all.filter(item=>!missing.includes(item));
    const sketch=picture('Виды пластины с одним круглым сквозным отверстием',[200,135]);
    sketch.append(svgNode('rect',{x:40,y:10,width:120,height:79,fill:'#dcecff',stroke:'#375875'}),
      svgNode('circle',{cx:82,cy:50,r:12,fill:'#f5f8fd',stroke:'#375875'}),
      svgNode('rect',{x:40,y:107,width:120,height:15,fill:'#dcecff',stroke:'#375875'}),
      svgNode('path',{d:'M70 107V122M94 107V122','stroke-dasharray':'3 2',stroke:'#375875'}));
    panel.append(element('p','Нужно изготовить прямоугольную пластину с одним сквозным отверстием. Схема дана без масштаба. Отметьте минимальный набор вопросов, которые однозначно зададут все размеры.'),
      row(figure('Сверху и спереди',sketch),element('p',given.map(([,label,value])=>`${label} — ${value} мм`).join('. ')+'.')));
    const selected=boxes(panel,'Что нужно уточнить?',[
      ...all.map(([id,label])=>[id,label]),['material','Название материала'],['id','Номер детали']
    ],true);
    panel.append(button('Проверить вопросы',()=>{
      const ok=selected().sort().join(',')===missing.map(item=>item[0]).sort().join(',');
      reply(ok,ok?'Эти размеры вместе с известными полностью определяют параллелепипед и ось сквозного отверстия.':
        'Уберите размеры, которые уже даны или вычисляются. Проверьте три габарита, диаметр и обе координаты оси.');
    }));
    const reply=answerLine(panel);
  }

  const renderers=[sameViews,turnQuestion,mirrorQuestion,hiddenQuestion,netQuestion,threadQuestion,
    fitQuestion,pointQuestion,observerQuestion,questionsQuestion];
  function mount(container) {
    const picker=select(catalogue), variant=number(1,1,24);
    const active=element('section');
    const heading=element('h3','');
    const section=element('div');
    active.append(heading,section);
    container.append(row(field('Задание',picker),field('Вариант',variant)),active);
    function draw() {
      const index=catalogue.findIndex(([id])=>id===picker.value);
      if (index<0||!variant.checkValidity()||!variant.value) return;
      heading.textContent=catalogue[index][1];
      section.replaceChildren();
      renderers[index](section,variant.valueAsNumber);
    }
    picker.addEventListener('change',draw);
    variant.addEventListener('change',draw);
    draw();
  }
  const api={catalogue,mount,iso,ortho,projection,signature2,rotate,rotationSignatures,signature,fromHeights,
    rotateFlat,fits,surfacePaths};
  global.LabSpatialReasoning=api;
  global.LabExtensions?.register({id:'spatial',title:'Пространственное мышление',mount});
  if (typeof module==='object'&&module.exports) module.exports=api;
})(typeof window==='undefined'?globalThis:window);
