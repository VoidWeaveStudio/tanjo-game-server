// scripts/checkTerrain.js
const fs = require('fs');
const path = require('path');
const terrain = require('../worldTerrain');

const CLIENT_ROOT = path.resolve(__dirname, '../../advenjohub5.5/src/features/game/world/locations/main-world');
const CONFIG_PATH = path.join(CLIENT_ROOT, 'worldConfig.ts');
const NOISE_PATH = path.join(CLIENT_ROOT, 'utils/worldNoise.ts');
const TERRAIN_PATH = path.join(CLIENT_ROOT, 'systems/TerrainSystem.ts');

const SHARED_CONSTANTS = {
  WORLD_SEED: terrain.WORLD_SEED,
  SEA_LEVEL: terrain.SEA_LEVEL,
  SHORE_RADIUS: terrain.SHORE_RADIUS,
  PLAY_RADIUS: terrain.PLAY_RADIUS,
  SAFE_ZONE_RADIUS: terrain.SAFE_ZONE_RADIUS,
  SPAWN_FLAT_RADIUS: terrain.SPAWN_FLAT_RADIUS,
  TOWER_X: terrain.TOWER_X,
  TOWER_Z: terrain.TOWER_Z,
  TOWER_FLAT_RADIUS: terrain.TOWER_FLAT_RADIUS,
};

const EXPRESSIONS = [
  { file: TERRAIN_PATH, needle: 'const INLAND_FLOOR = 1.6;' },
  { file: TERRAIN_PATH, needle: 'const MAX_TERRAIN_HEIGHT = 40;' },
  { file: TERRAIN_PATH, needle: 'fbm(warpX * 0.0014, warpZ * 0.0014, 4, WORLD_SEED) * 62 - 12' },
  { file: TERRAIN_PATH, needle: 'ridge * ridge * 16' },
  { file: TERRAIN_PATH, needle: 'const step = 1.4;' },
  { file: NOISE_PATH, needle: 'Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 362437)' },
  { file: NOISE_PATH, needle: 'value += amplitude * valueNoise(x * frequency, z * frequency, seed + i * 1013);' },
];

let failures = 0;

function fail(message) {
  failures++;
  console.error(`  FAIL  ${message}`);
}

function readSource(file) {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

console.log('client constants');

const configSource = readSource(CONFIG_PATH);
if (!configSource) {
  console.log('  SKIP  client sources not reachable from here');
} else {
  for (const [name, expected] of Object.entries(SHARED_CONSTANTS)) {
    const match = configSource.match(new RegExp(`export const ${name}\\s*=\\s*(-?[0-9.]+)`));
    if (!match) {
      fail(`${name} not found in worldConfig.ts`);
      continue;
    }

    const value = Number(match[1]);
    if (value !== expected) fail(`${name}: client ${value} !== server ${expected}`);
    else console.log(`  ok    ${name} = ${value}`);
  }

  const lakeMatch = configSource.match(/export const LAKES[\s\S]*?\];/);
  if (!lakeMatch) {
    fail('LAKES not found in worldConfig.ts');
  } else {
    const numbers = (lakeMatch[0].match(/-?\d+(\.\d+)?/g) || []).map(Number);
    const expected = terrain.LAKES.flatMap((lake) => [lake.x, lake.z, lake.radius, lake.depth]);
    if (numbers.join(',') !== expected.join(',')) fail(`LAKES mismatch: client [${numbers}] !== server [${expected}]`);
    else console.log(`  ok    LAKES (${terrain.LAKES.length} entries)`);
  }

  console.log('shared expressions');
  for (const entry of EXPRESSIONS) {
    const source = readSource(entry.file);
    if (!source) {
      fail(`${path.basename(entry.file)} unreadable`);
      continue;
    }
    if (!source.includes(entry.needle)) fail(`${path.basename(entry.file)} no longer contains: ${entry.needle}`);
    else console.log(`  ok    ${entry.needle.slice(0, 58)}`);
  }
}

console.log('sanity');

const spawn = terrain.getHeightAt(0, 0);
if (Math.abs(spawn - terrain.spawnLevel) > 1e-9) fail(`spawn height ${spawn} !== spawnLevel ${terrain.spawnLevel}`);
else console.log(`  ok    spawn height ${spawn.toFixed(3)}`);

let finite = true;
let minHeight = Infinity;
let maxHeight = -Infinity;

for (let i = 0; i < 4000; i++) {
  const angle = (i / 4000) * Math.PI * 2 * 7;
  const radius = (i / 4000) * terrain.PLAY_RADIUS;
  const height = terrain.getHeightAt(Math.sin(angle) * radius, -Math.cos(angle) * radius);
  if (!Number.isFinite(height)) finite = false;
  if (height < minHeight) minHeight = height;
  if (height > maxHeight) maxHeight = height;
}

if (!finite) fail('non-finite terrain height produced');
else console.log(`  ok    4000 samples finite, range ${minHeight.toFixed(1)} .. ${maxHeight.toFixed(1)}`);

if (!terrain.isDryLand(0, 0)) fail('spawn point classified as water');
else console.log('  ok    spawn is dry land');

if (terrain.isDryLand(-168, 128)) fail('lake centre classified as dry land');
else console.log('  ok    lake centre is water');

console.log(failures === 0 ? '\nterrain check passed' : `\nterrain check failed (${failures})`);
process.exit(failures === 0 ? 0 : 1);
