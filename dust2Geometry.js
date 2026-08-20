// game-server/dust2Geometry.js

const BLOCKERS = [{"minX":-48,"maxX":48,"minY":0,"maxY":8,"minZ":-44,"maxZ":-38},{"minX":-48,"maxX":-16,"minY":0,"maxY":8,"minZ":-38,"maxZ":-32},{"minX":10,"maxX":48,"minY":0,"maxY":8,"minZ":-38,"maxZ":-32},{"minX":-48,"maxX":-22,"minY":0,"maxY":8,"minZ":-32,"maxZ":-26},{"minX":20,"maxX":48,"minY":0,"maxY":8,"minZ":-32,"maxZ":-26},{"minX":-48,"maxX":-40,"minY":0,"maxY":8,"minZ":-26,"maxZ":44},{"minX":-14,"maxX":-6,"minY":0,"maxY":8,"minZ":-26,"maxZ":14},{"minX":6,"maxX":8,"minY":0,"maxY":8,"minZ":-26,"maxZ":-22},{"minX":34,"maxX":48,"minY":0,"maxY":8,"minZ":-26,"maxZ":-16},{"minX":-18,"maxX":-14,"minY":0,"maxY":8,"minZ":-24,"maxZ":4},{"minX":8,"maxX":12,"minY":0,"maxY":8,"minZ":-24,"maxZ":-22},{"minX":40,"maxX":48,"minY":0,"maxY":8,"minZ":-16,"maxZ":44},{"minX":-40,"maxX":-30,"minY":0,"maxY":8,"minZ":-10,"maxZ":44},{"minX":-20,"maxX":-18,"minY":0,"maxY":8,"minZ":-10,"maxZ":-6},{"minX":12,"maxX":26,"minY":0,"maxY":8,"minZ":-10,"maxZ":10},{"minX":6,"maxX":12,"minY":0,"maxY":8,"minZ":-2,"maxZ":18},{"minX":-16,"maxX":-14,"minY":0,"maxY":8,"minZ":4,"maxZ":14},{"minX":-30,"maxX":-26,"minY":0,"maxY":8,"minZ":6,"maxZ":44},{"minX":26,"maxX":28,"minY":0,"maxY":8,"minZ":8,"maxZ":10},{"minX":34,"maxX":40,"minY":0,"maxY":8,"minZ":8,"maxZ":10},{"minX":12,"maxX":24,"minY":0,"maxY":8,"minZ":10,"maxZ":22},{"minX":-26,"maxX":-20,"minY":0,"maxY":8,"minZ":16,"maxZ":44},{"minX":10,"maxX":12,"minY":0,"maxY":8,"minZ":18,"maxZ":22},{"minX":-20,"maxX":-6,"minY":0,"maxY":8,"minZ":24,"maxZ":44},{"minX":-6,"maxX":6,"minY":0,"maxY":8,"minZ":26,"maxZ":44},{"minX":6,"maxX":40,"minY":0,"maxY":8,"minZ":40,"maxZ":44},{"minX":-6,"maxX":-2.6,"minY":0,"maxY":8,"minZ":3.4,"maxZ":4.6},{"minX":2.6,"maxX":6,"minY":0,"maxY":8,"minZ":3.4,"maxZ":4.6},{"minX":-2.6,"maxX":2.6,"minY":3,"maxY":8,"minZ":3.4,"maxZ":4.6},{"minX":28,"maxX":29.6,"minY":0,"maxY":8,"minZ":8.4,"maxZ":9.6},{"minX":32.4,"maxX":34,"minY":0,"maxY":8,"minZ":8.4,"maxZ":9.6},{"minX":29.6,"maxX":32.4,"minY":3,"maxY":8,"minZ":8.4,"maxZ":9.6},{"minX":-22,"maxX":-19.6,"minY":0,"maxY":8,"minZ":-29.6,"maxZ":-28.4},{"minX":-16.4,"maxX":-14,"minY":0,"maxY":8,"minZ":-29.6,"maxZ":-28.4},{"minX":-19.6,"maxX":-16.4,"minY":3,"maxY":8,"minZ":-29.6,"maxZ":-28.4},{"minX":-6.2,"maxX":-5,"minY":3.5,"maxY":8,"minZ":15.5,"maxZ":23},{"minX":12,"maxX":13.2,"minY":3.5,"maxY":8,"minZ":-21.5,"maxZ":-12},{"minX":-6,"maxX":6,"minY":3.5,"maxY":8,"minZ":-27.2,"maxZ":-26},{"minX":8,"maxX":9.2,"minY":3.5,"maxY":8,"minZ":-31.5,"maxZ":-26.5},{"minX":-30,"maxX":-20,"minY":3.5,"maxY":8,"minZ":-11.2,"maxZ":-10},{"minX":26,"maxX":34,"minY":3.5,"maxY":8,"minZ":-11.2,"maxZ":-10},{"minX":19.8,"maxX":24.2,"minY":0,"maxY":2.4,"minZ":-21.2,"maxZ":-16.8},{"minX":24.400000000000002,"maxX":28.8,"minY":0,"maxY":2.4,"minZ":-20.8,"maxZ":-16.400000000000002},{"minX":22,"maxX":26.4,"minY":0,"maxY":4.8,"minZ":-25.4,"maxZ":-21},{"minX":15.8,"maxX":19.400000000000002,"minY":0,"maxY":2.4,"minZ":-24.2,"maxZ":-20.599999999999998},{"minX":12.8,"maxX":18,"minY":0,"maxY":1.7,"minZ":-16.1,"maxZ":-13.1},{"minX":29.900000000000002,"maxX":33.300000000000004,"minY":0,"maxY":2.4,"minZ":-14.1,"maxZ":-10.700000000000001},{"minX":-34.800000000000004,"maxX":-30.400000000000002,"minY":0,"maxY":2.4,"minZ":-21.599999999999998,"maxZ":-17.2},{"minX":-30,"maxX":-25.6,"minY":0,"maxY":2.4,"minZ":-22,"maxZ":-17.6},{"minX":-32.4,"maxX":-28,"minY":0,"maxY":4.8,"minZ":-25.599999999999998,"maxZ":-21.2},{"minX":-39,"maxX":-33.8,"minY":0,"maxY":1.7,"minZ":-16.1,"maxZ":-13.1},{"minX":-24.3,"maxX":-20.900000000000002,"minY":0,"maxY":2.4,"minZ":-15.899999999999999,"maxZ":-12.5},{"minX":-26.1,"maxX":-23.1,"minY":0,"maxY":2.4,"minZ":-24.1,"maxZ":-21.1},{"minX":-1.7,"maxX":1.7,"minY":0,"maxY":2.4,"minZ":1.9000000000000001,"maxZ":5.3},{"minX":-4.9,"maxX":-1.9,"minY":0,"maxY":2.4,"minZ":-7.9,"maxZ":-4.9},{"minX":1.6,"maxX":4.800000000000001,"minY":0,"maxY":2.4,"minZ":-13.2,"maxZ":-10},{"minX":-4.1,"maxX":-1.1,"minY":0,"maxY":2.4,"minZ":13.9,"maxZ":16.9},{"minX":7.7,"maxX":11.1,"minY":0,"maxY":2.4,"minZ":-8.1,"maxZ":-4.7},{"minX":7.1,"maxX":10.1,"minY":0,"maxY":2.4,"minZ":-20.9,"maxZ":-17.9},{"minX":35.5,"maxX":38.900000000000006,"minY":0,"maxY":2.4,"minZ":2.7,"maxZ":6.1000000000000005},{"minX":26.799999999999997,"maxX":30,"minY":0,"maxY":2.4,"minZ":-5.2,"maxZ":-2},{"minX":35.5,"maxX":38.5,"minY":0,"maxY":2.4,"minZ":-8.1,"maxZ":-5.1},{"minX":28.900000000000002,"maxX":32.300000000000004,"minY":0,"maxY":2.4,"minZ":12.700000000000001,"maxZ":16.1},{"minX":35,"maxX":38.2,"minY":0,"maxY":2.4,"minZ":19,"maxZ":22.200000000000003},{"minX":-24.099999999999998,"maxX":-20.7,"minY":0,"maxY":2.4,"minZ":17.900000000000002,"maxZ":21.3},{"minX":-29.9,"maxX":-26.9,"minY":0,"maxY":2.4,"minZ":-0.10000000000000009,"maxZ":2.9},{"minX":-25,"maxX":-21.799999999999997,"minY":0,"maxY":2.4,"minZ":-10.2,"maxZ":-7},{"minX":-21.1,"maxX":-18.1,"minY":0,"maxY":2.4,"minZ":-30.9,"maxZ":-27.9},{"minX":13.9,"maxX":17.3,"minY":0,"maxY":2.4,"minZ":-30.099999999999998,"maxZ":-26.7},{"minX":-14.1,"maxX":-11.1,"minY":0,"maxY":2.4,"minZ":-36.9,"maxZ":-33.9},{"minX":4.7,"maxX":8.1,"minY":0,"maxY":2.4,"minZ":-37.300000000000004,"maxZ":-33.9},{"minX":12.9,"maxX":16.3,"minY":0,"maxY":2.4,"minZ":31.900000000000002,"maxZ":35.300000000000004},{"minX":34.699999999999996,"maxX":38.1,"minY":0,"maxY":2.4,"minZ":34.699999999999996,"maxZ":38.1},{"minX":21.1,"maxX":24.1,"minY":0,"maxY":2.4,"minZ":24.9,"maxZ":27.9},{"minX":27,"maxX":34,"minY":0,"maxY":1.2,"minZ":-26,"maxZ":-21},{"minX":27,"maxX":34,"minY":0,"maxY":0.6,"minZ":-21,"maxZ":-20},{"minX":-40,"maxX":-34,"minY":0,"maxY":1.2,"minZ":-26,"maxZ":-18},{"minX":-34,"maxX":-33,"minY":0,"maxY":0.6,"minZ":-26,"maxZ":-18},{"minX":34,"maxX":40,"minY":0,"maxY":0.6,"minZ":-16,"maxZ":-12.5},{"minX":-24,"maxX":-18,"minY":0,"maxY":0.6,"minZ":4,"maxZ":7},{"minX":30.2,"maxX":34.8,"minY":0,"maxY":2.5,"minZ":1.7000000000000002,"maxZ":6.3},{"minX":-29.3,"maxX":-24.7,"minY":0,"maxY":2.5,"minZ":-15.3,"maxZ":-10.7}];

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

function hasLineOfSight(ax, ay, az, bx, by, bz) {
  for (const box of BLOCKERS) {
    if (contains(box, ax, ay, az) || contains(box, bx, by, bz)) continue;
    if (segmentHitsBox(ax, ay, az, bx, by, bz, box)) return false;
  }
  return true;
}

module.exports = { BLOCKERS, segmentHitsBox, contains, hasLineOfSight };
