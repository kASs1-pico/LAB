/* SVG thumbnails for sketches and a local STL inspection canvas. */
(function (global) {
  'use strict';

  function pathData(shape) {
    if (shape.type === 'line') return 'M'+shape.a.x+' '+shape.a.y+'L'+shape.b.x+' '+shape.b.y;
    if (shape.type === 'path' && shape.points.length) {
      const points = shape.points, last = points.length - 1;
      const stride = Math.max(1, Math.ceil(points.length / 400));
      let path = 'M'+points[0].x+' '+points[0].y;
      for (let i = stride; i < last; i += stride) path += 'L'+points[i].x+' '+points[i].y;
      if (last) path += 'L'+points[last].x+' '+points[last].y;
      return path;
    }
    if (shape.type === 'circle' || shape.type === 'arc') {
      const start = shape.start || 0, sweep = shape.type === 'circle' ? 360 : shape.delta;
      const pieces = Math.max(2, Math.ceil(Math.abs(sweep)/6));
      return Array.from({length: pieces+1}, (_,i) => {
        const angle = (start+sweep*i/pieces)*Math.PI/180;
        return (i?'L':'M')+(shape.cx+shape.r*Math.cos(angle))+' '+(shape.cy+shape.r*Math.sin(angle));
      }).join('');
    }
    return '';
  }

  function thumbnail(project) {
    const layers = project.layers?.length ? new Set(project.layers.filter(layer => layer.visible !== false).map(layer => layer.id)) : null;
    const paths = [];
    for (const shape of project.strokes) {
      if (layers && !layers.has(shape.layer)) continue;
      const d = pathData(shape);
      if (d) paths.push({d, id:shape.id, color:shape.color, width:shape.width, construction:shape.construction});
      if (paths.length >= 1300) break;
    }
    return {orientation:project.orientation, paths};
  }

  function sketchSVG({orientation, paths}, className='') {
    const namespace = 'http://www.w3.org/2000/svg';
    const root = document.createElementNS(namespace, 'svg');
    root.setAttribute('viewBox', orientation==='portrait' ? '0 0 840 1188' : '0 0 1188 840');
    root.setAttribute('class', 'project-miniature '+className);
    root.setAttribute('aria-hidden', 'true');
    for (const shape of paths) {
      const path=document.createElementNS(namespace,'path');
      path.setAttribute('d',shape.d);
      path.setAttribute('stroke',shape.construction?'#8a99a9':shape.color||'#263c46');
      if(shape.construction)path.setAttribute('stroke-dasharray','8 6');
      path.setAttribute('stroke-width',Math.max(shape.width||2,3.4));
      path.setAttribute('fill','none');
      path.dataset.shape=shape.id;
      root.append(path);
    }
    return root;
  }

  function renderSTL(parent,mesh,{app,create,button,note,confirmStep,dialog}){
    const toolbar=create('div',null,'project-workspace-actions');
    const size=mesh.max.map((max,i)=>(max-mesh.min[i]).toFixed(2));
    parent.append(create('strong','Габариты · '+size.join(' × ')+' мм'));
    const canvas=create('canvas');canvas.width=640;canvas.height=350;
    canvas.className='project-stl';canvas.setAttribute('aria-label','Проекция сетки STL');
    let mode='iso', picks=[], coordinates=[];
    const step=Math.max(1,Math.ceil(mesh.triangles.length/6500));
    const faces=mesh.triangles.filter((_,i)=>i%step===0);
    const context=canvas.getContext('2d');
    const result=create('p','Отметьте две вершины для замера. На ортогональном виде выбираются передние вершины.');
    const projections={top:([x,y,z])=>[x,-y,z],front:([x,y,z])=>[x,-z,y],right:([x,y,z])=>[y,-z,x],iso:([x,y,z])=>[(x-y)*.87,(x+y)*.5-z,(x+y)*.5+z]};
    function draw(){
      const mapped=faces.map(face=>face.map(projections[mode]));
      let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
      for(const face of mapped)for(const [x,y] of face){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
      const scale=Math.min(564/(right-left||1),292/(bottom-top||1));
      const screen=([x,y,z])=>[320+(x-(left+right)/2)*scale,175+(y-(top+bottom)/2)*scale,z];
      context.fillStyle='#f0f5fa';context.fillRect(0,0,640,350);
      context.lineWidth=.7;context.strokeStyle='#536f88';
      coordinates=[];
      for(let i=0;i<mapped.length;i++){
        const face=mapped[i].map(screen);
        context.beginPath();context.moveTo(...face[0].slice(0,2));
        for(let j=1;j<3;j++)context.lineTo(...face[j].slice(0,2));
        context.closePath();context.stroke();
        face.forEach((p,j)=>coordinates.push({screen:p,position:faces[i][j]}));
      }
      picks.forEach(({position},i)=>{
        const [x,y]=screen(projections[mode](position));
        context.fillStyle=i?'#b23c05':'#105ccc';context.beginPath();context.arc(x,y,6,0,Math.PI*2);context.fill();
      });
    }
    for(const [target,label] of Object.entries({iso:'Объём',top:'Сверху',front:'Спереди',right:'Справа'}))
      toolbar.append(button(label,()=>{mode=target;draw();}));
    if(step>1) parent.append(create('p','Предпросмотр и замер используют часть треугольников крупной сетки.'));
    toolbar.append(button('Положить как кальку',()=>{
      if(mode==='iso'){note('Выберите вид сверху, спереди или справа.');return;}
      const apply=()=>{
        const viewport=app.getViewport(), projection=projections[mode];
        let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
        for(const face of mesh.triangles)for(const vertex of face){
          const [x,y]=projection(vertex);
          left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
        }
        const width=(right-left)*4,height=(bottom-top)*4;
        if(!(width>0&&height>0)||width>100000||height>100000){note('Эту проекцию невозможно разместить в масштабе.');return;}
        if(document.getElementById('welcome-dialog').open){note('Сначала откройте лист, на котором нужна калька.');return;}
        const raster=create('canvas'), scale=Math.min(1200/(right-left),1200/(bottom-top));
        raster.width=Math.max(1,Math.ceil((right-left)*scale+2));
        raster.height=Math.max(1,Math.ceil((bottom-top)*scale+2));
        const ctx=raster.getContext('2d');
        ctx.strokeStyle='#506786';ctx.lineWidth=1;ctx.beginPath();
        for(const face of faces){
          face.map(projection).forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](1+(x-left)*scale,1+(y-top)*scale));
          ctx.closePath();
        }
        ctx.stroke();
        if(app.setSketchSetting('tracing',{image:raster.toDataURL('image/png'),x:(viewport.width-width)/2,y:(viewport.height-height)/2,width,height,opacity:.45,visible:true})){
          dialog.close();app.toast('Проекция STL добавлена как калька в миллиметрах.');
        }
      };
      if(app.getSketchSettings().tracing)confirmStep('Заменить текущую кальку?', 'Проекцию можно убрать через «Отменить».',apply);
      else apply();
    }));
    parent.append(toolbar,canvas,result);
    canvas.addEventListener('pointerdown',event=>{
      const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)*640/rect.width,y=(event.clientY-rect.top)*350/rect.height;
      let best=null, distance=14;
      for(const candidate of coordinates){
        const d=Math.hypot(x-candidate.screen[0],y-candidate.screen[1]);
        if(d<distance||best&&Math.abs(d-distance)<.001&&candidate.screen[2]>best.screen[2]){best=candidate;distance=d;}
      }
      if(!best)return;
      if(picks.length===2)picks=[];
      picks.push(best);
      result.textContent=picks.length===1?'Отметьте вторую вершину.':'Расстояние между вершинами · '+Math.hypot(...picks[0].position.map((n,i)=>n-picks[1].position[i])).toFixed(3)+' мм';
      draw();
    });
    draw();
  }

  global.LabProjectPreview = Object.freeze({thumbnail, sketchSVG, renderSTL});
})(window);
