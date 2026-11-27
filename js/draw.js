// Rigsketch renderer.
// Pure functions that turn rig data into SVG markup strings. No DOM access, so the
// same code draws the editor, the SVG/PNG exports, and runs in Node (test/check.mjs).
//
// Every asset is sized in multiples of the 20 px grid and its jacks sit on grid lines,
// so items snap cleanly and cables can be routed on the grid (see route.js).

import { routeCables, simplify } from './route.js';
import { SILHOUETTES } from './silhouettes.js';

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

const BURST_STOPS = {
  sunburst: ['#f2b53e', '#b0501c', '#1f0d05'], cherryburst: ['#eda04a', '#b52a1c', '#3a0a06'], tobacco: ['#d49a4a', '#6a3414', '#140904'],
};
// One gradient per finish and silhouette, centred on the lower bout of the body.
const BURSTS = Object.entries(BURST_STOPS).flatMap(([k, [a, b, c]]) => Object.entries(SILHOUETTES).map(([s, { w, h }]) =>
  `<radialGradient id="rs-${k}-${s}" gradientUnits="userSpaceOnUse" cx="${w / 2}" cy="${f(h * .82)}" r="${f(w * .52)}"><stop offset=".3" stop-color="${a}"/><stop offset=".67" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></radialGradient>`)).join('');

export const DEFS = `<defs>
${BURSTS}
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
// Jacks are named; the name says the direction: in, in2 and return take signal, the rest give it.
// Inputs sit on the right edge and outputs on the left, like on a real pedal; the second
// (stereo / B) pair and the FX loop go one and two grid steps lower.
export const ioOf = name => (/^(in|return)/.test(name) ? 'in' : 'out');
export const JACK_LABEL = { in: 'Input', out: 'Output', in2: 'Input R', out2: 'Output R / B', send: 'FX send', return: 'FX return', spk: 'Speaker out' };
const J = (x, y, dx, dy = 0, face) => ({ x, y, dx, dy, ...(face && { face }) });
const sideJacks = (w, y, p = {}) => ({
  in: J(w, y, 1), out: J(0, y, -1),
  ...(p.stereo && { out2: J(0, y + 20, -1) }), ...(p.stereoIn && { in2: J(w, y + 20, 1) }),
  ...(p.loop && { send: J(0, y + 40, -1), return: J(w, y + 40, 1) }),
});
const shell = (w, h, c, rx = 6) => R(0, 0, w, h, c, rx, line('#111', 2)) + R(0, 0, w, h, 'url(#rs-sheen)', rx);

// ---------- guitars ----------
// Flat silhouettes traced from public-domain drawings (tools/silhouettes.py), filled with
// the finish: the outline is what tells a Strat from a Les Paul, no parts are drawn.
function guitar(p) {
  const key = SILHOUETTES[p.shape] ? p.shape : 'st', S = SILHOUETTES[key], c = p.color || '#1a1a1a';
  const fill = GRADIENTS[c] ? `url(#rs-${c}-${key})` : c;
  return { w: S.w, h: S.h, svg: P(S.d, fill, line('#111', 1.6)) + P(S.d, 'url(#rs-gloss)'), jacks: { out: { ...S.jack, dx: 1, dy: 0 } } };
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
  return { w, h, svg: s, jacks: sideJacks(w, 20, p) };
}

function ts(p) {
  const w = 60, h = 100, c = p.color || '#2e8b57';
  let s = shell(w, h, c, 8) + knob(15, 16, 7.5) + knob(45, 16, 7.5) + knob(30, 32, 6.5) + led(30, 8);
  s += R(6, 46, w - 12, h - 52, shade(c, -.3), 5, line('#111', 1.2)) + R(11, 52, w - 22, h - 64, shade(c, -.55), 3);
  return { w, h, svg: s, jacks: sideJacks(w, 20, p) };
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
    body += knob(w * ((i % per) + .5) / cnt, y + r + row * rowH, r, knobFor(c));
  });
  y += rows * rowH + 2;
  if (p.display) { const dw = Math.min(56, w * .7); body += R(w / 2 - dw / 2, y, dw, 14, '#0e1512', 2, line('#111', 1)); y += 18; }
  if (p.accent) { const ah = Math.max(10, Math.min(22, w * .2)); body += R(7, y, w - 14, ah, p.accent, 3, line('#111', .8)); y += ah + 4; }
  const sw = p.switches ?? 1, fr = sw ? Math.min(8.5, w / (sw * 3.4)) : 0;
  const h = Math.max(p.h || 0, Math.ceil((y + (sw ? fr * 2 + 22 : 6)) / 20) * 20);
  if (sw) body += led(w / 2, h - fr * 2 - 14);
  for (let i = 0; i < sw; i++) body += foot(w * (i + .5) / sw, h - fr - 7, fr);
  return { w, h, svg: shell(w, h, c, 5) + body, jacks: sideJacks(w, 20, p) };
}

function round(p) {
  const d = 100, c = p.color || '#c81e1e';
  const s = C(50, 50, 50, c, line('#111', 2)) + C(50, 50, 50, 'url(#rs-sheen)') + knob(31, 30, 8.5) + knob(69, 30, 8.5) + foot(50, 72, 9);
  return { w: d, h: d, svg: s, jacks: sideJacks(d, 40, p) };
}

// Treadle pedals (wah, volume, Whammy). panelW adds a control panel on the right.
function wah(p) {
  const pw = p.panelW || 0, tw = p.w || 80, w = tw + pw, h = p.h || 160, c = p.color || '#1c1c1c';
  let s = R(0, 0, w, h, shade(c, -.3), 9, line('#111', 2));
  s += R(5, 6, tw - 10, h - 12, c, 8, line('#111', 1.4)) + R(5, 6, tw - 10, h - 12, 'url(#rs-sheen)', 8);
  s += R(12, h * .36, tw - 24, h * .54, '#161616', 5);
  for (let y = h * .36 + 6; y < h * .9 - 3; y += 6) s += L(17, y, tw - 17, y, '#333', 2);
  if (pw) s += R(tw - 1, 6, pw - 5, h - 12, shade(c, .1), 5, line('#111', 1.4)) + knob(tw + pw / 2 - 3, 30, 9) + R(tw + 5, 52, pw - 16, 16, '#1a0d0d', 2) + led(tw + pw / 2 - 3, 84);
  return { w, h, svg: s, jacks: sideJacks(w, 40, p) };
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
  return { w, h, svg: s, jacks: sideJacks(w, 20, p) };
}

function rack(p) {
  const u = p.u || 1, w = 320, h = 40 * u, c = p.color || '#1a1a1a';
  let s = shell(w, h, c, 2) + R(0, 0, 14, h, shade(c, .14), 0, line('#111', 1)) + R(w - 14, 0, 14, h, shade(c, .14), 0, line('#111', 1));
  for (let i = 0; i < u; i++) for (const x of [7, w - 7]) s += C(x, 40 * i + 10, 2.2, '#000') + C(x, 40 * i + 30, 2.2, '#000');
  s += R(40, h / 2 - 10, 100, 20, '#140808', 2, line('#000', 1)) + (p.screen ? T(90, h / 2 + 4.5, p.screen, 12, '#ff4d3a', { extra: ' font-family="monospace"' }) : '');
  const nk = Array.isArray(p.knobs) ? p.knobs.length : p.knobs ?? 4;
  for (let i = 0; i < nk; i++) s += knob(nk > 1 ? 180 + i * 110 / (nk - 1) : 235, h / 2, 7, knobFor(c));
  return { w, h, svg: s, jacks: sideJacks(w, h / 2, p) };
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
  return { w, h, svg: s, jacks: { in: J(w - 40, 100, 0, -1, true), spk: J(w, 100, 1), ...(p.loop && { send: J(0, 60, -1), return: J(0, 100, -1) }) } };
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
  return { w, h, svg: s, jacks: { in: J(w, 40, 1) } };
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
  return { w, h, svg: s, jacks: { in: J(40, 40, 0, -1, true), ...(p.loop && { send: J(0, 100, -1), return: J(0, 140, -1) }) } };
}

// ---------- misc ----------
function text(p) {
  const lines = String(p.text ?? 'Text').split('\n'), size = p.size || 16, lh = size * 1.3;
  const w = Math.max(20, ...lines.map(l => l.length * size * .62)), h = lines.length * lh;
  return { w, h, svg: lines.map((l, i) => T(0, lh * (i + 1) - size * .32, l, size, p.color || '#111', { anchor: 'start' })).join(''), jacks: {} };
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
  return Object.values(jacks).map(({ x, y, dx, face }) => {
    if (face) return C(x, y, 5.5, 'url(#rs-chrome)', line('#111', 1)) + C(x, y, 2.4, '#111');
    return R(dx > 0 ? x : x - 6, y - 5, 6, 10, '#a3a9b0', 1, line('#111', .8)); // side jacks are horizontal
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
  const d = rounded(full), color = on ? '#1e88e5' : (GRADIENTS[c.color] || c.color || '#1f1f1f');
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
    const a = A && jackWorld(A, G.get(A.id), c.fromJack || 'out'), b = B && jackWorld(B, G.get(B.id), c.toJack || 'in');
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
        s += `<circle cx="${f(it.x + j.x)}" cy="${f(it.y + j.y)}" r="6.5" fill="${ioOf(type) === 'in' ? '#2e7d32' : '#1565c0'}" stroke="#fff" stroke-width="2" class="jack" data-jack="${type}" data-id="${esc(it.id)}"><title>${JACK_LABEL[type] || type}</title></circle>`;
      }
    }
    if (temp) s += L(temp.from.x, temp.from.y, temp.x, temp.y, '#1e88e5', 4, ' stroke-dasharray="8 6" stroke-linecap="round" pointer-events="none"');
  }
  return s;
}

export const exportSVG = (rig, byId) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${rig.paper.w}" height="${rig.paper.h}" viewBox="0 0 ${rig.paper.w} ${rig.paper.h}" font-family="${FONT}">${renderRig(rig, byId)}</svg>`;
