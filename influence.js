// game-server/influence.js
const geometry = require('./influenceGeometry');

const INFLUENCE_LOCATION_ID = 'influence-point';

const INFLUENCE_CONFIG = {
  locationId: INFLUENCE_LOCATION_ID,
  capacity: 50,
  ownerCapacity: 25,
  captureMs: 60000,
  captureRadius: 9,
  contestRadius: 22,
  crystalMaxHealth: 40000,
  crystalRepairPerHour: 2500,
  siegeIntervalMs: 2 * 24 * 60 * 60 * 1000,
  siegeHour: 12,
  siegeWaveGapMs: 26000,
  siegeWaves: 9,
  siegeMaxLive: 46,
  collapseWaveGapMs: 14000,
  collapseMaxLive: 60,
  collapseGraceMs: 20000,
  ambientMaxLive: 145,
  ambientRespawnMs: 95000,
  lootReopenMs: 15 * 60 * 1000,
  lootPerVisit: 12,
  lootReach: 3.4,
  entryFeeMax: 1000000,
  bossArena: geometry.BOSS_ARENA,
  spawnProtectionMs: 12000,
};

const FEE_CURRENCIES = new Set(['none', 'ash', 'tnj', 'faction']);

const PHASES = new Set(['sealed', 'claimable', 'owned', 'siege', 'collapse']);

function defaultState() {
  return {
    status: 'closed',
    breach: { x: 0, y: 0, z: 0, spawnedAt: 0 },
    phase: 'sealed',
    ownerFactionId: null,
    ownerFactionName: null,
    ownerFactionSymbol: null,
    ownerFactionImage: null,
    feeCurrency: 'none',
    feeAmount: 0,
    feeTokenCa: null,
    feeWallet: null,
    bossDefeated: false,
    crystalHealth: INFLUENCE_CONFIG.crystalMaxHealth,
    nextSiegeAt: 0,
    capturedAt: 0,
    lastCommandId: null,
  };
}

function toFinite(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeState(raw) {
  const base = defaultState();
  const source = raw && typeof raw === 'object' ? raw : {};

  const status = source.status === 'open' || source.status === 'collapsing' ? source.status : 'closed';
  const phase = PHASES.has(source.phase) ? source.phase : 'sealed';
  const currency = FEE_CURRENCIES.has(source.feeCurrency) ? source.feeCurrency : 'none';

  return {
    ...base,
    status,
    phase,
    breach: {
      x: toFinite(source.breach?.x, 0),
      y: toFinite(source.breach?.y, 0),
      z: toFinite(source.breach?.z, 0),
      spawnedAt: toFinite(source.breach?.spawnedAt, 0),
    },
    ownerFactionId: typeof source.ownerFactionId === 'string' ? source.ownerFactionId : null,
    ownerFactionName: typeof source.ownerFactionName === 'string' ? source.ownerFactionName : null,
    ownerFactionSymbol: typeof source.ownerFactionSymbol === 'string' ? source.ownerFactionSymbol : null,
    ownerFactionImage: typeof source.ownerFactionImage === 'string' ? source.ownerFactionImage : null,
    feeCurrency: currency,
    feeAmount: Math.max(0, Math.min(INFLUENCE_CONFIG.entryFeeMax, toFinite(source.feeAmount, 0))),
    feeTokenCa: typeof source.feeTokenCa === 'string' ? source.feeTokenCa : null,
    feeWallet: typeof source.feeWallet === 'string' ? source.feeWallet : null,
    bossDefeated: source.bossDefeated === true,
    crystalHealth: Math.max(0, Math.min(
      INFLUENCE_CONFIG.crystalMaxHealth,
      Math.round(toFinite(source.crystalHealth, INFLUENCE_CONFIG.crystalMaxHealth))
    )),
    nextSiegeAt: Math.max(0, Math.round(toFinite(source.nextSiegeAt, 0))),
    capturedAt: Math.max(0, Math.round(toFinite(source.capturedAt, 0))),
    lastCommandId: typeof source.lastCommandId === 'string' ? source.lastCommandId : null,
  };
}

function scheduleFirstSiege(now) {
  const date = new Date(now);
  date.setHours(INFLUENCE_CONFIG.siegeHour, 0, 0, 0);

  let when = date.getTime();
  while (when <= now + 60 * 60 * 1000) when += 24 * 60 * 60 * 1000;

  return when + 24 * 60 * 60 * 1000;
}

function scheduleNextSiege(previous, now) {
  let when = previous > 0 ? previous : scheduleFirstSiege(now);
  while (when <= now) when += INFLUENCE_CONFIG.siegeIntervalMs;
  return when;
}

function siegeWaveComposition(wave) {
  const step = Math.max(1, wave);
  const brutes = step >= 3 ? Math.min(5, Math.floor((step - 1) / 2)) : 0;
  const runners = Math.min(14, 2 + Math.floor(step * 1.3));
  const walkers = Math.min(26, 8 + step * 2);
  const herald = step % 4 === 0 ? 1 : 0;

  return {
    walkers,
    runners,
    brutes,
    heralds: herald,
    healthMult: 1 + (step - 1) * 0.16,
    damageMult: 1 + (step - 1) * 0.09,
  };
}

function collapseWaveComposition(wave) {
  const step = Math.max(1, wave);

  return {
    walkers: Math.min(30, 12 + step * 3),
    runners: Math.min(20, 6 + step * 2),
    brutes: Math.min(8, 1 + Math.floor(step / 2)),
    heralds: step % 2 === 0 ? 1 : 0,
    healthMult: 1.4 + step * 0.24,
    damageMult: 1.25 + step * 0.14,
  };
}

const FLOW_CELL = 1.5;
const FLOW_CLEARANCE = 0.75;
const FLOW_ORIGIN = -(geometry.OUTER_RADIUS + 4);
const FLOW_SIZE = Math.ceil((-FLOW_ORIGIN * 2) / FLOW_CELL) + 1;
const FLOW_UNREACHED = 0x7fffffff;

let walkMask = null;

function ensureWalkMask() {
  if (walkMask) return walkMask;

  walkMask = new Uint8Array(FLOW_SIZE * FLOW_SIZE);
  for (let ix = 0; ix < FLOW_SIZE; ix++) {
    const x = FLOW_ORIGIN + ix * FLOW_CELL;
    for (let iz = 0; iz < FLOW_SIZE; iz++) {
      const z = FLOW_ORIGIN + iz * FLOW_CELL;
      walkMask[iz * FLOW_SIZE + ix] = geometry.cityWalkable(x, z, FLOW_CLEARANCE) ? 1 : 0;
    }
  }

  return walkMask;
}

function cellOf(value) {
  const index = Math.round((value - FLOW_ORIGIN) / FLOW_CELL);
  return index < 0 ? 0 : index >= FLOW_SIZE ? FLOW_SIZE - 1 : index;
}

function buildFlowField(targetX, targetZ) {
  const mask = ensureWalkMask();
  const dist = new Int32Array(FLOW_SIZE * FLOW_SIZE).fill(FLOW_UNREACHED);
  const queue = new Int32Array(FLOW_SIZE * FLOW_SIZE);

  let head = 0;
  let tail = 0;

  const seed = cellOf(targetZ) * FLOW_SIZE + cellOf(targetX);
  if (!mask[seed]) return { dist, ok: false };

  dist[seed] = 0;
  queue[tail++] = seed;

  while (head < tail) {
    const cell = queue[head++];
    const ix = cell % FLOW_SIZE;
    const iz = (cell - ix) / FLOW_SIZE;
    const next = dist[cell] + 1;

    if (ix > 0) {
      const n = cell - 1;
      if (mask[n] && dist[n] === FLOW_UNREACHED) { dist[n] = next; queue[tail++] = n; }
    }
    if (ix < FLOW_SIZE - 1) {
      const n = cell + 1;
      if (mask[n] && dist[n] === FLOW_UNREACHED) { dist[n] = next; queue[tail++] = n; }
    }
    if (iz > 0) {
      const n = cell - FLOW_SIZE;
      if (mask[n] && dist[n] === FLOW_UNREACHED) { dist[n] = next; queue[tail++] = n; }
    }
    if (iz < FLOW_SIZE - 1) {
      const n = cell + FLOW_SIZE;
      if (mask[n] && dist[n] === FLOW_UNREACHED) { dist[n] = next; queue[tail++] = n; }
    }
  }

  return { dist, ok: true, reached: tail };
}

const NEIGHBOURS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function flowDirection(field, x, z) {
  const ix = cellOf(x);
  const iz = cellOf(z);
  const here = field.dist[iz * FLOW_SIZE + ix];
  if (here === FLOW_UNREACHED) return null;
  if (here === 0) return null;

  let bestValue = here;
  let bestX = 0;
  let bestZ = 0;

  for (const [dx, dz] of NEIGHBOURS) {
    const nx = ix + dx;
    const nz = iz + dz;
    if (nx < 0 || nz < 0 || nx >= FLOW_SIZE || nz >= FLOW_SIZE) continue;

    const value = field.dist[nz * FLOW_SIZE + nx];
    if (value >= bestValue) continue;

    bestValue = value;
    bestX = dx;
    bestZ = dz;
  }

  if (bestX === 0 && bestZ === 0) return null;
  return [bestX, bestZ];
}

function flowEscapeDirection(field, x, z) {
  let bestValue = Infinity;
  let bestX = 0;
  let bestZ = 0;

  for (let ring = 1; ring <= 4; ring++) {
    const reach = ring * 2;

    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const dx = Math.cos(angle) * reach;
      const dz = Math.sin(angle) * reach;

      const ix = cellOf(x + dx);
      const iz = cellOf(z + dz);
      const value = field.dist[iz * FLOW_SIZE + ix];
      if (value === FLOW_UNREACHED) continue;

      if (value < bestValue) {
        bestValue = value;
        bestX = dx;
        bestZ = dz;
      }
    }

    if (bestValue < Infinity) return [bestX, bestZ];
  }

  return null;
}

function flowDistance(field, x, z) {
  const value = field.dist[cellOf(z) * FLOW_SIZE + cellOf(x)];
  return value === FLOW_UNREACHED ? Infinity : value * FLOW_CELL;
}

let crystalField = null;

function crystalFlowField() {
  if (!crystalField) crystalField = buildFlowField(geometry.CRYSTAL.x, geometry.CRYSTAL.z);
  return crystalField;
}

function isWalkable(x, z) {
  const ix = cellOf(x);
  const iz = cellOf(z);
  return ensureWalkMask()[iz * FLOW_SIZE + ix] === 1;
}

function feeIsPayable(state) {
  if (state.feeCurrency === 'none') return false;
  if (!(state.feeAmount > 0)) return false;
  if (state.feeCurrency === 'faction' && !state.feeTokenCa) return false;
  return true;
}

module.exports = {
  INFLUENCE_LOCATION_ID,
  INFLUENCE_CONFIG,
  FEE_CURRENCIES,
  FLOW_CELL,
  FLOW_CLEARANCE,
  defaultState,
  normalizeState,
  scheduleFirstSiege,
  scheduleNextSiege,
  siegeWaveComposition,
  collapseWaveComposition,
  buildFlowField,
  crystalFlowField,
  flowDirection,
  flowEscapeDirection,
  flowDistance,
  isWalkable,
  feeIsPayable,
};
