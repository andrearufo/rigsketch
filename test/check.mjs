// Sanity check for the catalog, the renderer and the file format. Run: node test/check.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { renderAsset, renderRig, exportSVG, TEMPLATES } from '../js/draw.js';
import { parseRig, CATEGORIES, GRID } from '../js/rig.js';
import { routeCables, moveSegment } from '../js/route.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const catalog = JSON.parse(read('../assets/catalog.json'));
const byId = {};
const clean = (svg, what) => assert.ok(!/NaN|undefined|Infinity|\{\{/.test(svg), `bad numbers or placeholders in ${what}`);

for (const a of catalog) {
  assert.match(a.id, /^[a-z0-9-]+$/, `bad id ${a.id}`);
  assert.ok(!byId[a.id], `duplicate id ${a.id}`);
  byId[a.id] = a;
  assert.ok(CATEGORIES.includes(a.category), `${a.id}: unknown category ${a.category}`);
  assert.ok(TEMPLATES[a.template], `${a.id}: unknown template ${a.template}`);
  assert.ok(a.brand && a.model, `${a.id}: brand and model are required`);
  const g = renderAsset(a);
  assert.ok(g.w > 0 && g.h > 0 && g.svg.length > 50, `${a.id}: empty render`);
  clean(g.svg, a.id);
  if (a.category === 'pedal' || a.category === 'fx') assert.ok(g.jacks.in && g.jacks.out, `${a.id}: needs in/out jacks`);
  if (a.category === 'guitar') assert.ok(g.jacks.out, `${a.id}: guitar needs an output`);
  // grid alignment: size in grid steps, jacks on a grid line across their direction
  if (a.template !== 'text') assert.ok(g.w % GRID === 0 && g.h % GRID === 0, `${a.id}: size ${g.w}x${g.h} not on the ${GRID}px grid`);
  for (const j of Object.values(g.jacks)) assert.ok((j.dx ? j.y : j.x) % GRID === 0, `${a.id}: jack off grid`);
}

// Example rig: loads, every asset exists, every cable gets an orthogonal route.
const ex = parseRig(read('../examples/classic-rock.rig.json'));
for (const it of ex.items) assert.ok(byId[it.asset], `example uses unknown asset ${it.asset}`);
const out = {};
const t0 = performance.now();
clean(exportSVG(ex, byId), 'example rig');
const ms = performance.now() - t0;
clean(renderRig(ex, byId, { ui: true, sel: { kind: 'item', id: 'i1' }, out }), 'example rig (ui)');
assert.equal(out.routes.length, ex.cables.length);
for (const r of out.routes) {
  assert.ok(r && r.length >= 2, 'cable without route');
  for (let i = 1; i < r.length; i++) assert.ok(r[i].x === r[i - 1].x || r[i].y === r[i - 1].y, 'diagonal cable segment');
}

// Router: a cable must go around an item standing between its ends.
const rect = (x, y, w, h) => ({ x, y, w, h });
const box = rig => routeCables(rig, new Map([['a', [rect(400, 100, 60, 100)]], ['b', [rect(100, 100, 60, 100)]], ['wall', [rect(240, 40, 60, 220)]]]),
  () => ({ a: { x: 400, y: 120, dx: -1, dy: 0 }, b: { x: 160, y: 120, dx: 1, dy: 0 } }));
const plain = { paper: { w: 600, h: 400 }, cables: [{ from: 'a', to: 'b' }] };
const [route] = box(plain);
const hits = (p, q) => Math.max(p.x, q.x) > 230 && Math.min(p.x, q.x) < 310 && Math.max(p.y, q.y) > 30 && Math.min(p.y, q.y) < 270;
for (let i = 1; i < route.length; i++) assert.ok(!hits(route[i - 1], route[i]), 'cable crosses an item');
// Dragging a middle segment keeps the cable orthogonal and attached.
const mid = route.findIndex((p, i) => i > 0 && i < route.length - 2 && p.y === route[i + 1].y);
const moved = box({ ...plain, cables: [{ from: 'a', to: 'b', points: moveSegment(route, mid, 40) }] })[0];
assert.deepEqual([moved[0], moved[moved.length - 1]], [route[0], route[route.length - 1]]);
for (let i = 1; i < moved.length; i++) assert.ok(moved[i].x === moved[i - 1].x || moved[i].y === moved[i - 1].y, 'diagonal after drag');

// A jack on the face of its own item (like a guitar) facing a jack in line with it:
// the item's own box must not count as an obstacle, so the cable is one straight run.
const straightRun = routeCables({ paper: { w: 400, h: 200 }, cables: [{ from: 'a', to: 'b' }] },
  new Map([['a', [rect(0, 0, 160, 120)]], ['b', [rect(300, 40, 60, 100)]]]),
  () => ({ a: { x: 120, y: 60, dx: 1, dy: 0 }, b: { x: 300, y: 60, dx: -1, dy: 0 } }))[0];
assert.equal(straightRun.length, 2, 'own box blocked a straight cable');

// Round trip and hostile input.
assert.deepEqual(parseRig(JSON.stringify(ex)), ex);
const evil = parseRig({
  format: 'rigsketch', version: 1, title: '<script>x</script>',
  items: [{ id: 'a', asset: 'boss-ds-1', x: 0, y: 0, color: '"/><script>', label: '<img onerror=x>', params: { onload: 'x' } }, { id: 'a', asset: 'dup', x: 1, y: 1 }],
  cables: [{ from: 'a', to: 'nope' }],
});
assert.equal(evil.items.length, 1);
assert.equal(evil.items[0].color, undefined);
assert.equal(evil.items[0].params, undefined);
assert.equal(evil.cables.length, 0);
const evilSvg = exportSVG(evil, byId);
assert.ok(!/<script|<img|<b>/.test(evilSvg), 'unescaped markup in output');
assert.throws(() => parseRig('{"format":"other"}'));
assert.throws(() => parseRig({ format: 'rigsketch', version: 99 }));

console.log(`ok: ${catalog.length} assets, example rig (${ms.toFixed(0)} ms), router, format checks`);
