'use strict';

importScripts('../../vendor/earcut.js','../model/extrusion-geometry.js','../inspection/inspect-geometry.js','../model/solid-geometry.js','../model/solid-lab-geometry.js',
  '../../vendor/engraving-glyphs.js','../model/assembly-geometry.js','../model/form-geometry.js');

self.onmessage=({data})=>{
  const {strokes,height,bevel,bodies,features}=data;
  let analysis;
  try{
    analysis=self.LabExtrusion.analyze(strokes,{tolerance:8});
    const mesh=analysis.ok?self.LabSolid.build(analysis,{strokes,height,bevel,bodies,features}):null;
    self.postMessage({analysis,mesh});
  }catch(error){
    self.postMessage({analysis,error:error.message||'Не удалось построить объём.'});
  }
};
