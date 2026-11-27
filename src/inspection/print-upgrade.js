/* Bed limits, section previews and mesh checks in model millimetres. */
(function (global) {
  'use strict';

  const epsilon=1e-5;
  const profiles=Object.freeze({
    compact:Object.freeze({name:'Компактный · 120 × 120 × 120',size:Object.freeze([120,120,120])}),
    school:Object.freeze({name:'Учебный · 220 × 220 × 250',size:Object.freeze([220,220,250])}),
    large:Object.freeze({name:'Увеличенный · 300 × 300 × 300',size:Object.freeze([300,300,300])})
  });
  const validSize=size=>Array.isArray(size)&&size.length===3&&[...size].every(n=>Number.isFinite(n)&&n>=5&&n<=10000);
  function printerPreference(value){
    const profile=Object.hasOwn(profiles,value?.profile)||value?.profile==='custom'?value.profile:'school';
    const size=validSize(value?.size)?value.size:profiles.school.size;
    return {profile,size:size.slice()};
  }

  function fits(bounds,bed) {
    const size=bounds.max.map((value,axis)=>value-bounds.min[axis]);
    return {size,overflow:size.map((value,axis)=>Math.max(0,value-bed[axis])),fits:size.every((value,axis)=>value<=bed[axis]+epsilon)};
  }

  function* orientationScores(mesh,bed,threshold) {
    const G=global.LabInspectGeometry;
    const geometry=global.LabDrawingGeometry;
    const faces=G.triangles(mesh);
    const byDirection=new Map();
    for (const face of faces) {
      const up=G.scale(face.normal,-1);
      const key=up.map(value=>Math.round(value*50)).join(',');
      const area=Math.hypot(...G.cross(G.sub(face.b,face.a),G.sub(face.c,face.a)))/2;
      if (area<=epsilon) continue;
      const group=byDirection.get(key);
      if (group) group.area+=area;
      else byDirection.set(key,{up,area});
    }
    const axes=[[0,0,1],[0,0,-1],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0]];
    const planar=[...byDirection.values()].sort((a,b)=>b.area-a.area);
    for (const {up} of planar) {
      if (axes.length>=12) break;
      if (axes.every(axis=>G.dot(axis,up)<.9995)) axes.push(up);
    }
    for(const [index,up] of axes.entries()){
      const {mesh:positioned,contactArea,overhangArea}=geometry.printOrientation(mesh,up,threshold);
      yield {up,index,contactArea,overhangArea,...fits(positioned.bounds,bed)};
    }
  }
  function rankOrientation(scores){
    return scores.sort((a,b)=>{
      if (a.fits!==b.fits) return a.fits?-1:1;
      const hasBase=value=>value.contactArea>epsilon;
      if (hasBase(a)!==hasBase(b)) return hasBase(a)?-1:1;
      return a.overhangArea-b.overhangArea||b.contactArea-a.contactArea||a.size[2]-b.size[2]||a.index-b.index;
    });
  }
  const orientationOptions=(mesh,bed,threshold)=>rankOrientation([...orientationScores(mesh,bed,threshold)]);

  function sectionSegments(positions,z) {
    const segments=[];
    for (let i=0;i<positions.length;i+=9) {
      const intersections=[];
      for (let edge=0;edge<3;edge++) {
        const a=i+edge*3,b=i+((edge+1)%3)*3;
        const lo=positions[a+2],hi=positions[b+2];
        // Include only one end of an edge when the plane goes through a vertex.
        if ((lo>z)===(hi>z)) continue;
        const t=(z-lo)/(hi-lo);
        intersections.push([positions[a]+t*(positions[b]-positions[a]),positions[a+1]+t*(positions[b+1]-positions[a+1])]);
      }
      if (intersections.length===2&&Math.hypot(intersections[1][0]-intersections[0][0],intersections[1][1]-intersections[0][1])>1e-9) segments.push(intersections);
    }
    return segments;
  }

  function intervalsAt(segments,y) {
    const xs=[];
    for (const [[ax,ay],[bx,by]] of segments) {
      if ((ay>y)===(by>y)) continue;
      xs.push(ax+(bx-ax)*(y-ay)/(by-ay));
    }
    xs.sort((a,b)=>a-b);
    const intervals=[];
    for (let i=1;i<xs.length;i+=2) if(xs[i]-xs[i-1]>epsilon)intervals.push([xs[i-1],xs[i]]);
    return intervals;
  }

  function unsupportedBands(current,previous,bounds) {
    const bands=[];
    const depth=bounds.max[1]-bounds.min[1];
    if (depth<=epsilon) return bands;
    const step=depth/100;
    for (let row=0;row<100;row++) {
      const y=bounds.min[1]+(row+.5)*step;
      const below=intervalsAt(previous,y);
      for (const [from,to] of intervalsAt(current,y)) {
        let left=from;
        for (const [start,end] of below) {
          if (end<=left) continue;
          if (start>=to) break;
          if (start-left>epsilon) bands.push([left,y-step/2,start-left,step]);
          left=Math.max(left,end);
          if (left>=to) break;
        }
        if (to-left>epsilon) bands.push([left,y-step/2,to-left,step]);
      }
    }
    return bands;
  }

  function layerPreview(mesh,height,index) {
    if (!Number.isFinite(height)||height<=0) throw new Error('Задайте положительную высоту слоя.');
    const bottom=mesh.bounds.min[2],top=mesh.bounds.max[2];
    const count=Math.max(1,Math.ceil((top-bottom)/height-epsilon));
    const layer=Math.min(count-1,Math.max(0,Math.floor(index)||0));
    const plane=i=>{
      const from=bottom+i*height,to=Math.min(top,from+height);
      return (from+to)/2;
    };
    const z=plane(layer);
    const current=sectionSegments(mesh.positions,z);
    const previous=layer>0?sectionSegments(mesh.positions,plane(layer-1)):[];
    return {z,count,layer,current,previous,bands:layer>0?unsupportedBands(current,previous,mesh.bounds):[]};
  }

  function meshIssues(mesh) {
    const G=global.LabInspectGeometry;
    const edges=new Map();
    const degenerate=[];
    const wrongFaces=[];
    const faces=G.triangles(mesh);
    const origin=faces[0]?.a??[0,0,0];
    let signedVolumeTimesSix=0;
    const key=point=>point.map(value=>Math.round(value/epsilon)).join(',');
    for (const face of faces) {
      const vertices=[face.a,face.b,face.c];
      const keys=vertices.map(key);
      if (new Set(keys).size<3||Math.hypot(...face.normal)<.5) {
        degenerate.push(face.index);
        continue;
      }
      signedVolumeTimesSix+=G.dot(G.sub(face.a,origin),G.cross(G.sub(face.b,origin),G.sub(face.c,origin)));
      for (let i=0;i<3;i++) {
        const j=(i+1)%3,forward=keys[i]<keys[j];
        const edge=forward?keys[i]+'|'+keys[j]:keys[j]+'|'+keys[i];
        const record=edges.get(edge)||{vertices:[vertices[i],vertices[j]],count:0,net:0,faces:[]};
        record.count++;
        record.net+=forward?1:-1;
        if(record.faces.length<2)record.faces.push(face.index);
        edges.set(edge,record);
      }
    }
    const open=[],nonManifold=[],flipped=[];
    for (const {vertices,count,net,faces:neighbours} of edges.values()) {
      if (count===1) open.push(vertices);
      else if (count>2) nonManifold.push(vertices);
      else if (net!==0) {
        flipped.push(vertices);
        wrongFaces.push(...neighbours);
      }
    }
    const inverted=!open.length&&!nonManifold.length&&!flipped.length&&signedVolumeTimesSix< -epsilon;
    const crossing=G.findSelfCrossing(faces.filter(face=>Math.hypot(...face.normal)>.5),{includeCoplanar:true});
    // Limit overlay size while preserving the full diagnostic counts.
    const markedFaces=new Set([...degenerate.slice(0,250),...wrongFaces.slice(0,250),...(crossing||[])]);
    if(inverted)for(const face of faces.slice(0,500))markedFaces.add(face.index);
    const highlights=[...markedFaces].flatMap(index=>Array.from(mesh.positions.subarray(index*9,index*9+9)));
    const marks=[...open.slice(0,500),...nonManifold.slice(0,500),...flipped.slice(0,500)].flat(2);
    return {open:open.length,nonManifold:nonManifold.length,flipped:flipped.length,degenerate:degenerate.length,inverted,crossing:crossing!==null,highlights,marks};
  }

  const api=Object.freeze({profiles,validSize,printerPreference,fits,orientationOptions,orientationScores,rankOrientation,sectionSegments,layerPreview,meshIssues});
  global.LabPrintGeometry=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
