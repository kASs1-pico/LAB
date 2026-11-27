/* Browser-local model exports. STL and 3MF use mm; glTF uses metres. */
(function (global) {
  'use strict';
  function validate(mesh){
    if(!mesh?.positions?.length||mesh.positions.length%9)throw new Error('Сначала создайте 3D-модель.');
    if(mesh.positions.length>18000000)throw new Error('Слишком большая модель для экспорта.');
    for(const value of mesh.positions)if(!Number.isFinite(Math.fround(value)))throw new Error('В модели есть некорректная координата.');
    return mesh.positions.length/9;
  }
  function faceNormal(p,i){
    const ax=p[i+3]-p[i],ay=p[i+4]-p[i+1],az=p[i+5]-p[i+2];
    const bx=p[i+6]-p[i],by=p[i+7]-p[i+1],bz=p[i+8]-p[i+2];
    const n=[ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx],length=Math.hypot(...n)||1;
    return n.map(v=>v/length);
  }
  function stl(mesh){
    const count=validate(mesh),buffer=new ArrayBuffer(84+count*50),view=new DataView(buffer);
    const header=new TextEncoder().encode('Drawing Lab | binary STL | millimetres');new Uint8Array(buffer,0,80).set(header);
    view.setUint32(80,count,true);
    for(let f=0;f<count;f++){
      const offset=84+f*50,index=f*9,n=faceNormal(mesh.positions,index);
      n.forEach((v,j)=>view.setFloat32(offset+j*4,v,true));
      for(let j=0;j<9;j++)view.setFloat32(offset+12+j*4,mesh.positions[index+j],true);
      view.setUint16(offset+48,0,true);
    }
    return new Blob([buffer],{type:'model/stl'});
  }
  function glb(mesh,options={}){
    validate(mesh);
    const positions=new Float32Array(mesh.positions.length),normals=new Float32Array(mesh.positions.length);
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<positions.length;i+=9){
      const n=faceNormal(mesh.positions,i);
      for(let j=0;j<9;j++){positions[i+j]=mesh.positions[i+j]*.001;normals[i+j]=n[j%3];min[j%3]=Math.min(min[j%3],positions[i+j]);max[j%3]=Math.max(max[j%3],positions[i+j]);}
    }
    const kind=['plastic','aluminum','glass'].includes(options.material)?options.material:'plastic';
    const material={name:kind==='aluminum'?'Aluminum':kind==='glass'?'Glass':'Slate blue plastic',pbrMetallicRoughness:{baseColorFactor:kind==='aluminum'?[.72,.77,.82,1]:kind==='glass'?[.72,.83,.94,.3]:[.50,.60,.71,1],metallicFactor:kind==='aluminum'?.9:0,roughnessFactor:kind==='aluminum'?.28:kind==='glass'?.12:.72},doubleSided:kind==='glass'};
    if(kind==='glass')material.alphaMode='BLEND';
    const data={asset:{version:'2.0',generator:'Virtual Drafting Lab',extras:{sourceUnits:'millimetres',units:'metres'}},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Drawing model',mesh:0,rotation:[-Math.SQRT1_2,0,0,Math.SQRT1_2]}],meshes:[{name:'Extruded drawing',primitives:[{attributes:{POSITION:0,NORMAL:1},material:0,mode:4}]}],materials:[material],buffers:[{byteLength:positions.byteLength+normals.byteLength}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.byteLength,target:34962},{buffer:0,byteOffset:positions.byteLength,byteLength:normals.byteLength,target:34962}],accessors:[{bufferView:0,byteOffset:0,componentType:5126,count:positions.length/3,type:'VEC3',min,max},{bufferView:1,byteOffset:0,componentType:5126,count:normals.length/3,type:'VEC3'}],extras:{description:'Closed extruded model. Display section, X-ray and construction animation are not baked into this file.'}};
    const json=new TextEncoder().encode(JSON.stringify(data)),jsonLength=Math.ceil(json.length/4)*4,binLength=positions.byteLength+normals.byteLength,total=12+8+jsonLength+8+binLength;
    const buffer=new ArrayBuffer(total),view=new DataView(buffer),bytes=new Uint8Array(buffer);
    view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,total,true);
    view.setUint32(12,jsonLength,true);view.setUint32(16,0x4e4f534a,true);bytes.fill(0x20,20,20+jsonLength);bytes.set(json,20);
    const binOffset=20+jsonLength;view.setUint32(binOffset,binLength,true);view.setUint32(binOffset+4,0x004e4942,true);
    bytes.set(new Uint8Array(positions.buffer),binOffset+8);bytes.set(new Uint8Array(normals.buffer),binOffset+8+positions.byteLength);
    return new Blob([buffer],{type:'model/gltf-binary'});
  }
  function zipStore(files){
    const encoder=new TextEncoder();
    const entries=files.map(([path,content])=>({name:encoder.encode(path),data:encoder.encode(content)}));
    const localSize=entries.reduce((size,e)=>size+30+e.name.length+e.data.length,0);
    const centralSize=entries.reduce((size,e)=>size+46+e.name.length,0);
    const bytes=new Uint8Array(localSize+centralSize+22),view=new DataView(bytes.buffer);
    const word=(at,value)=>view.setUint16(at,value,true);
    const long=(at,value)=>view.setUint32(at,value,true);
    const table=new Uint32Array(256);
    for(let i=0;i<table.length;i++){
      let value=i;
      for(let bit=0;bit<8;bit++)value=(value&1)?(value>>>1)^0xedb88320:value>>>1;
      table[i]=value;
    }
    let offset=0,directory=localSize;
    for(const {name,data} of entries){
      let crc=0xffffffff;
      for(const value of data)crc=(crc>>>8)^table[(crc^value)&0xff];
      crc^=0xffffffff;
      long(offset,0x04034b50);
      word(offset+4,20);word(offset+6,0x0800);word(offset+12,0x0021);
      long(offset+14,crc);long(offset+18,data.length);long(offset+22,data.length);word(offset+26,name.length);
      bytes.set(name,offset+30);bytes.set(data,offset+30+name.length);

      long(directory,0x02014b50);
      word(directory+4,20);word(directory+6,20);word(directory+8,0x0800);word(directory+14,0x0021);
      long(directory+16,crc);long(directory+20,data.length);long(directory+24,data.length);word(directory+28,name.length);
      long(directory+42,offset);
      bytes.set(name,directory+46);
      offset+=30+name.length+data.length;
      directory+=46+name.length;
    }
    long(directory,0x06054b50);word(directory+8,entries.length);word(directory+10,entries.length);
    long(directory+12,centralSize);long(directory+16,localSize);
    return bytes;
  }
  function escapeXml(value){
    const characters={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'};
    return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').replace(/[&<>"']/g,c=>characters[c]);
  }
  function threeMF(mesh,{material='plastic'}={}){
    validate(mesh);
    const bodies=mesh.bodies?.length?mesh.bodies:[{mesh,name:'Деталь'}];
    const min=[Infinity,Infinity,Infinity];
    for(const body of bodies){
      validate(body.mesh);
      const points=body.mesh.positions;
      for(let i=0;i<points.length;i++)min[i%3]=Math.min(min[i%3],points[i]);
    }
    // Shift the assembly as a whole to the build platform. Relative positions stay intact.
    const offset=min.map(value=>-value);
    const palettes={
      plastic:['#809AB5','#6C88A7','#9CAFC3','#8EA7C0','#57768F'],
      aluminum:['#B8C4D1','#9DAFBD','#D0D9E1','#8FA2B4','#AEBAC9'],
      glass:['#94BFE6','#B3D2EB','#80ADD7','#8AAFD2','#A0C9E9']
    };
    const palette=Object.hasOwn(palettes,material)?palettes[material]:palettes.plastic;
    const bases=bodies.map((body,i)=>`<base name="${escapeXml((body.name||'Деталь')+' · '+(i+1))}" displaycolor="${palette[i%palette.length]}"/>`).join('');
    const objects=bodies.map((body,index)=>{
      const points=body.mesh.positions,keys=new Map(),vertices=[],triangles=[];
      for(let start=0;start<points.length;start+=9){
        const indices=[];
        for(let i=start;i<start+9;i+=3){
          const point=[points[i],points[i+1],points[i+2]];
          const key=point.join(',');
          if(!keys.has(key)){
            keys.set(key,vertices.length);
            vertices.push(`<vertex x="${point[0]}" y="${point[1]}" z="${point[2]}"/>`);
          }
          indices.push(keys.get(key));
        }
        if(new Set(indices).size!==3)continue;
        triangles.push(`<triangle v1="${indices[0]}" v2="${indices[1]}" v3="${indices[2]}"/>`);
      }
      if(!triangles.length)throw new Error('Для одной из деталей нет треугольников.');
      const name=escapeXml(body.name||'Деталь '+(index+1));
      return `<object id="${index+2}" type="model" name="${name}" pid="1" pindex="${index}"><mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object>`;
    }).join('');
    const transform=`1 0 0 0 1 0 0 0 1 ${offset.join(' ')}`;
    const items=bodies.map((_,index)=>`<item objectid="${index+2}" transform="${transform}"/>`).join('');
    const header='<?xml version="1.0" encoding="UTF-8"?>';
    const model=header+`<model unit="millimeter" xml:lang="ru-RU" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">Virtual Drafting Lab</metadata><resources><basematerials id="1">${bases}</basematerials>${objects}</resources><build>${items}</build></model>`;
    const types=header+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
    const relationships=header+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
    return new Blob([zipStore([['[Content_Types].xml',types],['_rels/.rels',relationships],['3D/3dmodel.model',model]])],{type:'model/3mf'});
  }
  const api=Object.freeze({stl,glb,threeMF});global.LabModelExport=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
