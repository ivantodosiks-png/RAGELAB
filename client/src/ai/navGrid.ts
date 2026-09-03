import type { MapDefinition } from '@ragelab/shared';

export interface NavPoint {
  x: number;
  z: number;
}

const CELL = 1;

/**
 * 2D occupancy grid cooked from map brushes. Tall solids (walls, building hulls)
 * block; floors, roads and overhead roofs stay walkable. NPCs path on this
 * instead of walking into geometry.
 */
export class NavGrid {
  readonly cell = CELL;
  readonly originX: number;
  readonly originZ: number;
  readonly width: number;
  readonly height: number;
  private readonly blocked: Uint8Array;
  private readonly heap: number[] = [];
  private readonly heapF: number[] = [];
  private readonly came: Int32Array;
  private readonly gScore: Float32Array;
  private readonly stamp: Uint32Array;
  private gen = 1;

  constructor(map: MapDefinition) {
    const pad = map.bounds + 2;
    const size = Math.ceil((pad * 2) / CELL);
    this.width = size;
    this.height = size;
    this.originX = -pad;
    this.originZ = -pad;
    this.blocked = new Uint8Array(size * size);
    this.came = new Int32Array(size * size);
    this.gScore = new Float32Array(size * size);
    this.stamp = new Uint32Array(size * size);
    this.stampObstacles(map);
    this.inflate(1);
  }

  isWalkable(x: number, z: number): boolean {
    const i = this.indexAt(x, z);
    return i >= 0 && this.blocked[i] === 0;
  }

  closestWalkable(x: number, z: number, maxR = 8): NavPoint {
    if (this.isWalkable(x, z)) return { x, z };
    for (let r = 1; r <= maxR; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const px = x + dx * CELL;
          const pz = z + dz * CELL;
          if (this.isWalkable(px, pz)) return { x: px, z: pz };
        }
      }
    }
    return { x, z };
  }

  randomWalkable(rng: () => number): NavPoint | null {
    for (let n = 0; n < 24; n++) {
      const i = (rng() * this.blocked.length) | 0;
      if (this.blocked[i]) continue;
      return this.worldOf(i);
    }
    return null;
  }

  findPath(from: NavPoint, to: NavPoint): NavPoint[] {
    const start = this.indexAt(from.x, from.z);
    const goal = this.indexAt(to.x, to.z);
    if (start < 0 || goal < 0) return [];
    if (this.blocked[start] || this.blocked[goal]) {
      const a = this.closestWalkable(from.x, from.z);
      const b = this.closestWalkable(to.x, to.z);
      const si = this.indexAt(a.x, a.z);
      const gi = this.indexAt(b.x, b.z);
      if (si < 0 || gi < 0 || this.blocked[si] || this.blocked[gi]) return [];
      return this.astar(si, gi);
    }
    return this.astar(start, goal);
  }

  private astar(start: number, goal: number): NavPoint[] {
    this.gen += 1;
    if (this.gen === 0xffffffff) {
      this.stamp.fill(0);
      this.gen = 1;
    }
    this.heap.length = 0;
    this.heapF.length = 0;
    this.gScore[start] = 0;
    this.stamp[start] = this.gen;
    this.came[start] = -1;
    this.push(start, this.heuristic(start, goal));

    const w = this.width;
    const h = this.height;
    while (this.heap.length > 0) {
      const current = this.pop();
      if (current === goal) return this.rebuild(current);
      const cx = current % w;
      const cz = (current / w) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
          const ni = nz * w + nx;
          if (this.blocked[ni]) continue;
          if (dx !== 0 && dz !== 0) {
            if (this.blocked[cz * w + nx] || this.blocked[nz * w + cx]) continue;
          }
          const step = dx !== 0 && dz !== 0 ? 1.414 : 1;
          const tentative = this.gScore[current] + step;
          if (this.stamp[ni] !== this.gen || tentative < this.gScore[ni]) {
            this.stamp[ni] = this.gen;
            this.gScore[ni] = tentative;
            this.came[ni] = current;
            this.push(ni, tentative + this.heuristic(ni, goal));
          }
        }
      }
    }
    return [];
  }

  private rebuild(end: number): NavPoint[] {
    const pts: NavPoint[] = [];
    let cur = end;
    while (cur >= 0) {
      pts.push(this.worldOf(cur));
      cur = this.came[cur]!;
    }
    pts.reverse();
    return smooth(pts, (x, z) => this.isWalkable(x, z));
  }

  private heuristic(a: number, b: number): number {
    const w = this.width;
    const ax = a % w;
    const az = (a / w) | 0;
    const bx = b % w;
    const bz = (b / w) | 0;
    const dx = Math.abs(ax - bx);
    const dz = Math.abs(az - bz);
    return dx + dz + (1.414 - 2) * Math.min(dx, dz);
  }

  private push(i: number, f: number): void {
    this.heap.push(i);
    this.heapF.push(f);
    let n = this.heap.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (this.heapF[p]! <= this.heapF[n]!) break;
      swap(this.heap, this.heapF, n, p);
      n = p;
    }
  }

  private pop(): number {
    const top = this.heap[0]!;
    const last = this.heap.pop()!;
    const lastF = this.heapF.pop()!;
    if (this.heap.length === 0) return top;
    this.heap[0] = last;
    this.heapF[0] = lastF;
    let n = 0;
    for (;;) {
      const l = n * 2 + 1;
      const r = l + 1;
      let s = n;
      if (l < this.heap.length && this.heapF[l]! < this.heapF[s]!) s = l;
      if (r < this.heap.length && this.heapF[r]! < this.heapF[s]!) s = r;
      if (s === n) break;
      swap(this.heap, this.heapF, n, s);
      n = s;
    }
    return top;
  }

  private indexAt(x: number, z: number): number {
    const cx = Math.floor((x - this.originX) / CELL);
    const cz = Math.floor((z - this.originZ) / CELL);
    if (cx < 0 || cz < 0 || cx >= this.width || cz >= this.height) return -1;
    return cz * this.width + cx;
  }

  private worldOf(i: number): NavPoint {
    const cx = i % this.width;
    const cz = (i / this.width) | 0;
    return {
      x: this.originX + (cx + 0.5) * CELL,
      z: this.originZ + (cz + 0.5) * CELL,
    };
  }

  private stampObstacles(map: MapDefinition): void {
    for (const brush of map.brushes) {
      if ('noCollide' in brush && brush.noCollide) continue;
      if (brush.kind === 'box') {
        const top = brush.position[1] + brush.size[1] / 2;
        const bottom = brush.position[1] - brush.size[1] / 2;
        if (top < 0.5 || bottom > 1.7) continue;
        this.stampAabb(
          brush.position[0],
          brush.position[2],
          brush.size[0],
          brush.size[2],
          brush.rotation?.[1] ?? 0,
        );
      } else if (brush.kind === 'cylinder') {
        const top = brush.position[1] + brush.height / 2;
        const bottom = brush.position[1] - brush.height / 2;
        if (top < 0.5 || bottom > 1.7) continue;
        const d = brush.radius * 2;
        this.stampAabb(brush.position[0], brush.position[2], d, d, 0);
      }
    }
  }

  private stampAabb(cx: number, cz: number, sx: number, sz: number, yaw: number): void {
    const hx = sx / 2;
    const hz = sz / 2;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const corners = [
      [-hx, -hz],
      [hx, -hz],
      [hx, hz],
      [-hx, hz],
    ];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [lx, lz] of corners) {
      const x = cx + lx * c + lz * s;
      const z = cz - lx * s + lz * c;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const x0 = Math.max(0, Math.floor((minX - this.originX) / CELL));
    const x1 = Math.min(this.width - 1, Math.floor((maxX - this.originX) / CELL));
    const z0 = Math.max(0, Math.floor((minZ - this.originZ) / CELL));
    const z1 = Math.min(this.height - 1, Math.floor((maxZ - this.originZ) / CELL));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) this.blocked[z * this.width + x] = 1;
    }
  }

  private inflate(radius: number): void {
    if (radius <= 0) return;
    const copy = this.blocked.slice();
    const w = this.width;
    const h = this.height;
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        if (!copy[z * w + x]) continue;
        for (let dz = -radius; dz <= radius; dz++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
            this.blocked[nz * w + nx] = 1;
          }
        }
      }
    }
  }
}

function swap(a: number[], f: number[], i: number, j: number): void {
  const t = a[i]!;
  a[i] = a[j]!;
  a[j] = t;
  const tf = f[i]!;
  f[i] = f[j]!;
  f[j] = tf;
}

function smooth(pts: NavPoint[], walkable: (x: number, z: number) => boolean): NavPoint[] {
  if (pts.length < 3) return pts;
  const out: NavPoint[] = [pts[0]!];
  let i = 0;
  while (i < pts.length - 1) {
    let best = i + 1;
    for (let j = pts.length - 1; j > i + 1; j--) {
      if (lineWalkable(pts[i]!, pts[j]!, walkable)) {
        best = j;
        break;
      }
    }
    out.push(pts[best]!);
    i = best;
  }
  return out;
}

function lineWalkable(a: NavPoint, b: NavPoint, walkable: (x: number, z: number) => boolean): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const steps = Math.max(2, Math.ceil(Math.hypot(dx, dz) / 0.7));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (!walkable(a.x + dx * t, a.z + dz * t)) return false;
  }
  return true;
}
