/* WebGL program, silhouette geometry and transparent triangle ordering. */
(function (global) {
  'use strict';
  const dot=(a,b)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=a=>{const length=Math.hypot(...a);return length>1e-10?a.map(n=>n/length):[0,0,1];};
  function silhouetteEdges(mesh) {
    const pairs = new Map();
    const key = (points, at) => `${Math.round(points[at]*1e5)},${Math.round(points[at+1]*1e5)},${Math.round(points[at+2]*1e5)}`;
    const {positions, normals, bodyIds} = mesh;
    for(let i=0;i<positions.length;i+=9){
      const vertices=[key(positions,i),key(positions,i+3),key(positions,i+6)];
      const normal=Array.from(normals.subarray(i,i+3));
      for(let j=0;j<3;j++){
        const k=(j+1)%3;
        const endpoints=vertices[j]<vertices[k]?[vertices[j],vertices[k]]:[vertices[k],vertices[j]];
        const id=`${bodyIds[i/9]}|${endpoints[0]}|${endpoints[1]}`;
        const edge=pairs.get(id);
        if(edge)edge.other=normal;
        else pairs.set(id,{a:i+j*3,b:i+k*3,normal,other:null});
      }
    }
    return Array.from(pairs.values()).filter(edge=>!edge.other||dot(edge.normal,edge.other)<.99998);
  }
  const strokeCorners = [[0,-1],[0,1],[1,1],[1,1],[0,1],[1,-1]];
  function writeStroke(out,at,points,a,b) {
    // Two triangles, expanded perpendicular to the edge in the vertex shader.
    for(const [reverse,side] of strokeCorners){
      const start=reverse?b:a,end=reverse?a:b;
      for(let i=0;i<3;i++)out[at++]=points[start+i];
      for(let i=0;i<3;i++)out[at++]=points[end+i];
      out[at++]=side;
    }
    return at;
  }
  const VERTEX_SHADER = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec3 aMeta;
    uniform vec3 uCenter;
    uniform mat3 uView;
    uniform vec3 uScale;
    uniform float uHeightScale;
    uniform float uBaseZ;
    uniform vec3 uOffset;
    uniform vec2 uStrokePixel;
    varying vec3 vNormal;
    varying vec3 vObject;
    varying vec3 vMeta;
    void main() {
      vec3 position = aPosition + uOffset;
      vObject = aPosition;
      vMeta = aMeta;
      position.z = uBaseZ + (position.z - uBaseZ) * uHeightScale;
      vec3 p = uView * (position - uCenter);
      gl_Position = vec4(p.xy * uScale.xy, -p.z * uScale.z, 1.0);
      if(uStrokePixel.x > 0.0) {
        vec3 other = aNormal + uOffset;
        other.z = uBaseZ + (other.z - uBaseZ) * uHeightScale;
        vec2 direction = ((uView * (other - position)).xy * uScale.xy) / uStrokePixel;
        float lengthSquared = dot(direction, direction);
        if(lengthSquared > 0.000001) {
          vec2 perpendicular = vec2(-direction.y, direction.x) * inversesqrt(lengthSquared);
          gl_Position.xy += perpendicular * uStrokePixel * aMeta.x;
        }
      }
      vNormal = uView * aNormal;
    }
  `;
  const FRAGMENT_SHADER = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
    #else
      precision mediump float;
    #endif
    varying vec3 vNormal;
    varying vec3 vObject;
    varying vec3 vMeta;
    uniform vec4 uColor;
    uniform bool uUnlit;
    uniform float uClipAxis;
    uniform float uClipValue;
    uniform float uHighlight;
    uniform float uBuildStage;
    uniform float uShine;
    uniform float uSpecular;
    uniform float uGlass;
    uniform float uHatchScale;
    uniform float uTechnical;
    uniform bool uNight;
    uniform bool uAssembly;
    uniform float uFocusBody;
    uniform float uDash;
    uniform vec3 uLightDirection;
    uniform bool uContactHatch;
    void main() {
      float coordinate = uClipAxis < 1.5 ? vObject.x : (uClipAxis < 2.5 ? vObject.y : vObject.z);
      if (uClipAxis > 0.5 && coordinate > uClipValue + 0.0005) discard;
      if (!uUnlit) {
        if (uBuildStage < 0.5) discard;
        if (uBuildStage < 1.5 && vMeta.y > 0.5) discard;
        if (uBuildStage < 2.5 && (vMeta.y > 0.5 && vMeta.y < 1.5)) discard;
      }
      if (uDash > 0.5 && mod(gl_FragCoord.x + gl_FragCoord.y, 12.0) > 6.0) discard;
      if (uContactHatch && mod(gl_FragCoord.x - gl_FragCoord.y, 9.0) > 4.0) discard;
      if (uUnlit) gl_FragColor = uColor;
      else {
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        vec3 light = normalize(uLightDirection);
        float diffuse = max(dot(n, light), 0.0);
        vec3 halfway = normalize(light + vec3(0.0, 0.0, 1.0));
        float highlight = pow(max(dot(n, halfway), 0.0), uShine);
        float fill = max(dot(n, normalize(vec3(0.7, -0.1, 0.5))), 0.0);
        vec3 baseColor = uColor.rgb;
        float shade = mod(max(0.0, vMeta.z) * 3.0, 7.0) / 6.0;
        if(uAssembly && vMeta.z >= 0.0) {
          vec3 tint = mix(vec3(.39, .47, .57), vec3(.74, .83, .92), shade);
          baseColor = mix(baseColor, tint, .66);
        }
        vec3 color = baseColor * (0.64 + diffuse * 0.29 + fill * 0.07) + vec3(uSpecular) * highlight;
        if (vMeta.y > 3.5) {
          color = mix(color, vec3(0.72, 0.79, 0.85), 0.3);
          float stripe = fract((vObject.x + vObject.y + vObject.z) * uHatchScale);
          float hatch = smoothstep(0.82, 0.88, stripe) - smoothstep(0.96, 1.0, stripe);
          color *= 1.0 - hatch * 0.14;
        }
        if (uHighlight > -0.5 && abs(vMeta.x - uHighlight) < 0.25) color = mix(color, vec3(0.74, 0.86, 0.98), 0.58);
        if (uTechnical > 0.5) {
          color = uNight ? vec3(.24,.31,.39) : vec3(.94,.97,.99);
          if(uAssembly && vMeta.z >= 0.0) color += vec3((shade - .5) * .13);
        }
        if (uFocusBody > -0.5 && abs(vMeta.z - uFocusBody) > 0.25) {
          color = mix(color, uNight ? vec3(.17,.22,.30) : vec3(.94,.96,.98), .83);
        }
        float alpha = uColor.a;
        if (uGlass > 0.5) alpha += pow(1.0 - abs(n.z), 3.0) * 0.22;
        gl_FragColor = vec4(color, alpha);
      }
    }
  `;

  function createProgram(gl) {
    function compile(kind, source) {
      const shader = gl.createShader(kind);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(message || 'Model shader compilation failed');
    }
    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    let fragment, program;
    try {
      fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || 'Model shader linking failed');
      }
      return program;
    } catch (error) {
      if (program) gl.deleteProgram(program);
      throw error;
    } finally {
      if (fragment) gl.deleteShader(fragment);
      gl.deleteShader(vertex);
    }
  }

  // Transparent faces are drawn in depth order. Reuse storage while the mesh
  // is unchanged and skip sorting when only camera position or zoom changes.
  class TransparentFaces {
    constructor(mesh) {
      this.mesh = mesh;
      const count = mesh.positions.length / 9;
      this.order = Uint32Array.from({length: count}, (_, i) => i);
      this.depths = new Float64Array(count);
      this.positions = new Float32Array(mesh.positions.length);
      this.normals = new Float32Array(mesh.normals.length);
      this.metadata = new Float32Array(mesh.metadata.length);
      this.direction = null;
    }

    update(view, baseZ, heightScale) {
      const vx = view[2], vy = view[5], vz = view[8];
      const previous = this.direction;
      if (previous && previous[0] === vx && previous[1] === vy && previous[2] === vz &&
          this.baseZ === baseZ && this.heightScale === heightScale) return false;
      const mesh = this.mesh, depths = this.depths;
      for (let face = 0; face < depths.length; face++) {
        let depth = 0;
        for (let i = face * 9, end = i + 9; i < end; i += 3) {
          const z = baseZ + (mesh.positions[i + 2] - baseZ) * heightScale;
          depth += vx * mesh.positions[i] + vy * mesh.positions[i + 1] + vz * z;
        }
        depths[face] = depth;
      }
      this.order.sort((a, b) => depths[a] - depths[b] || a - b);
      for (let face = 0; face < this.order.length; face++) {
        const source = this.order[face] * 9, target = face * 9;
        for (let i = 0; i < 9; i++) {
          this.positions[target + i] = mesh.positions[source + i];
          this.normals[target + i] = mesh.normals[source + i];
          this.metadata[target + i] = mesh.metadata[source + i];
        }
      }
      this.direction = [vx, vy, vz];
      this.baseZ = baseZ;
      this.heightScale = heightScale;
      return true;
    }
  }

  const api = Object.freeze({dot, cross, unit, silhouetteEdges, writeStroke, createProgram, TransparentFaces});
  global.LabModelRendering = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
