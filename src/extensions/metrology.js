/* Offline metrology exercises. Lengths and deviations are in millimetres. */
(function (global) {
  'use strict';

  const round = value => Number(value.toFixed(4));
  const near = (a, b) => Math.abs(a - b) < 0.0051;
  const format = value => round(value).toLocaleString('ru-RU', { maximumFractionDigits: 4 });
  const sessionLog = [];

  function micrometer(value) {
    const ticks = Math.round(value * 100);
    const sleeveTicks = Math.floor(ticks / 50) * 50;
    return { sleeve: sleeveTicks / 100, thimble: ticks - sleeveTicks, reading: ticks / 100 };
  }

  function variant(seed = 1) {
    seed = Math.max(1, Math.min(999, Math.trunc(Number(seed)) || 1));
    const nominal = [10, 12, 15, 18, 20][(seed - 1) % 5];
    const deviation = [0.06, -0.03, 0.02, -0.07, 0.01, 0.04, -0.02][seed % 7];
    const series = Array.from({ length: 12 }, (_, index) =>
      round(nominal + ((((seed * 17 + index * 13 + index ** 2 * 7) % 23) - 11) / 100)));
    const zero = 0.01 * (1 + seed % 7);
    const corrected = round(nominal + deviation);
    const diameters = [8 + seed % 6, 10 + (seed * 3) % 7];
    const centers = 24 + seed % 13;
    return { seed, nominal, deviation, series, zero, corrected, indicated: round(corrected + zero), diameters, centers,
      outer: centers + (diameters[0] + diameters[1]) / 2,
      shafts: [-0.06, 0.01, 0.08].map(x => round(nominal + x)),
      bores: [-0.03, 0.05, 0.13].map(x => round(nominal + x)),
      interval: [round(nominal - 0.05), round(nominal + 0.05)]
    };
  }

  function summarize(values, limits) {
    if (!values.length || !values.every(Number.isFinite)) throw Error('Нужен ряд числовых показаний.');
    const min = Math.min(...values), max = Math.max(...values);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
    const out = limits ? values.filter(value => value < limits[0] || value > limits[1]).length : null;
    return { min, max, mean, deviation, out };
  }

  function budget(indication, zero, division, repeated) {
    if (![indication, zero, division, repeated].every(Number.isFinite) || division <= 0 || repeated < 0) {
      throw Error('Задайте положительную цену деления и неотрицательный разброс.');
    }
    const corrected = indication - zero;
    const halfRange = repeated / 2;
    const allowance = division / 2 + halfRange;
    return { corrected, zero, allowance, lower: corrected - allowance, upper: corrected + allowance };
  }

  function fit(shaft, bore) {
    const gap = round(bore - shaft);
    return { gap, accepted: gap >= 0.02 && gap <= 0.08 };
  }

  function gauge(value, interval) {
    return { go: value >= interval[0], noGo: value > interval[1] };
  }

  function meterGraphic(value) {
    const { sleeve, thimble } = micrometer(value);
    const previous = Math.max(0, Math.floor(sleeve) - 6);
    const spindle = 61 + (sleeve - previous) * 36 + 10;
    const scale = [];
    for (let tick = previous * 2; tick <= Math.round(sleeve * 2); tick++) {
      const x = 61 + (tick / 2 - previous) * 36, upper = tick % 2 === 0;
      scale.push(`<path d="M${x} 76v${upper ? '-22' : '15'}"/>`);
      if (upper) scale.push(`<text x="${x}" y="46" text-anchor="middle" stroke="none">${tick / 2}</text>`);
    }
    for (let index = -5; index <= 5; index++) {
      const tick = (thimble - index + 50) % 50, y = 76 + index * 9;
      const major = tick % 5 === 0;
      scale.push(`<path d="M${spindle} ${y}h${major ? 28 : 17}"/>`);
      if (major) scale.push(`<text x="${spindle + 36}" y="${y + 4}" stroke="none">${tick}</text>`);
    }
    return `<svg viewBox="0 0 420 147" width="100%" role="img" aria-label="Шкалы стебля и барабана микрометра">
      <rect x="22" y="35" width="375" height="82" rx="10" fill="#e9f1f8"/>
      <path d="M${spindle} 20h100v112h-100Z" fill="#d3e6f5"/>
      <path d="M30 76H${spindle + 29}" stroke="#147b75" stroke-width="1.7"/>
      <g stroke="#193954" stroke-width="1.2" fill="#193954" font-family="system-ui" font-size="12">${scale.join('')}</g>
    </svg>`;
  }

  function holeGraphic(info, labels) {
    const modelWidth = 80;
    const A = 16 + info.diameters[0] / 2, B = A + info.centers;
    const x = value => 43 + value * 4;
    const y = 69;
    const guides = labels.map((label, index) => {
      if (!label) return '';
      const a = index === 0 ? A - info.diameters[0] / 2 : (index === 1 ? A - info.diameters[0] / 2 : B - info.diameters[1] / 2);
      const b = index === 0 ? B + info.diameters[1] / 2 : (index === 1 ? A + info.diameters[0] / 2 : B + info.diameters[1] / 2);
      const level = 17 + index * 100;
      return `<path d="M${x(a)} ${y}V${level}H${x(b)}V${y}" fill="none" stroke="#187b74"/><text x="${(x(a) + x(b))/2}" y="${level - 4}" text-anchor="middle" fill="#185b56">${label}</text>`;
    });
    return `<svg viewBox="0 0 390 244" width="100%" role="img" aria-label="Пластина с двумя отверстиями по одной оси">
      <rect x="43" y="33" width="${modelWidth * 4}" height="72" rx="5" fill="#d5e6f4"/>
      <path d="M43 ${y}H363" stroke="#5a788d" stroke-dasharray="6 3 2 3"/>
      <circle cx="${x(A)}" cy="${y}" r="${info.diameters[0] * 2}" fill="#fff" stroke="#426177"/>
      <circle cx="${x(B)}" cy="${y}" r="${info.diameters[1] * 2}" fill="#fff" stroke="#426177"/>
      <g font-family="system-ui" font-size="12">${guides.join('')}</g>
    </svg>`;
  }

  function mount(body, ui) {
    const { el, button, status, download } = ui;
    const experiments = [
      ['reading', 'Микрометр'], ['zero', 'Ошибка нуля'], ['blind', 'Слепой обмер'],
      ['series', 'Партия втулок'], ['gauge', 'Предельные калибры'], ['budget', 'Бюджет погрешности'],
      ['pairs', 'Подбор пары'], ['indirect', 'Косвенный обмер'], ['limited', 'Три замера'], ['report', 'Паспорт опыта']
    ];
    const mode = el('select'), seed = el('input'), page = el('section', '', 'lab-workbench-card');
    const log = sessionLog;
    seed.type = 'number'; seed.min = '1'; seed.max = '999'; seed.value = '1';
    for (const [value, name] of experiments) {
      const opt = el('option', name); opt.value = value; mode.append(opt);
    }
    function field(label, control, initial) {
      if (control === 'number') {
        control = el('input'); control.type = 'number'; control.step = 'any'; control.value = initial ?? '';
      }
      const node = el('label'); node.append(el('span', label), control);
      return { node, input: control };
    }
    body.append(el('h3', 'Виртуальные измерения'),
      field('Опыт', mode).node, field('Номер варианта', seed).node, page);

    const svgPreview = markup => {
      const node = el('div', '', 'lab-workbench-preview');
      node.innerHTML = markup;
      page.append(node);
    };
    const say = text => page.append(el('p', text));
    const title = text => page.append(el('h4', text));
    const val = input => {
      const value = input.valueAsNumber;
      if (!Number.isFinite(value)) { status('Введите числовое значение.'); throw Error('invalid-input'); }
      return value;
    };
    function answer(info, name, expected, explanation, label = 'Результат, мм', prerequisites = () => true) {
      const entry = field(label, 'number'), feedback = el('p');
      page.append(entry.node, button('Проверить', () => {
        if (!prerequisites() || !entry.input.reportValidity()) return;
        let got; try { got = val(entry.input); } catch { return; }
        const isCorrect = near(got, expected);
        feedback.textContent = `${isCorrect ? 'Верно.' : 'Проверьте расчёт.'} ${explanation}`;
        log.push([info.seed, name, format(got), format(expected), isCorrect ? 'верно' : 'проверить', explanation]);
      }), feedback);
    }
    function makeTable(headings, rows) {
      const table = el('table');
      const header = el('thead'), heading = el('tr'), tbody = el('tbody');
      headings.forEach(label => heading.append(el('th', label)));
      header.append(heading);
      rows.forEach(values => {
        const row = el('tr');
        values.forEach(value => row.append(el('td', String(value))));
        tbody.append(row);
      });
      table.append(header, tbody);
      return table;
    }
    function drill(info, kind) {
      const names = { reading: 'Снимите показание микрометра', zero: 'Внесите поправку нуля', blind: 'Определите неизвестный диаметр' };
      title(names[kind]);
      if (kind === 'zero') {
        say('Сначала проверьте ноль при сомкнутых поверхностях. Вычтите смещение из показания при замере.');
        const zero = el('div', '', 'lab-workbench-preview');
        page.append(button('Сомкнуть микрометр', () => {
          zero.innerHTML = meterGraphic(info.zero);
        }), zero);
        say('Показание при измерении детали');
      } else {
        say('К целым и половинным делениям стебля прибавьте значение барабана. Одно деление барабана равно 0,01 мм.');
      }
      const reading = kind === 'zero' ? info.indicated : info.corrected;
      svgPreview(meterGraphic(reading));
      const { sleeve, thimble } = micrometer(reading);
      const breakdown = `${format(sleeve)} + ${format(thimble / 100)}`;
      const explanation = kind === 'zero'
        ? `${breakdown} − ${format(info.zero)} = ${format(info.corrected)} мм.`
        : `${breakdown} = ${format(reading)} мм.`;
      answer(info, names[kind], info.corrected, explanation, kind === 'blind' ? 'Диаметр детали, мм' : 'Результат, мм');
      if (kind === 'blind') {
        const reveal = el('p');
        page.append(button('Открыть паспорт детали', () => {
          const recorded = log.some(row => row[0] === info.seed && row[1] === names.blind);
          reveal.textContent = recorded ? `Контрольный диаметр ${format(info.corrected)} мм.` : 'Сначала зафиксируйте измерение кнопкой «Проверить».';
        }), reveal);
      }
    }
    function series(info) {
      title('Измерьте 12 втулок');
      const taken = [], reading = el('div', '', 'lab-workbench-preview'), sample = el('p'), plot = el('div');
      say(`Номинал ${format(info.nominal)} мм. Допустимы ${info.interval.map(format).join('–')} мм.`);
      const measure = button('Следующая втулка', () => {
        const value = info.series[taken.length];
        taken.push(value);
        reading.innerHTML = meterGraphic(value);
        sample.textContent = `Втулка ${taken.length} из ${info.series.length}`;
        measure.disabled = taken.length >= info.series.length;
      });
      page.append(measure, sample, reading, button('Рассчитать статистику', () => {
        if (!taken.length) return status('Измерьте хотя бы одну втулку.');
        const result = summarize(taken, info.interval);
        const columns = new Map();
        taken.forEach(value => columns.set(value, (columns.get(value) || 0) + 1));
        plot.replaceChildren(el('p', `Среднее ${format(result.mean)} мм · σ ${format(result.deviation)} мм · вне допуска ${result.out} из ${taken.length}.`),
          makeTable(['Диаметр, мм', 'Количество', 'Частота'], [...columns].sort(([a], [b]) => a - b).map(([x, n]) => [format(x), n, '■'.repeat(n)])));
        log.push([info.seed, 'Партия втулок', taken.map(format).join(', '), format(result.mean), `вне допуска ${result.out}`, `σ = ${format(result.deviation)} мм`]);
      }), plot);
    }
    function gaugeTrial(info) {
      title('Проверьте отверстие двумя пробками');
      say(`Проходная пробка ${format(info.interval[0])} мм. Непроходная пробка ${format(info.interval[1])} мм.`);
      const result = gauge(info.corrected, info.interval), go = el('p'), noGo = el('p');
      page.append(button('Примерить проходную', () => { go.textContent = result.go ? 'Проходная пробка вошла.' : 'Проходная пробка не входит.'; }), go,
        button('Примерить непроходную', () => { noGo.textContent = result.noGo ? 'Непроходная пробка вошла.' : 'Непроходная пробка не входит.'; }), noGo);
      const feedback = el('p');
      function verify(choice) {
        const passed = result.go && !result.noGo;
        feedback.textContent = `${choice === passed ? 'Верно.' : 'Перепроверьте.'} ${passed ? 'Размер в допуске.' : result.go ? 'Отверстие слишком большое.' : 'Отверстие слишком маленькое.'}`;
        log.push([info.seed, 'Предельные калибры', choice ? 'в допуске' : 'вне допуска', passed ? 'в допуске' : 'вне допуска', choice === passed ? 'верно' : 'проверить', feedback.textContent]);
      }
      page.append(button('В допуске', () => verify(true)), button('Вне допуска', () => verify(false)), feedback);
    }
    function budgetTrial(info) {
      title('Оцените границы результата');
      say('Для учебной оценки сложим половину цены деления и половину размаха повторных замеров. Поправку нуля вычтем отдельно.');
      const indication = field('Показание, мм', 'number', round(info.indicated));
      const zero = field('Смещение нуля, мм', 'number', round(info.zero));
      const division = field('Цена деления, мм', 'number', .01), range = field('Размах повторов, мм', 'number', .04);
      const feedback = el('p');
      page.append(indication.node, zero.node, division.node, range.node, button('Рассчитать диапазон', () => {
        try {
          const result = budget(val(indication.input), val(zero.input), val(division.input), val(range.input));
          feedback.textContent = `${format(result.corrected)} ± ${format(result.allowance)} мм. Учебный интервал ${format(result.lower)}…${format(result.upper)} мм.`;
          log.push([info.seed, 'Бюджет погрешности', format(result.corrected), '', '', feedback.textContent]);
        } catch (error) { if (error.message !== 'invalid-input') status(error.message); }
      }), feedback);
    }
    function pairTrial(info) {
      title('Подберите вал и втулку');
      say('Нужен зазор от 0,02 до 0,08 мм включительно.');
      const makeSelect = values => {
        const select = el('select');
        values.forEach((value, index) => {
          const option = el('option', `${index + 1} · ${format(value)} мм`); option.value = value; select.append(option);
        });
        return select;
      };
      const shaft = makeSelect(info.shafts), bore = makeSelect(info.bores), feedback = el('p');
      page.append(field('Диаметр вала', shaft).node, field('Диаметр втулки', bore).node, button('Проверить пару', () => {
        const result = fit(Number(shaft.value), Number(bore.value));
        feedback.textContent = `Зазор ${format(result.gap)} мм. ${result.accepted ? 'Подходит.' : 'Требуется другая пара.'}`;
        log.push([info.seed, 'Подбор пары', format(result.gap), '0,02–0,08', result.accepted ? 'верно' : 'проверить', feedback.textContent]);
      }), feedback);
    }
    function indirect(info, limited) {
      title(limited ? 'Найдите расстояние за три замера' : 'Найдите расстояние между центрами');
      say(limited ? 'Доступно три действия. Выберите показания, которых хватит для однозначного расчёта.' : 'Вычислите межосевое расстояние по наружному размеру и диаметрам отверстий.');
      const readings = [info.outer, ...info.diameters];
      const selected = new Set(), labels = ['', '', ''];
      const canvas = el('div', '', 'lab-workbench-preview'), outputs = el('ul'), options = el('div', '', 'lab-workbench-actions');
      page.append(canvas, options, outputs);
      canvas.innerHTML = holeGraphic(info, labels);
      const candidates = [
        ['Наружный размер', 0, info.outer], ['Левый диаметр', 1, info.diameters[0]], ['Правый диаметр', 2, info.diameters[1]],
        ['Длина пластины', 3, 80], ['Ширина пластины', 4, 18]
      ];
      for (const [name, key, value] of (limited ? candidates : candidates.slice(0, 3))) {
        const control = button(name, () => {
          if (limited && selected.size >= 3) return status('Бюджет исчерпан. Начните опыт заново, чтобы изменить выбор.');
          selected.add(key); control.disabled = true;
          outputs.append(el('li', `${name} · ${format(value)} мм`));
          if (key < 3) labels[key] = `${format(value)} мм`;
          canvas.innerHTML = holeGraphic(info, labels);
        });
        options.append(control);
      }
      if (limited) options.append(button('Начать заново', render));
      answer(info, limited ? 'Три замера' : 'Косвенный обмер', info.centers,
        `${format(readings[0])} − (${format(readings[1])} + ${format(readings[2])}) / 2 = ${format(info.centers)} мм.`,
        'Расстояние между центрами, мм', () => {
          if ([0, 1, 2].every(key => selected.has(key))) return true;
          status(limited && selected.size === 3 ? 'Выберите три замера, определяющих положение центров. Начните заново.' : 'Сначала снимите необходимые показания.');
          return false;
        });
    }
    function report() {
      title('Паспорт измерительного опыта');
      if (!log.length) return say('Выполните опыт и проверьте показание, чтобы добавить строку в паспорт.');
      const headings = ['Вариант', 'Опыт', 'Показание / расчёт', 'Контроль', 'Оценка', 'Вывод'];
      const summary = el('textarea'); summary.placeholder = 'Сформулируйте собственный вывод по измерениям';
      page.append(makeTable(headings, log), field('Итоговый вывод', summary).node,
        button('Печать паспорта', () => {
          const report = global.open('', '_blank', 'popup,width=900,height=720');
          if (!report) return status('Разрешите всплывающее окно или сохраните паспорт в CSV.');
          const section = makeTable(headings, log);
          report.document.title = 'Паспорт измерительного опыта';
          report.document.body.append(el('h1', 'Паспорт измерительного опыта'), section, el('p', summary.value));
          report.print();
        }),
        button('Сохранить CSV', () => {
          const conclusion = /^[\s]*[=+@-]/.test(summary.value) ? "'" + summary.value : summary.value;
          const csv = [headings, ...log, ['', 'Итоговый вывод', '', '', '', conclusion]].map(row =>
            row.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(';')).join('\r\n');
          download('\uFEFF' + csv, 'measurement-passport.csv', 'text/csv;charset=utf-8');
        }));
    }
    function render() {
      page.replaceChildren(); status('');
      const info = variant(seed.value), kind = mode.value;
      if (['reading', 'zero', 'blind'].includes(kind)) drill(info, kind);
      if (kind === 'series') series(info);
      if (kind === 'gauge') gaugeTrial(info);
      if (kind === 'budget') budgetTrial(info);
      if (kind === 'pairs') pairTrial(info);
      if (kind === 'indirect' || kind === 'limited') indirect(info, kind === 'limited');
      if (kind === 'report') report();
    }
    mode.addEventListener('change', render); seed.addEventListener('change', render); render();
  }

  const api = Object.freeze({ micrometer, variant, summarize, budget, fit, gauge, meterGraphic });
  global.LabMetrology = api;
  global.LabExtensions?.register({ id: 'metrology', title: 'Метрология', mount });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
