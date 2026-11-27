/* Formula evaluation and an independent volume calculation for a drilled plate. */
(function (global) {
  'use strict';
  const MM=4, PAGE_LENGTH=297, PAGE_WIDTH=210, MARGIN=4;
  const MIN_DIAMETER=1, EDGE_CLEARANCE=.125, MAX_SAMPLES=40, MAX_VARIANTS=24, MAX_GRID=120;
  const parameters=['length','width','thickness','diameter'];
  const names={length:'Длина',width:'Ширина',thickness:'Толщина',diameter:'Диаметр'};
  const aliases={длина:'length',ширина:'width',толщина:'thickness',диаметр:'diameter'};
  const defaultFormulas={length:'80',width:'40',thickness:'5',diameter:'width / 4'};
  const defaultRange={from:5,to:35,step:5};
  const defaultSecondRange={from:2,to:10,step:2};
  const dimensionLimits={length:[1,PAGE_LENGTH-MARGIN*2],width:[1,PAGE_WIDTH-MARGIN*2],thickness:[1,200]};
  const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

  function defaults(){
    return {formulas:{...defaultFormulas},range:{...defaultRange},axis:'diameter',secondAxis:null,
      secondRange:{...defaultSecondRange},prediction:'',predictionPending:false,variants:[],comparison:[null,null]};
  }

  function checkedFormulas(value){
    if(!record(value))throw new Error('Укажите формулы размеров пластины.');
    const formulas={};
    for(const parameter of parameters){
      const input=value[parameter];
      const source=typeof input==='number'&&Number.isFinite(input)?String(input):input;
      if(typeof source!=='string'||!source.trim()||source.length>160){
        throw new Error(`${names[parameter]} — введите число или формулу длиной до 160 знаков.`);
      }
      formulas[parameter]=source.trim();
    }
    return formulas;
  }

  function calculate(source,reference){
    const number=/(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?/iy;
    const identifier=/\p{L}+/uy;
    let cursor=0;
    function current(){
      while(cursor<source.length&&/\s/u.test(source[cursor]))cursor++;
      return source[cursor];
    }
    function take(character){
      if(current()!==character)return false;
      cursor++;
      return true;
    }
    function finite(value){
      if(!Number.isFinite(value))throw new Error('Вычисление даёт бесконечность или не определено.');
      return value;
    }
    function atom(){
      current();
      if(take('(')){
        const value=sum();
        if(!take(')'))throw new Error('Закройте скобку в формуле.');
        return value;
      }
      number.lastIndex=cursor;
      const numeric=number.exec(source);
      if(numeric){
        cursor=number.lastIndex;
        return finite(Number(numeric[0].replace(',','.')));
      }
      identifier.lastIndex=cursor;
      const word=identifier.exec(source);
      if(!word)throw new Error('Ожидалось число, имя параметра или скобка.');
      cursor=identifier.lastIndex;
      const name=word[0].toLowerCase();
      if(name==='pi'||name==='π')return Math.PI;
      return reference(Object.hasOwn(aliases,name)?aliases[name]:name);
    }
    function signed(){
      if(take('+'))return signed();
      if(take('-')||take('−'))return -signed();
      const value=atom();
      return take('^')?finite(value**signed()):value;
    }
    function product(){
      let value=signed();
      for(;;){
        if(take('*')||take('×'))value=finite(value*signed());
        else if(take('/')||take('÷')){
          const divisor=signed();
          if(divisor===0)throw new Error('Деление на ноль.');
          value=finite(value/divisor);
        }else return value;
      }
    }
    function sum(){
      let value=product();
      for(;;){
        if(take('+'))value=finite(value+product());
        else if(take('-')||take('−'))value=finite(value-product());
        else return value;
      }
    }
    const result=sum();
    if(current()!==undefined)throw new Error(`Неожиданный символ «${source[cursor]}» в формуле.`);
    return result;
  }

  function checkPlate(values){
    for(const [parameter,[min,max]] of Object.entries(dimensionLimits)){
      if(values[parameter]<min||values[parameter]>max){
        throw new Error(`${names[parameter]} — от ${min} до ${max} мм.`);
      }
    }
    const diameter=values.diameter;
    if(diameter!==0&&diameter<MIN_DIAMETER)throw new Error('Диаметр — 0 мм для цельной пластины или от 1 мм для отверстия.');
    // Keep a resolvable material wall on each side of the circle in the CAD kernel.
    if(diameter>Math.min(values.length,values.width)-EDGE_CLEARANCE*2){
      throw new Error('Уменьшите диаметр. Между отверстием и каждым краем должно остаться не менее 0,125 мм.');
    }
    return values;
  }

  function resolve(formulas,overrides={}){
    const source=checkedFormulas(formulas),cache=new Map(),path=[];
    if(!record(overrides)||Object.entries(overrides).some(([name,value])=>!parameters.includes(name)||!Number.isFinite(value))){
      throw new Error('Подставьте конечное значение известного параметра.');
    }
    function get(name){
      if(!parameters.includes(name))throw new Error(`Неизвестный параметр «${name}».`);
      if(cache.has(name))return cache.get(name);
      if(path.includes(name)){
        const cycle=path.slice(path.indexOf(name)).concat(name).map(parameter=>names[parameter]).join(' → ');
        throw new Error(`Циклическая ссылка: ${cycle}.`);
      }
      path.push(name);
      try{
        const value=Object.hasOwn(overrides,name)?overrides[name]:calculate(source[name],get);
        cache.set(name,Object.is(value,-0)?0:value);
        return cache.get(name);
      }finally{path.pop();}
    }
    return checkPlate(Object.fromEntries(parameters.map(parameter=>[parameter,get(parameter)])));
  }

  function makeProject({length,width,thickness,diameter}){
    const cx=PAGE_LENGTH*MM/2,cy=PAGE_WIDTH*MM/2;
    const left=cx-length*MM/2,right=cx+length*MM/2,top=cy-width*MM/2,bottom=cy+width*MM/2;
    const style={color:'#263c46',width:2,layer:'main'};
    const strokes=[{...style,id:'experiment-plate',type:'path',
      points:[[left,top],[right,top],[right,bottom],[left,bottom],[left,top]].map(([x,y])=>({x,y}))}];
    if(diameter>0)strokes.push({...style,id:'experiment-hole',type:'circle',cx,cy,r:diameter*MM/2});
    return {version:1,orientation:'landscape',tool:'contour',modelHeight:thickness,strokes};
  }

  function meshVolume(strokes,thickness){
    const kernel=global.LabExtrusion;
    if(!kernel)throw new Error('Геометрическое ядро эксперимента недоступно.');
    const profile=kernel.analyze(strokes);
    if(!profile.ok||profile.stats.solids!==1||profile.stats.holes!==strokes.length-1){
      throw new Error(profile.errors[0]?.message||'Не удалось построить пластину с заданным отверстием.');
    }
    return kernel.extrude(profile,thickness).stats.volumeMm3;
  }
  function makeTrial(values,undrilledVolume){
    const {length,width,thickness,diameter}=values,project=makeProject(values);
    const volume=meshVolume(project.strokes,thickness);
    const defaultVolume=length*width*thickness;
    const expectedRemovedVolume=Math.PI*(diameter/2)**2*thickness;
    const base=undrilledVolume??(diameter===0?volume:meshVolume(project.strokes.slice(0,1),thickness));
    return {parameters:values,diameter,project,volume,expectedVolume:defaultVolume-expectedRemovedVolume,
      removedVolume:base-volume,expectedRemovedVolume};
  }
  function evaluate(formulas,overrides){return makeTrial(resolve(formulas,overrides));}

  function checkedRange(value,axis='diameter'){
    if(!parameters.includes(axis))throw new Error('Выберите параметр графика.');
    if(!record(value))throw new Error('Укажите начало, конец и шаг графика.');
    const {from,to,step}=value;
    const [minimum,maximum]=dimensionLimits[axis]||[0,Math.min(dimensionLimits.length[1],dimensionLimits.width[1])];
    if(![from,to,step].every(Number.isFinite)||from<minimum||to<=from||to>maximum||step<=0){
      throw new Error(`${names[axis]} — задайте возрастающий диапазон от ${minimum} до ${maximum} мм и положительный шаг.`);
    }
    const span=to-from,intervals=Math.floor(span/step+1e-9);
    if(intervals<1)throw new Error('Шаг графика должен помещаться в выбранный диапазон.');
    if(intervals+1>MAX_SAMPLES)throw new Error(`Увеличьте шаг графика. Доступно до ${MAX_SAMPLES} точек.`);
    return {from,to,step};
  }
  function rangeValues(range,axis) {
    const {from,to,step}=checkedRange(range,axis);
    const count=Math.floor((to-from)/step+1e-9)+1;
    return Array.from({length:count},(_,index)=>Math.min(to,Number((from+index*step).toPrecision(14))));
  }
  function series(formulas,range,axis='diameter'){
    const fixed=resolve(formulas);
    const base=axis==='diameter'?fixed.length*fixed.width*fixed.thickness:undefined;
    return rangeValues(range,axis).map(value=>{
      const {project,...result}=makeTrial(checkPlate({...fixed,[axis]:value}),base);
      return result;
    });
  }
  function grid(formulas,range,axis,secondRange,secondAxis){
    if(axis===secondAxis)throw new Error('Для карты выберите два разных параметра.');
    const fixed=resolve(formulas), columns=rangeValues(range,axis), rows=rangeValues(secondRange,secondAxis);
    if(columns.length*rows.length>MAX_GRID)throw new Error(`Увеличьте шаг. На карте допускается до ${MAX_GRID} ячеек.`);
    return {columns,rows,results:rows.map(second=>columns.map(first=>{
      try {
        const {project,...result}=makeTrial(checkPlate({...fixed,[axis]:first,[secondAxis]:second}));
        return result;
      } catch(error) {
        return {error:error.message,first,second};
      }
    }))};
  }

  function accuracy(values,segments=[4,8,16,32,64,128]) {
    const {length,width,thickness,diameter}=resolve(values);
    const radius=diameter/2, whole=length*width*thickness;
    const expected=whole-Math.PI*radius**2*thickness;
    const project=makeProject({length,width,thickness,diameter});
    const scale=64;
    // Scale the input plane so the kernel's fixed joining and simplification tolerances
    // leave even the smallest 128-sided contour intact, then recover the original area.
    const scaledPoint=({x,y})=>({x:x*scale,y:y*scale});
    const plate={...project.strokes[0],points:project.strokes[0].points.map(scaledPoint)};
    const circle=project.strokes[1];
    return segments.map(count=>{
      if(!Number.isInteger(count)||count<3||count>128)throw new Error('Укажите от 3 до 128 сторон.');
      if(!circle)return {segments:count,volume:whole,expected,error:0};
      const points=Array.from({length:count},(_,index)=>{
        const angle=2*Math.PI*index/count;
        return scaledPoint({x:circle.cx+circle.r*Math.cos(angle),y:circle.cy+circle.r*Math.sin(angle)});
      });
      const hole={type:'path',points:[...points,points[0]]};
      const volume=meshVolume([plate,hole],thickness)/scale**2;
      return {segments:count,volume,expected,error:volume-expected};
    });
  }

  function validateState(raw){
    if(raw===undefined)return defaults();
    if(!record(raw))throw new Error('Некорректные настройки эксперимента.');
    const formulas=checkedFormulas(raw.formulas??defaultFormulas);
    resolve(formulas);
    const axis=raw.axis??'diameter', secondAxis=raw.secondAxis??null;
    const range=checkedRange(raw.range??defaultRange,axis);
    if(secondAxis!==null&&(!parameters.includes(secondAxis)||axis===secondAxis)){
      throw new Error('Для карты выберите два разных параметра.');
    }
    const secondRange=secondAxis===null?{...defaultSecondRange}:
      checkedRange(raw.secondRange??defaultSecondRange,secondAxis);
    const prediction=typeof raw.prediction==='string'?raw.prediction.trim().slice(0,420):'';
    const source=raw.variants??[];
    if(!Array.isArray(source)||source.length>MAX_VARIANTS){
      throw new Error(`В эксперименте может быть до ${MAX_VARIANTS} вариантов.`);
    }
    const ids=new Set();
    const variants=source.map((variant,index)=>{
      if(!record(variant)||typeof variant.id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(variant.id)||ids.has(variant.id)){
        throw new Error('Некорректный идентификатор варианта эксперимента.');
      }
      ids.add(variant.id);
      const parameters=checkedFormulas(variant.formulas);
      resolve(parameters);
      const name=typeof variant.name==='string'?variant.name.replace(/[\u0000-\u001f\u007f-\u009f]/g,'').trim().slice(0,64):'';
      return {id:variant.id,name:name||`Вариант ${index+1}`,formulas:parameters};
    });
    const picked=Array.isArray(raw.comparison)?raw.comparison:[];
    const first=ids.has(picked[0])?picked[0]:null;
    const second=ids.has(picked[1])&&picked[1]!==first?picked[1]:null;
    return {formulas,range,axis,secondAxis,secondRange,prediction,predictionPending:Boolean(prediction&&raw.predictionPending===true),
      variants,comparison:[first,second]};
  }

  const api=Object.freeze({defaults,resolve,evaluate,series,grid,accuracy,validateState,limits:Object.freeze({
    maxSamples:MAX_SAMPLES,maxVariants:MAX_VARIANTS,minDiameter:MIN_DIAMETER
  })});
  global.LabExperimentGeometry=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
