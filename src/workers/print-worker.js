'use strict';

importScripts('../inspection/inspect-geometry.js','../drawing/drawing-tools-extra.js','../drawing/drawing-geometry.js','../inspection/print-upgrade.js');

self.onmessage=({data})=>{
  const {kind,mesh,bed,angle}=data;
  try {
    let result;
    if(kind==='orientation')result=self.LabPrintGeometry.orientationOptions(mesh,bed,angle);
    else if(kind==='mesh')result=self.LabPrintGeometry.meshIssues(mesh);
    else throw new Error('Неизвестная проверка печати.');
    self.postMessage({result});
  } catch(error) {
    self.postMessage({error:error.message});
  }
};
