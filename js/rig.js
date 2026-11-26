// Rig document: the JSON file format and its validation.

export const FORMAT = 'rigsketch';
export const VERSION = 1;
export const CATEGORIES = ['guitar', 'pedal', 'amp', 'fx', 'misc'];
export const GRID = 20; // everything snaps to this grid, cables are routed on it
const snap = v => Math.round(v / GRID) * GRID;

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const COLOR = /^(#[0-9a-fA-F]{3,8}|sunburst|cherryburst|tobacco)$/;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const num = (v, def, min = -1e5, max = 1e5) => (isNum(v) ? Math.min(max, Math.max(min, v)) : def);
const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : undefined);

export function emptyRig() {
  return {
    format: FORMAT, version: VERSION, title: 'My rig', subtitle: '',
    paper: { w: 1200, h: 1500 },
    items: [], cables: [],
  };
}

export function newId(rig) {
  const ids = new Set(rig.items.map(i => i.id));
  let n = rig.items.length + 1;
  while (ids.has('i' + n)) n++;
  return 'i' + n;
}

// Item params a user (or an imported file) may override. Everything else comes
// from the trusted catalog, so nothing in a file can reach SVG attributes unchecked.
function cleanParams(p) {
  const o = {};
  if (Array.isArray(p.knobs)) o.knobs = p.knobs.filter(k => typeof k === 'string').slice(0, 8).map(k => k.slice(0, 16));
  if (isNum(p.size)) o.size = num(p.size, 16, 6, 160);
  return o;
}

// Parse and normalise a rig (string or object). Throws on anything that is not a rig.
export function parseRig(input) {
  const d = typeof input === 'string' ? JSON.parse(input) : input;
  if (!d || typeof d !== 'object' || d.format !== FORMAT) throw new Error('This is not a Rigsketch file.');
  if (!(d.version <= VERSION)) throw new Error(`File version ${d.version} is newer than this app supports (${VERSION}).`);
  const base = emptyRig();
  const items = [], ids = new Set();
  for (const it of Array.isArray(d.items) ? d.items : []) {
    if (!it || !ID.test(it.id) || ids.has(it.id) || typeof it.asset !== 'string') continue;
    ids.add(it.id);
    const o = { id: it.id, asset: it.asset.slice(0, 80), x: snap(num(it.x, 0)), y: snap(num(it.y, 0)) };
    for (const k of ['label', 'note', 'text']) if (typeof it[k] === 'string') o[k] = it[k].slice(0, 500);
    if (COLOR.test(it.color)) o.color = it.color;
    for (const k of ['flip', 'caption']) if (typeof it[k] === 'boolean') o[k] = it[k];
    if (it.params && typeof it.params === 'object') {
      const p = cleanParams(it.params);
      if (Object.keys(p).length) o.params = p;
    }
    items.push(o);
  }
  const cables = [];
  for (const c of Array.isArray(d.cables) ? d.cables : []) {
    if (!c || !ids.has(c.from) || !ids.has(c.to) || c.from === c.to) continue;
    const o = { from: c.from, to: c.to };
    if (typeof c.label === 'string' && c.label) o.label = c.label.slice(0, 80);
    if (COLOR.test(c.color)) o.color = c.color;
    if (Array.isArray(c.points)) {
      const pts = c.points.filter(q => Array.isArray(q) && isNum(q[0]) && isNum(q[1])).slice(0, 100).map(([x, y]) => [snap(num(x, 0)), snap(num(y, 0))]);
      if (pts.length) o.points = pts;
    }
    cables.push(o);
  }
  return {
    format: FORMAT, version: VERSION,
    title: str(d.title) ?? base.title, subtitle: str(d.subtitle) ?? '',
    paper: { w: num(d.paper?.w, base.paper.w, 200, 8000), h: num(d.paper?.h, base.paper.h, 200, 8000) },
    items, cables,
  };
}
