/* Offline CAD-style 3D viewer. Real mesh depth, normals and orbit controls.
 * Input coordinates are millimetres; the Z axis is the extrusion height.
 */
(function (global) {
  'use strict';

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const DEFAULT_YAW = -0.62;
  const DEFAULT_PITCH = 0.72;
  const {dot, cross, unit, silhouetteEdges, writeStroke, createProgram, TransparentFaces} =
    global.LabModelRendering || (typeof module !== 'undefined' && module.exports && require('./model-rendering.js'));

  class LabModelViewer {
    constructor(canvas) {
      this.canvas = canvas;
      this.supported = false;
      this.disposed = false;
      this.mesh = null;
      this.transparentFaces = null;
      this.yaw = DEFAULT_YAW;
      this.pitch = DEFAULT_PITCH;
      this.zoomLevel = 1;
      this.center = [0, 0, 0];
      this.radius = 1;
      this.planarDiagonal = 1;
      this.height = 1;
      this.displayHeight = 1;
      this.baseZ = 0;
      this.animation = null;
      this.cameraAnimation = null;
      this.construction = null;
      this.constructionStage = 'complete';
      this.material = 'plastic';
      this.xray = false;
      this.technical=false;this.preview=false;this.focusBody=null;this.focusBodyIndex=-1;
      this.groundVisible=true;this.paper={enabled:false,widthMm:297,heightMm:210,fit:false};
      this.paperPositions=new Float32Array();this.paperEdges=new Float32Array();this.focusEdges=new Float32Array();
      this.activeBody = null;
      this.activeStrokeData = new Float32Array();
      this.silhouette = null;
      this.autoRotate=false;this.autoRotateSpeed=.22;this.lastAutoTime=null;this.recording=null;this.exportSize=null;
      this.press=null;this.previewExport=false;
      this.lightDirection=[-.45,.65,1];
      this.inspectionFrame=null;
      this.inspectionPatches=new Float32Array();
      this.inspectionGuides=new Float32Array();
      this.contactHatch=false;
      this.section = { enabled: false, axis: 'x', position: .5 };
      this.sectionCap = null;
      this.highlightContour = -1;
      this.hoverContour = -1;
      this.heightDragEnabled = false;
      this.heightGesture = null;
      this.holeAnimation = null;
      this.holeCount = 0;
      this.bounds = { min: [0,0,0], max: [1,1,1] };
      this.groundGrid = new Float32Array();
      this.groundMajor = new Float32Array();
      this.pointers = new Map();
      this.frame = 0;
      this.interactiveFrame = null;
      this.interactiveAverage = 16;
      this.interactiveSamples = 0;
      this.interactiveScale = 1;
      this.events = new AbortController();
      this.motionQuery = global.matchMedia?.('(prefers-reduced-motion: reduce)');
      this.reducedMotion = Boolean(this.motionQuery?.matches);
      this.motionQuery?.addEventListener('change', event => {
        this.reducedMotion = event.matches;
        if (this.reducedMotion) {
          this.autoRotate=false;this.lastAutoTime=null;
          this.animation = null;
          this.displayHeight = this.height;
          this.construction = null; this.holeAnimation = null;
          if(this.cameraAnimation){Object.assign(this, this.cameraAnimation.to);this.cameraAnimation=null;}
          this.setConstructionStage('complete');
          this.requestRender();
        }
      }, { signal: this.events.signal });
      canvas.style.touchAction = 'none';
      if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;
      if (!canvas.hasAttribute('aria-label')) canvas.setAttribute('aria-label', '3D-модель. Перетаскивайте для вращения. Стрелки вращают, плюс и минус меняют масштаб.');
      try {
        this.gl = canvas.getContext('webgl', {
          alpha: true,
          antialias: true,
          premultipliedAlpha: true,
          preserveDrawingBuffer: false
        });
        if (this.gl) this.initialize();
      } catch (_) {
        this.supported = false;
        this.animation = null;
        this.displayHeight = this.height;
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      }
      this.bindControls();
      const options = { signal: this.events.signal };
      canvas.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        this.supported = false;
        this.reportSupport();
      }, options);
      canvas.addEventListener('webglcontextrestored', () => {
        if (this.disposed) return;
        try {
          this.initialize();
          if (this.mesh) this.uploadMesh();
        } catch (_) {
          this.supported = false;
        }
        this.reportSupport();
        this.requestRender();
      }, options);
      global.document?.addEventListener('visibilitychange',()=>{this.lastAutoTime=null;if(global.document.hidden&&this.recording)this.cancelRecording();else if(this.autoRotate)this.requestRender();},options);
      global.document?.addEventListener('labcanvastheme',()=>this.requestRender(),options);
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
      this.resize();
    }

    reportSupport() {
      this.canvas.dispatchEvent(new CustomEvent('labmodelchange', { detail: { supported: this.supported } }));
    }

    initialize() {
      const gl = this.gl;
      this.program = createProgram(gl);
      this.positionBuffer = gl.createBuffer();
      this.normalBuffer = gl.createBuffer();
      this.edgeBuffer = gl.createBuffer();
      this.silhouetteBuffer = gl.createBuffer();
      this.activeStrokeBuffer = gl.createBuffer();
      this.silhouette = null;
      this.gridBuffer = gl.createBuffer();
      this.majorGridBuffer = gl.createBuffer();
      this.metaBuffer = gl.createBuffer();
      this.capBuffer = gl.createBuffer();
      this.capNormalBuffer = gl.createBuffer();
      this.shadowBuffer = gl.createBuffer();
      this.outlineBuffer = gl.createBuffer();
      this.plugBuffer = gl.createBuffer();
      this.plugNormalBuffer = gl.createBuffer();
      this.paperBuffer=gl.createBuffer();this.paperEdgeBuffer=gl.createBuffer();this.focusEdgeBuffer=gl.createBuffer();
      this.inspectPatchBuffer=gl.createBuffer();this.inspectGuideBuffer=gl.createBuffer();
      this.attributes = {
        position: gl.getAttribLocation(this.program, 'aPosition'),
        normal: gl.getAttribLocation(this.program, 'aNormal'),
        meta: gl.getAttribLocation(this.program, 'aMeta')
      };
      this.uniforms = Object.fromEntries(['uCenter', 'uView', 'uScale', 'uColor', 'uUnlit', 'uHeightScale', 'uBaseZ', 'uOffset', 'uClipAxis', 'uClipValue', 'uHighlight', 'uBuildStage', 'uShine', 'uSpecular', 'uGlass', 'uHatchScale', 'uTechnical', 'uFocusBody', 'uDash', 'uLightDirection', 'uContactHatch', 'uStrokePixel', 'uNight', 'uAssembly'].map(name => [name, gl.getUniformLocation(this.program, name)]));
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      this.supported = true;
      this.setInspectionOverlay(this.inspectionPatches,this.inspectionGuides,this.contactHatch);
      this.updateActiveStroke();
    }

    bindControls() {
      const canvas = this.canvas;
      const options = { signal: this.events.signal };
      canvas.addEventListener('pointerdown', event => {
        if (event.button > 0 || !this.mesh) return;
        event.preventDefault();
        canvas.focus({ preventScroll: true });
        this.stopAutoForInteraction();
        this.press=this.pointers.size?null:{id:event.pointerId,x:event.clientX,y:event.clientY,time:performance.now(),moved:false,shiftKey:event.shiftKey};
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        canvas.setPointerCapture(event.pointerId);
        const hit = this.pick(event.clientX, event.clientY);
        if(this.pointers.size===1&&this.canDragHeight(hit)){
          const body=this.mesh.bodies?.[hit.bodyIndex],startHeight=Number.isFinite(body?.height)?body.height:this.height;
          this.heightGesture={id:event.pointerId,bodyId:hit.bodyId,startY:event.clientY,startHeight,lastHeight:startHeight,halfHeight:this.lastProjection?.halfHeight||this.radius,pitch:this.pitch};
          this.animation=null;this.construction=null;this.displayHeight=this.height;
          this.emitHeight(this.heightGesture.startHeight,'start');canvas.style.cursor='ns-resize';
        }else{this.finishHeightGesture();canvas.style.cursor='grabbing';}
      }, options);
      canvas.addEventListener('pointermove', event => {
        const previous = this.pointers.get(event.pointerId);
        if (!previous) { this.hover(event); return; }
        event.preventDefault();
        if(this.press&&Math.hypot(event.clientX-this.press.x,event.clientY-this.press.y)>5)this.press.moved=true;
        if(this.heightGesture && this.heightGesture.id===event.pointerId && this.pointers.size===1){
          const rect=canvas.getBoundingClientRect(),half=this.heightGesture.halfHeight;
          const change=(this.heightGesture.startY-event.clientY)*2*half/Math.max(1,rect.height)/Math.max(.35,Math.abs(Math.cos(this.heightGesture.pitch)));
          const height=Math.round(clamp(this.heightGesture.startHeight+change,1,200)*10)/10;
          this.heightGesture.lastHeight=height;this.emitHeight(height,'move');
          this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});return;
        }
        if (this.pointers.size === 1) {
          if(this.press&&!this.press.moved)return;
          this.orbit(event.clientX - previous.x, event.clientY - previous.y);
          this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        } else {
          const before = this.pointerDistance();
          this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const after = this.pointerDistance();
          if (before > 2 && after > 2) this.zoom(after / before);
        }
      }, options);
      const release = event => {
        const press=this.press;this.press=null;
        if(event.type==='pointerup'&&press?.id===event.pointerId&&!press.moved&&performance.now()-press.time<700){
          const hit=this.pick(event.clientX,event.clientY);
          canvas.dispatchEvent(new CustomEvent('labmodelselect',{detail:{hit,clientX:event.clientX,clientY:event.clientY,shiftKey:press.shiftKey}}));
        }
        if(this.heightGesture?.id===event.pointerId)this.finishHeightGesture();
        this.pointers.delete(event.pointerId);
        if (!this.pointers.size) {
          canvas.style.cursor = this.mesh ? 'grab' : 'default';
          this.requestRender();
        }
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      };
      canvas.addEventListener('pointerup', release, options);
      canvas.addEventListener('dblclick',event=>{event.preventDefault();canvas.dispatchEvent(new CustomEvent('labmodeledit',{detail:{hit:this.pick(event.clientX,event.clientY),clientX:event.clientX,clientY:event.clientY}}));},options);
      canvas.addEventListener('pointercancel', release, options);
      canvas.addEventListener('lostpointercapture', event => {
        if(this.heightGesture?.id===event.pointerId)this.finishHeightGesture();
        this.pointers.delete(event.pointerId);this.press=null;
        if (!this.pointers.size) {
          canvas.style.cursor = this.mesh ? 'grab' : 'default';
          this.requestRender();
        }
      }, options);
      canvas.addEventListener('wheel', event => {
        if (!this.mesh) return;
        event.preventDefault();this.stopAutoForInteraction();
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1);
        this.zoom(Math.exp(clamp(-delta * 0.0014, -0.5, 0.5)));
      }, { ...options, passive: false });
      canvas.addEventListener('keydown', event => {
        if (!this.mesh) return;
        const keys = {
          ArrowLeft: () => this.orbit(-24, 0),
          ArrowRight: () => this.orbit(24, 0),
          ArrowUp: () => this.orbit(0, -24),
          ArrowDown: () => this.orbit(0, 24),
          '+': () => this.zoom(1.15),
          '=': () => this.zoom(1.15),
          '-': () => this.zoom(1 / 1.15),
          Home: () => this.resetView()
        };
        if (keys[event.key]) { this.stopAutoForInteraction();event.preventDefault(); event.stopPropagation(); keys[event.key](); }
      }, options);
      canvas.addEventListener('pointerleave',()=>{if(!this.pointers.size)this.setHover(-1);},options);
      canvas.addEventListener('contextmenu', event => event.preventDefault(), options);
      global.addEventListener('blur', () => {
        this.finishHeightGesture();
        this.pointers.clear();this.press=null;this.stopAutoForInteraction();
        canvas.style.cursor = this.mesh ? 'grab' : 'default';
      }, options);
    }

    pointerDistance() {
      const [a, b] = this.pointers.values();
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    }

    setMesh(mesh, options = {}) {
      if (this.disposed) return;
      if (!mesh || !mesh.positions || mesh.positions.length < 9) { this.clear(); return; }
      const positions = mesh.positions instanceof Float32Array ? mesh.positions : new Float32Array(mesh.positions);
      const normals = mesh.normals instanceof Float32Array ? mesh.normals : new Float32Array(mesh.normals || []);
      if (positions.length % 9 || normals.length !== positions.length) throw new Error('Invalid triangle mesh');
      let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < positions.length; i += 3) {
        for (let axis = 0; axis < 3; axis++) {
          const value = positions[i + axis];
          if (!Number.isFinite(value) || !Number.isFinite(normals[i + axis])) throw new Error('Invalid mesh coordinate');
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        }
      }
      const edges = mesh.edges instanceof Float32Array ? mesh.edges : new Float32Array(mesh.edges || []);
      if (edges.length % 6 || !edges.every(Number.isFinite)) throw new Error('Invalid mesh edges');
      const now = performance.now();
      const previousHeight = this.sampleHeight(now);
      const hadMesh = Boolean(this.mesh);
      const targetHeight = Math.max(0.0001, max[2] - min[2]);
      const changedHeight = Math.abs(targetHeight - this.height) > 0.00001;
      const mode = options.animate === undefined ? (!hadMesh ? 'intro' : changedHeight ? 'height' : false) : options.animate;
      const contourIds=mesh.contourIds||new Int32Array(positions.length/9).fill(-1);
      const surfaceTypes=mesh.surfaceTypes||new Uint8Array(positions.length/9).map((_,i)=>normals[i*9+2]>.6?1:normals[i*9+2]<-.6?0:2);
      const bodyIds=mesh.bodyIds||new Int32Array(positions.length/9);
      const metadata=new Float32Array(positions.length);
      for(let i=0;i<positions.length/9;i++)for(let j=0;j<3;j++){metadata[i*9+j*3]=contourIds[i]??-1;metadata[i*9+j*3+1]=surfaceTypes[i]??2;metadata[i*9+j*3+2]=bodyIds[i]??0;}
      this.transparentFaces = null;
      this.mesh = { ...mesh, positions, normals, edges,contourIds,surfaceTypes,bodyIds,metadata };
      if(this.silhouette?.positions!==positions)this.silhouette=null;
      this.updateActiveStroke();
      this.updateFocusGeometry();
      this.bounds={min,max};
      this.makeAuxiliaryGeometry();
      const newHoles=Number(mesh.stats?.holes)||0;
      this.holeAnimation=hadMesh&&newHoles>this.holeCount&&!this.reducedMotion?{start:now,duration:1100}:null;
      this.holeCount=newHoles;
      this.construction=null;this.setConstructionStage('complete');
      this.center = min.map((value, axis) => (value + max[axis]) / 2);
      this.planarDiagonal = Math.hypot(max[0] - min[0], max[1] - min[1]);
      this.radius = Math.max(0.1, Math.hypot(...min.map((value, axis) => max[axis] - value)) / 2);
      this.baseZ = min[2];
      this.height = targetHeight;
      this.makeGroundGrid(min, max);this.makePaper();
      this.updateSectionCap();
      if (mode && mode!=='holes' && !this.reducedMotion && this.supported) {
        const from = mode === 'intro' || !hadMesh ? Math.min(0.01, targetHeight * 0.001) : previousHeight;
        this.displayHeight = from;
        this.animation = { from, to: targetHeight, start: now, duration: mode === 'intro' ? 650 : 300, mode };
      } else {
        this.animation = null;
        this.displayHeight = targetHeight;
      }
      if (this.supported) this.uploadMesh();
      this.canvas.style.cursor = this.heightGesture?'ns-resize':'grab';
      this.requestRender();
    }

    uploadMesh() {
      this.sortedUpload = false;
      const gl = this.gl;
      for (const [buffer, data] of [[this.positionBuffer, this.mesh.positions], [this.normalBuffer, this.mesh.normals], [this.edgeBuffer, this.mesh.edges], [this.gridBuffer, this.groundGrid], [this.majorGridBuffer, this.groundMajor], [this.metaBuffer,this.mesh.metadata], [this.shadowBuffer,this.shadowPositions], [this.outlineBuffer,this.outlinePositions], [this.plugBuffer,this.plugPositions], [this.plugNormalBuffer,this.plugNormals],[this.paperBuffer,this.paperPositions],[this.paperEdgeBuffer,this.paperEdges],[this.focusEdgeBuffer,this.focusEdges]]) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      }
      this.uploadSectionCap();
    }

    clear() {
      this.mesh = null;
      this.transparentFaces = null;
      this.silhouette = null;
      this.activeStrokeData = new Float32Array();
      this.animation = null;
      this.displayHeight = this.height;
      this.pointers.clear();this.press=null;
      this.canvas.style.cursor = 'default';
      this.construction=null;this.holeAnimation=null;this.sectionCap=null;this.shadowPositions=new Float32Array();this.setHover(-1);
      this.requestRender();
    }

    sampleHeight(now = performance.now()) {
      if (!this.animation) return this.displayHeight;
      const { from, to, start, duration } = this.animation;
      const progress = clamp((now - start) / duration, 0, 1);
      const eased = 1 - (1 - progress) ** 3;
      this.displayHeight = from + (to - from) * eased;
      if (progress >= 1) { this.displayHeight = to; this.animation = null; }
      return this.displayHeight;
    }

    setMaterial(name) {
      this.material=['plastic','aluminum','glass'].includes(name)?name:'plastic';this.requestRender();
    }
    setXray(value){this.xray=Boolean(value);this.requestRender();}
    setHighlight(index){this.highlightContour=Number.isInteger(index)?index:-1;this.requestRender();}
    setHeightDrag(value){this.heightDragEnabled=Boolean(value);if(!value)this.finishHeightGesture();this.canvas.style.cursor=this.mesh?'grab':'default';}
    canDragHeight(hit){
      const body=this.mesh?.bodies?.[hit?.bodyIndex];
      if(!this.heightDragEnabled||!hit||hit.normal[2]<=.65||(body?.mode&&body.mode!=='extrude')||global.LabCaliper?.active())return false;
      const normal=global.LabAssemblyGeometry?.unplaceDirection?.(body,hit.normal)||hit.normal;
      return normal[2]>.65;
    }
    finishHeightGesture(){const gesture=this.heightGesture;if(!gesture)return;this.heightGesture=null;this.emitHeight(gesture.lastHeight,'end',gesture.bodyId);}
    emitHeight(height,phase,bodyId=this.heightGesture?.bodyId){this.canvas.dispatchEvent(new CustomEvent('labmodelheight',{detail:{height,phase,bodyId:bodyId||null}}));}
    setHover(index){
      if(index===this.hoverContour)return;this.hoverContour=index;
      this.canvas.dispatchEvent(new CustomEvent('labmodelhover',{detail:{contourIndex:index}}));
      this.requestRender();
    }
    hover(event){
      if(!this.mesh)return;
      const hit=this.pick(event.clientX,event.clientY);
      this.setHover(hit?.contourIndex??-1);
      this.canvas.style.cursor=this.canDragHeight(hit)?'ns-resize':'grab';
    }
    setLightDirection(direction){
      if(direction?.length!==3||!direction.every(Number.isFinite))return;
      this.lightDirection=unit(direction);this.requestRender();
    }
    setInspectionOverlay(patches=[],guides=[],hatch=false){
      this.inspectionPatches=Float32Array.from(patches);
      this.inspectionGuides=Float32Array.from(guides);
      this.contactHatch=hatch;
      if(!this.supported)return;
      const gl=this.gl;
      for(const [buffer,data] of [[this.inspectPatchBuffer,this.inspectionPatches],[this.inspectGuideBuffer,this.inspectionGuides]]){
        gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
      }
      this.requestRender();
    }
    setTechnical(value){this.technical=Boolean(value);this.requestRender();}
    setPreview(value){this.preview=Boolean(value);this.requestRender();}
    setGroundVisible(value){this.groundVisible=Boolean(value);this.requestRender();}
    setActiveBody(id){
      if(this.activeBody===id)return;
      this.activeBody=id;
      this.updateActiveStroke();
      this.requestRender();
    }
    updateActiveStroke(){
      const edges=this.activeBody&&this.mesh?.bodies?.find(body=>body.id===this.activeBody)?.mesh?.edges;
      this.activeStrokeData = new Float32Array((edges?.length || 0)*7);
      if(!edges||!this.supported)return;
      for(let i=0,at=0;i<edges.length;i+=6)at=writeStroke(this.activeStrokeData,at,edges,i,i+3);
      const gl=this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER,this.activeStrokeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER,this.activeStrokeData,gl.STATIC_DRAW);
    }
    updateSilhouette(view,ratio){
      const positions=this.mesh.positions;
      if(this.silhouette?.positions!==positions){
        const edges=silhouetteEdges(this.mesh);
        this.silhouette={positions,edges,vertices:new Float32Array(edges.length*42),count:0,pose:null};
      }
      const cache=this.silhouette;
      const pose=`${view[2]}/${view[5]}/${view[8]}/${ratio}`;
      if(cache.pose===pose)return cache.count;
      const towards=normal=>normal[0]*view[2]+normal[1]*view[5]+normal[2]*view[8]/Math.max(.001,ratio);
      let at=0;
      for(const edge of cache.edges){
        if(edge.other&&(towards(edge.normal)>1e-6)===(towards(edge.other)>1e-6))continue;
        at=writeStroke(cache.vertices,at,positions,edge.a,edge.b);
      }
      const gl=this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER,this.silhouetteBuffer);
      gl.bufferData(gl.ARRAY_BUFFER,cache.vertices.subarray(0,at),gl.DYNAMIC_DRAW);
      cache.pose=pose;cache.count=at/7;
      return cache.count;
    }
    setFocusBody(id){this.focusBody=typeof id==='string'?id:null;this.updateFocusGeometry();this.requestRender();}
    updateFocusGeometry(){
      this.focusBodyIndex=this.mesh?.bodies?.findIndex(body=>body.id===this.focusBody)??-1;
      const body=this.mesh?.bodies?.[this.focusBodyIndex];this.focusEdges=body?.mesh?.edges||new Float32Array();
      if(this.supported&&this.focusEdgeBuffer){this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.focusEdgeBuffer);this.gl.bufferData(this.gl.ARRAY_BUFFER,this.focusEdges,this.gl.STATIC_DRAW);}
    }
    setPaper(value={}){
      this.paper={enabled:Boolean(value.enabled),widthMm:clamp(Number(value.widthMm)||297,10,2000),heightMm:clamp(Number(value.heightMm)||210,10,2000),fit:Boolean(value.fit)};
      this.makePaper();this.requestRender();
    }
    makePaper(){
      const {widthMm:w,heightMm:h,enabled}=this.paper,z=Math.min(0,this.bounds.min[2])-.16;
      this.paperPositions=enabled?new Float32Array([0,0,z,w,0,z,w,-h,z,0,0,z,w,-h,z,0,-h,z]):new Float32Array();
      this.paperEdges=enabled?new Float32Array([0,0,z,w,0,z,w,0,z,w,-h,z,w,-h,z,0,-h,z,0,-h,z,0,0,z]):new Float32Array();
      if(enabled){
        const step=this.zoomLevel<.6?20:this.zoomLevel<1.2?10:this.zoomLevel<2.5?5:2,minor=[],major=[];
        for(let x=0;x<=w;x+=step)(Math.abs(x%50)<1e-5?major:minor).push(x,0,z+.015,x,-h,z+.015);
        for(let y=0;y<=h;y+=step)(Math.abs(y%50)<1e-5?major:minor).push(0,-y,z+.015,w,-y,z+.015);
        this.groundGrid=new Float32Array(minor);this.groundMajor=new Float32Array(major);
      }else if(this.mesh)this.makeGroundGrid(this.bounds.min,this.bounds.max);
      if(this.supported)for(const [buffer,data] of [[this.paperBuffer,this.paperPositions],[this.paperEdgeBuffer,this.paperEdges],[this.gridBuffer,this.groundGrid],[this.majorGridBuffer,this.groundMajor]]){this.gl.bindBuffer(this.gl.ARRAY_BUFFER,buffer);this.gl.bufferData(this.gl.ARRAY_BUFFER,data,this.gl.STATIC_DRAW);}
    }
    project(point){
      const p=this.lastProjection,r=this.canvas.getBoundingClientRect();if(!p||!Array.isArray(point)||point.length<3)return null;
      const world=[point[0],point[1],this.baseZ+(point[2]-this.baseZ)*this.displayHeight/this.height],q=world.map((n,i)=>n-p.center[i]),v=p.view;
      const x=v[0]*q[0]+v[3]*q[1]+v[6]*q[2],y=v[1]*q[0]+v[4]*q[1]+v[7]*q[2];
      return {x:r.left+(x/(p.halfHeight*p.aspect)+1)*r.width/2,y:r.top+(1-y/p.halfHeight)*r.height/2};
    }
    ray(clientX,clientY){
      const r=this.canvas.getBoundingClientRect(),p=this.lastProjection;if(!p||!r.width||!r.height)return null;
      const x=((clientX-r.left)/r.width*2-1)*p.halfHeight*p.aspect,y=(1-(clientY-r.top)/r.height*2)*p.halfHeight;
      const v=p.view,R=[v[0],v[3],v[6]],U=[v[1],v[4],v[7]],D=[v[2],v[5],v[8]],far=Math.max(this.radius,Math.hypot(this.paper.widthMm,this.paper.heightMm))*5+this.height+10;
      return {origin:p.center.map((n,i)=>n+R[i]*x+U[i]*y+D[i]*far),direction:D.map(n=>-n)};
    }
    unprojectToPlane(clientX,clientY,plane){
      const ray=this.ray(clientX,clientY);if(!ray||!plane?.origin||!plane?.normal)return null;
      const denominator=dot(ray.direction,plane.normal);if(Math.abs(denominator)<1e-7)return null;
      const t=dot(plane.origin.map((n,i)=>n-ray.origin[i]),plane.normal)/denominator;if(!Number.isFinite(t))return null;
      return ray.origin.map((n,i)=>n+ray.direction[i]*t);
    }
    getFace(hit){
      if(!hit||!this.mesh||!Number.isInteger(hit.triangle))return null;
      const k=hit.triangle*9,points=[0,3,6].map(offset=>Array.from(this.mesh.positions.subarray(k+offset,k+offset+3)));
      const normal=unit(hit.normal),origin=points[0].slice();
      let u=unit(points[1].map((n,i)=>n-origin[i]));if(Math.abs(dot(u,normal))>.999)u=unit(cross(Math.abs(normal[2])<.9?[0,0,1]:[0,1,0],normal));
      const v=unit(cross(normal,u));
      return {origin,normal,u,v,points,bodyId:hit.bodyId,bodyIndex:hit.bodyIndex,triangle:hit.triangle};
    }
    setAutoRotate(value,speed=.22){
      this.autoRotate=Boolean(value)&&!this.reducedMotion;this.autoRotateSpeed=clamp(Number(speed)||.22,-3,3);this.lastAutoTime=null;
      this.canvas.dispatchEvent(new CustomEvent('labmodelautorotate',{detail:{enabled:this.autoRotate}}));this.requestRender();return this.autoRotate;
    }
    stopAutoForInteraction(){
      if(this.recording)this.cancelRecording();
      if(this.autoRotate)this.setAutoRotate(false);
    }
    async getImage(options={}){
      if(!this.supported||!this.mesh)throw new Error('Сначала создайте 3D-модель.');
      const r=this.canvas.getBoundingClientRect(),width=Math.round(clamp(Number(options.width)||1600,64,4096)),height=Math.round(clamp(Number(options.height)||width*r.height/Math.max(1,r.width),64,4096));
      const state={exportSize:this.exportSize,previewExport:this.previewExport,autoRotate:this.autoRotate,animation:this.animation,cameraAnimation:this.cameraAnimation,construction:this.construction,displayHeight:this.displayHeight};
      let output;
      try{
        this.exportSize={width,height};this.previewExport=options.transparent!==false;this.autoRotate=false;this.animation=null;this.cameraAnimation=null;this.construction=null;this.displayHeight=this.height;
        this.render(performance.now());output=document.createElement('canvas');output.width=width;output.height=height;const context=output.getContext('2d');
        if(options.transparent===false){context.fillStyle=document.documentElement.dataset.canvasTheme==='dark'?'#212b3b':'#EDF3F9';context.fillRect(0,0,width,height);}context.drawImage(this.canvas,0,0,width,height);
      }finally{Object.assign(this,state);this.lastAutoTime=null;this.render(performance.now());}
      return new Promise((resolve,reject)=>output.toBlob(blob=>blob?resolve(blob):reject(new Error('Не удалось сохранить изображение.')),'image/png'));
    }
    recordTurntable(options={}){
      if(!this.supported||!this.mesh)return Promise.reject(new Error('Сначала создайте 3D-модель.'));
      if(this.reducedMotion)return Promise.reject(new Error('Для записи вращения отключите системное уменьшение движения.'));
      if(this.recording)return Promise.reject(new Error('Запись уже идёт.'));
      if(!this.canvas.captureStream||!global.MediaRecorder)return Promise.reject(new Error('Запись видео недоступна в этом браузере. Сохраните PNG.'));
      const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
      if(!mime)return Promise.reject(new Error('Браузер не поддерживает запись видео. Сохраните PNG.'));
      const duration=clamp(Number(options.duration)||6000,500,15000),output=document.createElement('canvas'),factor=Math.min(1,1920/this.canvas.width,1080/this.canvas.height),chunks=[];
      output.width=Math.max(1,Math.round(this.canvas.width*factor));output.height=Math.max(1,Math.round(this.canvas.height*factor));
      const context=output.getContext('2d',{alpha:false}),capture=source=>{context.fillStyle=document.documentElement.dataset.canvasTheme==='dark'?'#212b3b':'#EDF3F9';context.fillRect(0,0,output.width,output.height);context.drawImage(source,0,0,output.width,output.height);};
      capture(this.canvas);const stream=output.captureStream(30);
      const state={autoRotate:this.autoRotate,autoRotateSpeed:this.autoRotateSpeed,yaw:this.yaw,pitch:this.pitch};
      return new Promise((resolve,reject)=>{
        let recorder;
        try{recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6000000});}catch(error){stream.getTracks().forEach(track=>track.stop());reject(error);return;}
        const recording={recorder,stream,capture,timer:null,cancelled:false,restore:()=>{clearTimeout(recording.timer);stream.getTracks().forEach(track=>track.stop());this.recording=null;if(recording.cancelled){this.autoRotate=false;this.autoRotateSpeed=state.autoRotateSpeed;}else Object.assign(this,state);this.lastAutoTime=null;this.requestRender();this.canvas.dispatchEvent(new CustomEvent('labmodelautorotate',{detail:{enabled:this.autoRotate}}));this.canvas.dispatchEvent(new CustomEvent('labmodelrecording',{detail:{active:false}}));}};
        this.recording=recording;
        recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
        recorder.onerror=()=>{recording.restore();reject(new Error('Не удалось записать видео.'));};
        recorder.onstop=()=>{const cancelled=recording.cancelled;recording.restore();if(cancelled)reject(new DOMException('Запись отменена.','AbortError'));else if(chunks.length)resolve(new Blob(chunks,{type:recorder.mimeType||mime}));else reject(new Error('Запись не содержит кадров.'));};
        this.animation=null;this.cameraAnimation=null;this.construction=null;this.displayHeight=this.height;this.autoRotate=true;this.autoRotateSpeed=2*Math.PI/(duration/1000);this.lastAutoTime=null;this.render(performance.now());recorder.start(200);this.requestRender();
        recording.timer=setTimeout(()=>{if(recorder.state!=='inactive')recorder.stop();},duration);
        this.canvas.dispatchEvent(new CustomEvent('labmodelrecording',{detail:{active:true,duration,mimeType:mime}}));
      });
    }
    cancelRecording(){if(this.recording){this.recording.cancelled=true;if(this.recording.recorder.state!=='inactive')this.recording.recorder.stop();}}

    getCamera(){return {yaw:this.yaw,pitch:this.pitch,zoom:this.zoomLevel};}
    setCamera(camera,animate=true,immediate=false,duration=450){
      if(!camera||![camera.yaw,camera.pitch,camera.zoom??camera.zoomLevel].every(Number.isFinite))return false;
      const to={yaw:camera.yaw,pitch:clamp(camera.pitch,-Math.PI/2,Math.PI/2),zoomLevel:clamp(camera.zoom??camera.zoomLevel,.3,5)};
      let delta=to.yaw-this.yaw;delta=((delta+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;to.yaw=this.yaw+delta;
      if(animate&&!this.reducedMotion)this.cameraAnimation={from:{yaw:this.yaw,pitch:this.pitch,zoomLevel:this.zoomLevel},to,start:performance.now(),duration};
      else{Object.assign(this,to);this.cameraAnimation=null;}
      if(immediate){cancelAnimationFrame(this.frame);this.frame=0;this.render();}
      else this.requestRender();
      return true;
    }
    stopCameraTransition(){
      if(!this.cameraAnimation)return;
      this.sampleCamera(performance.now());this.cameraAnimation=null;this.requestRender();
    }
    setView(name){
      const views={iso:{yaw:DEFAULT_YAW,pitch:DEFAULT_PITCH,zoom:1},top:{yaw:0,pitch:Math.PI/2,zoom:1},front:{yaw:0,pitch:0,zoom:1},side:{yaw:Math.PI/2,pitch:0,zoom:1}};
      if(views[name])this.setCamera(views[name],true);
    }
    sampleCamera(now){
      const a=this.cameraAnimation;if(!a)return;
      const t=clamp((now-a.start)/a.duration,0,1),e=t*t*(3-2*t);
      for(const key of ['yaw','pitch','zoomLevel'])this[key]=a.from[key]+(a.to[key]-a.from[key])*e;
      if(t===1){this.cameraAnimation=null;this.canvas.dispatchEvent(new CustomEvent('labmodelcamera',{detail:this.getCamera()}));}
    }
    setSection(value={}){
      const next={enabled:Boolean(value.enabled),axis:['x','y','z'].includes(value.axis)?value.axis:'x',position:clamp(Number.isFinite(value.position)?value.position:.5,0,1)};
      if(JSON.stringify(next)===JSON.stringify(this.section))return;
      this.section=next;this.updateSectionCap();this.requestRender();
    }
    updateSectionCap(){
      this.sectionCap=null;
      if(this.mesh&&this.section.enabled&&global.LabExtrusion?.section){
        try{const cut=global.LabExtrusion.section(this.mesh,this.section);this.sectionCap={positions:cut.capPositions||new Float32Array(),normals:cut.capNormals||new Float32Array()};}
        catch(error){this.canvas.dispatchEvent(new CustomEvent('labmodelsectionerror',{detail:{message:error.message}}));}
      }
      if(this.supported)this.uploadSectionCap();
    }
    uploadSectionCap(){
      if(!this.gl||!this.capBuffer)return;
      for(const [buffer,data] of [[this.capBuffer,this.sectionCap?.positions||new Float32Array()],[this.capNormalBuffer,this.sectionCap?.normals||new Float32Array()]]){this.gl.bindBuffer(this.gl.ARRAY_BUFFER,buffer);this.gl.bufferData(this.gl.ARRAY_BUFFER,data,this.gl.STATIC_DRAW);}
    }
    replayConstruction(){
      if(!this.mesh)return;
      this.animation=null;this.holeAnimation=null;
      if(this.reducedMotion){this.construction=null;this.displayHeight=this.height;this.setConstructionStage('complete');}
      else{this.construction={start:performance.now(),duration:2600};this.displayHeight=.001;this.setConstructionStage('contour');}
      this.requestRender();
    }
    setConstructionStage(stage){
      if(stage===this.constructionStage)return;this.constructionStage=stage;
      this.canvas.dispatchEvent(new CustomEvent('labmodelstage',{detail:{stage}}));
    }
    sampleConstruction(now){
      if(!this.construction)return 3;
      const t=(now-this.construction.start)/this.construction.duration;
      if(t<.2){this.displayHeight=.001;this.setConstructionStage('contour');return 0;}
      if(t<.4){this.displayHeight=.001;this.setConstructionStage('base');return 1;}
      if(t<.85){const p=(t-.4)/.45;this.displayHeight=this.height*(1-(1-p)**3);this.setConstructionStage('walls');return 2;}
      this.displayHeight=this.height;this.setConstructionStage('complete');
      if(t>=1)this.construction=null;return 3;
    }
    makeAuxiliaryGeometry(){
      const m=this.mesh,min=this.bounds.min,z=min[2],shadow=[],outline=[],plug=[],plugNormals=[],newHoleContours=[];
      for(let t=0;t<m.positions.length/9;t++)if(m.surfaceTypes[t]===0){
        for(let j=0;j<3;j++){const k=t*9+j*3;shadow.push(m.positions[k],m.positions[k+1],z-.06);}
      }
      const previous=this.holeKeys||new Set(),current=new Set();
      for(const contour of m.contours||[]){
        const points=contour.points||[];if(points.length<3)continue;
        for(let i=0;i<points.length;i++){const p=points[i],q=points[(i+1)%points.length];outline.push(p.x,p.y,z+.015,q.x,q.y,z+.015);}
        if(contour.depth%2!==1)continue;
        const key=points.map(p=>`${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';');current.add(key);
        if(previous.has(key)||typeof global.earcut!=='function')continue;
        newHoleContours.push(contour.index);
        const indices=global.earcut(points.flatMap(p=>[p.x,p.y]),null,2);
        for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++){const p=points[indices[i+j]];plug.push(p.x,p.y,this.bounds.max[2]);plugNormals.push(0,0,1);}
      }
      if(!outline.length){for(let i=0;i<m.edges.length;i+=6)if(Math.abs(m.edges[i+2]-z)<.001&&Math.abs(m.edges[i+5]-z)<.001)outline.push(...m.edges.subarray(i,i+6));}
      this.holeKeys=current;this.newHoleContours=newHoleContours;this.shadowPositions=new Float32Array(shadow);this.outlinePositions=new Float32Array(outline);this.plugPositions=new Float32Array(plug);this.plugNormals=new Float32Array(plugNormals);
    }
    pick(clientX,clientY){
      if(!this.mesh||!this.lastProjection)return null;
      const r=this.canvas.getBoundingClientRect(),p=this.lastProjection;if(!r.width||!r.height)return null;
      const x=((clientX-r.left)/r.width*2-1)*p.halfHeight*p.aspect,y=(1-(clientY-r.top)/r.height*2)*p.halfHeight;
      const v=p.view,R=[v[0],v[3],v[6]],U=[v[1],v[4],v[7]],D=[v[2],v[5],v[8]],far=this.radius*5+this.height+10;
      const origin=p.center.map((n,i)=>n+R[i]*x+U[i]*y+D[i]*far),direction=D.map(n=>-n);
      const pos=this.mesh.positions,scale=this.displayHeight/this.height;let nearest=Infinity,result=null;
      const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
      for(let k=0;k<pos.length;k+=9){
        const a=[pos[k],pos[k+1],this.baseZ+(pos[k+2]-this.baseZ)*scale],b=[pos[k+3],pos[k+4],this.baseZ+(pos[k+5]-this.baseZ)*scale],c=[pos[k+6],pos[k+7],this.baseZ+(pos[k+8]-this.baseZ)*scale];
        const e1=b.map((n,i)=>n-a[i]),e2=c.map((n,i)=>n-a[i]),h=cross(direction,e2),det=dot(e1,h);if(Math.abs(det)<1e-8)continue;
        const inv=1/det,s=origin.map((n,i)=>n-a[i]),u=inv*dot(s,h);if(u<0||u>1)continue;
        const q=cross(s,e1),w=inv*dot(direction,q);if(w<0||u+w>1)continue;
        const distance=inv*dot(e2,q);if(distance<=0||distance>=nearest)continue;
        const hit=origin.map((n,i)=>n+direction[i]*distance);
        if(this.section.enabled){const axis=['x','y','z'].indexOf(this.section.axis),limit=this.bounds.min[axis]+(this.bounds.max[axis]-this.bounds.min[axis])*this.section.position;const coordinate=axis===2?this.baseZ+(hit[2]-this.baseZ)/Math.max(.00001,scale):hit[axis];if(coordinate>limit+.001)continue;}
        const triangle=k/9,surface=this.mesh.surfaceTypes[triangle];
        if(this.constructionStage==='contour'||(this.constructionStage==='base'&&surface!==0)||(this.constructionStage==='walls'&&surface===1))continue;
        nearest=distance;const bodyIndex=this.mesh.bodyIds?.[triangle]??0;
        result={point:hit,normal:Array.from(this.mesh.normals.subarray(k,k+3)),contourIndex:this.mesh.contourIds[triangle]??-1,surface,triangle,bodyIndex,bodyId:this.mesh.bodies?.[bodyIndex]?.id||null};
      }
      return result;
    }

    makeGroundGrid(min, max) {
      const span = Math.max(max[0] - min[0], max[1] - min[1], 1);
      const rawStep = span / 9;
      const power = 10 ** Math.floor(Math.log10(rawStep));
      const fraction = rawStep / power;
      const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
      const x0 = Math.floor(min[0] / step) - 1, x1 = Math.ceil(max[0] / step) + 1;
      const y0 = Math.floor(min[1] / step) - 1, y1 = Math.ceil(max[1] / step) + 1;
      const z = min[2] - Math.max(0.05, span * 0.0003);
      const minor = [], major = [];
      for (let x = x0; x <= x1; x++) (x % 5 === 0 ? major : minor).push(x * step, y0 * step, z, x * step, y1 * step, z);
      for (let y = y0; y <= y1; y++) (y % 5 === 0 ? major : minor).push(x0 * step, y * step, z, x1 * step, y * step, z);
      this.groundGrid = new Float32Array(minor);
      this.groundMajor = new Float32Array(major);
    }

    resetView() { this.setView('iso'); }

    zoom(factor) {
      if (!Number.isFinite(factor) || factor <= 0) return;
      this.cameraAnimation=null;
      this.zoomLevel = clamp(this.zoomLevel * factor, 0.3, 5);if(this.paper.enabled)this.makePaper();
      this.requestRender();
    }

    orbit(dx, dy) {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      this.cameraAnimation=null;
      this.yaw = ((this.yaw - dx * 0.008) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      this.pitch = clamp(this.pitch + dy * 0.008, -1.48, 1.48);
      this.requestRender();
    }

    resize() { this.requestRender(); }

    requestRender() {
      if (this.disposed || this.frame) return;
      this.frame = requestAnimationFrame(now => {
        this.frame = 0;
        this.render(now);
      });
    }

    interactivePixelRatio(now,pixelRatio) {
      const moving=this.pointers.size>1||this.press?.moved||this.cameraAnimation||this.autoRotate;
      if(!moving||this.recording||this.exportSize){
        this.interactiveFrame=null;
        this.interactiveAverage=16;
        this.interactiveSamples=0;
        this.interactiveScale=1;
        return pixelRatio;
      }
      const interval=this.interactiveFrame===null?0:now-this.interactiveFrame;
      this.interactiveFrame=now;
      if(interval>=8&&interval<=120){
        this.interactiveAverage=this.interactiveAverage*.75+interval*.25;
        this.interactiveSamples++;
      }
      if(this.interactiveSamples>=4){
        if(this.interactiveAverage>44)this.interactiveScale=.6;
        else if(this.interactiveAverage>28)this.interactiveScale=Math.min(this.interactiveScale,.8);
      }
      return pixelRatio*this.interactiveScale;
    }

    render(now = performance.now()) {
      if (!this.supported || this.disposed) return;
      if(this.autoRotate&&!this.reducedMotion&&!global.document?.hidden){
        if(this.lastAutoTime!==null)this.yaw+=Math.min(.1,(now-this.lastAutoTime)/1000)*this.autoRotateSpeed;
        this.lastAutoTime=now;
      }else this.lastAutoTime=null;
      this.sampleHeight(now);this.sampleCamera(now);
      const stage=this.sampleConstruction(now);
      const gl=this.gl,canvas=this.canvas,rect=canvas.getBoundingClientRect();
      const dpr=this.interactivePixelRatio(now,Math.min(global.devicePixelRatio||1,2));
      const night=global.document?.documentElement.dataset.canvasTheme==='dark';
      const width=this.exportSize?.width||Math.max(1,Math.round(rect.width*dpr)),height=this.exportSize?.height||Math.max(1,Math.round(rect.height*dpr));
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
      gl.viewport(0,0,width,height);
      if(this.recording&&!this.previewExport)gl.clearColor(...(night?[.13,.17,.23,1]:[237/255,243/255,249/255,1]));else gl.clearColor(0,0,0,0);
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      if(!this.mesh||!rect.width||!rect.height)return;
      const aspect=width/height,heightTransition=this.animation?.mode==='height';
      let viewRadius=heightTransition?Math.max(.1,Math.hypot(this.planarDiagonal,this.displayHeight)/2):this.radius;
      let viewCenter=heightTransition?[this.center[0],this.center[1],this.baseZ+this.displayHeight/2]:this.center;
      if(this.paper.enabled&&this.paper.fit){viewRadius=Math.hypot(this.paper.widthMm,this.paper.heightMm,Math.max(0,this.bounds.max[2]))/2;viewCenter=[this.paper.widthMm/2,-this.paper.heightMm/2,Math.max(0,this.bounds.max[2])/2];}
      if(this.inspectionFrame){viewRadius=this.inspectionFrame.radius;viewCenter=this.inspectionFrame.center;}
      const halfHeight=viewRadius*1.13/Math.min(1,aspect)/this.zoomLevel;
      const cp=Math.cos(this.pitch),sp=Math.sin(this.pitch),sy=Math.sin(this.yaw),cy=Math.cos(this.yaw);
      const view=new Float32Array([cy,-sp*sy,cp*sy,sy,sp*cy,-cp*cy,0,cp,sp]);
      this.lastProjection={view,center:viewCenter,halfHeight,aspect};
      gl.useProgram(this.program);gl.uniform3fv(this.uniforms.uCenter,viewCenter);gl.uniformMatrix3fv(this.uniforms.uView,false,view);
      gl.uniform3f(this.uniforms.uScale,1/(halfHeight*aspect),1/halfHeight,1/(Math.max(viewRadius,this.radius)*3+1));
      gl.uniform3fv(this.uniforms.uLightDirection,this.lightDirection);gl.uniform1i(this.uniforms.uContactHatch,0);
      gl.uniform1f(this.uniforms.uTechnical,this.technical?1:0);gl.uniform1f(this.uniforms.uFocusBody,this.focusBodyIndex);gl.uniform1f(this.uniforms.uDash,0);
      gl.uniform1i(this.uniforms.uNight,night?1:0);gl.uniform1i(this.uniforms.uAssembly,(this.mesh.bodies?.length||0)>1?1:0);
      gl.uniform2f(this.uniforms.uStrokePixel,0,0);
      gl.uniform1f(this.uniforms.uBaseZ,this.baseZ);gl.uniform3f(this.uniforms.uOffset,0,0,0);gl.uniform1f(this.uniforms.uBuildStage,stage);
      const axis=['x','y','z'].indexOf(this.section.axis);
      gl.uniform1f(this.uniforms.uClipAxis,this.section.enabled?axis+1:0);
      gl.uniform1f(this.uniforms.uClipValue,this.bounds.min[axis]+(this.bounds.max[axis]-this.bounds.min[axis])*this.section.position);
      const revealHighlight=this.holeAnimation&&this.newHoleContours?.length?this.newHoleContours[0]:-1;
      const activeHighlight=this.highlightContour>=0?this.highlightContour:this.hoverContour>=0?this.hoverContour:revealHighlight;
      gl.uniform1f(this.uniforms.uHighlight,activeHighlight);
      gl.uniform1f(this.uniforms.uShine,20);gl.uniform1f(this.uniforms.uSpecular,.035);gl.uniform1f(this.uniforms.uGlass,0);
      gl.uniform1f(this.uniforms.uHatchScale,18/Math.max(1,this.planarDiagonal));
      const bind=(positions,normals,metadata,meta=[-1,0,-1])=>{
        gl.bindBuffer(gl.ARRAY_BUFFER,positions);gl.enableVertexAttribArray(this.attributes.position);gl.vertexAttribPointer(this.attributes.position,3,gl.FLOAT,false,0,0);
        if(normals){gl.bindBuffer(gl.ARRAY_BUFFER,normals);gl.enableVertexAttribArray(this.attributes.normal);gl.vertexAttribPointer(this.attributes.normal,3,gl.FLOAT,false,0,0);}else{gl.disableVertexAttribArray(this.attributes.normal);gl.vertexAttrib3f(this.attributes.normal,0,0,1);}
        if(metadata){gl.bindBuffer(gl.ARRAY_BUFFER,metadata);gl.enableVertexAttribArray(this.attributes.meta);gl.vertexAttribPointer(this.attributes.meta,3,gl.FLOAT,false,0,0);}else{gl.disableVertexAttribArray(this.attributes.meta);gl.vertexAttrib3f(this.attributes.meta,meta[0]??-1,meta[1]??0,meta[2]??-1);}
      };
      gl.uniform1f(this.uniforms.uHeightScale,1);gl.uniform1i(this.uniforms.uUnlit,1);gl.depthMask(false);
      if(this.paper.enabled&&this.groundVisible&&!this.previewExport){
        gl.uniform4f(this.uniforms.uColor,...(night?[.18,.24,.30,1]:[.985,.99,.998,1]));bind(this.paperBuffer,null,null);gl.drawArrays(gl.TRIANGLES,0,this.paperPositions.length/3);
        gl.uniform4f(this.uniforms.uColor,...(night?[.50,.63,.76,.28]:[.60,.69,.78,.50]));bind(this.paperEdgeBuffer,null,null);gl.drawArrays(gl.LINES,0,this.paperEdges.length/3);
      }
      // A multisample projected footprint creates a soft contact shadow with the
      // same holes as the actual solid. It is view geometry, never exported.
      if(stage>0&&this.shadowPositions.length&&this.groundVisible&&!this.previewExport){
        bind(this.shadowBuffer,null,null);const blur=Math.max(.4,this.planarDiagonal*.012);
        for(let x=-2;x<=2;x++)for(let y=-2;y<=2;y++){
          const alpha=.025*Math.exp(-(x*x+y*y)/2.4);
          gl.uniform3f(this.uniforms.uOffset,x*blur,y*blur,0);gl.uniform4f(this.uniforms.uColor,.18,.25,.32,alpha);
          gl.drawArrays(gl.TRIANGLES,0,this.shadowPositions.length/3);
        }
      }
      gl.uniform3f(this.uniforms.uOffset,0,0,0);gl.uniform1f(this.uniforms.uClipAxis,0);
      for(const [buffer,vertices,alpha] of this.groundVisible&&!this.previewExport?[[this.gridBuffer,this.groundGrid,.18],[this.majorGridBuffer,this.groundMajor,.28]]:[]){
        gl.uniform4f(this.uniforms.uColor,.41,.49,.58,alpha);bind(buffer,null,null);gl.drawArrays(gl.LINES,0,vertices.length/3);
      }
      gl.uniform1f(this.uniforms.uClipAxis,this.section.enabled?axis+1:0);
      gl.uniform1f(this.uniforms.uHeightScale,this.displayHeight/this.height);
      const transparent=this.preview||(!this.technical&&(this.xray||this.material==='glass'));
      gl.depthMask(!transparent);gl.uniform1i(this.uniforms.uUnlit,0);
      const materials={plastic:{color:[.502,.604,.710,1],shine:20,spec:.035},aluminum:{color:[.72,.77,.82,1],shine:90,spec:.30},glass:{color:[.58,.75,.90,.26],shine:80,spec:.26}};
      const material=materials[this.material];const color=material.color.slice();if(this.xray&&!this.technical)color[3]=.12;if(this.preview)color[3]=.34;if(this.technical)color[3]=1;
      gl.uniform4fv(this.uniforms.uColor,color);gl.uniform1f(this.uniforms.uShine,material.shine);gl.uniform1f(this.uniforms.uSpecular,material.spec);gl.uniform1f(this.uniforms.uGlass,this.material==='glass'&&!this.xray&&!this.technical?1:0);
      if(transparent)this.uploadTransparentOrder(view);
      else if(this.sortedUpload){this.uploadMesh();this.sortedUpload=false;}
      bind(this.positionBuffer,this.normalBuffer,this.metaBuffer);
      gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,1);gl.drawArrays(gl.TRIANGLES,0,this.mesh.positions.length/3);gl.disable(gl.POLYGON_OFFSET_FILL);
      if(this.sectionCap?.positions.length){
        gl.depthMask(true);gl.uniform4f(this.uniforms.uColor,.66,.75,.84,.96);gl.uniform1f(this.uniforms.uGlass,0);
        bind(this.capBuffer,this.capNormalBuffer,null,[-1,4]);gl.drawArrays(gl.TRIANGLES,0,this.sectionCap.positions.length/3);
      }
      if(this.holeAnimation&&this.plugPositions.length){
        const progress=clamp((now-this.holeAnimation.start)/this.holeAnimation.duration,0,1);
        if(progress>=1)this.holeAnimation=null;
        else{
          const fall=clamp((progress-.32)/.68,0,1),alpha=1-fall;
          gl.depthMask(false);gl.uniform1f(this.uniforms.uBuildStage,3);gl.uniform1f(this.uniforms.uGlass,0);
          gl.uniform3f(this.uniforms.uOffset,0,0,-fall*this.height*1.15);gl.uniform4f(this.uniforms.uColor,.64,.76,.87,alpha);
          bind(this.plugBuffer,this.plugNormalBuffer,null,[-1,1]);gl.drawArrays(gl.TRIANGLES,0,this.plugPositions.length/3);gl.uniform3f(this.uniforms.uOffset,0,0,0);
        }
      }else if(this.holeAnimation)this.holeAnimation=null;
      gl.depthMask(false);gl.uniform1i(this.uniforms.uUnlit,1);gl.uniform1f(this.uniforms.uHeightScale,1);
      const drawWideStroke=(buffer,count,pixels,color)=>{
        if(!count)return;
        gl.uniform4fv(this.uniforms.uColor,color);
        gl.uniform2f(this.uniforms.uStrokePixel,pixels*dpr/width,pixels*dpr/height);
        gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
        for(const [attribute,size,offset] of [['position',3,0],['normal',3,12],['meta',1,24]]){
          const location=this.attributes[attribute];
          gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,28,offset);
        }
        gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(-1,-1);
        gl.drawArrays(gl.TRIANGLES,0,count);
        gl.disable(gl.POLYGON_OFFSET_FILL);gl.uniform2f(this.uniforms.uStrokePixel,0,0);
      };
      if(stage===0){
        gl.uniform4f(this.uniforms.uColor,.29,.45,.63,.95);bind(this.outlineBuffer,null,null);gl.drawArrays(gl.LINES,0,this.outlinePositions.length/3);
      }else{
        const ratio=this.displayHeight/this.height,edgeColor=night?[.69,.79,.87]:[.21,.29,.37];
        gl.uniform1f(this.uniforms.uHeightScale,ratio);
        if(this.mesh.edges.length){
          gl.uniform4f(this.uniforms.uColor,...edgeColor,this.focusBodyIndex>=0?.15:this.technical?.64:this.xray?.78:.36);
          bind(this.edgeBuffer,null,null);gl.lineWidth(1);gl.drawArrays(gl.LINES,0,this.mesh.edges.length/3);
          if(this.technical){
            gl.depthFunc(gl.GREATER);gl.uniform1f(this.uniforms.uDash,1);gl.uniform4f(this.uniforms.uColor,...edgeColor,.38);
            gl.drawArrays(gl.LINES,0,this.mesh.edges.length/3);gl.uniform1f(this.uniforms.uDash,0);gl.depthFunc(gl.LEQUAL);
          }
        }
        // Inspection previews can replace their mesh each animation frame.
        if(stage===3&&(!this.inspectionFrame||canvas.id==='model-canvas')){
          const count=this.updateSilhouette(view,ratio);
          drawWideStroke(this.silhouetteBuffer,count,1.8,[...edgeColor,this.focusBodyIndex>=0?.28:.74]);
        }
        if(this.focusBodyIndex>=0&&this.focusEdges.length){gl.uniform4f(this.uniforms.uColor,.19,.32,.46,.85);bind(this.focusEdgeBuffer,null,null);gl.drawArrays(gl.LINES,0,this.focusEdges.length/3);}
        if(stage===3&&!this.previewExport)drawWideStroke(this.activeStrokeBuffer,this.activeStrokeData.length/7,2,night?[.49,.75,1,.94]:[.21,.47,.72,.9]);
      }
      if(this.inspectionPatches.length){
        gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(-2,-2);
        gl.uniform1i(this.uniforms.uContactHatch,this.contactHatch?1:0);
        gl.uniform4f(this.uniforms.uColor,.21,.47,.72,this.contactHatch?.98:.83);
        bind(this.inspectPatchBuffer,null,null);gl.drawArrays(gl.TRIANGLES,0,this.inspectionPatches.length/3);
        gl.uniform1i(this.uniforms.uContactHatch,0);gl.disable(gl.POLYGON_OFFSET_FILL);
      }
      if(this.inspectionGuides.length){
        gl.uniform4f(this.uniforms.uColor,.32,.46,.60,.85);gl.uniform1f(this.uniforms.uDash,1);
        bind(this.inspectGuideBuffer,null,null);gl.drawArrays(gl.LINES,0,this.inspectionGuides.length/3);gl.uniform1f(this.uniforms.uDash,0);
      }
      gl.depthMask(true);gl.uniform1f(this.uniforms.uGlass,0);
      this.recording?.capture?.(canvas);
      this.canvas.dispatchEvent(new CustomEvent('labmodelrender',{detail:{camera:this.getCamera()}}));
      if(this.animation||this.cameraAnimation||this.construction||this.holeAnimation||(this.autoRotate&&!this.reducedMotion&&!global.document?.hidden))this.requestRender();
    }

    uploadTransparentOrder(view) {
      if (!this.transparentFaces) this.transparentFaces = new TransparentFaces(this.mesh);
      const sorted = this.transparentFaces;
      const changed = sorted.update(view, this.baseZ, this.displayHeight / this.height);
      if (!changed && this.sortedUpload) return;
      const gl = this.gl;
      for (const [buffer, data] of [[this.positionBuffer, sorted.positions],
          [this.normalBuffer, sorted.normals], [this.metaBuffer, sorted.metadata]]) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      }
      this.sortedUpload = true;
    }

    dispose() {
      if (this.disposed) return;
      this.cancelRecording();this.autoRotate=false;
      this.disposed = true;
      this.transparentFaces = null;
      this.animation = null;this.cameraAnimation=null;this.construction=null;this.holeAnimation=null;
      cancelAnimationFrame(this.frame);
      this.resizeObserver?.disconnect();
      this.events.abort();
      this.pointers.clear();
      if (this.gl) {
        this.gl.deleteBuffer(this.inspectPatchBuffer);this.gl.deleteBuffer(this.inspectGuideBuffer);
        this.gl.deleteBuffer(this.positionBuffer);
        this.gl.deleteBuffer(this.normalBuffer);
        this.gl.deleteBuffer(this.edgeBuffer);
        this.gl.deleteBuffer(this.silhouetteBuffer);this.gl.deleteBuffer(this.activeStrokeBuffer);
        this.gl.deleteBuffer(this.gridBuffer);
        this.gl.deleteBuffer(this.majorGridBuffer);
        for(const buffer of [this.metaBuffer,this.capBuffer,this.capNormalBuffer,this.shadowBuffer,this.outlineBuffer,this.plugBuffer,this.plugNormalBuffer,this.paperBuffer,this.paperEdgeBuffer,this.focusEdgeBuffer])this.gl.deleteBuffer(buffer);
        this.gl.deleteProgram(this.program);
      }
    }
  }

  global.LabModelViewer = LabModelViewer;
})(typeof window === 'undefined' ? globalThis : window);
