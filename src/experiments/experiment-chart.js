/* Volume curves take millimetres and cubic millimetres from the experiment. */
(() => {
  'use strict';

  const svgNS = 'http://www.w3.org/2000/svg';
  const precise = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 6});
  const signed = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 6, signDisplay: 'exceptZero'});
  const mounts = new WeakMap();
  const keys = new Map([
    ['ArrowLeft', -1], ['ArrowDown', -1], ['ArrowRight', 1], ['ArrowUp', 1]
  ]);
  const metrics = [
    {id:'remaining', label:'Объём детали', value:'volume', expected:'expectedVolume'},
    {id:'removed', label:'Удалённый объём', value:'removedVolume', expected:'expectedRemovedVolume'}
  ];

  function svg(tag, attrs, value) {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, attr] of Object.entries(attrs)) node.setAttribute(key, attr);
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function html(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function legendItem(style, label) {
    const item = html('span');
    const mark = html('span', 'experiment-chart-key-' + style);
    mark.setAttribute('aria-hidden', 'true');
    item.append(mark, label);
    return item;
  }

  function axisTicks(minimum, maximum, count) {
    const span = maximum - minimum || Math.max(1, maximum * .01);
    const desired = span / count;
    const magnitude = 10 ** Math.floor(Math.log10(desired));
    const unit = [1, 2, 2.5, 5, 10].find(candidate => candidate * magnitude >= desired) ?? 10;
    const step = unit * magnitude;
    const start = Math.max(0, Math.floor((minimum - span * .05) / step));
    const end = Math.ceil((maximum + span * .05) / step);
    return Array.from({length: end - start + 1}, (_, index) => (start + index) * step);
  }

  function sampleTicks(length, capacity) {
    const count = Math.min(length, capacity);
    if (count === 1) return [0];
    return Array.from({length: count}, (_, index) => Math.round(index * (length - 1) / (count - 1)));
  }

  function clear(container) {
    mounts.get(container)?.disconnect();
    mounts.delete(container);
    container.replaceChildren();
  }

  function render(container, rows, {selectedValue = null, axis = 'diameter', axisLabel = 'Диаметр отверстия', onSelect} = {}) {
    clear(container);
    if (!rows.length) return null;

    const data = rows.map(row => ({row, coordinate: row.parameters[axis]}));
    data.sort((a, b) => a.coordinate - b.coordinate);
    const last = data.length - 1;
    const panel = html('section', 'experiment-chart');
    panel.setAttribute('aria-label', `График зависимости объёма • ${axisLabel}`);
    const header = html('div', 'experiment-chart-header');
    const metricSwitch = html('div', 'experiment-chart-metrics');
    metricSwitch.setAttribute('role', 'group');
    metricSwitch.setAttribute('aria-label', 'Что показать на графике');
    const metricButtons = metrics.map(option => {
      const button = html('button', '', option.label);
      button.type = 'button';
      button.dataset.experimentMetric = option.id;
      button.addEventListener('click', () => {
        if (option === metric) return;
        metric = option;
        widthDrawn = 0;
        draw();
      });
      metricSwitch.append(button);
      return button;
    });
    const key = html('div', 'experiment-chart-key');
    key.append(legendItem('model', 'Объём CAD-модели'), legendItem('analytic', 'По формуле'));
    header.append(metricSwitch,key);

    const plot = svg('svg', {
      class: 'experiment-chart-plot', role: 'group',
      'aria-label': `${axisLabel}. Точки выбираются стрелками.`
    });
    const selector = html('label', 'experiment-chart-selection');
    const choices = html('select');
    selector.append(axisLabel, choices);
    for (const [index, {coordinate}] of data.entries()) {
      const option = html('option', '', precise.format(coordinate) + ' мм');
      option.value = index;
      choices.append(option);
    }

    const reading = html('output', 'experiment-chart-reading');
    reading.setAttribute('aria-live', 'polite');
    const readout = [
      ['CAD-модель', 'volume'], ['По формуле', 'expectedVolume'], ['CAD − формула', 'difference']
    ].map(([label, id]) => {
      const item = html('span');
      const text = html('strong');
      text.dataset.experimentReading = id;
      item.append(html('span', '', label), text);
      reading.append(item);
      return text;
    });
    const controls = html('div', 'experiment-chart-controls');
    controls.append(selector, reading);
    panel.append(header, plot, controls);
    container.append(panel);

    const closest = value => data.reduce((best, item, index) =>
      Math.abs(item.coordinate - value) < Math.abs(data[best].coordinate - value) ? index : best, 0);
    let active = Number.isFinite(selectedValue) ? closest(selectedValue) : 0;
    let metric = metrics[0];
    let widthDrawn = 0;
    let points = [];
    let cursor;
    let xAt;

    function sync() {
      const {row} = data[active];
      choices.value = active;
      const value = row[metric.value], expected = row[metric.expected];
      readout[0].textContent = precise.format(value) + ' мм³';
      readout[1].textContent = precise.format(expected) + ' мм³';
      readout[2].textContent = signed.format(value - expected) + ' мм³';
      for (const button of metricButtons) {
        button.setAttribute('aria-pressed', String(button.dataset.experimentMetric === metric.id));
      }
      for (const [index, node] of points.entries()) {
        node.setAttribute('tabindex', index === active ? '0' : '-1');
        node.setAttribute('aria-pressed', String(index === active));
      }
      if (cursor) {
        const x = xAt(data[active].coordinate);
        cursor.setAttribute('x1', x);
        cursor.setAttribute('x2', x);
      }
    }

    function choose(index, {focus = false, emit = true} = {}) {
      active = Math.min(last, Math.max(0, index));
      sync();
      if (focus) points[active]?.focus({preventScroll: true});
      if (emit) onSelect?.(data[active].row);
    }

    function draw() {
      const width = Math.max(210, Math.floor(plot.getBoundingClientRect().width || 640));
      if (width === widthDrawn) return;
      widthDrawn = width;
      const height = width < 470 ? 208 : Math.min(284, Math.max(232, Math.round(width * .36)));
      const values = data.flatMap(({row}) => [row[metric.value], row[metric.expected]]);
      const yTicks = axisTicks(Math.min(...values), Math.max(...values), width < 470 ? 4 : 5);
      const tickFormat = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 5});
      const yLabels = yTicks.map(value => tickFormat.format(value));
      const left = Math.max(41, Math.max(...yLabels.map(value => value.length)) * 6.2 + 12);
      const top = 27, right = width - 14, bottom = height - 43;
      const dotRadius = Math.max(1.5, Math.min(3.5, (right - left) / Math.max(1,last) * .28));
      const xMin = data[0].coordinate, xMax = data[last].coordinate;
      const yMin = yTicks[0], yMax = yTicks.at(-1);
      xAt = value => left + (xMax === xMin ? .5 : (value - xMin) / (xMax - xMin)) * (right - left);
      const yAt = value => bottom - (value - yMin) / (yMax - yMin) * (bottom - top);
      const line = (x1, y1, x2, y2, className) => svg('line', {x1,y1,x2,y2,class:className});
      const label = (x, y, anchor, text, className = 'experiment-chart-tick') =>
        svg('text', {x,y,'text-anchor':anchor,class:className}, text);
      const path = style => data.map(({coordinate,row}, index) =>
        `${index ? 'L' : 'M'}${xAt(coordinate)},${yAt(row[style])}`).join(' ');

      const focused = document.activeElement?.getAttribute('data-experiment-sample');
      plot.setAttribute('viewBox', `0 0 ${width} ${height}`);
      plot.setAttribute('aria-label', `${metric.label} • ${axisLabel}. Точки выбираются стрелками.`);
      const guide = svg('g', {'aria-hidden': 'true'});
      yTicks.forEach((tick, index) => {
        const y = yAt(tick);
        guide.append(line(left,y,right,y,'experiment-chart-grid'), label(left - 8,y + 4,'end',yLabels[index]));
      });
      const xTicks = sampleTicks(data.length, Math.max(2, Math.min(8, Math.floor((right - left) / 52))));
      xTicks.forEach(index => {
        const {coordinate} = data[index], x = xAt(coordinate);
        guide.append(line(x, bottom, x, bottom + 5, 'experiment-chart-axis'));
        const anchor = index === 0 && last ? 'start' : index === last && last ? 'end' : 'middle';
        guide.append(label(x, bottom + 18, anchor, precise.format(coordinate)));
      });
      guide.append(
        line(left,top,left,bottom,'experiment-chart-axis'),
        line(left,bottom,right,bottom,'experiment-chart-axis'),
        label(left, 14, 'start', metric.label + ', мм³', 'experiment-chart-units'),
        label((left + right) / 2, height - 5, 'middle', axisLabel + ', мм', 'experiment-chart-units')
      );
      cursor = line(left, top, left, bottom, 'experiment-chart-cursor');
      guide.append(
        cursor,
        svg('path', {d: path(metric.value), class: 'experiment-chart-model'}),
        svg('path', {d: path(metric.expected), class: 'experiment-chart-analytic'})
      );
      plot.replaceChildren(guide);

      points = data.map(({coordinate,row}, index) => {
        const x = xAt(coordinate);
        const value = row[metric.value];
        const y = yAt(value);
        const previous = index ? (xAt(data[index - 1].coordinate) + x) / 2 : left - 8;
        const next = index < last ? (x + xAt(data[index + 1].coordinate)) / 2 : right + 8;
        const node = svg('g', {
          'data-experiment-sample': index, 'data-experiment-diameter': row.parameters.diameter, 'data-experiment-coordinate': coordinate, role: 'button',
          'aria-label': `${axisLabel} ${precise.format(coordinate)} мм. ${metric.label} по CAD-модели ${precise.format(value)} мм³`
        });
        node.append(
          svg('rect', {x:previous,y:top-6,width:next-previous,height:bottom-top+12,class:'experiment-chart-hit'}),
          svg('circle', {cx:x,cy:y,r:7,class:'experiment-chart-focus-ring'}),
          svg('circle', {cx:x,cy:y,r:dotRadius,class:'experiment-chart-dot'})
        );
        node.addEventListener('click', () => choose(index,{focus:true}));
        node.addEventListener('keydown', event => {
          let target = index;
          if (keys.has(event.key)) target += keys.get(event.key);
          else if (event.key === 'Home') target = 0;
          else if (event.key === 'End') target = last;
          else if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          choose(target,{focus:true});
        });
        plot.append(node);
        return node;
      });
      sync();
      if (focused !== null && focused !== undefined) points[Number(focused)]?.focus({preventScroll:true});
    }

    choices.addEventListener('change', () => choose(Number(choices.value)));
    draw();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(draw);
      observer.observe(plot);
      mounts.set(container, observer);
    }

    return {select: value => {
      if (Number.isFinite(value)) choose(closest(value),{
        emit:false,focus:plot.contains(document.activeElement)
      });
    }};
  }

  window.LabExperimentChart = {render, clear};
})();
