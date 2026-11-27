/* Interactive SVG drafting instruments. All coordinates are in paper units (4 units = 1 mm).
   These are shaded SVG illustrations with working handles, not geometric 3D models. */
(function (global) {
  'use strict';

  const RAD = Math.PI / 180;
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const fmt = value => Math.round(finite(value) * 1000) / 1000;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const normalizeAngle = angle => ((finite(angle) % 360) + 360) % 360;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function pointOnCircle(center, radius, angle) {
    const a = finite(angle) * RAD;
    return { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) };
  }

  function projectOnRuler(point, ruler) {
    const a = finite(ruler.angle) * RAD;
    const cos = Math.cos(a), sin = Math.sin(a);
    const t = clamp((point.x - ruler.x) * cos + (point.y - ruler.y) * sin, -320, 320);
    return { x: ruler.x + t * cos, y: ruler.y + t * sin, t };
  }

  function defs() {
    return `<defs>
      <linearGradient id="lab-ruler-glass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f3f7fc" stop-opacity=".40"/>
        <stop offset=".18" stop-color="#b4c5d7" stop-opacity=".46"/>
        <stop offset=".56" stop-color="#c9d6e4" stop-opacity=".35"/>
        <stop offset="1" stop-color="#8dabc5" stop-opacity=".58"/>
      </linearGradient>
      <linearGradient id="lab-ruler-edge" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="#bbcbdc"/><stop offset="1" stop-color="#647e98" stop-opacity=".75"/>
      </linearGradient>
      <linearGradient id="lab-steel" x1="0" y1="0" x2="1" y2="0">
        <stop stop-color="#718297"/><stop offset=".23" stop-color="#d4dee8"/>
        <stop offset=".43" stop-color="#f7faff"/><stop offset=".7" stop-color="#c7d3df"/>
        <stop offset="1" stop-color="#60758a"/>
      </linearGradient>
      <linearGradient id="lab-teal" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#92abc5"/><stop offset=".42" stop-color="#566f89"/>
        <stop offset="1" stop-color="#344b62"/>
      </linearGradient>
      <radialGradient id="lab-knob" cx=".32" cy=".25" r=".85">
        <stop stop-color="#ffffff"/><stop offset=".55" stop-color="#e8eef5"/>
        <stop offset="1" stop-color="#9cacc0"/>
      </radialGradient>
      <filter id="lab-instrument-shadow" x="-40%" y="-60%" width="180%" height="230%">
        <feDropShadow dx="1" dy="7" stdDeviation="5" flood-color="#23384e" flood-opacity=".15"/>
      </filter>
      <filter id="lab-handle-shadow" x="-60%" y="-60%" width="220%" height="230%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#263b52" flood-opacity=".17"/>
      </filter>
    </defs>`;
  }

  // `scale` enlarges handle targets without changing the ruler's measurement geometry.
  function renderRuler(ruler, scale = 1) {
    const x = fmt(ruler.x), y = fmt(ruler.y), angle = fmt(ruler.angle);
    const target = Math.max(1, finite(scale, 1));
    let ticks = '', numbers = '';
    for (let mm = 0; mm <= 160; mm++) {
      const tickX = -320 + mm * 4;
      const length = mm % 10 === 0 ? 20 : mm % 5 === 0 ? 13 : 7;
      ticks += `<path d="M${tickX} 1v${length}"/>`;
      if (mm % 10 === 0) {
        const labelX = mm === 0 ? -312 : mm === 160 ? 312 : tickX;
        const anchor = mm === 0 ? 'start' : mm === 160 ? 'end' : 'middle';
        numbers += `<text x="${labelX}" y="34" text-anchor="${anchor}">${mm / 10}</text>`;
      }
    }
    return `<g class="ruler-instrument" transform="translate(${x} ${y}) rotate(${angle})" aria-label="Линейка: перемещение, поворот и черчение по краю">
      <g filter="url(#lab-instrument-shadow)">
        <rect class="instrument-surface" x="-320" y="5" width="640" height="70" rx="7" fill="url(#lab-ruler-edge)" fill-opacity=".24" pointer-events="none"/>
        <rect class="instrument-surface" data-handle="ruler-move" x="-320" y="0" width="640" height="70" rx="7" fill="url(#lab-ruler-glass)" stroke="#7f94aa" stroke-width="1.2" style="cursor:move"/>
        <path class="instrument-surface" d="M-312 2H312M-312 66H312" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="1.5" pointer-events="none"/>
        <path class="instrument-surface" d="M-314 42H314" stroke="#fff" stroke-opacity=".35" pointer-events="none"/>
        <g fill="none" stroke="#30475f" stroke-opacity=".85" stroke-width=".9" pointer-events="none">${ticks}</g>
        <g fill="#30475f" font-size="12" font-weight="600" font-family="Arial, sans-serif" pointer-events="none">${numbers}</g>
        <text x="-297" y="57" fill="#425c75" font-family="Arial, sans-serif" font-size="9" letter-spacing="1.6" pointer-events="none">ЛАБОРАТОРИЯ</text>
        <text x="295" y="57" text-anchor="end" fill="#425c75" font-family="Arial, sans-serif" font-size="9" letter-spacing="1.2" pointer-events="none">160 ММ</text>
        <g data-handle="ruler-move" style="cursor:move">
          <rect x="-32" y="43" width="64" height="20" rx="10" fill="#f5f9ff" fill-opacity=".4" stroke="#819ab1" stroke-opacity=".35"/>
          <path d="M-13 49v8m6-8v8m6-8v8m6-8v8m6-8v8" stroke="#607d98" stroke-opacity=".6" pointer-events="none"/>
        </g>
      </g>
      <path d="M321 35H350" stroke="#8499af" stroke-width="2" stroke-dasharray="3 3" pointer-events="none"/>
      <g data-handle="ruler-rotate" style="cursor:grab">
        <circle cx="350" cy="35" r="${fmt(23 * target)}" fill="transparent"/>
        <circle cx="350" cy="35" r="18" fill="url(#lab-knob)" stroke="#8da4bb" filter="url(#lab-handle-shadow)"/>
        <path d="M344 39a7 7 0 1 1 12-7m-1-5 1 5-5 1" stroke="#496982" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>
      </g>
      <path d="M-320 0H320" stroke="#658baa" stroke-opacity=".65" stroke-width="2" pointer-events="none"/>
      <path data-handle="ruler-draw" d="M-320 ${fmt(4-12*target)}H320" fill="none" stroke="transparent" stroke-width="${fmt(24 * target)}" style="cursor:crosshair"/>
    </g>`;
  }

  // Compass handles keep their geometric points fixed while the metal arms are shaded above them.
  function renderCompass(compass, scale = 1) {
    const r = Math.max(16, finite(compass.radius, 160));
    const a = finite(compass.angle) * RAD;
    const px = r * Math.cos(a), py = r * Math.sin(a);
    const lift = Math.min(110, 72 + r * .12);
    const hx = px / 2 + Math.sin(a) * lift, hy = py / 2 - Math.cos(a) * lift;
    const target = Math.max(1, finite(scale, 1));
    // Move the radius handle away from the needle-to-pencil baseline. Its 44 px
    // screen-space offset prevents enlarged touch targets from covering each other.
    const offset = 44 * target;
    const rx = px * .6 - Math.sin(a) * offset;
    const ry = py * .6 + Math.cos(a) * offset;
    const footHit = Math.min(24 * target, r * .42);
    const footVisible = Math.max(13, Math.min(17 * target, r * .22));
    const footScale = footVisible / 14;
    const radiusVisible = 17 * target;
    const p = (x, y) => `${fmt(x)} ${fmt(y)}`;
    return `<g class="compass-instrument" transform="translate(${fmt(compass.x)} ${fmt(compass.y)})" aria-label="Циркуль: центр, радиус и карандаш">
      <circle cx="0" cy="0" r="${fmt(r)}" fill="none" stroke="#6d91b2" stroke-opacity=".25" stroke-width="1.2" stroke-dasharray="5 7" pointer-events="none"/>
      <path d="M0 0L${p(px,py)}" stroke="#708da8" stroke-width="1" stroke-opacity=".55" stroke-dasharray="3 5" pointer-events="none"/>
      <path d="M${p(px*.6,py*.6)}L${p(rx,ry)}" stroke="#9badc0" stroke-width="${fmt(target)}" stroke-opacity=".65" stroke-dasharray="${fmt(3*target)} ${fmt(4*target)}" pointer-events="none"/>
      <g class="instrument-surface" data-handle="compass-move" style="cursor:move" filter="url(#lab-instrument-shadow)">
        <path d="M0 -6L${p(hx,hy)}L${p(px,py-6)}" stroke="#7f8fa1" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <path d="M0 -9L${p(hx,hy)}L${p(px,py-9)}" stroke="url(#lab-steel)" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <path d="M${p(hx*.12-1,hy*.12-6)}L${p(hx-1,hy)}L${p(px*.9+hx*.1-1,py*.9+hy*.1-6)}" stroke="#fff" stroke-opacity=".65" stroke-width="1.5" fill="none" pointer-events="none"/>
        <path d="M${p(hx,hy-7)}v-26" stroke="#465d75" stroke-width="15" stroke-linecap="round"/>
        <path d="M${p(hx-2,hy-9)}v-23" stroke="url(#lab-teal)" stroke-width="12" stroke-linecap="round"/>
        <path d="M${p(hx-4,hy-32)}v18" stroke="#b8cedf" stroke-opacity=".65" stroke-width="1.4" pointer-events="none"/>
        <circle cx="${fmt(hx)}" cy="${fmt(hy)}" r="18" fill="url(#lab-teal)" stroke="#3c556d" stroke-width="1"/>
        <circle cx="${fmt(hx)}" cy="${fmt(hy)}" r="8" fill="url(#lab-knob)" stroke="#dce7f1" stroke-width=".8" pointer-events="none"/>
        <path d="M${p(hx-3,hy+3)}l6-6" stroke="#647a92" stroke-width="1.4" pointer-events="none"/>
        <path d="M0 -16v13" stroke="url(#lab-steel)" stroke-width="5"/>
        <path d="M-2 -5L0 1L2 -5" fill="#394d61" pointer-events="none"/>
        <path d="M${p(px,py-32)}v22" stroke="url(#lab-teal)" stroke-width="12" stroke-linecap="round"/>
        <path d="M${p(px-5,py-9)}l5 10 5-10" fill="#d4b08b" stroke="#947d63" stroke-width=".5" pointer-events="none"/>
        <path d="M${p(px-2,py-3)}l2 5 2-5" fill="#273b50" pointer-events="none"/>
      </g>
      <g data-handle="compass-center" style="cursor:move">
        <circle r="${fmt(footHit)}" fill="transparent"/>
        <circle r="${fmt(footVisible)}" fill="#fff" fill-opacity=".92" stroke="#566f89" stroke-width="${fmt(1.4*footScale)}"/>
        <g transform="scale(${fmt(footScale)})" pointer-events="none">
          <path d="M-6 0H6M0 -6V6" stroke="#566f89" stroke-width="1.3"/>
          <circle r="2" fill="#566f89"/>
        </g>
      </g>
      <g data-handle="compass-radius" style="cursor:ew-resize">
        <circle cx="${fmt(rx)}" cy="${fmt(ry)}" r="${fmt(23*target)}" fill="transparent"/>
        <circle cx="${fmt(rx)}" cy="${fmt(ry)}" r="${fmt(radiusVisible)}" fill="url(#lab-knob)" stroke="#97acc2" stroke-width="${fmt(target)}" filter="url(#lab-handle-shadow)"/>
        <text x="${fmt(rx)}" y="${fmt(ry+4.6*target)}" fill="#45617c" font-family="Arial, sans-serif" font-size="${fmt(13*target)}" font-weight="700" text-anchor="middle" pointer-events="none">R</text>
      </g>
      <g data-handle="compass-sweep" style="cursor:crosshair">
        <circle cx="${fmt(px)}" cy="${fmt(py)}" r="${fmt(footHit)}" fill="transparent"/>
        <circle cx="${fmt(px)}" cy="${fmt(py)}" r="${fmt(footVisible)}" fill="#566f89" stroke="#f7faff" stroke-width="${fmt(2*footScale)}" filter="url(#lab-handle-shadow)"/>
        <g transform="translate(${p(px,py)}) scale(${fmt(footScale)})" pointer-events="none">
          <path d="M-4 4l1-4 5-5 3 3-5 5zM1 -4l3 3" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
      </g>
      <g fill="#566f89" font-family="Arial, sans-serif" font-size="10" font-weight="600" pointer-events="none" opacity="${target>1.7 ? 0 : 1}">
        <text x="0" y="32" text-anchor="middle">ЦЕНТР</text>
        <text x="${fmt(rx)}" y="${fmt(ry+33)}" text-anchor="middle">РАДИУС</text>
        <text x="${fmt(px)}" y="${fmt(py+32)}" text-anchor="middle">ЧЕРТИТЬ</text>
      </g>
    </g>`;
  }

  global.LabInstruments = Object.freeze({ defs, renderRuler, renderCompass, projectOnRuler, pointOnCircle, distance, normalizeAngle });
})(typeof window === 'undefined' ? globalThis : window);
