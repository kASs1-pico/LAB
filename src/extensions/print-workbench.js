/* Calibration solids, bed layouts and local print records. All dimensions are in mm. */
(function (global) {
  'use strict';

  const round = value => Number(value.toFixed(4));
  const fmt = value => round(value).toLocaleString('ru-RU', { maximumFractionDigits: 4 });
  const plate = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const shape = (id, path) => ({
    id, type: 'path', layer: 'main', color: '#263c46', width: 2,
    points: [...path, path[0]].map(([x, y]) => ({ x: 4 * (x + 20), y: 4 * (y + 20) }))
  });
  const sketch = (strokes, modelHeight) =>
    ({ version: 1, orientation: 'landscape', strokes, modelHeight });
  const bridgeWall = 4, bridgeRise = 12;

  function parseValues(raw, options) {
    const { min, max, count = 8 } = options;
    const source = raw.trim();
    if (!source || !/^[\d.,;\s+\-]+$/.test(source)) throw Error('Разделите размеры пробелами или точкой с запятой.');
    const values = source.split(/[\s;]+/).map(part => Number(part.replace(',', '.')));
    if (values.length < 2 || values.length > count || values.some(value => !Number.isFinite(value) || value < min || value > max)) {
      throw Error(`Задайте от 2 до ${count} размеров в пределах ${fmt(min)}–${fmt(max)} мм.`);
    }
    return values;
  }

  function calibration(kind, values) {
    const min = kind === 'bridge' ? 4 : .1, max = kind === 'bridge' ? 70 : kind === 'clearance' ? 5 : 8;
    if (!Array.isArray(values) || values.length < 2 || values.length > 8 ||
        values.some(value => !Number.isFinite(value) || value < min || value > max)) {
      throw Error('Размеры выходят за пределы генератора.');
    }
    const labels = [], paths = [];
    if (kind === 'clearance' || kind === 'wall') {
      const widths = kind === 'clearance' ? Array(values.length + 1).fill(16) : values;
      const gaps = kind === 'wall' ? Array(values.length - 1).fill(14) : values;
      let length = 9;
      const path = [[0, 0], [0, 5]];
      widths.forEach((tooth, index) => {
        const left = length, right = left + tooth;
        path.push([left, 5], [left, 18], [right, 18], [right, 5]);
        if (kind === 'wall') labels.push({ x: (left + right) / 2, y: -1.5, value: tooth });
        if (gaps[index] !== undefined) {
          if (kind === 'clearance') labels.push({ x: right + gaps[index] / 2, y: -1.5, value: gaps[index] });
          length = right + gaps[index];
        } else {
          length = right + 9;
        }
      });
      path.push([length, 5], [length, 0]);
      paths.push(path);
    } else if (kind === 'bridge') {
      let x = 0, y = 0;
      values.forEach(span => {
        const w = bridgeWall, h = bridgeRise;
        if (x + span + 2 * w > 200) { x = 0; y += 20; }
        const end = x + span + 2 * w;
        paths.push([[x, y], [x + w, y], [x + w, y + h], [end - w, y + h],
          [end - w, y], [end, y], [end, y + h + 2], [x, y + h + 2]]);
        labels.push({ x: x + w + span / 2, y: y + h - 4, value: span });
        x = end + 4;
      });
    } else {
      throw Error('Неизвестный образец.');
    }
    const height = kind === 'bridge' ? 8 : 4;
    const strokes = paths.map((path, i) => shape('calibration-' + i, path));
    const labelRings = kind === 'bridge' ? [] : labels.flatMap(({ x, value }, index) => {
      let cursor = x;
      const text = String(round(value)).replace('.', ',');
      const scale = .025;
      const glyphs = [...text].map(char => global.LabEngravingGlyphs[char]);
      cursor -= glyphs.reduce((sum, glyph) => sum + glyph[0] * scale, 0) / 2;
      return glyphs.flatMap(([advance, rings], character) => {
        // A small stagger keeps the bottoms of separate glyphs off a common earcut bridge.
        const weight = 8 * index + character + 1;
        const baseline = 3.25 + .000037 * weight ** 2;
        const glyph = rings.map(ring => ring.map(([a, b]) => [cursor + a * scale, baseline - b * scale]));
        cursor += advance * scale;
        return glyph;
      });
    });
    const annotations = labelRings.map((ring, i) => ({ ...shape('label-' + i, ring), construction: true }));
    return { paths, labels, labelRings, project: sketch([...strokes, ...annotations], height), kind };
  }

  const signedArea = points => points.reduce((sum, p, index) => {
    const q = points[(index + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);

  function inside([x, y], ring) {
    let value = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [a, b] = ring[i], [c, d] = ring[j];
      if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) value = !value;
    }
    return value;
  }

  function engraveCalibration(mesh, result) {
    const solid = global.LabSolid, output = solid.createMeshBuilder();
    const top = result.project.modelHeight, bottom = top - .35;
    const world = points => points.map(([x, y]) => [x + 20, -y - 20]);
    const outer = world(result.paths[0]);
    const glyphs = result.labelRings.map(world).map(ring => ({ ring, area: Math.abs(signedArea(ring)), children: [] }))
      .sort((a, b) => a.area - b.area);
    const roots = [];
    glyphs.forEach((node, index) => {
      const parent = glyphs.slice(index + 1).find(candidate => inside(node.ring[0], candidate.ring));
      (parent ? parent.children : roots).push(node);
    });
    function cap(ring, holes, z) {
      const all = [ring, ...holes], starts = [], coords = [];
      for (const points of all) {
        if (coords.length) starts.push(coords.length / 2);
        for (const point of points) coords.push(...point);
      }
      const triangles = global.earcut(coords, starts, 2);
      for (let index = 0; index < triangles.length; index += 3) {
        const points = triangles.slice(index, index + 3).map(i => [coords[2 * i], coords[2 * i + 1], z]);
        if (signedArea(points) < 0) [points[1], points[2]] = [points[2], points[1]];
        output.triangle(...points);
      }
    }
    function excavate(node, recess) {
      const ring = node.ring, upper = recess ? bottom : top;
      cap(ring, node.children.map(child => child.ring), upper);
      const counterclockwise = signedArea(ring) > 0;
      const oriented = counterclockwise === recess ? ring.slice().reverse() : ring;
      for (let index = 0; index < oriented.length; index++) {
        const a = oriented[index], b = oriented[(index + 1) % oriented.length];
        output.quad([...a, bottom], [...b, bottom], [...b, top], [...a, top]);
      }
      node.children.forEach(child => excavate(child, !recess));
    }
    for (let index = 0; index < mesh.positions.length; index += 9) {
      const triangle = [0, 3, 6].map(i => Array.from(mesh.positions.subarray(index + i, index + i + 3)));
      if (!triangle.every(point => point[2] === top)) output.triangle(...triangle);
    }
    cap(outer, roots.map(node => node.ring), top);
    roots.forEach(node => excavate(node, true));
    const engraved = output.finish();
    if (!engraved.stats.closed || engraved.stats.volumeMm3 >= mesh.stats.volumeMm3) {
      throw Error('Гравировка дала незамкнутый контур. Измените значения образца.');
    }
    return engraved;
  }

  function calibrationMesh(result) {
    const { LabSolid: solid, LabExtrusion: extrusion } = global;
    const project = result.project;
    const strokes = project.strokes.filter(stroke => !stroke.construction);
    const analysis = extrusion.analyze(strokes, { tolerance: 8 });
    if (!analysis.ok) throw Error(analysis.errors[0]?.message || 'Контур образца повреждён.');
    const mesh = solid.build(analysis, { height: project.modelHeight, strokes });
    if (result.kind !== 'bridge') return engraveCalibration(mesh, result);
    // Turn each side-view profile upright and restore the row arrangement on the bed.
    const bodies = mesh.bodies.map((body, index) => {
      const offset = result.paths[index][0][1];
      const transformed = solid.transformMesh(body.mesh, ([x, y, z]) => [x - 20, z + offset, -y - 20 - offset]);
      return { ...body, mesh: transformed, bounds: transformed.bounds };
    });
    return solid.combine(bodies);
  }

  function compensation(model, measured) {
    if (![model, measured].every(value => Array.isArray(value) && value.length === 3 &&
      value.every(n => Number.isFinite(n) && n > 0))) throw Error('Укажите по три положительных размера.');
    return model.map((value, index) => {
      const scale = value / measured[index];
      return { scale, percentage: scale * 100, inputDelta: value - measured[index] };
    });
  }

  function pack(size, bed, gap, limit = 30) {
    if (![size, bed].every(a => Array.isArray(a) && a.length === 3 && a.every(n => Number.isFinite(n) && n > 0)) ||
        !Number.isFinite(gap) || gap < .1 || !Number.isInteger(limit) || limit < 1 || limit > 500) throw Error('Проверьте размеры стола, зазор и число деталей.');
    const result = { count: 0, capacity: 0, placements: [], bed: bed.slice() };
    if (size[2] > bed[2] + 1e-7) return result;
    for (const rotated of [false, true]) {
      const [w, h] = rotated ? [size[1], size[0]] : size;
      const nx = Math.floor((bed[0] + gap + 1e-7) / (w + gap));
      const ny = Math.floor((bed[1] + gap + 1e-7) / (h + gap));
      const capacity = nx * ny;
      if (capacity <= result.capacity) continue;
      const count = Math.min(capacity, limit);
      const placements = Array.from({ length: count }, (_, index) => ({
        x: (index % nx) * (w + gap), y: Math.floor(index / nx) * (h + gap), w, h, rotated
      }));
      Object.assign(result, { count, capacity, placements });
    }
    return result;
  }

  function placedModel(mesh, placements) {
    const { LabSolid: solid } = global;
    const [minX, minY, minZ] = mesh.bounds.min, maxY = mesh.bounds.max[1];
    const bodies = placements.map(({ x, y, rotated }, index) => {
      const placed = solid.transformMesh(mesh, ([a, b, c]) => [
        x + (rotated ? maxY - b : a - minX),
        y + (rotated ? a - minX : b - minY),
        c - minZ
      ]);
      return { name: 'Экземпляр ' + (index + 1), mesh: placed, bounds: placed.bounds };
    });
    return solid.combine(bodies);
  }

  function socket(axis, center, from, to, width) {
    const side = [0, 1, 2].filter(index => index !== axis);
    const face = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
      const point = center.slice();
      point[axis] = from;
      point[side[0]] += a * width / 2;
      point[side[1]] += b * width / 2;
      return point;
    });
    const normal = [0, 0, 0]; normal[axis] = 1;
    return global.LabSolid.extrudeFace(face, normal, to - from);
  }

  function splitWithPin(mesh, { axis, fraction, width, depth, fit, shift }) {
    const solid = global.LabSolid;
    if (!mesh?.stats.closed) throw Error('Для разрезания нужна замкнутая сетка.');
    if (![0, 1, 2].includes(axis) || !Number.isFinite(fraction) || fraction < .05 || fraction > .95 ||
        !Number.isFinite(width) || width < 1 || width > 30 || !Number.isFinite(depth) || depth < 1 || depth > 30 ||
        !Number.isFinite(fit) || fit < .05 || fit > 1 || !Array.isArray(shift) || shift.length !== 2 || !shift.every(Number.isFinite)) {
      throw Error('Проверьте положение разреза и размеры штифта.');
    }
    const bounds = mesh.bounds;
    const coordinate = bounds.min[axis] + (bounds.max[axis] - bounds.min[axis]) * fraction;
    const center = bounds.min.map((value, index) => (value + bounds.max[index]) / 2);
    const sides = [0, 1, 2].filter(index => index !== axis);
    center[sides[0]] += shift[0]; center[sides[1]] += shift[1];
    const halves = solid.splitBody(mesh, axis, fraction);
    const openings = [
      socket(axis, center, coordinate - depth, coordinate + .02, width + fit * 2),
      socket(axis, center, coordinate - .02, coordinate + depth, width + fit * 2)
    ];
    const expected = (width + fit * 2) ** 2 * depth;
    const cut = halves.map((half, index) => {
      const part = solid.boolean(half, openings[index], 'subtract');
      const removed = half.stats.volumeMm3 - part.stats.volumeMm3;
      if (!part.stats.closed || part.stats.components !== 1 || Math.abs(removed - expected) > Math.max(.04, expected * .01)) {
        throw Error('Гнездо выходит за стенку или пересекает полость. Сдвиньте штифт или уменьшите его.');
      }
      return part;
    });
    return { parts: cut, pin: socket(axis, center, coordinate - depth + fit, coordinate + depth - fit, width) };
  }

  function filamentMass(source, diameter, density) {
    const number = '([0-9]+(?:[.,][0-9]+)?)';
    const grams = source.match(new RegExp('^\\s*(?:[;#]\\s*)?(?:total\\s+)?(?:filament (?:used|weight)\\s*\\[g\\]|filament weight\\s*\\(g\\)|total filament used)\\s*[:=]\\s*' + number + '\\s*g?\\s*$', 'im'));
    if (grams) return Number(grams[1].replace(',', '.'));
    const weight = source.match(new RegExp('^\\s*(?:[;#]\\s*)?(?:filament used|filament weight|mass)\\s*[:=]\\s*' + number + '\\s*g\\s*$', 'im'));
    if (weight) return Number(weight[1].replace(',', '.'));
    const length = source.match(new RegExp('^\\s*(?:[;#]\\s*)?(?:total\\s+)?filament used\\s*(?:\\[(mm|m)\\])?\\s*[:=]\\s*' + number + '\\s*(mm|m)?\\s*$', 'im'));
    if (!length || (!length[1] && !length[3])) throw Error('Расход не найден. Поддерживаются строки Filament used: 12.3 g или 4.2 m и filament used [mm] = 4200.');
    if (!Number.isFinite(diameter) || diameter <= 0 || !Number.isFinite(density) || density <= 0) throw Error('Для пересчёта длины укажите диаметр и плотность нити.');
    const metres = Number(length[2].replace(',', '.')) / ((length[1] || length[3]) === 'mm' ? 1000 : 1);
    return metres * Math.PI * diameter ** 2 / 4 * density;
  }

  function productionCost(mass, rate, quantity) {
    if (![mass, rate].every(value => Number.isFinite(value) && value >= 0) || !Number.isInteger(quantity) || quantity <= 0) {
      throw Error('Укажите массу, цену и положительное целое количество.');
    }
    const perPart = mass / 1000 * rate;
    return { perPart, total: perPart * quantity };
  }

  function sectionWidths(rings, axis) {
    const coords = rings.flatMap(ring => ring.map(point => point[axis]));
    const min = Math.min(...coords), max = Math.max(...coords), widths = [];
    for (let step = 2; step < 19; step++) {
      const scan = min + (max - min) * step / 20;
      const stops = [];
      for (const ring of rings) {
        ring.forEach((a, index) => {
          const b = ring[(index + 1) % ring.length];
          if ((a[axis] > scan) === (b[axis] > scan)) return;
          const t = (scan - a[axis]) / (b[axis] - a[axis]);
          stops.push(a[1 - axis] + t * (b[1 - axis] - a[1 - axis]));
        });
      }
      stops.sort((a, b) => a - b);
      for (let index = 0; index + 1 < stops.length; index += 2) {
        if (stops[index + 1] > stops[index] + .00001) widths.push(stops[index + 1] - stops[index]);
      }
    }
    return widths;
  }

  function textWarnings(text, size, line, glyphs = global.LabEngravingGlyphs) {
    if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(line) || line <= 0) throw Error('Задайте положительную высоту символов и ширину линии.');
    let x = 0;
    return [...text].map(character => {
      const glyph = glyphs?.[character];
      if (!glyph) throw Error(`Символ «${character}» не поддерживает гравировку.`);
      const [advance, rings] = glyph;
      const widths = [...sectionWidths(rings, 0), ...sectionWidths(rings, 1)].sort((a, b) => a - b);
      // Ignore taper slivers by using the tenth percentile of sampled runs.
      const width = widths.length ? widths[Math.floor(widths.length * .10)] * size / 100 : null;
      const paths = rings.map(ring => ring.map(([px, py]) => [x + px * size / 100, -py * size / 100]));
      x += advance * size / 100;
      return { character, width, warning: width !== null && width < line, paths };
    });
  }

  function graphic(width, height, contents, label, minX = 0, minY = 0) {
    return `<svg viewBox="${minX} ${minY} ${width} ${height}" width="100%" role="img" aria-label="${label}">${contents}</svg>`;
  }
  const poly = points => points.map(point => point.join(',')).join(' ');
  const previewCalibration = ({ paths, labels }) => {
    const end = Math.max(...paths.flatMap(path => path.map(point => point[0])));
    const high = Math.max(...paths.flatMap(path => path.map(point => point[1])));
    return graphic(end + 4, high + 8, paths.map(path =>
      `<polygon points="${poly(path.map(([x, y]) => [x, -y]))}" fill="#d0e6f3" stroke="#375772" stroke-width=".16"/>`).join('') +
      labels.map(({ x, y, value }) => `<text x="${x}" y="${-y + 2}" text-anchor="middle" fill="#173e54" font-size="2" font-family="system-ui">${fmt(value)}</text>`).join(''), 'Профиль образца с размерами', -2, -high - 2);
  };
  const previewPack = ({ placements, bed }) => graphic(bed[0], bed[1], [
    `<rect width="${bed[0]}" height="${bed[1]}" fill="#edf4fa"/>`,
    ...placements.map(({ x, y, w, h }) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#cfe6f3" stroke="#2c7280" stroke-width=".5"/>`)
  ].join(''), 'Раскладка на столе');

  const recordsKey = 'drawing-lab-print-records-v1';
  let cachedRecords;

  function records() {
    if (!cachedRecords) {
      try {
        const stored = JSON.parse(global.localStorage.getItem(recordsKey));
        cachedRecords = Array.isArray(stored) ? stored.slice(0, 40).filter(item =>
          item && typeof item.name === 'string' && typeof item.material === 'string' && typeof item.date === 'string') : [];
      } catch {
        cachedRecords = [];
      }
    }
    return cachedRecords;
  }

  function updateRecords(next) {
    cachedRecords = next.slice(0, 40);
    try { global.localStorage.setItem(recordsKey, JSON.stringify(cachedRecords)); return true; }
    catch { return false; }
  }

  async function previewPhoto(file) {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
      throw Error('Выберите фотографию JPEG, PNG или WebP до 15 МБ.');
    }
    const image = await global.createImageBitmap(file);
    try {
      const ratio = Math.min(1, 640 / Math.max(image.width, image.height));
      const canvas = global.document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));
      const context = canvas.getContext('2d');
      if (!context) throw Error('Браузер не открыл редактор изображений.');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return { data: canvas.toDataURL('image/jpeg', .65), width: canvas.width, height: canvas.height };
    } finally {
      image.close();
    }
  }

  function photoSource(photo) {
    return typeof photo?.data === 'string' && /^data:image\/jpeg;base64,[\w+/]+=*$/i.test(photo.data) &&
      photo.data.length < 450000 && Number.isFinite(photo.width) && Number.isFinite(photo.height) &&
      photo.width > 0 && photo.width <= 640 && photo.height > 0 && photo.height <= 640;
  }

  function mount(body, ui) {
    const { el, button, status, app, close, download, onCleanup } = ui;
    const tabs = [
      ['clearance', 'Гребёнка зазоров'], ['wall', 'Образец стенок'], ['shrink', 'Поправка на усадку'], ['bridge', 'Образец мостов'],
      ['split', 'Разделить со штифтом'], ['pack', 'Раскладка партии'], ['text', 'Тонкие надписи'], ['cost', 'Стоимость печати'],
      ['photo', 'Фото и модель'], ['journal', 'Журнал печати']
    ];
    const select = el('select'), page = el('section', '', 'lab-workbench-card');
    let generation = 0;
    let comparison;

    const makeSelect = options => {
      const control = el('select');
      for (const [value, text] of options) {
        const option = el('option', text); option.value = value; control.append(option);
      }
      return control;
    };
    const labelled = (label, input) => {
      const node = el('label');
      node.append(el('span', label), input);
      return node;
    };
    function field(label, value, { type = 'number', min, max, step } = {}) {
      const input = el('input'); input.type = type; input.value = value;
      if (type === 'number') {
        if (min !== undefined) input.min = min;
        if (max !== undefined) input.max = max;
        input.step = step ?? 'any';
      }
      page.append(labelled(label, input));
      return input;
    }
    const read = input => {
      if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) throw Error('Проверьте числовые значения в полях.');
      return input.valueAsNumber;
    };
    const add = (label, fn, container = page) => {
      const control = button(label, async () => {
        try { await fn(); } catch (error) { status(error.message || 'Не удалось выполнить действие.'); }
      });
      container.append(control);
      return control;
    };
    const say = text => page.append(el('p', text));
    const resultArea = () => {
      const node = el('div', '', 'lab-workbench-preview');
      page.append(node);
      return node;
    };
    const actions = () => {
      const node = el('div', '', 'lab-workbench-actions');
      page.append(node);
      return node;
    };
    const selectMesh = () => {
      const mesh = app.getProjectionMesh?.();
      if (!mesh?.positions?.length) throw Error('Постройте замкнутую 3D-модель и вернитесь к инструменту.');
      return mesh;
    };
    const stl = (mesh, filename) => download(global.LabModelExport.stl(mesh), filename, 'model/stl');
    const threeMF = (mesh, filename) => download(global.LabModelExport.threeMF(mesh), filename, 'model/3mf');
    const json = (value, filename) => download(JSON.stringify(value, null, 2), filename, 'application/json');
    const sessionJournal = () => status('Запись сохранена на этом компьютере.');

    function buildSample(kind) {
      const initial = { clearance: '0,15 0,2 0,3 0,4 0,5 0,7', wall: '0,2 0,3 0,4 0,6 0,8 1,2', bridge: '6 10 16 25 35' };
      say(kind === 'clearance' ? 'Щели в гребёнке меняются от зубца к зубцу. STL и 3MF включают гравировку значений на основании.' :
        kind === 'wall' ? 'Ширина каждого ребра различается. Сравните итог с шириной линии в слайсере.' :
          'Каждый мост имеет две опоры и открытый пролёт. STL и 3MF ставят мосты на опоры.');
      const sizes = field('Размеры в мм через пробел', initial[kind], { type: 'text' });
      const panel = resultArea(), row = actions();
      const get = () => calibration(kind, parseValues(sizes.value, {
        min: kind === 'bridge' ? 4 : .1, max: kind === 'bridge' ? 70 : kind === 'clearance' ? 5 : 8
      }));
      const preview = () => { panel.innerHTML = previewCalibration(get()); status(''); };
      sizes.addEventListener('change', () => {
        try { preview(); } catch (error) { panel.replaceChildren(); status(error.message); }
      });
      add('Обновить образец', preview, row);
      add('Скачать STL', () => stl(calibrationMesh(get()), kind + '-sample.stl'), row);
      add('Скачать 3MF', () => threeMF(calibrationMesh(get()), kind + '-sample.3mf'), row);
      add('Скачать проект CAD', () => json(get().project, kind + '-sample.json'), row);
      add('Открыть на холсте', () => {
        const specimen = get();
        calibrationMesh(specimen);
        if (app.loadProject(specimen.project, { keepUndo: true })) {
          close(); app.setModelOpen(true);
        }
      }, row);
      preview();
    }

    function shrink() {
      say('Введите размер образца в проекте и фактический размер после печати. Полученный процент задаёт масштаб каждой оси.');
      const size = ['X', 'Y', 'Z'].map(axis => field(`По модели ${axis}, мм`, 20, { min: .01 }));
      const measured = ['X', 'Y', 'Z'].map(axis => field(`После печати ${axis}, мм`, 19.8, { min: .01 }));
      const output = resultArea(), row = actions();
      const values = () => compensation(size.map(read), measured.map(read));
      add('Рассчитать проценты', () => {
        output.replaceChildren(...values().map(({ percentage, inputDelta }, index) => el('p',
          `${'XYZ'[index]}: ${fmt(percentage)} % · отклонение ${fmt(inputDelta)} мм`)));
      }, row);
      add('Скачать STL текущей модели с поправкой', () => {
        const mesh = selectMesh(), factors = values();
        const origin = mesh.bounds.min;
        const scaled = global.LabSolid.transformMesh(mesh, point => point.map((value, axis) =>
          origin[axis] + (value - origin[axis]) * factors[axis].scale));
        stl(scaled, 'compensated.stl');
      }, row);
    }

    function split() {
      say('Разделите одиночную деталь на две части. В обеих появятся квадратные гнёзда для одного отдельного совмещающего штифта.');
      const axis = makeSelect([[0, 'X'], [1, 'Y'], [2, 'Z']]); page.append(labelled('Ось разреза', axis));
      const position = field('Положение разреза, %', 50, { min: 5, max: 95 });
      const width = field('Ширина штифта, мм', 4, { min: 1, max: 30 });
      const depth = field('Глубина каждого гнезда, мм', 4, { min: 1, max: 30 });
      const fit = field('Зазор на сторону, мм', .2, { min: .05, max: 1 });
      const shift = [field('Сдвиг вдоль первой оси плоскости, мм', 0), field('Сдвиг вдоль второй оси плоскости, мм', 0)];
      const output = resultArea();
      add('Построить части', () => {
        output.replaceChildren();
        const mesh = selectMesh();
        if (mesh.bodies?.length > 1) throw Error('Оставьте на печать одно тело. Сборку можно разделять по одному телу за раз.');
        const coordinateAxis = Number(axis.value);
        const result = splitWithPin(mesh, { axis: coordinateAxis, fraction: read(position) / 100, width: read(width),
          depth: read(depth), fit: read(fit), shift: shift.map(read) });
        output.append(el('p', 'Два гнезда и штифт построены. Детали экспортируются отдельными замкнутыми сетками.'));
        [...result.parts, result.pin].forEach((part, index) => {
          const name = ['Первая половина', 'Вторая половина', 'Штифт'][index];
          const size = part.bounds.max.map((value, i) => fmt(value - part.bounds.min[i])).join(' × ');
          add(`${name} · ${size} мм · STL`, () => stl(part, 'split-part-' + (index + 1) + '.stl'), output);
        });
      });
    }

    function arrange() {
      say('Сравниваются два прямоугольных ряда с поворотом детали на 90°. Зазор отсчитывается между габаритами.');
      const bed = [field('Ширина стола X, мм', 220, { min: 1, max: 10000 }), field('Глубина стола Y, мм', 220, { min: 1, max: 10000 }),
        field('Высота печати Z, мм', 250, { min: 1, max: 10000 })];
      const gap = field('Расстояние между изделиями, мм', 4, { min: .1 });
      const quantity = field('Число изделий для экспорта', 8, { min: 1, max: 30, step: 1 });
      const output = resultArea(), row = actions();
      const run = () => {
        const mesh = selectMesh();
        const size = mesh.bounds.max.map((value, index) => value - mesh.bounds.min[index]);
        return { mesh, layout: pack(size, bed.map(read), read(gap), read(quantity)) };
      };
      add('Разместить на столе', () => {
        const { layout } = run();
        output.innerHTML = previewPack(layout);
        output.append(el('p', `Вместимость по габаритам: ${layout.capacity}. В раскладке: ${layout.count}.`));
      }, row);
      add('Скачать раскладку 3MF', () => {
        const { mesh, layout } = run();
        if (!layout.placements.length) throw Error('Ни один экземпляр не помещается на столе.');
        if (mesh.positions.length * layout.placements.length > 3600000) {
          throw Error('Слишком много треугольников для раскладки. Уменьшите количество экземпляров.');
        }
        threeMF(placedModel(mesh, layout.placements), 'bed-layout.3mf');
      }, row);
    }

    function thinText() {
      say('Оценка по нескольким сечениям векторных букв. Цветные символы содержат штрих уже заданной ширины линии.');
      const text = field('Текст', 'ШКОЛА 1430', { type: 'text' }); text.maxLength = 32;
      const size = field('Высота букв, мм', 3, { min: .5, max: 100 });
      const line = field('Ширина линии слайсера, мм', .45, { min: .05, max: 3 });
      const saved = app.getState().modelFeatures.filter(value => value.type === 'text' && !value.suppressed);
      if (saved.length) {
        const pick = makeSelect([['', 'Введите вручную'], ...saved.map((value, index) => [index, value.text])]);
        page.append(labelled('Надпись на текущей модели', pick));
        pick.addEventListener('change', () => {
          if (pick.value === '') return;
          const chosen = saved[Number(pick.value)]; text.value = chosen.text; size.value = chosen.size;
        });
      }
      const output = resultArea();
      add('Проверить штрихи', () => {
        if (!text.value.trim()) throw Error('Введите надпись.');
        const result = textWarnings(text.value, read(size), read(line));
        const points = result.flatMap(value => value.paths.flat());
        if (!points.length) throw Error('В надписи нет видимых штрихов.');
        const maxX = Math.max(...points.map(p => p[0])), minY = Math.min(...points.map(p => p[1]));
        const maxY = Math.max(...points.map(p => p[1]));
        const data = result.map(({ paths, warning }) => {
          const d = paths.map(path => 'M' + path.map(point => point.join(',')).join(' L') + 'Z').join('');
          return `<path d="${d}" fill="${warning ? '#c14d2f' : '#305673'}" fill-rule="evenodd"/>`;
        }).join('');
        output.innerHTML = graphic(maxX + 2, maxY - minY + 2, data, 'Предпросмотр толщины надписи', -1, minY - 1);
        const flagged = result.filter(value => value.warning);
        output.append(el('p', flagged.length ? flagged.map(value => `«${value.character}» ≈ ${fmt(value.width)} мм`).join(' · ') : 'Тонкие штрихи в выборочных сечениях не обнаружены.'));
      });
    }

    function cost() {
      say('Загрузите текстовый отчёт слайсера или G-code с комментарием о расходе. Массу можно ввести вручную.');
      const file = field('Отчёт слайсера', '', { type: 'file' }); file.accept = '.txt,.gcode,.gco,.csv,text/plain';
      const density = field('Плотность нити, г/см³', 1.24, { min: .01 });
      const diameter = field('Диаметр нити, мм', 1.75, { min: .1 });
      const mass = field('Материал на одну деталь, г', 15, { min: 0 });
      const rate = field('Цена материала за кг, ₽', 1250, { min: 0 });
      const quantity = field('Размер партии', 10, { min: 1, step: 1 });
      const panel = resultArea();
      add('Взять расход из отчёта', async () => {
        const chosen = file.files?.[0];
        if (!chosen || chosen.size > 32 * 1024 * 1024) throw Error('Выберите текстовый файл до 32 МБ.');
        const text = await chosen.text();
        mass.value = round(filamentMass(text, read(diameter), read(density)));
        status('Расход прочитан.');
      });
      add('Рассчитать стоимость', () => {
        const { perPart, total } = productionCost(read(mass), read(rate), read(quantity));
        panel.textContent = `Один экземпляр ${fmt(perPart)} ₽ · партия ${fmt(total)} ₽.`;
      });
    }

    function projection(mesh, direction) {
      const view = global.LabDrawingGeometry.orthographic(mesh, direction);
      const span = [view.bounds[2] - view.bounds[0], view.bounds[3] - view.bounds[1]];
      const scale = 208 / Math.max(1e-6, ...span);
      const x = p => 120 + (p[0] - view.bounds[0] - span[0] / 2) * scale;
      const y = p => 120 - (p[1] - view.bounds[1] - span[1] / 2) * scale;
      const lines = view.visible.map(([a, b]) => `M${round(x(a))},${round(y(a))}L${round(x(b))},${round(y(b))}`).join('');
      return { lines, view, x, y, span };
    }

    function photo() {
      say('Загрузите фото напечатанной детали, отметьте дефект на фото и укажите то же место на проекции модели.');
      const local = generation;
      const file = field('Фотография', '', { type: 'file' }); file.accept = 'image/jpeg,image/png,image/webp';
      const direction = makeSelect([['top', 'Сверху'], ['front', 'Спереди'], ['side', 'Сбоку']]);
      page.append(labelled('Проекция модели', direction));
      const layout = el('div', '', 'lab-workbench-grid');
      const image = el('div', '', 'lab-workbench-preview'), model = el('div', '', 'lab-workbench-preview');
      const description = field('Описание дефекта', '', { type: 'text' }); description.maxLength = 180;
      const marks = el('ol');
      const state = comparison || { photo: null, marks: [] };
      comparison = state;
      const active = { photo: null, model: null };
      if (state.direction) direction.value = state.direction;
      let projected;
      function display() {
        image.replaceChildren();
        model.replaceChildren();
        marks.replaceChildren();
        if (state.photo && photoSource(state.photo)) {
          const { data, width, height } = state.photo;
          const notes = state.marks.map(({ photo: p }, index) => markSvg(p.map((n, i) => n * [width, height][i]), index + 1,
            4 + Math.max(width, height) / 85)).join('');
          const imageGraphic = `<image width="${width}" height="${height}" href="${data}"/>`;
          image.innerHTML = graphic(width, height, imageGraphic + notes, 'Нажмите на дефект на фотографии');
        }
        if (projected) {
          const visible = state.marks.map((note, index) => note.direction === direction.value ? markSvg(note.model, index + 1, 7) : '').join('');
          model.innerHTML = graphic(240, 240, `<rect width="240" height="240" fill="#edf4fa"/><path d="${projected.lines}" fill="none" stroke="#36546c" stroke-width="1.2"/>` + visible, 'Укажите место дефекта на проекции модели');
        }
        state.marks.forEach(({ description: label, coordinates }, index) => {
          const row = el('li', `${label} · на виде ${coordinates.map(fmt).join(', ')} мм`);
          const remove = button('Убрать отметку', () => { state.marks.splice(index, 1); display(); });
          row.append(' ', remove); marks.append(row);
        });
      }

      function markSvg([x, y], label, radius) {
        return `<circle cx="${x}" cy="${y}" r="${radius}" fill="#b74734" stroke="white" stroke-width="1.5"/>
          <text x="${x}" y="${y + radius / 2.7}" text-anchor="middle" fill="white" font-family="system-ui" font-size="${radius * 1.15}">${label}</text>`;
      }
      const relative = (element, event) => {
        const rect = element.querySelector('svg')?.getBoundingClientRect();
        if (!rect?.width || !rect.height) return null;
        const values = [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
        return values.every(value => value >= 0 && value <= 1) ? values : null;
      };
      image.addEventListener('click', event => {
        if (!state.photo) return;
        const point = relative(image, event);
        if (!point) return;
        active.photo = point; status('Место на фото отмечено. Укажите его на проекции модели.');
      });
      model.addEventListener('click', event => {
        if (!active.photo || !projected) return status('Сначала отметьте дефект на фотографии.');
        const point = relative(model, event);
        if (!point) return;
        const label = description.value.trim();
        if (!label) return status('Добавьте короткое описание дефекта.');
        if (state.marks.length >= 20) return status('На одном фото можно оставить до 20 отметок.');
        active.model = point.map(value => value * 240);
        const coordinates = [
          projected.view.bounds[0] + projected.span[0] / 2 + (active.model[0] - 120) * Math.max(...projected.span) / 208,
          projected.view.bounds[1] + projected.span[1] / 2 - (active.model[1] - 120) * Math.max(...projected.span) / 208
        ];
        state.marks.push({ description: label, photo: active.photo, model: active.model, direction: direction.value, coordinates });
        active.photo = null; active.model = null; description.value = ''; display(); status('Отметка добавлена.');
      });
      direction.addEventListener('change', () => {
        state.direction = direction.value;
        if (projected) {
          projected = null;
          try { projected = projection(selectMesh(), direction.value); } catch (error) { status(error.message); }
          display();
        }
      });
      file.addEventListener('change', async () => {
        const source = file.files?.[0];
        if (!source) return;
        try {
          const chosen = await previewPhoto(source);
          if (local !== generation || file.files[0] !== source) return;
          state.photo = chosen; state.marks = []; active.photo = null; display();
        } catch (error) { if (local === generation) status(error.message); }
      });
      layout.append(image, model); page.append(layout, marks);
      add('Загрузить проекцию текущей модели', () => { projected = projection(selectMesh(), direction.value); display(); });
      add('Перенести фото и отметки в журнал', () => {
        if (!state.photo) throw Error('Сначала загрузите фотографию.');
        comparison = state; select.value = 'journal'; render();
      });
      add('Скачать карту замечаний JSON', () => {
        if (!state.photo) throw Error('Сначала загрузите фотографию.');
        json({ type: 'print-photo-review', version: 1, ...state }, 'print-photo-review.json');
      });
      display();
    }

    function journal() {
      say('Запишите материал, параметры печати и результат. Записи доступны в этом браузере.');
      const local = generation;
      const name = field('Название образца', '', { type: 'text' }); name.maxLength = 100;
      const material = field('Материал', 'PLA', { type: 'text' }); material.maxLength = 60;
      const temperature = field('Температура сопла, °C', 200, { min: 0, max: 550 });
      const layer = field('Высота слоя, мм', .2, { min: .01, max: 3 });
      const comment = field('Комментарий и результат', '', { type: 'text' }); comment.maxLength = 350;
      const file = field('Фото записи', '', { type: 'file' }); file.accept = 'image/jpeg,image/png,image/webp';
      if (comparison?.photo) say(`Добавится фото из сравнения. Отметок: ${comparison.marks.length}.`);
      const list = el('ol');
      function entries() {
        list.replaceChildren();
        records().forEach((entry, index) => {
          const node = el('li');
          node.append(el('p', `${entry.date.slice(0, 10)} · ${entry.name} · ${entry.material} · ${entry.temperature} °C · слой ${entry.layer} мм`));
          if (entry.comment) node.append(el('p', entry.comment));
          if (photoSource(entry.photo)) {
            const picture = el('img'); picture.src = entry.photo.data; picture.alt = 'Напечатанный образец ' + entry.name;
            picture.loading = 'lazy'; picture.width = Math.min(160, entry.photo.width); node.append(picture);
            if (Array.isArray(entry.marks) && entry.marks.length) {
              const notes = el('ul');
              entry.marks.forEach(mark => notes.append(el('li', String(mark.description || '').slice(0, 180))));
              node.append(notes);
            }
          }
          node.append(button('Удалить запись', () => {
            const next = records().filter((_, i) => i !== index);
            const persisted = updateRecords(next); entries();
            status(persisted ? 'Запись удалена.' : 'Запись удалена до перезагрузки страницы.');
          }));
          list.append(node);
        });
      }
      add('Добавить в журнал', async () => {
        if (!name.value.trim() || !material.value.trim()) throw Error('Укажите название образца и материал.');
        const chosen = file.files?.[0];
        const starter = { name: name.value.trim(), material: material.value.trim(), temperature: read(temperature), layer: read(layer),
          comment: comment.value.trim(), date: new Date().toISOString() };
        const photo = chosen ? await previewPhoto(chosen) : comparison?.photo || null;
        if (local !== generation) return;
        const marks = chosen ? [] : comparison?.marks || [];
        const persisted = updateRecords([{ ...starter, photo, marks }, ...records()]);
        comparison = null; name.value = ''; comment.value = ''; file.value = ''; entries();
        if (persisted) sessionJournal();
        else status('Запись доступна до перезагрузки. Скачайте журнал, чтобы сохранить данные.');
      });
      add('Скачать журнал JSON', () => json({ type: 'print-records', version: 1, records: records() }, 'print-records.json'));
      page.append(list); entries();
    }

    function render() {
      generation++;
      page.replaceChildren(); status('');
      const kind = select.value;
      if (['clearance', 'wall', 'bridge'].includes(kind)) buildSample(kind);
      if (kind === 'shrink') shrink();
      if (kind === 'split') split();
      if (kind === 'pack') arrange();
      if (kind === 'text') thinText();
      if (kind === 'cost') cost();
      if (kind === 'photo') photo();
      if (kind === 'journal') journal();
    }

    for (const [value, label] of tabs) {
      const option = el('option', label); option.value = value; select.append(option);
    }
    body.append(el('h3', 'Печать и калибровка'), labelled('Инструмент', select), page);
    select.addEventListener('change', render);
    onCleanup?.(() => { generation++; });
    render();
  }

  const api = Object.freeze({ parseValues, calibration, calibrationMesh, compensation, pack, placedModel, splitWithPin, filamentMass, productionCost, textWarnings });
  global.LabPrintWorkbench = api;
  global.LabExtensions?.register({ id: '3d-print', title: '3D-печать и калибровка', mount });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
