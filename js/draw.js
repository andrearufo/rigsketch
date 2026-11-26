// Rigsketch renderer.
// Pure functions that turn rig data into SVG markup strings. No DOM access, so the
// same code draws the editor, the SVG/PNG exports, and runs in Node (test/check.mjs).

import { chainNumbers } from './rig.js';

export const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const f = n => Math.round(n * 10) / 10;
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// ---------- colours ----------
const GRADIENTS = { sunburst: '#6b3414', cherryburst: '#7a1f12', tobacco: '#4a2410' };
export const FINISHES = {
  Sunburst: 'sunburst', 'Cherry sunburst': 'cherryburst', 'Tobacco burst': 'tobacco',
  Black: '#141414', 'Olympic white': '#ece8da', 'Vintage white': '#e9e2c8', 'Fiesta red': '#d2382f',
  'Candy apple red': '#a0141e', Cherry: '#7a1414', 'Sonic blue': '#8fc3d9', 'Lake placid blue': '#2f4f8f',
  'Surf green': '#7fc6a4', 'Shell pink': '#efc3b6', Butterscotch: '#e4b260', Natural: '#e2c28c',
  'Gold top': '#c9a646', Silver: '#b9bdc2', 'Orange': '#d0611d',
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
const light = c => { const v = rgb(c); return !!v && v[0] * .299 + v[1] * .587 + v[2] * .114 > 150; };
const inkFor = c => (light(c) ? '#111' : '#fff');
const knobFor = c => (light(c) || !rgb(c) || rgb(c).reduce((a, b) => a + b) > 200 ? '#151515' : '#5a5d63');

export const DEFS = `<defs>
<radialGradient id="rs-sunburst" cx=".5" cy=".62" r=".6"><stop offset=".3" stop-color="#f0b23c"/><stop offset=".68" stop-color="#b0501c"/><stop offset="1" stop-color="#1f0d05"/></radialGradient>
<radialGradient id="rs-cherryburst" cx=".5" cy=".62" r=".6"><stop offset=".3" stop-color="#eda04a"/><stop offset=".66" stop-color="#b52a1c"/><stop offset="1" stop-color="#3a0a06"/></radialGradient>
<radialGradient id="rs-tobacco" cx=".5" cy=".62" r=".6"><stop offset=".3" stop-color="#d49a4a"/><stop offset=".66" stop-color="#6a3414"/><stop offset="1" stop-color="#140904"/></radialGradient>
<linearGradient id="rs-chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f7f9"/><stop offset="1" stop-color="#9aa1a9"/></linearGradient>
<pattern id="rs-cloth" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 4L4 0M-1 1L1 -1M3 5L5 3" stroke="#fff" stroke-opacity=".09"/></pattern>
<pattern id="rs-diamond" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M7 0L14 7L7 14L0 7Z" fill="none" stroke="#fff" stroke-opacity=".16"/></pattern>
<pattern id="rs-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#000" fill-opacity=".13"/></pattern>
</defs>`;

// ---------- primitives ----------
const R = (x, y, w, h, fill, rx = 0, extra = '') =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${rx ? ` rx="${rx}"` : ''} fill="${fill}"${extra}/>`;
const C = (x, y, r, fill, extra = '') => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${fill}"${extra}/>`;
const L = (x1, y1, x2, y2, stroke, w = 1, extra = '') =>
  `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${stroke}" stroke-width="${w}"${extra}/>`;
function T(x, y, s, size, fill, o = {}) {
  return `<text x="${f(x)}" y="${f(y)}" font-size="${f(size)}" fill="${fill}" text-anchor="${o.anchor || 'middle'}" font-weight="${o.weight || 700}"${o.ls ? ` letter-spacing="${o.ls}"` : ''}${o.italic ? ' font-style="italic"' : ''}${o.extra || ''}>${esc(s)}</text>`;
}
const fitText = (s, maxW, max) => Math.min(max, maxW / (Math.max(1, String(s).length) * .62));
const edge = (c, a = -.45, w = 1.5) => ` stroke="${shade(c, a)}" stroke-width="${w}"`;
const knob = (x, y, r, fill = '#151515', mark = '#fff') =>
  C(x, y, r, fill, ' stroke="#000" stroke-opacity=".35"') + L(x, y, x, y - r * .8, mark, Math.max(1, r / 5), ' stroke-linecap="round"');
const foot = (x, y, r = 8) =>
  C(x, y, r, 'url(#rs-chrome)', ' stroke="#6d737b" stroke-width="1.2"') + C(x, y, r * .55, '#e3e6ea', ' stroke="#9aa0a7" stroke-width=".8"');
const led = (x, y, c = '#e53935') => C(x, y, 2.4, c, ' stroke="#000" stroke-opacity=".35"');
const sideJacks = (w, y) => ({ in: { x: w, y, dx: 1, dy: 0 }, out: { x: 0, y, dx: -1, dy: 0 } });

// ---------- guitars ----------
// All guitars share one frame: 140 wide, nut at y=64, neck centred on x=70.
// A shape is data: body outline, pickguard, hardware parts, pickups, knobs, jack.
const STRAT = 'M58 240C56 228 46 214 34 212C24 210 18 214 14 224C8 238 4 250 6 262C8 276 13 284 11 296C9 312 2 326 3 346C5 384 36 404 70 404C104 404 135 384 137 346C138 326 130 312 128 298C126 284 132 274 132 262C132 248 126 236 120 230C116 226 110 226 106 230C96 238 88 244 82 240Z';
const TELE = 'M58 226C56 208 50 186 36 180C22 176 12 190 12 212C12 240 22 256 15 282C8 310 5 340 10 364C18 396 50 404 70 404C92 404 124 396 131 364C136 340 134 312 128 288C123 266 128 250 120 238C112 228 96 224 82 228Z';
const LP = 'M58 236C54 226 46 220 36 220C18 220 10 238 12 260C14 280 10 294 6 318C0 362 30 406 70 406C110 406 140 362 134 322C130 296 122 284 122 268C122 252 120 238 114 232C108 226 102 230 100 238C98 246 90 250 82 248Z';
const SG = 'M58 232C56 222 50 210 40 202L30 194C26 192 22 196 24 202C28 224 30 246 20 270C8 298 6 332 14 362C24 394 50 402 70 402C90 402 116 394 126 362C134 332 132 298 120 270C110 246 112 224 116 202C118 196 114 192 110 194L100 202C90 210 84 222 82 232Z';
const ES = 'M58 232C56 220 50 208 40 204C24 198 8 208 6 230C4 252 16 266 12 284C4 312 0 340 8 366C18 398 50 406 70 406C90 406 122 398 132 366C140 340 136 312 128 284C124 266 136 252 134 230C132 208 116 198 100 204C90 208 84 220 82 232Z';
const OFFSET = 'M58 236C54 222 42 206 28 204C16 202 8 210 6 224C4 240 10 254 10 268C10 284 2 300 2 324C2 370 36 402 76 402C110 402 138 380 136 340C134 316 124 302 124 284C124 268 132 258 130 246C128 234 120 228 112 230C102 232 92 240 82 236Z';
const DREAD = 'M54 194C30 192 14 202 14 224C14 248 26 262 20 282C10 302 2 330 4 360C8 394 40 406 70 406C100 406 132 394 136 360C138 330 130 302 120 282C114 262 126 248 126 224C126 202 110 192 86 194Z';
const JM_GUARD = 'M48 240C34 248 22 270 26 298C30 326 24 352 38 370C52 384 84 386 104 370L118 320C124 296 116 258 94 240Z';
const TOM = [['r', 51, 320, 38, 5, 2, 'hw'], ['r', 50, 338, 40, 6, 3, 'hw']];

const GSHAPES = {
  strat: {
    body: STRAT, join: 240, bridgeY: 350, knob: '#f1efe8',
    guard: 'M50 244C40 248 30 270 32 296C34 322 28 348 44 364C60 378 94 374 108 356L114 312C118 282 108 252 92 244Z',
    parts: [['r', 52, 342, 36, 14, 2, 'hw'], ['r', 96, 316, 10, 4, 1, '#f1efe8']],
    pickups: [['s', 270], ['s', 300], ['s', 330, -9]],
    knobs: [[98, 336], [102, 354], [107, 371]], jack: { x: 110, y: 388, dx: .7, dy: .7, face: true },
  },
  tele: {
    body: TELE, join: 226, bridgeY: 342, guardColor: '#151515',
    guard: 'M50 230C38 236 28 262 32 290C35 316 46 330 62 330L84 326L86 240C80 230 62 226 50 230Z',
    parts: [['r', 46, 306, 48, 44, 4, 'hw'], ['r', 52, 336, 36, 6, 1, '#9aa1a9'], ['r', 98, 318, 14, 52, 7, 'hw']],
    pickups: [['s', 254, 0, 'url(#rs-chrome)'], ['s', 320, -7]],
    knobs: [[105, 332], [105, 356]], jack: { x: 131, y: 362, dx: 1, dy: 0 },
  },
  lespaul: {
    body: LP, join: 236, bridgeY: 336, guardColor: '#efe6cf', knob: '#c8962e',
    guard: 'M88 254C100 254 108 264 104 282C101 296 94 302 88 300Z',
    parts: [...TOM, ['c', 30, 238, 4, '#efe6cf']],
    pickups: [['h', 262], ['h', 302]],
    knobs: [[96, 344], [114, 336], [100, 368], [118, 360]], jack: { x: 135, y: 356, dx: 1, dy: 0 },
  },
  sg: {
    body: SG, join: 232, bridgeY: 336, guardColor: '#151515', knob: '#c8962e',
    guard: 'M50 248C42 268 41 300 50 322C58 338 74 342 86 336L92 300L90 250Z',
    parts: TOM, pickups: [['h', 262], ['h', 302]],
    knobs: [[96, 352], [112, 344], [100, 374], [116, 366]], jack: { x: 116, y: 386, dx: .6, dy: .8, face: true },
  },
  semihollow: {
    body: ES, join: 232, bridgeY: 336, guardColor: '#151515', knob: '#c8962e',
    guard: 'M86 252C98 252 106 266 104 290C102 306 94 312 86 310Z',
    parts: [['p', 'M24 252C16 274 30 298 20 326', 'none', '#111', 3.2], ['p', 'M116 252C124 274 110 298 120 326', 'none', '#111', 3.2], ...TOM],
    pickups: [['h', 262], ['h', 302]],
    knobs: [[96, 352], [112, 346], [100, 374], [116, 368]], jack: { x: 114, y: 388, dx: .6, dy: .8, face: true },
  },
  prs: {
    body: STRAT, join: 240, bridgeY: 350, knob: '#d4b35a',
    parts: [['r', 50, 342, 40, 9, 3, 'hw']], pickups: [['h', 270], ['h', 312]],
    knobs: [[100, 340], [112, 354], [106, 372]], jack: { x: 118, y: 382, dx: .7, dy: .7, face: true },
  },
  offset: {
    body: OFFSET, join: 236, bridgeY: 350, guard: JM_GUARD, guardColor: '#5b2a17',
    parts: [['r', 54, 344, 32, 7, 2, 'hw'], ['r', 50, 362, 40, 20, 5, 'hw'], ['r', 22, 246, 30, 9, 3, 'hw']],
    pickups: [['jm', 276], ['jm', 322]],
    knobs: [[106, 334], [112, 352]], jack: { x: 112, y: 384, dx: .7, dy: .7, face: true },
  },
  explorer: {
    body: 'M58 228L44 214L6 382C8 398 22 404 30 402L80 368L138 302C140 290 138 278 132 272L102 250L82 228Z',
    join: 228, bridgeY: 334, parts: TOM, pickups: [['h', 262], ['h', 298]],
    knobs: [[90, 346], [102, 334], [114, 322]], jack: { x: 124, y: 298, dx: 1, dy: -.2, face: true },
  },
  flyingv: {
    body: 'M58 220L4 394C4 404 26 410 32 402L70 304L108 402C114 410 136 404 136 394L82 220Z',
    join: 220, bridgeY: 292,
    parts: [['r', 51, 280, 38, 5, 2, 'hw'], ['p', 'M54 290L70 298L86 290L86 295L70 303L54 295Z', 'hw']],
    pickups: [['h', 244], ['h', 268]],
    knobs: [[96, 330], [104, 350], [112, 370]], jack: { x: 118, y: 386, dx: .5, dy: .9, face: true },
  },
  dread: {
    body: DREAD, join: 196, bridgeY: 334, guardColor: '#5b2a17',
    guard: 'M88 250C104 250 112 268 104 286C96 300 84 294 84 282Z',
    parts: [['o', 70, 258, 21, '#3a2a1a', 2.5], ['c', 70, 258, 17, '#1a110b'], ['r', 50, 326, 40, 13, 5, '#2a1a10'], ['r', 56, 330, 28, 2, 1, '#f1efe8']],
    pickups: [], knobs: [], jack: { x: 70, y: 405, dx: 0, dy: 1, face: true },
  },
  pbass: {
    body: STRAT, off: 60, strings: 4, join: 240, bridgeY: 354, guardColor: '#5b2a17',
    guard: 'M48 244C38 250 30 272 32 298C34 324 28 348 44 364C58 376 76 372 84 362L90 310L96 244Z',
    parts: [['r', 50, 346, 40, 16, 2, 'hw'], ['r', 98, 334, 16, 46, 8, 'hw']],
    pickups: [['p', 298]], knobs: [[106, 346], [106, 368]], jack: { x: 106, y: 388, dx: .4, dy: .9, face: true },
  },
  jbass: {
    body: OFFSET, off: 60, strings: 4, join: 236, bridgeY: 354, guard: JM_GUARD, guardColor: '#5b2a17',
    parts: [['r', 50, 346, 40, 16, 2, 'hw'], ['r', 98, 334, 16, 52, 8, 'hw']],
    pickups: [['j', 284], ['j', 326]], knobs: [[106, 346], [106, 362], [106, 378]], jack: { x: 106, y: 392, dx: .4, dy: .9, face: true },
  },
};

const HW = { chrome: 'url(#rs-chrome)', gold: '#d4b35a', black: '#1d1d1d' };
const HEAD_COLOR = { fender: '#e3c48d', bass: '#e3c48d', gibson: '#141414', acoustic: '#1e130c' };
const key = (x, y, hw) => R(x - 5, y - 2.5, 10, 5, hw, 2.5, ' stroke="#5f656c" stroke-width=".6"');
const post = (x, y) => C(x, y, 1.9, '#d9dde2', ' stroke="#6d737b" stroke-width=".6"');
const headPath = (d, c) => `<path d="${d}" fill="${c}" stroke="#000" stroke-opacity=".35" stroke-width=".8"/>`;
const range = n => [...Array(n).keys()];
const HEADS = {
  fender: (c, hw) => headPath('M59 64L59 54C51 47 47 26 50 13C52 4 61 0 70 2C80 4 84 11 80 18C76 25 74 33 78 43C81 51 81 58 81 64Z', c)
    + range(6).map(i => key(45, 12 + i * 7.6, hw) + post(55 + i * .9, 12 + i * 7.6)).join(''),
  gibson: (c, hw) => headPath('M60 64L56 54L52 12C52 5 58 1 64 4L70 7L76 4C82 1 88 5 88 12L84 54L80 64Z', c)
    + [18, 32, 46].map(y => key(46, y, hw) + key(94, y, hw) + post(58 + (y - 18) * .08, y) + post(82 - (y - 18) * .08, y)).join(''),
  bass: (c, hw) => headPath('M59 64L58 52C46 44 40 24 44 12C47 4 58 1 67 3C78 6 83 12 79 20C75 27 74 35 78 45C81 53 81 58 81 64Z', c)
    + [12, 24, 36, 48].map((y, i) => R(33, y - 3.5, 12, 7, hw, 3.5, ' stroke="#5f656c" stroke-width=".6"') + C(51 + i * 1.6, y, 2.6, '#d9dde2', ' stroke="#6d737b" stroke-width=".6"')).join(''),
  pointy: (c, hw) => headPath('M59 64L59 56L46 8C45 3 49 1 53 2L79 32C82 38 81 50 81 64Z', c)
    + range(6).map(i => { const y = 12 + i * 8, x = 47 + i * 2.6; return key(x - 6, y, hw) + post(x + 5, y); }).join(''),
  acoustic: (c, hw) => headPath('M60 64L57 10C57 4 60 2 70 2C80 2 83 4 83 10L80 64Z', c)
    + [16, 32, 48].map(y => key(50, y, hw) + key(90, y, hw) + post(61, y) + post(79, y)).join(''),
};

function prim(list, ctx) {
  const col = v => (v === 'hw' ? ctx.hw : v === 'guard' ? ctx.guard : v);
  return (list || []).map(([t, ...a]) => {
    if (t === 'r') return R(a[0], a[1], a[2], a[3], col(a[5]), a[4], ' stroke="#000" stroke-opacity=".25" stroke-width=".6"');
    if (t === 'c') return C(a[0], a[1], a[2], col(a[3]));
    if (t === 'o') return C(a[0], a[1], a[2], 'none', ` stroke="${col(a[3])}" stroke-width="${a[4]}"`);
    if (t === 'p') return `<path d="${a[0]}" fill="${col(a[1])}" stroke="${col(a[2] || 'none')}" stroke-width="${a[3] || 0}" stroke-linecap="round"/>`;
    return '';
  }).join('');
}

function pickup([t, y, a = 0, col], p) {
  const c = col || p.pickupColor || (t === 'h' ? '#151515' : '#f1efe8');
  const st = ' stroke="#000" stroke-opacity=".35" stroke-width=".7"';
  const poles = py => (c.startsWith('url') ? '' : range(6).map(i => C(61.5 + i * 3.4, py, .9, '#8d939a')).join(''));
  let g;
  if (t === 'h') g = (p.ring ? R(52, y - 9, 36, 18, p.ring, 3, st) : '') + R(55, y - 7, 30, 14, c, 2, st) + poles(y - 3.5) + poles(y + 3.5);
  else if (t === 'p') g = R(51, y - 10, 19, 9, c, 3, st) + R(70, y + 1, 19, 9, c, 3, st);
  else if (t === 'j') g = R(53, y - 4, 34, 8, c, 3, st);
  else if (t === 'jm') g = R(52, y - 6, 36, 12, c, 3, st) + poles(y);
  else g = R(57, y - 4, 26, 8, c, 4, st) + poles(y);
  return a ? `<g transform="rotate(${a} 70 ${y})">${g}</g>` : g;
}

function guitar(p) {
  const S = GSHAPES[p.shape] || GSHAPES.strat, off = S.off || 0, nut = 64;
  const color = p.color || '#1a1a1a', hw = HW[p.hardware] || HW.chrome;
  const ctx = { hw, guard: p.guard || S.guardColor || '#f1efe8' };
  const strings = S.strings || 6, bridgeY = S.bridgeY + off, joinY = S.join + off;
  let s = `<g transform="translate(0 ${off})"><path d="${S.body}" fill="${paint(color)}" stroke="${p.binding || shade(color, -.55)}" stroke-width="${p.binding ? 2.5 : 1.6}"/>`;
  if (S.guard && p.guard !== false) s += `<path d="${S.guard}" fill="${ctx.guard}" stroke="#000" stroke-opacity=".3" stroke-width=".8"/>`;
  s += prim(S.parts, ctx);
  for (const pu of p.pickups || S.pickups) s += pickup(pu, p);
  for (const [x, y] of S.knobs) s += C(x, y, 5, p.knob || S.knob || '#151515', ' stroke="#000" stroke-opacity=".4"') + C(x - 1.4, y - 1.4, 1.3, '#fff', ' fill-opacity=".45"');
  s += '</g>';
  // neck, frets (real 12-TET spacing), inlays, nut, headstock, strings
  s += R(59, nut, 22, joinY + 12 - nut, p.board || '#3b2418', 1.5, ' stroke="#000" stroke-opacity=".25" stroke-width=".6"');
  const scale = bridgeY - nut, inlay = p.inlay || '#efe9dc';
  let prev = nut;
  for (let i = 1; i <= 24; i++) {
    const y = nut + scale * (1 - 2 ** (-i / 12));
    if (y > joinY + 10) break;
    s += L(59, y, 81, y, '#c8ccd2', .9);
    const m = (y + prev) / 2;
    if ([3, 5, 7, 9, 15, 17, 19, 21].includes(i)) s += C(70, m, 1.6, inlay);
    if (i === 12) s += C(66, m, 1.6, inlay) + C(74, m, 1.6, inlay);
    prev = y;
  }
  s += R(59, nut - 2, 22, 3, '#efe9dc');
  const head = HEADS[p.head] ? p.head : 'fender';
  s += HEADS[head](p.headColor || HEAD_COLOR[head] || paint(color), hw);
  for (let i = 0; i < strings; i++) {
    const t = i / (strings - 1);
    s += L(63 + 14 * t, nut, 61 + 18 * t, bridgeY, '#e4e7eb', strings === 4 ? 1.1 : .7);
  }
  return { w: 140, h: 410 + off, svg: s, jacks: { out: { ...S.jack, y: S.jack.y + off } } };
}

// ---------- pedals ----------
function boss(p, a) {
  const w = 70, h = 124, c = p.color || '#888888', ink = p.ink || inkFor(c), k = p.knobs || [];
  let s = R(0, 0, w, h, c, 6, edge(c));
  if (p.display) s += R(12, 10, 46, 22, '#10161a', 3) + range(9).map(i => R(16 + i * 4.4, 17, 3, 8, i === 4 ? '#4caf50' : '#c0392b', .5)).join('');
  else if (p.sliders) for (let i = 0; i < p.sliders; i++) { const x = 11 + i * 48 / (p.sliders - 1); s += L(x, 8, x, 34, '#222', 1.6) + R(x - 3, 15 + (i % 3) * 5, 6, 4, '#222', 1); }
  else k.forEach((lab, i) => { const x = w * (i + .5) / k.length; s += T(x, 9.5, lab, fitText(lab, w / k.length - 2, 4.6), ink, { weight: 600 }) + knob(x, 21, k.length > 3 ? 6.2 : 7.5); });
  const txt = p.text ?? a.model;
  s += R(7, 38, w - 22, 13, '#141414', 1.5) + T(w / 2 - 4, 47.5, txt, fitText(txt, w - 28, 8.5), '#fff') + led(w - 9, 44.5);
  s += R(4, 56, w - 8, h - 60, shade(c, -.14), 4, edge(c, -.4, 1));
  s += T(w / 2, 74, a.brand.toUpperCase(), 10, ink, { weight: 900, ls: 1 });
  s += R(12, 82, w - 24, 34, '#1b1b1b', 3);
  for (let y = 86; y < 114; y += 4) s += L(16, y, w - 16, y, '#333', 1.4);
  return { w, h, svg: s, jacks: sideJacks(w, 24) };
}

function ts(p, a) {
  const w = 74, h = 126, c = p.color || '#2e8b57', ink = p.ink || inkFor(c), k = p.knobs || [];
  let s = R(0, 0, w, h, c, 10, edge(c)) + led(37, 12);
  const pos = [[18, 24, -12], [56, 24, -12], [37, 40, 14]];
  k.slice(0, 3).forEach((lab, i) => { const [x, y, ly] = pos[i]; s += knob(x, y, i < 2 ? 8 : 7) + T(x, y + ly + 1.5, lab, fitText(lab, 34, 5), ink, { weight: 600 }); });
  const txt = p.text ?? a.model;
  s += T(w / 2, 66, txt, fitText(txt, w - 14, 12), ink, { weight: 900 });
  s += R(8, 74, w - 16, h - 82, shade(c, -.3), 5) + R(14, 80, w - 28, h - 94, shade(c, -.5), 3);
  s += T(w / 2, h - 16, a.brand.toUpperCase(), 6, ink, { weight: 700, ls: 1 });
  return { w, h, svg: s, jacks: sideJacks(w, 24) };
}

// Generic stompbox: knobs in rows, optional screen, name, brand, LED, footswitches.
// The height grows to fit the content, so `h` in the catalog is a minimum.
function box(p, a) {
  const w = p.w || 64, c = p.color || '#8a8f98', ink = p.ink || inkFor(c);
  const k = p.knobs || [], n = k.length, maxPer = Math.max(3, Math.floor((w - 8) / 24));
  const rows = Math.ceil(n / maxPer), per = rows ? Math.ceil(n / rows) : 0;
  const r = n ? Math.min(9, (w - 8) / (per * 2.7)) : 0, labels = r >= 5.5, rowH = r * 2 + (labels ? 12 : 6);
  let body = '', y = 12;
  k.forEach((lab, i) => {
    const row = Math.floor(i / per), cnt = Math.min(per, n - row * per), x = w * ((i % per) + .5) / cnt, ky = y + r + row * rowH;
    body += knob(x, ky, r, p.knob || knobFor(c), p.knobMark) + (labels ? T(x, ky + r + 6.5, String(lab).toUpperCase(), fitText(lab, w / cnt - 2, 5), ink, { weight: 600 }) : '');
  });
  const panelH = y + rows * rowH;
  y = panelH + 4;
  if (p.display) {
    const dw = Math.min(56, w * .76);
    body += R(w / 2 - dw / 2, y, dw, 15, '#0e1512', 2) + (typeof p.display === 'string' ? T(w / 2, y + 11, p.display, 8, '#7cfc9a', { weight: 600 }) : '');
    y += 21;
  }
  const txt = p.text ?? a.model, size = fitText(txt, w - 10, p.size || 12);
  y += size;
  body += T(w / 2, y, txt, size, p.textColor || ink, { weight: 800 });
  if (p.brandLabel !== false) { y += 9; body += T(w / 2, y, a.brand.toUpperCase(), fitText(a.brand, w - 10, 6), ink, { weight: 600, ls: .6 }); }
  const sw = p.switches ?? 1, fr = sw ? Math.min(9, w / (sw * 3.2)) : 0;
  if (sw) { y += 9; body += led(w / 2, y); }
  const h = Math.max(p.h || 0, Math.ceil(y + fr * 2 + 16));
  for (let i = 0; i < sw; i++) body += foot(w * (i + .5) / sw, h - fr - 9, fr);
  const panel = p.panel ? R(4, 4, w - 8, panelH - 2, p.panel, 3) : '';
  return { w, h, svg: R(0, 0, w, h, c, 5, edge(c)) + panel + body, jacks: sideJacks(w, 22) };
}

function round(p, a) {
  const d = 124, c = p.color || '#c81e1e', ink = p.ink || inkFor(c), k = p.knobs || [];
  let s = C(d / 2, d / 2, d / 2, c, edge(c));
  k.slice(0, 2).forEach((lab, i) => { const x = i ? 84 : 40; s += knob(x, 36, 10) + T(x, 22, lab, 5.5, ink, { weight: 600 }); });
  const txt = p.text ?? a.model;
  s += T(d / 2, 66, txt, fitText(txt, 80, 13), ink, { weight: 900, italic: true }) + T(d / 2, 76, a.brand.toUpperCase(), 6, ink, { weight: 600, ls: 1 }) + foot(d / 2, 96, 9);
  return { w: d, h: d, svg: s, jacks: sideJacks(d, d / 2) };
}

// Treadle pedals (wah, volume, Whammy). panelW adds a control panel on the right.
function wah(p, a) {
  const pw = p.panelW || 0, tw = p.w || 92, w = tw + pw, h = p.h || 180, c = p.color || '#1c1c1c', ink = p.ink || '#eeeeee';
  let s = R(0, 0, w, h, shade(c, -.3), 10, edge(c, -.6));
  s += R(6, 8, tw - 12, h - 16, c, 8, edge(c, -.5, 1));
  const txt = p.text ?? a.model;
  s += T(tw / 2, h * .26, txt, fitText(txt, tw - 24, 13), p.textColor || ink, { weight: 900 }) + T(tw / 2, h * .26 + 12, a.brand.toUpperCase(), 6.5, ink, { weight: 600, ls: 1 });
  s += R(14, h * .4, tw - 28, h * .52, '#151515', 5);
  for (let y = h * .4 + 6; y < h * .92 - 3; y += 6) s += L(20, y, tw - 20, y, '#2e2e2e', 2);
  if (pw) s += R(tw - 2, 8, pw - 6, h - 16, shade(c, .1), 5) + knob(tw + pw / 2 - 4, 34, 10) + R(tw + 4, 58, pw - 18, 16, '#1a0d0d', 2) + led(tw + pw / 2 - 4, 88);
  return { w, h, svg: s, jacks: sideJacks(w, 40) };
}

// ---------- multi-FX, rack ----------
const RING = ['#e53935', '#43a047', '#1e88e5', '#fdd835', '#8e24aa', '#fb8c00'];
function multifx(p, a) {
  const w = p.w || 320, h = p.h || 160, c = p.color || '#1d1d1f', ink = inkFor(c);
  const sw = p.switches ?? 8, rows = sw > 6 ? 2 : 1, per = Math.ceil(sw / rows), nk = p.knobs ?? 6;
  let s = R(0, 0, w, h, c, 8, edge(c, .25));
  const sx = w * .34, sW = w * .4, sH = Math.min(38, h * .24);
  s += R(sx, 10, sW, sH, '#14243a', 3, ' stroke="#000"');
  s += range(4).map(i => R(sx + 6 + i * (sW - 12) / 4, 10 + sH / 2 - 5, (sW - 12) / 4 - 4, 10, RING[(i + 1) % 6], 2)).join('');
  for (let i = 0; i < nk; i++) s += knob(sx + sW * (i + .5) / nk, 10 + sH + 13, 5.5, knobFor(c));
  const txt = p.text ?? a.model;
  s += T(12, 22, a.brand.toUpperCase(), fitText(a.brand, sx - 20, 8), ink, { anchor: 'start', ls: .8 }) + T(12, 38, txt, fitText(txt, sx - 20, 13), ink, { anchor: 'start', weight: 800 });
  const top = 10 + sH + 26, rowH = (h - top - 4) / rows, fr = Math.min(10, rowH * .28, w / per * .22);
  for (let i = 0; i < sw; i++) {
    const x = w * ((i % per) + .5) / per, y = top + rowH * (Math.floor(i / per) + .5);
    s += C(x, y, fr + 3, 'none', ` stroke="${RING[i % 6]}" stroke-width="2"`) + foot(x, y, fr);
  }
  return { w, h, svg: s, jacks: sideJacks(w, 20) };
}

function rack(p, a) {
  const u = p.u || 1, w = 320, h = 44 * u, c = p.color || '#1a1a1a', ink = inkFor(c);
  let s = R(0, 0, w, h, c, 2, edge(c, .25)) + R(0, 0, 14, h, shade(c, .12)) + R(w - 14, 0, 14, h, shade(c, .12));
  for (let i = 0; i < u; i++) for (const x of [7, w - 7]) s += C(x, 44 * i + 11, 2.2, '#000') + C(x, 44 * i + 33, 2.2, '#000');
  const txt = p.text ?? a.model;
  s += T(24, h / 2 - 3, a.brand.toUpperCase(), fitText(a.brand, 86, 7), ink, { anchor: 'start', ls: 1 }) + T(24, h / 2 + 10, txt, fitText(txt, 86, 11), ink, { anchor: 'start', weight: 800 });
  s += R(120, h / 2 - 10, 72, 20, '#140808', 2) + T(156, h / 2 + 4.5, p.screen ?? '', 11, '#ff4d3a', { extra: ' font-family="monospace"' });
  const nk = Array.isArray(p.knobs) ? p.knobs.length : p.knobs ?? 4;
  for (let i = 0; i < nk; i++) s += knob(nk > 1 ? 212 + i * 82 / (nk - 1) : 254, h / 2, 6, knobFor(c));
  return { w, h, svg: s, jacks: sideJacks(w, h / 2) };
}

// ---------- amps ----------
function head(p, a) {
  const w = p.w || 300, h = p.h || 112, c = p.color || '#1a1a1a', panel = p.panel || '#c9a44c';
  let s = R(0, 0, w, h, c, 8, edge(c, light(c) ? -.4 : .2));
  s += R(12, 10, w - 24, 54, p.grille || '#2b2724', 3) + R(12, 10, w - 24, 54, 'url(#rs-cloth)', 3);
  if (p.piping !== false) s += R(12, 67, w - 24, 1.6, p.piping || '#e8e2d0');
  const logo = p.logo ?? a.brand;
  s += T(w / 2, 46, logo, fitText(logo, w - 60, 24), p.logoColor || '#f4f1e8', { weight: 800, italic: p.italic, ls: 1 });
  const py = 72, ph = h - py - 10, cy = py + ph / 2, txt = p.text ?? a.model;
  s += R(12, py, w - 24, ph, panel, 3);
  s += T(22, cy + 3.5, txt, fitText(txt, w * .3, 10), p.panelInk || inkFor(panel), { anchor: 'start', weight: 800 });
  const nk = p.knobs ?? 6, x0 = w * .4, x1 = w - 50, step = nk > 1 ? (x1 - x0) / (nk - 1) : 0, r = Math.min(6.5, (step || 20) / 2.5);
  for (let i = 0; i < nk; i++) s += knob(x0 + i * step, cy, r, p.knob || knobFor(panel), p.knobMark || '#e8d9a8');
  return { w, h, svg: s, jacks: { in: { x: w - 28, y: cy, dx: 0, dy: -1, face: true } } };
}

function speakers(n, cols, x, y, w, h) {
  const rows = Math.ceil(n / cols), r = Math.min(w / cols, h / rows) * .4;
  return range(n).map(i => C(x + w * ((i % cols) + .5) / cols, y + h * (Math.floor(i / cols) + .5) / rows, r, 'none', ' stroke="#000" stroke-opacity=".22" stroke-width="2"')).join('');
}

function cab(p, a) {
  const w = p.w || 300, h = p.h || 300, c = p.color || '#1a1a1a', n = p.speakers || 4;
  let s = R(0, 0, w, h, c, 8, edge(c, light(c) ? -.4 : .2));
  const gx = 14, gy = p.slant ? 30 : 14, gw = w - 28, gh = h - gy - 14;
  if (p.slant) s += L(14, 22, w - 14, 22, shade(c, .25), 1.5);
  s += R(gx, gy, gw, gh, p.grille || '#2b2724', 4) + R(gx, gy, gw, gh, `url(#rs-${p.weave || 'cloth'})`, 4);
  s += speakers(n, p.cols || Math.min(n, 2), gx, gy, gw, gh);
  const logo = p.logo ?? a.brand;
  if (logo) {
    s += p.logoPos === 'top-left'
      ? T(gx + 14, gy + 26, logo, 18, p.logoColor || '#f4f1e8', { anchor: 'start', weight: 800, italic: p.italic })
      : T(w / 2, gy + Math.min(48, gh * .22), logo, fitText(logo, gw - 40, 28), p.logoColor || '#f4f1e8', { weight: 800, italic: p.italic, ls: 1 });
  }
  return { w, h, svg: s, jacks: {} };
}

function combo(p, a) {
  const w = p.w || 300, h = p.h || 220, c = p.color || '#1a1a1a', ph = 34, panel = p.panel || '#151515', cy = 8 + ph / 2;
  let s = R(0, 0, w, h, c, 10, edge(c, light(c) ? -.4 : .2)) + R(10, 8, w - 20, ph, panel, 3);
  const txt = p.text ?? a.model;
  const nk = p.knobs ?? 8, x0 = w * .38;
  s += T(40, cy + 3.5, txt, fitText(txt, x0 - 56, 9), p.panelInk || inkFor(panel), { anchor: 'start', weight: 800 });
  const x1 = w - 24, step = nk > 1 ? (x1 - x0) / (nk - 1) : 0, r = Math.min(6.5, (step || 20) / 2.6);
  for (let i = 0; i < nk; i++) s += knob(x0 + i * step, cy, r, p.knob || knobFor(panel), p.knobMark || '#fff');
  const gx = 14, gy = ph + 16, gw = w - 28, gh = h - gy - 12;
  s += R(gx, gy, gw, gh, p.grille || '#2b2724', 4) + R(gx, gy, gw, gh, `url(#rs-${p.weave || 'cloth'})`, 4);
  const n = p.speakers || 2;
  s += speakers(n, p.cols || Math.min(n, 2), gx, gy, gw, gh);
  const logo = p.logo ?? a.brand, lc = p.logoColor || '#f4f1e8';
  if (logo) {
    s += p.logoPos === 'center'
      ? T(w / 2, gy + 30, logo, fitText(logo, gw - 40, 22), lc, { weight: 800, italic: p.italic, ls: 1 })
      : T(gx + 14, gy + 26, logo, fitText(logo, gw * .5, 20), lc, { anchor: 'start', weight: 800, italic: p.italic ?? true });
  }
  return { w, h, svg: s, jacks: { in: { x: 26, y: cy, dx: 0, dy: -1, face: true } } };
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
    if (face) return C(x, y, 5, 'url(#rs-chrome)', ' stroke="#555" stroke-width=".8"') + C(x, y, 2.2, '#111');
    const st = ' stroke="#6d737b" stroke-width=".6"';
    return Math.abs(dx) >= Math.abs(dy) ? R(dx > 0 ? x : x - 6, y - 5, 6, 10, '#a3a9b0', 1, st) : R(x - 5, dy > 0 ? y : y - 6, 10, 6, '#a3a9b0', 1, st);
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

// ---------- whole rig ----------
export const itemName = (it, a) => it.label || (a ? `${a.brand} ${a.model}` : it.asset);
const CAPTIONED = new Set(['guitar', 'amp']);
const badge = (x, y, n) => C(x, y, 11, '#c62828', ' stroke="#fff" stroke-width="2"') + T(x, y + 4.3, n, 12, '#fff', { weight: 800 });

export function jackWorld(it, g, type) {
  const j = g.jacks[type];
  return j && { x: it.x + j.x, y: it.y + j.y, dx: j.dx, dy: j.dy };
}

function cablePath(a, b, color, label, attrs, ui) {
  const P = 12, dir = b.dx || b.dy;
  const p1 = { x: a.x + a.dx * P, y: a.y + a.dy * P }, p2 = dir ? { x: b.x + b.dx * P, y: b.y + b.dy * P } : b;
  const k = Math.max(40, Math.min(220, Math.hypot(p2.x - p1.x, p2.y - p1.y) * .45));
  const c1 = { x: p1.x + a.dx * k, y: p1.y + a.dy * k }, c2 = { x: p2.x + (b.dx || 0) * k, y: p2.y + (b.dy || 0) * k };
  const d = `M${f(p1.x)} ${f(p1.y)}C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  const plug = (j, q) => L(j.x, j.y, q.x, q.y, '#9aa0a7', 9) + L((j.x + q.x) / 2, (j.y + q.y) / 2, q.x, q.y, '#5f656c', 9);
  let s = `<g${attrs}>` + (ui ? `<path d="${d}" fill="none" stroke="transparent" stroke-width="18"/>` : '')
    + `<path d="${d}" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`
    + plug(a, p1) + (dir ? plug(b, p2) : '');
  if (label) {
    const mx = (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8, my = (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8;
    s += T(mx, my - 8, label.toUpperCase(), 10, '#111', { weight: 800, extra: ' stroke="#fff" stroke-width="4" stroke-linejoin="round" paint-order="stroke"' });
  }
  return s + '</g>';
}

function legend(rig, byId, nums, ui, selected) {
  const Lg = rig.legend;
  const list = rig.items.filter(it => nums.has(it.id)).sort((a, b) => nums.get(a.id) - nums.get(b.id));
  if (!Lg.show || !list.length) return '';
  const cols = Math.max(1, Lg.cols || 1), rows = Math.ceil(list.length / cols), CW = 260, RH = 38;
  let s = `<g data-legend="1" transform="translate(${f(Lg.x)} ${f(Lg.y)})">`;
  if (ui) s += R(-8, -8, cols * CW + 8, rows * RH + 6, 'transparent', 6, selected ? ' stroke="#1e88e5" stroke-width="2" stroke-dasharray="6 4"' : '');
  list.forEach((it, i) => {
    const a = byId[it.asset], x = Math.floor(i / rows) * CW, y = (i % rows) * RH;
    const name = itemName(it, a).toUpperCase(), sub = (it.note || a?.kind || '').toUpperCase();
    s += badge(x + 12, y + 12, nums.get(it.id)) + T(x + 30, y + 11, name, fitText(name, CW - 40, 11.5), '#111', { anchor: 'start', weight: 800 });
    if (sub) s += T(x + 30, y + 25, sub, fitText(sub, CW - 40, 10), '#666', { anchor: 'start', weight: 600 });
  });
  return s + '</g>';
}

// Full rig as SVG content (no outer <svg>). `ui` adds editor-only handles.
export function renderRig(rig, byId, { ui = false, sel = null, temp = null } = {}) {
  const W = rig.paper.w, H = rig.paper.h;
  const G = new Map(rig.items.map(it => [it.id, renderAsset(byId[it.asset], it)]));
  const nums = chainNumbers(rig, byId);
  let s = DEFS + R(0, 0, W, H, '#fff') + (ui ? R(0, 0, W, H, 'url(#rs-grid)', 0, ' pointer-events="none"') : '');
  if (rig.title) s += T(W / 2, 62, rig.title.toUpperCase(), fitText(rig.title, W - 80, 32), '#111', { weight: 800, ls: 1.5 });
  if (rig.subtitle) s += T(W / 2, 90, rig.subtitle, 15, '#777', { weight: 500 });
  for (const it of rig.items) {
    const g = G.get(it.id), a = byId[it.asset], n = nums.get(it.id);
    let cap = '';
    if (it.caption ?? CAPTIONED.has(a?.category)) {
      cap = T(g.w / 2, g.h + 22, itemName(it, a).toUpperCase(), 14, '#b3261e', { weight: 800 });
      if (it.note) cap += T(g.w / 2, g.h + 39, `(${it.note.toUpperCase()})`, 12, '#555');
    }
    s += `<g data-id="${esc(it.id)}" transform="translate(${f(it.x)} ${f(it.y)})"${ui ? ' class="item"' : ''}>`
      + (ui ? R(-4, -4, g.w + 8, g.h + 8, 'transparent') : '')
      + g.svg + cap + (n ? badge(g.w / 2, -16, n) : '')
      + (ui && sel?.kind === 'item' && sel.id === it.id ? R(-6, -6, g.w + 12, g.h + 12, 'none', 4, ' stroke="#1e88e5" stroke-width="2" stroke-dasharray="6 4"') : '')
      + '</g>';
  }
  const byItem = new Map(rig.items.map(it => [it.id, it]));
  rig.cables.forEach((c, i) => {
    const A = byItem.get(c.from), B = byItem.get(c.to);
    const a = A && jackWorld(A, G.get(A.id), 'out'), b = B && jackWorld(B, G.get(B.id), 'in');
    if (!a || !b) return;
    const on = ui && sel?.kind === 'cable' && sel.i === i;
    s += cablePath(a, b, on ? '#1e88e5' : paint(c.color || '#1f1f1f'), c.label, ui ? ` data-cable="${i}"` : '', ui);
  });
  s += legend(rig, byId, nums, ui, sel?.kind === 'legend');
  if (ui) {
    for (const it of rig.items) {
      for (const [type, j] of Object.entries(G.get(it.id).jacks)) {
        s += C(it.x + j.x, it.y + j.y, 6.5, type === 'in' ? '#2e7d32' : '#1565c0', ` stroke="#fff" stroke-width="2" class="jack" data-jack="${type}" data-id="${esc(it.id)}"`);
      }
    }
    if (temp) s += cablePath(temp.from, { x: temp.x, y: temp.y }, '#1e88e5', '', ' pointer-events="none" opacity=".8"', false);
  }
  return s;
}

export const exportSVG = (rig, byId) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${rig.paper.w}" height="${rig.paper.h}" viewBox="0 0 ${rig.paper.w} ${rig.paper.h}" font-family="${FONT}">${renderRig(rig, byId)}</svg>`;
