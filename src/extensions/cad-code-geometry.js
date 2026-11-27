/* Local geometry exercises. Programs run a bounded drawing vocabulary. */
(function (global) {
  'use strict';

  const EPS = 1e-7;
  const MAX_COORDINATE = 25000;
  const MAX_STEPS = 1200;
  const commandTable = new Map([
    ['вперёд', ['move', 1]], ['вперед', ['move', 1]], ['forward', ['move', 1]],
    ['налево', ['left', 1]], ['left', ['left', 1]],
    ['направо', ['right', 1]], ['right', ['right', 1]],
    ['точка', ['point', 2]], ['point', ['point', 2]],
    ['поднять', ['up', 0]], ['penup', ['up', 0]],
    ['опустить', ['down', 0]], ['pendown', ['down', 0]],
    ['замкнуть', ['close', 0]], ['close', ['close', 0]],
    ['повтор', ['repeat', 1]], ['repeat', ['repeat', 1]],
    ['конец', ['end', 0]], ['end', ['end', 0]]
  ]);
  const squareStart = 'поднять\nточка -20 -20\nопустить';
  const squareCycle = `${squareStart}\nповтор 4\n  вперёд 40\n  налево 90\nконец`;
  const squareExpanded = `${squareStart}\n${Array(4).fill('вперёд 40\nналево 90').join('\n')}`;
  const outerPlate = 'поднять\nточка -36 -24\nопустить\nвперёд 72\nналево 90\nвперёд 48\nналево 90\nвперёд 72\nзамкнуть\nподнять';
  // The pupil fixes only the initial X coordinate of the opening.
  const bugProgram = `${outerPlate}\nточка -20 -5\nопустить\nнаправо 180\nповтор 4\n  вперёд 10\n  налево 90\nконец`;
  const correctProgram = bugProgram.replace('точка -20 -5', 'точка 12 -5');
  const letters = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';

  function numeric(value, label, max = MAX_COORDINATE) {
    const token = String(value ?? '').trim().replace('−', '-').replace(',', '.');
    const number = Number(token);
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token) || !Number.isFinite(number) || Math.abs(number) > max) {
      throw new Error(`${label}. Укажите число от −${max} до ${max}.`);
    }
    return number;
  }

  function codeLines(input, limit = 12000) {
    if (typeof input !== 'string' || input.length > limit) throw new Error(`Допускается до ${limit} знаков.`);
    return input.split(/\r?\n/).map((value, i) => ({value:value.split('#', 1)[0].trim(), blank:!value.trim(), line:i+1}));
  }

  function parseTurtle(source) {
    const root = [], stack = [root];
    for (const {value, line} of codeLines(source)) {
      if (!value) continue;
      const [name, ...parts] = value.toLowerCase().split(/\s+/);
      if (!commandTable.has(name)) throw new Error(`Строка ${line}. Неизвестная команда «${name}».`);
      const [op, count] = commandTable.get(name);
      if (parts.length !== count) throw new Error(`Строка ${line}. Для команды «${name}» укажите ${count} арг.`);
      if (op === 'end') {
        if (stack.length < 2) throw new Error(`Строка ${line}. Сначала откройте цикл командой «повтор».`);
        stack.pop();
        continue;
      }
      const args = parts.map(part => numeric(part, `Строка ${line}`));
      const item = {op, args, line};
      stack.at(-1).push(item);
      if (op === 'repeat') {
        if (stack.length > 8 || !Number.isInteger(args[0]) || args[0] < 1 || args[0] > 100) {
          throw new Error(`Строка ${line}. Допускается до 8 вложенных циклов по 1–100 повторов.`);
        }
        item.children = [];
        stack.push(item.children);
      }
    }
    if (stack.length > 1) throw new Error('Закройте каждый цикл командой «конец».');
    return root;
  }

  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function runTurtle(source) {
    const commands = parseTurtle(source);
    const paths = [];
    let route = [], position = [0, 0], angle = 0, pen = true, steps = 0;
    function flush() {
      if (route.length > 1) paths.push(route);
      route = [];
    }
    function move(next, line) {
      if (next.some(value => !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE)) {
        throw new Error(`Строка ${line}. Черепашка вышла за пределы координат.`);
      }
      if (pen && distance(position, next) > EPS) {
        if (!route.length) route.push(position);
        route.push(next);
      }
      position = next;
    }
    function step(line) {
      if (++steps > MAX_STEPS) throw new Error(`Строка ${line}. Превышен предел в ${MAX_STEPS} шагов.`);
    }
    function execute(nodes) {
      for (const {op, args, line, children} of nodes) {
        const [a, b] = args;
        step(line);
        switch (op) {
          case 'move': {
            const radians = angle * Math.PI / 180;
            move([position[0] + a * Math.cos(radians), position[1] + a * Math.sin(radians)], line);
            break;
          }
          case 'left': angle = (angle + a) % 360; break;
          case 'right': angle = (angle - a) % 360; break;
          case 'point': move([a, b], line); break;
          case 'up': pen = false; flush(); break;
          case 'down': pen = true; break;
          case 'close':
            if (route.length < 3) throw new Error(`Строка ${line}. Для замыкания нужны три вершины.`);
            move(route[0], line);
            flush();
            break;
          case 'repeat':
            for (let i = 0; i < a; i++) { step(line); execute(children); }
            break;
        }
      }
    }
    execute(commands);
    flush();
    return {paths, position, angle, steps, lines: codeLines(source).filter(row => row.value).length};
  }

  function readCoordinates(source) {
    if (typeof source !== 'string') throw new Error('Добавьте таблицу координат.');
    const rows = codeLines(source.replace(/^\uFEFF/, ''), 40000);
    const meaningful = rows.find(row => row.value);
    if (!meaningful) throw new Error('Добавьте хотя бы две строки с координатами.');
    const separator = meaningful.value.includes(';') ? ';' : meaningful.value.includes('\t') ? '\t' :
      meaningful.value.includes(',') && !/\d,[\d]+\s+[+-]?\d/.test(meaningful.value) ? ',' : /\s+/;
    const paths = [];
    let route = [], count = 0;
    function finish() {
      if (!route.length) return;
      if (route.length < 2) throw new Error('В каждом пути нужны хотя бы две точки.');
      paths.push(route);
      route = [];
    }
    for (const row of rows) {
      if (!row.value) {
        if (row.blank) finish();
        continue;
      }
      const fields = row.value.split(separator).map(part => part.trim().replace(/^"([^"\n]*)"$/, '$1'));
      if (row === meaningful && fields.length === 2 && /^[xх]$/i.test(fields[0]) && /^[yу]$/i.test(fields[1])) continue;
      if (fields.length !== 2) throw new Error(`Строка ${row.line}. Ожидаются две координаты.`);
      if (++count > MAX_STEPS) throw new Error(`Допускается до ${MAX_STEPS} точек.`);
      route.push(fields.map(part => numeric(part, `Строка ${row.line}`)));
    }
    finish();
    if (!paths.length) throw new Error('Добавьте хотя бы две строки с координатами.');
    return paths;
  }

  function segments(paths) {
    return paths.flatMap(path => path.slice(1).map((point, index) => [path[index], point]))
      .filter(([a, b]) => distance(a, b) > EPS);
  }

  function polylineDifference(expected, submitted) {
    const a = segments(expected), b = segments(submitted);
    if (!a.length || !b.length) return {matches: false, separation: Infinity, lengthDifference: Infinity};
    const length = list => list.reduce((total, [p, q]) => total + distance(p, q), 0);
    function nearest([x, y], list) {
      let closest = Infinity;
      for (const [[ax, ay], [bx, by]] of list) {
        const dx = bx - ax, dy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
        closest = Math.min(closest, (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2);
      }
      return Math.sqrt(closest);
    }
    function deviation(source, target) {
      return source.reduce((worst, [[x, y], [u, v]]) => {
        for (const t of [0, .25, .5, .75, 1]) worst = Math.max(worst, nearest([x + (u - x) * t, y + (v - y) * t], target));
        return worst;
      }, 0);
    }
    const separation = Math.max(deviation(a, b), deviation(b, a));
    const lengthDifference = Math.abs(length(a) - length(b));
    return {matches: separation < .05 && lengthDifference < .05, separation, lengthDifference};
  }

  function transform(paths, source) {
    const operations = codeLines(source).filter(row => row.value);
    if (operations.length > 60) throw new Error('Допускается до 60 преобразований.');
    return operations.reduce((result, {value, line}) => {
      const [key, ...args] = value.toLowerCase().split(/\s+/);
      const n = i => numeric(args[i], `Строка ${line}`);
      let map;
      if (key === 'перенос' && args.length === 2) {
        const dx = n(0), dy = n(1);
        map = ([x, y]) => [x + dx, y + dy];
      } else if (key === 'поворот' && args.length === 1) {
        const a = n(0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        map = ([x, y]) => [x * c - y * s, x * s + y * c];
      } else if (key === 'отражение' && args.length === 1 && /^[xyху]$/.test(args[0])) {
        const acrossX = /^[xх]$/.test(args[0]);
        map = ([x, y]) => acrossX ? [x, -y] : [-x, y];
      } else throw new Error(`Строка ${line}. Используйте «перенос X Y», «поворот угол» или «отражение X/Y».`);
      return result.map(path => path.map(point => {
        const next = map(point);
        if (next.some(number => Math.abs(number) > MAX_COORDINATE)) throw new Error(`Строка ${line}. Превышен предел координат.`);
        return next;
      }));
    }, paths);
  }

  function readMatrix(source) {
    const rows = codeLines(source).filter(row => row.value);
    if (!rows.length || rows.length > 12) throw new Error('Укажите от 1 до 12 строк высот.');
    const matrix = rows.map(row => row.value.split(/\s*;\s*|\s+/).map(token => {
      const level = numeric(token, `Строка ${row.line}`, 30);
      if (level < 0) throw new Error(`Строка ${row.line}. Высота должна быть от 0 до 30 мм.`);
      return level;
    }));
    if (matrix[0].length > 12 || matrix.some(row => row.length !== matrix[0].length)) throw new Error('Во всех строках должно быть одинаковое число столбцов. Допускается до 12 столбцов.');
    return matrix;
  }

  function toBinary(source) {
    const message = source.toUpperCase().replace(/[ .–—-]/g, '');
    if (!message.length || message.length > 12) throw new Error('Укажите от 1 до 12 русских букв.');
    return Array.from(message, letter => {
      const position = letters.indexOf(letter) + 1;
      if (!position) throw new Error('Используйте русские буквы от А до Я, включая Ё.');
      return [...position.toString(2).padStart(6, '0')].map(Number);
    });
  }

  function fromBinary(bits) {
    const rows = codeLines(bits).filter(row => row.value);
    if (!rows.length || rows.length > 12) throw new Error('Укажите от 1 до 12 рядов двоичных цифр.');
    return rows.map(({value, line}) => {
      const sequence = value.replace(/\s/g, '');
      const index = parseInt(sequence, 2);
      if (!/^[01]{6}$/.test(sequence) || !index || index > letters.length) throw new Error(`Строка ${line}. Ожидается код русской буквы из шести двоичных цифр.`);
      return letters[index - 1];
    }).join('');
  }

  function reliefMesh(matrix, pitch, base, Solid = global.LabSolid) {
    if (!Array.isArray(matrix) || matrix.length<1 || matrix.length>12 ||
        !matrix.every(row=>Array.isArray(row)&&row.length===matrix[0].length&&row.length>=1&&row.length<=12&&row.every(n=>Number.isFinite(n)&&n>=0&&n<=30))) {
      throw new Error('Нужна прямоугольная матрица высот до 12 × 12.');
    }
    if (!Number.isFinite(pitch) || !Number.isFinite(base) || pitch < 3 || pitch > 25 || base < 1 || base > 15) throw new Error('Задайте ячейку 3–25 мм и основание 1–15 мм.');
    const axes = n => [0, ...Array.from({length:n}, (_, i) => [i * pitch + .5, (i + 1) * pitch - .5]).flat(), n * pitch];
    const xs = axes(matrix[0].length), ys = axes(matrix.length);
    const w = xs.length - 1, h = ys.length - 1;
    const height = (x, y) => x < 0 || x >= w || y < 0 || y >= h ? 0 : base + (x % 2 && y % 2 ? matrix[(y - 1) / 2][(x - 1) / 2] : 0);
    const build = Solid.createMeshBuilder();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const top = height(x, y), xl = xs[x], xr = xs[x + 1], yt = -ys[y], yb = -ys[y + 1];
      const a = [xl, yt, top], b = [xr, yt, top], c = [xr, yb, top], d = [xl, yb, top];
      const at = (p, z) => [p[0], p[1], z];
      build.quad(d, c, b, a);
      build.quad(at(a,0), at(b,0), at(c,0), at(d,0));
      for (const [u, v, lower] of [[a,b,height(x,y-1)],[b,c,height(x+1,y)],[c,d,height(x,y+1)],[d,a,height(x-1,y)]]) {
        if (lower < top) build.quad(u, v, at(v,lower), at(u,lower));
      }
    }
    return build.finish();
  }

  function assemblyGraph(bodies, features) {
    const nodes = new Map(bodies.map(body => [body.id, {id:body.id, label:body.name || body.id}]));
    const links = features.filter(feature => feature.type === 'mate' && !feature.suppressed && nodes.has(feature.target) && nodes.has(feature.tool));
    const adjacency = new Map([...nodes.keys()].map(id => [id, []])), cycles = [];
    for (const link of links) {
      const from = link.target, to = link.tool;
      const previous = new Map([[from, null]]), queue = [from];
      for (let i = 0; i < queue.length && !previous.has(to); i++) {
        for (const next of adjacency.get(queue[i])) {
          if (!previous.has(next)) { previous.set(next, queue[i]); queue.push(next); }
        }
      }
      if (previous.has(to)) {
        const cycle = [];
        for (let id = to; id !== null; id = previous.get(id)) cycle.unshift(id);
        cycles.push([...cycle, from]);
      }
      adjacency.get(from).push(to);
      adjacency.get(to).push(from);
    }
    return {nodes:[...nodes.values()], links, cycles};
  }

  const quantities = new Map([
    ['ширина', mesh => mesh.bounds.max[0] - mesh.bounds.min[0]],
    ['глубина', mesh => mesh.bounds.max[1] - mesh.bounds.min[1]],
    ['высота', mesh => mesh.bounds.max[2] - mesh.bounds.min[2]],
    ['объём', mesh => mesh.stats.volumeMm3], ['объем', mesh => mesh.stats.volumeMm3],
    ['тел', mesh => mesh.bodies.length], ['отверстий', mesh => mesh.stats.holes],
    ['замкнута', mesh => Number(mesh.stats.closed === true)]
  ]);
  const comparisons = new Map([
    ['>=', (a,b) => a >= b - EPS], ['<=', (a,b) => a <= b + EPS],
    ['>', (a,b) => a > b + EPS], ['<', (a,b) => a < b - EPS],
    ['=', (a,b) => Math.abs(a-b) < .001], ['==', (a,b) => Math.abs(a-b) < .001]
  ]);
  function readTests(source) {
    const rows = codeLines(source).filter(row => row.value);
    if (!rows.length || rows.length > 16) throw new Error('Укажите от 1 до 16 условий.');
    return rows.map(({value,line}) => {
      const expr = value.toLowerCase();
      const parsed = expr === 'замкнута' ? ['', 'замкнута', '=', '1'] : /^([а-яё]+)\s*(>=|<=|==|=|>|<)\s*(\S+)$/u.exec(expr);
      if (!parsed || !quantities.has(parsed[1])) throw new Error(`Строка ${line}. Используйте свойство модели, знак сравнения и число.`);
      const [, key, operator, token] = parsed;
      return {title: value, metric: quantities.get(key), compare: comparisons.get(operator), threshold: numeric(token, `Строка ${line}`, 1000000000)};
    });
  }

  function testMesh(mesh, checks) {
    if (!mesh?.positions?.length) throw new Error('Модель пуста.');
    return checks.map(({title, metric, compare, threshold}) => {
      const actual = metric(mesh);
      return {title, actual, passed:Number.isFinite(actual) && compare(actual, threshold)};
    });
  }

  function sketchPaths(paths, center) {
    return paths.map(path => ({type:'path', points:path.map(([x, y]) => ({x:center.x + x*4, y:center.y - y*4}))}));
  }

  const api = Object.freeze({runTurtle, readCoordinates, polylineDifference, transform, readMatrix, toBinary, fromBinary, reliefMesh, assemblyGraph,
    readTests, testMesh, sketchPaths, letters, examples:Object.freeze({squareCycle, squareExpanded, bugProgram, correctProgram})});
  global.LabCodeGeometry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
