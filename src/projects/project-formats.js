/* Offline interchange. Sketch coordinates are stored in paper units (4 per mm). */
(function (global) {
  'use strict';
  const mm = 4, palette = ['#263c46', '#168d83', '#457ad1', '#d36e54', '#9866b3'];
  const numberPattern = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
  const values = value => (value?.match(numberPattern) || []).map(Number);
  const identity = [1, 0, 0, 1, 0, 0];
  const transform = ([a,b,c,d,e,f], [g,h,i,j,k,l]) =>
    [a*g+c*h,b*g+d*h,a*i+c*j,b*i+d*j,a*k+c*l+e,b*k+d*l+f];
  const point = ([a,b,c,d,e,f], x, y) => ({x:a*x+c*y+e,y:b*x+d*y+f});
  const normalizeAngle = n => (n%360+360)%360;

  function result(entities) {
    if (!entities.length) throw new Error('В файле нет поддерживаемых линий или контуров.');
    if (entities.length>5000 || entities.reduce((n,e)=>n+(e.shape.points?.length||0),0)>250000)
      throw new Error('Превышен предел числа линий или точек.');
    const layers = [], ids = new Map();
    const strokes = entities.map(({name, shape, color, construction}, i) => {
      name = (name || 'Импорт').slice(0,40);
      if (!ids.has(name)) {
        if (layers.length >= 20) throw new Error('Поддерживается до 20 слоёв.');
        const id = 'import-' + layers.length;
        ids.set(name,id);
        layers.push({id,name,visible:true,locked:false});
      }
      return {id:'import-shape-'+i,layer:ids.get(name),color:palette.includes(color)?color:palette[0],width:2,...shape,...(construction?{construction:true}:{})};
    });
    const extents = bounds(strokes);
    return {version:1,orientation:extents.maxY>840 && extents.maxX<=840?'portrait':'landscape',layers,activeLayer:layers[0].id,strokes};
  }

  function bounds(shapes) {
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    const use = ({x,y}) => { minX=Math.min(minX,x); minY=Math.min(minY,y); maxX=Math.max(maxX,x); maxY=Math.max(maxY,y); };
    for (const s of shapes) {
      if (s.type==='line') { use(s.a); use(s.b); }
      if (s.type==='path') s.points.forEach(use);
      if (s.type==='circle'||s.type==='arc') {
        use({x:s.cx-s.r,y:s.cy-s.r}); use({x:s.cx+s.r,y:s.cy+s.r});
      }
    }
    return {minX,minY,maxX,maxY};
  }

  function fitProject(project, fit = false) {
    const b=bounds(project.strokes), w=b.maxX-b.minX,h=b.maxY-b.minY;
    const width=project.orientation==='portrait'?840:1188, height=project.orientation==='portrait'?1188:840;
    const factor=fit?Math.min((width-64)/(w||1),(height-64)/(h||1)):1;
    const p = q => ({
      x:q.x*factor+(fit?(width-w*factor)/2-b.minX*factor:b.minX<0?20-b.minX:0),
      y:q.y*factor+(fit?(height-h*factor)/2-b.minY*factor:b.minY<0?20-b.minY:0)
    });
    return {...project,strokes:project.strokes.map(shape=>{
      if (shape.type==='line') return {...shape,a:p(shape.a),b:p(shape.b)};
      if (shape.type==='path') return {...shape,points:shape.points.map(p)};
      const center=p({x:shape.cx,y:shape.cy});
      return {...shape,cx:center.x,cy:center.y,r:shape.r*factor};
    })};
  }

  function parseTransform(value) {
    let current=identity;
    for (const [,name,raw] of (value||'').matchAll(/([a-z]+)\s*\(([^)]+)\)/gi)) {
      const t=values(raw), [a,b=0,c=0]=t;
      let next;
      if(name==='matrix'&&t.length===6) next=t;
      if(name==='translate'&&t.length>=1) next=[1,0,0,1,a,b];
      if(name==='scale'&&t.length>=1) next=[a,0,0,t[1]??a,0,0];
      if(name==='rotate'&&t.length>=1) {
        const radians=a*Math.PI/180, cos=Math.cos(radians), sin=Math.sin(radians);
        next=[cos,sin,-sin,cos,b-b*cos+c*sin,c-b*sin-c*cos];
      }
      if(name==='skewX'&&t.length>=1) next=[1,0,Math.tan(a*Math.PI/180),1,0,0];
      if(name==='skewY'&&t.length>=1) next=[1,Math.tan(a*Math.PI/180),0,1,0,0];
      if(!next||!next.every(Number.isFinite)) throw new Error('Неподдерживаемое преобразование SVG.');
      current=transform(current,next);
    }
    return current;
  }

  function physicalLength(value) {
    const m=/^\s*([0-9.]+)\s*(mm|cm|in|pt|pc|px)?\s*$/i.exec(value||'');
    return m?Number(m[1])*({mm:1,cm:10,in:25.4,pt:25.4/72,pc:25.4/6,px:25.4/96}[m[2]?.toLowerCase()||'px']):null;
  }

  function linearPath(source) {
    const tokens=source.match(/[MLHVZmlhvz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)||[];
    const points=[];
    let x=0,y=0,command='M';
    for(let i=0;i<tokens.length;){
      if(/^[MLHVZ]$/i.test(tokens[i])){
        command=tokens[i++];
        if(command.toUpperCase()==='Z'){
          if(points.length)points.push(points[0]);
          if(i<tokens.length)throw new Error('Неверное замыкание пути SVG.');
          break;
        }
      }
      const type=command.toUpperCase(), relative=command!==type;
      if(type==='H')x=(relative?x:0)+Number(tokens[i++]);
      else if(type==='V')y=(relative?y:0)+Number(tokens[i++]);
      else{
        x=(relative?x:0)+Number(tokens[i++]);
        y=(relative?y:0)+Number(tokens[i++]);
      }
      if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Неверные координаты пути SVG.');
      points.push({x,y});
      if(points.length>12000)throw new Error('В одном контуре SVG слишком много точек.');
      if(type==='M')command=relative?'l':'L';
    }
    return points;
  }

  function svg(source, doc=global.document) {
    const tree=new global.DOMParser().parseFromString(source,'image/svg+xml');
    const root=tree.documentElement;
    if (root.localName!=='svg'||tree.querySelector('parsererror')||tree.doctype)
      throw new Error('Не удалось прочитать безопасный SVG.');
    const box=values(root.getAttribute('viewBox'));
    const width=physicalLength(root.getAttribute('width')),height=physicalLength(root.getAttribute('height'));
    let sx=box[2]>0&&width?width*mm/box[2]:box[3]>0&&height?height*mm/box[3]:mm*25.4/96;
    let sy=box[3]>0&&height?height*mm/box[3]:sx, dx=0,dy=0;
    const aspect=root.getAttribute('preserveAspectRatio')||'xMidYMid meet';
    if(width&&height&&box[2]>0&&box[3]>0&&!aspect.startsWith('none')){
      sx=sy=aspect.includes('slice')?Math.max(sx,sy):Math.min(sx,sy);
      dx=(width*mm-box[2]*sx)*(aspect.includes('xMin')?0:aspect.includes('xMax')?1:.5);
      dy=(height*mm-box[3]*sy)*(aspect.includes('YMin')?0:aspect.includes('YMax')?1:.5);
    }
    const scale=[sx,0,0,sy,dx-(box[0]||0)*sx,dy-(box[1]||0)*sy];
    const entities=[];
    let approximated=0, visited=0;
    function walk(element, matrix, layer, inheritedColor, depth) {
      if(++visited>25000||depth>48) throw new Error('SVG слишком сложный для импорта.');
      if (element.getAttribute('display')==='none'||element.getAttribute('visibility')==='hidden') return;
      matrix=transform(matrix,parseTransform(element.getAttribute('transform')));
      const color=element.getAttribute('stroke')||inheritedColor;
      const name=element.localName;
      if(name==='g'||name==='svg') {
        const label=element.getAttributeNS('http://www.inkscape.org/namespaces/inkscape','label');
        for(const child of element.children) walk(child,matrix,label||element.id||layer,color,depth+1);
        return;
      }
      const n=(attr, fallback=0)=>Number(element.getAttribute(attr)??fallback);
      const p=(x,y)=>point(matrix,x,y);
      const emit=shape=>{
        const b=bounds([shape]);
        if (entities.length>=5000 || !Object.values(b).every(v=>Number.isFinite(v)&&Math.abs(v)<100000))
          throw new Error('Проверьте масштаб или сложность исходного файла.');
        entities.push({name:layer,shape,color});
      };
      if(name==='line') emit({type:'line',a:p(n('x1'),n('y1')),b:p(n('x2'),n('y2'))});
      if(name==='rect'&&n('width')>0&&n('height')>0){
        const x=n('x'),y=n('y'),w=n('width'),h=n('height');
        const rx=Math.min(w/2,n('rx',n('ry'))),ry=Math.min(h/2,n('ry',n('rx')));
        if (rx>0&&ry>0) {
          const corners=[[x+w-rx,y+ry,-90],[x+w-rx,y+h-ry,0],[x+rx,y+h-ry,90],[x+rx,y+ry,180]];
          const points=corners.flatMap(([cx,cy,start])=>Array.from({length:13},(_,i)=>{
            const angle=(start+i*7.5)*Math.PI/180;return p(cx+rx*Math.cos(angle),cy+ry*Math.sin(angle));
          }));
          emit({type:'path',points:[...points,points[0]]});approximated++;
        } else emit({type:'path',points:[p(x,y),p(x+w,y),p(x+w,y+h),p(x,y+h),p(x,y)]});
      }
      if(name==='circle'&&n('r')>0||name==='ellipse'&&n('rx')>0&&n('ry')>0) {
        const cx=n('cx'),cy=n('cy'),rx=n('r',n('rx')),ry=n('r',n('ry'));
        const [a,b,c,d]=matrix, ax=Math.hypot(a,b),ay=Math.hypot(c,d),center=p(cx,cy);
        if (Math.abs(ax*rx-ay*ry)<1e-8&&Math.abs(a*c+b*d)<1e-8)
          emit({type:'circle',cx:center.x,cy:center.y,r:ax*rx});
        else {
          emit({type:'path',points:Array.from({length:97},(_,i)=>p(cx+rx*Math.cos(i*Math.PI/48),cy+ry*Math.sin(i*Math.PI/48)))});
          approximated++;
        }
      }
      if(name==='polyline'||name==='polygon') {
        const list=values(element.getAttribute('points'));
        if(list.length>(name==='polygon'?23998:24000)) throw new Error('В одном контуре SVG слишком много точек.');
        const points=[];
        for(let i=0;i+1<list.length;i+=2) points.push(p(list[i],list[i+1]));
        if (name==='polygon'&&points.length) points.push(points[0]);
        if (points.length>1) emit({type:'path',points});
      }
      if(name==='path') {
        const data=element.getAttribute('d')||'';
        if(data.length>200000) throw new Error('Слишком длинный контур SVG.');
        const groups=data.match(/[mM][^mM]*/g)||[];
        if(groups.length>250) throw new Error('Слишком много подконтура в одном пути SVG.');
        let previousEnd={x:0,y:0};
        for(const segment of groups) {
          let d=segment;
          if(d[0]==='m'){
            const coordinates=[...d.matchAll(numberPattern)].slice(0,2);
            if(coordinates.length<2)continue;
            const end=coordinates[1].index+coordinates[1][0].length;
            const tail=d.slice(end).trimStart();
            d='M'+(previousEnd.x+Number(coordinates[0][0]))+' '+(previousEnd.y+Number(coordinates[1][0]))+(tail&&/^[-+\d.,]/.test(tail)?' l'+tail.replace(/^,/, ''):tail);
          }
          if(!/[CQSTA]/i.test(d)){
            const points=linearPath(d);
            previousEnd=points.at(-1)||previousEnd;
            if(points.length>1)emit({type:'path',points:points.map(({x,y})=>p(x,y))});
            continue;
          }
          // Use only path data from the input. The original SVG never enters the document.
          const path=doc.createElementNS('http://www.w3.org/2000/svg','path');
          path.setAttribute('d',d);
          const length=path.getTotalLength();
          if (!Number.isFinite(length)||length<=0) continue;
          previousEnd=path.getPointAtLength(length);
          const count=Math.min(1000,Math.max(1,Math.ceil(length*Math.max(Math.hypot(matrix[0],matrix[1]),Math.hypot(matrix[2],matrix[3]))/1.5)));
          const points=Array.from({length:count+1},(_,i)=>{
            const q=path.getPointAtLength(length*i/count);return p(q.x,q.y);
          });
          if (/[zZ]\s*$/.test(d)) points[count]=points[0];
          emit({type:'path',points});approximated++;
        }
      }
    }
    walk(root,scale,'SVG',null,0);
    return {project:result(entities),note:approximated?approximated+' кривых представлены ломаной.':'Масштаб прочитан из SVG.'};
  }

  function dxf(source) {
    const lines=source.trim().split(/\r?\n/);
    if (lines.length%2||lines.length>700000) throw new Error('Ожидается текстовый DXF.');
    const entities=[];
    let group, type='', inside=false, units=1, ignored=0;
    const newGroup=()=>({items:new Map(),xs:[],ys:[]});
    const unitFactors={0:1,1:25.4,2:304.8,4:1,5:10,6:1000,8:.0000254,9:.0254,10:914.4,13:.001,14:100};
    function flush() {
      if (!group||!inside) return;
      const {items,xs,ys}=group,n=key=>Number(items.get(key));
      const p=(x,y)=>({x:x*mm*units,y:-y*mm*units});
      let shape;
      if(type==='LINE') shape={type:'line',a:p(n(10),n(20)),b:p(n(11),n(21))};
      if((type==='CIRCLE'||type==='ARC')&&n(40)>0){
        const center=p(n(10),n(20));
        shape={type:type.toLowerCase(),cx:center.x,cy:center.y,r:n(40)*mm*units};
        if(type==='ARC') Object.assign(shape,{start:normalizeAngle(-n(50)),delta:-(normalizeAngle(n(51)-n(50))||360)});
      }
      if(type==='LWPOLYLINE'&&xs.length===ys.length&&xs.length>=2&&xs.length<=11999&&!group.bulge) {
        const points=xs.map((x,i)=>p(x,ys[i]));
        if(n(70)&1) points.push(points[0]);
        shape={type:'path',points};
      }
      if(!shape){ignored++;return;}
      if(!Object.values(bounds([shape])).every(v=>Number.isFinite(v)&&Math.abs(v)<100000))
        throw new Error('Координаты DXF выходят за пределы рабочего диапазона.');
      if(entities.length>=5000) throw new Error('В DXF больше 5000 элементов.');
      entities.push({name:items.get(8),shape,construction:items.get(6)==='DASHED'});
    }
    for(let i=0;i<lines.length;i+=2) {
      const code=Number(lines[i]), value=lines[i+1].trim();
      if(code===9&&value==='$INSUNITS'&&Number(lines[i+2])===70) {
        const selected=Number(lines[i+3]);
        if(!Object.hasOwn(unitFactors,selected)) throw new Error('Единицы DXF не поддерживаются.');
        units=unitFactors[selected];
      }
      if(code===0) {
        flush();group=null;type=value;
        if (value==='SECTION') inside=Number(lines[i+2])===2&&lines[i+3]?.trim()==='ENTITIES';
        else if (value==='ENDSEC'||value==='EOF') inside=false;
        else if(inside) group=newGroup();
      } else if(group) {
        group.items.set(code,value);
        if(code===10)group.xs.push(Number(value));
        if(code===20)group.ys.push(Number(value));
        if(code===42&&Number(value)!==0)group.bulge=true;
      }
    }
    flush();
    return {project:result(entities),note:ignored?'Пропущено неподдерживаемых объектов: '+ignored+'.':'Координаты DXF переведены в миллиметры.'};
  }

  function toDXF(project) {
    const lines=[], add=(...pairs)=>lines.push(...pairs);
    const used=new Set();
    const layerName=name=>{
      const safe=String(name||'').replace(/[<>/\\":;?*|=,\x00-\x1f]/g,'_').trim();
      const root=safe||'Layer';
      let resolved=root,i=2;
      while(used.has(resolved.toLowerCase()))resolved=root+'_'+i++;
      used.add(resolved.toLowerCase());
      return resolved;
    };
    const layers=new Map(project.layers.map(({id,name})=>[id,layerName(name)]));
    const visible=new Set(project.layers.filter(layer=>layer.visible!==false).map(layer=>layer.id));
    const n=q=>Number(q.toFixed(6));
    const coordinates=(p,x=10,y=20)=>[x,n(p.x/mm),y,n(-p.y/mm)];
    add(0,'SECTION',2,'HEADER',9,'$ACADVER',1,'AC1021',9,'$INSUNITS',70,4,0,'ENDSEC');
    add(0,'SECTION',2,'TABLES',0,'TABLE',2,'LTYPE',70,2,
      0,'LTYPE',100,'AcDbSymbolTableRecord',100,'AcDbLinetypeTableRecord',2,'CONTINUOUS',70,0,3,'Solid line',72,65,73,0,40,0,
      0,'LTYPE',100,'AcDbSymbolTableRecord',100,'AcDbLinetypeTableRecord',2,'DASHED',70,0,3,'Construction',72,65,73,2,40,3,49,2,74,0,49,-1,74,0,
      0,'ENDTAB',0,'TABLE',2,'LAYER',70,layers.size);
    for(const name of layers.values())add(0,'LAYER',100,'AcDbSymbolTableRecord',100,'AcDbLayerTableRecord',2,name,70,0,62,7,6,'CONTINUOUS');
    add(0,'ENDTAB',0,'ENDSEC',0,'SECTION',2,'ENTITIES');
    for(const s of project.strokes){
      if(!visible.has(s.layer)) continue;
      const layer=layers.get(s.layer)||layers.values().next().value;
      const attributes=[100,'AcDbEntity',8,layer,6,s.construction?'DASHED':'CONTINUOUS'];
      if(s.type==='line')add(0,'LINE',...attributes,100,'AcDbLine',...coordinates(s.a),...coordinates(s.b,11,21));
      if(s.type==='circle'||s.type==='arc'){
        const isArc=s.type==='arc'&&Math.abs(s.delta)<359.999;
        add(0,isArc?'ARC':'CIRCLE',...attributes,100,'AcDbCircle',...coordinates({x:s.cx,y:s.cy}),40,n(s.r/mm));
        if(isArc){
          const start=s.delta<0?s.start:s.start+s.delta,end=s.delta<0?s.start+s.delta:s.start;
          add(100,'AcDbArc',50,n(normalizeAngle(-start)),51,n(normalizeAngle(-end)));
        }
      }
      if(s.type==='path'&&s.points.length>1){
        const first=s.points[0],last=s.points.at(-1);
        const closed=first.x===last.x&&first.y===last.y;
        const points=closed?s.points.slice(0,-1):s.points;
        add(0,'LWPOLYLINE',...attributes,100,'AcDbPolyline',90,points.length,70,closed?1:0);
        for(const p of points)add(...coordinates(p));
      }
    }
    add(0,'ENDSEC',0,'EOF');
    return lines.join('\r\n')+'\r\n';
  }

  function stl(buffer) {
    const view=new DataView(buffer), triangles=[];
    const count=buffer.byteLength>=84?view.getUint32(80,true):0;
    if(count>0&&84+50*count===buffer.byteLength) {
      if(count>150000) throw new Error('В STL больше 150 000 треугольников.');
      for(let i=0;i<count;i++) {
        const offset=84+i*50+12;
        triangles.push(Array.from({length:3},(_,j)=>Array.from({length:3},(_,k)=>view.getFloat32(offset+j*12+k*4,true))));
      }
    } else {
      const decoded=new TextDecoder().decode(buffer);
      if(!/^\s*solid\b/i.test(decoded)) throw new Error('Не удалось прочитать STL.');
      let corners=[];
      for(const [,raw] of decoded.matchAll(/(?:^|\r?\n)\s*vertex\s+([^\r\n]+)/gi)){
        const p=values(raw);
        if(p.length!==3) throw new Error('Повреждённая вершина STL.');
        corners.push(p);
        if(corners.length===3) {triangles.push(corners);corners=[];}
        if(triangles.length>150000) throw new Error('В STL больше 150 000 треугольников.');
      }
      if(corners.length)throw new Error('Незавершённый треугольник STL.');
    }
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const face of triangles)for(const vertex of face)vertex.forEach((value,i)=>{
      if(!Number.isFinite(value)||Math.abs(value)>1000000)throw new Error('Координаты STL вне рабочего диапазона.');
      min[i]=Math.min(min[i],value);max[i]=Math.max(max[i],value);
    });
    if(!triangles.length)throw new Error('В STL нет треугольников.');
    return {triangles,min,max};
  }

  const api={svg,dxf,toDXF,stl,bounds,fitProject};
  if(typeof module==='object'&&module.exports)module.exports=api;
  global.LabProjectFormats=api;
})(typeof window==='undefined'?globalThis:window);
