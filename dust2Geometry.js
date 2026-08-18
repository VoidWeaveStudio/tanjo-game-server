// game-server/dust2Geometry.js
// Generated from src/features/game/world/locations/events/dust2Layout.ts by
// scripts/sync-dust2.js — do not edit by hand.
const BLOCKERS = [{"minX":-46,"maxX":46,"minY":0,"maxY":9,"minZ":-42,"maxZ":-40.5},{"minX":-46,"maxX":46,"minY":0,"maxY":9,"minZ":40.5,"maxZ":42},{"minX":-46,"maxX":-44.5,"minY":0,"maxY":9,"minZ":-42,"maxZ":42},{"minX":44.5,"maxX":46,"minY":0,"maxY":9,"minZ":-42,"maxZ":42},{"minX":12,"maxX":13.5,"minY":0,"maxY":7,"minZ":26,"maxZ":40},{"minX":13.5,"maxX":34,"minY":0,"maxY":7,"minZ":26,"maxZ":27.5},{"minX":34,"maxX":35.5,"minY":0,"maxY":7,"minZ":14,"maxZ":27.5},{"minX":18,"maxX":34,"minY":0,"maxY":7,"minZ":14,"maxZ":15.5},{"minX":18,"maxX":19.5,"minY":0,"maxY":7,"minZ":15.5,"maxZ":24},{"minX":34,"maxX":35.5,"minY":0,"maxY":7,"minZ":-6,"maxZ":14},{"minX":19.5,"maxX":21,"minY":0,"maxY":7,"minZ":-4.5,"maxZ":14},{"minX":12,"maxX":13.5,"minY":0,"maxY":7,"minZ":6,"maxZ":26},{"minX":5,"maxX":12,"minY":0,"maxY":7,"minZ":20,"maxZ":21.5},{"minX":-2,"maxX":2,"minY":0,"maxY":7,"minZ":20,"maxZ":21.5},{"minX":5,"maxX":6.5,"minY":0,"maxY":7,"minZ":6,"maxZ":20},{"minX":-6.5,"maxX":-5,"minY":0,"maxY":7,"minZ":6,"maxZ":21.5},{"minX":-6.5,"maxX":-5,"minY":0,"maxY":7,"minZ":-2,"maxZ":3},{"minX":5,"maxX":6.5,"minY":0,"maxY":7,"minZ":-2,"maxZ":3},{"minX":-6.5,"maxX":-5,"minY":0,"maxY":7,"minZ":-14,"maxZ":-6},{"minX":5,"maxX":6.5,"minY":0,"maxY":7,"minZ":-14,"maxZ":-6},{"minX":-5,"maxX":5,"minY":0,"maxY":7,"minZ":-15.5,"maxZ":-14},{"minX":6.5,"maxX":14,"minY":0,"maxY":7,"minZ":-6,"maxZ":-4.5},{"minX":12.5,"maxX":14,"minY":0,"maxY":7,"minZ":-20,"maxZ":-4.5},{"minX":14,"maxX":36,"minY":0,"maxY":7,"minZ":-21.5,"maxZ":-20},{"minX":34,"maxX":35.5,"minY":0,"maxY":7,"minZ":-21.5,"maxZ":-6},{"minX":21,"maxX":34,"minY":0,"maxY":7,"minZ":-6,"maxZ":-4.5},{"minX":-2,"maxX":22,"minY":0,"maxY":7,"minZ":-21.5,"maxZ":-20},{"minX":-2,"maxX":-0.5,"minY":0,"maxY":7,"minZ":-34,"maxZ":-21.5},{"minX":20,"maxX":21.5,"minY":0,"maxY":7,"minZ":-34,"maxZ":-21.5},{"minX":-14,"maxX":-12.5,"minY":0,"maxY":7,"minZ":26,"maxZ":40},{"minX":-32,"maxX":-12.5,"minY":0,"maxY":7,"minZ":26,"maxZ":27.5},{"minX":-32,"maxX":-30.5,"minY":0,"maxY":7,"minZ":14,"maxZ":27.5},{"minX":-32,"maxX":-14,"minY":0,"maxY":7,"minZ":12.5,"maxZ":14},{"minX":-14,"maxX":-12.5,"minY":0,"maxY":7,"minZ":4,"maxZ":14},{"minX":-32,"maxX":-30.5,"minY":0,"maxY":7,"minZ":-4,"maxZ":12.5},{"minX":-20,"maxX":-18.5,"minY":0,"maxY":7,"minZ":-4,"maxZ":6},{"minX":-18.5,"maxX":-12.5,"minY":0,"maxY":7,"minZ":4.5,"maxZ":6},{"minX":-34,"maxX":-32.5,"minY":0,"maxY":7,"minZ":-22,"maxZ":-4},{"minX":-34,"maxX":-12,"minY":0,"maxY":7,"minZ":-23.5,"maxZ":-22},{"minX":-12,"maxX":-10.5,"minY":0,"maxY":7,"minZ":-23.5,"maxZ":-6},{"minX":-18.5,"maxX":-10.5,"minY":0,"maxY":7,"minZ":-6,"maxZ":-4.5},{"minX":-10.5,"maxX":-6.5,"minY":0,"maxY":7,"minZ":-12,"maxZ":-10.5},{"minX":22,"maxX":26,"minY":0,"maxY":2.4,"minZ":-16,"maxZ":-12},{"minX":26.5,"maxX":30.5,"minY":0,"maxY":2.4,"minZ":-15.5,"maxZ":-11.5},{"minX":24.2,"maxX":28.2,"minY":0,"maxY":4.6,"minZ":-19.6,"maxZ":-15.600000000000001},{"minX":29.3,"maxX":32.7,"minY":0,"maxY":2.4,"minZ":-19.2,"maxZ":-15.8},{"minX":20.3,"maxX":23.7,"minY":0,"maxY":2.4,"minZ":-20.099999999999998,"maxZ":-16.7},{"minX":15,"maxX":20,"minY":0,"maxY":1.6,"minZ":-13.5,"maxZ":-10.5},{"minX":31,"maxX":34,"minY":0,"maxY":2.4,"minZ":-10,"maxZ":-7},{"minX":-28,"maxX":-24,"minY":0,"maxY":2.4,"minZ":-15,"maxZ":-11},{"minX":-23.5,"maxX":-19.5,"minY":0,"maxY":2.4,"minZ":-15.5,"maxZ":-11.5},{"minX":-25.8,"maxX":-21.8,"minY":0,"maxY":4.6,"minZ":-19.2,"maxZ":-15.2},{"minX":-30.7,"maxX":-27.3,"minY":0,"maxY":2.4,"minZ":-18.7,"maxZ":-15.3},{"minX":-17.5,"maxX":-14.5,"minY":0,"maxY":2.4,"minZ":-17.5,"maxZ":-14.5},{"minX":-29.2,"maxX":-25.8,"minY":0,"maxY":2.4,"minZ":-9.7,"maxZ":-6.3},{"minX":0.7999999999999998,"maxX":4,"minY":0,"maxY":2.4,"minZ":-1.1,"maxZ":2.1},{"minX":-4,"maxX":-1,"minY":0,"maxY":2.4,"minZ":-9.5,"maxZ":-6.5},{"minX":-1,"maxX":2,"minY":0,"maxY":2.4,"minZ":12.5,"maxZ":15.5},{"minX":25.3,"maxX":28.7,"minY":0,"maxY":2.4,"minZ":4.3,"maxZ":7.7},{"minX":29,"maxX":32,"minY":0,"maxY":2.4,"minZ":-2.5,"maxZ":0.5},{"minX":22.3,"maxX":25.7,"minY":0,"maxY":2.4,"minZ":18.3,"maxZ":21.7},{"minX":28.5,"maxX":31.5,"minY":0,"maxY":2.4,"minZ":20,"maxZ":23},{"minX":14.3,"maxX":17.7,"minY":0,"maxY":2.4,"minZ":30.3,"maxZ":33.7},{"minX":29.3,"maxX":32.7,"minY":0,"maxY":2.4,"minZ":31.3,"maxZ":34.7},{"minX":-23.7,"maxX":-20.3,"minY":0,"maxY":2.4,"minZ":18.3,"maxZ":21.7},{"minX":-28.5,"maxX":-25.5,"minY":0,"maxY":2.4,"minZ":6.5,"maxZ":9.5},{"minX":-17.5,"maxX":-14.5,"minY":0,"maxY":2.4,"minZ":-31.5,"maxZ":-28.5},{"minX":12.3,"maxX":15.7,"minY":0,"maxY":2.4,"minZ":-29.7,"maxZ":-26.3},{"minX":0.5,"maxX":3.5,"minY":0,"maxY":2.4,"minZ":-27.5,"maxZ":-24.5}];

// Slab test: does the segment from a to b clip this axis-aligned box?
function segmentHitsBox(ax, ay, az, bx, by, bz, box) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;

  let near = 0;
  let far = 1;

  const axes = [
    [ax, dx, box.minX, box.maxX],
    [ay, dy, box.minY, box.maxY],
    [az, dz, box.minZ, box.maxZ],
  ];

  for (const [origin, delta, min, max] of axes) {
    if (Math.abs(delta) < 1e-8) {
      if (origin < min || origin > max) return false;
      continue;
    }

    let t1 = (min - origin) / delta;
    let t2 = (max - origin) / delta;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }

    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return false;
  }

  return true;
}

function contains(box, x, y, z) {
  return x >= box.minX && x <= box.maxX
    && y >= box.minY && y <= box.maxY
    && z >= box.minZ && z <= box.maxZ;
}

// A box holding either endpoint is skipped: standing on a crate or a grenade
// wedged against a wall must not make you immune to what happens next to you.
function hasLineOfSight(ax, ay, az, bx, by, bz) {
  for (const box of BLOCKERS) {
    if (contains(box, ax, ay, az) || contains(box, bx, by, bz)) continue;
    if (segmentHitsBox(ax, ay, az, bx, by, bz, box)) return false;
  }
  return true;
}

module.exports = { BLOCKERS, segmentHitsBox, contains, hasLineOfSight };
