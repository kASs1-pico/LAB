/* Geometry queries for pointer snapping, CAD selection and erasing. */
(function (global) {
  'use strict';
  const I=global.LabInstruments;
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  const deg=radians=>radians*180/Math.PI;
  const snapCell=32;
  function segmentDistance(p,a,b) {const dx=b.x-a.x,dy=b.y-a.y;const t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
  function hits(shape,p,tolerance){
    if(shape.type==='line')return segmentDistance(p,shape.a,shape.b)<tolerance;
    if(shape.type==='path')return shape.points.length===1?I.distance(p,shape.points[0])<tolerance:shape.points.some((b,i)=>i>0&&segmentDistance(p,shape.points[i-1],b)<tolerance);
    if(Math.abs(Math.hypot(p.x-shape.cx,p.y-shape.cy)-shape.r)>tolerance)return false;
    if(shape.type==='circle'||Math.abs(shape.delta)>=359.8)return true;
    const angle=deg(Math.atan2(p.y-shape.cy,p.x-shape.cx));
    const progress=shape.delta>=0?I.normalizeAngle(angle-shape.start):I.normalizeAngle(shape.start-angle);
    return progress<=Math.abs(shape.delta)+deg(tolerance/shape.r);
  }

  function create(getState){
    let snapIndex=null;
    function sketchSnapIndex(){
      const state=getState();
      const layers=state.layers.filter(layer=>layer.visible).map(layer=>layer.id).join(',');
      if(snapIndex?.strokes===state.strokes&&snapIndex.length===state.strokes.length&&snapIndex.layers===layers)return snapIndex;
      const hiddenLayers=new Set(state.layers.filter(layer=>layer.visible===false).map(layer=>layer.id));
      const points=new Map(),byX=new Map(),byY=new Map(),segments=[],circles=[],centers=new Set();
      let order=0;
      function add(point){
        const {x,y}=point,key=`${Math.floor(x/snapCell)},${Math.floor(y/snapCell)}`;
        const item={point,order:order++};
        if(!points.has(key))points.set(key,[]);
        points.get(key).push(item);
        if(!byX.has(x))byX.set(x,item);
        if(!byY.has(y))byY.set(y,item);
      }
      const visible=state.strokes.filter(shape=>!hiddenLayers.has(shape.layer||'main'));
      function addSegment(a,b){
        const length=I.distance(a,b);
        if(length>0)segments.push({a,b,length,ux:(b.x-a.x)/length,uy:(b.y-a.y)/length});
        else segments.push({a,b,length,ux:0,uy:0});
      }
      for(const shape of visible){
        if(shape.type==='line'){add(shape.a);add(shape.b);addSegment(shape.a,shape.b);}
        if(shape.type==='path'){
          for(const point of shape.points)add(point);
          for(let i=1;i<shape.points.length&&segments.length<1200;i++)addSegment(shape.points[i-1],shape.points[i]);
        }
        if(shape.type==='circle'||shape.type==='arc'){
          const c={x:shape.cx,y:shape.cy};circles.push(shape);centers.add(`${c.x},${c.y}`);
          for(const p of [c,{x:c.x-shape.r,y:c.y},{x:c.x+shape.r,y:c.y},{x:c.x,y:c.y-shape.r},{x:c.x,y:c.y+shape.r}])add(p);
        }
      }
      const xAxis=[...byX.entries()].sort((a,b)=>a[0]-b[0]),yAxis=[...byY.entries()].sort((a,b)=>a[0]-b[0]);
      snapIndex={strokes:state.strokes,length:state.strokes.length,layers,visible,points,xAxis,yAxis,segments,circles,centers};
      return snapIndex;
    }
    function nearestSnapAxis(axis,target,tolerance){
      let lo=0,hi=axis.length;
      while(lo<hi){
        const mid=(lo+hi)>>1;
        if(axis[mid][0]<target)lo=mid+1;else hi=mid;
      }
      const before=axis[lo-1],after=axis[lo];
      const left=before?target-before[0]:Infinity,right=after?after[0]-target:Infinity;
      if(Math.min(left,right)>=tolerance)return null;
      if(left===right)return before[1].order<after[1].order?before[1].point:after[1].point;
      return (left<right?before:after)[1].point;
    }
    function sketchPickIndex(){
      const index=sketchSnapIndex();
      if(index.pick)return index.pick;
      const cells=new Map(),wide=[];
      const shapes=index.visible.filter(shape=>!shape.construction);
      function include(shape,order,minX,maxX,minY,maxY,a,b){
        const record={shape,order,minX,maxX,minY,maxY,a,b};
        const left=Math.floor(minX/snapCell),right=Math.floor(maxX/snapCell);
        const top=Math.floor(minY/snapCell),bottom=Math.floor(maxY/snapCell);
        if((right-left+1)*(bottom-top+1)>16){wide.push(record);return;}
        for(let x=left;x<=right;x++)for(let y=top;y<=bottom;y++){
          const key=`${x},${y}`;
          if(!cells.has(key))cells.set(key,[]);
          cells.get(key).push(record);
        }
      }
      shapes.forEach((shape,order)=>{
        if(shape.cx!==undefined){
          const {cx,cy,r}=shape;
          include(shape,order,cx-r,cx+r,cy-r,cy+r);
          return;
        }
        const anchors=shape.points||[shape.a,shape.b];
        if(anchors.length===1){
          const [a]=anchors;
          include(shape,order,a.x,a.x,a.y,a.y,a,a);
        }
        for(let i=1;i<anchors.length;i++){
          const a=anchors[i-1],b=anchors[i];
          include(shape,order,Math.min(a.x,b.x),Math.max(a.x,b.x),Math.min(a.y,b.y),Math.max(a.y,b.y),a,b);
        }
      });
      index.pick={cells,wide};
      return index.pick;
    }
    function getSketchHits(point,tolerance){
      if(!Number.isFinite(tolerance)||tolerance<=0)return [];
      const {x,y}=point,{cells,wide}=sketchPickIndex(),found=new Map(),checked=new Set();
      const left=x-tolerance,right=x+tolerance,top=y-tolerance,bottom=y+tolerance;
      function consider(record){
        const {shape,a,b,order,minX,maxX,minY,maxY}=record;
        if(maxX<left||minX>right||maxY<top||minY>bottom||checked.has(record))return;
        checked.add(record);
        let distance;
        if(a)distance=segmentDistance(point,a,b);
        else{
          distance=Math.abs(Math.hypot(x-shape.cx,y-shape.cy)-shape.r);
          if(shape.type==='arc'&&!hits(shape,point,tolerance))return;
        }
        if(distance<tolerance&&distance<(found.get(shape.id)?.distance??Infinity))found.set(shape.id,{shape,distance,order});
      }
      for(const record of wide)consider(record);
      for(let col=Math.floor(left/snapCell);col<=Math.floor(right/snapCell);col++){
        for(let row=Math.floor(top/snapCell);row<=Math.floor(bottom/snapCell);row++){
          for(const record of cells.get(`${col},${row}`)||[])consider(record);
        }
      }
      return [...found.values()].sort((a,b)=>a.distance-b.distance||a.order-b.order)
        .map(({shape,order,distance})=>({id:shape.id,index:order,distance}));
    }
    function snap(raw,origin,tolerance){
      const state=getState();
      const {points,xAxis,yAxis,segments,circles,centers}=sketchSnapIndex();
      let result={x:Math.round(raw.x/20)*20,y:Math.round(raw.y/20)*20},nearest=null,best=tolerance*tolerance,bestOrder=Infinity,labels=[],guides=[];
      const minX=Math.floor((raw.x-tolerance)/snapCell),maxX=Math.floor((raw.x+tolerance)/snapCell);
      const minY=Math.floor((raw.y-tolerance)/snapCell),maxY=Math.floor((raw.y+tolerance)/snapCell);
      for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++){
        for(const {point,order} of points.get(`${x},${y}`)||[]){
          const distance=(point.x-raw.x)**2+(point.y-raw.y)**2;
          if(distance<best||nearest&&distance===best&&order<bestOrder){best=distance;bestOrder=order;nearest=point;}
        }
      }
      if(origin&&(origin.x-raw.x)**2+(origin.y-raw.y)**2<best)nearest=origin;
      if(nearest){result={...nearest};labels.push(centers.has(`${nearest.x},${nearest.y}`)?'Центр':'Точка');}
      else{
        let ax=nearestSnapAxis(xAxis,raw.x,tolerance*.7),ay=nearestSnapAxis(yAxis,raw.y,tolerance*.7);
        if(origin){
          if(Math.abs(origin.x-raw.x)<(ax?Math.abs(ax.x-raw.x):tolerance*.7))ax=origin;
          if(Math.abs(origin.y-raw.y)<(ay?Math.abs(ay.y-raw.y):tolerance*.7))ay=origin;
        }
        if(ax){result.x=ax.x;result.y=raw.y;guides.push([ax,{x:ax.x,y:raw.y}]);labels.push('По вертикали');}
        if(ay){result.y=ay.y;if(!ax)result.x=raw.x;guides.push([ay,{x:result.x,y:ay.y}]);labels.push('По горизонтали');}
        if(origin&&I.distance(origin,raw)>tolerance*2){
          let tangent=null,tangentDistance=tolerance;
          for(const circle of circles){
            if(Math.abs(Math.hypot(raw.x-circle.cx,raw.y-circle.cy)-circle.r)>=tolerance)continue;
            const dx=origin.x-circle.cx,dy=origin.y-circle.cy,d2=dx*dx+dy*dy,r=circle.r;
            if(d2<=r*r+1e-6)continue;
            const base=r*r/d2,side=r*Math.sqrt(d2-r*r)/d2;
            for(const sign of [-1,1]){const p={x:circle.cx+base*dx-sign*side*dy,y:circle.cy+base*dy+sign*side*dx},distance=I.distance(p,raw);if(distance<tangentDistance){tangent=p;tangentDistance=distance;}}
          }
          if(tangent){result=tangent;labels=['Касательная'];guides=[[origin,tangent]];}
          else if(!ax&&!ay){
            let projected=null,parallelDistance=tolerance*.6;
            let equal=null,difference=tolerance*.6;
            const rawLength=I.distance(origin,raw);
            for(const segment of segments){
              const {a,b,length,ux,uy}=segment;
              if(length<tolerance*2)continue;
              const deviation=Math.abs(length-rawLength);
              if(length>tolerance*2&&deviation<difference){difference=deviation;equal=segment;}
              const t=(raw.x-origin.x)*ux+(raw.y-origin.y)*uy;
              if(Math.abs(t)<tolerance*2)continue;
              const p={x:origin.x+ux*t,y:origin.y+uy*t},distance=I.distance(p,raw);
              if(distance<parallelDistance){parallelDistance=distance;projected={p,a,b};}
            }
            if(projected){result=projected.p;guides=[[projected.a,projected.b],[origin,result]];labels=['Параллельно'];}
            const length=I.distance(origin,result);
            if(equal&&length>1e-7){result={x:origin.x+(result.x-origin.x)*equal.length/length,y:origin.y+(result.y-origin.y)*equal.length/length};guides.push([equal.a,equal.b],[origin,result]);labels.push('Равная длина');}
          }
        }
      }
      result={x:clamp(result.x,0,state.width),y:clamp(result.y,0,state.height)};
      return {result,guides,labels};
    }
    return {snap,getSketchHits};
  }
  global.LabSketchSpatialIndex=Object.freeze({create,hits});
})(typeof window==="undefined"?globalThis:window);
