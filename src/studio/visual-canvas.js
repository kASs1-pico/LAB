/* Canvas appearance and a presentation route through saved views. */
(() => {
  'use strict';
  const app = window.LabApp;
  const cad = window.LabCAD;
  const canvas = document.getElementById('model-canvas');
  if (!app || !cad || !canvas) return;

  const THEME_KEY = 'drawing-lab-canvas-theme';
  const TRAVEL_MS = 940;
  const DWELL_MS = 1800;

  function element(tag, properties = {}, text) {
    const node = document.createElement(tag);
    Object.assign(node, properties);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, id, handler, label = text) {
    const node = element('button', {type:'button', id}, text);
    node.setAttribute('aria-label', label);
    node.addEventListener('click', handler);
    return node;
  }

  const editor = element('section', {id:'canvas-tour', className:'workshop-popup glass', hidden:true});
  editor.setAttribute('aria-label', 'Маршрут камеры');
  const player = element('section', {id:'canvas-tour-player', className:'glass', hidden:true});
  player.setAttribute('aria-label', 'Управление маршрутом камеры');
  document.body.append(editor, player);

  let order = null;
  let playback = null;
  let timer = 0;

  function setTheme(theme, persist = true) {
    document.documentElement.dataset.canvasTheme = theme;
    document.body.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#192330' : '#EDF1F5');
    if (persist) try { localStorage.setItem(THEME_KEY, theme); } catch (_) { /* Current tab remains usable. */ }
    document.dispatchEvent(new CustomEvent('labcanvastheme', {detail:{theme}}));
  }
  try { setTheme(localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light', false); }
  catch (_) { setTheme('light', false); }

  function editRoute() {
    const views = app.getState().savedViews;
    const byId = new Map(views.map(view => [view.id, view]));
    order = (order || views.map(view => view.id)).filter(id => byId.has(id));
    const header = element('div', {className:'workshop-heading'});
    header.append(element('strong', {}, 'Маршрут камеры'), button('×', 'canvas-tour-close', close, 'Закрыть маршрут'));
    editor.replaceChildren(header);

    const list = element('ol', {className:'canvas-tour-stops'});
    order.forEach((id, index) => {
      const view = byId.get(id);
      const row = element('li');
      const title = element('span', {className:'canvas-tour-stop-name'}, view.name);
      const move = delta => {
        [order[index], order[index+delta]] = [order[index+delta], order[index]];
        editRoute();
        editor.querySelectorAll('.canvas-tour-stops li')[index+delta]?.querySelector('button:not(:disabled)')?.focus();
      };
      const up = button('↑', '', () => move(-1), `Выше · ${view.name}`);
      const down = button('↓', '', () => move(1), `Ниже · ${view.name}`);
      up.disabled = index === 0;
      down.disabled = index === order.length - 1;
      row.append(title, up, down, button('×', '', () => {
        order.splice(index, 1);
        editRoute();
        editor.querySelector('#canvas-tour-view')?.focus();
      }, `Убрать · ${view.name}`));
      list.append(row);
    });
    if (order.length) editor.append(list);
    else editor.append(element('p', {className:'workshop-hint'}, 'Добавьте два ракурса для показа.'));

    const addRow = element('div', {className:'canvas-tour-row'});
    const choices = element('select', {id:'canvas-tour-view'});
    choices.setAttribute('aria-label', 'Сохранённый ракурс');
    if (!views.length) choices.append(element('option', {}, 'Нет сохранённых ракурсов'));
    for (const view of views) choices.append(element('option', {value:view.id}, view.name));
    const add = button('Добавить', 'canvas-tour-add', () => {
      if (byId.has(choices.value) && order.length < 12) order.push(choices.value);
      editRoute();
      editor.querySelector('#canvas-tour-view')?.focus();
    });
    add.disabled = !views.length || order.length >= 12;
    choices.disabled = add.disabled;
    addRow.append(choices, add);

    const capture = element('form', {className:'canvas-tour-row'});
    const name = element('input', {id:'canvas-tour-name', type:'text', maxLength:32, placeholder:'Название нового ракурса'});
    name.setAttribute('aria-label', 'Название нового ракурса');
    const save = element('button', {type:'submit', id:'canvas-tour-save'}, 'Сохранить');
    save.disabled = views.length >= 12;
    capture.append(name, save);
    capture.addEventListener('submit', event => {
      event.preventDefault();
      const before = app.getState().savedViews;
      app.saveCamera(name.value);
      const after = app.getState().savedViews;
      if (after.length > before.length && order.length < 12) order.push(after.at(-1).id);
      editRoute();
      editor.querySelector('#canvas-tour-name')?.focus();
    });

    const start = button('▶ Показать маршрут', 'canvas-tour-start', () => play(order.map(id => byId.get(id)).filter(Boolean)));
    start.disabled = order.length < 2;
    editor.append(addRow, capture, start);
    editor.hidden = false;
  }

  const previous = button('←', 'canvas-tour-previous', () => navigate(-1), 'Предыдущий ракурс');
  const toggle = button('Ⅱ', 'canvas-tour-toggle', togglePause, 'Приостановить');
  const next = button('→', 'canvas-tour-next', () => navigate(1), 'Следующий ракурс');
  const stop = button('×', 'canvas-tour-stop', close, 'Закрыть показ');
  const status = element('span', {id:'canvas-tour-caption'});
  status.setAttribute('role', 'status');
  player.append(previous, toggle, next, status, stop);

  function updatePlayer() {
    if (!playback) return;
    const {index, stops, paused, phase} = playback;
    previous.disabled = index === 0;
    next.disabled = index >= stops.length - 1;
    const ended = phase === 'ended';
    toggle.textContent = paused || ended ? '▶' : 'Ⅱ';
    toggle.setAttribute('aria-label', ended ? 'Повторить показ' : paused ? 'Продолжить показ' : 'Приостановить');
    status.textContent = `${stops[index].name} · ${index+1}/${stops.length}`;
  }

  function phase(kind, duration) {
    if (!playback) return;
    clearTimeout(timer);
    playback.phase = kind;
    playback.deadline = performance.now() + duration;
    timer = setTimeout(() => {
      if (kind === 'move') phase('hold', DWELL_MS);
      else if (playback.index < playback.stops.length - 1) go(playback.index+1);
      else {
        playback.phase = 'ended';
        updatePlayer();
      }
    }, duration);
  }

  function go(index) {
    const show = playback;
    if (!show) return;
    clearTimeout(timer);
    show.index = index;
    const animate = !show.paused && !show.viewer.reducedMotion;
    show.viewer.setCamera(show.stops[index].camera, animate, false, TRAVEL_MS);
    if (show.paused) { show.phase = 'hold'; show.remaining = DWELL_MS; }
    else phase(animate ? 'move' : 'hold', animate ? TRAVEL_MS : DWELL_MS);
    updatePlayer();
  }
  function navigate(delta) {
    if (playback) go(Math.max(0, Math.min(playback.stops.length-1, playback.index+delta)));
  }
  function pause() {
    const show = playback;
    if (!show || show.paused || show.phase === 'ended') return;
    clearTimeout(timer);
    show.remaining = Math.max(25, show.deadline-performance.now());
    show.paused = true;
    show.viewer.stopCameraTransition();
    updatePlayer();
  }
  function togglePause() {
    const show = playback;
    if (!show) return;
    if (show.phase === 'ended') { go(0); return; }
    if (!show.paused) { pause(); return; }
    show.paused = false;
    if (show.phase === 'move') show.viewer.setCamera(show.stops[show.index].camera, true, false, show.remaining);
    phase(show.phase, show.remaining);
    updatePlayer();
  }
  function play(stops) {
    const viewer = app.getModelViewer();
    if (!viewer?.supported || !viewer.mesh || stops.length < 2) return;
    editor.hidden = true;
    playback = {
      viewer, stops, index:0, paused:false, phase:'hold',
      groundVisible:viewer.groundVisible, heightDrag:viewer.heightDragEnabled,
      inspectionFrame:viewer.inspectionFrame, source:app.getModelMesh()
    };
    viewer.cancelRecording();
    viewer.setAutoRotate(false);
    viewer.setHeightDrag(false);
    viewer.setActiveBody(null);
    if(viewer.paper.enabled&&viewer.paper.fit){
      const radius=Math.hypot(viewer.paper.widthMm,viewer.paper.heightMm,Math.max(0,viewer.bounds.max[2]))/2;
      viewer.inspectionFrame={center:viewer.center,radius};
    }
    viewer.setGroundVisible(false);
    document.body.classList.add('canvas-tour-playing');
    player.hidden = false;
    go(0);
    toggle.focus({preventScroll:true});
  }
  function close() {
    const show = playback;
    editor.hidden = true;
    player.hidden = true;
    clearTimeout(timer);
    playback = null;
    document.body.classList.remove('canvas-tour-playing');
    if (!show) return;
    show.viewer.stopCameraTransition();
    show.viewer.inspectionFrame=show.inspectionFrame;
    show.viewer.setHeightDrag(show.heightDrag);
    show.viewer.setGroundVisible(show.groundVisible);
  }

  function run(action) {
    close();
    if (action === 'theme') {
      const night = document.documentElement.dataset.canvasTheme !== 'dark';
      setTheme(night ? 'dark' : 'light');
      app.toast(night ? 'Тёмная тема включена.' : 'Светлая тема включена.');
      return;
    }
    if (action !== 'tour') return;
    if (!app.isModelOpen()) cad.modelMode(true, false);
    const viewer = app.getModelViewer();
    if (!viewer?.supported || !viewer.mesh) {
      app.toast('Для маршрута сначала постройте 3D-модель.');
      return;
    }
    editRoute();
    editor.querySelector('#canvas-tour-close').focus({preventScroll:true});
  }

  canvas.addEventListener('pointerdown', pause, true);
  canvas.addEventListener('wheel', pause, {passive:true});
  canvas.addEventListener('keydown', event => {
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home'].includes(event.key)) pause();
  }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || (!playback && editor.hidden) || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  }, true);
  document.addEventListener('pointerdown', event => {
    if (event.target.closest('#studio-menu-toggle,#cad-presentation-close,#open-model,#cad-back,#cad-detach,#model-close,#new-sheet')) close();
  }, true);
  document.addEventListener('labchange', ({detail}) => {
    if (detail.kind === 'project') { order = null; close(); }
    else if ((detail.kind === 'model'&&!detail.open)||detail.kind === 'modelgeometry'&&playback&&app.getModelMesh()!==playback.source) close();
  });
  window.addEventListener('pagehide', close);

  window.LabCanvasVisual = {run,close,active:()=>Boolean(playback)};
})();
