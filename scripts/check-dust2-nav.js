// game-server/scripts/check-dust2-nav.js
const nav = require('../dust2Nav');
const geometry = require('../dust2Geometry');

let failures = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  failures++;
}

const stats = nav.debugStats();
console.log(`dust2 nav grid — ${stats.cols}x${stats.rows} cells, ${stats.openCells} open, ${stats.mainCells} reachable, ${stats.regions} regions`);

check('grid has a substantial reachable region', stats.mainCells > 4000, `only ${stats.mainCells}`);
check('the reachable region is most of the open space', stats.mainCells / stats.openCells > 0.9,
  `${((stats.mainCells / stats.openCells) * 100).toFixed(1)}% reachable`);

for (const [index, point] of geometry.T_SPAWN_POINTS.entries()) {
  check(`T spawn ${index} stands on walkable ground`, nav.isWalkable(point[0], point[1]), `${point}`);
}
for (const [index, point] of geometry.CT_SPAWN_POINTS.entries()) {
  check(`CT spawn ${index} stands on walkable ground`, nav.isWalkable(point[0], point[1]), `${point}`);
}

for (const entry of geometry.CALLOUTS) {
  check(`callout ${entry.label} resolves to walkable ground`, nav.calloutPoint(entry.label) !== null);
}

function pathLength(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  return total;
}

const ROUTES = [
  ['T spawn to A site', [30, 34], [21.5, -13.5]],
  ['T spawn to B site', [30, 34], [-21, -19]],
  ['CT spawn to A site', [-3, -33], [21.5, -13.5]],
  ['CT spawn to B site', [-3, -33], [-21, -19]],
  ['T spawn to long doors', [30, 34], [31, 9]],
  ['T spawn to upper tunnel', [30, 34], [-12, 19]],
  ['mid doors to catwalk', [0, 4], [8, -7]],
  ['B site to A site', [-21, -19], [21.5, -13.5]],
  ['pit to goose', [35, -13], [15, -23]],
  ['B plat to B doors', [-36, -20], [-18, -28]],
];

for (const [label, from, to] of ROUTES) {
  const path = nav.findPath(from[0], from[1], to[0], to[1]);
  const straight = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (!path) {
    check(`path ${label}`, false, 'no path found');
    continue;
  }
  const length = pathLength(path);
  check(`path ${label}`, length < straight * 4 + 30,
    `${length.toFixed(1)}m over ${path.length} legs vs ${straight.toFixed(1)}m straight`);
  console.log(`       ${label}: ${length.toFixed(1)}m, ${path.length} legs`);
}

const site = geometry.BOMB_SITES.A;
check('A site centre is walkable', nav.isWalkable(site.x, site.z));
check('B site centre is walkable', nav.isWalkable(geometry.BOMB_SITES.B.x, geometry.BOMB_SITES.B.z));

check('a wall interior is not walkable', !nav.isWalkable(-44, 0));
check('outside the map is not walkable', !nav.isWalkable(60, 0));
check('straight walk through the mid wall is refused', !nav.canWalkStraight(-10, 0, 10, 0));
check('straight walk down long is allowed', nav.canWalkStraight(32, 0, 32, -8));
check('mid doors squeeze past xbox is reachable', nav.findPath(0, 12, 0, -6) !== null);

const started = Date.now();
for (let i = 0; i < 200; i++) nav.findPath(30, 34, -21, -19);
const elapsed = Date.now() - started;
console.log(`\n200 long paths in ${elapsed}ms (${(elapsed / 200).toFixed(2)}ms each)`);
check('pathfinding is fast enough for a live tick', elapsed / 200 < 6, `${(elapsed / 200).toFixed(2)}ms each`);

if (failures === 0) {
  console.log('\ndust2 navigation checks passed');
  process.exit(0);
}

console.log(`\n${failures} problem(s) found`);
process.exit(1);
