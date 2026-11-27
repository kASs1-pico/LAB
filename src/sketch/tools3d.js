/* Local, dependency-free WebGL instrument geometry.
 * Real extruded triangle meshes with surface normals, depth testing and lighting.
 * The oblique orthographic camera preserves the coordinates of the paper plane.
 */
(function () {
  'use strict';
  const DEG = Math.PI / 180;
  const PROJECTION = { x: 0.26, y: -0.46 };
  const VERTEX = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec3 aColor;
    uniform vec2 uPaper;
    varying vec3 vNormal;
    varying vec3 vColor;
    void main() {
      vec2 p = aPosition.xy + vec2(0.26, -0.46) * aPosition.z;
      gl_Position = vec4(p.x / uPaper.x * 2.0 - 1.0,
                        1.0 - p.y / uPaper.y * 2.0,
                        -aPosition.z / 200.0, 1.0);
      vNormal = aNormal;
      vColor = aColor;
    }
  `;
  const FRAGMENT = `
    precision mediump float;
    varying vec3 vNormal;
    varying vec3 vColor;
    uniform float uPlastic;
    void main() {
      vec3 n = normalize(vNormal);
      vec3 light = normalize(vec3(-0.4, -0.65, 1.0));
      float diffuse = max(dot(n, light), 0.0);
      vec3 halfway = normalize(light + vec3(0.0, 0.0, 1.0));
      float shine = pow(max(dot(n, halfway), 0.0), 30.0);
      vec3 color = vColor * (0.70 + 0.30 * diffuse) + vec3(0.14) * shine;
      // A single depth-tested surface is composited with the paper beneath the
      // canvas. Side faces are denser, like the polished edge of smoked plastic.
      float alpha = mix(1.0, mix(0.52, 0.78, 1.0 - abs(n.z)), uPlastic);
      gl_FragColor = vec4(color, alpha);
    }
  `;

  function subtract(a, b) { return a.map((n, i) => n - b[i]); }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function normal(a, b, c) {
    const n = cross(subtract(b, a), subtract(c, a));
    const length = Math.hypot(...n) || 1;
    return n.map(v => v / length);
  }
  function hex(value) { return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255); }
  function position(x, y, z) {
    // Define a part by its projected top-face coordinates; preserve its real Z.
    return [x - PROJECTION.x * z, y - PROJECTION.y * z, z];
  }
  class Mesh {
    constructor() { this.data = []; }
    triangle(a, b, c, color) {
      const n = normal(a, b, c);
      for (const p of [a, b, c]) this.data.push(...p, ...n, ...color);
    }
    quad(a, b, c, d, color) {
      this.triangle(a, b, c, color);
      this.triangle(a, c, d, color);
    }
    prism(points, top, depth, color, bevel = 0) {
      const c = hex(color);
      const upper = points.map(p => position(p[0], p[1], top));
      const lower = upper.map(p => [p[0], p[1], p[2] - depth]);
      for (let i = 1; i < upper.length - 1; i++) {
        this.triangle(upper[0], upper[i], upper[i + 1], c);
        this.triangle(lower[0], lower[i + 1], lower[i], c);
      }
      for (let i = 0; i < upper.length; i++) {
        const j = (i + 1) % upper.length;
        this.quad(upper[i], lower[i], lower[j], upper[j], c);
      }
      return this;
    }
    box(x, y, w, h, top, depth, color) {
      return this.prism([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], top, depth, color);
    }
    cylinder(x, y, radius, top, depth, color, segments = 36) {
      const points = Array.from({ length: segments }, (_, i) => {
        const a = i / segments * Math.PI * 2;
        return [x + Math.cos(a) * radius, y + Math.sin(a) * radius];
      });
      return this.prism(points, top, depth, color);
    }
    beam(a, b, width, za, zb, depth, color) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const length = Math.hypot(dx, dy) || 1;
      const nx = -dy / length * width / 2, ny = dx / length * width / 2;
      const upper = [position(a[0] + nx, a[1] + ny, za), position(a[0] - nx, a[1] - ny, za),
        position(b[0] - nx, b[1] - ny, zb), position(b[0] + nx, b[1] + ny, zb)];
      const lower = upper.map(p => [p[0], p[1], p[2] - depth]);
      const c = hex(color);
      this.quad(...upper, c);
      this.quad(lower[3], lower[2], lower[1], lower[0], c);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        this.quad(upper[i], lower[i], lower[j], upper[j], c);
      }
      return this;
    }
    transform(x, y, angle) {
      const c = Math.cos(angle * DEG), s = Math.sin(angle * DEG);
      for (let i = 0; i < this.data.length; i += 9) {
        const px = this.data[i], py = this.data[i + 1];
        this.data[i] = px * c - py * s + x;
        this.data[i + 1] = px * s + py * c + y;
        const nx = this.data[i + 3], ny = this.data[i + 4];
        this.data[i + 3] = nx * c - ny * s;
        this.data[i + 4] = nx * s + ny * c;
      }
      return this;
    }
  }

  function rulerMesh(r) {
    const mesh = new Mesh();
    const shape = [[-314, 0], [314, 0], [320, 6], [320, 64], [314, 70], [-314, 70], [-320, 64], [-320, 6]];
    mesh.prism(shape, 0, 9, '#aebecf');
    // Raised transparent-plastic bevels are geometry, not a drawn shadow.
    mesh.box(-313, 1, 626, 2, 1.2, 2, '#e4edf5');
    mesh.box(-313, 66, 626, 2, 1.2, 2, '#8fa3b8');
    mesh.box(-319, 7, 2, 56, 1, 2, '#d7e2ec');
    mesh.box(317, 7, 2, 56, 1, 2, '#9cbbcf');
    return mesh.transform(r.x, r.y, r.angle || 0);
  }

  function compassMesh(c) {
    const mesh = new Mesh();
    const angle = (c.angle || 0) * DEG;
    const px = c.radius * Math.cos(angle), py = c.radius * Math.sin(angle);
    const lift = Math.min(110, 72 + c.radius * 0.12);
    const hx = px / 2 + Math.sin(angle) * lift, hy = py / 2 - Math.cos(angle) * lift;
    // The hinge is physically above the paper. Its sloping metal legs terminate
    // at the paper plane; the camera maps their ends to the exact drawing points.
    mesh.beam([0, -6], [hx, hy], 15, 1, 28, 8, '#abb9c7');
    mesh.beam([hx, hy], [px, py - 6], 15, 28, 1, 8, '#c1cbd5');
    mesh.beam([0, -8], [hx - 1, hy - 2], 4, 2, 29, 1.8, '#edf2f7');
    mesh.beam([hx + 1, hy - 2], [px, py - 8], 4, 29, 2, 1.8, '#e4ecf3');
    // Slotted cylindrical hinge with a knurled adjustment handle.
    mesh.beam([hx, hy - 8], [hx, hy - 33], 15, 29, 29, 8, '#566f89');
    for (let y = hy - 31; y < hy - 11; y += 4) mesh.box(hx - 7, y, 14, 1, 30, 1, '#a7bacd');
    mesh.cylinder(hx, hy, 18, 31, 12, '#809ab5');
    mesh.cylinder(hx, hy, 13.5, 32, 2, '#dbe4ec');
    mesh.cylinder(hx, hy, 8, 33, 2, '#a0afbf');
    mesh.box(hx - 5, hy - 1, 10, 2, 33.5, 1, '#45586c');
    // Needle foot and replaceable graphite pencil lead.
    mesh.prism([[-3, -18], [3, -18], [2, -5], [0, 1], [-2, -5]], 2, 5, '#61758b');
    mesh.box(px - 6, py - 32, 12, 22, 3, 7, '#566f89');
    mesh.box(px - 5, py - 32, 3, 20, 4, 2, '#92abc5');
    mesh.prism([[px - 6, py - 10], [px + 6, py - 10], [px, py + 1]], 3, 5, '#d1b292');
    mesh.prism([[px - 2.5, py - 3], [px + 2.5, py - 3], [px, py + 1]], 3.5, 1, '#303f50');
    return mesh.transform(c.x, c.y, 0);
  }

  class Lab3D {
    constructor(canvas) {
      this.canvas = canvas;
      this.supported = false;
      this.lastScene = null;
      try {
        this.gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: false });
        if (!this.gl) return;
        this.initialize();
        canvas.addEventListener('webglcontextlost', event => {
          event.preventDefault();
          this.supported = false;
          canvas.dispatchEvent(new CustomEvent('lab3dchange', { detail: { supported: false } }));
        });
        canvas.addEventListener('webglcontextrestored', () => {
          this.initialize();
          canvas.dispatchEvent(new CustomEvent('lab3dchange', { detail: { supported: true } }));
          if (this.lastScene) this.render(this.lastScene);
        });
      } catch (error) {
        this.supported = false;
        canvas.dispatchEvent(new CustomEvent('lab3dchange', { detail: { supported: false } }));
      }
    }
    initialize() {
      const gl = this.gl;
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        return shader;
      };
      const vertex = compile(gl.VERTEX_SHADER, VERTEX);
      const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
      this.program = gl.createProgram();
      gl.attachShader(this.program, vertex);
      gl.attachShader(this.program, fragment);
      gl.linkProgram(this.program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
      this.buffer = gl.createBuffer();
      this.locations = ['aPosition', 'aNormal', 'aColor'].map(name => gl.getAttribLocation(this.program, name));
      this.paperUniform = gl.getUniformLocation(this.program, 'uPaper');
      this.plasticUniform = gl.getUniformLocation(this.program, 'uPlastic');
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      // Straight-alpha canvas compositing happens once in the browser. Disabling
      // in-canvas blending prevents back/front faces from stacking their tint;
      // depth testing retains only the nearest geometric surface at each pixel.
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      this.supported = true;
    }
    render(scene) {
      this.lastScene = scene;
      if (!this.supported) return;
      const { width, height, tool, ruler, compass } = scene;
      if (!(width > 0 && height > 0)) return;
      const gl = this.gl;
      const rect = this.canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.max(1, Math.round(rect.width * ratio));
      const pixelHeight = Math.max(1, Math.round(rect.height * ratio));
      if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
        this.canvas.width = pixelWidth;
        this.canvas.height = pixelHeight;
      }
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      let mesh;
      if (tool === 'ruler' && ruler) mesh = rulerMesh(ruler);
      else if (tool === 'compass' && compass) mesh = compassMesh(compass);
      else return;
      gl.useProgram(this.program);
      gl.uniform2f(this.paperUniform, width, height);
      gl.uniform1f(this.plasticUniform, tool === 'ruler' ? 1 : 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.data), gl.DYNAMIC_DRAW);
      this.locations.forEach((location, i) => {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 9 * 4, i * 3 * 4);
      });
      gl.drawArrays(gl.TRIANGLES, 0, mesh.data.length / 9);
    }
    dispose() {
      if (this.gl) {
        this.gl.deleteBuffer(this.buffer);
        this.gl.deleteProgram(this.program);
      }
      this.supported = false;
    }
  }
  window.Lab3D = Lab3D;
})();
