/* Geometry for the offline mechanism exercises and assembly measurements. */
(function (global) {
  'use strict';

  const tau = 2 * Math.PI;
  const rad = Math.PI / 180;
  const eps = 1e-8;
  const circlePoint = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
  const involute = a => Math.tan(a) - a;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

  function gear(module, teeth) {
    if (!Number.isFinite(module) || module < .3 || module > 8 ||
      !Number.isInteger(teeth) || teeth < 17 || teeth > 60) {
      throw new Error('Модуль должен быть от 0,3 до 8 мм, число зубьев — от 17 до 60.');
    }
    const pitch = module * teeth / 2;
    const root = pitch - 1.25 * module;
    const tip = pitch + module;
    const pressure = 20 * rad;
    const base = pitch * Math.cos(pressure);
    const start = Math.max(root, base);
    const half = r => Math.PI / (2 * teeth) + involute(pressure) - involute(Math.acos(Math.min(1, base / r)));
    const radii = Array.from({length: 5}, (_, i) => start + (tip - start) * i / 4);
    const step = tau / teeth;
    const points = [];
    for (let i = 0; i < teeth; i++) {
      const angle = step * i;
      points.push(circlePoint(root, angle - step / 2));
      if (root < start - eps) points.push(circlePoint(root, angle - half(start)));
      for (const r of radii) points.push(circlePoint(r, angle - half(r)));
      for (let j = radii.length - 1; j >= 0; j--) {
        points.push(circlePoint(radii[j], angle + half(radii[j])));
      }
      if (root < start - eps) points.push(circlePoint(root, angle + half(start)));
    }
    return {points, pitch, root, tip, teeth};
  }

  function rack(module, count = 15) {
    if (!Number.isFinite(module) || module <= 0 || !Number.isInteger(count) || count < 2 || count > 120) {
      throw new Error('Укажите положительный модуль и от 2 до 120 зубьев рейки.');
    }
    const pitch = Math.PI * module;
    const tip = pitch / 4 - module * Math.tan(20 * rad);
    const root = pitch / 4 + 1.25 * module * Math.tan(20 * rad);
    const start = -pitch / 2;
    const end = (count - .5) * pitch;
    const points = [[start, 3 * module], [start, 1.25 * module]];
    for (let i = 0; i < count; i++) {
      const x = i * pitch;
      points.push([x - root, 1.25 * module], [x - tip, -module], [x + tip, -module], [x + root, 1.25 * module]);
    }
    points.push([end, 1.25 * module], [end, 3 * module]);
    return points;
  }

  function crank(radius, rod, angle) {
    if (!(rod > radius && radius > 0)) throw new Error('Шатун должен быть длиннее кривошипа.');
    const pin = circlePoint(radius, angle);
    const slider = pin[0] + Math.sqrt((rod - pin[1]) * (rod + pin[1]));
    return {pin, slider, midpoint: [(pin[0] + slider) / 2, pin[1] / 2]};
  }

  function camOutline(radius, rise, lobes, samples = 160) {
    return Array.from({length: samples}, (_, i) => {
      const angle = tau * i / samples;
      const r = radius + rise * (1 + Math.cos(lobes * angle)) / 2;
      return circlePoint(r, angle);
    });
  }

  function cam(outline, rotation, base = 0) {
    const c = Math.cos(rotation), s = Math.sin(rotation);
    const points = outline.map(([x, y]) => [c * x - s * y, s * x + c * y]);
    // A flat horizontal follower touches the highest point of the sampled profile.
    const contact = points.reduce((best, point) => point[1] < best[1] ? point : best);
    return {points, contact, lift: -contact[1] - base};
  }

  function meshCenter(mesh) {
    const closed = mesh?.stats?.closed ??
      (mesh?.positions?.length && global.LabSolid.transformMesh(mesh, p => p).stats.closed);
    if (!closed || !mesh.positions.length) {
      throw new Error('Для расчёта массы каждая деталь должна иметь замкнутую сетку.');
    }
    const positions = mesh.positions;
    const origin = Array.from(positions.slice(0, 3));
    const moment = [0, 0, 0];
    let sixVolume = 0;
    for (let i = 0; i < positions.length; i += 9) {
      const ax = positions[i] - origin[0], ay = positions[i + 1] - origin[1], az = positions[i + 2] - origin[2];
      const bx = positions[i + 3] - origin[0], by = positions[i + 4] - origin[1], bz = positions[i + 5] - origin[2];
      const cx = positions[i + 6] - origin[0], cy = positions[i + 7] - origin[1], cz = positions[i + 8] - origin[2];
      const weight = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
      sixVolume += weight;
      moment[0] += weight * (ax + bx + cx);
      moment[1] += weight * (ay + by + cy);
      moment[2] += weight * (az + bz + cz);
    }
    if (!Number.isFinite(sixVolume) || Math.abs(sixVolume) < eps) {
      throw new Error('Сетка не ограничивает ненулевой объём.');
    }
    return {center: origin.map((coordinate, i) => coordinate + moment[i] / (4 * sixVolume)), volume: Math.abs(sixVolume / 6)};
  }

  function massProperties(parts) {
    if (!parts.length) throw new Error('Постройте хотя бы одну деталь.');
    const components = parts.map(({mesh, density}) => {
      if (!(Number.isFinite(density) && density > 0)) throw new Error('Укажите положительную плотность материала.');
      const geometry = meshCenter(mesh);
      return {...geometry, mass: geometry.volume * density / 1000};
    });
    const mass = components.reduce((sum, part) => sum + part.mass, 0);
    const center = [0, 1, 2].map(i => components.reduce((sum, part) => sum + part.mass * part.center[i], 0) / mass);
    return {mass, center, components};
  }

  function convexHull(points) {
    const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const unique = sorted.filter((p, i) => !i || p[0] !== sorted[i - 1][0] || p[1] !== sorted[i - 1][1]);
    if (unique.length < 3) return unique;
    function chain(sequence) {
      const out = [];
      for (const point of sequence) {
        while (out.length > 1 && cross(out.at(-2), out.at(-1), point) <= eps) out.pop();
        out.push(point);
      }
      return out.slice(0, -1);
    }
    return chain(unique).concat(chain(unique.reverse()));
  }

  function stability(parts, center) {
    const z = Math.min(...parts.map(part => part.mesh.bounds.min[2]));
    const points = [];
    for (const {mesh} of parts) {
      if (mesh.bounds.min[2] > z + .01) continue;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        if (mesh.positions[i + 2] <= z + .01) points.push([mesh.positions[i], mesh.positions[i + 1]]);
      }
    }
    const hull = convexHull(points);
    if (hull.length < 3) return {hull, z, margin: null, tilt: null};
    const margin = Math.min(...hull.map((p, i) => {
      const q = hull[(i + 1) % hull.length];
      return cross(p, q, center) / Math.hypot(q[0] - p[0], q[1] - p[1]);
    }));
    const tilt = Math.atan2(Math.max(0, margin), Math.max(eps, center[2] - z)) / rad;
    return {hull, z, margin, tilt};
  }

  function cylinder(kernel, start, axis, radius, length) {
    const basis = global.LabAssemblyGeometry.frame(start, axis);
    const out = kernel.createMeshBuilder();
    const local = (i, z) => {
      const p = circlePoint(radius, i * tau / 40);
      return basis.world(p[0], p[1], z);
    };
    const top = basis.world(0, 0, length);
    for (let i = 0; i < 40; i++) {
      const a = local(i, 0), b = local(i + 1, 0);
      const c = local(i + 1, length), d = local(i, length);
      out.quad(a, b, c, d);
      out.triangle(start, b, a);
      out.triangle(top, d, c);
    }
    return out.finish();
  }

  const puzzle = Object.freeze({
    width: 12, height: 10, step: .5,
    initial: {x: 2.5, y: 3, angle: 90},
    pieces: [
      {x: -1.8, y: -.35, w: 3.6, h: .7},
      {x: -.35, y: -.35, w: .7, h: 1.7}
    ],
    walls: [
      {x: -.5, y: 0, w: 1, h: 10},
      {x: 0, y: -.5, w: 13, h: 1},
      {x: 0, y: 9.5, w: 13, h: 1},
      {x: 5, y: 0, w: .55, h: 2.1},
      {x: 5, y: 4.6, w: .55, h: 5.4},
      {x: 11.5, y: 0, w: .55, h: 4.45},
      {x: 11.5, y: 7, w: .55, h: 3}
    ]
  });

  function puzzlePolygons(pose) {
    const c = Math.cos(pose.angle * rad), s = Math.sin(pose.angle * rad);
    return puzzle.pieces.map(({x, y, w, h}) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
      .map(([u, v]) => [pose.x + c * u - s * v, pose.y + s * u + c * v]));
  }

  function hitsRectangle(polygon, {x, y, w, h}) {
    const rectangle = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    const axes = [[1, 0], [0, 1], ...[0, 1].map(i => [
      polygon[i + 1][1] - polygon[i][1], polygon[i][0] - polygon[i + 1][0]
    ])];
    return axes.every(([u, v]) => {
      const project = points => points.map(([x, y]) => u * x + v * y);
      const p = project(polygon), q = project(rectangle);
      return Math.max(...p) > Math.min(...q) + eps && Math.max(...q) > Math.min(...p) + eps;
    });
  }

  function puzzleMove(pose, action) {
    const [x, y, angle] = action;
    const steps = Math.max(1, Math.ceil(Math.hypot(x, y) / .06), Math.ceil(Math.abs(angle) / 3));
    for (let i = 1; i <= steps; i++) {
      const part = i / steps;
      const next = {x: pose.x + x * part, y: pose.y + y * part, angle: pose.angle + angle * part};
      const polygons = puzzlePolygons(next);
      const hit = puzzle.walls.findIndex(wall => polygons.some(poly => hitsRectangle(poly, wall)));
      if (hit !== -1) return {pose, hit, escaped: false};
    }
    const next = {x: pose.x + x, y: pose.y + y, angle: (pose.angle + angle + 360) % 360};
    const escaped = puzzlePolygons(next).every(poly => poly.every(([x]) => x > puzzle.width + .05));
    return {pose: next, hit: -1, escaped};
  }

  const api = Object.freeze({gear, rack, crank, camOutline, cam, massProperties, stability, cylinder, puzzle, puzzlePolygons, puzzleMove});
  global.LabMechanismGeometry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
