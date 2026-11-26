// Rigsketch editor: library, canvas interactions, inspector, undo, import/export.
import { renderRig, renderAsset, exportSVG, jackWorld, ioOf, JACK_LABEL, FINISHES, DEFS, esc } from './draw.js';
import { emptyRig, parseRig, newId, GRID, encodeRig, decodeRig } from './rig.js';
import { moveSegment } from './route.js';

const REPO = 'https://github.com/andrearufo/rigsketch';
const EXAMPLE = 'examples/classic-rock.rig.json';
const KEY = 'rigsketch:rig';
const CATS = [['all', 'All'], ['guitar', 'Guitars'], ['pedal', 'Pedals'], ['amp', 'Amps & cabs'], ['fx', 'Multi-FX & rack'], ['misc', 'Other']];

const $ = s => document.querySelector(s);
const svg = $('#canvas'), insp = $('#inspector');
const catalog = await (await fetch('assets/catalog.json')).json();
const byId = Object.fromEntries(catalog.map(a => [a.id, a]));
document.body.insertAdjacentHTML('beforeend', `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${DEFS}</svg>`);

const last = {}; // routes from the latest render, for dragging cable segments
let rig, saved, hist = [], fut = [], sel = null, temp = null, drag = null, cat = 'all';
const view = { x: 0, y: 0, s: 1 };
let userView = false; // once the user pans or zooms, stop auto-fitting on resize
const snap = v => Math.round(v / GRID) * GRID;
const find = id => rig.items.find(i => i.id === id);

// ---------- state & history ----------
function store() { try { localStorage.setItem(KEY, saved); } catch { /* storage full or disabled: keep working */ } }
function commit() {
  const now = JSON.stringify(rig);
  if (now === saved) return;
  hist.push(saved);
  if (hist.length > 200) hist.shift();
  fut = [];
  saved = now;
  store();
}
function travel(from, to) {
  if (!from.length) return;
  to.push(saved);
  saved = from.pop();
  rig = JSON.parse(saved);
  store();
  if (sel && !selected()) sel = null;
  draw(); inspector();
}
const undo = () => travel(hist, fut), redo = () => travel(fut, hist);
function replace(r) {
  hist.push(saved); fut = [];
  rig = r; saved = JSON.stringify(r); store();
  sel = null; draw(); inspector(); fit();
}
function selected() {
  if (sel?.kind === 'item') return find(sel.id);
  return sel?.kind === 'cable' ? rig.cables[sel.i] : rig;
}
function select(s) { sel = s; inspector(); }

// ---------- canvas ----------
let raf = 0;
function draw() {
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; svg.innerHTML = renderRig(rig, byId, { ui: true, sel, temp, out: last }); });
}
function applyView() {
  if (!svg.clientWidth || !view.s) return;
  svg.setAttribute('viewBox', `${view.x} ${view.y} ${svg.clientWidth / view.s} ${svg.clientHeight / view.s}`);
  $('#zoomval').textContent = Math.round(view.s * 100) + '%';
}
function fit() {
  if (!rig) return; // resize fired before the rig loaded
  const W = svg.clientWidth, H = svg.clientHeight;
  if (!W || !H) return requestAnimationFrame(fit); // not laid out yet
  userView = false;
  view.s =Math.min(W / rig.paper.w, H / rig.paper.h) * .94;
  view.x = (rig.paper.w - W / view.s) / 2;
  view.y = (rig.paper.h - H / view.s) / 2;
  applyView();
}
function zoom(k, cx, cy) {
  userView = true;
  const s = Math.min(4, Math.max(.1, view.s * k));
  cx ??= view.x + svg.clientWidth / view.s / 2;
  cy ??= view.y + svg.clientHeight / view.s / 2;
  view.x = cx - (cx - view.x) * view.s / s;
  view.y = cy - (cy - view.y) * view.s / s;
  view.s = s;
  applyView();
}
const toWorld = e => new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
new ResizeObserver(() => (userView ? applyView() : fit())).observe(svg);

svg.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const p = toWorld(e), t = e.target;
  svg.setPointerCapture(e.pointerId);
  const jack = t.closest('[data-jack]'), item = t.closest('[data-id]'), cable = t.closest('[data-cable]'), seg = t.closest('[data-seg]');
  if (jack) {
    const it = find(jack.dataset.id);
    drag = { kind: 'wire', id: it.id, jack: jack.dataset.jack };
    temp = { from: jackWorld(it, renderAsset(byId[it.asset], it), jack.dataset.jack), x: p.x, y: p.y };
  } else if (item) {
    const it = find(item.dataset.id);
    select({ kind: 'item', id: it.id });
    drag = { kind: 'move', obj: it, dx: p.x - it.x, dy: p.y - it.y };
  } else if (seg && last.routes?.[+cable.dataset.cable]) {
    const i = +cable.dataset.cable, full = last.routes[i], k = +seg.dataset.seg;
    select({ kind: 'cable', i });
    drag = { kind: 'seg', c: rig.cables[i], full, k, horiz: full[k].y === full[k + 1].y, p, d: 0 };
  } else if (cable) {
    select({ kind: 'cable', i: +cable.dataset.cable });
  } else {
    if (sel) select(null);
    drag = { kind: 'pan', x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  }
  draw();
});
svg.addEventListener('pointermove', e => {
  if (!drag) return;
  if (drag.kind === 'pan') {
    userView = true;
    view.x = drag.vx - (e.clientX - drag.x) / view.s;
    view.y = drag.vy - (e.clientY - drag.y) / view.s;
    return applyView();
  }
  const p = toWorld(e);
  if (drag.kind === 'move') { drag.obj.x = snap(p.x - drag.dx); drag.obj.y = snap(p.y - drag.dy); }
  else if (drag.kind === 'seg') {
    const d = snap(drag.horiz ? p.y - drag.p.y : p.x - drag.p.x);
    if (d === drag.d) return;
    drag.d = d;
    const pts = moveSegment(drag.full, drag.k, d);
    if (pts) drag.c.points = pts;
  }
  else { temp.x = p.x; temp.y = p.y; }
  draw();
});
svg.addEventListener('pointerup', e => {
  if (drag?.kind === 'wire') {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-jack]');
    if (el && ioOf(el.dataset.jack) !== ioOf(drag.jack) && el.dataset.id !== drag.id) {
      const a = { id: drag.id, j: drag.jack }, b = { id: el.dataset.id, j: el.dataset.jack };
      const [o, i] = ioOf(a.j) === 'out' ? [a, b] : [b, a];
      if (!rig.cables.some(c => c.from === o.id && c.to === i.id && (c.fromJack || 'out') === o.j && (c.toJack || 'in') === i.j)) {
        rig.cables.push({ from: o.id, to: i.id, ...(o.j !== 'out' && { fromJack: o.j }), ...(i.j !== 'in' && { toJack: i.j }) });
        select({ kind: 'cable', i: rig.cables.length - 1 });
      }
    }
    temp = null;
  }
  if (drag?.kind === 'seg') inspector();
  drag = null;
  commit(); draw();
});
svg.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) { const p = toWorld(e); zoom(Math.exp(-e.deltaY * .01), p.x, p.y); }
  else { userView = true; view.x += e.deltaX / view.s; view.y += e.deltaY / view.s; applyView(); }
}, { passive: false });
svg.addEventListener('dragover', e => e.preventDefault());
svg.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) return openFile(file);
  const id = e.dataTransfer.getData('text/plain'), p = toWorld(e);
  if (byId[id]) add(id, p.x, p.y);
});
$('.zoom').addEventListener('click', e => {
  const z = e.target.dataset.z;
  if (z === 'in') zoom(1.25); else if (z === 'out') zoom(.8); else if (z === 'fit') fit();
});

// ---------- editing actions ----------
function add(id, x, y) {
  const a = byId[id], g = renderAsset(a);
  x ??= view.x + svg.clientWidth / view.s / 2;
  y ??= view.y + svg.clientHeight / view.s / 2;
  const it = { id: newId(rig), asset: id, x: snap(x - g.w / 2), y: snap(y - g.h / 2) };
  if (a.template === 'text') it.text = 'Your text here';
  rig.items.push(it);
  select({ kind: 'item', id: it.id });
  commit(); draw();
}
function remove() {
  if (sel?.kind === 'item') {
    rig.items = rig.items.filter(i => i.id !== sel.id);
    rig.cables = rig.cables.filter(c => c.from !== sel.id && c.to !== sel.id);
  } else if (sel?.kind === 'cable') rig.cables.splice(sel.i, 1);
  else return;
  select(null); commit(); draw();
}
function duplicate() {
  if (sel?.kind !== 'item') return;
  const it = { ...structuredClone(find(sel.id)), id: newId(rig) };
  it.x += 20; it.y += 20;
  rig.items.push(it);
  select({ kind: 'item', id: it.id }); commit(); draw();
}

addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, select')) return;
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if (mod && k === 'd') { e.preventDefault(); duplicate(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
  else if (e.key === 'Escape') { select(null); draw(); }
  else if (e.key.startsWith('Arrow') && sel?.kind === 'item') {
    e.preventDefault();
    const it = find(sel.id), d = GRID * (e.shiftKey ? 5 : 1);
    it.x += e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
    it.y += e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
    commit(); draw();
  }
});

// ---------- library ----------
const thumbs = Object.fromEntries(catalog.map(a => {
  const g = renderAsset(a);
  return [a.id, `<svg viewBox="-6 -6 ${g.w + 12} ${g.h + 12}" aria-hidden="true">${g.svg}</svg>`];
}));
function library() {
  const q = $('#search').value.trim().toLowerCase(), terms = q.split(/\s+/).filter(Boolean);
  const list = catalog
    .filter(a => (cat === 'all' || a.category === cat) && terms.every(t => `${a.brand} ${a.model} ${a.kind || ''}`.toLowerCase().includes(t)))
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
  $('#cats').innerHTML = CATS.map(([k, l]) => `<button class="${k === cat ? 'on' : ''}" data-cat="${k}">${l}</button>`).join('');
  let html = '', brand = null;
  for (const a of list) {
    if (a.brand !== brand) { brand = a.brand; html += `<h3>${esc(brand)}</h3>`; }
    html += `<button class="asset" draggable="true" data-asset="${a.id}" title="Click or drag onto the canvas">${thumbs[a.id]}<span>${esc(a.model)}<small>${esc(a.kind || '')}</small></span></button>`;
  }
  const url = `${REPO}/issues/new?template=asset-request.yml&title=${encodeURIComponent('[Asset] ' + q)}&model=${encodeURIComponent(q)}`;
  html += `<p class="req">${list.length ? 'Missing something?' : `No match for “${esc(q)}”.`} <a href="${url}" target="_blank" rel="noopener">Request a new asset →</a></p>`;
  $('#assets').innerHTML = html;
}
$('#search').addEventListener('input', library);
$('#cats').addEventListener('click', e => { if (e.target.dataset.cat) { cat = e.target.dataset.cat; library(); } });
$('#assets').addEventListener('click', e => { const b = e.target.closest('[data-asset]'); if (b) add(b.dataset.asset); });
$('#assets').addEventListener('dragstart', e => { const b = e.target.closest('[data-asset]'); if (b) e.dataTransfer.setData('text/plain', b.dataset.asset); });

// ---------- inspector ----------
const field = (label, html) => `<label class="f"><span>${label}</span>${html}</label>`;
const check = (label, k, on) => `<label class="c"><input type="checkbox" data-k="${k}"${on ? ' checked' : ''}> ${label}</label>`;
const hex6 = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#000000');
const HELP = `<div class="help"><h3>How to</h3><ul>
<li><b>Add gear</b>: click it or drag it from the left panel.</li>
<li><b>Connect</b>: drag from an <i class="dot out"></i> output to an <i class="dot in"></i> input.</li>
<li><b>Move the view</b>: drag the background or scroll. <b>Zoom</b>: pinch or ⌘/Ctrl + scroll.</li>
<li><b>Delete</b>: select and press ⌫. <b>Undo</b>: ⌘/Ctrl + Z. <b>Duplicate</b>: ⌘/Ctrl + D.</li>
<li><b>Cables</b> route themselves around your gear. Drag a cable segment to move it; <b>Reset route</b> undoes that.</li>
<li>Everything snaps to the grid. Arrow keys move the selection one step (⇧ for five).</li>
<li>Some gear has more jacks: stereo outputs, FX loop, speaker out. Hover a jack to see its name.</li>
<li>Your rig is saved in this browser. <b>Save</b> downloads a <code>.rig.json</code> file, <b>Share link</b> copies a link that opens it.</li></ul></div>`;

function inspector() {
  const o = selected();
  let h;
  if (sel?.kind === 'item') {
    const a = byId[o.asset] || { brand: 'Unknown', model: o.asset, category: 'misc', params: {} };
    h = `<h2>${esc(a.brand)} ${esc(a.model)}</h2><p class="muted">${esc(a.kind || a.category)}</p>`;
    if (a.template === 'text') {
      h += field('Text', `<textarea data-k="text" rows="4">${esc(o.text)}</textarea>`)
        + field('Size', `<input type="number" min="6" max="160" data-k="params.size" value="${o.params?.size ?? a.params?.size ?? 16}">`);
    } else {
      h += field('Label', `<input data-k="label" value="${esc(o.label)}" placeholder="${esc(a.brand + ' ' + a.model)}">`)
        + field('Note', `<input data-k="note" value="${esc(o.note)}" placeholder="e.g. 1974, Vintage, Sunburst">`);
    }
    if (a.custom) {
      h += field('Knobs (comma separated)', `<input data-k="params.knobs" value="${esc((o.params?.knobs ?? a.params.knobs ?? []).join(', '))}">`);
    }
    const finishes = a.category === 'guitar'
      ? `<select data-k="color"><option value="">Finish…</option>${Object.entries(FINISHES).map(([n, v]) => `<option value="${v}"${v === o.color ? ' selected' : ''}>${n}</option>`).join('')}</select>` : '';
    h += `<div class="f"><span>Colour</span><div class="row">${finishes}<input type="color" data-k="color" value="${hex6(o.color || a.params?.color)}"><button type="button" data-act="resetColor">Reset</button></div></div>`;
    if (a.category === 'guitar') h += check('Left-handed', 'flip', o.flip);
    if (a.template !== 'text') h += check('Show caption', 'caption', o.caption ?? true);
    h += `<div class="actions"><button data-act="dup">Duplicate</button><button data-act="del" class="danger">Delete</button></div>`;
  } else if (sel?.kind === 'cable') {
    const nm = (id, j) => esc(byId[find(id)?.asset]?.model || id) + (j ? ` (${JACK_LABEL[j] || j})` : '');
    h = `<h2>Cable</h2><p class="muted">${nm(o.from, o.fromJack)} → ${nm(o.to, o.toJack)}</p>`
      + field('Label', `<input data-k="label" value="${esc(o.label)}" placeholder="e.g. To JCM800 head">`)
      + `<div class="f"><span>Colour</span><div class="row"><input type="color" data-k="color" value="${hex6(o.color || '#1f1f1f')}"><button type="button" data-act="resetColor">Reset</button></div></div>`
      + `<div class="actions">${o.points ? '<button data-act="reroute">Reset route</button>' : ''}<button data-act="del" class="danger">Delete cable</button></div>`;
  } else {
    h = `<h2>Rig</h2><p class="muted">Nothing selected</p>`
      + field('Title', `<input data-k="title" value="${esc(rig.title)}">`)
      + field('Subtitle', `<input data-k="subtitle" value="${esc(rig.subtitle)}">`)
      + `<div class="row2">${field('Width', `<input type="number" min="200" max="8000" step="20" data-k="paper.w" value="${rig.paper.w}">`)}${field('Height', `<input type="number" min="200" max="8000" step="20" data-k="paper.h" value="${rig.paper.h}">`)}</div>`
      + HELP;
  }
  insp.innerHTML = h;
}
function setPath(o, path, v) {
  const ks = path.split('.'), last = ks.pop();
  for (const k of ks) o = o[k] ??= {};
  if (v === '' || v === undefined || (Array.isArray(v) && !v.length)) delete o[last]; else o[last] = v;
}
insp.addEventListener('input', e => {
  const el = e.target, k = el.dataset.k;
  if (!k) return;
  let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? '' : +el.value) : el.value;
  if (k === 'params.knobs') v = v.split(',').map(s => s.trim()).filter(Boolean).slice(0, 8);
  if (['paper.w', 'paper.h'].includes(k) && !(v >= 200)) return; // ignore half-typed sizes
  setPath(selected(), k, v);
  draw();
});
insp.addEventListener('change', e => { if (e.target.dataset.k) commit(); });
insp.addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  const acts = {
    del: remove, dup: duplicate,
    resetColor: () => { delete selected().color; commit(); draw(); inspector(); },
    reroute: () => { delete selected().points; commit(); draw(); inspector(); },
  };
  acts[act]?.();
});

// ---------- files ----------
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const baseName = () => (rig.title || 'rig').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'rig';
async function openFile(file) {
  try { replace(parseRig(await file.text())); }
  catch (err) { alert(`Could not open “${file.name}”: ${err.message}`); }
}
async function png() {
  const url = URL.createObjectURL(new Blob([exportSVG(rig, byId)], { type: 'image/svg+xml' }));
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = rig.paper.w * 2; c.height = rig.paper.h * 2;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  c.toBlob(b => download(b, baseName() + '.png'));
}
async function share(btn) {
  const url = `${location.origin}${location.pathname}#r=${await encodeRig(rig)}`;
  try {
    await navigator.clipboard.writeText(url);
    const old = btn.textContent;
    btn.textContent = 'Link copied ✓';
    setTimeout(() => { btn.textContent = old; }, 2000);
  } catch { prompt('Copy this link:', url); }
}
// Open a rig shared as #r=…, then drop the hash so a reload keeps the user's edits.
async function openShared() {
  const code = location.hash.match(/^#r=([\w-]+)$/)?.[1];
  if (!code) return;
  history.replaceState(null, '', location.pathname + location.search);
  try { replace(await decodeRig(code)); }
  catch (err) { alert(`Could not open the shared rig: ${err.message}`); }
}
addEventListener('hashchange', openShared);
const actions = {
  new: () => replace(emptyRig()),
  example: async () => replace(parseRig(await (await fetch(EXAMPLE)).text())),
  save: () => download(new Blob([JSON.stringify(rig, null, 2)], { type: 'application/json' }), baseName() + '.rig.json'),
  svg: () => download(new Blob([exportSVG(rig, byId)], { type: 'image/svg+xml' }), baseName() + '.svg'),
  png, undo, redo, share,
};
$('header').addEventListener('click', e => { const b = e.target.closest('[data-action]'); actions[b?.dataset.action]?.(b); });
$('#open').addEventListener('change', e => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; });
$('#request').href = `${REPO}/issues/new?template=asset-request.yml`;

// ---------- start ----------
try { rig = parseRig(localStorage.getItem(KEY)); }
catch { rig = parseRig(await (await fetch(EXAMPLE)).text()); }
saved = JSON.stringify(rig);
library(); inspector(); draw(); fit();
openShared();
