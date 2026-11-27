/* Comparing a measured distance with a nominal value and recording the result. */
(() => {
  'use strict';
  const app=window.LabApp;
  const math=window.LabMeasurements;
  const decimal=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:6});
  const signed=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:6,signDisplay:'exceptZero'});
  const dialog=document.createElement('dialog');
  dialog.id='measurement-journal';
  dialog.className='action-dialog measurement-journal';
  dialog.setAttribute('aria-labelledby','measurement-journal-title');
  document.body.append(dialog);
  let returnFocus;

  function element(tag,props={},children=[]){
    const node=Object.assign(document.createElement(tag),props);
    node.append(...children);
    return node;
  }
  function button(label,action){
    const control=element('button',{type:'button',textContent:label});
    control.addEventListener('click',action);
    return control;
  }
  function field(label,control){
    return element('label',{},[element('span',{textContent:label}),control]);
  }
  function number(id,required=false){
    return element('input',{id,type:'number',min:'0',max:'400000',step:'any',inputMode:'decimal',required});
  }
  function method(sample){
    return sample.kind==='faces'?'Параллельные грани':sample.space==='sketch'?'Точки на листе':'Точки в 3D';
  }
  function amount(value){return `${decimal.format(value)} мм`;}
  function resultLabel(within){return within===null?'':within?'В допуске':'Вне допуска';}
  const asymmetric=limit=>limit!==null&&typeof limit==='object';
  function toleranceLabel(value){
    if(value===null)return '';
    return asymmetric(value)?` −${decimal.format(value.minus)} / +${amount(value.plus)}`:` ± ${amount(value)}`;
  }
  function downloadCSV(name,rows){
    const url=URL.createObjectURL(new Blob([math.csv(rows)],{type:'text/csv;charset=utf-8'}));
    const link=element('a',{href:url,download:name});
    dialog.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),3000);
  }
  function journalCSV(){
    const entries=app.getMeasurementEntries();
    downloadCSV('Журнал измерений.csv',[
      ['Вариант','Дата','Метод','Замер (мм)','Номинал (мм)','Нижний допуск (мм)','Верхний допуск (мм)',
        'Отклонение (мм)','Проверка','Наблюдение'],
      ...entries.map(entry=>{
        const {expected,tolerance,sample}=entry;
        const result=math.compare(sample.value,expected,tolerance);
        return [entry.variant,entry.createdAt,method(sample),sample.value,expected,
          asymmetric(tolerance)?-tolerance.minus:tolerance===null?null:-tolerance,
          asymmetric(tolerance)?tolerance.plus:tolerance,
          result.deviation,resultLabel(result.within),entry.note];
      })
    ]);
  }
  function downloadVariant(entry){
    const project=app.getMeasurementVariant(entry.sample.variantId);
    if(!project)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(project)],{type:'application/json'}));
    const name=entry.variant.replace(/[\\/:*?"<>|]/g,'-');
    const link=element('a',{href:url,download:`${name}.json`});
    dialog.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),3000);
  }
  function updateEntries(list,onRepeat,onChange){
    const entries=app.getMeasurementEntries().slice().reverse();
    list.replaceChildren();
    if(!entries.length){
      list.append(element('p',{textContent:'Записей пока нет.'}));
      return;
    }
    for(const entry of entries){
      const {sample,expected,tolerance}=entry,result=math.compare(sample.value,expected,tolerance);
      const item=element('details',{className:'measurement-entry'});
      const summary=element('summary',{},[
        element('strong',{textContent:entry.variant}),
        element('span',{textContent:`${amount(sample.value)} · Δ ${signed.format(result.deviation)} мм`})
      ]);
      const nominal=tolerance===null?amount(expected):`${decimal.format(expected)}${toleranceLabel(tolerance)}`;
      const wording=resultLabel(result.within);
      const coords=sample.points.map((point,i)=>`${i?'B':'A'} (${point.map(n=>decimal.format(n)).join(' · ')})`).join(' · ');
      const detail=element('p',{textContent:`${method(sample)} · расчёт ${nominal}${wording?' · '+wording:''}`});
      const points=element('p',{textContent:`${coords} мм`});
      const actions=element('div',{className:'measurement-actions'},[
        button('JSON варианта',()=>downloadVariant(entry)),
        button('Проверить допуск',()=>onRepeat(entry)),
        button('Удалить запись',()=>{if(app.removeMeasurementEntry(entry.id))onChange();})
      ]);
      item.append(summary,detail,points);
      if(entry.note)item.append(element('p',{textContent:entry.note}));
      item.append(actions);list.append(item);
    }
  }

  function fitExercise(){
    function input(id,value,tolerance=false){
      const control=number(id,true);
      control.value=String(value);
      if(tolerance)control.min='-400000';
      return control;
    }
    const nominal=input('fit-nominal',20);
    const holeMin=input('fit-hole-min',0,true), holeMax=input('fit-hole-max',.04,true);
    const shaftMin=input('fit-shaft-min',-.03,true), shaftMax=input('fit-shaft-max',-.01,true);
    const result=element('output',{className:'measurement-extra-output'});
    result.setAttribute('aria-live','polite');
    const form=element('form',{className:'measurement-form'},[
      field('Общий номинальный диаметр, мм',nominal),
      element('div',{className:'measurement-fields'},[field('Отверстие · нижнее отклонение',holeMin),
        field('Отверстие · верхнее отклонение',holeMax),field('Вал · нижнее отклонение',shaftMin),
        field('Вал · верхнее отклонение',shaftMax)]),result
    ]);
    function refresh(){
      try{
        const values=math.fitLimits(nominal.valueAsNumber,
          {minus:holeMin.valueAsNumber,plus:holeMax.valueAsNumber},
          {minus:shaftMin.valueAsNumber,plus:shaftMax.valueAsNumber});
        const {holeMin:hm,holeMax:hM,shaftMin:sm,shaftMax:sM,minimum,maximum}=values;
        const type=minimum===0&&maximum===0?'Нулевой зазор':minimum>=0?'Посадка с зазором':
          maximum<=0?'Посадка с натягом':'Возможны зазор и натяг';
        result.textContent=`Отверстие ${decimal.format(hm)}–${amount(hM)} · вал ${decimal.format(sm)}–${amount(sM)}. Разность диаметров от ${signed.format(minimum)} до ${amount(maximum)}. ${type}.`;
      }catch(error){result.textContent=error.message;}
    }
    form.addEventListener('submit',event=>event.preventDefault());
    form.addEventListener('input',refresh);
    refresh();
    return element('details',{className:'measurement-extra'},[
      element('summary',{textContent:'Опыт с валом и отверстием'}),
      element('p',{textContent:'Введите предельные отклонения со знаком. Если разность «отверстие минус вал» отрицательна, получается натяг.'}),form
    ]);
  }

  function seriesReport(){
    const group=element('select',{id:'measurement-series-group'});
    const resolution=element('select',{id:'measurement-series-resolution'},[.01,.02,.05,.1,.5,1].map(value=>
      element('option',{value:String(value),textContent:amount(value)})));
    resolution.value='0.1';
    const result=element('output',{className:'measurement-extra-output'});
    result.setAttribute('aria-live','polite');
    let rows=[];
    const csv=button('CSV серии',()=>{
      downloadCSV('Серия измерений.csv',[
        ['Вариант','Дата','Замер (мм)','Показание прибора (мм)','Цена деления (мм)'],
        ...rows
      ]);
    });
    function update(){
      const samples=app.getMeasurementEntries().filter(entry=>entry.variant===group.value);
      csv.disabled=!samples.length;
      rows=[];
      if(!samples.length){result.textContent='Запишите в журнал несколько замеров под одним названием варианта.';return;}
      const step=Number(resolution.value);
      const values=math.measurementStatistics(samples.map(entry=>entry.sample.value),step);
      rows=samples.map((entry,index)=>[entry.variant,entry.createdAt,entry.sample.value,values.readings[index],step]);
      result.textContent=`Замеров: ${samples.length}. Среднее: ${amount(values.mean)}. Мин.–макс.: ${decimal.format(values.minimum)}–${amount(values.maximum)}. Размах: ${amount(values.range)}.`;
      if(samples.length>1)result.textContent+=` Стандартное отклонение: ${amount(values.deviation)}.`;
      else result.textContent+=' Для разброса нужны ещё замеры.';
    }
    function refresh(){
      const previous=group.value;
      const names=[...new Set(app.getMeasurementEntries().map(entry=>entry.variant))];
      const options=names.length?names:[''];
      group.replaceChildren(...options.map(value=>element('option',{value,textContent:value||'Серий пока нет'})));
      if(names.includes(previous))group.value=previous;
      group.disabled=!names.length;
      update();
    }
    group.addEventListener('change',update);resolution.addEventListener('change',update);
    const controls=element('div',{className:'measurement-fields measurement-form'},[
      field('Вариант',group),field('Цена деления',resolution)
    ]);
    return {refresh, node:element('details',{className:'measurement-extra'},[
      element('summary',{textContent:'Серия повторных замеров'}),
      element('p',{textContent:'Для серии запишите несколько замеров с одним названием варианта. Показания округляются до выбранной цены деления.'}),
      controls,result,element('div',{className:'measurement-actions'},[csv])
    ])};
  }

  function open(value=null,{mode='journal',nominal=null,limit=null}={}){
    const previous=dialog.open?returnFocus:document.activeElement;
    const current=value||window.LabCaliper?.getCurrent();
    window.LabCaliper?.close();
    const checking=mode==='tolerance';
    const choices=app.getMeasurements();
    for(const entry of app.getMeasurementEntries()){
      if(!choices.some(item=>item.id===entry.sample.id))choices.push({...entry.sample,label:entry.variant});
    }
    if(current&&!choices.some(item=>current.id&&item.id===current.id))choices.unshift(current);
    const header=element('h2',{id:'measurement-journal-title',textContent:checking?'Проверка допуска':'Журнал измерений'});
    const close=button('×',()=>dialog.close());
    close.className='dialog-close icon-button';
    close.setAttribute('aria-label','Закрыть');
    const switchMode=button(checking?'Журнал измерений':'Проверка допуска',()=>{
      open(choices[Number(select.value)]||null,{mode:checking?'journal':'tolerance',
        nominal:expected.valueAsNumber,limit:enteredLimit()});
    });
    switchMode.className='measurement-switch';
    const select=element('select',{id:'measurement-sample'});
    if(!choices.length)select.append(element('option',{textContent:'Нет доступных замеров'}));
    choices.forEach((sample,index)=>{
      const value=math.measure(sample).value;
      const title=sample.label||method(sample);
      select.append(element('option',{value:String(index),textContent:`${title} · ${amount(value)}`}));
    });
    if(current?.id){
      const index=choices.findIndex(item=>item.id===current.id);
      if(index>=0)select.value=String(index);
    }
    const expected=number('measurement-expected',true);
    const tolerance=number('measurement-tolerance',checking);
    const asymmetricSwitch=element('input',{id:'measurement-asymmetric',type:'checkbox',checked:asymmetric(limit)});
    const lower=number('measurement-tolerance-lower',true), upper=number('measurement-tolerance-upper',true);
    if(asymmetric(limit)){lower.value=String(limit.minus);upper.value=String(limit.plus);}
    const simpleField=field(checking?'Допуск ±, мм':'Допуск ±, мм (если задан)',tolerance);
    const asymmetricFields=element('div',{className:'measurement-fields'},[
      field('Нижний допуск −, мм',lower),field('Верхний допуск +, мм',upper)
    ]);
    function setToleranceMode(){
      simpleField.hidden=asymmetricSwitch.checked;
      tolerance.disabled=asymmetricSwitch.checked||!choices.length;
      asymmetricFields.hidden=!asymmetricSwitch.checked;
      lower.disabled=upper.disabled=!asymmetricSwitch.checked||!choices.length;
    }
    function enteredLimit(){
      return asymmetricSwitch.checked?{minus:lower.valueAsNumber,plus:upper.valueAsNumber}:
        tolerance.value===''?null:tolerance.valueAsNumber;
    }
    setToleranceMode();
    if(Number.isFinite(nominal))expected.value=String(nominal);
    if(Number.isFinite(limit))tolerance.value=String(limit);
    const variant=element('input',{id:'measurement-variant',type:'text',maxLength:64,required:!checking});
    const names=element('datalist',{id:'measurement-variant-names'});
    variant.setAttribute('list',names.id);
    variant.value=current?.label||`Вариант ${app.getMeasurementEntries().length+1}`;
    const note=element('textarea',{id:'measurement-note',rows:2,maxLength:240});
    const status=element('output',{id:'measurement-comparison'});
    status.setAttribute('aria-live','polite');
    const form=element('form',{className:'measurement-form'},[
      field('Замер',select),
      element('div',{className:'measurement-fields'},[
        field('Расчётное значение, мм',expected),simpleField
      ]),
      element('label',{className:'measurement-checkbox'},[asymmetricSwitch,element('span',{textContent:'Разные допуски сверху и снизу'})]),
      asymmetricFields,
      status
    ]);
    const submit=element('button',{type:'submit',textContent:'Записать в журнал'});
    submit.className='measurement-submit';
    const list=element('div',{id:'measurement-entries'});
    if(!checking)form.append(names,field('Вариант детали или серия',variant),field('Условия или наблюдение',note),submit);
    function refresh(){
      setToleranceMode();
      const sample=choices[Number(select.value)];
      status.removeAttribute('data-result');
      if(!sample){status.textContent='Сделайте замер инструментом «Штангенциркуль», чтобы заполнить форму.';return null;}
      const measured=math.measure(sample).value;
      if(!expected.value){status.textContent=`Измерено ${amount(measured)}. Введите расчётное значение.`;return null;}
      try{
        const allowed=enteredLimit();
        const result=math.compare(measured,expected.valueAsNumber,allowed);
        if(result.within!==null)status.dataset.result=result.within?'pass':'fail';
        const label=resultLabel(result.within);
        status.textContent=`Измерено ${amount(measured)} · отклонение ${signed.format(result.deviation)} мм${label?' · '+label:''}`;
        return {sample,tolerance:allowed};
      }catch(error){status.textContent=error.message;return null;}
    }
    const repeat=entry=>open(entry.sample,{mode:'tolerance',nominal:entry.expected,limit:entry.tolerance});
    const series=checking?null:seriesReport();
    const exportJournal=button('CSV журнала',journalCSV);
    function refreshJournal(){
      updateEntries(list,repeat,refreshJournal);
      const entries=app.getMeasurementEntries();
      names.replaceChildren(...[...new Set(entries.map(entry=>entry.variant))].map(value=>element('option',{value})));
      exportJournal.disabled=!entries.length;
      series?.refresh();
    }
    form.addEventListener('input',refresh);
    form.addEventListener('submit',event=>{
      event.preventDefault();
      if(checking)return;
      const result=refresh();
      if(!result)return;
      const entry=app.addMeasurementEntry(result.sample,{variant:variant.value,expected:expected.valueAsNumber,
        tolerance:result.tolerance,note:note.value});
      if(entry){status.textContent='Замер записан в журнал.';note.value='';refreshJournal();}
      else status.textContent='Запись не сохранена. Проверьте значения и завершите текущую операцию.';
    });
    if(!choices.length)[select,expected,tolerance,asymmetricSwitch,variant,note,submit].forEach(control=>control.disabled=true);
    dialog.replaceChildren(close,header,form,switchMode);
    if(!checking){
      dialog.append(series.node,element('h3',{textContent:'Записи проекта'}),
        element('div',{className:'measurement-actions'},[exportJournal]),list);
      refreshJournal();
    }
    dialog.append(fitExercise());
    refresh();
    returnFocus=previous;
    if(!dialog.open)dialog.showModal();
    (choices.length?select:close).focus({preventScroll:true});
  }
  dialog.addEventListener('close',()=>{
    const focus=returnFocus?.getClientRects().length?returnFocus:
      document.getElementById(app.isModelOpen()?'cad-measure':'tool-launch');
    focus?.focus({preventScroll:true});
  });
  window.LabMeasurementJournal={open,active:()=>dialog.open,close:()=>{if(dialog.open)dialog.close();}};
})();
