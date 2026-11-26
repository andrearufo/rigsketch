// Rig document: the JSON file format, validation and signal-chain numbering.

export const FORMAT = 'rigsketch';
export const VERSION = 1;
export const CATEGORIES = ['guitar', 'pedal', 'amp', 'fx', 'misc'];
const NUMBERED = new Set(['pedal', 'fx']);

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const COLOR = /^(#[0-9a-fA-F]{3,8}|sunburst|cherryburst|tobacco)$/;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const num = (v, def, min = -1e5, max = 1e5) => (isNum(v) ? Math.min(max, Math.max(min, v)) : def);
const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : undefined);

export function emptyRig() {
  return {
    format: FORMAT, version: VERSION, title: 'My rig', subtitle: '',
    paper: { w: 1200, h: 1500 },
    legend: { show: true, x: 60, y: 1100, cols: 2 },
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
  if (typeof p.text === 'string') o.text = p.text.slice(0, 40);
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
    const o = { id: it.id, asset: it.asset.slice(0, 80), x: num(it.x, 0), y: num(it.y, 0) };
    for (const k of ['label', 'note', 'text']) if (typeof it[k] === 'string') o[k] = it[k].slice(0, 500);
    if (COLOR.test(it.color)) o.color = it.color;
    for (const k of ['flip', 'caption', 'number']) if (typeof it[k] === 'boolean') o[k] = it[k];
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
    cables.push(o);
  }
  const L = d.legend || {};
  return {
    format: FORMAT, version: VERSION,
    title: str(d.title) ?? base.title, subtitle: str(d.subtitle) ?? '',
    paper: { w: num(d.paper?.w, base.paper.w, 200, 8000), h: num(d.paper?.h, base.paper.h, 200, 8000) },
    legend: { show: typeof L.show === 'boolean' ? L.show : true, x: num(L.x, base.legend.x), y: num(L.y, base.legend.y), cols: Math.round(num(L.cols, 2, 1, 6)) },
    items, cables,
  };
}

// Number pedals and multi-FX in signal-chain order: depth-first along the cables,
// starting from guitars, then any other item without an incoming cable.
export function chainNumbers(rig, byId) {
  const cat = it => byId[it.asset]?.category;
  const next = new Map(), hasIn = new Set();
  for (const c of rig.cables) {
    if (!next.has(c.from)) next.set(c.from, []);
    next.get(c.from).push(c.to);
    hasIn.add(c.to);
  }
  const order = [], seen = new Set();
  const visit = id => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    for (const n of next.get(id) || []) visit(n);
  };
  rig.items.filter(it => !hasIn.has(it.id))
    .sort((a, b) => (cat(b) === 'guitar') - (cat(a) === 'guitar'))
    .forEach(it => visit(it.id));
  rig.items.forEach(it => visit(it.id));
  const byItem = new Map(rig.items.map(it => [it.id, it]));
  const nums = new Map();
  let n = 0;
  for (const id of order) {
    const it = byItem.get(id);
    if (NUMBERED.has(cat(it)) && it.number !== false) nums.set(id, ++n);
  }
  return nums;
}
