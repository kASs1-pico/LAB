/* Measurement records use model coordinates and millimetres. */
(function (global) {
  'use strict';
  const MAX_COORDINATE = 100000;
  const vector = value => Array.isArray(value) && value.length === 3 &&
    value.every(n => Number.isFinite(n) && Math.abs(n) <= MAX_COORDINATE);
  const dot = (a,b) => a.reduce((sum,n,i) => sum+n*b[i],0);
  const difference = (a,b) => b.map((n,i) => n-a[i]);

  function axis(value) {
    if (!vector(value)) throw new Error('Некорректное направление грани.');
    const length = Math.hypot(...value);
    if (length < 1e-9) throw new Error('Некорректное направление грани.');
    return value.map(n => n/length);
  }

  function displayPoints({kind,points,normals}) {
    if (kind !== 'faces') return points;
    const [a,b] = points, normal = axis(normals[0]);
    const distance = dot(difference(a,b),normal);
    return [a,a.map((n,i)=>n+distance*normal[i])];
  }

  function measure(sample) {
    if (!sample || !['sketch','model'].includes(sample.space) ||
        !['points','faces'].includes(sample.kind) ||
        !Array.isArray(sample.points) || sample.points.length!==2 || !sample.points.every(vector)) {
      throw new Error('Для замера нужны две корректные точки.');
    }
    const record = {space:sample.space,kind:sample.kind,points:sample.points.map(point=>point.slice())};
    if (record.space==='sketch' && record.points.some(point=>point[2]!==0)) {
      throw new Error('Точки эскиза должны лежать в плоскости листа.');
    }
    if (record.kind==='faces') {
      if (record.space!=='model' || !Array.isArray(sample.normals) || sample.normals.length!==2) {
        throw new Error('Выберите две плоские грани модели.');
      }
      record.normals=sample.normals.map(axis);
      if (Math.abs(dot(...record.normals))<1-1e-6) throw new Error('Выберите параллельные грани.');
    }
    record.value=Math.hypot(...difference(...displayPoints(record)));
    return record;
  }

  function compare(actual, expected, tolerance = null) {
    const asymmetric = tolerance!==null && typeof tolerance==='object' && !Array.isArray(tolerance);
    const minus = asymmetric ? tolerance.minus : tolerance;
    const plus = asymmetric ? tolerance.plus : tolerance;
    const quantities = tolerance===null ? [actual,expected] : [actual,expected,minus,plus];
    if (quantities.some(value=>!Number.isFinite(value)||value<0||value>MAX_COORDINATE*4)) {
      throw new Error('Введите неотрицательные значения в миллиметрах.');
    }
    const deviation=actual-expected;
    const roundingError=Math.max(1,...quantities)*Number.EPSILON*8;
    const within=tolerance===null?null:deviation>=-minus-roundingError&&deviation<=plus+roundingError;
    return {deviation,within};
  }

  function cleanGap(value) {
    return Math.abs(value)<1e-9?0:Number(value.toPrecision(12));
  }

  function fitLimits(nominal,hole,shaft) {
    const all=[hole?.minus,hole?.plus,shaft?.minus,shaft?.plus];
    if(!Number.isFinite(nominal)||nominal<=0||nominal>MAX_COORDINATE||
      all.some(value=>!Number.isFinite(value)||Math.abs(value)>MAX_COORDINATE)||
      hole.minus>hole.plus||shaft.minus>shaft.plus||nominal+Math.min(...all)<=0) {
      throw new Error('Проверьте номинальный диаметр и порядок предельных отклонений.');
    }
    const [holeMin,holeMax]=[nominal+hole.minus,nominal+hole.plus];
    const [shaftMin,shaftMax]=[nominal+shaft.minus,nominal+shaft.plus];
    return {holeMin,holeMax,shaftMin,shaftMax,
      minimum:cleanGap(holeMin-shaftMax),maximum:cleanGap(holeMax-shaftMin)};
  }

  function measurementStatistics(samples,resolution) {
    if(!Number.isFinite(resolution)||resolution<=0||
      !Array.isArray(samples)||!samples.length||samples.some(value=>!Number.isFinite(value)||value<0)) {
      throw new Error('Для серии нужны замеры и положительная цена деления.');
    }
    const readings=samples.map(value=>Number((Math.round(value/resolution)*resolution).toPrecision(12)));
    const mean=readings.reduce((sum,value)=>sum+value,0)/readings.length;
    const minimum=Math.min(...readings),maximum=Math.max(...readings);
    const deviation=Math.sqrt(readings.reduce((sum,value)=>sum+(value-mean)**2,0)/Math.max(1,readings.length-1));
    return {readings,mean,minimum,maximum,range:cleanGap(maximum-minimum),deviation};
  }

  function csv(rows) {
    const cell=value=>{
      if(value===null||value===undefined)return '';
      if(typeof value==='number')return String(value).replace('.',',');
      const text=String(value);
      const safe=/^\s*[=+\-@\t\r]/u.test(text)?"'"+text:text;
      return '"'+safe.replaceAll('"','""')+'"';
    };
    return '\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n')+'\r\n';
  }

  const api = {measure,displayPoints,compare,fitLimits,measurementStatistics,csv};
  global.LabMeasurements=api;
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
})(typeof window==='undefined'?globalThis:window);
