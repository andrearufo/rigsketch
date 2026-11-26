// Rigsketch renderer.
// Pure functions that turn rig data into SVG markup strings. No DOM access, so the
// same code draws the editor, the SVG/PNG exports, and runs in Node (test/check.mjs).
//
// Every asset is sized in multiples of the 20 px grid and its jacks sit on grid lines,
// so items snap cleanly and cables can be routed on the grid (see route.js).

import { routeCables, simplify } from './route.js';

export const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const f = n => Math.round(n * 10) / 10;
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const range = n => [...Array(n).keys()];

// ---------- colours ----------
const GRADIENTS = { sunburst: '#6b3414', cherryburst: '#7a1f12', tobacco: '#4a2410' };
export const FINISHES = {
  Sunburst: 'sunburst', 'Cherry sunburst': 'cherryburst', 'Tobacco burst': 'tobacco',
  Black: '#141414', 'Olympic white': '#ece8da', 'Vintage white': '#e9e2c8', 'Fiesta red': '#d2382f',
  'Candy apple red': '#a0141e', Cherry: '#7a1414', 'Sonic blue': '#8fc3d9', 'Lake placid blue': '#2f4f8f',
  'Surf green': '#7fc6a4', 'Shell pink': '#efc3b6', Butterscotch: '#e4b260', Natural: '#e2c28c',
  'Gold top': '#c9a646', Silver: '#b9bdc2', Orange: '#d0611d',
};
const paint = c => (GRADIENTS[c] ? `url(#rs-${c})` : c);
const rgb = c => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(GRADIENTS[c] || c || '');
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map(x => x + x).join('') : m[1];
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};
export function shade(c, amt) {
  const v = rgb(c);
  if (!v) return '#555555';
  const t = amt < 0 ? 0 : 255, a = Math.abs(amt);
  return '#' + v.map(x => Math.round(x + (t - x) * a).toString(16).padStart(2, '0')).join('');
}
const lum = c => { const v = rgb(c); return v ? v[0] * .299 + v[1] * .587 + v[2] * .114 : 128; };
const knobFor = c => (lum(c) > 70 ? '#151515' : '#5a5d63');

// Burst gradients are centred low on the body. Guitars are drawn with y pointing up
// (see guitar()), which flips objectBoundingBox gradients, hence cy below .5.
export const DEFS = `<defs>
<radialGradient id="rs-sunburst" cx=".5" cy=".4" r=".62"><stop offset=".3" stop-color="#f2b53e"/><stop offset=".68" stop-color="#b0501c"/><stop offset="1" stop-color="#1f0d05"/></radialGradient>
<radialGradient id="rs-cherryburst" cx=".5" cy=".4" r=".62"><stop offset=".3" stop-color="#eda04a"/><stop offset=".66" stop-color="#b52a1c"/><stop offset="1" stop-color="#3a0a06"/></radialGradient>
<radialGradient id="rs-tobacco" cx=".5" cy=".4" r=".62"><stop offset=".3" stop-color="#d49a4a"/><stop offset=".66" stop-color="#6a3414"/><stop offset="1" stop-color="#140904"/></radialGradient>
<radialGradient id="rs-gloss" cx=".36" cy=".7" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".32"/><stop offset=".55" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></radialGradient>
<linearGradient id="rs-sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".14"/></linearGradient>
<linearGradient id="rs-chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f7f9"/><stop offset=".5" stop-color="#c3c8ce"/><stop offset="1" stop-color="#8d949c"/></linearGradient>
<pattern id="rs-cloth" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 4L4 0M-1 1L1 -1M3 5L5 3" stroke="#fff" stroke-opacity=".09"/></pattern>
<pattern id="rs-diamond" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M7 0L14 7L7 14L0 7Z" fill="none" stroke="#fff" stroke-opacity=".16"/></pattern>
<pattern id="rs-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="1.1" fill="#000" fill-opacity=".16"/></pattern>
</defs>`;

// ---------- primitives ----------
const NS = ' vector-effect="non-scaling-stroke"';
const line = (c = '#111', w = 1.6) => ` stroke="${c}" stroke-width="${w}"${NS}`;
const R = (x, y, w, h, fill, rx = 0, extra = '') =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${rx ? ` rx="${rx}"` : ''} fill="${fill}"${extra}/>`;
const C = (x, y, r, fill, extra = '') => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${fill}"${extra}/>`;
const L = (x1, y1, x2, y2, stroke, w = 1, extra = '') =>
  `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${stroke}" stroke-width="${w}"${extra}/>`;
const P = (d, fill, extra = '') => `<path d="${d}" fill="${fill}"${extra}/>`;
function T(x, y, s, size, fill, o = {}) {
  return `<text x="${f(x)}" y="${f(y)}" font-size="${f(size)}" fill="${fill}" text-anchor="${o.anchor || 'middle'}" font-weight="${o.weight || 700}"${o.ls ? ` letter-spacing="${o.ls}"` : ''}${o.italic ? ' font-style="italic"' : ''}${o.extra || ''}>${esc(s)}</text>`;
}
const fitText = (s, maxW, max) => Math.min(max, maxW / (Math.max(1, String(s).length) * .64));
const knob = (x, y, r, fill = '#151515', mark = '#fff') =>
  C(x, y, r, fill, line('#000', 1.2)) + C(x - r * .3, y - r * .3, r * .35, '#fff', ' fill-opacity=".18"') + L(x, y, x, y - r * .78, mark, Math.max(1.2, r / 4.5), ' stroke-linecap="round"');
const foot = (x, y, r = 8) =>
  C(x, y, r, 'url(#rs-chrome)', line('#111', 1.2)) + C(x, y, r * .55, '#e7eaee', line('#7c838b', .8));
const led = (x, y, c = '#e53935') => C(x, y, 2.6, c, line('#000', .8));
const sideJacks = (w, y) => ({ in: { x: w, y, dx: 1, dy: 0 }, out: { x: 0, y, dx: -1, dy: 0 } });
const shell = (w, h, c, rx = 6) => R(0, 0, w, h, c, rx, line('#111', 2)) + R(0, 0, w, h, 'url(#rs-sheen)', rx);

// ---------- guitars ----------
// Drawn in real millimetres: x across the body (bass side negative), y up from the
// butt end, scaled by K. Shapes follow the published body dimensions of each model.
const K = .45;
const STRAT = 'M-28 340C-32 368-50 398-66 410C-74 416-84 414-92 408C-112 394-136 372-146 340C-152 318-150 300-144 280C-138 258-138 238-142 215C-148 180-165 150-162 105C-158 40-90 0 0 0C90 0 160 40 162 105C164 150 140 185 136 222C133 252 146 280 144 306C142 330 128 352 108 368C98 376 88 384 80 380C68 374 56 350 42 330C36 322 32 318 28 316Z';
const STRAT_GUARD = 'M-28 330C-70 338-108 318-114 278C-120 236-100 196-98 160C-96 120-84 92-50 84L40 70C80 52 118 70 122 108C126 150 114 180 112 216C110 254 118 284 96 306C76 324 52 326 28 318Z';
const OFFSET = 'M-28 340C-34 375-55 412-74 426C-84 432-96 430-104 424C-128 404-152 380-160 348C-166 320-150 296-150 270C-150 240-178 210-176 150C-174 60-110 5-20 0C70-5 150 30 166 110C174 160 158 200 150 235C143 262 150 286 144 310C138 334 120 350 102 356C90 360 76 356 64 344C52 332 40 320 28 316Z';
const JM_GUARD = 'M-28 340C-80 350-130 345-140 300C-148 262-140 232-148 192C-155 150-140 112-95 96L60 80C110 72 148 100 148 150C148 200 128 230 128 270C128 300 110 318 70 318L28 315Z';
const TOM = (y = 115) => [['r', 0, y, 80, 12, 3, 'hw'], ['r', 0, y - 37, 92, 14, 7, 'hw']];

const GSHAPES = {
  strat: {
    w: 160, h: 440, scale: 648, bridge: 100, heel: 282, frets: 21, body: STRAT, guard: STRAT_GUARD, knob: '#f1efe8',
    parts: [['r', 0, 97, 74, 36, 3, 'hw'], ['r', 0, 104, 62, 10, 2, '#b9bfc6'], ['c', 92, 210, 6, '#f1efe8']],
    pickups: [['s', 260], ['s', 197], ['s', 141, -8]], knobs: [[52, 175], [66, 138], [76, 103]],
    jack: { x: 125, y: 400, face: true },
  },
  tele: {
    w: 160, h: 420, scale: 648, bridge: 65, heel: 250, frets: 21, guardColor: '#151515',
    body: 'M-28 345C-30 385-60 406-95 404C-135 402-158 370-160 320C-162 270-150 240-150 210C-150 180-165 150-162 100C-158 35-95 0 0 0C95 0 158 35 162 100C165 150 150 180 150 215C150 250 158 270 150 290C140 320 105 330 80 320C55 310 36 300 28 300Z',
    guard: 'M-28 342C-70 350-110 338-118 298C-125 255-110 220-80 200C-50 185-20 190 34 198L40 260C40 285 34 300 28 302Z',
    parts: [['r', 0, 95, 82, 110, 6, 'hw'], ['r', 0, 65, 66, 10, 2, '#b9bfc6'], ['r', 108, 105, 32, 125, 16, 'hw', 18], ['c', 96, 143, 5, '#151515']],
    pickups: [['s', 228, 0, 'url(#rs-chrome)'], ['s', 110, -8]], knobs: [[108, 105], [120, 69]],
    jack: { x: 153, y: 360 },
  },
  lespaul: {
    w: 160, h: 440, scale: 628, bridge: 115, heel: 282, frets: 22, head: 'gibson', guardColor: '#efe6cf', knob: '#c8962e',
    body: 'M-28 365C-30 405-55 440-92 440C-130 440-152 408-152 365C-152 325-132 300-134 265C-136 232-167 195-165 140C-162 55-95 0 0 0C95 0 162 55 165 140C167 195 140 232 136 268C133 300 142 330 132 362C124 385 110 398 98 396C84 393 74 375 62 366C50 356 38 352 28 352Z',
    guard: 'M46 210C50 260 52 320 58 352C72 362 90 372 100 360C112 330 100 270 80 230C70 210 58 200 46 210Z',
    parts: [...TOM(), ['c', -110, 395, 8, '#efe6cf'], ['c', -110, 395, 3, '#151515']],
    pickups: [['h', 255], ['h', 160]], knobs: [[72, 135], [118, 150], [84, 90], [128, 108]],
    jack: { x: 154, y: 380 },
  },
  sg: {
    w: 160, h: 440, scale: 628, bridge: 110, heel: 286, frets: 22, head: 'gibson', knob: '#c8962e',
    body: 'M-28 305C-36 335-62 375-96 402L-108 410C-116 412-124 404-124 394C-124 360-128 320-124 290C-121 262-162 215-162 150C-162 60-95 0 0 0C95 0 162 60 162 150C162 215 121 262 124 290C128 320 124 360 124 394C124 404 116 412 108 410L96 402C62 375 36 335 28 305Z',
    parts: TOM(110), pickups: [['h', 258], ['h', 158]], knobs: [[62, 150], [104, 160], [72, 105], [114, 118]],
    jack: { x: 124, y: 400, face: true },
  },
  semihollow: {
    w: 200, h: 460, scale: 628, bridge: 150, heel: 320, frets: 22, head: 'gibson', guardColor: '#151515', knob: '#c8962e',
    body: 'M-28 395C-34 425-60 470-105 472C-150 474-180 440-182 395C-184 350-160 320-162 285C-164 250-200 210-200 150C-198 55-110 0 0 0C110 0 198 55 200 150C200 210 164 250 162 285C160 320 184 350 182 395C180 440 150 474 105 472C60 470 34 425 28 395Z',
    guard: 'M50 300C70 330 110 360 130 350C150 340 140 300 110 260C90 240 60 250 50 300Z',
    parts: [
      ['p', 'M-120 280C-142 240-100 200-125 150', 'none', '#111', 3], ['p', 'M120 280C142 240 100 200 125 150', 'none', '#111', 3],
      ['c', -120, 280, 5, '#111'], ['c', -125, 150, 5, '#111'], ['c', 120, 280, 5, '#111'], ['c', 125, 150, 5, '#111'],
      ...TOM(150), ['c', 140, 330, 8, '#efe6cf'], ['c', 140, 330, 3, '#151515'],
    ],
    pickups: [['h', 300], ['h', 195]], knobs: [[95, 125], [140, 145], [105, 75], [150, 95]],
    jack: { x: 158, y: 420, face: true },
  },
  prs: {
    w: 160, h: 440, scale: 635, bridge: 95, heel: 250, frets: 24, head: 'gibson', knob: '#d4b35a',
    body: 'M-28 336C-32 366-52 396-72 404C-96 414-128 398-142 366C-152 340-140 300-138 262C-136 226-165 185-163 135C-160 50-95 0 0 0C95 0 160 50 163 135C165 185 138 222 136 255C134 285 146 312 136 336C126 358 108 372 90 370C70 368 52 345 28 320Z',
    parts: [['r', 0, 95, 80, 24, 4, 'hw'], ['c', 115, 140, 5, '#151515']],
    pickups: [['h', 225], ['h', 140]], knobs: [[80, 110], [108, 80]],
    jack: { x: 153, y: 380 },
  },
  offset: {
    w: 160, h: 440, scale: 648, bridge: 105, heel: 290, frets: 21, body: OFFSET, guard: JM_GUARD, guardColor: '#5b2a17',
    parts: [['r', 0, 105, 70, 14, 4, 'hw'], ['r', 0, 45, 96, 40, 10, 'hw'], ['r', -120, 300, 60, 22, 6, 'hw']],
    pickups: [['jm', 255], ['jm', 150]], knobs: [[95, 155], [118, 120]],
    jack: { x: 132, y: 400, face: true },
  },
  explorer: {
    w: 220, h: 460, scale: 628, bridge: 115, heel: 291, frets: 22, head: 'pointy',
    body: 'M-28 390L-225 70Q-232 40-205 36L20 36L160 150L215 300Q222 330 205 345L150 300L110 330Q70 360 28 360Z',
    parts: TOM(), pickups: [['h', 255], ['h', 160]], knobs: [[50, 140], [80, 115], [110, 145]],
    jack: { x: 178, y: 360, face: true },
  },
  flyingv: {
    w: 200, h: 500, scale: 628, bridge: 240, heel: 410, frets: 22, head: 'gibson',
    body: 'M-28 440L-205 20Q-208 0-186 0L-150 0L0 200L150 0L186 0Q208 0 205 20L28 440Z',
    parts: [['r', 0, 240, 80, 12, 3, 'hw'], ['p', 'M-40 228L0 210L40 228L40 218L0 202L-40 218Z', 'hw', '#111', 1]],
    pickups: [['h', 380], ['h', 290]], knobs: [[95, 130], [115, 95], [135, 60]],
    jack: { x: 174, y: 480, face: true },
  },
  dread: {
    w: 200, h: 500, scale: 645, bridge: 218, heel: 415, frets: 20, head: 'acoustic', guardColor: '#5b2a17',
    body: 'M-30 505C-90 512-140 495-146 440C-150 400-132 375-134 340C-136 300-198 260-199 170C-200 70-120 0 0 0C120 0 200 70 199 170C198 260 136 300 134 340C132 375 150 400 146 440C140 495 90 512 30 505Z',
    guard: 'M55 330C70 300 115 290 130 320C145 350 135 400 100 410C75 418 55 390 55 360Z',
    parts: [['o', 0, 360, 62, '#3a2a1a', 3], ['c', 0, 360, 50, '#1a110b'], ['r', 0, 218, 150, 32, 10, '#2a1a10'], ['r', 0, 224, 70, 4, 1, '#f1efe8']],
    pickups: [], knobs: [], jack: { x: 163, y: 460, face: true },
  },
  pbass: {
    w: 160, h: 540, scale: 864, bridge: 80, heel: 340, frets: 20, head: 'bass', strings: 4, body: STRAT, guard: STRAT_GUARD, guardColor: '#5b2a17',
    parts: [['r', 0, 75, 80, 30, 3, 'hw'], ['r', 95, 110, 34, 110, 17, 'hw']],
    pickups: [['p', 230]], knobs: [[95, 140], [95, 100]],
    jack: { x: 123, y: 500, face: true },
  },
  jbass: {
    w: 160, h: 540, scale: 864, bridge: 80, heel: 340, frets: 20, head: 'bass', strings: 4, body: OFFSET, guard: JM_GUARD, guardColor: '#5b2a17',
    parts: [['r', 0, 75, 80, 30, 3, 'hw'], ['r', 100, 115, 34, 130, 17, 'hw']],
    pickups: [['j', 200], ['j', 125]], knobs: [[100, 160], [100, 128], [100, 96]],
    jack: { x: 125, y: 500, face: true },
  },
};

const HW = { chrome: 'url(#rs-chrome)', gold: '#d4b35a', black: '#1d1d1d' };
const HEAD_COLOR = { fender: '#e3c48d', bass: '#e3c48d', gibson: '#141414', acoustic: '#1e130c' };
const key = (x, y, hw, r = 0) => (r ? C(x, y, r, hw, line('#111', 1)) : R(x - 9, y - 5.5, 18, 11, hw, 5, line('#111', 1)));
const post = (x, y) => C(x, y, 4.5, '#dfe3e8', line('#111', .8));
// Headstocks, in mm with y up from the nut. `edge(y)` is the outline's x on the key side.
const HEADS = {
  fender: { d: 'M-21 0C-22 40-27 110-30 150C-32 172-24 190-6 192C12 194 34 188 40 172C44 160 36 150 26 145C16 138 18 120 22 100C26 75 22 30 21 0Z', ys: range(6).map(i => 30 + i * 25), edge: y => -21 - y * .06 },
  gibson: { d: 'M-22 0L-32 40L-46 168C-47 182-37 190-26 186L0 176L26 186C37 190 47 182 46 168L32 40L22 0Z', ys: [55, 100, 145], edge: y => -32 - (y - 40) * .11, both: true },
  bass: { d: 'M-22 0C-24 50-30 140-34 180C-36 202-26 220-6 222C14 224 38 216 44 198C48 184 38 172 28 166C18 158 20 138 24 112C28 80 23 30 22 0Z', ys: [35, 80, 125, 170], edge: y => -22 - y * .065, big: true },
  pointy: { d: 'M-21 0L-21 30L-50 205C-52 216-40 222-32 212L30 90C38 70 26 30 21 0Z', ys: range(6).map(i => 45 + i * 28), edge: y => -21 - Math.max(0, y - 30) * .166 },
  acoustic: { d: 'M-26 0L-32 175C-32 188-22 195 0 195C22 195 32 188 32 175L26 0Z', ys: [45, 95, 145], edge: y => -26 - y * .034, both: true },
};
function headstock(type, c, hw) {
  const H = HEADS[type];
  let s = P(H.d, c, line());
  for (const y of H.ys) {
    const e = H.edge(y);
    s += key(e - (H.big ? 14 : 11), y, hw, H.big ? 11 : 0) + post(e + 10, y);
    if (H.both) s += key(-e + 11, y, hw) + post(-e - 10, y);
  }
  return s;
}

function prim(list, ctx) {
  const col = v => (v === 'hw' ? ctx.hw : v === 'guard' ? ctx.guard : v);
  return (list || []).map(([t, ...a]) => {
    if (t === 'r') {
      const [x, y, w, h, rx, fill, rot] = a;
      return R(x - w / 2, y - h / 2, w, h, col(fill), rx, line('#111', 1) + (rot ? ` transform="rotate(${rot} ${x} ${y})"` : ''));
    }
    if (t === 'c') return C(a[0], a[1], a[2], col(a[3]), line('#111', .8));
    if (t === 'o') return C(a[0], a[1], a[2], 'none', line(col(a[3]), a[4]));
    if (t === 'p') return P(a[0], col(a[1]), line(col(a[2] || 'none'), a[3] || 0) + ' stroke-linecap="round"');
    return '';
  }).join('');
}

function pickup([t, y, a = 0, col], p) {
  const c = col || p.pickupColor || (t === 'h' ? '#151515' : '#f1efe8');
  const poles = py => (c.startsWith('url') ? '' : range(6).map(i => C(-25 + i * 10, py, 2.6, '#9aa0a7')).join(''));
  let g;
  if (t === 'h') g = (p.ring ? R(-42, y - 24, 84, 48, p.ring, 6, line('#111', 1)) : '') + R(-35, y - 19, 70, 38, c, 4, line('#111', 1)) + poles(y - 9) + poles(y + 9);
  else if (t === 'p') g = R(-48, y, 48, 20, c, 6, line('#111', 1)) + R(0, y - 22, 48, 20, c, 6, line('#111', 1));
  else if (t === 'j') g = R(-47, y - 10, 94, 20, c, 7, line('#111', 1));
  else if (t === 'jm') g = R(-44, y - 22, 88, 44, c, 7, line('#111', 1)) + poles(y);
  else g = R(-35, y - 9, 70, 18, c, 9, line('#111', 1)) + poles(y);
  return a ? `<g transform="rotate(${a} 0 ${y})">${g}</g>` : g;
}

function guitar(p) {
  const S = GSHAPES[p.shape] || GSHAPES.strat, { w, h } = S;
  const color = p.color || '#1a1a1a', hw = HW[p.hardware] || HW.chrome;
  const ctx = { hw, guard: p.guard || S.guardColor || '#f1efe8' };
  const nut = S.bridge + S.scale, n = S.strings || 6, head = HEADS[p.head] ? p.head : (S.head || 'fender');
  let s = `<g transform="translate(${w / 2} ${h - 10}) scale(${K} ${-K})">`;
  s += P(S.body, paint(color), line('#111', p.binding ? 4 : 2.2));
  if (p.binding) s += P(S.body, 'none', line(p.binding, 1.6));
  s += P(S.body, 'url(#rs-gloss)');
  if (S.guard && p.guard !== false) s += P(S.guard, ctx.guard, line('#111', 1.2));
  s += prim(S.parts, ctx);
  for (const pu of p.pickups || S.pickups) s += pickup(pu, p);
  for (const [x, y] of S.knobs) s += C(x, y, 12, p.knob || S.knob || '#151515', line('#111', 1)) + C(x - 4, y + 4, 4, '#fff', ' fill-opacity=".4"');
  // neck with frets at real 12-TET spacing, inlays and nut
  const half = y => 21 + (nut - y) / (nut - S.heel) * 7;
  s += P(`M-28 ${S.heel}L28 ${S.heel}L21 ${nut}L-21 ${nut}Z`, p.board || '#3b2418', line('#111', 1.2));
  let prev = nut;
  for (let i = 1; i <= S.frets; i++) {
    const y = nut - S.scale * (1 - 2 ** (-i / 12));
    if (y < S.heel) break;
    s += L(-half(y), y, half(y), y, '#c8ccd2', 1, NS);
    const m = (y + prev) / 2, dot = p.inlay || '#efe9dc';
    if ([3, 5, 7, 9, 15, 17, 19, 21].includes(i)) s += C(0, m, 3.5, dot);
    if (i === 12) s += C(-9, m, 3.5, dot) + C(9, m, 3.5, dot);
    prev = y;
  }
  s += R(-21, nut - 2, 42, 5, '#efe9dc', 0, line('#111', .8));
  s += `<g transform="translate(0 ${nut})">${headstock(head, p.headColor || HEAD_COLOR[head] || paint(color), hw)}</g>`;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - .5;
    s += L(t * (n === 4 ? 30 : 35), nut, t * 54, S.bridge, '#eceef1', n === 4 ? 1.1 : .7, NS);
  }
  s += '</g>';
  return { w, h, svg: s, jacks: { out: { ...S.jack, dx: 1, dy: 0 } } };
}

// ---------- pedals (no printed text: the caption below names them) ----------
function boss(p) {
  const w = 60, h = 100, c = p.color || '#888888', k = p.knobs || [];
  let s = shell(w, h, c, 5);
  if (p.display) s += R(8, 7, 44, 18, '#0e1512', 2, line('#111', 1)) + range(7).map(i => R(12 + i * 5.3, 12, 3.4, 8, i === 3 ? '#4caf50' : '#e53935', .5)).join('');
  else if (p.sliders) for (let i = 0; i < p.sliders; i++) { const x = 9 + i * 42 / (p.sliders - 1); s += L(x, 6, x, 26, '#222', 1.6) + R(x - 3, 11 + (i % 3) * 4, 6, 4, '#222', 1); }
  else k.forEach((_, i) => { s += knob(w * (i + .5) / k.length, 16, k.length > 3 ? 5.6 : k.length > 2 ? 7 : 8); });
  s += R(5, 31, w - 10, 8, '#151515', 1.5) + led(w - 10, 35);
  s += R(3, 44, w - 6, h - 47, shade(c, -.12), 4, line('#111', 1.2));
  s += R(10, 64, w - 20, 28, '#1c1c1c', 3);
  for (let y = 68; y < 90; y += 4) s += L(13, y, w - 13, y, '#3a3a3a', 1.4);
  return { w, h, svg: s, jacks: sideJacks(w, 20) };
}

function ts(p) {
  const w = 60, h = 100, c = p.color || '#2e8b57';
  let s = shell(w, h, c, 8) + knob(15, 16, 7.5) + knob(45, 16, 7.5) + knob(30, 32, 6.5) + led(30, 8);
  s += R(6, 46, w - 12, h - 52, shade(c, -.3), 5, line('#111', 1.2)) + R(11, 52, w - 22, h - 64, shade(c, -.55), 3);
  return { w, h, svg: s, jacks: sideJacks(w, 20) };
}

// Generic stompbox: knobs in rows, optional screen and coloured stripe, LED, footswitches.
function box(p) {
  const w = p.w || 60, c = p.color || '#8a8f98';
  const k = p.knobs || [], n = k.length, maxPer = Math.max(3, Math.floor((w - 8) / 22));
  const rows = Math.ceil(n / maxPer), per = rows ? Math.ceil(n / rows) : 0;
  const r = n ? Math.min(8.5, (w - 8) / (per * 2.6)) : 0, rowH = r * 2 + 6;
  let body = '', y = 8;
  k.forEach((_, i) => {
    const row = Math.floor(i / per), cnt = Math.min(per, n - row * per);
    body += knob(w * ((i % per) + .5) / cnt, y + r + row * rowH, r, p.knob || knobFor(c));
  });
  y += rows * rowH + 2;
  if (p.display) { const dw = Math.min(56, w * .7); body += R(w / 2 - dw / 2, y, dw, 14, '#0e1512', 2, line('#111', 1)); y += 18; }
  if (p.accent) { const ah = Math.max(10, Math.min(22, w * .2)); body += R(7, y, w - 14, ah, p.accent, 3, line('#111', .8)); y += ah + 4; }
  const sw = p.switches ?? 1, fr = sw ? Math.min(8.5, w / (sw * 3.4)) : 0;
  const h = Math.max(p.h || 0, Math.ceil((y + (sw ? fr * 2 + 22 : 6)) / 20) * 20);
  if (sw) body += led(w / 2, h - fr * 2 - 14);
  for (let i = 0; i < sw; i++) body += foot(w * (i + .5) / sw, h - fr - 7, fr);
  const panel = p.panel ? R(3, 3, w - 6, y - 2, p.panel, 4) : '';
  return { w, h, svg: shell(w, h, c, 5) + panel + body, jacks: sideJacks(w, 20) };
}

function round(p) {
  const d = 100, c = p.color || '#c81e1e';
  const s = C(50, 50, 50, c, line('#111', 2)) + C(50, 50, 50, 'url(#rs-sheen)') + knob(31, 30, 8.5) + knob(69, 30, 8.5) + foot(50, 72, 9);
  return { w: d, h: d, svg: s, jacks: sideJacks(d, 40) };
}

// Treadle pedals (wah, volume, Whammy). panelW adds a control panel on the right.
function wah(p) {
  const pw = p.panelW || 0, tw = p.w || 80, w = tw + pw, h = p.h || 160, c = p.color || '#1c1c1c';
  let s = R(0, 0, w, h, shade(c, -.3), 9, line('#111', 2));
  s += R(5, 6, tw - 10, h - 12, c, 8, line('#111', 1.4)) + R(5, 6, tw - 10, h - 12, 'url(#rs-sheen)', 8);
  s += R(12, h * .36, tw - 24, h * .54, '#161616', 5);
  for (let y = h * .36 + 6; y < h * .9 - 3; y += 6) s += L(17, y, tw - 17, y, '#333', 2);
  if (pw) s += R(tw - 1, 6, pw - 5, h - 12, shade(c, .1), 5, line('#111', 1.4)) + knob(tw + pw / 2 - 3, 30, 9) + R(tw + 5, 52, pw - 16, 16, '#1a0d0d', 2) + led(tw + pw / 2 - 3, 84);
  return { w, h, svg: s, jacks: sideJacks(w, 40) };
}

// ---------- multi-FX, rack ----------
const RING = ['#e53935', '#43a047', '#1e88e5', '#fdd835', '#8e24aa', '#fb8c00'];
function multifx(p) {
  const w = p.w || 320, h = p.h || 160, c = p.color || '#1d1d1f';
  const sw = p.switches ?? 8, rows = sw > 6 ? 2 : 1, per = Math.ceil(sw / rows), nk = p.knobs ?? 6;
  let s = shell(w, h, c, 8);
  const sW = w * .44, sx = (w - sW) / 2, sH = Math.min(36, h * .24);
  s += R(sx, 10, sW, sH, '#14243a', 3, line('#000', 1));
  s += range(4).map(i => R(sx + 6 + i * (sW - 12) / 4, 10 + sH / 2 - 5, (sW - 12) / 4 - 4, 10, RING[(i + 1) % 6], 2)).join('');
  for (let i = 0; i < nk; i++) s += knob(sx + sW * (i + .5) / nk, 10 + sH + 13, 5.5, knobFor(c));
  const top = 10 + sH + 26, rowH = (h - top - 4) / rows, fr = Math.min(10, rowH * .28, w / per * .22);
  for (let i = 0; i < sw; i++) {
    const x = w * ((i % per) + .5) / per, y = top + rowH * (Math.floor(i / per) + .5);
    s += C(x, y, fr + 3, 'none', ` stroke="${RING[i % 6]}" stroke-width="2"`) + foot(x, y, fr);
  }
  return { w, h, svg: s, jacks: sideJacks(w, 20) };
}

function rack(p) {
  const u = p.u || 1, w = 320, h = 40 * u, c = p.color || '#1a1a1a';
  let s = shell(w, h, c, 2) + R(0, 0, 14, h, shade(c, .14), 0, line('#111', 1)) + R(w - 14, 0, 14, h, shade(c, .14), 0, line('#111', 1));
  for (let i = 0; i < u; i++) for (const x of [7, w - 7]) s += C(x, 40 * i + 10, 2.2, '#000') + C(x, 40 * i + 30, 2.2, '#000');
  s += R(40, h / 2 - 10, 100, 20, '#140808', 2, line('#000', 1)) + (p.screen ? T(90, h / 2 + 4.5, p.screen, 12, '#ff4d3a', { extra: ' font-family="monospace"' }) : '');
  const nk = Array.isArray(p.knobs) ? p.knobs.length : p.knobs ?? 4;
  for (let i = 0; i < nk; i++) s += knob(nk > 1 ? 180 + i * 110 / (nk - 1) : 235, h / 2, 7, knobFor(c));
  return { w, h, svg: s, jacks: sideJacks(w, h / 2) };
}

// ---------- amps (big brand logo kept: it is what makes an amp recognisable) ----------
function head(p, a) {
  const w = p.w || 300, h = 120, c = p.color || '#1a1a1a', panel = p.panel || '#c9a44c';
  let s = R(0, 0, w, h, c, 8, line('#111', 2)) + R(0, 0, w, h, 'url(#rs-sheen)', 8);
  s += R(12, 10, w - 24, 62, p.grille || '#2b2724', 3, line('#000', 1)) + R(12, 10, w - 24, 62, 'url(#rs-cloth)', 3);
  if (p.piping !== false) s += R(12, 76, w - 24, 2, p.piping || '#e8e2d0');
  const logo = p.logo ?? a.brand;
  if (logo) s += T(w / 2, 52, logo, fitText(logo, w - 60, 28), p.logoColor || '#f4f1e8', { weight: 800, italic: p.italic, ls: 1 });
  s += R(12, 84, w - 24, 28, panel, 3, line('#000', 1));
  const nk = p.knobs ?? 6, x0 = 40, x1 = w - 70, step = nk > 1 ? (x1 - x0) / (nk - 1) : 0, r = Math.min(7, (step || 20) / 2.4);
  for (let i = 0; i < nk; i++) s += knob(x0 + i * step, 98, r, p.knob || knobFor(panel), p.knobMark || '#e8d9a8');
  return { w, h, svg: s, jacks: { in: { x: w - 40, y: 100, dx: 0, dy: -1, face: true } } };
}

function speakers(n, cols, x, y, w, h) {
  const rows = Math.ceil(n / cols), r = Math.min(w / cols, h / rows) * .4;
  return range(n).map(i => C(x + w * ((i % cols) + .5) / cols, y + h * (Math.floor(i / cols) + .5) / rows, r, 'none', ' stroke="#000" stroke-opacity=".25" stroke-width="2"')).join('');
}

function cab(p, a) {
  const w = p.w || 300, h = p.h || 300, c = p.color || '#1a1a1a', n = p.speakers || 4;
  let s = R(0, 0, w, h, c, 8, line('#111', 2)) + R(0, 0, w, h, 'url(#rs-sheen)', 8);
  const gx = 14, gy = p.slant ? 32 : 14, gw = w - 28, gh = h - gy - 14;
  if (p.slant) s += L(14, 23, w - 14, 23, shade(c, .3), 1.5);
  s += R(gx, gy, gw, gh, p.grille || '#2b2724', 4, line('#000', 1)) + R(gx, gy, gw, gh, `url(#rs-${p.weave || 'cloth'})`, 4);
  s += speakers(n, p.cols || Math.min(n, 2), gx, gy, gw, gh);
  const logo = p.logo ?? a.brand;
  if (logo) {
    s += p.logoPos === 'top-left'
      ? T(gx + 14, gy + 28, logo, 20, p.logoColor || '#f4f1e8', { anchor: 'start', weight: 800, italic: p.italic })
      : T(w / 2, gy + Math.min(50, gh * .24), logo, fitText(logo, gw - 40, 30), p.logoColor || '#f4f1e8', { weight: 800, italic: p.italic, ls: 1 });
  }
  return { w, h, svg: s, jacks: {} };
}

function combo(p, a) {
  const w = p.w || 300, h = p.h || 220, c = p.color || '#1a1a1a', panel = p.panel || '#151515';
  let s = R(0, 0, w, h, c, 10, line('#111', 2)) + R(0, 0, w, h, 'url(#rs-sheen)', 10) + R(10, 22, w - 20, 36, panel, 3, line('#000', 1));
  const nk = p.knobs ?? 8, x0 = 70, x1 = w - 26, step = nk > 1 ? (x1 - x0) / (nk - 1) : 0, r = Math.min(7, (step || 20) / 2.5);
  for (let i = 0; i < nk; i++) s += knob(x0 + i * step, 40, r, p.knob || knobFor(panel), p.knobMark || '#fff');
  const gx = 14, gy = 68, gw = w - 28, gh = h - gy - 12;
  s += R(gx, gy, gw, gh, p.grille || '#2b2724', 4, line('#000', 1)) + R(gx, gy, gw, gh, `url(#rs-${p.weave || 'cloth'})`, 4);
  const n = p.speakers || 2;
  s += speakers(n, p.cols || Math.min(n, 2), gx, gy, gw, gh);
  const logo = p.logo ?? a.brand, lc = p.logoColor || '#f4f1e8';
  if (logo) {
    s += p.logoPos === 'center'
      ? T(w / 2, gy + 32, logo, fitText(logo, gw - 40, 24), lc, { weight: 800, italic: p.italic, ls: 1 })
      : T(gx + 14, gy + 28, logo, fitText(logo, gw * .5, 22), lc, { anchor: 'start', weight: 800, italic: p.italic ?? true });
  }
  return { w, h, svg: s, jacks: { in: { x: 40, y: 40, dx: 0, dy: -1, face: true } } };
}

// ---------- misc ----------
function text(p) {
  const lines = String(p.text ?? 'Text').split('\n'), size = p.size || 16, lh = size * 1.3;
  const w = Math.max(20, ...lines.map(l => l.length * size * .62)), h = lines.length * lh;
  return { w, h, svg: lines.map((l, i) => T(0, lh * (i + 1) - size * .32, l, size, p.color || '#111', { anchor: 'start', weight: p.weight || 700 })).join(''), jacks: {} };
}

function missing(p, a) {
  const w = 80, h = 80, id = a?.id || '?';
  return {
    w, h, jacks: sideJacks(w, 20),
    svg: R(0, 0, w, h, '#f4f4f4', 6, ' stroke="#c62828" stroke-dasharray="4 3" stroke-width="1.5"') + T(w / 2, 42, '?', 26, '#c62828') + T(w / 2, 62, id, fitText(id, 70, 8), '#555'),
  };
}

export const TEMPLATES = { guitar, boss, ts, box, round, wah, multifx, rack, head, cab, combo, text };

function nubs(jacks) {
  return Object.values(jacks).map(({ x, y, dx, dy, face }) => {
    if (face) return C(x, y, 5.5, 'url(#rs-chrome)', line('#111', 1)) + C(x, y, 2.4, '#111');
    return Math.abs(dx) >= Math.abs(dy) ? R(dx > 0 ? x : x - 6, y - 5, 6, 10, '#a3a9b0', 1, line('#111', .8)) : R(x - 5, dy > 0 ? y : y - 6, 10, 6, '#a3a9b0', 1, line('#111', .8));
  }).join('');
}

// Draw one catalog asset, applying the item's overrides (colour, params, flip).
export function renderAsset(asset, item = {}) {
  if (!asset) return missing({}, { id: item.asset });
  const p = { ...asset.params, ...item.params };
  if (item.color) p.color = item.color;
  if (asset.template === 'text' && item.text !== undefined) p.text = item.text;
  const g = (TEMPLATES[asset.template] || missing)(p, asset);
  let svg = g.svg + nubs(g.jacks), jacks = g.jacks;
  if (item.flip) {
    svg = `<g transform="translate(${f(g.w)} 0) scale(-1 1)">${svg}</g>`;
    jacks = Object.fromEntries(Object.entries(jacks).map(([k, j]) => [k, { ...j, x: g.w - j.x, dx: -j.dx }]));
  }
  return { w: g.w, h: g.h, svg, jacks };
}

// ---------- captions ----------
export const itemName = (it, a) => it.label || (a ? `${a.brand} ${a.model}` : it.asset);

function wrap(text, maxW, size) {
  const out = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (!cur || next.length * size * .64 <= maxW) cur = next; else { out.push(cur); cur = word; }
  }
  if (cur) out.push(cur);
  return out.map(t => ({ t, size: fitText(t, maxW, size) }));
}

// Name (and note) centred under the item. Returns markup plus the box it covers.
function caption(it, a, g) {
  if (!(it.caption ?? a?.template !== 'text')) return null;
  const size = g.w < 120 ? 11 : 13, maxW = Math.max(g.w + 32, 90);
  const lines = wrap(itemName(it, a).toUpperCase(), maxW, size).map(l => ({ ...l, c: '#b3261e' }));
  if (it.note) lines.push(...wrap(`(${it.note.toUpperCase()})`, maxW, size - 1).map(l => ({ ...l, c: '#666' })));
  let y = g.h + 4, svg = '', w = 0;
  for (const l of lines) {
    y += l.size * 1.15;
    svg += T(g.w / 2, y, l.t, l.size, l.c, { weight: 800 });
    w = Math.max(w, l.t.length * l.size * .64);
  }
  return { svg, w: Math.min(maxW, w), h: y - g.h + 4 };
}

// ---------- cables ----------
function rounded(pts, r = 9) {
  const Q = simplify(pts);
  let d = `M${f(Q[0].x)} ${f(Q[0].y)}`;
  for (let i = 1; i < Q.length - 1; i++) {
    const a = Q[i - 1], b = Q[i], c = Q[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y), rr = Math.min(r, l1 / 2, l2 / 2);
    d += `L${f(b.x - (b.x - a.x) / l1 * rr)} ${f(b.y - (b.y - a.y) / l1 * rr)}Q${f(b.x)} ${f(b.y)} ${f(b.x + (c.x - b.x) / l2 * rr)} ${f(b.y + (c.y - b.y) / l2 * rr)}`;
  }
  const z = Q[Q.length - 1];
  return d + `L${f(z.x)} ${f(z.y)}`;
}

function plug(j, next) {
  const len = Math.hypot(next.x - j.x, next.y - j.y) || 1, k = Math.min(16, len) / len;
  const q = { x: j.x + (next.x - j.x) * k, y: j.y + (next.y - j.y) * k }, m = { x: (j.x + q.x) / 2, y: (j.y + q.y) / 2 };
  return L(j.x, j.y, q.x, q.y, '#111', 11, ' stroke-linecap="butt"') + L(j.x, j.y, q.x, q.y, 'url(#rs-chrome)', 8) + L(m.x, m.y, q.x, q.y, '#3a3d42', 8);
}

function cable(full, i, c, ui, on) {
  const d = rounded(full), color = on ? '#1e88e5' : paint(c.color || '#1f1f1f');
  let s = `<g${ui ? ` data-cable="${i}"` : ''}>`;
  if (ui) s += `<path d="${d}" fill="none" stroke="transparent" stroke-width="16"/>`;
  s += `<path d="${d}" fill="none" stroke="#fff" stroke-width="9" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round"/>`;
  s += plug(full[0], full[1]) + plug(full[full.length - 1], full[full.length - 2]);
  if (ui) {
    for (let k = 1; k <= full.length - 3; k++) {
      const a = full[k], b = full[k + 1];
      if (a.x === b.x && a.y === b.y) continue;
      s += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="transparent" stroke-width="14" data-seg="${k}" class="${a.y === b.y ? 'seg-h' : 'seg-v'}"/>`;
    }
  }
  if (c.label) {
    let best = 0, m = full[0];
    for (let k = 1; k < full.length; k++) {
      const a = full[k - 1], b = full[k], len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > best) { best = len; m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, h: a.y === b.y }; }
    }
    s += T(m.x, m.h ? m.y - 9 : m.y + 3.5, c.label.toUpperCase(), 10, '#111', { weight: 800, extra: ' stroke="#fff" stroke-width="4" stroke-linejoin="round" paint-order="stroke"' });
  }
  return s + '</g>';
}

export function jackWorld(it, g, type) {
  const j = g.jacks[type];
  return j && { x: it.x + j.x, y: it.y + j.y, dx: j.dx, dy: j.dy };
}

// ---------- whole rig ----------
// Full rig as SVG content (no outer <svg>). `ui` adds editor-only handles; `out.routes`
// receives the cable polylines so the editor can drag their segments.
export function renderRig(rig, byId, { ui = false, sel = null, temp = null, out = null } = {}) {
  const W = rig.paper.w, H = rig.paper.h;
  const G = new Map(), caps = new Map(), rects = new Map();
  for (const it of rig.items) {
    const a = byId[it.asset], g = renderAsset(a, it), cap = caption(it, a, g);
    G.set(it.id, g); caps.set(it.id, cap);
    const r = [{ x: it.x, y: it.y, w: g.w, h: g.h }];
    if (cap) r.push({ x: it.x + g.w / 2 - cap.w / 2, y: it.y + g.h, w: cap.w, h: cap.h });
    rects.set(it.id, r);
  }
  const byItem = new Map(rig.items.map(it => [it.id, it]));
  const routes = routeCables(rig, rects, c => {
    const A = byItem.get(c.from), B = byItem.get(c.to);
    const a = A && jackWorld(A, G.get(A.id), 'out'), b = B && jackWorld(B, G.get(B.id), 'in');
    return a && b ? { a, b } : null;
  });
  if (out) out.routes = routes;

  let s = DEFS + R(0, 0, W, H, '#fff') + (ui ? R(0, 0, W, H, 'url(#rs-grid)', 0, ' pointer-events="none"') : '');
  if (rig.title) s += T(W / 2, 62, rig.title.toUpperCase(), fitText(rig.title, W - 80, 32), '#111', { weight: 800, ls: 1.5 });
  if (rig.subtitle) s += T(W / 2, 90, rig.subtitle, 15, '#777', { weight: 500 });
  for (const it of rig.items) {
    const g = G.get(it.id), cap = caps.get(it.id);
    s += `<g data-id="${esc(it.id)}" transform="translate(${f(it.x)} ${f(it.y)})"${ui ? ' class="item"' : ''}>`
      + (ui ? R(-4, -4, g.w + 8, g.h + 8, 'transparent') : '')
      + g.svg + (cap ? cap.svg : '')
      + (ui && sel?.kind === 'item' && sel.id === it.id ? R(-6, -6, g.w + 12, g.h + 12, 'none', 4, ' stroke="#1e88e5" stroke-width="2" stroke-dasharray="6 4"') : '')
      + '</g>';
  }
  rig.cables.forEach((c, i) => { if (routes[i]) s += cable(routes[i], i, c, ui, ui && sel?.kind === 'cable' && sel.i === i); });
  if (ui) {
    for (const it of rig.items) {
      for (const [type, j] of Object.entries(G.get(it.id).jacks)) {
        s += C(it.x + j.x, it.y + j.y, 6.5, type === 'in' ? '#2e7d32' : '#1565c0', ` stroke="#fff" stroke-width="2" class="jack" data-jack="${type}" data-id="${esc(it.id)}"`);
      }
    }
    if (temp) s += L(temp.from.x, temp.from.y, temp.x, temp.y, '#1e88e5', 4, ' stroke-dasharray="8 6" stroke-linecap="round" pointer-events="none"');
  }
  return s;
}

export const exportSVG = (rig, byId) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${rig.paper.w}" height="${rig.paper.h}" viewBox="0 0 ${rig.paper.w} ${rig.paper.h}" font-family="${FONT}">${renderRig(rig, byId)}</svg>`;
