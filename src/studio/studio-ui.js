/* Floating studio controls. Drawing and geometry live in LabApp. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id), app=window.LabApp, body=document.body;
  if(!app)return;
  const panel=$('model-panel'), inspector=$('tool-inspector'), contextToggle=$('context-toggle');
  const dockMobile=matchMedia('(max-width: 600px), (max-height: 500px) and (pointer: coarse)');
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const titles={ruler:'Линейка',compass:'Циркуль',pencil:'Карандаш',line:'Отрезок',eraser:'Ластик',contour:'Контур'};
  let focusMode=false, minimized=false, windowGesture=null, windowRect=null, mapDragging=false, mapFrame=0, layersFrame=0;
  const windowKey='drawing-lab-window-v1';
  const icon=name=>`<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  function toolsOpen(open){
    const trigger=$('tool-launch'),restoreFocus=!open&&$('tool-palette').contains(document.activeElement);
    body.classList.toggle('tools-open',open);trigger.setAttribute('aria-expanded',String(open));
    if(restoreFocus)trigger.focus({preventScroll:true});
  }
  function contextOpen(open,position){
    const restoreFocus=!open&&inspector.contains(document.activeElement);
    body.classList.toggle('context-open',open);contextToggle.setAttribute('aria-expanded',String(open));
    inspector.style.left='';inspector.style.top='';inspector.style.maxHeight='';
    if(restoreFocus)contextToggle.focus({preventScroll:true});
    if(open&&position&&!dockMobile.matches){
      const r=inspector.getBoundingClientRect(),top=clamp(position.y-r.height*.35,72,Math.max(72,innerHeight-r.height-12));
      inspector.style.left=`${clamp(position.x+22,10,Math.max(10,innerWidth-r.width-10))}px`;
      inspector.style.top=`${top}px`;inspector.style.maxHeight=`${Math.max(120,innerHeight-top-12)}px`;
    }
  }
  function menuOpen(open){$('studio-menu').hidden=!open;$('studio-menu-toggle').setAttribute('aria-expanded',String(open));}
  function layersOpen(open){$('layers-panel').hidden=!open;$('layers-toggle').setAttribute('aria-expanded',String(open));if(open)renderLayers();}
  function closePopovers(){toolsOpen(false);contextOpen(false);menuOpen(false);layersOpen(false);}
  $('tool-launch').addEventListener('click',()=>{const open=!body.classList.contains('tools-open');closePopovers();toolsOpen(open);});
  contextToggle.addEventListener('click',event=>{
    const open=!body.classList.contains('context-open');closePopovers();contextOpen(open);
    if(open&&event.detail===0)$('context-close').focus({preventScroll:true});
  });
  $('context-close').addEventListener('click',()=>{contextOpen(false);contextToggle.focus({preventScroll:true});});
  dockMobile.addEventListener('change',()=>{if(body.classList.contains('context-open'))contextOpen(true);});
  $('studio-menu-toggle').addEventListener('click',()=>{const open=$('studio-menu').hidden;closePopovers();menuOpen(open);});
  $('menu-close').addEventListener('click',()=>{menuOpen(false);$('studio-menu-toggle').focus();});
  $('layers-toggle').addEventListener('click',()=>{const open=$('layers-panel').hidden;closePopovers();layersOpen(open);});
  $('layers-close').addEventListener('click',()=>{layersOpen(false);$('layers-toggle').focus();});
  document.addEventListener('pointerdown',event=>{
    if(!event.target.closest('#tool-launch,#tool-palette'))toolsOpen(false);
    if(!event.target.closest('#context-toggle,.inspector'))contextOpen(false);
    if(!event.target.closest('#studio-menu-toggle,#studio-menu'))menuOpen(false);
    if(!event.target.closest('#layers-toggle,#layers-panel'))layersOpen(false);
  });
  document.addEventListener('labcontext',event=>{if(!focusMode){closePopovers();contextOpen(true,event.detail);}});
  for(const [id,label] of [['new-sheet','Новый лист'],['help','Как пользоваться']]){
    const button=$(id),text=document.createElement('span');text.textContent=label;button.appendChild(text);$('document-actions').appendChild(button);button.addEventListener('click',()=>menuOpen(false));
  }
  const mobileHistory=document.createElement('div');mobileHistory.className='menu-history';
  for(const [label,method] of [['↶ Отменить','undo'],['↷ Повторить','redo']]){const button=document.createElement('button');button.textContent=label;button.addEventListener('click',()=>app[method]());mobileHistory.appendChild(button);}
  $('document-actions').appendChild(mobileHistory);
  $('paper-settings-slot').appendChild(document.querySelector('.paper-settings'));
  $('about-project').addEventListener('click',()=>{menuOpen(false);app.showAbout();});
  $('fullscreen-toggle').addEventListener('click',async()=>{
    try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();menuOpen(false);}
    catch{app.toast('Полный экран недоступен в этом браузере. Режим «Только лист» увеличит рабочую область.');}
  });
  document.addEventListener('fullscreenchange',()=>{$('fullscreen-toggle').innerHTML=icon('fit')+(document.fullscreenElement?'Выйти из полного экрана':'Полный экран');app.fit();constrainWindow();});
  function setFocus(value){
    focusMode=value;closePopovers();body.classList.toggle('focus-mode',value);$('focus-restore').hidden=!value;
    for(const el of document.querySelectorAll('.topbar,#tool-dock,.inspector,.canvas-bottomline,#layers-toggle,#studio-menu,#layers-panel,#model-bubble,#minimap-wrap'))el.inert=value;
    const integrated=body.classList.contains('cad-integrated');
    panel.inert=value&&!integrated;
    $('focus-toggle').setAttribute('aria-pressed',String(value));
    const target=value?$(integrated?'model-canvas':'paper-wrap'):$('focus-toggle');
    target.focus({preventScroll:true});app.fit();scheduleMap();
  }
  $('focus-toggle').addEventListener('click',()=>setFocus(!focusMode));$('focus-restore').addEventListener('click',()=>setFocus(false));
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||$('welcome-dialog').open||$('action-dialog').open)return;
    if(event.key!=='Escape')return;
    if(focusMode){event.preventDefault();setFocus(false);}
    else {closePopovers();modelOptions(false);}
  });
  function updateTool(){
    const tool=app.getState().tool;$('active-tool-name').textContent=titles[tool];$('tool-launch').querySelector('use').setAttribute('href',`#i-${tool}`);
    $('tool-launch').setAttribute('aria-label',`Инструменты. Выбран: ${titles[tool]}`);$('context-toggle').setAttribute('aria-label',`Настройки: ${titles[tool]}`);
  }
  function modelOptions(open){panel.classList.toggle('model-options-open',open);$('model-settings-toggle').setAttribute('aria-expanded',String(open));}
  $('model-settings-toggle').addEventListener('click',()=>modelOptions(!panel.classList.contains('model-options-open')));
  $('model-options-close').addEventListener('click',()=>{modelOptions(false);$('model-settings-toggle').focus();});
  function rectOfWindow(){const r=panel.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}
  function applyRect(rect){
    const width=clamp(rect.width,Math.min(250,innerWidth-16),innerWidth-16),height=clamp(rect.height,Math.min(220,innerHeight-16),innerHeight-16);
    const x=clamp(rect.x,8,innerWidth-width-8),y=clamp(rect.y,8,innerHeight-height-8);
    Object.assign(panel.style,{left:`${x}px`,top:`${y}px`,right:'auto',bottom:'auto',width:`${width}px`,height:`${height}px`});
    windowRect={x,y,width,height};app.getModelViewer()?.resize();
  }
  function saveWindow(){if(panel.classList.contains('model-maximized')||panel.hidden)return;try{localStorage.setItem(windowKey,JSON.stringify(rectOfWindow()));}catch{}}
  function constrainWindow(){if(!panel.hidden&&!panel.classList.contains('model-maximized'))applyRect(windowRect||rectOfWindow());app.getModelViewer()?.resize();scheduleMap();}
  try{const value=JSON.parse(localStorage.getItem(windowKey));if(value&&['x','y','width','height'].every(k=>Number.isFinite(value[k])))windowRect=value;}catch{}
  function startWindow(event,type){
    if(event.button>0||(type==='move'&&event.target.closest('button'))||panel.classList.contains('model-maximized'))return;
    event.preventDefault();closePopovers();const target=type==='move'?$('model-drag'):$('model-resize');target.setPointerCapture(event.pointerId);
    windowGesture={id:event.pointerId,type,x:event.clientX,y:event.clientY,rect:rectOfWindow(),target};panel.classList.add('window-moving');
  }
  function moveWindow(event){
    const g=windowGesture;if(!g||g.id!==event.pointerId)return;event.preventDefault();const dx=event.clientX-g.x,dy=event.clientY-g.y;
    applyRect(g.type==='move'?{...g.rect,x:g.rect.x+dx,y:g.rect.y+dy}:{...g.rect,width:g.rect.width+dx,height:g.rect.height+dy});
  }
  function endWindow(event){
    const g=windowGesture;if(!g||g.id!==event.pointerId)return;
    if(event.type==='pointercancel')applyRect(g.rect);
    else if(g.type==='move'){
      const r=rectOfWindow();if(r.x<38)r.x=10;if(innerWidth-r.x-r.width<38)r.x=innerWidth-r.width-10;
      if(r.y<38)r.y=10;if(innerHeight-r.y-r.height<38)r.y=innerHeight-r.height-10;applyRect(r);
    }
    windowGesture=null;panel.classList.remove('window-moving');if(g.target.hasPointerCapture(g.id))g.target.releasePointerCapture(g.id);saveWindow();
  }
  for(const [id,type] of [['model-drag','move'],['model-resize','resize']]){
    $(id).addEventListener('pointerdown',e=>startWindow(e,type));$(id).addEventListener('pointermove',moveWindow);
    $(id).addEventListener('pointerup',endWindow);$(id).addEventListener('pointercancel',endWindow);
    $(id).addEventListener('lostpointercapture',e=>{if(windowGesture?.id===e.pointerId)endWindow(e);});
  }
  $('model-resize').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const r=rectOfWindow();r.width+=event.key==='ArrowRight'?20:event.key==='ArrowLeft'?-20:0;r.height+=event.key==='ArrowDown'?20:event.key==='ArrowUp'?-20:0;applyRect(r);saveWindow();
  });
  $('model-minimize').addEventListener('click',()=>{saveWindow();minimized=true;app.setModelOpen(false);$('model-bubble').hidden=false;});
  $('model-bubble').addEventListener('click',()=>app.setModelOpen(true));
  $('model-close').addEventListener('click',()=>{minimized=false;$('model-bubble').hidden=true;modelOptions(false);});
  $('model-maximize').addEventListener('click',()=>{
    if(!panel.classList.contains('model-maximized'))windowRect=rectOfWindow();
    const max=panel.classList.toggle('model-maximized');$('model-maximize').setAttribute('aria-pressed',String(max));$('model-maximize').setAttribute('aria-label',max?'Вернуть размер окна модели':'Развернуть 3D-модель');
    if(!max&&windowRect)applyRect(windowRect);app.getModelViewer()?.resize();scheduleMap();
  });
  window.addEventListener('resize',constrainWindow);new ResizeObserver(()=>app.getModelViewer()?.resize()).observe(panel);
  $('model-material').addEventListener('change',e=>app.setModelSetting('material',e.target.value));
  $('model-xray').addEventListener('change',e=>app.setModelSetting('xray',e.target.checked));
  $('model-bevel').addEventListener('input',e=>$('bevel-label').textContent=`${Number(e.target.value).toLocaleString('ru-RU')} мм`);
  $('model-bevel').addEventListener('change',e=>app.setModelSetting('bevel',Number(e.target.value)));
  function section(){app.setModelSetting('section',{enabled:$('model-section').checked,axis:$('section-axis').value,position:Number($('section-position').value)/100});}
  $('model-section').addEventListener('change',section);$('section-axis').addEventListener('change',section);
  $('section-position').addEventListener('input',()=>{$('section-label').textContent=`${$('section-position').value}%`;section();});
  $('model-view').addEventListener('change',e=>app.getModelViewer()?.setView(e.target.value));
  $('model-construction').addEventListener('click',()=>{modelOptions(false);app.getModelViewer()?.replayConstruction();});
  function heightMode(enabled){$('model-height-drag').checked=enabled;$('model-height-mode').setAttribute('aria-pressed',String(enabled));app.getModelViewer()?.setHeightDrag(enabled);if(enabled)app.toast('Потяните верхнюю грань вверх или вниз.');}
  $('model-height-drag').addEventListener('change',e=>heightMode(e.target.checked));
  $('model-height-mode').addEventListener('click',()=>heightMode(!$('model-height-drag').checked));
  $('export-stl').addEventListener('click',()=>app.exportModel('stl'));$('export-glb').addEventListener('click',()=>app.exportModel('glb'));
  function renderViews(){
    const views=app.getState().savedViews,selected=$('saved-views').value;$('saved-views').replaceChildren();
    for(const view of views){const option=document.createElement('option');option.value=view.id;option.textContent=view.name;$('saved-views').appendChild(option);}
    if(!views.length){const option=document.createElement('option');option.value='';option.textContent='Нет сохранённых видов';$('saved-views').appendChild(option);}
    else if(views.some(v=>v.id===selected))$('saved-views').value=selected;else $('saved-views').value=views.at(-1).id;
    $('restore-view').disabled=!views.length;$('delete-view').disabled=!views.length;
  }
  $('save-view').addEventListener('click',()=>{app.saveCamera($('view-name').value);$('view-name').value='';const latest=app.getState().savedViews.at(-1);if(latest)$('saved-views').value=latest.id;});
  $('restore-view').addEventListener('click',()=>{const view=app.getState().savedViews.find(v=>v.id===$('saved-views').value);if(view)app.getModelViewer()?.setCamera(view.camera,true);});
  $('delete-view').addEventListener('click',()=>app.deleteCamera($('saved-views').value));
  function syncModelControls(){
    const state=app.getState();$('model-material').value=state.modelMaterial;$('model-xray').checked=state.modelXray;$('model-bevel').value=state.modelBevel;
    $('bevel-label').textContent=`${state.modelBevel.toLocaleString('ru-RU')} мм`;$('model-section').checked=state.modelSection.enabled;$('section-axis').value=state.modelSection.axis;
    $('section-position').value=Math.round(state.modelSection.position*100);$('section-label').textContent=`${$('section-position').value}%`;renderViews();
  }
  function scheduleLayers(){if(!layersFrame)layersFrame=requestAnimationFrame(()=>{layersFrame=0;renderLayers();});}
  function renderLayers(){
    if(document.activeElement?.matches('[data-layer-action=name]'))return;
    const focused=document.activeElement?.closest('[data-layer-action]'),focusedId=focused?.closest('[data-layer-row]')?.dataset.layerRow,focusedAction=focused?.dataset.layerAction;
    const state=app.getState();$('layer-list').replaceChildren();
    for(const layer of state.layers){
      const row=document.createElement('div');row.className=`layer-row${layer.id===state.activeLayer?' active':''}${layer.locked?' locked':''}`;row.dataset.layerRow=layer.id;
      const select=document.createElement('button');select.dataset.layerAction='select';select.className='layer-select';select.textContent=layer.id===state.activeLayer?'●':'○';select.setAttribute('aria-label',`Рисовать в слое: ${layer.name}`);select.setAttribute('aria-pressed',String(layer.id===state.activeLayer));
      const visible=document.createElement('input');visible.type='checkbox';visible.checked=layer.visible;visible.dataset.layerAction='visible';visible.setAttribute('aria-label',`Показать слой: ${layer.name}`);visible.title='Видимость слоя';
      const name=document.createElement('input');name.type='text';name.value=layer.name;name.maxLength=40;name.dataset.layerAction='name';name.setAttribute('aria-label','Название слоя');
      const lock=document.createElement('button');lock.dataset.layerAction='locked';lock.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="6" y="10" width="12" height="11" rx="2"/><path d="${layer.locked?'M8 10V7a4 4 0 0 1 8 0v3':'M8 10V7a4 4 0 0 1 7.5-2'}"/><path d="M12 14v3"/></svg>`;lock.setAttribute('aria-pressed',String(layer.locked));lock.setAttribute('aria-label',layer.locked?'Разблокировать слой':'Заблокировать слой');lock.title=layer.locked?'Слой заблокирован':'Защитить от рисования и стирания';
      const remove=document.createElement('button');remove.dataset.layerAction='delete';remove.className='layer-delete';remove.textContent='×';remove.setAttribute('aria-label',`Удалить слой: ${layer.name}`);remove.disabled=state.layers.length===1;
      row.append(select,visible,name,lock,remove);$('layer-list').appendChild(row);
    }
    $('layer-add').disabled=state.layers.length>=20;
    if(focusedId){const row=[...$('layer-list').children].find(el=>el.dataset.layerRow===focusedId);(row?.querySelector(`[data-layer-action="${focusedAction}"]`)||$('layer-add')).focus({preventScroll:true});}
  }
  $('layer-list').addEventListener('click',event=>{
    const button=event.target.closest('button[data-layer-action]');if(!button)return;const id=button.closest('[data-layer-row]').dataset.layerRow;
    app.changeLayer(button.dataset.layerAction,id,button.dataset.layerAction==='locked'?button.getAttribute('aria-pressed')!=='true':undefined);
  });
  $('layer-list').addEventListener('change',event=>{
    const input=event.target.closest('input[data-layer-action]');if(!input)return;const id=input.closest('[data-layer-row]').dataset.layerRow;
    app.changeLayer(input.dataset.layerAction,id,input.type==='checkbox'?input.checked:input.value);
  });
  $('layer-list').addEventListener('focusout',()=>requestAnimationFrame(()=>{if(!$('layer-list').contains(document.activeElement))renderLayers();}));
  $('layer-add').addEventListener('click',()=>app.changeLayer('add'));
  function scheduleMap(){if(!mapFrame)mapFrame=requestAnimationFrame(renderMap);}
  function renderMap(){
    mapFrame=0;const v=app.getViewport();$('minimap-wrap').hidden=v.zoom<=1.01;
    if(v.zoom<=1.01)return;
    const state=app.getState(),p=$('paper-wrap').getBoundingClientRect(),s=$('stage').getBoundingClientRect();
    const x=clamp((s.left-p.left)/p.width*state.width,0,state.width),y=clamp((s.top-p.top)/p.height*state.height,0,state.height);
    const right=clamp((s.right-p.left)/p.width*state.width,0,state.width),bottom=clamp((s.bottom-p.top)/p.height*state.height,0,state.height);
    $('minimap').setAttribute('viewBox',`0 0 ${state.width} ${state.height}`);
    $('minimap').innerHTML=`<rect width="${state.width}" height="${state.height}" fill="#fff"/><g class="minimap-drawing">${app.getDrawingMarkup()}</g><rect x="${x}" y="${y}" width="${Math.max(1,right-x)}" height="${Math.max(1,bottom-y)}" fill="#8BADCE22" stroke="#5B7E9F" stroke-width="8"/>`;
    $('minimap-wrap').classList.toggle('model-visible',app.isModelOpen());
  }
  function panMap(event){const p=new DOMPoint(event.clientX,event.clientY).matrixTransform($('minimap').getScreenCTM().inverse());app.panTo(p);scheduleMap();}
  $('minimap').addEventListener('pointerdown',event=>{if(event.button>0)return;event.preventDefault();mapDragging=true;$('minimap').setPointerCapture(event.pointerId);panMap(event);});
  $('minimap').addEventListener('pointermove',event=>{if(mapDragging)panMap(event);});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])$('minimap').addEventListener(name,()=>mapDragging=false);
  $('minimap').addEventListener('keydown',event=>{
    if(!event.key.startsWith('Arrow'))return;event.preventDefault();const s=app.getState(),r=$('paper-wrap').getBoundingClientRect(),v=$('stage').getBoundingClientRect();
    app.panTo({x:(v.left+v.width/2-r.left)/r.width*s.width+(event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0)*s.width*.1,y:(v.top+v.height/2-r.top)/r.height*s.height+(event.key==='ArrowDown'?1:event.key==='ArrowUp'?-1:0)*s.height*.1});scheduleMap();
  });
  $('stage').addEventListener('scroll',scheduleMap,{passive:true});
  document.addEventListener('labchange',event=>{
    const kind=event.detail.kind;
    if(kind==='tool'){toolsOpen(false);updateTool();}
    if(kind==='drawing'){updateTool();if(!$('layers-panel').hidden)scheduleLayers();syncModelControls();}
    if(kind==='model'){
      if(event.detail.open){closePopovers();minimized=false;$('model-bubble').hidden=true;if(windowRect)applyRect(windowRect);else constrainWindow();syncModelControls();app.getModelViewer()?.setHeightDrag($('model-height-drag').checked);}
      else $('model-bubble').hidden=!minimized;
    }
    if(kind==='views')renderViews();scheduleMap();
  });
  updateTool();syncModelControls();scheduleMap();
})();
