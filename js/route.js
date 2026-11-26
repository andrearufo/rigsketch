// Orthogonal cable routing on the grid.
// A* over grid nodes with a direction per state: cables avoid item boxes (and their
// captions), pay a penalty for each bend and for sharing a node with an earlier cable,
// so they come out as tidy horizontal/vertical runs that bundle side by side.
import { GRID } from './rig.js';

const PAD = 10;    // clearance around items: cables run at least one grid step away
const BEND = 4;    // cost of a corner, in grid steps
const SHARE = 3;   // cost of running over a node another cable already uses
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
const snap = v => Math.round(v / GRID) * GRID;
const dirOf = (dx, dy) => (dx > 0 ? 0 : dy > 0 ? 1 : dx < 0 ? 2 : 3);
const inside = (b, x, y) => b.x0 < x && x < b.x1 && b.y0 < y && y < b.y1;
export const pad = r => ({ x0: r.x - PAD, y0: r.y - PAD, x1: r.x + r.w + PAD, y1: r.y + r.h + PAD });

// First grid point past the item's padded box, walking out of the jack.
function exit(j, boxes) {
  let x = j.x, y = j.y;
  do { x += j.dx * GRID; y += j.dy * GRID; } while (boxes.some(b => inside(b, x, y)));
  return { x: j.dx ? snap(x) : x, y: j.dy ? snap(y) : y };
}

// Remove repeated and collinear points (keeps the first and last).
export function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const a = out[out.length - 1], b = out[out.length - 2];
    if (a && a.x === p.x && a.y === p.y) continue;
    if (a && b && ((b.x === a.x && a.x === p.x) || (b.y === a.y && a.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}

// A user-adjusted route: stored interior points, re-joined to the (maybe moved) jacks
// with right-angle elbows. Returns [jack, stub, ...points, stub, jack].
function manual(jA, sA, points, sB, jB) {
  const mid = [sA];
  for (const [x, y] of [...points, [sB.x, sB.y]]) {
    const a = mid[mid.length - 1];
    if (a.x !== x && a.y !== y) mid.push({ x, y: a.y });
    mid.push({ x, y });
  }
  return [jA, ...mid, jB];
}

// Drag segment k (between full[k] and full[k+1]) sideways by d. The two stubs that
// leave the jacks stay put: moving a segment next to one adds a short jog instead.
// Returns the interior points to store on the cable, or null if k is a stub.
export function moveSegment(full, k, d) {
  if (k < 1 || k > full.length - 3) return null;
  const pts = full.map(p => ({ ...p }));
  const horiz = pts[k].y === pts[k + 1].y;
  if (k === 1) { pts.splice(1, 0, { ...pts[1] }); k++; }
  if (k + 1 === pts.length - 2) pts.splice(k + 1, 0, { ...pts[k + 1] });
  if (horiz) { pts[k].y += d; pts[k + 1].y += d; } else { pts[k].x += d; pts[k + 1].x += d; }
  return simplify(pts.slice(2, -2)).map(p => [p.x, p.y]);
}

// Route every cable. `rects` maps item id -> [item rect, caption rect, ...] in world px.
// `jacks(cable)` returns {a, b} world jacks or null. Returns one full point list per cable.
export function routeCables(rig, rects, jacks) {
  const all = [...rects.values()].flat().map(pad);
  let minX = 0, minY = 0, maxX = rig.paper.w, maxY = rig.paper.h;
  for (const b of all) { minX = Math.min(minX, b.x0); minY = Math.min(minY, b.y0); maxX = Math.max(maxX, b.x1); maxY = Math.max(maxY, b.y1); }
  minX = snap(minX) - 5 * GRID; minY = snap(minY) - 5 * GRID; maxX = snap(maxX) + 5 * GRID; maxY = snap(maxY) + 5 * GRID;
  const cols = (maxX - minX) / GRID + 1, rows = (maxY - minY) / GRID + 1, N = cols * rows;
  const node = (x, y) => ((y - minY) / GRID) * cols + (x - minX) / GRID;
  const blocked = new Uint8Array(N), used = new Uint8Array(N);
  for (const b of all) {
    for (let x = snap(b.x0); x <= b.x1; x += GRID) for (let y = snap(b.y0); y <= b.y1; y += GRID) {
      if (inside(b, x, y) && x >= minX && x <= maxX && y >= minY && y <= maxY) blocked[node(x, y)] = 1;
    }
  }
  const g = new Float32Array(N * 4), parent = new Int32Array(N * 4), closed = new Uint8Array(N * 4);
  const heap = new MinHeap();

  function astar(s, sd, t, td) {
    g.fill(Infinity); closed.fill(0); heap.clear();
    const S = node(s.x, s.y), T = node(t.x, t.y), tx = (t.x - minX) / GRID, ty = (t.y - minY) / GRID;
    const h = n => Math.abs((n % cols) - tx) + Math.abs(Math.floor(n / cols) - ty);
    g[S * 4 + sd] = 0; parent[S * 4 + sd] = -1;
    heap.push(S * 4 + sd, h(S));
    while (heap.size) {
      const st = heap.pop();
      if (closed[st]) continue;
      closed[st] = 1;
      const n = st >> 2, d = st & 3;
      if (n === T) return trace(st);
      const cx = n % cols, cy = Math.floor(n / cols);
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (d + 2) % 4) continue;
        const nx = cx + DX[nd], ny = cy + DY[nd];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const m = ny * cols + nx;
        if (blocked[m] && m !== T) continue;
        let cost = g[st] + 1 + (nd !== d ? BEND : 0) + (used[m] ? SHARE : 0);
        if (m === T && nd !== td) cost += BEND;
        const ns = m * 4 + nd;
        if (cost < g[ns]) { g[ns] = cost; parent[ns] = st; heap.push(ns, cost + h(m)); }
      }
    }
    return null;
  }
  function trace(st) {
    const pts = [];
    for (; st !== -1; st = parent[st]) { const n = st >> 2; pts.push({ x: minX + (n % cols) * GRID, y: minY + Math.floor(n / cols) * GRID }); }
    return pts.reverse();
  }
  function mark(pts) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (a.x === b.x && a.x % GRID === 0) for (let y = Math.ceil(Math.min(a.y, b.y) / GRID) * GRID; y <= Math.max(a.y, b.y); y += GRID) markAt(a.x, y);
      else if (a.y === b.y && a.y % GRID === 0) for (let x = Math.ceil(Math.min(a.x, b.x) / GRID) * GRID; x <= Math.max(a.x, b.x); x += GRID) markAt(x, a.y);
    }
  }
  const markAt = (x, y) => { if (x >= minX && x <= maxX && y >= minY && y <= maxY) used[node(x, y)] = 1; };
  // A straight run between two jacks that face each other with nothing in between.
  function straight(a, b, own) {
    if (a.dy || b.dy || a.y !== b.y || a.dx !== -b.dx || (b.x - a.x) * a.dx <= 0) return false;
    for (let x = snap(Math.min(a.x, b.x)); x <= Math.max(a.x, b.x); x += GRID) {
      if (x > Math.min(a.x, b.x) && x < Math.max(a.x, b.x) && all.some(bx => inside(bx, x, a.y) && !own.includes(bx))) return false;
    }
    return true;
  }

  return rig.cables.map(c => {
    const j = jacks(c);
    if (!j) return null;
    const ownA = (rects.get(c.from) || []).map(pad), ownB = (rects.get(c.to) || []).map(pad);
    const { a, b } = j;
    let full;
    if (c.points) full = manual(a, exit(a, ownA.slice(0, 1)), c.points, exit(b, ownB.slice(0, 1)), b);
    else if (straight(a, b, [...ownA, ...ownB])) full = [a, b];
    else {
      const sA = exit(a, ownA.slice(0, 1)), sB = exit(b, ownB.slice(0, 1));
      const mid = astar(sA, dirOf(a.dx, a.dy), sB, dirOf(-b.dx, -b.dy)) || [sA, { x: sB.x, y: sA.y }, sB];
      full = [a, ...simplify(mid), b];
      if (full.length === 3) full.splice(1, 0, { ...full[1] }); // keep both stub points addressable
    }
    mark(full);
    return full;
  });
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  clear() { this.k.length = 0; this.v.length = 0; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= val) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = k[0], lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= k.length) break;
        if (c + 1 < k.length && v[c + 1] < v[c]) c++;
        if (v[c] >= lv) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}
