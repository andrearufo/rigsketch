// Sanity check for the catalog, the renderer and the file format. Run: node test/check.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { renderAsset, renderRig, exportSVG, TEMPLATES } from '../js/draw.js';
import { parseRig, chainNumbers, CATEGORIES } from '../js/rig.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const catalog = JSON.parse(read('../assets/catalog.json'));
const byId = {};
const clean = (svg, what) => assert.ok(!/NaN|undefined|Infinity/.test(svg), `bad numbers in ${what}`);

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
}

// Example rig: loads, every asset exists, numbering follows the cables.
const ex = parseRig(read('../examples/classic-rock.rig.json'));
for (const it of ex.items) assert.ok(byId[it.asset], `example uses unknown asset ${it.asset}`);
const nums = chainNumbers(ex, byId);
assert.deepEqual([...nums.entries()], [['i3', 1], ['i4', 2], ['i5', 3], ['i6', 4], ['i7', 5], ['i8', 6], ['i9', 7]]);
clean(exportSVG(ex, byId), 'example rig');
clean(renderRig(ex, byId, { ui: true, sel: { kind: 'item', id: 'i1' } }), 'example rig (ui)');

// Round trip and hostile input.
assert.deepEqual(parseRig(JSON.stringify(ex)), ex);
const evil = parseRig({
  format: 'rigsketch', version: 1, title: '<script>x</script>',
  items: [{ id: 'a', asset: 'boss-ds-1', x: 0, y: 0, color: '"/><script>', label: '<img onerror=x>', params: { text: '<b>', onload: 'x' } }, { id: 'a', asset: 'dup', x: 1, y: 1 }],
  cables: [{ from: 'a', to: 'nope' }],
});
assert.equal(evil.items.length, 1);
assert.equal(evil.items[0].color, undefined);
assert.deepEqual(evil.items[0].params, { text: '<b>' });
assert.equal(evil.cables.length, 0);
const evilSvg = exportSVG(evil, byId);
assert.ok(!/<script|<img|<b>/.test(evilSvg), 'unescaped markup in output');
assert.throws(() => parseRig('{"format":"other"}'));
assert.throws(() => parseRig({ format: 'rigsketch', version: 99 }));

console.log(`ok: ${catalog.length} assets, example rig, format checks`);
