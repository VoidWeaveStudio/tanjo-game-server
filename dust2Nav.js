// game-server/dust2Nav.js
const geometry = require('./dust2Geometry');

const CELL = 0.5;
const BOT_RADIUS = 0.35;
const STEP_UP = 0.7;
const CLIMB_MAX = 1.3;
const BODY_HEIGHT = 1.75;
const EYE_HEIGHT = 1.6;

const MIN_X = -geometry.BOUNDS.halfX;
const MAX_X = geometry.BOUNDS.halfX;
const MIN_Z = -geometry.BOUNDS.halfZ;
const MAX_Z = geometry.BOUNDS.halfZ;

const COLS = Math.ceil((MAX_X - MIN_X) / CELL);
const ROWS = Math.ceil((MAX_Z - MIN_Z) / CELL);

let grid = null;

function cellCentreX(col) {
  return MIN_X + (col + 0.5) * CELL;
}

function cellCentreZ(row) {
  return MIN_Z + (row + 0.5) * CELL;
}

function colOf(x) {
  return Math.floor((x - MIN_X) / CELL);
}

function rowOf(z) {
  return Math.floor((z - MIN_Z) / CELL);
}

function inBounds(col, row) {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

function floorUnder(x, z) {
  let best = 0;
  for (const box of geometry.BLOCKERS) {
    if (box.minY > 0.05) continue;
    if (box.maxY > CLIMB_MAX) continue;
    if (x < box.minX || x > box.maxX) continue;
    if (z < box.minZ || z > box.maxZ) continue;
    if (box.maxY > best) best = box.maxY;
  }
  return best;
}

function obstructed(x, z, floor) {
  const pad = BOT_RADIUS;
  const minX = x - pad;
  const maxX = x + pad;
  const minZ = z - pad;
  const maxZ = z + pad;
  const low = floor + STEP_UP;
  const high = floor + BODY_HEIGHT;

  for (const box of geometry.BLOCKERS) {
    if (box.maxX <= minX || box.minX >= maxX) continue;
    if (box.maxZ <= minZ || box.minZ >= maxZ) continue;
    if (box.maxY <= low || box.minY >= high) continue;
    return true;
  }
  return false;
}

function buildGrid() {
  const size = COLS * ROWS;
  const floors = new Float32Array(size);
  const open = new Uint8Array(size);

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const index = row * COLS + col;
      const x = cellCentreX(col);
      const z = cellCentreZ(row);
      const floor = floorUnder(x, z);
      floors[index] = floor;
      open[index] = obstructed(x, z, floor) ? 0 : 1;
    }
  }

  const region = new Int16Array(size).fill(-1);
  let regionCount = 0;
  const queue = new Int32Array(size);

  for (let seed = 0; seed < size; seed++) {
    if (open[seed] === 0 || region[seed] !== -1) continue;

    const id = regionCount++;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    region[seed] = id;

    while (head < tail) {
      const index = queue[head++];
      const col = index % COLS;
      const row = (index - col) / COLS;

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dc === 0 && dr === 0) continue;
          const nc = col + dc;
          const nr = row + dr;
          if (!inBounds(nc, nr)) continue;

          const next = nr * COLS + nc;
          if (open[next] === 0 || region[next] !== -1) continue;
          if (Math.abs(floors[next] - floors[index]) > STEP_UP) continue;
          if (dc !== 0 && dr !== 0) {
            const sideA = row * COLS + nc;
            const sideB = nr * COLS + col;
            if (open[sideA] === 0 || open[sideB] === 0) continue;
          }

          region[next] = id;
          queue[tail++] = next;
        }
      }
    }
  }

  const counts = new Int32Array(regionCount);
  for (let index = 0; index < size; index++) {
    if (region[index] >= 0) counts[region[index]]++;
  }

  let main = -1;
  let mainSize = -1;
  for (let id = 0; id < regionCount; id++) {
    if (counts[id] > mainSize) {
      mainSize = counts[id];
      main = id;
    }
  }

  return { floors, open, region, main, regionCount, size };
}

function ensureGrid() {
  if (grid === null) grid = buildGrid();
  return grid;
}

function indexAt(x, z) {
  const col = colOf(x);
  const row = rowOf(z);
  if (!inBounds(col, row)) return -1;
  return row * COLS + col;
}

function isWalkable(x, z) {
  const g = ensureGrid();
  const index = indexAt(x, z);
  if (index < 0) return false;
  return g.open[index] === 1 && g.region[index] === g.main;
}

function floorAt(x, z) {
  const g = ensureGrid();
  const index = indexAt(x, z);
  if (index < 0) return 0;
  return g.floors[index];
}

function nearestWalkable(x, z, maxRadius = 8) {
  if (isWalkable(x, z)) return [x, z];

  const steps = Math.ceil(maxRadius / CELL);
  const startCol = colOf(x);
  const startRow = rowOf(z);
  const g = ensureGrid();

  for (let ring = 1; ring <= steps; ring++) {
    for (let dc = -ring; dc <= ring; dc++) {
      for (let dr = -ring; dr <= ring; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
        const col = startCol + dc;
        const row = startRow + dr;
        if (!inBounds(col, row)) continue;
        const index = row * COLS + col;
        if (g.open[index] === 0 || g.region[index] !== g.main) continue;
        return [cellCentreX(col), cellCentreZ(row)];
      }
    }
  }

  return null;
}

function canWalkStraight(ax, az, bx, bz) {
  const g = ensureGrid();
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(length / (CELL * 0.5)));

  let previous = indexAt(ax, az);
  if (previous < 0 || g.open[previous] === 0) return false;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = ax + dx * t;
    const z = az + dz * t;
    const index = indexAt(x, z);
    if (index < 0 || g.open[index] === 0 || g.region[index] !== g.main) return false;
    if (Math.abs(g.floors[index] - g.floors[previous]) > STEP_UP) return false;
    previous = index;
  }

  return true;
}

class MinHeap {
  constructor() {
    this.items = [];
    this.keys = [];
  }

  get size() {
    return this.items.length;
  }

  push(item, key) {
    this.items.push(item);
    this.keys.push(key);
    let child = this.items.length - 1;

    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.keys[parent] <= this.keys[child]) break;
      this.swap(parent, child);
      child = parent;
    }
  }

  pop() {
    const top = this.items[0];
    const lastItem = this.items.pop();
    const lastKey = this.keys.pop();

    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let parent = 0;

      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let best = parent;
        if (left < this.keys.length && this.keys[left] < this.keys[best]) best = left;
        if (right < this.keys.length && this.keys[right] < this.keys[best]) best = right;
        if (best === parent) break;
        this.swap(parent, best);
        parent = best;
      }
    }

    return top;
  }

  swap(a, b) {
    const item = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = item;
    const key = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = key;
  }
}

const DIAGONAL = Math.SQRT2;

function heuristic(col, row, goalCol, goalRow) {
  const dc = Math.abs(col - goalCol);
  const dr = Math.abs(row - goalRow);
  const low = Math.min(dc, dr);
  return (dc + dr - 2 * low) + DIAGONAL * low;
}

function smooth(cells) {
  if (cells.length <= 2) return cells;

  const output = [cells[0]];
  let anchor = 0;

  while (anchor < cells.length - 1) {
    let furthest = anchor + 1;
    for (let probe = cells.length - 1; probe > anchor + 1; probe--) {
      if (canWalkStraight(cells[anchor][0], cells[anchor][1], cells[probe][0], cells[probe][1])) {
        furthest = probe;
        break;
      }
    }
    output.push(cells[furthest]);
    anchor = furthest;
  }

  return output;
}

function findPath(ax, az, bx, bz) {
  const g = ensureGrid();

  const start = nearestWalkable(ax, az);
  const goal = nearestWalkable(bx, bz);
  if (!start || !goal) return null;

  const startIndex = indexAt(start[0], start[1]);
  const goalIndex = indexAt(goal[0], goal[1]);
  if (startIndex < 0 || goalIndex < 0) return null;
  if (startIndex === goalIndex) return [[bx, bz]];

  const goalCol = goalIndex % COLS;
  const goalRow = (goalIndex - goalCol) / COLS;

  const cost = new Float32Array(g.size).fill(Infinity);
  const cameFrom = new Int32Array(g.size).fill(-1);
  const closed = new Uint8Array(g.size);

  cost[startIndex] = 0;
  const frontier = new MinHeap();
  frontier.push(startIndex, 0);

  let found = false;
  let expansions = 0;
  const budget = 40000;

  while (frontier.size > 0 && expansions < budget) {
    const index = frontier.pop();
    if (closed[index] === 1) continue;
    closed[index] = 1;
    expansions++;

    if (index === goalIndex) {
      found = true;
      break;
    }

    const col = index % COLS;
    const row = (index - col) / COLS;

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = col + dc;
        const nr = row + dr;
        if (!inBounds(nc, nr)) continue;

        const next = nr * COLS + nc;
        if (g.open[next] === 0 || g.region[next] !== g.main || closed[next] === 1) continue;
        if (Math.abs(g.floors[next] - g.floors[index]) > STEP_UP) continue;

        const diagonal = dc !== 0 && dr !== 0;
        if (diagonal) {
          const sideA = row * COLS + nc;
          const sideB = nr * COLS + col;
          if (g.open[sideA] === 0 || g.open[sideB] === 0) continue;
        }

        const step = diagonal ? DIAGONAL : 1;
        const candidate = cost[index] + step;
        if (candidate >= cost[next]) continue;

        cost[next] = candidate;
        cameFrom[next] = index;
        frontier.push(next, candidate + heuristic(nc, nr, goalCol, goalRow));
      }
    }
  }

  if (!found) return null;

  const cells = [];
  let cursor = goalIndex;
  while (cursor !== -1) {
    const col = cursor % COLS;
    const row = (cursor - col) / COLS;
    cells.push([cellCentreX(col), cellCentreZ(row)]);
    if (cursor === startIndex) break;
    cursor = cameFrom[cursor];
  }
  cells.reverse();

  const path = smooth(cells);
  path[path.length - 1] = [bx, bz];
  if (path.length > 1 && !canWalkStraight(path[path.length - 2][0], path[path.length - 2][1], bx, bz)) {
    path[path.length - 1] = goal;
  }

  return path;
}

function randomWalkableNear(x, z, radius, attempts = 12) {
  for (let i = 0; i < attempts; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * radius;
    const px = x + Math.cos(angle) * distance;
    const pz = z + Math.sin(angle) * distance;
    if (isWalkable(px, pz)) return [px, pz];
  }
  return nearestWalkable(x, z, radius);
}

const CALLOUTS_BY_LABEL = new Map(geometry.CALLOUTS.map((entry) => [entry.label, entry]));

function callout(label) {
  return CALLOUTS_BY_LABEL.get(label) ?? null;
}

function calloutPoint(label) {
  const entry = CALLOUTS_BY_LABEL.get(label);
  if (!entry) return null;
  return nearestWalkable(entry.x, entry.z, 6);
}

function nearestCallout(x, z) {
  let best = null;
  let bestDistance = Infinity;
  for (const entry of geometry.CALLOUTS) {
    const distance = Math.hypot(entry.x - x, entry.z - z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  return best;
}

function visibleBetween(from, to) {
  return geometry.hasLineOfSight(
    from[0], from[1] + EYE_HEIGHT, from[2],
    to[0], to[1] + EYE_HEIGHT, to[2]
  );
}

function debugStats() {
  const g = ensureGrid();
  let openCells = 0;
  let mainCells = 0;
  for (let index = 0; index < g.size; index++) {
    if (g.open[index] === 1) openCells++;
    if (g.region[index] === g.main) mainCells++;
  }
  return { cols: COLS, rows: ROWS, cells: g.size, openCells, mainCells, regions: g.regionCount };
}

module.exports = {
  CELL,
  BOT_RADIUS,
  STEP_UP,
  EYE_HEIGHT,
  BODY_HEIGHT,
  MIN_X,
  MAX_X,
  MIN_Z,
  MAX_Z,
  ensureGrid,
  isWalkable,
  floorAt,
  nearestWalkable,
  canWalkStraight,
  findPath,
  randomWalkableNear,
  callout,
  calloutPoint,
  nearestCallout,
  visibleBetween,
  debugStats,
};
