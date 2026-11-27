/* Read-only mesh queries, in model millimetres. */
(function (global) {
  'use strict';
  const epsilon = 1e-7;
  const add = (a,b) => a.map((n,i) => n+b[i]);
  const sub = (a,b) => a.map((n,i) => n-b[i]);
  const scale = (a,k) => a.map(n => n*k);
  const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit = a => scale(a,1/(Math.hypot(...a)||1));
  const center = box => scale(add(box.min,box.max),.5);
  function bounds(points) {
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const p of points) for(let i=0;i<3;i++) { min[i]=Math.min(min[i],p[i]); max[i]=Math.max(max[i],p[i]); }
    return {min,max};
  }
  function triangle(a,b,c,index) {
    return {a,b,c,index,normal:unit(cross(sub(b,a),sub(c,a))),bounds:bounds([a,b,c])};
  }
  function triangles(mesh) {
    const list=[];
    for(let i=0;i<mesh.positions.length;i+=9){const p=Array.from(mesh.positions.subarray(i,i+9));list.push(triangle(p.slice(0,3),p.slice(3,6),p.slice(6),i/9));}
    return list;
  }
  function tree(items) {
    if(!items.length)return null;
    const box=bounds(items.flatMap(t=>[t.bounds.min,t.bounds.max]));
    if(items.length<=8)return {box,items};
    const size=sub(box.max,box.min),axis=size.indexOf(Math.max(...size));
    const sorted=items.slice().sort((a,b)=>(a.bounds.min[axis]+a.bounds.max[axis])-(b.bounds.min[axis]+b.bounds.max[axis]));
    const mid=Math.floor(sorted.length/2);
    return {box,left:tree(sorted.slice(0,mid)),right:tree(sorted.slice(mid))};
  }
  function rayBox(p,d,box,limit) {
    let start=0,end=limit;
    for(let i=0;i<3;i++){
      if(Math.abs(d[i])<epsilon){if(p[i]<box.min[i]-epsilon||p[i]>box.max[i]+epsilon)return false;continue;}
      const a=(box.min[i]-p[i])/d[i],b=(box.max[i]-p[i])/d[i];
      start=Math.max(start,Math.min(a,b));end=Math.min(end,Math.max(a,b));
      if(start>end+epsilon)return false;
    }
    return end>=0;
  }
  function rayTriangle(p,d,t) {
    const ab=sub(t.b,t.a),ac=sub(t.c,t.a),h=cross(d,ac),det=dot(ab,h);
    if(Math.abs(det)<epsilon)return Infinity;
    const delta=sub(p,t.a),u=dot(delta,h)/det;
    if(u < -epsilon || u > 1+epsilon)return Infinity;
    const q=cross(delta,ab),v=dot(d,q)/det;
    if(v < -epsilon || v+u > 1+epsilon)return Infinity;
    const distance=dot(ac,q)/det;
    return distance>epsilon ? distance : Infinity;
  }
  // The opposing wall is the first exit from this body, measured along the inward normal.
  function thickness(spatial,p,normal,ignore=-1) {
    const d=scale(unit(normal),-1);let best=Infinity;
    function visit(n){if(!n||!rayBox(p,d,n.box,best))return;
      if(!n.items){visit(n.left);visit(n.right);return;}
      for(const t of n.items){if(t.index===ignore||dot(t.normal,d)<=epsilon)continue;const k=rayTriangle(p,d,t);if(k<best)best=k;}
    }
    visit(spatial);return best;
  }
  // Subdivide broad faces so a pocket can appear locally on the back of a wall.
  function wallSamples(items,spatial) {
    const extent=Math.max(...sub(spatial.box.max,spatial.box.min));
    const maxDepth=Math.min(9,Math.max(0,Math.floor(Math.log2(40000/items.length))));
    const cells=[];
    function sample(a,b,c,t,depth){
      const verts=[a,b,c],lengths=verts.map((v,i)=>Math.hypot(...sub(v,verts[(i+1)%3])));
      const largest=Math.max(...lengths),i=lengths.indexOf(largest);
      if(depth<maxDepth&&largest>extent/16){const x=verts[i],y=verts[(i+1)%3],z=verts[(i+2)%3],mid=scale(add(x,y),.5);sample(x,mid,z,t,depth+1);sample(mid,y,z,t,depth+1);return;}
      const p=scale(add(add(a,b),c),1/3);cells.push({vertices:[...a,...b,...c],distance:thickness(spatial,p,t.normal,t.index)});
    }
    for(const t of items)sample(t.a,t.b,t.c,t,0);return cells;
  }
  function rotation(axis,angle) {
    const [x,y,z]=unit(sub(axis[1],axis[0])),c=Math.cos(angle),s=Math.sin(angle),v=1-c;
    const m=[c+x*x*v,x*y*v-z*s,x*z*v+y*s,y*x*v+z*s,c+y*y*v,y*z*v-x*s,z*x*v-y*s,z*y*v+x*s,c+z*z*v];
    const origin=axis[0];
    const offset=origin.map((value,i)=>value-m[i*3]*origin[0]-m[i*3+1]*origin[1]-m[i*3+2]*origin[2]);
    function apply(p,vector=false){
      return [0,1,2].map(i=>m[i*3]*p[0]+m[i*3+1]*p[1]+m[i*3+2]*p[2]+(vector?0:offset[i]));
    }
    function box(bounds){
      const midpoint=apply(center(bounds)),half=scale(sub(bounds.max,bounds.min),.5);
      const extents=[0,1,2].map(i=>Math.abs(m[i*3])*half[0]+Math.abs(m[i*3+1])*half[1]+Math.abs(m[i*3+2])*half[2]);
      return {min:sub(midpoint,extents),max:add(midpoint,extents)};
    }
    return {apply,box};
  }
  function rotated(p,axis,angle,vector=false) {return rotation(axis,angle).apply(p,vector);}
  function overlap(a,b){return [0,1,2].every(i=>a.max[i]>=b.min[i]-epsilon&&a.min[i]<=b.max[i]+epsilon);}
  // A proper crossing excludes tangent or coplanar initial contact at the axis.
  function crossing(t,q){
    for(const [moving,fixed] of [[t,q],[q,t]]){
      const v=[moving.a,moving.b,moving.c];
      for(let i=0;i<3;i++){
        const start=v[i],delta=sub(v[(i+1)%3],start),k=rayTriangle(start,delta,fixed);
        if(k>1e-6&&k<1-1e-6)return add(start,scale(delta,k));
      }
    }
    return null;
  }
  function coplanarOverlap(face,other) {
    const a=[face.a,face.b,face.c],b=[other.a,other.b,other.c];
    if(b.some(p=>Math.abs(dot(face.normal,sub(p,face.a)))>epsilon))return false;
    const normal=face.normal.map(Math.abs),axis=normal.indexOf(Math.max(...normal));
    const u=(axis+1)%3,v=(axis+2)%3;
    const side=(p,q,r)=>(q[u]-p[u])*(r[v]-p[v])-(q[v]-p[v])*(r[u]-p[u]);
    function separated(points,opposite) {
      const sign=Math.sign(side(...points));
      return points.some((p,i)=>{
        const q=points[(i+1)%3],tolerance=epsilon*Math.hypot(q[u]-p[u],q[v]-p[v]);
        return opposite.every(r=>sign*side(p,q,r)<=tolerance);
      });
    }
    // A shared seam has zero area and is separated by at least one edge.
    return !separated(a,b)&&!separated(b,a);
  }
  // A crease between connected faces is allowed. An overlapping surface or
  // a proper crossing elsewhere in the same mesh is not.
  function findSelfCrossing(faces,{includeCoplanar=false}={}) {
    const spatial=tree(faces),vertices=new Map();
    for(const face of faces)vertices.set(face.index,[face.a,face.b,face.c].map(p=>p.map(x=>Math.round(x/epsilon)).join(',')));
    function visit(node,face){
      if(!overlap(face.bounds,node.box))return null;
      if(!node.items)return visit(node.left,face)||visit(node.right,face);
      const found=node.items.find(other=>{
        if(other.index<=face.index||!overlap(face.bounds,other.bounds))return false;
        if(Math.abs(dot(face.normal,other.normal))>1-1e-12)return includeCoplanar&&coplanarOverlap(face,other);
        const shared=vertices.get(face.index).filter(key=>vertices.get(other.index).includes(key)).length;
        return shared<(includeCoplanar?2:1)&&crossing(face,other)!==null;
      });
      return found?[face.index,found.index]:null;
    }
    if(!spatial)return null;
    for(const face of faces){
      const found=visit(spatial,face);
      if(found)return found;
    }
    return null;
  }
  const hasSelfCrossing=(faces,options)=>findSelfCrossing(faces,options)!==null;
  function contact(moving,fixed,axis,angle) {
    if(!moving||!fixed)return null;
    const spatial=Array.isArray(moving)?tree(moving):moving,pose=rotation(axis,angle);
    function intersect(t,node) {
      if(!overlap(t.bounds,node.box))return null;
      if(!node.items)return intersect(t,node.left)||intersect(t,node.right);
      for(const q of node.items){
        if(!overlap(t.bounds,q.bounds))continue;
        const point=crossing(t,q);
        if(point)return {point,moving:t.index,other:q.index,obstacle:q};
      }
      return null;
    }
    function visit(node) {
      if(!node||!overlap(pose.box(node.box),fixed.box))return null;
      if(!node.items)return visit(node.left)||visit(node.right);
      for(const t of node.items){
        const moved=triangle(pose.apply(t.a),pose.apply(t.b),pose.apply(t.c),t.index);
        const found=intersect(moved,fixed);if(found)return found;
      }
      return null;
    }
    return visit(spatial);
  }
  function moveHinge(moving,fixed,axis,from,to,spacing) {
    const spatial=Array.isArray(moving)?tree(moving):moving;
    if(!spatial||!fixed)return {angle:to,collision:null};
    const axisDirection=unit(sub(axis[1],axis[0]));
    let radius=1;
    for(const x of [spatial.box.min[0],spatial.box.max[0]]) {
      for(const y of [spatial.box.min[1],spatial.box.max[1]]) {
        for(const z of [spatial.box.min[2],spatial.box.max[2]]) {
          radius=Math.max(radius,Math.hypot(...cross(sub([x,y,z],axis[0]),axisDirection)));
        }
      }
    }
    const travel=Math.abs(to-from);
    const startBox=rotation(axis,from).box(spatial.box),endBox=rotation(axis,to).box(spatial.box);
    const swept=bounds([startBox.min,startBox.max,endBox.min,endBox.max]);
    // Each rotating coordinate deviates from the line between its endpoints by
    // at most radius * travel² / 8. This lets disjoint sweeps skip sampling.
    const curvature=radius*travel*travel/8;
    for(let i=0;i<3;i++){swept.min[i]-=curvature;swept.max[i]+=curvature;}
    if(!overlap(swept,fixed.box))return {angle:to,collision:null};

    // Thin distant obstacles can cross between even 0.1° samples. Take smaller
    // steps when needed and leave any unchecked remainder to the next frame.
    const bound=Number.isFinite(spacing)&&spacing>0?spacing:.05;
    const step=Math.min(Math.PI/180,bound/(radius*4));
    const frameBudget=128;
    const progress=Math.min(travel,frameBudget*step);
    const target=progress===travel?to:from+Math.sign(to-from)*progress;
    const count=Math.min(frameBudget,Math.max(1,Math.ceil(progress/step)));
    let clear=from;
    for(let i=1;i<=count;i++){
      const test=from+(target-from)*i/count;let collision=contact(spatial,fixed,axis,test);
      if(collision){let stop=test;for(let j=0;j<9;j++){const mid=(clear+stop)/2,c=contact(spatial,fixed,axis,mid);if(c){stop=mid;collision=c;}else clear=mid;}return {angle:clear,collision};}
      clear=test;
    }
    return {angle:target,collision:null};
  }
  function transformed(mesh,point,normal) {
    function map(buffer,fn){const out=new Float32Array(buffer.length);for(let i=0;i<buffer.length;i+=3)out.set(fn([buffer[i],buffer[i+1],buffer[i+2]]),i);return out;}
    return {...mesh,positions:map(mesh.positions,point),normals:normal?map(mesh.normals,normal):mesh.normals,edges:map(mesh.edges,point),contours:[]};
  }
  function assembly(parts) {
    const count=parts.reduce((sum,p)=>sum+p.mesh.positions.length,0),edgeCount=parts.reduce((sum,p)=>sum+p.mesh.edges.length,0);
    const positions=new Float32Array(count),normals=new Float32Array(count),edges=new Float32Array(edgeCount),bodyIds=new Int32Array(count/9),surfaceTypes=new Uint8Array(count/9);
    let at=0,edge=0;parts.forEach((body,index)=>{const m=body.mesh;positions.set(m.positions,at);normals.set(m.normals,at);edges.set(m.edges,edge);bodyIds.fill(index,at/9,(at+m.positions.length)/9);if(m.surfaceTypes)surfaceTypes.set(m.surfaceTypes,at/9);at+=m.positions.length;edge+=m.edges.length;});
    return {positions,normals,edges,bodyIds,surfaceTypes,bodies:parts,contours:[]};
  }
  const api={add,sub,scale,dot,cross,unit,center,bounds,triangles,tree,thickness,wallSamples,rotated,rotation,contact,moveHinge,transformed,assembly,hasSelfCrossing,findSelfCrossing};
  global.LabInspectGeometry=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
