// worldTerrain.js
const WORLD_SEED = 20260812;

const SEA_LEVEL = 0;
const SEABED_DEPTH = -16;
const SHORE_RADIUS = 400;
const PLAY_RADIUS = 466;

const SAFE_ZONE_RADIUS = 34;
const SPAWN_FLAT_RADIUS = 52;

const TOWER_X = 300;
const TOWER_Z = 0;
const TOWER_FLAT_RADIUS = 90;
const TOWER_PLAZA_HALF_WIDTH = 46;
const TOWER_PLAZA_FAR = 122;

const INLAND_FLOOR = 1.6;
const MAX_TERRAIN_HEIGHT = 40;

const COVE_ANGLE = -Math.PI * 0.52;
const COVE_CENTER_RADIUS = 322;
const COVE_RADIUS = 176;
const COVE_FLOOR = -7.5;
const COVE_SHELF = -1;
const COVE_BERM = 1.6;
const COVE_RIM = 5.2;
const COVE_MOUTH_HALF_WIDTH = 74;
const COVE_CHANNEL_END = 540;

const COVE_X = Math.cos(COVE_ANGLE) * COVE_CENTER_RADIUS;
const COVE_Z = Math.sin(COVE_ANGLE) * COVE_CENTER_RADIUS;
const COVE_AXIS_X = COVE_X / COVE_CENTER_RADIUS;
const COVE_AXIS_Z = COVE_Z / COVE_CENTER_RADIUS;
const COVE_CHANNEL_LENGTH = COVE_CHANNEL_END - COVE_CENTER_RADIUS;

const LAKES = [
  { x: -168, z: 128, radius: 96, depth: 13 },
  { x: 186, z: 158, radius: 72, depth: 10 },
  { x: -286, z: -186, radius: 58, depth: 8 },
];

function hashInt(x, z, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;

  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);

  const a = hashInt(ix, iz, seed);
  const b = hashInt(ix + 1, iz, seed);
  const c = hashInt(ix, iz + 1, seed);
  const d = hashInt(ix + 1, iz + 1, seed);

  const top = a + (b - a) * ux;
  const bottom = c + (d - c) * ux;
  return top + (bottom - top) * uz;
}

function fbm(x, z, octaves, seed) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;

  for (let i = 0; i < octaves; i++) {
    value += amplitude * valueNoise(x * frequency, z * frequency, seed + i * 1013);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return value / total;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function rawHeight(x, z) {
  const warpX = x + (fbm(x * 0.0017 + 31.7, z * 0.0017 - 12.3, 2, WORLD_SEED + 71) - 0.5) * 190;
  const warpZ = z + (fbm(x * 0.0017 - 18.1, z * 0.0017 + 24.5, 2, WORLD_SEED + 137) - 0.5) * 190;

  let height = fbm(warpX * 0.0014, warpZ * 0.0014, 4, WORLD_SEED) * 62 - 12;
  height += (fbm(x * 0.0072, z * 0.0072, 3, WORLD_SEED + 401) - 0.5) * 9;

  const ridge = 1 - Math.abs(fbm(x * 0.0029, z * 0.0029, 2, WORLD_SEED + 907) * 2 - 1);
  height += ridge * ridge * 16;

  if (height > 0) height = MAX_TERRAIN_HEIGHT * Math.tanh(height / MAX_TERRAIN_HEIGHT);
  return Math.max(height, INLAND_FLOOR);
}

const spawnLevel = rawHeight(0, 0);
const towerLevel = rawHeight(TOWER_X, TOWER_Z);

function shapedHeight(x, z) {
  let height = rawHeight(x, z);

  const spawnBlend = smoothstep(SPAWN_FLAT_RADIUS, SAFE_ZONE_RADIUS, Math.sqrt(x * x + z * z));
  height = height * (1 - spawnBlend) + spawnLevel * spawnBlend;

  const towerDistance = Math.sqrt((x - TOWER_X) ** 2 + (z - TOWER_Z) ** 2);
  const towerBlend = smoothstep(TOWER_FLAT_RADIUS, TOWER_FLAT_RADIUS * 0.55, towerDistance);
  height = height * (1 - towerBlend) + towerLevel * towerBlend;

  const along = TOWER_X - x;
  if (along > 0) {
    const acrossFade = smoothstep(TOWER_PLAZA_HALF_WIDTH + 16, TOWER_PLAZA_HALF_WIDTH - 2, Math.abs(z - TOWER_Z));
    const alongFade = smoothstep(TOWER_PLAZA_FAR + 18, TOWER_PLAZA_FAR - 4, along);
    const plazaBlend = acrossFade * alongFade;
    height = height * (1 - plazaBlend) + towerLevel * plazaBlend;
  }

  return height;
}

function coveProfile(t) {
  const basin = smoothstep(0, 0.58, t);
  const beach = smoothstep(0.55, 0.84, t);
  const back = smoothstep(0.82, 1, t);

  return COVE_FLOOR
    + (COVE_SHELF - COVE_FLOOR) * basin
    + (COVE_BERM - COVE_SHELF) * beach
    + (COVE_RIM - COVE_BERM) * back;
}

function applyCove(x, z, height) {
  const dx = x - COVE_X;
  const dz = z - COVE_Z;
  const distance = Math.sqrt(dx * dx + dz * dz);

  if (distance < COVE_RADIUS * 1.35) {
    const t = Math.min(1, distance / COVE_RADIUS);
    const bowl = coveProfile(t);
    const blend = 1 - smoothstep(COVE_RADIUS, COVE_RADIUS * 1.35, distance);
    height = height * (1 - blend) + bowl * blend;
  }

  const along = dx * COVE_AXIS_X + dz * COVE_AXIS_Z;
  if (along <= 0) return height;

  const clamped = Math.min(along, COVE_CHANNEL_LENGTH);
  const perpendicular = Math.abs(dz * COVE_AXIS_X - dx * COVE_AXIS_Z);
  const side = 1 - smoothstep(COVE_MOUTH_HALF_WIDTH * 0.62, COVE_MOUTH_HALF_WIDTH, perpendicular);
  if (side <= 0) return height;

  const floor = COVE_FLOOR + (SEABED_DEPTH - COVE_FLOOR) * smoothstep(0, COVE_CHANNEL_LENGTH, clamped);
  const carved = Math.min(height, floor);
  return height * (1 - side) + carved * side;
}

function baseHeight(x, z) {
  const height = shapedHeight(x, z);

  const distanceFromCenter = Math.sqrt(x * x + z * z);
  const shaped = distanceFromCenter > SHORE_RADIUS
    ? height * (1 - smoothstep(SHORE_RADIUS, SHORE_RADIUS + 46, distanceFromCenter))
      + SEABED_DEPTH * smoothstep(SHORE_RADIUS, SHORE_RADIUS + 46, distanceFromCenter)
    : height;

  return applyCove(x, z, shaped);
}

function lowestAround(centerX, centerZ, radius) {
  let lowest = baseHeight(centerX, centerZ);

  for (let ring = 1; ring <= 3; ring++) {
    const sampleRadius = radius * (0.45 + ring * 0.185);
    for (let step = 0; step < 24; step++) {
      const angle = (step / 24) * Math.PI * 2;
      const height = baseHeight(
        centerX + Math.cos(angle) * sampleRadius,
        centerZ + Math.sin(angle) * sampleRadius
      );
      if (height < lowest) lowest = height;
    }
  }

  return lowest;
}

const lakeSurfaces = LAKES.map((lake) => ({
  x: lake.x,
  z: lake.z,
  radius: lake.radius,
  depth: lake.depth,
  level: lowestAround(lake.x, lake.z, lake.radius) - 0.8,
}));

function getHeightAt(x, z) {
  let height = baseHeight(x, z);

  for (const lake of lakeSurfaces) {
    const dx = x - lake.x;
    const dz = z - lake.z;
    const outer = lake.radius * 1.3;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance > outer) continue;

    const t = Math.min(1, distance / lake.radius);
    const basin = lake.level - lake.depth * (1 - t * t);
    const blend = 1 - smoothstep(lake.radius, outer, distance);
    const carved = Math.min(height, basin);
    height = height * (1 - blend) + carved * blend;
  }

  return height;
}

function getSlopeAt(x, z) {
  const step = 1.4;
  const hx = getHeightAt(x + step, z) - getHeightAt(x - step, z);
  const hz = getHeightAt(x, z + step) - getHeightAt(x, z - step);
  return Math.sqrt(hx * hx + hz * hz) / (2 * step);
}

function getWaterLevelAt(x, z) {
  for (const lake of lakeSurfaces) {
    const distance = Math.hypot(x - lake.x, z - lake.z);
    if (distance <= lake.radius) return lake.level;
  }

  return SEA_LEVEL;
}

function isDryLand(x, z, clearance = 1.2) {
  return getHeightAt(x, z) > getWaterLevelAt(x, z) + clearance;
}

module.exports = {
  WORLD_SEED,
  SEA_LEVEL,
  SHORE_RADIUS,
  PLAY_RADIUS,
  SAFE_ZONE_RADIUS,
  SPAWN_FLAT_RADIUS,
  TOWER_X,
  TOWER_Z,
  TOWER_FLAT_RADIUS,
  LAKES,
  lakeSurfaces,
  spawnLevel,
  towerLevel,
  getHeightAt,
  getSlopeAt,
  getWaterLevelAt,
  isDryLand,
};
