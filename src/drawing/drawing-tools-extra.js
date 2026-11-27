/* Drawing-sheet extensions and deterministic geometry for dimension reports. */
(function (root) {
  'use strict';
  const views=['top','front','side'];
  const within=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const requireValue=(ok,message='Проверьте параметры оформления чертежа.')=>{if(!ok)throw new Error(message);};
  const point=p=>Array.isArray(p)&&p.length===2&&p.every(n=>within(n,-1e6,1e6));
  const strictView=v=>{requireValue(views.includes(v));return v;};
  const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
  const vector=v=>Array.isArray(v)&&v.length===3&&v.every(n=>within(n,-1,1))&&within(Math.hypot(...v),.99,1.01);
  const bounds=b=>Array.isArray(b)&&b.length===4&&point(b.slice(0,2))&&point(b.slice(2))&&b[0]<=b[2]&&b[1]<=b[3];
  const segment=s=>Array.isArray(s)&&s.length===2&&s.every(point);
  function validate(value){
    requireValue(value&&typeof value==='object');
    const result={};
    if(value.auxiliary){
      requireValue(vector(value.auxiliary.normal));
      result.auxiliary={normal:value.auxiliary.normal.slice()};
    }
    if(value.local){
      const {view,box,depth}=value.local;
      requireValue(bounds(box)&&box[2]-box[0]>.005&&box[3]-box[1]>.005&&within(depth,.001,.999));
      result.local={view:strictView(view),box:box.slice(),depth};
    }
    if(value.break){
      const {view,axis,start,end}=value.break;
      requireValue(['x','y'].includes(axis)&&within(start,.02,.95)&&within(end,start+.025,.98));
      result.break={view:strictView(view),axis,start,end};
    }
    if(value.ordinates){
      const {view,origin,targets}=value.ordinates;
      requireValue(point(origin)&&Array.isArray(targets)&&targets.length<=30&&targets.every(point));
      result.ordinates={view:strictView(view),origin:origin.slice(),targets:targets.map(p=>p.slice())};
    }
    if(value.chain){
      requireValue(Array.isArray(value.chain)&&value.chain.length>=1&&value.chain.length<=20);
      result.chain=value.chain.map(({name,nominal,lower,upper,sign})=>{
        requireValue(within(nominal,0,10000)&&within(lower,-1000,1000)&&within(upper,lower,1000)&&[1,-1].includes(sign));
        return {name:text(name,24),nominal,lower,upper,sign};
      });
    }
    if(value.callouts){
      requireValue(Array.isArray(value.callouts)&&value.callouts.length<=30);
      result.callouts=value.callouts.map(({kind,view,at,ra,diameter,pitch,depth,bodyId,key})=>{
        requireValue(point(at));
        if(kind==='roughness'){
          requireValue(within(ra,.001,1000));
          return {kind,view:strictView(view),at:at.slice(),ra};
        }
        requireValue(kind==='thread'&&within(diameter,.1,200)&&within(pitch,.01,20)&&within(depth,.1,500));
        const result={kind,view:strictView(view),at:at.slice(),diameter,pitch,depth};
        if(bodyId!==undefined||key!==undefined){
          requireValue(typeof bodyId==='string'&&/^body-[a-z0-9_-]{1,90}$/i.test(bodyId)&&
            typeof key==='string'&&/^[sf]:[a-z0-9_-]{1,96}(?::(?:shaft|head))?$/i.test(key));
          Object.assign(result,{bodyId,key});
        }
        return result;
      });
    }
    if(value.baseline){
      const {name,views:stored}=value.baseline;
      requireValue(stored&&views.every(view=>Array.isArray(stored[view])&&stored[view].length<=1200&&stored[view].every(segment)));
      result.baseline={name:text(name,34),views:Object.fromEntries(views.map(view=>[view,stored[view].map(s=>s.map(p=>p.slice()))]))};
    }
    if(value.calibration){
      const {length,measured}=value.calibration;
      requireValue(within(length,10,150)&&within(measured,1,250));
      result.calibration={length,measured};
    }
    return result;
  }
  function dimensionChain(rows){
    let nominal=0,low=0,high=0;
    for(const row of rows){
      const {nominal:size,lower,upper,sign}=row;
      nominal+=sign*size;
      low+=sign*(size+(sign===1?lower:upper));
      high+=sign*(size+(sign===1?upper:lower));
    }
    return {nominal,min:low,max:high};
  }
  const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
  const cross=([x,y,z],[u,v,w])=>[y*w-z*v,z*u-x*w,x*v-y*u];
  const unit=v=>{const size=Math.hypot(...v);return v.map(n=>n/size);};
  function basis(normal){
    const n=unit(normal),axis=Math.abs(n[2])>.93?[0,1,0]:[0,0,1],u=unit(cross(axis,n)),v=cross(n,u);
    return p=>[dot(u,p),dot(v,p),dot(n,p)];
  }
  function normals(mesh){
    const result=new Map();
    for(let i=0;i<mesh.normals.length;i+=9){
      const n=Array.from(mesh.normals.subarray(i,i+3));
      if(Math.hypot(...n)<.1)continue;
      const key=n.map(v=>Math.round(v*100)).join(',');
      if(!result.has(key))result.set(key,{normal:unit(n),count:0});
      result.get(key).count++;
    }
    return [...result.values()].sort((a,b)=>b.count-a.count).slice(0,80).map(x=>x.normal);
  }
  function localSection(mesh,descriptor){
    const project=p=>root.LabDrawingGeometry.projectPoint(descriptor.view,p);
    const local=root.LabInspectGeometry.transformed(mesh,project,project);
    const range={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
    for(let i=0;i<local.positions.length;i++){
      const axis=i%3,n=local.positions[i];
      range.min[axis]=Math.min(range.min[axis],n);range.max[axis]=Math.max(range.max[axis],n);
    }
    local.bounds=range;
    const sliced=root.LabExtrusion.section(local,{axis:'z',position:1-descriptor.depth});
    const triangles=[],segments=[];
    for(let i=0;i<sliced.capPositions.length;i+=9){
      triangles.push([0,3,6].map(j=>Array.from(sliced.capPositions.subarray(i+j,i+j+2))));
    }
    for(let i=0;i<sliced.edges.length;i+=6){
      segments.push([Array.from(sliced.edges.subarray(i,i+2)),Array.from(sliced.edges.subarray(i+3,i+5))]);
    }
    return {triangles,segments};
  }
  function breakProjection(projection,descriptor){
    const axis=descriptor.axis==='x'?0:1,bounds=projection.bounds.slice();
    const lo=bounds[axis],hi=bounds[axis+2],span=hi-lo;
    const a=lo+descriptor.start*span,b=lo+descriptor.end*span,gap=Math.min((b-a)*.4,span*.04),removed=b-a-gap;
    const clipped=[];
    for(const [p,q] of projection.visible){
      const d=q[axis]-p[axis];
      for(const [cut,end,shift] of [[lo,a,0],[b,hi,removed]]){
        let t=[0,1];
        if(Math.abs(d)<1e-8){if(p[axis]<cut-1e-8||p[axis]>end+1e-8)continue;}
        else{
          const [x,z]=[(cut-p[axis])/d,(end-p[axis])/d].sort((x,z)=>x-z);
          t=[Math.max(0,x),Math.min(1,z)];
          if(t[0]>=t[1])continue;
        }
        clipped.push(t.map(k=>p.slice(0,2).map((n,i)=>n+(q[i]-n)*k-(i===axis?shift:0))));
      }
    }
    bounds[axis+2]-=removed;
    return {visible:clipped,bounds,axis,cuts:[a,a+gap],length:span};
  }
  function snapshot(projections){
    return Object.fromEntries(views.map(view=>{
      const segments=new Map();
      for(const [a,b] of [...projections[view].visible,...projections[view].hidden]){
        const segment=[a.slice(0,2),b.slice(0,2)];
        segments.set(edgeKey(segment),segment);
      }
      return [view,[...segments.values()]];
    }));
  }
  const key=p=>p.map(n=>Math.round(n*100)).join(',');
  const edgeKey=s=>s.map(key).sort().join('/');
  function changes(previous,current){
    const prior=new Set(previous.map(edgeKey)),next=new Set(current.map(edgeKey));
    return {added:current.filter(s=>!prior.has(edgeKey(s))),removed:previous.filter(s=>!next.has(edgeKey(s)))};
  }
  function occupied(boxes,width,height){
    const out=boxes.filter(({box:b})=>b[0]<8||b[1]<8||b[2]>width-8||b[3]>height-24),pairs=[];
    const overlap=(a,b)=>a[0]+.2<b[2]&&b[0]+.2<a[2]&&a[1]+.2<b[3]&&b[1]+.2<a[3];
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
      if(overlap(boxes[i].box,boxes[j].box))pairs.push([boxes[i],boxes[j]]);
    }
    return {out,pairs};
  }
  const api={views,validate,dimensionChain,basis,normals,localSection,breakProjection,snapshot,changes,occupied};
  root.LabDrawingExtra=Object.freeze(api);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
