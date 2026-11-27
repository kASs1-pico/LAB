/* A repeatable volume experiment with a rectangular plate and a through-hole. */
(() => {
  'use strict';
  const app = window.LabApp;
  const geometry = window.LabExperimentGeometry;
  const svgNS = 'http://www.w3.org/2000/svg';
  const decimal = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 3});
  const signed = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 3, signDisplay: 'exceptZero'});
  const parameterLabels = {
    length: 'Длина', width: 'Ширина', thickness: 'Толщина', diameter: 'Диаметр отверстия'
  };
  const rangeLabels = {from: 'От, мм', to: 'До, мм', step: 'Шаг, мм'};
  let experiment, trial, graphPoint, chart, seriesRows, returnFocus, serial = 0;
  const variantTrials = new Map();

  function element(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  }
  function svg(tag, attributes, children = []) {
    const node = document.createElementNS(svgNS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  }
  const button = (id, text, type = 'button') => element('button', {id, type, textContent: text});
  const paragraph = (text, className) => element('p', {textContent: text, className});
  const title = text => element('h3', {textContent: text});
  const field = (label, input) => element('label', {}, [label, input]);
  const result = value => `${decimal.format(value)} мм³`;
  function valueCell(value, unit, formatter) {
    return element('td', {}, [
      element('span', {className: 'experiment-table-number', textContent: formatter.format(value)}),
      element('small', {className: 'experiment-table-unit', textContent: ' ' + unit})
    ]);
  }
  function announcement(id) {
    const node = paragraph('', 'experiment-status');
    node.id = id;
    node.setAttribute('role', 'status');
    node.hidden = true;
    return node;
  }
  function report(node, message = '', error = false) {
    node.hidden = !message;
    node.textContent = message;
    node.classList.toggle('experiment-error', error);
  }
  function readFields(fields) {
    return Object.fromEntries(Object.entries(fields).map(([key, field])=>[key, field.value]));
  }
  function setFields(fields, values) {
    for (const [key, input] of Object.entries(fields)) input.value = values[key];
  }
  function commit(next) {
    if (!app.setExperiment(next)) return false;
    experiment = app.getExperiment();
    return true;
  }
  function numericFormulas(parameters) {
    return Object.fromEntries(Object.entries(parameters).map(([key, value])=>[key, String(value)]));
  }
  function plateScale(list) {
    return Math.min(230 / Math.max(...list.map(p=>p.length)), 106 / Math.max(...list.map(p=>p.width)));
  }
  function drawing(parameters, scale = plateScale([parameters])) {
    const width = parameters.length * scale, height = parameters.width * scale;
    const x = (280-width)/2, y = (150-height)/2, radius = parameters.diameter * scale/2;
    const outer = `M${x},${y}h${width}v${height}h-${width}Z`;
    const hole = radius ? `M${140-radius},75a${radius},${radius} 0 1 0 ${radius*2},0a${radius},${radius} 0 1 0 -${radius*2},0Z` : '';
    return svg('svg', {
      viewBox: '0 0 280 150',
      class: 'experiment-plate',
      role: 'img',
      'aria-label': `Вид сверху. Пластина ${decimal.format(parameters.length)} × ${decimal.format(parameters.width)} мм, отверстие диаметром ${decimal.format(parameters.diameter)} мм`
    }, [
      svg('path', {d: `${outer} ${hole}`, 'fill-rule': 'evenodd', class: 'experiment-plate-material'}),
      svg('path', {d: `M${x-9},75H${x+width+9}M140,${y-9}V${y+height+9}`, class: 'experiment-plate-axes'})
    ]);
  }

  const dialog = element('dialog', {id: 'experiment-dialog', className: 'experiment-dialog'});
  dialog.setAttribute('aria-labelledby', 'experiment-title');
  const heading = element('h2', {id: 'experiment-title', textContent: 'Эксперимент'});
  const closeButton = button('experiment-close', '×');
  closeButton.setAttribute('aria-label', 'Закрыть эксперимент');
  const header = element('header', {className: 'experiment-header'}, [
    element('div', {}, [heading, paragraph('Пластина со сквозным отверстием', 'experiment-subtitle')]),
    closeButton
  ]);

  const formulaFields = {}, formulaOutputs = {};
  const formulasGrid = element('div', {className: 'experiment-fields'});
  for (const [key, label] of Object.entries(parameterLabels)) {
    const input = element('input', {id: `experiment-${key}`, type: 'text', required: true, maxLength: 160,
      spellcheck: false, autocomplete: 'off', autocapitalize: 'none'});
    const output = element('output');
    output.htmlFor.add(input.id);
    formulaFields[key] = input;
    formulaOutputs[key] = output;
    formulasGrid.append(element('div', {className: 'experiment-formula'}, [
      field(element('span', {}, [label, element('code', {textContent: key})]), input), output
    ]));
  }
  const apply = button('experiment-apply', 'Применить', 'submit');
  apply.className = 'experiment-primary';
  const formulaStatus = announcement('experiment-formula-status');
  const formulas = element('form', {className: 'experiment-card', id: 'experiment-parameters'}, [
    title('Параметры модели'),
    paragraph('Задайте число в миллиметрах или формулу. Например, width / 4. Доступны +, −, *, /, ^, скобки и π.', 'experiment-note'),
    formulasGrid,
    apply,
    formulaStatus
  ]);
  const picture = element('div', {className: 'experiment-specimen', id: 'experiment-preview'});
  const pointLabel = paragraph('', 'experiment-reading-label');
  const resetPoint = button('experiment-return-to-formulas', 'Вернуться к параметрам');
  const download = button('experiment-draft-project', 'Скачать CAD-проект');
  const diameter = element('strong', {id: 'experiment-hole-size'});
  const volume = element('strong', {id: 'experiment-volume'});
  const expected = element('strong', {id: 'experiment-expected-volume'});
  const metrics = element('dl', {className: 'experiment-metrics'}, [
    element('div', {}, [element('dt', {textContent: 'Отверстие'}), element('dd', {}, [diameter])]),
    element('div', {}, [element('dt', {textContent: 'Объём 3D-модели'}), element('dd', {}, [volume])]),
    element('div', {}, [element('dt', {textContent: 'Расчётный объём'}), element('dd', {}, [expected])])
  ]);
  const preview = element('section', {className: 'experiment-card experiment-preview-card'}, [
    title('Модель пластины'), picture, pointLabel, metrics,
    element('div', {className: 'experiment-actions'}, [resetPoint, download])
  ]);

  function sweepFields(prefix) {
    const inputs = {};
    const boxes = element('div', {className: 'experiment-fields experiment-range-fields'});
    for (const [key, label] of Object.entries(rangeLabels)) {
      const input = element('input', {id: `experiment-${prefix}${key}`, type: 'number', min: '0', step: 'any', required: true});
      inputs[key] = input;
      boxes.append(field(label, input));
    }
    return {inputs, boxes};
  }
  function axisSelect(id, optional = false) {
    return element('select', {id}, [
      ...(optional ? [element('option', {value: '', textContent: 'Один параметр'})] : []),
      ...Object.entries(parameterLabels).map(([value,textContent])=>element('option',{value,textContent}))
    ]);
  }
  const {inputs:ranges, boxes:rangeFields} = sweepFields('');
  const {inputs:secondRanges, boxes:secondRangeFields} = sweepFields('second-');
  const axis = axisSelect('experiment-axis');
  const secondAxis = axisSelect('experiment-second-axis', true);
  const prediction = element('textarea', {id: 'experiment-prediction', rows: 2, maxLength: 420,
    placeholder: 'Что изменится и почему?'});
  const predictionSave = button('experiment-save-prediction', 'Записать прогноз');
  const predictionResult = announcement('experiment-prediction-result');
  const drawChart = button('experiment-build-chart', 'Построить график', 'submit');
  const csvButton = button('experiment-csv', 'Скачать CSV');
  const sweep = element('form', {id: 'experiment-sweep'}, [
    element('div', {className: 'experiment-fields'}, [
      element('div', {className: 'experiment-sweep-axis'}, [field('Параметр графика', axis), rangeFields]),
      element('div', {className: 'experiment-sweep-axis'}, [field('Второй параметр', secondAxis), secondRangeFields])
    ]),
    element('div', {className: 'experiment-actions'}, [drawChart, csvButton])
  ]);
  const chartStatus = announcement('experiment-chart-status');
  const mount = element('div', {id: 'experiment-chart', hidden: true});
  const plot = element('section', {className: 'experiment-card experiment-plot-card'}, [
    title('Зависимость объёма от размеров'),
    paragraph('Выбранные параметры меняются по заданным диапазонам. Остальные размеры фиксируются по текущей модели.', 'experiment-note'),
    element('details', {className:'experiment-extra'}, [
      element('summary', {textContent: 'Прогноз перед опытом'}),
      field('Как изменится объём?', prediction), predictionSave, predictionResult
    ]),
    sweep, chartStatus, mount
  ]);

  const materials = {
    pla: ['ПЛА', 1.24], aluminium: ['Алюминий', 2.7], steel: ['Сталь', 7.85], copper: ['Медь', 8.96]
  };
  function materialChoice(value) {
    const select = element('select', {}, Object.entries(materials).map(([id, [name, density]])=>
      element('option', {value: id, textContent: `${name} · ${decimal.format(density)} г/см³`})
    ));
    select.value = value;
    return select;
  }
  const materialsA = materialChoice('aluminium'), materialsB = materialChoice('steel');
  const massResults = announcement('experiment-mass-results');
  const accuracyTable = element('div', {className: 'experiment-overflow'});
  const extra = element('section', {className: 'experiment-card experiment-plot-card'}, [
    title('Материал и точность'),
    element('details', {className: 'experiment-extra'}, [
      element('summary', {textContent:'Сравнить массу материалов'}),
      paragraph('Для оценки берётся типичная плотность. Начало координат находится в центре нижней грани пластины.', 'experiment-note'),
      element('div', {className:'experiment-fields'}, [field('Материал А', materialsA), field('Материал Б', materialsB)]),
      massResults
    ]),
    element('details', {className: 'experiment-extra'}, [
      element('summary', {textContent:'Проверить приближение круга'}),
      paragraph('Круг заменён правильным вписанным многоугольником. Сравните объём каждой 3D‑модели с объёмом по формуле круга.', 'experiment-note'),
      accuracyTable
    ])
  ]);

  const variantName = element('input', {id: 'experiment-variant-name', type: 'text', required: true, maxLength: 64,
    placeholder: 'Например, отверстие 20 мм'});
  const saveVariant = button('experiment-save-variant', 'Сохранить вариант', 'submit');
  const variants = element('form', {id: 'experiment-variant-form'}, [field('Название варианта', variantName), saveVariant]);
  const variantStatus = announcement('experiment-variant-status');
  const choices = ['before', 'after'].map((key, index)=>{
    const select = element('select', {id: `experiment-${key}`});
    const load = button(`experiment-load-${key}`, 'Загрузить параметры');
    const remove = button(`experiment-delete-${key}`, 'Удалить вариант');
    select.addEventListener('change', ()=>selectVariant(index, select.value));
    load.addEventListener('click', ()=>loadVariant(select.value));
    remove.addEventListener('click', ()=>removeVariant(select.value));
    return {select, load, remove, box: element('div', {className: 'experiment-variant-choice'}, [
      field(index?'Вариант Б':'Вариант А', select),
      element('div', {className: 'experiment-actions'}, [load, remove])
    ])};
  });
  const comparisonPreview = element('div', {className: 'experiment-variant-previews'});
  const values = element('div', {id: 'experiment-comparison-values'});
  const comparison = element('section', {className: 'experiment-card experiment-compare-card'}, [
    title('Сравнение вариантов'),
    variants, variantStatus,
    element('div', {className: 'experiment-variant-choices'}, choices.map(choice=>choice.box)),
    comparisonPreview, values
  ]);
  dialog.append(header, element('div', {className: 'experiment-overview'}, [formulas, preview]), plot, comparison, extra);
  document.body.append(dialog);

  function current() { return graphPoint || trial; }
  function renderPreview() {
    const data = current();
    picture.replaceChildren(drawing(data.parameters));
    diameter.textContent = `${decimal.format(data.parameters.diameter)} мм`;
    volume.textContent = result(data.volume);
    expected.textContent = result(data.expectedVolume);
    resetPoint.hidden = !graphPoint;
    pointLabel.textContent = graphPoint?'Точка графика':'Вид сверху';
  }
  function choiceTitle(variant) { return variant?.name || 'Текущая пластина'; }
  function getVariant(id) { return experiment.variants.find(variant=>variant.id===id); }
  function viewVariant(variant) {
    if (!variant) return current();
    if (!variantTrials.has(variant.id)) variantTrials.set(variant.id, geometry.evaluate(variant.formulas));
    return variantTrials.get(variant.id);
  }
  function renderComparison() {
    const pair = experiment.comparison.map(getVariant);
    comparisonPreview.replaceChildren();
    values.replaceChildren();
    if (pair.every(variant=>!variant)) {
      values.append(paragraph('Сохраните вариант, чтобы сравнить его с текущей пластиной или другим вариантом.', 'experiment-note'));
      return;
    }
    const [a,b] = pair.map(viewVariant);
    const scale = plateScale([a.parameters,b.parameters]);
    for (const [index, item] of [a,b].entries()) {
      const tag = index?'Б':'А';
      comparisonPreview.append(element('figure', {className: 'experiment-small-specimen'}, [
        drawing(item.parameters, scale),
        element('figcaption', {textContent: `${tag} · ${choiceTitle(pair[index])}`})
      ]));
    }
    const measures = [
      ...Object.entries(parameterLabels).map(([key,label])=>[label, a.parameters[key], b.parameters[key], 'мм']),
      ['Объём 3D-модели', a.volume, b.volume, 'мм³'],
      ['Расчётный объём', a.expectedVolume, b.expectedVolume, 'мм³'],
      ['Удалённый объём', a.removedVolume, b.removedVolume, 'мм³']
    ];
    const header = element('thead', {}, [element('tr', {}, ['Параметр','А','Б','Б − А'].map(text=>{
      const th = element('th', {textContent: text});
      th.scope = 'col';
      return th;
    }))]);
    const body = element('tbody', {}, measures.map(([label,before,after,unit])=>{
      const th = element('th', {textContent: label});
      th.scope = 'row';
      return element('tr', {}, [th, valueCell(before,unit,decimal),valueCell(after,unit,decimal),
        valueCell(after-before,unit,signed)]);
    }));
    values.append(element('table', {className: 'experiment-table'}, [header, body]));
  }
  function renderVariantChoices() {
    choices.forEach(({select, load, remove}, index)=>{
      select.replaceChildren(
        element('option', {value: '', textContent: 'Текущая пластина'}),
        ...experiment.variants.filter(variant=>variant.id!==experiment.comparison[1-index])
          .map(variant=>element('option', {value: variant.id, textContent: variant.name}))
      );
      select.value = experiment.comparison[index] || '';
      load.disabled = remove.disabled = !select.value;
    });
    renderComparison();
  }
  function renderSelection() {
    renderPreview();
    renderComparison();
    refreshExtras();
  }
  function refreshExtras() {
    const data = current();
    const masses = [materialsA.value, materialsB.value].map(key=>{
      const [name,density] = materials[key];
      return `${name} — ${decimal.format(data.volume*density/1000)} г`;
    });
    report(massResults, `${masses.join(' · ')}. Центр масс (0; 0; ${decimal.format(data.parameters.thickness/2)}) мм.`);
    picture.querySelector('svg')?.append(svg('circle', {cx:140,cy:75,r:3,class:'experiment-center-mass'}));
    const head = element('thead', {}, [element('tr', {}, ['Сторон', 'Объём', 'Разница с кругом'].map(textContent=>
      element('th', {scope:'col', textContent})))]);
    const body = element('tbody', {}, geometry.accuracy(data.parameters).map(row=>element('tr', {}, [
      element('th', {scope:'row', textContent:String(row.segments)}), valueCell(row.volume, 'мм³', decimal),
      valueCell(row.error, 'мм³', signed)
    ])));
    accuracyTable.replaceChildren(element('table', {className:'experiment-table'}, [head,body]));
  }
  function showGraph(rows, axis) {
    seriesRows = rows;
    csvButton.disabled = false;
    mount.hidden = false;
    chart = window.LabExperimentChart.render(mount, rows, {
      selectedValue: current().parameters[axis], axis, axisLabel: parameterLabels[axis],
      onSelect: row => {
        graphPoint = row;
        renderSelection();
      }
    });
    report(chartStatus);
  }
  function showGrid({columns,rows,results}, axis, vertical) {
    window.LabExperimentChart.clear(mount);
    chart = null;
    seriesRows = results.flat();
    csvButton.disabled = false;
    mount.hidden = false;
    const valid = seriesRows.filter(row=>!row.error);
    const minimum = valid.length ? Math.min(...valid.map(row=>row.volume)) : 0;
    const maximum = valid.length ? Math.max(...valid.map(row=>row.volume)) : 0;
    const selectedCell = [];
    const title = `${parameterLabels[axis]} → · ${parameterLabels[vertical]} ↓, мм`;
    const header = element('thead', {}, [element('tr', {}, [
      element('th', {scope:'col', textContent:title}),
      ...columns.map(value=>element('th', {scope:'col', textContent:decimal.format(value)}))
    ])]);
    const body = element('tbody', {}, results.map((line, index)=>element('tr', {}, [
      element('th', {scope:'row', textContent:decimal.format(rows[index])}),
      ...line.map(row=>{
        if (row.error) {
          const cell = element('td', {textContent:'—', title:row.error});
          cell.setAttribute('aria-label', row.error);
          return cell;
        }
        const cell = button('', decimal.format(row.volume));
        cell.removeAttribute('id');
        cell.className = 'experiment-heat-cell';
        const value = maximum>minimum ? (row.volume-minimum)/(maximum-minimum) : 0.5;
        cell.style.setProperty('--heat-share', `${Math.round(value*55+12)}%`);
        cell.title = `${decimal.format(row.volume)} мм³`;
        cell.setAttribute('aria-pressed', 'false');
        cell.addEventListener('click', ()=>{
          selectedCell.pop()?.setAttribute('aria-pressed','false');
          cell.setAttribute('aria-pressed','true');
          selectedCell.push(cell);
          graphPoint = row;
          renderSelection();
        });
        return element('td', {}, [cell]);
      })
    ])));
    const caption = element('caption', {textContent: 'Объём модели, мм³. Прочерк обозначает невозможную геометрию.'});
    mount.append(element('div', {className:'experiment-overflow'}, [
      element('table', {className:'experiment-table experiment-heatmap'}, [caption,header,body])
    ]));
    chart = {select:()=>{
      selectedCell.pop()?.setAttribute('aria-pressed','false');
    }};
    report(chartStatus, valid.length ? '' : 'В этих диапазонах нет допустимых комбинаций.', !valid.length);
  }
  function chartData(settings) {
    return settings.secondAxis
      ? geometry.grid(settings.formulas, settings.range, settings.axis, settings.secondRange, settings.secondAxis)
      : geometry.series(settings.formulas, settings.range, settings.axis);
  }
  function displayChart(value) {
    if (experiment.secondAxis) showGrid(value,experiment.axis,experiment.secondAxis);
    else showGraph(value,experiment.axis);
    if (!experiment.prediction) return;
    const rows = seriesRows.filter(row=>!row.error);
    if (!rows.length) {
      report(predictionResult, `Прогноз: «${experiment.prediction}». Для сравнения выберите допустимые диапазоны.`);
      return;
    }
    const volumes = rows.map(row=>row.volume);
    const trend = experiment.secondAxis ? '' : ` От первой точки к последней: ${signed.format(volumes.at(-1)-volumes[0])} мм³.`;
    report(predictionResult, `Прогноз: «${experiment.prediction}». Объёмы в опыте: ${decimal.format(Math.min(...volumes))}–${decimal.format(Math.max(...volumes))} мм³.${trend}`);
  }
  function hideChart() {
    window.LabExperimentChart.clear(mount);
    chart = null;
    seriesRows = null;
    csvButton.disabled = true;
    mount.hidden = true;
  }
  function refreshGraph() {
    if (experiment.predictionPending) {
      hideChart();
      report(predictionResult, 'Прогноз записан. Постройте график, чтобы сравнить его с результатом.');
      return;
    }
    try {
      displayChart(chartData(experiment));
    } catch (error) {
      hideChart();
      report(chartStatus, error.message, true);
    }
  }
  function applyFormulas(expressions) {
    try {
      const next = geometry.evaluate(expressions);
      if (!commit({...experiment, formulas: expressions})) return;
      trial = next;
      graphPoint = null;
      setFields(formulaFields, experiment.formulas);
      for (const [key, output] of Object.entries(formulaOutputs)) {
        output.value = `${decimal.format(trial.parameters[key])} мм`;
      }
      report(formulaStatus, 'Параметры применены.');
      renderSelection();
      refreshGraph();
    } catch (error) {
      report(formulaStatus, error.message, true);
    }
  }
  const formulasChanged = () => Object.entries(formulaFields).some(([key,input])=>
    input.value.trim()!==experiment.formulas[key]);
  function usesAppliedFormulas(status = formulaStatus) {
    if (!formulasChanged()) return true;
    report(status, 'Примените новые формулы, чтобы продолжить.', true);
    return false;
  }
  function selectVariant(index, id) {
    const pair = experiment.comparison.slice();
    pair[index] = id || null;
    if (commit({...experiment, comparison: pair})) {
      renderVariantChoices();
      report(variantStatus);
    }
  }
  function loadVariant(id) {
    const variant = getVariant(id);
    if (variant) applyFormulas(variant.formulas);
  }
  function removeVariant(id) {
    if (!getVariant(id)) return;
    if (commit({...experiment, variants: experiment.variants.filter(variant=>variant.id!==id),
      comparison: experiment.comparison.map(value=>id===value?null:value)})) {
      variantTrials.delete(id);
      renderVariantChoices();
      report(variantStatus, 'Вариант удалён.');
    }
  }
  function save() {
    if (!usesAppliedFormulas(variantStatus)) return;
    if (experiment.variants.length>=geometry.limits.maxVariants) {
      report(variantStatus, `Можно сохранить до ${geometry.limits.maxVariants} вариантов.`, true);
      return;
    }
    const name = variantName.value.trim();
    if (!name) {
      report(variantStatus, 'Введите название варианта.', true);
      return;
    }
    const id = `variant-${Date.now().toString(36)}-${(++serial).toString(36)}`;
    const variant = {id, name, formulas: graphPoint?numericFormulas(graphPoint.parameters):experiment.formulas};
    const pair = experiment.comparison.slice(), free = pair.indexOf(null);
    if (free !== -1) pair[free] = id;
    if (commit({...experiment, variants: [...experiment.variants, variant], comparison: pair})) {
      variantName.value = '';
      renderVariantChoices();
      report(variantStatus, 'Вариант сохранён.');
    } else {
      report(variantStatus, 'Не удалось сохранить вариант. Проверьте параметры и число сохранённых вариантов.', true);
    }
  }
  function exportProject() {
    if (!usesAppliedFormulas()) return;
    try {
      const project = graphPoint?geometry.evaluate(numericFormulas(graphPoint.parameters)).project:trial.project;
      const url = URL.createObjectURL(new Blob([JSON.stringify(project)], {type: 'application/json'}));
      const link = element('a', {href: url, download: 'Эксперимент — пластина.json'});
      dialog.append(link);
      link.click();
      link.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 3000);
    } catch (error) {
      report(formulaStatus, error.message, true);
    }
  }
  function syncSweep() {
    for (const option of secondAxis.options) {
      option.disabled = option.value === axis.value;
    }
    if (axis.value === secondAxis.value) secondAxis.value = '';
    const hasSecond = Boolean(secondAxis.value);
    secondRangeFields.hidden = !hasSecond;
    for (const input of Object.values(secondRanges)) input.disabled = !hasSecond;
    drawChart.textContent = hasSecond ? 'Построить тепловую карту' : 'Построить график';
  }
  function defaultRangeFor(key) {
    const {parameters} = trial;
    const value = parameters[key];
    if (key === 'diameter') {
      const cap = Math.min(parameters.length,parameters.width)-.25;
      const end = Math.min(35, Math.floor(cap*10)/10);
      return {from:0,to:Math.max(1,end),step:Math.max(1,Math.round(end/6))};
    }
    const limit = {length:289,width:202,thickness:200}[key];
    const clearance = key === 'thickness' || !parameters.diameter ? 1 : parameters.diameter+.25;
    const from = Math.max(clearance,Math.floor(value*.7));
    const to = Math.min(limit,Math.max(value+1,Math.ceil(value*1.3)));
    return {from,to,step:Math.max(.001,Number(((to-from)/5).toPrecision(3)))};
  }
  const enteredRange = fields => Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.valueAsNumber]));
  axis.addEventListener('change', ()=>{
    setFields(ranges, defaultRangeFor(axis.value));
    syncSweep();
  });
  secondAxis.addEventListener('change', ()=>{
    if (secondAxis.value) setFields(secondRanges, defaultRangeFor(secondAxis.value));
    syncSweep();
  });
  materialsA.addEventListener('change', renderSelection);
  materialsB.addEventListener('change', renderSelection);
  predictionSave.addEventListener('click', ()=>{
    if (!usesAppliedFormulas(chartStatus)) return;
    const text = prediction.value.trim();
    if (!text) {
      report(predictionResult, 'Запишите, как изменится объём и почему.', true);
      return;
    }
    if (!commit({...experiment, prediction:text, predictionPending:true})) return;
    graphPoint = null;
    renderSelection();
    report(chartStatus);
    refreshGraph();
    drawChart.focus({preventScroll:true});
  });
  prediction.addEventListener('input', ()=>{
    if (prediction.value.trim()===experiment.prediction) {
      refreshGraph();
      return;
    }
    hideChart();
    report(predictionResult, 'Запишите прогноз, чтобы затем сравнить его с результатом опыта.');
  });
  prediction.closest('details').addEventListener('toggle', event=>{
    if(event.currentTarget.open||!experiment||!dialog.open||experiment.predictionPending) return;
    prediction.value = experiment.prediction;
    refreshGraph();
  });
  csvButton.addEventListener('click', ()=>{
    if (!seriesRows?.length) return;
    const columns = Object.entries(parameterLabels);
    const table = [
      [...columns.map(([,label])=>label+' (мм)'), 'Объём CAD (мм³)', 'Расчётный объём (мм³)',
        'Удалённый объём CAD (мм³)', 'Расчётный удалённый объём (мм³)', 'Объяснение'],
      ...seriesRows.map(row=>{
        if (!row.error) return [
          ...columns.map(([key])=>row.parameters[key]), row.volume, row.expectedVolume, row.removedVolume,
          row.expectedRemovedVolume, ''
        ];
        return [...columns.map(([key])=>(key===experiment.axis ? row.first : key===experiment.secondAxis ? row.second :
          trial.parameters[key])), null, null, null, null, row.error];
      })
    ];
    const url = URL.createObjectURL(new Blob([window.LabMeasurements.csv(table)], {type:'text/csv;charset=utf-8'}));
    const link = element('a', {href:url, download:'Эксперимент — объёмы.csv'});
    dialog.append(link); link.click(); link.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 3000);
  });
  formulas.addEventListener('submit', event=>{
    event.preventDefault();
    applyFormulas(readFields(formulaFields));
  });
  formulas.addEventListener('input', ()=>{
    report(formulaStatus, formulasChanged()?'Примените формулы, чтобы обновить модель.':'');
  });
  sweep.addEventListener('submit', event=>{
    event.preventDefault();
    if (!usesAppliedFormulas(chartStatus)) return;
    const next = {...experiment, range:enteredRange(ranges), axis:axis.value, secondAxis:secondAxis.value||null,
      secondRange:secondAxis.value ? enteredRange(secondRanges) : experiment.secondRange, predictionPending:false};
    try {
      const rows = chartData(next);
      if (!commit(next)) return;
      graphPoint = null;
      renderSelection();
      displayChart(rows);
    } catch (error) {
      const retained = chart&&!mount.hidden ? ' Показан последний построенный график.' : '';
      report(chartStatus, error.message + retained, true);
    }
  });
  variants.addEventListener('submit', event=>{event.preventDefault(); save();});
  resetPoint.addEventListener('click', ()=>{
    graphPoint = null;
    chart?.select(trial.parameters[experiment.axis]);
    renderSelection();
    download.focus({preventScroll: true});
  });
  download.addEventListener('click', exportProject);
  closeButton.addEventListener('click', ()=>dialog.close());
  dialog.addEventListener('close', ()=>{
    hideChart();
    variantTrials.clear();
    const focus = returnFocus?.getClientRects().length ? returnFocus : document.getElementById('studio-menu-toggle');
    focus?.focus({preventScroll:true});
  });
  function open() {
    if (dialog.open) return;
    returnFocus = document.activeElement;
    experiment = app.getExperiment();
    trial = geometry.evaluate(experiment.formulas);
    graphPoint = null;
    setFields(formulaFields, experiment.formulas);
    setFields(ranges, experiment.range);
    setFields(secondRanges, experiment.secondRange);
    axis.value = experiment.axis;
    secondAxis.value = experiment.secondAxis||'';
    prediction.value = experiment.prediction;
    report(predictionResult);
    syncSweep();
    for (const [key, output] of Object.entries(formulaOutputs)) output.value = `${decimal.format(trial.parameters[key])} мм`;
    variantName.value = '';
    report(formulaStatus);
    report(variantStatus);
    renderPreview();
    refreshExtras();
    renderVariantChoices();
    dialog.showModal();
    closeButton.focus({preventScroll:true});
    refreshGraph();
    dialog.scrollTop = 0;
  }
  window.LabExperimentUI = {open, close:()=>{if(dialog.open)dialog.close();}, active:()=>dialog.open};
})();
