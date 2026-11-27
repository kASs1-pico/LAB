/* Point-to-point and parallel-face measurements in project millimetres. */
(() => {
  'use strict';

  const app = window.LabApp;
  const paper = document.getElementById('paper');
  const wrap = document.getElementById('paper-wrap');
  const stage = document.getElementById('stage');
  const model = document.getElementById('model-canvas');
  const svgNS = 'http://www.w3.org/2000/svg';
  const formatter = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 3});
  const pointsPerMillimetre = 4;
  const minimumLength = 1e-6;
  const getSpace = () => app.isModelOpen() ? 'model' : 'sketch';
  const formatLength = value => `${formatter.format(value)} мм`;
  let session = null;
  let frame = 0;
  let saved = [];

  function element(tag, options = {}, text = '') {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(options)) node.setAttribute(key, value);
    if (text) node.textContent = text;
    return node;
  }

  function svg(tag, options = {}, text = '') {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(options)) node.setAttribute(key, value);
    if (text) node.textContent = text;
    return node;
  }

  function button(id, text, listener) {
    const node = element('button', {id, type: 'button'}, text);
    node.addEventListener('click', listener);
    return node;
  }

  const panel = element('section', {id: 'caliper-panel', class: 'glass', 'aria-labelledby': 'caliper-title', hidden: ''});
  const heading = element('div', {class: 'caliper-heading'});
  const dismiss = button('caliper-close', '×', () => close({restoreFocus:true}));
  dismiss.setAttribute('aria-label', 'Закрыть штангенциркуль');
  heading.append(element('strong', {id: 'caliper-title'}, 'Штангенциркуль'), dismiss);

  const methods = element('div', {class: 'caliper-methods', role: 'group', 'aria-label': 'Способ измерения'});
  const points = button('caliper-points', 'По точкам', () => selectMethod('points'));
  const faces = button('caliper-faces', 'По граням', () => selectMethod('faces'));
  methods.append(points, faces);
  const status = element('p', {id: 'caliper-status', role: 'status'});
  const value = element('output', {id: 'caliper-value', hidden: '', 'aria-label': 'Измеренное расстояние'});
  const actions = element('div', {class: 'caliper-actions'});
  const editActions = element('div', {class: 'caliper-actions', hidden: ''});
  const keyboard = button('caliper-keyboard', 'Клавиатурный выбор', focusCanvas);
  const reset = button('caliper-reset', 'Новый замер', resetPicks);
  const lessonToggle = button('caliper-vernier-toggle', 'Читать нониус', ()=>{
    session.lesson = !session.lesson;
    refreshPanel();
  });
  const lesson = element('form', {id:'caliper-vernier', hidden:''});
  const scale = svg('svg', {viewBox:'0 0 292 78',role:'img'});
  const answer = element('input', {id:'caliper-vernier-answer',type:'number',min:'0',step:'0.1',
    inputmode:'decimal',required:'',placeholder:'мм'});
  const readingStatus = element('output', {'aria-live':'polite'});
  lesson.append(scale, element('p', {}, 'Сложите целые миллиметры до нуля нониуса и число десятых по первому совпавшему штриху.'));
  const answerRow = element('div', {class:'caliper-actions'});
  const check = element('button', {type:'submit'}, 'Проверить');
  answer.setAttribute('aria-label','Показание нониуса в миллиметрах');
  answerRow.append(answer,check);
  lesson.append(answerRow,readingStatus);
  lesson.addEventListener('submit',event=>{
    event.preventDefault();
    if (!session?.result) return;
    const reading = Math.round(session.result.value*10)/10;
    readingStatus.textContent = Math.abs(answer.valueAsNumber-reading)<1e-7
      ? 'Верно.' : 'Проверьте целые миллиметры и совпадение рисок.';
  });
  answer.addEventListener('input',()=>{readingStatus.textContent='';});
  const pinButton = button('caliper-pin', 'Закрепить', saveMeasurement);
  const takeToDrawing = button('caliper-to-drawing', 'Перенести на А4', () => {
    const record = saveMeasurement();
    if (record) window.LabDrawingSheet?.addMeasurement(record.id);
  });
  actions.append(keyboard, reset, lessonToggle);
  editActions.append(pinButton, takeToDrawing,
    button('caliper-tolerance', 'Проверить допуск', () => openJournal('tolerance')),
    button('caliper-journal', 'В журнал', () => openJournal('journal')));
  panel.append(heading, methods, status, value, actions, lesson, editActions);
  const guides = svg('svg', {id: 'caliper-guides', 'aria-hidden': 'true', hidden: ''});
  document.body.append(guides, panel);

  function resetPicks() {
    if (!session) return;
    session.picks = [];
    session.result = null;
    session.message = '';
    session.cursor = null;
    answer.value = '';
    readingStatus.textContent = '';
    refreshPanel();
  }

  function selectMethod(kind) {
    if (!session || kind === session.kind) return;
    session.kind = kind;
    resetPicks();
  }

  function refreshPanel() {
    const {space, kind, picks, result, message} = session;
    const hasPoint = picks.length > 0;
    const target = kind === 'faces' ? 'грань' : 'точку';
    methods.hidden = space === 'sketch';
    points.setAttribute('aria-pressed', String(kind === 'points'));
    faces.setAttribute('aria-pressed', String(kind === 'faces'));
    value.hidden = !result || session.lesson;
    value.value = value.hidden ? '' : formatLength(result.value);
    lessonToggle.setAttribute('aria-pressed',String(Boolean(session.lesson)));
    lesson.hidden = !result || !session.lesson;
    if (!lesson.hidden) renderScale(result.value);
    status.textContent = message || (result
      ? kind === 'faces' ? 'Расстояние между плоскостями по нормали.' : 'Прямое расстояние между точками.'
      : hasPoint ? `Укажите вторую ${target}.` : `Укажите первую ${target}.`);
    editActions.hidden = !result || session.lesson;
    reset.disabled = !hasPoint;
    pinButton.disabled = Boolean(result?.id);
    pinButton.textContent = result?.id ? 'Закреплено' : 'Закрепить';
    queueRender();
  }

  function renderScale(distance) {
    const tenths = Math.round(distance*10);
    const whole = Math.floor(tenths/10);
    const fraction = tenths%10;
    const origin = Math.max(0,whole-1);
    const x = number=>21+(number-origin)*23;
    const upper = svg('g', {'aria-hidden':'true'});
    upper.append(svg('line',{x1:10,y1:36,x2:282,y2:36}));
    for(let index=0;index<12;index++){
      const value=origin+index;
      upper.append(svg('line',{x1:x(value),x2:x(value),y1:20,y2:36}),
        svg('text',{x:x(value),y:15},String(value)));
    }
    const lower = svg('g', {'aria-hidden':'true'});
    lower.append(svg('line',{x1:10,y1:43,x2:282,y2:43}));
    for(let index=0;index<=10;index++){
      const tick=x(whole+fraction/10+.9*index);
      lower.append(svg('line',{x1:tick,x2:tick,y1:43,y2:59}),svg('text',{x:tick,y:73},String(index)));
    }
    scale.setAttribute('aria-label',`Основная шкала: ноль нониуса стоит между делениями ${whole} и ${whole+1} или на первом из них. Совпадает штрих нониуса номер ${fraction}.`);
    scale.replaceChildren(upper,lower);
  }

  function refreshPins() {
    const records = app.getMeasurements?.() || [];
    saved = app.getCurrentMeasurements?.() || records;
    if (session?.result?.id && !records.some(record => record.id === session.result.id)) {
      const {id, ...reading} = session.result;
      session.result = reading;
      refreshPanel();
    }
    queueRender();
  }

  function saveMeasurement() {
    if (!session?.result) return null;
    if (session.result.id) return session.result;
    const record = app.addMeasurement?.(session.result);
    if (!record) return null;
    session.result = record;
    refreshPins();
    refreshPanel();
    return record;
  }

  function openJournal(mode) {
    const record = session?.result;
    if (!record || !window.LabMeasurementJournal) return;
    close({restoreFocus:true});
    window.LabMeasurementJournal.open(record, {mode});
  }

  function fail(message) {
    session.message = message;
    refreshPanel();
  }

  function pick(spot) {
    if (!session || !spot || session.result) return;
    const {space, kind, picks} = session;
    if (picks.length === 0) {
      picks.push(spot);
      session.message = '';
      refreshPanel();
      return;
    }
    const pair = [...picks, spot];
    try {
      const record = window.LabMeasurements.measure({
        space, kind, points: pair.map(item => item.point),
        ...(kind === 'faces' && {normals: pair.map(item => item.normal)})
      });
      if (record.value < minimumLength) {
        fail(kind === 'faces' ? 'Плоскости совпадают. Выберите другую грань.' : 'Точки совпадают. Выберите другую точку.');
        return;
      }
      session.result = {...record, bodyIds: pair.map(item => item.bodyId)};
    } catch (error) {
      fail(error.message);
      return;
    }
    picks.push(spot);
    session.message = '';
    refreshPanel();
  }

  function closestSketchPoint(raw, limit) {
    let closestPoint = raw, closestLine = raw, pointDistance = limit, lineDistance = limit;
    function checkPoint(point) {
      const distance = Math.hypot(raw.x - point.x, raw.y - point.y);
      if (distance >= pointDistance) return;
      closestPoint = point;
      pointDistance = distance;
    }
    function checkLine(point) {
      const distance = Math.hypot(raw.x - point.x, raw.y - point.y);
      if (distance >= lineDistance) return;
      closestLine = point;
      lineDistance = distance;
    }
    for (const shape of app.getVisibleStrokes()) {
      if (shape.type === 'circle' || shape.type === 'arc') {
        const {cx, cy, r} = shape;
        const phase = Math.atan2(raw.y - cy, raw.x - cx);
        const at = angle => ({x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle)});
        checkPoint({x: cx, y: cy});
        if (shape.type === 'arc') {
          const start = shape.start * Math.PI / 180, end = (shape.start + shape.delta) * Math.PI / 180;
          checkPoint(at(start));
          checkPoint(at(end));
          const degrees = phase * 180 / Math.PI;
          const fromStart = ((Math.sign(shape.delta) * (degrees - shape.start)) % 360 + 360) % 360;
          if (fromStart > Math.abs(shape.delta)) continue;
        }
        checkLine(at(phase));
        continue;
      }
      const vertices = shape.type === 'line' ? [shape.a, shape.b] : shape.points;
      if (!vertices) continue;
      for (let i = 0; i < vertices.length; i++) {
        const b = vertices[i];
        checkPoint(b);
        if (!i) continue;
        const a = vertices[i - 1], x = b.x - a.x, y = b.y - a.y, square = x * x + y * y;
        if (!square) continue;
        const position = Math.max(0, Math.min(1, ((raw.x - a.x) * x + (raw.y - a.y) * y) / square));
        checkLine({x: a.x + position * x, y: a.y + position * y});
      }
    }
    return pointDistance < limit ? closestPoint : closestLine;
  }

  function selectSketch(x, y) {
    const matrix = paper.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(x, y).matrixTransform(matrix.inverse());
    const size = paper.viewBox.baseVal;
    if (point.x < 0 || point.x > size.width || point.y < 0 || point.y > size.height) {
      fail('Выберите точку внутри листа.');
      return;
    }
    const chosen = closestSketchPoint(point, 11 / Math.max(Math.hypot(matrix.a, matrix.b), .01));
    pick({point: [chosen.x / pointsPerMillimetre, -chosen.y / pointsPerMillimetre, 0], bodyId: null});
  }

  function isCylindricalFace(hit) {
    const body = app.getBodies()[hit.bodyIndex];
    if (!body?.assemblyCylinders?.length || !window.LabAssemblyGeometry) return false;
    try {
      return window.LabAssemblyGeometry.surfaceReference(body, hit, 'axis').kind === 'cylinder';
    } catch {
      return false;
    }
  }

  function selectModel(hit) {
    const viewer = app.getModelViewer();
    if (!hit) {
      fail('Выберите точку на видимой стороне модели.');
      return;
    }
    if (viewer.animation || viewer.construction || viewer.heightGesture) {
      fail('Дождитесь окончания построения и повторите выбор.');
      return;
    }
    if (session.kind === 'faces' && isCylindricalFace(hit)) {
      fail('Выберите плоскую грань, например торец.');
      return;
    }
    const size = Math.hypot(...hit.normal);
    if (size <= minimumLength) return;
    pick({point: hit.point, bodyId: hit.bodyId, normal: hit.normal.map(value => value / size)});
  }

  function boundsFor(space) {
    const view = (space === 'model' ? model : paper).getBoundingClientRect();
    const boundary = space === 'model' ? view : stage.getBoundingClientRect();
    return {
      left: Math.max(0, view.left, boundary.left), right: Math.min(innerWidth, view.right, boundary.right),
      top: Math.max(0, view.top, boundary.top), bottom: Math.min(innerHeight, view.bottom, boundary.bottom)
    };
  }

  function focusCanvas() {
    if (!session) return;
    const rect = boundsFor(session.space);
    if (rect.right <= rect.left || rect.bottom <= rect.top) return;
    session.cursor = {x:(rect.left + rect.right) / 2, y:(rect.top + rect.bottom) / 2};
    (session.space === 'model' ? model : wrap).focus({preventScroll:true});
    session.message = 'Shift + стрелки перемещают метку. Enter выбирает точку.';
    refreshPanel();
  }

  function close({restoreFocus=false}={}) {
    if (!session) return;
    const origin = session.focused;
    session = null;
    panel.hidden = true;
    document.body.classList.remove('caliper-active');
    if (restoreFocus) (origin?.getClientRects().length ? origin : document.getElementById('studio-menu-toggle'))?.focus({preventScroll:true});
    queueRender();
  }

  function run() {
    if (session) return;
    const cad = window.LabCAD?.getState();
    const space = getSpace();
    if (app.isModelEditing() || cad?.task || cad?.presenting || window.LabDrawingSheet?.active()) {
      app.toast('Завершите текущую операцию, чтобы измерить деталь.');
      return;
    }
    if (space === 'model' && !app.getModelViewer()?.mesh) {
      app.toast('Постройте объём из замкнутого контура или измерьте эскиз на листе.');
      return;
    }
    session = {space, kind:'points', picks:[], result:null, focused:document.activeElement};
    panel.hidden = false;
    document.body.classList.add('caliper-active');
    refreshPins();
    refreshPanel();
    dismiss.focus({preventScroll:true});
  }

  function displayPoints(record) {
    return window.LabMeasurements.displayPoints(record);
  }

  function queueRender() {
    if (!session && !saved.length) {
      guides.setAttribute('hidden','');
      return;
    }
    if (!frame) frame = requestAnimationFrame(() => {frame = 0; renderGuides();});
  }

  function renderGuides() {
    const space = getSpace();
    const rect = boundsFor(space);
    const empty = !session && !saved.some(record => record.space === space);
    const hidden = empty || rect.right <= rect.left || rect.bottom <= rect.top;
    guides.toggleAttribute('hidden', hidden);
    if (hidden) return;

    const matrix = space === 'sketch' ? paper.getScreenCTM() : null;
    const project = point => space === 'model'
      ? app.getModelViewer()?.project(point)
      : matrix && new DOMPoint(point[0] * pointsPerMillimetre, -point[1] * pointsPerMillimetre).matrixTransform(matrix);
    const clip = svg('clipPath', {id:'caliper-area'});
    clip.append(svg('rect', {x:rect.left, y:rect.top, width:rect.right - rect.left, height:rect.bottom - rect.top}));
    const marks = svg('g', {'clip-path':'url(#caliper-area)'});
    const records = saved.filter(record => record.space === space);
    if (session?.result && !session.result.id) records.push(session.result);
    records.forEach(record => {
      const [first, last] = displayPoints(record).map(project);
      if (!first || !last) return;
      marks.append(svg('line',{x1:first.x, y1:first.y, x2:last.x, y2:last.y, class:'caliper-span'}));
      for (const node of [first,last]) marks.append(svg('circle',{cx:node.x, cy:node.y, r:4, class:'caliper-point'}));
      if (!session?.lesson) marks.append(svg('text',{x:(first.x + last.x) / 2, y:(first.y + last.y) / 2 - 9},formatLength(record.value)));
    });
    if (session?.picks.length === 1) {
      const pin = project(session.picks[0].point);
      if (pin) marks.append(svg('circle',{cx:pin.x, cy:pin.y, r:5, class:'caliper-point'}));
    }
    if (session?.cursor) {
      const {x,y} = session.cursor;
      marks.append(svg('path',{d:`M${x-8},${y}H${x+8}M${x},${y-8}V${y+8}`,class:'caliper-cursor'}));
    }
    guides.replaceChildren(clip, marks);
  }

  document.addEventListener('pointerdown', event => {
    if (session?.space !== 'sketch' || event.button !== 0 || !wrap.contains(event.target) ||
        document.getElementById('pan').getAttribute('aria-pressed') === 'true') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    session.press = {id:event.pointerId, x:event.clientX, y:event.clientY};
  }, true);
  document.addEventListener('pointerup', event => {
    if (session?.press?.id !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const {x, y} = session.press;
    session.press = null;
    if (Math.hypot(event.clientX - x, event.clientY - y) <= 9) selectSketch(event.clientX, event.clientY);
  }, true);
  document.addEventListener('pointercancel', event => {
    if (session?.press?.id === event.pointerId) session.press = null;
  }, true);
  document.addEventListener('labmodelselect', event => {
    if (session?.space !== 'model' || event.target !== model) return;
    event.stopImmediatePropagation();
    if (!session.result) selectModel(event.detail.hit);
  }, true);
  document.addEventListener('labmodeledit', event => {
    if (session?.space === 'model' && event.target === model) event.stopImmediatePropagation();
  }, true);
  const keyboardMove = {ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1]};
  document.addEventListener('keydown', event => {
    if (!session || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && ['KeyZ','KeyY'].includes(event.code)) {
      close();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close({restoreFocus:true});
      return;
    }
    const cursor = session.cursor, change = keyboardMove[event.key];
    if (!cursor || event.target !== (session.space === 'model' ? model : wrap) ||
        !(event.key === 'Enter' || (event.shiftKey && change))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Enter') {
      if (session.result) return;
      if (session.space === 'model') selectModel(app.getModelViewer()?.pick(cursor.x, cursor.y));
      else selectSketch(cursor.x, cursor.y);
      return;
    }
    const rect = boundsFor(session.space);
    cursor.x = Math.max(rect.left + 1, Math.min(rect.right - 1, cursor.x + change[0] * 8));
    cursor.y = Math.max(rect.top + 1, Math.min(rect.bottom - 1, cursor.y + change[1] * 8));
    queueRender();
  }, true);

  document.addEventListener('labchange', event => {
    const {kind, open} = event.detail;
    if (['project','model','tool'].includes(kind) || (kind === 'draftview' && open)) close();
    if (['project','measurement','drawing'].includes(kind)) refreshPins();
    if (['model','viewport','draftview'].includes(kind)) queueRender();
  });
  for (const id of ['focus-toggle','cad-present','cad-detach','undo','redo']) document.getElementById(id)?.addEventListener('click', () => close());
  stage.addEventListener('scroll', queueRender, {passive:true});
  model.addEventListener('labmodelrender', queueRender);
  window.addEventListener('resize', queueRender);
  refreshPins();
  window.LabCaliper = {run, close, active:() => Boolean(session), getCurrent:() => session?.result || null, displayPoints};
})();
