(function (global) {
  'use strict';

  const geometry = global.LabMechanismGeometry;
  const tau = Math.PI * 2;
  const rad = Math.PI / 180;
  const format = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 2});
  const number = value => format.format(value);
  const colors = {ink:'#253a54', blue:'#2475a4', pale:'#b2d9ee', orange:'#dd741f', red:'#a72b40', grid:'#b6c5d1'};
  const ns = 'http://www.w3.org/2000/svg';
  const svg = (type, attributes) => {
    const node = document.createElementNS(ns, type);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  };
  const pointsText = points => points.map(p => p.join(',')).join(' ');
  const figure = (label, box) => svg('svg', {
    viewBox:box.join(' '), class:'lab-workbench-preview', role:'img', 'aria-label':label,
    width:'100%', height:'280', preserveAspectRatio:'xMidYMid meet'
  });
  const polygon = (view, points, fill = colors.pale, stroke = colors.blue) => view.appendChild(svg('polygon', {
    points:pointsText(points), fill, stroke, 'stroke-width':1.4, 'vector-effect':'non-scaling-stroke',
    'stroke-linejoin':'round'
  }));
  const line = (view, a, b, stroke = colors.ink, dashed = false) => view.appendChild(svg('line', {
    x1:a[0], y1:a[1], x2:b[0], y2:b[1], stroke, 'stroke-width':1.5,
    'stroke-dasharray':dashed ? '4 4' : '', 'vector-effect':'non-scaling-stroke'
  }));
  const dot = (view, p, r, fill = colors.orange, stroke = colors.ink) => view.appendChild(svg('circle', {
    cx:p[0], cy:p[1], r, fill, stroke, 'stroke-width':1.2, 'vector-effect':'non-scaling-stroke'
  }));
  const trace = (view, points, stroke = colors.orange) => view.appendChild(svg('polyline', {
    points:pointsText(points), fill:'none', stroke, 'stroke-width':1.4, 'vector-effect':'non-scaling-stroke'
  }));
  const rotate = ([x, y], angle) => [
    x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)
  ];
  const translate = (points, x, y) => points.map(p => [p[0] + x, p[1] + y]);
  const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

  function field(ui, parent, title, options) {
    const label = ui.el('label');
    label.append(ui.el('span', title));
    const input = ui.el('input');
    Object.assign(input, {type:'number', step:'any', ...options});
    label.append(input);
    parent.append(label);
    return input;
  }

  function select(ui, parent, title, options) {
    const label = ui.el('label');
    label.append(ui.el('span', title));
    const control = ui.el('select');
    for (const [value, text] of options) {
      const choice = ui.el('option', text);
      choice.value = value;
      control.append(choice);
    }
    label.append(control);
    parent.append(label);
    return control;
  }

  function value(control) {
    if (!control.value || !control.checkValidity()) throw new Error('Проверьте значение поля «' + control.parentNode.firstElementChild.textContent + '».');
    return Number(control.value);
  }

  function controls(ui, section) {
    const row = ui.el('div', null, 'lab-workbench-actions');
    section.append(row);
    return row;
  }

  function guarded(ui, render) {
    return () => {
      try { render(); ui.status(''); }
      catch (error) { ui.status(error.message); }
    };
  }

  function angles(ui, section, redraw, scope) {
    const row = controls(ui, section);
    const slider = field(ui, row, 'Угол, °', {type:'range', min:0, max:360, step:1, value:0});
    let frame = 0, active = false;
    const reduce = global.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const play = ui.button('Пуск', () => {
      if (active) return stop();
      active = true;
      play.textContent = 'Пауза';
      let last = 0, degrees = Number(slider.value);
      function move(now) {
        if (!active || !scope.active()) return stop();
        if (!last || now - last > (reduce ? 500 : 28)) {
          const elapsed = last ? Math.min(now - last, 550) : 0;
          degrees = (degrees + elapsed * (reduce ? .06 : .10)) % 360;
          slider.value = Math.round(degrees);
          last = now;
          redraw();
        }
        frame = requestAnimationFrame(move);
      }
      frame = requestAnimationFrame(move);
    });
    function stop() {
      active = false;
      cancelAnimationFrame(frame);
      play.textContent = 'Пуск';
    }
    row.prepend(play);
    slider.addEventListener('input', redraw);
    scope.cleanup = stop;
    return slider;
  }

  function transmission(section, ui, scope) {
    const row = controls(ui, section);
    const mode = select(ui, row, 'Тип передачи', [['pair','Два колеса'], ['rack','Колесо и рейка']]);
    const moduleField = field(ui, row, 'Модуль, мм', {min:.3, max:8, value:1.5});
    const firstField = field(ui, row, 'Зубьев ведущего', {min:17, max:60, step:1, value:20});
    const secondField = field(ui, row, 'Зубьев ведомого', {min:17, max:60, step:1, value:32});
    const screen = ui.el('div');
    const result = ui.el('p');
    let cached, cachedKey;
    const redraw = guarded(ui, () => {
      const m = value(moduleField), z1 = value(firstField), angle = Number(slider.value) * rad;
      const isRack = mode.value === 'rack';
      secondField.parentNode.hidden = isRack;
      const z2 = isRack ? 0 : value(secondField);
      const key = [m, z1, z2].join('/');
      if (key !== cachedKey) {
        cached = [geometry.gear(m, z1), isRack ? geometry.rack(m, 48) : geometry.gear(m, z2)];
        cachedKey = key;
      }
      const [first, second] = cached;
      if (isRack) {
        const extent = first.tip * 3, pitch = Math.PI * m;
        const distance = -first.pitch * angle;
        const view = figure('Вращение колеса и поступательный ход рейки',
          [-extent / 2, -first.tip * 1.15, extent, first.tip * 2.3 + m * 3]);
        const shift = (distance % pitch + pitch) % pitch - 24.5 * pitch;
        polygon(view, translate(second, shift, first.pitch), '#f5d5a9', colors.orange);
        polygon(view, first.points.map(p => rotate(p, angle + Math.PI / 2)));
        dot(view, [0, 0], first.pitch, 'none', colors.grid);
        dot(view, [0, 0], m);
        line(view, [-extent / 2, first.pitch], [extent / 2, first.pitch], colors.ink, true);
        result.textContent = 'Угол ' + slider.value + '°. Рейка сместилась на ' + number(distance) +
          ' мм по оси X. Ход за оборот ' + number(tau * first.pitch) + ' мм.';
        screen.replaceChildren(view);
        return;
      }
      const span = first.pitch + second.pitch, height = Math.max(first.tip, second.tip) * 1.18;
      const view = figure('Зацепление двух зубчатых колёс',
        [-first.tip * 1.18, -height, first.tip * 1.18 + span + second.tip * 1.18, 2 * height]);
      const angle2 = -angle * z1 / z2;
      const phase = Math.PI + Math.PI / z2;
      polygon(view, first.points.map(p => rotate(p, angle)));
      polygon(view, translate(second.points.map(p => rotate(p, angle2 + phase)), span, 0), '#f5d5a9', colors.orange);
      dot(view, [0, 0], first.pitch, 'none', colors.grid);
      dot(view, [span, 0], second.pitch, 'none', colors.grid);
      dot(view, [0, 0], m);
      dot(view, [span, 0], m);
      result.textContent = 'Ведущее колесо ' + slider.value + '°. Ведомое ' + number(angle2 / rad) +
        '°. Отношение зубьев ' + z2 + '/' + z1 + '. Расстояние между осями ' + number(span) + ' мм.';
      screen.replaceChildren(view);
    });
    const slider = angles(ui, section, redraw, scope);
    section.append(screen, result);
    const insert = controls(ui, section);
    const gearID = select(ui, insert, 'Контур', [['first','Ведущее колесо'], ['second','Ведомое колесо']]);
    const x = field(ui, insert, 'Центр X, мм', {min:0, value:80});
    const y = field(ui, insert, 'Центр Y, мм', {min:0, value:65});
    const bore = field(ui, insert, 'Диаметр отверстия, мм', {min:0, value:5});
    insert.append(ui.button('Добавить на эскиз', () => {
      const m = value(moduleField), teeth = value(gearID.value === 'first' ? firstField : secondField);
      const g = geometry.gear(m, teeth), cx = value(x), cy = value(y), r = value(bore) / 2;
      if (r >= g.root - .15) throw new Error('Отверстие должно помещаться внутри впадин колеса.');
      const viewport = ui.app.getViewport();
      if (cx < g.tip || cy < g.tip || cx + g.tip > viewport.width / 4 || cy + g.tip > viewport.height / 4) {
        throw new Error('Измените центр, модуль или число зубьев, чтобы контур поместился на листе.');
      }
      const path = [...g.points, g.points[0]].map(([u, v]) => ({x:(cx + u) * 4, y:(cy + v) * 4}));
      const add = [{type:'path', points:path}];
      if (r > 0) add.push({type:'circle', cx:cx * 4, cy:cy * 4, r:r * 4});
      if (!ui.app.applySketchUpgrade({add})) throw new Error(ui.app.getSketchUpgradeError() || 'Не удалось добавить контур.');
      ui.close();
      ui.app.toast('Колесо добавлено. Откройте 3D, чтобы задать высоту.');
    }));
    section.append(ui.el('p', 'Учебный профиль колеса аппроксимирован отрезками. Нулевой диаметр оставляет колесо сплошным.'));
    for (const input of [mode, moduleField, firstField, secondField]) input.addEventListener('input', redraw);
    redraw();
  }

  function curvePlot(samples, angle, label) {
    const min = Math.min(...samples), max = Math.max(...samples);
    const span = max - min, left = 45, right = 330, top = 16, bottom = 58;
    const y = v => span ? bottom - (v - min) * (bottom - top) / span : (top + bottom) / 2;
    const path = samples.map((v, i) => [left + i * (right - left) / (samples.length - 1), y(v)]);
    const view = figure(label, [0, 0, 350, 79]);
    view.style.maxHeight = '145px';
    const tick = (x, yy, label, anchor) => {
      const text = svg('text', {x, y:yy, 'font-size':9, fill:'currentColor', 'text-anchor':anchor});
      text.textContent = label;
      view.append(text);
    };
    line(view, [left, bottom], [right, bottom], colors.grid);
    line(view, [left, top], [left, bottom], colors.grid);
    for (const v of new Set([min, max])) {
      line(view, [left - 3, y(v)], [right, y(v)], colors.grid, true);
      tick(left - 6, y(v) + 3, number(v), 'end');
    }
    tick(left - 6, top - 6, 'мм', 'end');
    for (const a of [0, 180, 360]) {
      const x = left + a * (right - left) / 360;
      line(view, [x, bottom], [x, bottom + 3], colors.grid);
      tick(x, bottom + 13, a + '°', 'middle');
    }
    trace(view, path, colors.blue);
    const at = Math.min(path.length - 1, Math.round(angle * (path.length - 1) / tau));
    line(view, [path[at][0], top], [path[at][0], bottom], colors.grid, true);
    dot(view, path[at], 2.5);
    return view;
  }

  function movement(section, ui, scope) {
    const row = controls(ui, section);
    const mode = select(ui, row, 'Механизм', [['crank','Кривошип и ползун'], ['cam','Кулачок и толкатель']]);
    const radius = field(ui, row, 'Радиус, мм', {min:2, max:90, value:20});
    const length = field(ui, row, 'Длина шатуна, мм', {min:3, max:200, value:55});
    const rise = field(ui, row, 'Высота профиля над базой, мм', {min:0, max:65, value:10});
    const lobes = field(ui, row, 'Выступов кулачка', {min:1, max:8, step:1, value:2});
    const mark = select(ui, row, 'Траектория', [['rod','Точка шатуна'], ['pin','Палец кривошипа'], ['slider','Ползун'], ['off','Скрыть']]);
    const along = field(ui, row, 'Положение точки вдоль шатуна, %', {min:0, max:100, step:5, value:50});
    const screen = ui.el('div');
    const result = ui.el('p');
    let chart, chartKey, outline, outlineSize, custom = null, baseline;
    const redraw = guarded(ui, () => {
      const isCam = mode.value === 'cam', a = Number(slider.value) * rad, drawn = isCam && Boolean(custom);
      const r = drawn ? 0 : value(radius);
      for (const input of [length, mark]) input.parentNode.hidden = isCam;
      along.parentNode.hidden = isCam || mark.value !== 'rod';
      for (const input of [rise, lobes]) input.parentNode.hidden = !isCam || drawn;
      radius.parentNode.hidden = drawn;
      camActions.hidden = !isCam;
      const l = drawn ? 0 : isCam ? value(rise) : value(length);
      const n = isCam && !drawn ? value(lobes) : 0;
      const key = drawn ? 'custom' : [isCam, r, l, n].join('/');
      if (isCam) {
        if (key !== chartKey) {
          outline = custom || geometry.camOutline(r, l, n);
          outlineSize = Math.max(...outline.map(p => Math.hypot(...p))) + 5;
          const offsets = Array.from({length:121}, (_, i) => geometry.cam(outline, tau * i / 120).lift);
          baseline = custom ? Math.min(...offsets) : r;
          chart = offsets.map(offset => offset - baseline);
        }
        const state = geometry.cam(outline, a, baseline), size = outlineSize;
        const view = figure('Кулачок и толкатель с плоским торцом', [-size, -size * 1.42, 2 * size, 2.5 * size]);
        polygon(view, state.points);
        if (!custom) dot(view, [0, 0], r, 'none', colors.grid);
        line(view, [0, -size * 1.4], [0, 0], colors.ink, true);
        polygon(view, rect(-size * .82, state.contact[1] - size * .08, size * 1.64, size * .08), '#f5d5a9', colors.orange);
        dot(view, state.contact, size * .035);
        dot(view, [0, 0], size * .04);
        result.textContent = 'Угол ' + slider.value + '°. Подъём плоского толкателя ' +
          number(custom ? Math.max(0, state.lift) : state.lift) + ' мм.';
        screen.replaceChildren(view, curvePlot(chart, a, 'Подъём толкателя за оборот'));
      } else {
        const state = geometry.crank(r, l, a), width = l + r * 2.65, height = r * 2.65;
        const view = figure('Кривошип, шатун и ползун', [-r * 1.28, -height / 2, width, height]);
        line(view, [-r * 1.2, 0], [l + r * 1.3, 0], colors.ink, true);
        dot(view, [0, 0], r, 'none', colors.grid);
        const t = mark.value === 'rod' ? value(along) / 100 : .5;
        const point = model => mark.value === 'pin' ? model.pin : mark.value === 'slider' ?
          [model.slider, 0] : [model.pin[0] * (1 - t) + model.slider * t, model.pin[1] * (1 - t)];
        if (mark.value !== 'off') {
          const path = Array.from({length:121}, (_, i) => point(geometry.crank(r, l, tau * i / 120)));
          trace(view, path);
        }
        line(view, [0, 0], state.pin, colors.blue);
        line(view, state.pin, [state.slider, 0], colors.blue);
        polygon(view, rect(state.slider - r * .24, -r * .16, r * .48, r * .32));
        dot(view, [0, 0], r * .06);
        dot(view, state.pin, r * .06);
        if (mark.value !== 'off') dot(view, point(state), r * .082, colors.red);
        if (key !== chartKey) chart = Array.from({length:121}, (_, i) => geometry.crank(r, l, tau * i / 120).slider);
        result.textContent = 'Координата ползуна ' + number(state.slider) + ' мм. Полный ход ' + number(2 * r) +
          ' мм. Угол ' + slider.value + '°.';
        screen.replaceChildren(view, curvePlot(chart, a, 'Координата ползуна за оборот'));
      }
      chartKey = key;
    });
    const slider = angles(ui, section, redraw, scope);
    const camActions = controls(ui, section);
    camActions.append(ui.button('Взять профиль с листа', () => {
      const analysis = global.LabExtrusion.analyze(ui.app.getModelStrokes(), {tolerance:2});
      if (!analysis.ok || analysis.solids.length !== 1) {
        throw new Error('Начертите на листе один простой замкнутый внешний контур кулачка.');
      }
      const source = analysis.solids[0].outer.points;
      const center = ['x','y'].map(axis => {
        const coordinates = source.map(point => point[axis]);
        return (Math.min(...coordinates) + Math.max(...coordinates)) / 2;
      });
      custom = source.map(({x, y}) => [(x - center[0]) / 4, (y - center[1]) / 4]);
      chartKey = null;
      redraw();
      ui.status('Ось вращения принята в центре габаритов исходного контура.');
    }), ui.button('Параметрический профиль', () => {
      custom = null;
      redraw();
    }));
    section.append(screen, result);
    for (const input of [mode, radius, length, rise, lobes, mark, along]) input.addEventListener('input', redraw);
    redraw();
  }

  function needParts(ui, minimum = 1) {
    const parts = ui.app.getProjectionMesh()?.bodies;
    if (!parts || parts.length < minimum) throw new Error(minimum > 1 ?
      'Откройте или постройте сборку минимум из двух деталей.' : 'Постройте хотя бы одну деталь в редакторе.');
    return parts;
  }

  function plan(label, points) {
    const x = points.map(p => p[0]), y = points.map(p => -p[1]);
    const left = Math.min(...x), top = Math.min(...y);
    const width = Math.max(1, Math.max(...x) - left), height = Math.max(1, Math.max(...y) - top);
    const padding = .10 * Math.max(width, height) + 2;
    return {view: figure(label, [left - padding, top - padding, width + padding * 2, height + padding * 2]),
      project: p => [p[0], -p[1]], scale: Math.max(width, height)};
  }

  function assemblyChecks(section, ui, scope) {
    const setup = controls(ui, section);
    const output = ui.el('div');
    const result = ui.el('p');
    const details = ui.el('div');
    const checks = select(ui, setup, 'Проверка', [['range','Диапазон вращения'], ['access','Доступ инструмента']]);
    const parts = needParts(ui, 2);
    const moving = select(ui, setup, 'Проверяемая деталь', parts.map((part, index) => [index, part.name]));
    const inspect = global.LabInspectGeometry, solid = global.LabSolid, check = global.LabAssemblyGeometry;
    let operation = 0;
    const showMode = () => {
      const ticket = ++operation;
      details.replaceChildren();
      output.replaceChildren();
      result.textContent = '';
      ui.status('');
      const selected = parts[Number(moving.value)], others = parts.filter(p => p !== selected);
      const row = controls(ui, details);
      const axisChoices = [['2','Z'], ['0','X'], ['1','Y']];
      const axis = select(ui, row, 'Ось', axisChoices);
      if (checks.value === 'range') {
        const step = select(ui, row, 'Шаг проверки', [['5','5°'], ['2','2°'], ['1','1°'], ['10','10°']]);
        const center = inspect.center(selected.bounds);
        const point = ['X','Y','Z'].map((name, i) => field(ui, row, 'Точка оси ' + name + ', мм', {
          min:-10000, max:10000, value:Math.round(center[i] * 1000) / 1000
        }));
        row.append(ui.button('Проверить −180…180°', async () => {
          const run = ++operation;
          if (parts.reduce((sum, part) => sum + part.mesh.positions.length, 0) > 180000) {
            throw new Error('Для пошаговой проверки вращения выберите сборку до 20 000 треугольников.');
          }
          const a = point.map(value);
          const b = a.map((coordinate, i) => coordinate + Number(i === Number(axis.value)));
          const increment = Number(step.value), samples = [], ranges = [];
          let unclear = 0;
          for (let angle = -180; angle <= 180; angle += increment) {
            if (!scope.active() || operation !== run) return;
            const pose = inspect.rotation([a, b], angle * rad);
            const bounds = pose.box(selected.bounds);
            const nearby = others.filter(part => bounds.min.every((p, i) => p < part.bounds.max[i] && bounds.max[i] > part.bounds.min[i]));
            let blocked = false;
            if (nearby.length) {
              try {
                const mesh = solid.transformMesh(selected.mesh, pose.apply);
                blocked = nearby.some(part => Boolean(check.interference(mesh, part.mesh)));
              } catch {
                blocked = null;
                unclear++;
              }
            }
            samples.push({angle, blocked});
            if (samples.length % 8 === 0) {
              ui.status('Выполнена проверка до ' + angle + '°.');
              await new Promise(resolve => setTimeout(resolve, 0));
            }
          }
          for (const sample of samples) {
            if (sample.blocked !== false) continue;
            const last = ranges.at(-1);
            if (last && sample.angle === last[1] + increment) last[1] = sample.angle;
            else ranges.push([sample.angle, sample.angle]);
          }
          const rangeMap = figure('Углы без пересечения и углы со столкновениями', [0, 0, 371, 32]);
          rangeMap.setAttribute('height', 60);
          for (const {angle, blocked} of samples) {
            const x = 5 + angle + 180;
            const ink = blocked === null ? colors.orange : blocked ? colors.red : colors.blue;
            line(rangeMap, [x, 5], [x, 27], ink);
          }
          output.replaceChildren(rangeMap);
          result.textContent = ranges.length ? 'Свободные положения ' +
            ranges.map(([a, b]) => a === b ? a + '°' : a + '…' + b + '°').join(', ') + '.' :
            'Свободных положений среди проверенных углов не найдено.';
          ui.status('Шаг ' + increment + '°, положений ' + samples.length +
            (unclear ? ', без результата ' + unclear : '') + '. Узкие препятствия могут лежать между отсчётами.');
        }));
        details.append(ui.el('p', 'Ось проходит через указанную точку. Синие отсчёты свободны, красные показывают пересечение, оранжевые отмечают расчёты без результата.'));
      } else {
        const sign = select(ui, row, 'Направление', [['1','Вдоль оси'], ['-1','Против оси']]);
        const diameter = field(ui, row, 'Диаметр инструмента, мм', {min:.2, max:200, value:10});
        const length = field(ui, row, 'Свободная длина, мм', {min:.5, max:500, value:45});
        const origin = inspect.center(selected.bounds);
        const positions = ['X','Y','Z'].map((name, i) => field(ui, row, name + ' точки, мм', {min:-10000, max:10000, value:origin[i]}));
        function updatePoint() {
          const center = origin.slice(), k = Number(axis.value);
          center[k] = (Number(sign.value) === 1 ? selected.bounds.max : selected.bounds.min)[k];
          positions.forEach((control, i) => control.value = Math.round(center[i] * 1000) / 1000);
        }
        for (const input of [axis, sign]) input.addEventListener('change', updatePoint);
        updatePoint();
        row.append(ui.button('Проверить цилиндр доступа', () => {
          if (operation !== ticket) return;
          const start = positions.map(value), r = value(diameter) / 2, distance = value(length);
          const direction = [0, 1, 2].map(i => i === Number(axis.value) ? Number(sign.value) : 0);
          const end = start.map((p, i) => p + direction[i] * distance);
          const tool = geometry.cylinder(solid, start, direction, r, distance);
          const hits = others.filter(part => check.interference(tool, part.mesh));
          const bounds = parts.flatMap(part => [part.bounds.min, part.bounds.max]).concat([tool.bounds.min, tool.bounds.max]);
          const {view, project} = plan('Доступ инструмента на проекции сверху. Мешающие габариты красные', bounds);
          for (const part of parts) {
            const {min, max} = part.bounds;
            polygon(view, rect(min[0], -max[1], max[0] - min[0], max[1] - min[1]),
              hits.includes(part) ? '#f6acb4' : part === selected ? colors.pale : '#dbe3eb',
              hits.includes(part) ? colors.red : colors.ink);
          }
          line(view, project(start), project(end), colors.orange);
          dot(view, project(start), r, 'none', colors.orange);
          dot(view, project(end), r, 'none', colors.orange);
          output.replaceChildren(view);
          result.textContent = hits.length ? 'Мешают детали: ' + hits.map(part => part.name).join(', ') + '.' :
            'В указанном коридоре доступа соседние детали не обнаружены.';
          ui.status('');
        }));
        details.append(ui.el('p', 'Укажите точку у винта, направление и габариты инструмента. Схема сверху показывает габариты тел, пересечения считаются по сетке в 3D.'));
      }
    };
    section.append(details, output, result);
    checks.addEventListener('change', showMode);
    moving.addEventListener('change', showMode);
    showMode();
  }

  function mass(section, ui) {
    const parts = needParts(ui);
    const fields = ui.el('div', null, 'lab-workbench-grid');
    const result = ui.el('p'), details = ui.el('ul'), chart = ui.el('div');
    const densities = parts.map(part => {
      const group = ui.el('section', null, 'lab-workbench-card');
      group.append(ui.el('strong', part.name));
      const selection = select(ui, group, 'Материал', [
        ['1.24','ПЛА'], ['2.7','Алюминий'], ['7.85','Сталь'], ['8.96','Медь'], ['custom','Своя плотность']
      ]);
      const density = field(ui, group, 'Плотность, г/см³', {min:.01, max:30, value:1.24});
      density.readOnly = true;
      selection.addEventListener('change', () => {
        density.readOnly = selection.value !== 'custom';
        if (density.readOnly) density.value = selection.value;
      });
      fields.append(group);
      return density;
    });
    const row = controls(ui, section);
    row.append(ui.button('Рассчитать массу и устойчивость', () => {
      const spec = parts.map((part, i) => ({mesh:part.mesh, density:value(densities[i])}));
      const properties = geometry.massProperties(spec);
      const stable = geometry.stability(spec, properties.center);
      result.textContent = 'Масса ' + number(properties.mass) + ' г. Координаты центра масс X, Y, Z ' +
        properties.center.map(number).join(' / ') + ' мм.';
      details.replaceChildren(...properties.components.map((shape, i) => ui.el('li', parts[i].name +
        ' · ' + number(shape.mass) + ' г · ' + number(shape.volume) + ' мм³')));
      if (stable.margin === null) {
        chart.replaceChildren(ui.el('p', 'Вершины опоры лежат на одной линии или сходятся в точке.'));
        return;
      }
      const {view, project, scale} = plan('Граница опоры и проекция центра масс сверху', [...stable.hull, properties.center]);
      polygon(view, stable.hull.map(project));
      dot(view, project(properties.center), scale * .018, stable.margin >= 0 ? colors.orange : colors.red);
      const text = stable.margin > 0 ? 'До границы опоры ' + number(stable.margin) +
        ' мм. Опрокидывание при наклоне на ' + number(stable.tilt) + '° к ближайшей границе.' :
        stable.margin === 0 ? 'Проекция центра масс на границе опоры.' : 'Проекция центра масс вышла за границу опоры.';
      chart.replaceChildren(view, ui.el('p', text),
        ui.el('p', 'Расчёт для жёстко скреплённой сборки на плоской опоре без скольжения. Координаты опоры взяты из нижнего слоя модели.'));
    }));
    section.append(fields, result, details, chart);
  }

  function puzzle(section, ui, scope) {
    const game = geometry.puzzle;
    const buttons = controls(ui, section), queueRow = controls(ui, section);
    const queueOutput = ui.el('p'), screen = ui.el('div'), result = ui.el('p');
    const queue = [];
    let version = 0;
    const actions = [['→', [.5,0,0]], ['←', [-.5,0,0]], ['↑', [0,-.5,0]], ['↓', [0,.5,0]],
      ['↻', [0,0,90]], ['↺', [0,0,-90]]];
    const names = ['Вправо', 'Влево', 'Вверх', 'Вниз', 'Повернуть по часовой', 'Повернуть против часовой'];
    for (let i = 0; i < actions.length; i++) {
      const button = ui.button(actions[i][0], () => {
        if (queue.length >= 80) throw new Error('Последовательность ограничена 80 шагами.');
        queue.push(i);
        refreshQueue();
      });
      button.setAttribute('aria-label', names[i]);
      buttons.append(button);
    }
    const show = (pose, hit = -1) => {
      const view = figure('План головоломки. Входы в перегородках ведут к выходу справа', [-1, -1, 16, 12]);
      game.walls.forEach(({x,y,w,h}, i) => polygon(view, rect(x,y,w,h), hit === i ? '#f6b0ba' : '#cbd2dc',
        hit === i ? colors.red : colors.ink));
      line(view, [13, 4.6], [13, 7], colors.blue, true);
      for (const poly of geometry.puzzlePolygons(pose)) polygon(view, poly, '#eed093', colors.orange);
      screen.replaceChildren(view);
    };
    const refreshQueue = () => {
      version++;
      queueOutput.textContent = queue.length ? queue.map(i => actions[i][0]).join(' ') : 'Последовательность пуста.';
      result.textContent = '';
      show(game.initial);
    };
    queueRow.append(ui.button('Убрать последний шаг', () => {
      queue.pop();
      refreshQueue();
    }), ui.button('Очистить', () => {
      queue.length = 0;
      refreshQueue();
    }), ui.button('Выполнить', async () => {
      if (!queue.length) throw new Error('Добавьте хотя бы один шаг.');
      const run = ++version, delay = global.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 105;
      let pose = game.initial;
      for (let i = 0; i < queue.length; i++) {
        if (!scope.active() || version !== run) return;
        const step = geometry.puzzleMove(pose, actions[queue[i]][1]);
        pose = step.pose;
        show(pose, step.hit);
        if (step.hit >= 0 || step.escaped) {
          result.textContent = step.escaped ? 'Ключ прошёл через выход на шаге ' + (i + 1) + '.' :
            'На шаге ' + (i + 1) + ' ключ задевает выделенную перегородку.';
          return;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      if (scope.active() && run === version) result.textContent = 'Последовательность выполнена. Продолжите путь к выходу справа.';
    }));
    section.prepend(ui.el('p', 'Выведите Т-образный ключ через два проёма. Стрелки добавляют смещение на полделения. Круговые стрелки добавляют поворот на 90°.'));
    section.append(queueOutput, screen, result);
    refreshQueue();
  }

  global.LabExtensions.register({
    id:'mechanisms',
    title:'Механизмы',
    mount(body, ui) {
      const row = controls(ui, body);
      const tracks = [
        ['transmission', 'Зубчатые передачи', transmission],
        ['motion', 'Кинематика и траектории', movement],
        ['checks', 'Столкновения и доступ инструмента', assemblyChecks],
        ['puzzle', 'Сборочная головоломка', puzzle],
        ['mass', 'Масса и устойчивость', mass]
      ];
      const topic = select(ui, row, 'Раздел', tracks);
      const section = ui.el('section', null, 'lab-workbench-card');
      body.append(section);
      let generation = 0, scope;
      function stop() {
        generation++;
        scope?.cleanup?.();
      }
      ui.onCleanup(stop);
      function update() {
        stop();
        ui.status('');
        section.replaceChildren();
        const marker = generation;
        scope = {active: () => ui.isActive() && generation === marker};
        const track = tracks.find(([id]) => id === topic.value);
        try { track[2](section, ui, scope); }
        catch (error) { ui.status(error.message); }
      }
      topic.addEventListener('change', update);
      update();
    }
  });
})(window);
