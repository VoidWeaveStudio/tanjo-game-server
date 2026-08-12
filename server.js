// server.js
require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { FACTION_TASKS, FACTION_TASKS_BY_KEY } = require('./factionTasks');
const {
  QUEST_LISTING_FEE_ASH,
  QUEST_MIN_SLOTS,
  QUEST_MAX_SLOTS,
  QUEST_MIN_REWARD_ASH,
  QUEST_MAX_REWARD_ASH,
  FACTION_QUEST_TYPES,
  isValidXPostUrl,
  questTotalCostAsh,
} = require('./factionQuests');

const PORT = process.env.PORT || 3001;
const MAX_PLAYERS = 100;

const EMOTE_KEYS = ['laugh', 'fuck_you', 'angry', 'to_the_moon', 'green_candle'];

const COSMETIC_SLOTS = {
  scream_mask: 'accessory',
  trump_hair: 'accessory',
  scream_robe: 'skin',
  trump_suit: 'skin',
  pepe_frog: 'skin',
};
const COSMETIC_PRICE_ASH = 1;

const INTERNAL_HTTP_AGENT = new http.Agent({ keepAlive: true, maxSockets: 24, keepAliveMsecs: 15000 });
const INTERNAL_HTTPS_AGENT = new https.Agent({ keepAlive: true, maxSockets: 24, keepAliveMsecs: 15000 });

const internalCache = new Map();

const CONFIG = {
  world: {
    size: 1000,
    zoneSize: 100,
    aoiRadius: 2,
    maxSpeed: 15,
    maxPositionUpdateRate: 50,
  },
  network: {
    heartbeatInterval: 5000,
    heartbeatTimeout: 15000,
    staleTimeout: 60000,
    maxMessageSize: 32 * 1024,
    chatRateLimit: 3,
    updateRateLimit: 25,
    shootRateLimit: 10,
    hitRateLimit: 15,
    sellRateLimit: 20,
    buildRateLimit: 10,
    voiceRateLimit: 40,
    locationChangeRateLimit: 10,
    nicknameChangeRateLimit: 3,
    skinUpdateRateLimit: 3,
    saveProgressRateLimit: 5,
    questRateLimit: 10,
    canyonRateLimit: 10,
    factionRateLimit: 10,
    factionSearchRateLimit: 15,
    profileRateLimit: 15,
    friendRateLimit: 10,
    friendSearchRateLimit: 15,
    mailSendRateLimit: 5,
    mailReadRateLimit: 15,
    respawnRateLimit: 3,
    tokenLookupRateLimit: 1,
    supportRateLimit: 1,
    blockRateLimit: 5,
    privateMessageRateLimit: 5,
    factionChatRateLimit: 3,
    factionInviteRateLimit: 5,
    factionQuestRateLimit: 10,
    factionQuestCreateRateLimit: 3,
    emoteRateLimit: 2,
    cosmeticRateLimit: 5,
    tradeRateLimit: 8,
  },
  combat: {
    maxShotRange: 200,
    hitTolerance: 3,
    shotMatchWindowMs: 500,
  },
  siteUrl: process.env.SITE_URL || 'https://theadvenjo.online',
  internalSecret: process.env.INTERNAL_API_SECRET,
  gameTokenSecret: process.env.GAME_TOKEN_SECRET || process.env.JWT_SECRET,
  autoSaveInterval: 30000,
};

const WEAPON_CONFIG = {
  maxAmmo: 30,
  fireRateMs: 120,
  fireRateToleranceMs: 20,
  reloadDurationMs: 2000,
};

const PLAYER_WEAPON_DAMAGE_TO_ENEMY = 25;

const CANYON_CONFIG = {
  tickRate: 100,
  hitTolerance: 5,
  patrolPauseMinMs: 2000,
  patrolPauseMaxMs: 5000,
};

const CANYON_HALF_WIDTH = 50;
const CANYON_HUB_LENGTH = 100;
const CANYON_START_Z = CANYON_HUB_LENGTH;
const CANYON_SAFE_ENTRANCE_DEPTH = 100;
const CANYON_COMBAT_DEPTH = 360;
const CANYON_BOSS_ZONE_DEPTH = 40;
const CANYON_SEGMENT_LENGTH = CANYON_SAFE_ENTRANCE_DEPTH + CANYON_COMBAT_DEPTH + CANYON_BOSS_ZONE_DEPTH;
const CANYON_MAX_SEGMENT_CAP = 200;

const CANYON_HUB_POSITION = [0, 0, 20];

function canyonSegmentStartZ(segment) {
  return CANYON_START_Z + (segment - 1) * CANYON_SEGMENT_LENGTH;
}

function canyonSegmentName(segment) {
  const biome = canyonBiomeFor(segment);
  return segment <= CANYON_BIOMES.length ? biome.name : `${biome.name} — Segment ${segment}`;
}

const ENEMY_TYPES = {
  slime: {
    name: 'Slime', maxHealth: 100, attackDamage: 10, attackRange: 1.5, aggroRadius: 20, aggroLeash: 150,
    attackCooldown: 1000, chaseSpeedNear: 5, chaseSpeedFar: 17.5, chaseNearThreshold: 10,
    patrolSpeed: 1.8, patrolRadius: 18, scale: 1, lootMin: 1, lootMax: 3,
  },
  slime_boss: {
    name: 'Slime Boss', maxHealth: 600, attackDamage: 25, attackRange: 2.5, aggroRadius: 30, aggroLeash: 180,
    attackCooldown: 1200, chaseSpeedNear: 4, chaseSpeedFar: 10, chaseNearThreshold: 12,
    patrolSpeed: 1.2, patrolRadius: 10, scale: 3, lootMin: 10, lootMax: 20,
  },
  husk: {
    name: 'Ash Husk', maxHealth: 140, attackDamage: 14, attackRange: 1.8, aggroRadius: 24, aggroLeash: 160,
    attackCooldown: 900, chaseSpeedNear: 6, chaseSpeedFar: 15, chaseNearThreshold: 10,
    patrolSpeed: 2.2, patrolRadius: 20, scale: 1.15, lootMin: 2, lootMax: 4,
  },
  husk_boss: {
    name: 'Cinder Colossus', maxHealth: 900, attackDamage: 32, attackRange: 3, aggroRadius: 34, aggroLeash: 190,
    attackCooldown: 1300, chaseSpeedNear: 4.5, chaseSpeedFar: 11, chaseNearThreshold: 12,
    patrolSpeed: 1.3, patrolRadius: 12, scale: 3.4, lootMin: 14, lootMax: 26,
  },
  frostling: {
    name: 'Frostling', maxHealth: 120, attackDamage: 12, attackRange: 1.6, aggroRadius: 26, aggroLeash: 170,
    attackCooldown: 800, chaseSpeedNear: 7, chaseSpeedFar: 19, chaseNearThreshold: 9,
    patrolSpeed: 2.6, patrolRadius: 22, scale: 0.9, lootMin: 2, lootMax: 5,
  },
  frost_boss: {
    name: 'Glacier Warden', maxHealth: 1100, attackDamage: 36, attackRange: 3.2, aggroRadius: 36, aggroLeash: 200,
    attackCooldown: 1400, chaseSpeedNear: 4.2, chaseSpeedFar: 12, chaseNearThreshold: 13,
    patrolSpeed: 1.4, patrolRadius: 12, scale: 3.6, lootMin: 18, lootMax: 32,
  },
  sporeling: {
    name: 'Sporeling', maxHealth: 165, attackDamage: 16, attackRange: 2, aggroRadius: 22, aggroLeash: 165,
    attackCooldown: 950, chaseSpeedNear: 5.5, chaseSpeedFar: 16, chaseNearThreshold: 10,
    patrolSpeed: 2, patrolRadius: 19, scale: 1.25, lootMin: 3, lootMax: 6,
  },
  spore_boss: {
    name: 'Mycelial Heart', maxHealth: 1400, attackDamage: 40, attackRange: 3.4, aggroRadius: 34, aggroLeash: 200,
    attackCooldown: 1500, chaseSpeedNear: 3.8, chaseSpeedFar: 10.5, chaseNearThreshold: 14,
    patrolSpeed: 1.1, patrolRadius: 11, scale: 4, lootMin: 22, lootMax: 40,
  },
  voidling: {
    name: 'Voidling', maxHealth: 200, attackDamage: 20, attackRange: 1.9, aggroRadius: 30, aggroLeash: 180,
    attackCooldown: 750, chaseSpeedNear: 8, chaseSpeedFar: 21, chaseNearThreshold: 9,
    patrolSpeed: 3, patrolRadius: 24, scale: 1.05, lootMin: 4, lootMax: 8,
  },
  void_boss: {
    name: 'The Rug Puller', maxHealth: 1800, attackDamage: 46, attackRange: 3.6, aggroRadius: 40, aggroLeash: 220,
    attackCooldown: 1200, chaseSpeedNear: 5, chaseSpeedFar: 14, chaseNearThreshold: 14,
    patrolSpeed: 1.6, patrolRadius: 14, scale: 4.2, lootMin: 30, lootMax: 55,
  },
};

const CANYON_BIOMES = [
  { key: 'slime_valley', name: 'Slime Valley', mob: 'slime', boss: 'slime_boss', mobCount: 10 },
  { key: 'ember_wastes', name: 'Ember Wastes', mob: 'husk', boss: 'husk_boss', mobCount: 12 },
  { key: 'frozen_shelf', name: 'Frozen Shelf', mob: 'frostling', boss: 'frost_boss', mobCount: 14 },
  { key: 'spore_hollow', name: 'Spore Hollow', mob: 'sporeling', boss: 'spore_boss', mobCount: 15 },
  { key: 'void_rift', name: 'Void Rift', mob: 'voidling', boss: 'void_boss', mobCount: 16 },
];

function canyonBiomeFor(segment) {
  const index = Math.min(CANYON_BIOMES.length, Math.max(1, segment)) - 1;
  return CANYON_BIOMES[index];
}

const QUESTS = {
  sola_kill_10: {
    id: 'sola_kill_10',
    npc: 'sola',
    title: 'Pest Control',
    description: 'Kill 10 slimes in Slime Valley.',
    type: 'kill_enemies',
    locationId: 'tower-first-floor',
    targetCount: 10,
    rewardAsh: 30,
  },
};

const DAY_NIGHT_CONFIG = {
  dayDurationMs: 40 * 60 * 1000,
  nightDurationMs: 20 * 60 * 1000,
};
const dayNightEpoch = Date.now();

if (!CONFIG.internalSecret) {
  console.error('[!] INTERNAL_API_SECRET not set. Persistence disabled.');
}
if (!CONFIG.gameTokenSecret) {
  console.error('[!] GAME_TOKEN_SECRET/JWT_SECRET not set. Auth will fail.');
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocket.Server({
  server,
  maxPayload: CONFIG.network.maxMessageSize,
  perMessageDeflate: false,
});

const players = new Map();
const userIdToPlayer = new Map();
const walletToPlayer = new Map();
const rateLimits = new Map();
const factionTaskState = new Map();

const factionTaskHydrating = new Map();

const factionTaskGeneration = new Map();

function nextFactionTaskGeneration(factionId) {
  const gen = (factionTaskGeneration.get(factionId) || 0) + 1;
  factionTaskGeneration.set(factionId, gen);
  return gen;
}

const VALID_STATES = new Set(['idle', 'walk', 'sprint', 'jump']);
const VALID_LOCATIONS = new Set([
  'main-world',
  'cave',
  'tower-main-hall',
  'tower-first-floor',
  'tower-token-gates',
  'tower-basement',
  'tower-events',
  'open-world-canyon',
]);

const FACTION_GATE_LOCATION_PATTERN = /^faction-gate-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAYER_ROOM_LOCATION_PATTERN = /^player-room-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isKnownLocationId(locationId) {
  return VALID_LOCATIONS.has(locationId) ||
    FACTION_GATE_LOCATION_PATTERN.test(locationId) ||
    PLAYER_ROOM_LOCATION_PATTERN.test(locationId);
}

const GALAXY_LOCATION_ID = 'tower-basement';
const SEALED_LOCATIONS = new Set(['tower-token-gates']);
const SHARDED_LOCATIONS = new Set(['tower-basement']);
const SHARD_CAPACITY = 40;
const SHARD_FRIEND_GRACE = 5;
const MAX_SHARDS = 64;
const GALAXY_MAX_RADIUS = 2600;
const GALAXY_MIN_Y = -1400;
const GALAXY_MAX_Y = 500;
const GALAXY_MAX_SPEED = 110;
const GALAXY_SPAWN = [0, 0, 14];
const PLAYER_ROOM_PREFIX = 'player-room-';

const LOCATION_MAX_RADIUS = {
  'tower-main-hall': 140,
  'tower-token-gates': 80,
  'tower-basement': GALAXY_MAX_RADIUS,
  'tower-events': 40,
  cave: 180,
  'open-world-canyon': 150,
};
const MAIN_WORLD_LIMIT = 480;
const MAIN_WORLD_SAFE_RADIUS = 34;
const MIN_LOCATION_CHANGE_INTERVAL_MS = 1000;
const SPAWN_PROTECTION_MS = 5000;
const CLIENT_READY_TIMEOUT_MS = 25000;
const TELEPORT_SETTLE_TOLERANCE = 20;

function getLocationMaxRadius(locationId) {
  if (LOCATION_MAX_RADIUS[locationId] != null) return LOCATION_MAX_RADIUS[locationId];
  if (locationId.startsWith('faction-gate-')) return 25;
  if (locationId.startsWith(PLAYER_ROOM_PREFIX)) return 25;
  return null;
}

function isValidPositionForLocation(locationId, pos) {
  if (!isValidPosition(pos, locationId)) return false;
  const maxRadius = getLocationMaxRadius(locationId);
  if (maxRadius == null) return true;
  const [x, , z] = pos;
  return Math.sqrt(x * x + z * z) <= maxRadius;
}

function getCachedMessage(data) {
  return JSON.stringify(data);
}

function sanitizeMessage(msg) {
  return msg
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
}

const CHAT_LINK_PATTERN = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|io|gg|xyz|app|dev|me|link|to|club|shop|site|online|info|biz|co|ru|tk|top|click|icu|cc|vip|live|fun|pw|ws)\b/i;

function containsLink(msg) {
  return CHAT_LINK_PATTERN.test(msg);
}

function checkRateLimit(playerId, type, limit) {
  const now = Date.now();
  const key = `${playerId}:${type}`;
  const data = rateLimits.get(key) || { count: 0, resetTime: now + 1000 };
  if (now > data.resetTime) {
    data.count = 0;
    data.resetTime = now + 1000;
  }
  data.count++;
  rateLimits.set(key, data);
  return data.count <= limit;
}

function isValidPosition(pos, locationId) {
  if (!Array.isArray(pos) || pos.length !== 3) return false;
  const [x, y, z] = pos;
  if (
    typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' ||
    isNaN(x) || isNaN(y) || isNaN(z) ||
    !isFinite(x) || !isFinite(y) || !isFinite(z)
  ) {
    return false;
  }

  if (locationId === GALAXY_LOCATION_ID) {
    return y >= GALAXY_MIN_Y && y <= GALAXY_MAX_Y &&
      Math.abs(x) <= GALAXY_MAX_RADIUS && Math.abs(z) <= GALAXY_MAX_RADIUS;
  }

  if (locationId === 'main-world') {
    if (y < -30 || y > 90) return false;
    return Math.abs(x) <= MAIN_WORLD_LIMIT && Math.abs(z) <= MAIN_WORLD_LIMIT;
  }

  if (y < -30 || y > 50) return false;

  if (locationId === 'tower-first-floor') {
    return Math.abs(x) <= CANYON_HALF_WIDTH + 70 && z >= -50 && z <= CANYON_START_Z + CANYON_SEGMENT_LENGTH * CANYON_MAX_SEGMENT_CAP;
  }

  const halfSize = CONFIG.world.size / 2;
  return Math.abs(x) <= halfSize && Math.abs(z) <= halfSize;
}

function isValidMovement(player, newPosition, deltaTimeMs) {
  const [ox, , oz] = player.position;
  const [nx, , nz] = newPosition;
  const dx = nx - ox;
  const dz = nz - oz;
  const distance = Math.sqrt(dx * dx + dz * dz);

  if (player.justSpawned || player.justTeleported) {
    player.justSpawned = false;
    player.justTeleported = false;
    if (player.locationId === GALAXY_LOCATION_ID) return true;
    return distance <= TELEPORT_SETTLE_TOLERANCE;
  }

  const seconds = deltaTimeMs / 1000;
  const speed = distance / seconds;
  const limit = player.locationId === GALAXY_LOCATION_ID ? GALAXY_MAX_SPEED : CONFIG.world.maxSpeed;
  return speed <= limit * 1.5;
}

function getHistoricalPosition(player, targetTime) {
  const history = player.positionHistory || [];
  if (history.length === 0) return player.position;

  const clampedTime = Math.max(history[0].time, Math.min(history[history.length - 1].time, targetTime));

  let before = history[0];
  let after = history[history.length - 1];

  for (let i = 0; i < history.length - 1; i++) {
    if (history[i].time <= clampedTime && history[i + 1].time >= clampedTime) {
      before = history[i];
      after = history[i + 1];
      break;
    }
  }

  const timeDiff = after.time - before.time;
  if (timeDiff <= 0) return before.position;

  const t = (clampedTime - before.time) / timeDiff;
  return [
    before.position[0] + (after.position[0] - before.position[0]) * t,
    before.position[1] + (after.position[1] - before.position[1]) * t,
    before.position[2] + (after.position[2] - before.position[2]) * t,
  ];
}

function distanceFromRay(origin, direction, point, maxRange) {
  const ox = point[0] - origin[0];
  const oy = point[1] - origin[1];
  const oz = point[2] - origin[2];

  const t = ox * direction[0] + oy * direction[1] + oz * direction[2];
  const clampedT = Math.max(0, Math.min(maxRange, t));

  const cx = origin[0] + direction[0] * clampedT;
  const cy = origin[1] + direction[1] * clampedT;
  const cz = origin[2] + direction[2] * clampedT;

  return Math.sqrt((point[0] - cx) ** 2 + (point[1] - cy) ** 2 + (point[2] - cz) ** 2);
}

const ENTITY_OCCLUSION_RADIUS = 0.6;

function isPathBlockedByEntity(origin, target, locationId, excludeIds, enemyPool) {
  const segX = target[0] - origin[0];
  const segZ = target[2] - origin[2];
  const segLenSq = segX * segX + segZ * segZ;
  if (segLenSq < 0.0001) return false;

  function blocks(pos) {
    const px = pos[0] - origin[0];
    const pz = pos[2] - origin[2];
    const t = (px * segX + pz * segZ) / segLenSq;
    if (t <= 0.02 || t >= 0.98) return false; 
    const cx = origin[0] + segX * t;
    const cz = origin[2] + segZ * t;
    const dx = pos[0] - cx;
    const dz = pos[2] - cz;
    return Math.sqrt(dx * dx + dz * dz) <= ENTITY_OCCLUSION_RADIUS;
  }

  for (const p of players.values()) {
    if (!p.authenticated || !p.alive) continue;
    if (excludeIds.has(p.id)) continue;
    if (p.locationId !== locationId) continue;
    if (blocks(p.position)) return true;
  }
  if (enemyPool) {
    for (const e of enemyPool) {
      if (!e.alive) continue;
      if (excludeIds.has(e.id)) continue;
      if (blocks(e.position)) return true;
    }
  }
  return false;
}

function findMatchingShot(player, targetHistoricalPos, now, tolerance = CONFIG.combat.hitTolerance) {
  const shots = player.recentShots || [];
  for (let i = shots.length - 1; i >= 0; i--) {
    const shot = shots[i];
    if (now - shot.time > CONFIG.combat.shotMatchWindowMs) continue;

    const dist = distanceFromRay(shot.origin, shot.direction, targetHistoricalPos, CONFIG.combat.maxShotRange);
    if (dist <= tolerance) {
      shots.splice(i, 1);
      return shot;
    }
  }
  return null;
}

function safeSend(ws, data) {
  if (ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(data));
    return true;
  } catch (err) {
    console.error('[WS] Send error:', err.message);
    return false;
  }
}

function generateUniqueNickname(base = 'Player') {
  const existing = Array.from(players.values()).map(p => p.nickname);
  if (!existing.includes(base)) return base;
  let suffix = 1;
  while (existing.includes(`${base}${suffix}`)) suffix++;
  return `${base}${suffix}`;
}

async function assignUniqueNickname(player, base) {
  const result = await callInternalApi('/api/internal/game/nickname/set', {
    userId: player.userId, gameId: player.gameId, nickname: base, allowSuffix: true,
  }).catch((err) => {
    console.error('[Nickname] auto-assign error:', err.message);
    return null;
  });
  return result?.nickname || generateUniqueNickname(base);
}

function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

function safeInterval(fn, ms) {
  return setInterval(() => {
    try {
      fn();
    } catch (err) {
      console.error('[!] Interval tick error:', err.message);
    }
  }, ms);
}

function getPlayerZone(player) {
  const halfSize = CONFIG.world.size / 2;
  const zoneX = Math.floor((player.position[0] + halfSize) / CONFIG.world.zoneSize);
  const zoneZ = Math.floor((player.position[2] + halfSize) / CONFIG.world.zoneSize);
  return { zoneX, zoneZ };
}

function isInAOI(player, other) {
  if (player.locationId !== other.locationId) return false;
  if (SHARDED_LOCATIONS.has(player.locationId) && player.instance !== other.instance) return false;

  if (player.locationId === 'tower-first-floor') {
    return !!(player.canyon && other.canyon && player.canyon.inHub && other.canyon.inHub);
  }

  const pZone = getPlayerZone(player);
  const oZone = getPlayerZone(other);
  const dx = Math.abs(pZone.zoneX - oZone.zoneX);
  const dz = Math.abs(pZone.zoneZ - oZone.zoneZ);
  return dx <= CONFIG.world.aoiRadius && dz <= CONFIG.world.aoiRadius;
}

function buildPlayerJoinPayload(p) {
  return {
    type: 'playerJoin',
    id: p.id,
    nickname: p.nickname,
    factionSymbol: p.displayedFactionSymbol,
    factionImage: p.displayedFactionImage,
    position: p.position,
    rotation: p.rotation,
    pitch: p.pitch,
    state: p.state || 'idle',
    jumping: p.jumping || false,
    velocityY: p.velocityY || 0,
    health: p.health,
    alive: p.alive,
    weaponEquipped: p.weaponEquipped,
    isShooting: p.isShooting,
    locationId: p.locationId,
    isAdmin: !!p.isAdmin,
    isFactionCreator: !!p.isFactionCreator,
    skinTextureUrl: p.skinTextureUrl || null,
    cosmeticSkinId: p.cosmeticSkinId || null,
    cosmeticAccessoryId: p.cosmeticAccessoryId || null,
  };
}

function recomputeAOI(player) {
  const newNeighbors = new Set();

  players.forEach((other, id) => {
    if (id === player.id) return;
    if (!other.authenticated || other.ws.readyState !== WebSocket.OPEN) return;
    if (isInAOI(player, other)) newNeighbors.add(id);
  });

  const oldNeighbors = player.aoiNeighbors;

  for (const id of newNeighbors) {
    if (oldNeighbors.has(id)) continue;
    const other = players.get(id);
    if (!other) continue;
    if (other.ready) safeSend(player.ws, buildPlayerJoinPayload(other));
    if (player.ready) safeSend(other.ws, buildPlayerJoinPayload(player));
    other.aoiNeighbors.add(player.id);
  }

  for (const id of oldNeighbors) {
    if (newNeighbors.has(id)) continue;
    const other = players.get(id);
    safeSend(player.ws, { type: 'playerLeave', playerId: id });
    if (other) {
      safeSend(other.ws, { type: 'playerLeave', playerId: player.id });
      other.aoiNeighbors.delete(player.id);
    }
  }

  player.aoiNeighbors = newNeighbors;
}

function notifyAOILeave(player) {
  for (const id of player.aoiNeighbors) {
    const other = players.get(id);
    if (!other) continue;
    other.aoiNeighbors.delete(player.id);
    safeSend(other.ws, { type: 'playerLeave', playerId: player.id });
  }
  player.aoiNeighbors = new Set();
}

function notifyLocationTransition(player, oldLocationId, newLocationId) {
  const oldNeighbors = player.aoiNeighbors;
  player.aoiNeighbors = new Set();
  for (const id of oldNeighbors) {
    const other = players.get(id);
    if (!other) continue;
    other.aoiNeighbors.delete(player.id);
    safeSend(other.ws, {
      type: 'playerLeaveLocation',
      playerId: player.id,
      fromLocation: oldLocationId,
      toLocation: newLocationId,
    });
  }

  players.forEach((other, id) => {
    if (id === player.id || !other.authenticated) return;
    if (!isInAOI(player, other)) return;
    player.aoiNeighbors.add(id);
    other.aoiNeighbors.add(player.id);
    if (player.ready) safeSend(other.ws, {
      type: 'playerJoinLocation',
      id: player.id,
      nickname: player.nickname,
      factionSymbol: player.displayedFactionSymbol,
      factionImage: player.displayedFactionImage,
      position: player.position,
      rotation: player.rotation,
      pitch: player.pitch,
      state: player.state || 'idle',
      jumping: player.jumping || false,
      velocityY: player.velocityY || 0,
      health: player.health,
      alive: player.alive,
      weaponEquipped: player.weaponEquipped,
      isShooting: player.isShooting,
      locationId: newLocationId,
      isAdmin: !!player.isAdmin,
      isFactionCreator: !!player.isFactionCreator,
      skinTextureUrl: player.skinTextureUrl || null,
      cosmeticSkinId: player.cosmeticSkinId || null,
      cosmeticAccessoryId: player.cosmeticAccessoryId || null,
    });
    if (other.ready) safeSend(player.ws, {
      type: 'playerJoinLocation',
      id: other.id,
      nickname: other.nickname,
      factionSymbol: other.displayedFactionSymbol,
      factionImage: other.displayedFactionImage,
      position: other.position,
      rotation: other.rotation,
      pitch: other.pitch,
      state: other.state || 'idle',
      jumping: other.jumping || false,
      velocityY: other.velocityY || 0,
      health: other.health,
      alive: other.alive,
      weaponEquipped: other.weaponEquipped,
      isShooting: other.isShooting,
      locationId: other.locationId,
      isAdmin: !!other.isAdmin,
      isFactionCreator: !!other.isFactionCreator,
      skinTextureUrl: other.skinTextureUrl || null,
      cosmeticSkinId: other.cosmeticSkinId || null,
      cosmeticAccessoryId: other.cosmeticAccessoryId || null,
    });
  });
}

function setPlayerLoading(player) {
  player.ready = false;
  if (player.readyTimer) clearTimeout(player.readyTimer);
  player.readyTimer = setTimeout(() => markPlayerReady(player), CLIENT_READY_TIMEOUT_MS);
}

function markPlayerReady(player) {
  if (player.readyTimer) {
    clearTimeout(player.readyTimer);
    player.readyTimer = null;
  }
  if (player.ready || !player.authenticated) return;

  player.ready = true;

  for (const id of player.aoiNeighbors) {
    const other = players.get(id);
    if (!other) continue;
    safeSend(other.ws, buildPlayerJoinPayload(player));
  }
}

function isInProtectedZone(player) {
  if (player.locationId === 'tower-main-hall') return true;
  if (player.locationId === 'main-world') {
    const [x, , z] = player.position;
    return Math.sqrt(x * x + z * z) <= MAIN_WORLD_SAFE_RADIUS;
  }
  return false;
}

function isSpawnProtected(player) {
  return !!player.invulnerableUntil && Date.now() < player.invulnerableUntil;
}

function grantSpawnProtection(player) {
  player.invulnerableUntil = Date.now() + SPAWN_PROTECTION_MS;
  safeSend(player.ws, { type: 'spawnProtection', untilMs: player.invulnerableUntil, durationMs: SPAWN_PROTECTION_MS });
}

function clearSpawnProtection(player) {
  if (!player.invulnerableUntil) return;
  player.invulnerableUntil = 0;
  safeSend(player.ws, { type: 'spawnProtection', untilMs: 0, durationMs: 0 });
}

function spawnInSafeZone(player, locationId) {
  const target = locationId || player.locationId;
  if (typeof target === 'string' && (target.startsWith('faction-gate-') || target.startsWith(PLAYER_ROOM_PREFIX))) {
    player.position = [0, 0, 4];
    return;
  }
  if (target === GALAXY_LOCATION_ID) {
    player.position = [...GALAXY_SPAWN];
    return;
  }
  const angle = Math.random() * Math.PI * 2;
  const maxRadius = getLocationMaxRadius(target);
  const spread = maxRadius == null ? 25 : Math.min(25, Math.max(0, maxRadius - 6));
  const r = spread <= 0 ? 0 : spread * (0.4 + Math.random() * 0.6);
  player.position = [Math.cos(angle) * r, 0, Math.sin(angle) * r];
}

function broadcastToLocation(locationId, data, excludeId = null, instance = null) {
  const message = getCachedMessage(data);
  players.forEach((p, id) => {
    if (id === excludeId) return;
    if (!p.authenticated || p.ws.readyState !== WebSocket.OPEN) return;
    if (p.locationId !== locationId) return;
    if (instance !== null && SHARDED_LOCATIONS.has(locationId) && p.instance !== instance) return;
    try {
      p.ws.send(message);
    } catch (err) {
      console.error('[!] Broadcast error:', err.message);
    }
  });
}

function isShardedLocation(locationId) {
  return SHARDED_LOCATIONS.has(locationId);
}

function countShardPlayers(locationId, instance) {
  let count = 0;
  players.forEach((p) => {
    if (!p.authenticated) return;
    if (p.locationId !== locationId) return;
    if (p.instance !== instance) return;
    count++;
  });
  return count;
}

function listShards(locationId) {
  const counts = new Map();
  players.forEach((p) => {
    if (!p.authenticated || p.locationId !== locationId) return;
    counts.set(p.instance, (counts.get(p.instance) || 0) + 1);
  });

  const highest = counts.size > 0 ? Math.max(...counts.keys()) : 1;
  const shards = [];
  for (let i = 1; i <= Math.max(1, highest); i++) {
    shards.push({ instance: i, count: counts.get(i) || 0 });
  }
  return shards;
}

function pickShard(locationId, requestedInstance) {
  if (Number.isInteger(requestedInstance) && requestedInstance >= 1 && requestedInstance <= MAX_SHARDS) {
    const occupancy = countShardPlayers(locationId, requestedInstance);
    if (occupancy < SHARD_CAPACITY + SHARD_FRIEND_GRACE) return requestedInstance;
  }

  for (let i = 1; i <= MAX_SHARDS; i++) {
    if (countShardPlayers(locationId, i) < SHARD_CAPACITY) return i;
  }
  return MAX_SHARDS;
}

function sendShardState(player) {
  if (!isShardedLocation(player.locationId)) return;
  safeSend(player.ws, {
    type: 'shardState',
    locationId: player.locationId,
    instance: player.instance,
    capacity: SHARD_CAPACITY,
    shards: listShards(player.locationId),
  });
}

function broadcastShardState(locationId) {
  if (!isShardedLocation(locationId)) return;
  const shards = listShards(locationId);
  players.forEach((p) => {
    if (!p.authenticated || p.locationId !== locationId) return;
    safeSend(p.ws, {
      type: 'shardState',
      locationId,
      instance: p.instance,
      capacity: SHARD_CAPACITY,
      shards,
    });
  });
}

function getSegmentDifficulty(segment) {
  const beyond = Math.max(0, segment - CANYON_BIOMES.length);
  const healthMult = 1 + beyond * 0.2;
  const damageMult = 1 + beyond * 0.15;
  const biome = canyonBiomeFor(segment);
  const mobCount = Math.min(biome.mobCount + beyond * 2, 26);
  return { healthMult, damageMult, mobCount };
}

function canyonPathOffsetX(z) {
  if (z <= CANYON_START_Z) return 0;
  const rel = z - CANYON_START_Z;
  return Math.sin(rel * 0.008) * 22 + Math.sin(rel * 0.021 + 1.7) * 9;
}

function canyonHalfWidthAt(z) {
  if (z <= CANYON_START_Z) return CANYON_HALF_WIDTH;
  const rel = z - CANYON_START_Z;
  return Math.max(25, CANYON_HALF_WIDTH + Math.sin(rel * 0.006 + 0.5) * 15);
}

function randomCanyonCombatPoint(segment) {
  const start = canyonSegmentStartZ(segment) + CANYON_SAFE_ENTRANCE_DEPTH;
  const end = start + CANYON_COMBAT_DEPTH;
  const z = start + Math.random() * (end - start);
  const x = canyonPathOffsetX(z) + (Math.random() * 2 - 1) * (canyonHalfWidthAt(z) - 6);
  return [x, 0, z];
}

function randomCanyonBossPoint(segment) {
  const start = canyonSegmentStartZ(segment) + CANYON_SAFE_ENTRANCE_DEPTH + CANYON_COMBAT_DEPTH;
  const end = canyonSegmentStartZ(segment) + CANYON_SEGMENT_LENGTH - 10;
  const z = start + Math.random() * (end - start);
  const x = canyonPathOffsetX(z) + (Math.random() * 2 - 1) * (canyonHalfWidthAt(z) - 10);
  return [x, 0, z];
}

function canyonSegmentEntrancePosition(segment) {
  const z = canyonSegmentStartZ(segment) + 10;
  return [canyonPathOffsetX(z), 0, z];
}

function spawnCanyonEnemy(player, type, position, healthMult = 1, damageMult = 1) {
  const cfg = ENEMY_TYPES[type];
  const id = `canyon-${player.id}-${player.canyon.nextEnemySeq++}`;
  const maxHealth = Math.round(cfg.maxHealth * healthMult);
  player.canyon.enemies.set(id, {
    id,
    type,
    position: [...position],
    spawnPoint: [...position],
    health: maxHealth,
    maxHealth,
    attackDamage: Math.round(cfg.attackDamage * damageMult),
    alive: true,
    targetId: null,
    lastAttackTime: 0,
    patrolTarget: null,
    patrolWaitUntil: 0,
    positionHistory: [],
  });
  return id;
}

function preparePlayerEnemiesForSegment(player, segment) {
  player.canyon.segment = segment;
  player.canyon.enemies.clear();
  clearCanyonLoot(player);

  const { healthMult, damageMult, mobCount } = getSegmentDifficulty(segment);
  const biome = canyonBiomeFor(segment);
  for (let i = 0; i < mobCount; i++) {
    spawnCanyonEnemy(player, biome.mob, randomCanyonCombatPoint(segment), healthMult, damageMult);
  }
  spawnCanyonEnemy(player, biome.boss, randomCanyonBossPoint(segment), healthMult, damageMult);
}

function populateCanyonSegment(player, segment) {
  player.canyon.inHub = false;
  preparePlayerEnemiesForSegment(player, segment);
  player.position = canyonSegmentEntrancePosition(segment);
  player.justTeleported = true;
  grantSpawnProtection(player);

  safeSend(player.ws, {
    type: 'canyonSegment',
    segment,
    maxSegmentReached: player.canyon.maxSegmentReached,
    cleared: player.canyon.clearedSegments.has(segment),
    name: canyonSegmentName(segment),
    biome: canyonBiomeFor(segment).key,
  });
  safeSend(player.ws, { type: 'enemyState', enemies: serializeCanyonEnemies(player) });
}

function enterCanyonHub(player) {
  player.canyon.inHub = true;
  player.canyon.enemies.clear();
  clearCanyonLoot(player);
  player.position = [...CANYON_HUB_POSITION];
  player.justTeleported = true;
  grantSpawnProtection(player);

  safeSend(player.ws, {
    type: 'canyonHub',
    maxSegmentReached: player.canyon.maxSegmentReached,
  });
  safeSend(player.ws, { type: 'enemyState', enemies: [] });
}

function serializeCanyonEnemies(player) {
  if (!player.canyon) return [];
  return Array.from(player.canyon.enemies.values()).map((e) => ({
    id: e.id,
    type: e.type,
    position: e.position,
    health: e.health,
    maxHealth: e.maxHealth,
    alive: e.alive,
    targetId: e.targetId,
  }));
}

function updateCanyonPatrol(enemy, cfg, now) {
  if (!enemy.patrolTarget) {
    if (now < enemy.patrolWaitUntil) return;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * cfg.patrolRadius;
    enemy.patrolTarget = [
      enemy.spawnPoint[0] + Math.cos(angle) * r,
      enemy.spawnPoint[2] + Math.sin(angle) * r,
    ];
  }

  const dx = enemy.patrolTarget[0] - enemy.position[0];
  const dz = enemy.patrolTarget[1] - enemy.position[2];
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist < 0.5) {
    enemy.patrolTarget = null;
    enemy.patrolWaitUntil = now + CANYON_CONFIG.patrolPauseMinMs +
      Math.random() * (CANYON_CONFIG.patrolPauseMaxMs - CANYON_CONFIG.patrolPauseMinMs);
    return;
  }

  const len = dist || 1;
  const step = cfg.patrolSpeed * (CANYON_CONFIG.tickRate / 1000);
  enemy.position[0] += (dx / len) * step;
  enemy.position[2] += (dz / len) * step;
}

function markPlayerDead(target, killerId, position) {
  target.alive = false;
  target.stats.deaths++;

  const deathMessage = {
    type: 'playerDeath',
    playerId: target.id,
    killerId,
    position,
  };

  safeSend(target.ws, deathMessage);
  broadcast(deathMessage, target.id, true, target);
}

function respawnPlayer(target) {
  if (target.alive) return;
  if (target.ws.readyState !== WebSocket.OPEN) return;

  target.health = target.maxHealth;
  target.alive = true;
  if (target.locationId === 'tower-first-floor' && target.canyon) {
    enterCanyonHub(target);
  } else {
    const oldLocation = target.locationId;
    target.locationId = 'tower-main-hall';
    target.weaponEquipped = false;
    spawnInSafeZone(target);
    target.positionHistory = [];
    target.recentShots = [];
    safeSend(target.ws, { type: 'weaponForceUnequip' });
    if (oldLocation !== target.locationId) {
      notifyLocationTransition(target, oldLocation, target.locationId);
    }
  }
  target.justTeleported = true;
  grantSpawnProtection(target);

  safeSend(target.ws, {
    type: 'respawn',
    locationId: target.locationId,
    position: target.position,
    health: target.health,
  });

  broadcast({
    type: 'playerRespawn',
    id: target.id,
    position: target.position,
    health: target.health,
  }, target.id, true, target);
}

function handleRespawnRequest(player) {
  if (!player.alive) {
    respawnPlayer(player);
  }
}

function damagePlayerByCanyonEnemy(player, enemy) {
  if (!player.alive) return;
  if (isSpawnProtected(player)) return;

  const damage = enemy.attackDamage;
  player.health = Math.max(0, player.health - damage);
  player.lastDamageTime = Date.now();

  safeSend(player.ws, {
    type: 'playerDamaged',
    targetId: player.id,
    attackerId: enemy.id,
    damage,
    health: player.health,
    point: player.position,
    historicalPosition: player.position,
  });

  if (player.health <= 0) {
    markPlayerDead(player, enemy.id, player.position);
  }
}

function canyonTick() {
  const now = Date.now();

  for (const player of players.values()) {
    if (!player.authenticated || player.locationId !== 'tower-first-floor') continue;
    if (!player.canyon || player.canyon.enemies.size === 0) continue;

    for (const enemy of player.canyon.enemies.values()) {
      if (!enemy.alive) continue;
      const cfg = ENEMY_TYPES[enemy.type];

      let hasTarget = enemy.targetId === player.id;
      if (player.alive) {
        const dx = player.position[0] - enemy.position[0];
        const dz = player.position[2] - enemy.position[2];
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (!hasTarget) {
          if (dist <= cfg.aggroRadius) {
            enemy.targetId = player.id;
            hasTarget = true;
          }
        } else if (dist > cfg.aggroLeash) {
          enemy.targetId = null;
          hasTarget = false;
        }
      } else {
        enemy.targetId = null;
        hasTarget = false;
      }

      if (hasTarget) {
        enemy.patrolTarget = null;

        const dx = player.position[0] - enemy.position[0];
        const dz = player.position[2] - enemy.position[2];
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > cfg.attackRange) {
          const speed = dist > cfg.chaseNearThreshold ? cfg.chaseSpeedFar : cfg.chaseSpeedNear;
          const len = dist || 1;
          const step = speed * (CANYON_CONFIG.tickRate / 1000);
          enemy.position[0] += (dx / len) * step;
          enemy.position[2] += (dz / len) * step;
        } else if (now - enemy.lastAttackTime >= cfg.attackCooldown) {
          enemy.lastAttackTime = now;
          damagePlayerByCanyonEnemy(player, enemy);
        }
      } else {
        updateCanyonPatrol(enemy, cfg, now);
      }

      enemy.positionHistory.push({ position: [...enemy.position], time: now });
      enemy.positionHistory = enemy.positionHistory.filter((p) => now - p.time < 1000);
    }

    safeSend(player.ws, { type: 'enemyState', enemies: serializeCanyonEnemies(player) });
  }
}

safeInterval(canyonTick, CANYON_CONFIG.tickRate);

const SHOP_ITEMS = {
  'sign-on-a-stick': { id: 'sign-on-a-stick', name: 'Sign on a Stick', price: 100, maxOwned: 10 },
  'sphere': { id: 'sphere', name: 'Sphere', price: 100, maxOwned: 50, tradeable: true },
  'wall-poster': { id: 'wall-poster', name: 'Wall Poster', price: 100, maxOwned: 4 },
};

const FURNITURE_ITEMS = {
  'chair': { id: 'chair', price: 0, maxOwned: 6 },
  'table': { id: 'table', price: 0, maxOwned: 2 },
  'wardrobe': { id: 'wardrobe', price: 0, maxOwned: 1 },
  'wall-poster': { id: 'wall-poster', price: 100, maxOwned: 4 },
};

const shopPriceOverrides = new Map();

async function refreshShopPrices(gameId) {
  if (!gameId || !CONFIG.internalSecret) return;
  const result = await callInternalApi('/api/internal/game/shop-prices', { gameId }).catch((err) => {
    console.error('[Shop] price refresh error:', err.message);
    return null;
  });
  if (!result?.items) return;
  shopPriceOverrides.clear();
  for (const item of result.items) {
    shopPriceOverrides.set(item.itemId, item);
  }
}

function shopPriceFor(itemId, fallbackPrice) {
  const override = shopPriceOverrides.get(itemId);
  if (!override || override.currency !== 'ash') return fallbackPrice;
  return Math.max(0, Math.floor(Number(override.priceAsh) || 0));
}

function shopItemEnabled(itemId) {
  const override = shopPriceOverrides.get(itemId);
  return !override || override.enabled !== false;
}

const SIGN_LIFETIME_MS = 6 * 60 * 60 * 1000;

const LOOT_CONFIG = {
  pollIntervalMs: 10000,
  minDrop: 1,
  maxDrop: 3,
  pickupRadius: 3,
  despawnMs: 5 * 60 * 1000,
  maxInventory: 200,
};

let tokenPool = [];
const lootDrops = new Map();
let nextLootId = 0;

const activeTrades = new Map();

function buildTradeSnapshot(session) {
  return {
    tradeId: session.id,
    phase: session.phase,
    sellerId: session.sellerId,
    itemId: session.itemId,
    itemName: session.itemName,
    priceTnj: session.priceTnj,
    participants: Object.values(session.participants).map((p) => ({
      userId: p.userId, wallet: p.wallet, nickname: p.nickname, ready: p.ready,
    })),
  };
}

function sendToTradeParticipants(session, message) {
  for (const uid of Object.keys(session.participants)) {
    const p = userIdToPlayer.get(uid);
    if (p) safeSend(p.ws, message);
  }
}

function broadcastTradeState(session) {
  sendToTradeParticipants(session, { type: 'tradeSession', ...buildTradeSnapshot(session) });
}

function endTrade(session, phase, extra) {
  session.phase = phase;
  for (const uid of Object.keys(session.participants)) {
    const p = userIdToPlayer.get(uid);
    if (p && p.activeTradeId === session.id) p.activeTradeId = null;
  }
  activeTrades.delete(session.id);
  sendToTradeParticipants(session, { type: 'tradeSession', ...buildTradeSnapshot(session), ...(extra || {}) });
}

safeInterval(() => {
  const now = Date.now();
  for (const session of Array.from(activeTrades.values())) {
    if (session.phase === 'settling') continue;
    const awaitingAge = session.awaitingPaymentSince ? now - session.awaitingPaymentSince : 0;
    if (session.phase === 'awaiting_payment' && awaitingAge > 5 * 60 * 1000) {
      endTrade(session, 'expired');
    } else if (now - session.createdAt > 15 * 60 * 1000) {
      endTrade(session, 'expired');
    }
  }
}, 30000);

let factionGatesList = [];
let displayedFactionGatesList = [];
let accountCount = 0;
let lastBroadcastAccountCount = -1;

async function refreshFactionGates() {
  const result = await callInternalApi('/api/internal/game/faction/gates-list', {}).catch((err) => {
    console.error('[FactionGates] refresh error:', err.message);
    return null;
  });
  if (result?.success && Array.isArray(result.gates)) {
    factionGatesList = result.gates;
  }
  if (typeof result?.accountCount === 'number') {
    accountCount = result.accountCount;
  }

  const prevIds = new Set(displayedFactionGatesList.map((g) => g.factionId));
  const nextIds = new Set(factionGatesList.map((g) => g.factionId));
  const changed =
    prevIds.size !== nextIds.size ||
    Array.from(prevIds).some((id) => !nextIds.has(id)) ||
    accountCount !== lastBroadcastAccountCount;

  displayedFactionGatesList = factionGatesList;

  if (changed) {
    lastBroadcastAccountCount = accountCount;
    broadcastToLocation(GALAXY_LOCATION_ID, {
      type: 'factionGatesState',
      gates: displayedFactionGatesList,
      accountCount,
    });
  }
}

refreshFactionGates();
safeInterval(refreshFactionGates, 15000);

async function refreshTokenPool() {
  try {
    const url = new URL('/api/new-tokens', CONFIG.siteUrl).toString();
    const res = await fetch(url);
    if (!res.ok) return;
    const tokens = await res.json();
    if (Array.isArray(tokens) && tokens.length > 0) {
      tokenPool = tokens;
    }
  } catch (err) {
    console.error('[TokenPool] refresh error:', err.message);
  }
}

refreshTokenPool();
safeInterval(refreshTokenPool, LOOT_CONFIG.pollIntervalMs);

function serializeLoot() {
  return Array.from(lootDrops.values())
    .filter((l) => !l.ownerId)
    .map((l) => ({
      id: l.id,
      position: l.position,
      tokens: l.tokens,
    }));
}

const worldSigns = new Map();
let signsLoadPromise = null;

function serializeSigns() {
  return Array.from(worldSigns.values());
}

async function ensureSignsLoaded(gameId) {
  if (signsLoadPromise) return signsLoadPromise;

  signsLoadPromise = (async () => {
    const result = await callInternalApi('/api/internal/game/signs/list', { gameId }).catch((err) => {
      console.error('[Signs] load error:', err.message);
      return null;
    });
    for (const sign of result?.signs || []) {
      sign.createdAtMs = new Date(sign.createdAt).getTime();
      worldSigns.set(sign.id, sign);
    }
  })();

  return signsLoadPromise;
}

async function deleteSign(sign) {
  const result = await callInternalApi('/api/internal/game/signs/delete', {
    signId: sign.id, userId: sign.ownerId,
  }).catch((err) => {
    console.error('[Signs] delete error:', err.message);
    return null;
  });
  if (!result || !result.success) return false;
  worldSigns.delete(sign.id);
  broadcastToLocation('main-world', { type: 'signDespawn', id: sign.id });
  return true;
}

safeInterval(() => {
  const now = Date.now();
  for (const sign of Array.from(worldSigns.values())) {
    if (now - sign.createdAtMs > SIGN_LIFETIME_MS) {
      deleteSign(sign);
    }
  }
}, 60000);

const FACTION_ROOM_PREFIX = 'faction-gate-';

function roomFactionIdFor(player) {
  return typeof player.locationId === 'string' && player.locationId.startsWith(FACTION_ROOM_PREFIX)
    ? player.locationId.slice(FACTION_ROOM_PREFIX.length)
    : null;
}

const worldFurniture = new Map();
const furnitureLoadPromises = new Map();

function serializeFurnitureForRoom(factionId) {
  const room = worldFurniture.get(factionId);
  return room ? Array.from(room.values()) : [];
}

async function ensureFurnitureLoaded(factionId) {
  if (worldFurniture.has(factionId)) return;
  if (furnitureLoadPromises.has(factionId)) return furnitureLoadPromises.get(factionId);

  const promise = (async () => {
    const result = await callInternalApi('/api/internal/game/furniture/list', { factionId }).catch((err) => {
      console.error('[Furniture] load error:', err.message);
      return null;
    });
    const room = new Map();
    for (const item of result?.items || []) {
      room.set(item.id, item);
    }
    worldFurniture.set(factionId, room);
  })();
  furnitureLoadPromises.set(factionId, promise);
  return promise;
}

function addTokensToInventory(player, tokens) {
  for (const t of tokens) {
    const existing = player.inventory.find((e) => e.address === t.address);
    if (existing) {
      existing.quantity++;
    } else if (player.inventory.length < LOOT_CONFIG.maxInventory) {
      player.inventory.push({
        address: t.address,
        name: t.name,
        symbol: t.symbol,
        image: t.image,
        quantity: 1,
      });
    }
  }
}

function ashForMarketCap(mc) {
  if (mc < 10000) return 1;
  if (mc < 50000) return 2;
  if (mc < 100000) return 4;
  if (mc < 500000) return 10;
  return 20;
}

function rollLootTokens(minCount, maxCount) {
  if (tokenPool.length === 0) return [];
  const count = minCount + Math.floor(Math.random() * (maxCount - minCount + 1));
  const tokens = [];
  for (let i = 0; i < count; i++) {
    const t = tokenPool[Math.floor(Math.random() * tokenPool.length)];
    tokens.push({
      address: t.address,
      name: t.name,
      symbol: t.symbol,
      image: t.image,
    });
  }
  return tokens;
}

function dropLoot(position) {
  const tokens = rollLootTokens(LOOT_CONFIG.minDrop, LOOT_CONFIG.maxDrop);
  if (tokens.length === 0) return;

  const id = `loot-${nextLootId++}`;
  const loot = { id, ownerId: null, position: [...position], tokens, createdAt: Date.now() };
  lootDrops.set(id, loot);

  broadcastToLocation('main-world', {
    type: 'lootSpawn',
    id: loot.id,
    position: loot.position,
    tokens: loot.tokens,
  });
}

function clearCanyonLoot(player) {
  for (const [id, loot] of lootDrops) {
    if (loot.ownerId === player.id) {
      lootDrops.delete(id);
      safeSend(player.ws, { type: 'lootDespawn', id });
    }
  }
}

function dropCanyonLoot(player, position, minCount, maxCount) {
  const tokens = rollLootTokens(minCount, maxCount);
  if (tokens.length === 0) return;

  const id = `loot-${nextLootId++}`;
  const loot = { id, ownerId: player.id, position: [...position], tokens, createdAt: Date.now() };
  lootDrops.set(id, loot);

  safeSend(player.ws, {
    type: 'lootSpawn',
    id: loot.id,
    position: loot.position,
    tokens: loot.tokens,
  });
}

safeInterval(() => {
  const now = Date.now();
  for (const [id, loot] of lootDrops) {
    if (now - loot.createdAt > LOOT_CONFIG.despawnMs) {
      lootDrops.delete(id);
      if (loot.ownerId) {
        const owner = players.get(loot.ownerId);
        if (owner) safeSend(owner.ws, { type: 'lootDespawn', id });
      } else {
        broadcastToLocation('main-world', { type: 'lootDespawn', id });
      }
    }
  }
}, 30000);

function cachedInternalCall(key, ttlMs, factory) {
  const now = Date.now();
  const entry = internalCache.get(key);

  if (entry) {
    if (entry.pending) return entry.pending;
    if (now - entry.at < ttlMs) return Promise.resolve(entry.value);
  }

  const pending = factory()
    .then((value) => {
      internalCache.set(key, { value, at: Date.now(), pending: null });
      return value;
    })
    .catch((err) => {
      internalCache.delete(key);
      throw err;
    });

  internalCache.set(key, { value: entry?.value ?? null, at: entry?.at ?? 0, pending });
  return pending;
}

safeInterval(() => {
  const now = Date.now();
  internalCache.forEach((entry, key) => {
    if (!entry.pending && now - entry.at > 60000) internalCache.delete(key);
  });
}, 60000);

async function callInternalApi(endpoint, data) {
  if (!CONFIG.internalSecret) {
    console.warn('[Internal] INTERNAL_API_SECRET not set, skipping:', endpoint);
    return null;
  }

  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, CONFIG.siteUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const postData = JSON.stringify(data);

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'X-Internal-Secret': CONFIG.internalSecret,
      },
      agent: isHttps ? INTERNAL_HTTPS_AGENT : INTERNAL_HTTP_AGENT,
    };

    const req = lib.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Invalid JSON from ${endpoint}: ${body}`));
        }
      });
    });

    req.on('error', (err) => {
      console.error(`[Internal] ${endpoint} error:`, err.message);
      reject(err);
    });

    req.setTimeout(10000, () => {
      req.destroy(new Error(`Timeout calling ${endpoint}`));
    });

    req.write(postData);
    req.end();
  });
}

async function verifyGameToken(token) {
  try {
    const result = await callInternalApi('/api/internal/game/verify-token', { token });
    return result;
  } catch (err) {
    console.error('[Auth] Verify token error:', err.message);
    return { valid: false, error: 'verification_failed' };
  }
}

async function loadPlayerProgress(userId, gameId) {
  try {
    return await callInternalApi('/api/internal/game/load-progress', { userId, gameId });
  } catch (err) {
    console.error('[Progress] Load error:', err.message);
    return null;
  }
}

async function savePlayerProgress(userId, gameId, data) {
  try {
    return await callInternalApi('/api/internal/game/save-progress', {
      userId,
      gameId,
      ...data,
    });
  } catch (err) {
    console.error('[Progress] Save error:', err.message);
    return null;
  }
}

function buildSavePayload(player) {
  return {
    progress: {
      locationId: player.locationId,
      position: player.position,
      rotation: player.rotation,
      health: player.health,
      data: {
        ash: player.ash,
        placeables: player.placeables,
        quests: player.quests,
        canyonProgress: {
          maxSegmentReached: player.canyon.maxSegmentReached,
          clearedSegments: Array.from(player.canyon.clearedSegments),
        },
        skinTextureUrl: player.skinTextureUrl || null,
      },
    },
    nickname: player.nickname,
    inventory: player.inventory.map((entry, index) => ({
      slot: index,
      itemId: entry.address,
      quantity: entry.quantity,
      data: { name: entry.name, symbol: entry.symbol, image: entry.image },
    })),
    statistics: {
      playtimeSeconds: player.stats.playtimeSeconds + Math.floor((Date.now() - player.sessionStart) / 1000),
      kills: player.stats.kills,
      deaths: player.stats.deaths,
      shotsFired: player.stats.shotsFired,
      buildingsPlaced: player.stats.buildingsPlaced,
    },
  };
}

function queuePlayerSave(player, payload) {
  player.saveQueue = player.saveQueue.then(() =>
    savePlayerProgress(player.userId, player.gameId, payload)
      .then((result) => {
        if (result?.unlockedAchievements?.length && player.ws.readyState === WebSocket.OPEN) {
          safeSend(player.ws, { type: 'achievementsUnlocked', achievements: result.unlockedAchievements });
        }
      })
      .catch((err) => console.error(`[Save] Error for ${player.id}:`, err.message))
  );
  return player.saveQueue;
}

function persistPlayer(player) {
  if (!CONFIG.internalSecret) return;
  queuePlayerSave(player, buildSavePayload(player));
}

safeInterval(() => {
  const now = Date.now();
  players.forEach((player) => {
    if (!player.authenticated) return;
    player.lastPingSentAt = now;
    safeSend(player.ws, { type: 'ping', t: now });
    if (now - player.lastPong > CONFIG.network.heartbeatTimeout) {
      console.log(`[!] Heartbeat timeout: ${player.id}`);
      player.ws.terminate();
    }
  });
}, CONFIG.network.heartbeatInterval);

safeInterval(() => {
  const now = Date.now();
  players.forEach((p) => {
    if (now - p.lastSeen > CONFIG.network.staleTimeout) {
      console.log(`[!] Stale player: ${p.id}`);
      p.ws.terminate();
    }
  });
  rateLimits.forEach((data, key) => {
    if (now > data.resetTime + 5000) rateLimits.delete(key);
  });
}, 10000);

safeInterval(() => {
  if (!CONFIG.internalSecret) return;

  players.forEach((player) => {
    if (!player.authenticated) return;
    persistPlayer(player);
  });
}, CONFIG.autoSaveInterval);

safeInterval(() => {
  factionTaskState.forEach((state, factionId) => {
    if (!state.dirty || !state.taskKey) return;
    state.dirty = false;
    callInternalApi('/api/internal/game/faction/task-progress', {
      factionId, taskKey: state.taskKey, progress: state.progress,
    }).catch((err) => console.error('[FactionTask] progress flush error:', err.message));
  });
}, 20000);

safeInterval(async () => {
  if (!CONFIG.internalSecret) return;

  const authedPlayers = Array.from(players.values()).filter((p) => p.authenticated && p.userId);
  if (authedPlayers.length === 0) return;

  const result = await callInternalApi('/api/internal/game/mute-status', {
    userIds: authedPlayers.map((p) => p.userId),
  }).catch((err) => {
    console.error('[Moderation] status refresh error:', err.message);
    return null;
  });

  if (!result?.statuses) return;

  const statusByUserId = new Map(result.statuses.map((s) => [s.id, s]));
  authedPlayers.forEach((p) => {
    const status = statusByUserId.get(p.userId);
    if (!status) return;

    p.mutedUntil = status.mutedUntil || null;

    if (status.isBanned) {
      safeSend(p.ws, { type: 'auth_error', error: 'banned' });
      try { p.ws.close(4008, 'banned'); } catch (e) { }
    }
  });
}, 8000);

safeInterval(async () => {
  if (!CONFIG.internalSecret) return;

  const authedPlayers = Array.from(players.values()).filter((p) => p.authenticated && p.userId);
  if (authedPlayers.length === 0) return;

  const result = await callInternalApi('/api/internal/game/skin-status', {
    userIds: authedPlayers.map((p) => p.userId),
  }).catch((err) => {
    console.error('[Moderation] skin status refresh error:', err.message);
    return null;
  });

  if (!result?.statuses) return;

  const statusByUserId = new Map(result.statuses.map((s) => [s.id, s]));
  authedPlayers.forEach((p) => {
    if (Date.now() - (p.skinTextureUrlChangedAt || 0) < 5000) return;

    const status = statusByUserId.get(p.userId);
    if (!status) return;

    const nextUrl = status.skinTextureUrl || null;
    if (nextUrl === p.skinTextureUrl) return;

    p.skinTextureUrl = nextUrl;
    broadcast({ type: 'skinUpdate', playerId: p.id, url: p.skinTextureUrl }, null, true, p);
    safeSend(p.ws, { type: 'skinUpdate', playerId: p.id, url: p.skinTextureUrl });
  });
}, 8000);

safeInterval(async () => {
  const anyPlayer = Array.from(players.values()).find((p) => p.authenticated && p.gameId);
  if (anyPlayer) await refreshShopPrices(anyPlayer.gameId);
}, 60000);

safeInterval(async () => {
  if (!CONFIG.internalSecret) return;

  const authedPlayers = Array.from(players.values()).filter((p) => p.authenticated && p.userId);
  if (authedPlayers.length === 0) return;

  const result = await callInternalApi('/api/internal/game/economy-status', {
    userIds: authedPlayers.map((p) => p.userId),
  }).catch((err) => {
    console.error('[Moderation] economy status refresh error:', err.message);
    return null;
  });

  if (!result?.statuses) return;

  const statusByUserId = new Map(result.statuses.map((s) => [s.id, s]));
  authedPlayers.forEach((p) => {
    if (Date.now() - (p.economyChangedAt || 0) < 5000) return;

    const status = statusByUserId.get(p.userId);
    if (!status) return;

    if (status.ash === p.ash && JSON.stringify(status.placeables) === JSON.stringify(p.placeables)) return;

    p.ash = status.ash;
    p.placeables = status.placeables;
    safeSend(p.ws, { type: 'inventoryUpdate', inventory: p.inventory, ash: p.ash, placeables: p.placeables });
  });
}, 8000);

safeInterval(async () => {
  if (!CONFIG.internalSecret) return;

  const authedPlayers = Array.from(players.values()).filter((p) => p.authenticated && p.userId && p.gameId);
  if (authedPlayers.length === 0) return;

  const byGameId = new Map();
  authedPlayers.forEach((p) => {
    if (!byGameId.has(p.gameId)) byGameId.set(p.gameId, []);
    byGameId.get(p.gameId).push(p);
  });

  for (const [gameId, playersForGame] of byGameId) {
    const result = await callInternalApi('/api/internal/game/license-status', {
      gameId, userIds: playersForGame.map((p) => p.userId),
    }).catch((err) => {
      console.error('[License] status refresh error:', err.message);
      return null;
    });

    if (!result?.revoked?.length) continue;

    const revokedSet = new Set(result.revoked);
    playersForGame.forEach((p) => {
      if (!revokedSet.has(p.userId)) return;
      safeSend(p.ws, { type: 'auth_error', error: 'license_revoked' });
      try { p.ws.close(4010, 'license_revoked'); } catch (e) { }
    });
  }
}, 8000);

wss.on('connection', (ws) => {
  if (players.size >= MAX_PLAYERS) {
    ws.close(1013, 'Server full');
    return;
  }

  const playerId = generateId();

  const player = {
    id: playerId,
    userId: null,
    wallet: null,
    gameId: null,
    gameSlug: null,
    nickname: null,
    position: [0, 0, 0],
    rotation: 0,
    pitch: 0,
    animation: 'idle',
    state: 'idle',
    jumping: false,
    velocityY: 0,
    lastJump: 0,
    locationId: 'tower-main-hall',
    instance: 1,
    ws,
    authenticated: false,
    lastSeen: Date.now(),
    lastPong: Date.now(),
    lastPingSentAt: 0,
    rtt: 50,
    lastUpdate: 0,
    justSpawned: false,
    justTeleported: false,
    lastLocationChangeAt: 0,
    pendingLocationChange: null,
    invulnerableUntil: 0,
    ready: false,
    readyTimer: null,
    aoiNeighbors: new Set(),
    weaponAmmo: WEAPON_CONFIG.maxAmmo,
    lastShotAt: 0,
    ammoEmptyAt: 0,
    sessionStart: Date.now(),
    health: 100,
    maxHealth: 100,
    alive: true,
    lastDamageTime: 0,
    positionHistory: [],
    recentShots: [],
    weaponEquipped: true,
    isShooting: false,
    mutedUntil: null,
    isAdmin: false,
    isFactionCreator: false,
    skinTextureUrl: null,
    skinTextureUrlChangedAt: 0,
    blockedUserIds: new Set(),
    inventory: [],
    ash: 0,
    economyChangedAt: 0,
    placeables: {},
    activeTradeId: null,
    quests: {},
    factions: [],
    cosmeticsOwned: new Set(),
    cosmeticSkinId: null,
    cosmeticAccessoryId: null,
    displayedFactionId: null,
    displayedFactionName: null,
    displayedFactionSymbol: null,
    displayedFactionImage: null,
    canyon: {
      inHub: true,
      segment: 1,
      maxSegmentReached: 1,
      clearedSegments: new Set(),
      enemies: new Map(),
      nextEnemySeq: 0,
      pendingSegment: null,
    },
    stats: {
      kills: 0,
      deaths: 0,
      shotsFired: 0,
      buildingsPlaced: 0,
      playtimeSeconds: 0,
    },
    saveQueue: Promise.resolve(),
    authTimeout: setTimeout(() => {
      if (!player.authenticated) {
        console.log(`[!] Auth timeout: ${playerId}`);
        safeSend(ws, { type: 'auth_error', error: 'auth_timeout' });
        ws.close(4001, 'Authentication timeout');
      }
    }, 10000),
    authAttempts: 0,
  };

  players.set(playerId, player);

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      player.lastSeen = Date.now();

      if (!player.authenticated) {
        if (data.type === 'auth') {
          player.authAttempts++;
          if (player.authAttempts > 5) {
            safeSend(ws, { type: 'auth_error', error: 'too_many_attempts' });
            ws.close(4008, 'too_many_auth_attempts');
            return;
          }
          handleAuth(player, data).catch((err) => {
            console.error(`[!] handleAuth error for ${playerId}:`, err.message);
            if (player.userId && userIdToPlayer.get(player.userId) === player) {
              userIdToPlayer.delete(player.userId);
            }
            try { ws.close(4000, 'auth_error'); } catch (e) { }
          });
          return;
        } else {
          safeSend(ws, { type: 'auth_error', error: 'auth_required' });
          ws.close(4001, 'Authentication required');
          return;
        }
      }

      if (data.type === 'pong') {
        const now = Date.now();
        player.lastPong = now;
        if (typeof data.t === 'number' && data.t === player.lastPingSentAt) {
          player.rtt = Math.max(0, Math.min(1000, now - data.t));
        }
        return;
      }

      if (data.type === 'playerUpdate') {
        if (!checkRateLimit(playerId, 'update', CONFIG.network.updateRateLimit)) return;
      } else if (data.type === 'chat') {
        if (!checkRateLimit(playerId, 'chat', CONFIG.network.chatRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Chat rate limit exceeded' });
          return;
        }
      } else if (data.type === 'shoot') {
        if (!checkRateLimit(playerId, 'shoot', CONFIG.network.shootRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Shoot rate limit exceeded' });
          return;
        }
      } else if (data.type === 'hit' || data.type === 'enemyHit' || data.type === 'lootPickup') {
        if (!checkRateLimit(playerId, 'hit', CONFIG.network.hitRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Hit rate limit exceeded' });
          return;
        }
      } else if (data.type === 'sellToken') {
        if (!checkRateLimit(playerId, 'sell', CONFIG.network.sellRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Sell rate limit exceeded' });
          return;
        }
      } else if (data.type === 'shopBuyItem' || data.type === 'signPlace' || data.type === 'signRemove' || data.type === 'signSetText' || data.type === 'signSetDrawingUrl' || data.type === 'itemPlace' || data.type === 'itemRemove' || data.type === 'itemSetText' || data.type === 'itemSetDrawingUrl') {
        if (!checkRateLimit(playerId, 'build', CONFIG.network.buildRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Build rate limit exceeded' });
          return;
        }
      } else if (data.type === 'voiceOffer' || data.type === 'voiceAnswer' || data.type === 'voiceIceCandidate') {
        if (!checkRateLimit(playerId, 'voice', CONFIG.network.voiceRateLimit)) return;
      } else if (data.type === 'locationChange') {
        if (!checkRateLimit(playerId, 'locationChange', CONFIG.network.locationChangeRateLimit)) return;
      } else if (data.type === 'nicknameChange') {
        if (!checkRateLimit(playerId, 'nicknameChange', CONFIG.network.nicknameChangeRateLimit)) return;
      } else if (data.type === 'skinUpdate') {
        if (!checkRateLimit(playerId, 'skinUpdate', CONFIG.network.skinUpdateRateLimit)) return;
      } else if (data.type === 'saveProgress') {
        if (!checkRateLimit(playerId, 'saveProgress', CONFIG.network.saveProgressRateLimit)) return;
      } else if (data.type === 'cosmeticListRequest' || data.type === 'cosmeticBuy' || data.type === 'cosmeticEquip') {
        if (!checkRateLimit(playerId, 'cosmetic', CONFIG.network.cosmeticRateLimit)) return;
      } else if (data.type === 'emote') {
        if (!checkRateLimit(playerId, 'emote', CONFIG.network.emoteRateLimit)) return;
      } else if (data.type === 'questInteract' || data.type === 'questAccept' || data.type === 'questTurnIn') {
        if (!checkRateLimit(playerId, 'quest', CONFIG.network.questRateLimit)) return;
      } else if (data.type === 'canyonWarp' || data.type === 'canyonMapRequest' || data.type === 'canyonEnterDungeon' || data.type === 'canyonReturnToHub' || data.type === 'canyonCrossThreshold') {
        if (!checkRateLimit(playerId, 'canyon', CONFIG.network.canyonRateLimit)) return;
      } else if (data.type === 'factionCreate' || data.type === 'factionJoin' || data.type === 'factionLeave' || data.type === 'factionList' || data.type === 'factionInfo' || data.type === 'factionTaskListRequest' || data.type === 'factionAcceptTask' || data.type === 'factionClaimCreator' || data.type === 'factionSetDisplayed' || data.type === 'factionMyListRequest') {
        if (!checkRateLimit(playerId, 'faction', CONFIG.network.factionRateLimit)) return;
      } else if (data.type === 'factionQuestCreate') {
        if (!checkRateLimit(playerId, 'factionQuestCreate', CONFIG.network.factionQuestCreateRateLimit)) return;
      } else if (data.type === 'factionQuestListRequest' || data.type === 'factionQuestManageListRequest' || data.type === 'factionQuestClaim') {
        if (!checkRateLimit(playerId, 'factionQuest', CONFIG.network.factionQuestRateLimit)) return;
      } else if (data.type === 'factionSearch') {
        if (!checkRateLimit(playerId, 'factionSearch', CONFIG.network.factionSearchRateLimit)) return;
      } else if (data.type === 'playerProfileRequest' || data.type === 'leaderboardRequest' || data.type === 'factionLeaderboardRequest') {
        if (!checkRateLimit(playerId, 'profile', CONFIG.network.profileRateLimit)) return;
      } else if (data.type === 'friendRequestSend' || data.type === 'friendRequestAccept' || data.type === 'friendRequestDecline' || data.type === 'friendRemove' || data.type === 'friendsListRequest') {
        if (!checkRateLimit(playerId, 'friend', CONFIG.network.friendRateLimit)) return;
      } else if (data.type === 'friendSearch') {
        if (!checkRateLimit(playerId, 'friendSearch', CONFIG.network.friendSearchRateLimit)) return;
      } else if (data.type === 'mailSend') {
        if (!checkRateLimit(playerId, 'mailSend', CONFIG.network.mailSendRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Mail rate limit exceeded' });
          return;
        }
      } else if (data.type === 'mailInboxRequest' || data.type === 'mailMarkRead') {
        if (!checkRateLimit(playerId, 'mailRead', CONFIG.network.mailReadRateLimit)) return;
      } else if (data.type === 'respawnRequest') {
        if (!checkRateLimit(playerId, 'respawn', CONFIG.network.respawnRateLimit)) return;
      } else if (data.type === 'tokenInfoRequest') {
        if (!checkRateLimit(playerId, 'tokenLookup', CONFIG.network.tokenLookupRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Token lookup rate limit exceeded' });
          return;
        }
      } else if (data.type === 'supportTicketSend') {
        if (!checkRateLimit(playerId, 'support', CONFIG.network.supportRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Please wait before sending another support message' });
          return;
        }
      } else if (data.type === 'blockUser' || data.type === 'unblockUser' || data.type === 'blockedListRequest') {
        if (!checkRateLimit(playerId, 'block', CONFIG.network.blockRateLimit)) return;
      } else if (data.type === 'privateMessage') {
        if (!checkRateLimit(playerId, 'privateMessage', CONFIG.network.privateMessageRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Private message rate limit exceeded' });
          return;
        }
      } else if (data.type === 'factionChat') {
        if (!checkRateLimit(playerId, 'factionChat', CONFIG.network.factionChatRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Chat rate limit exceeded' });
          return;
        }
      } else if (data.type === 'factionInvite') {
        if (!checkRateLimit(playerId, 'factionInvite', CONFIG.network.factionInviteRateLimit)) return;
      } else if (data.type === 'tradeInvite' || data.type === 'tradeInviteRespond' || data.type === 'tradeSetOffer' || data.type === 'tradeSetReady' || data.type === 'tradeSubmitPayment' || data.type === 'tradeCancel') {
        if (!checkRateLimit(playerId, 'trade', CONFIG.network.tradeRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Trade action rate limit exceeded' });
          return;
        }
      }

      switch (data.type) {
        case 'playerUpdate': handlePlayerUpdate(player, data); break;
        case 'shoot': handleShoot(player, data); break;
        case 'nicknameChange': handleNicknameChange(player, data); break;
        case 'skinUpdate': handleSkinUpdate(player, data); break;
        case 'chat': handleChat(player, data); break;
        case 'hit': handleHit(player, data); break;
        case 'enemyHit': handleEnemyHit(player, data); break;
        case 'lootPickup': handleLootPickup(player, data); break;
        case 'sellToken': handleSellToken(player, data); break;
        case 'shopBuyItem': handleShopBuyItem(player, data); break;
        case 'signPlace': handleSignPlace(player, data); break;
        case 'signRemove': handleSignRemove(player, data); break;
        case 'signSetText': handleSignSetText(player, data); break;
        case 'signSetDrawingUrl': handleSignSetDrawingUrl(player, data); break;
        case 'itemPlace': handlePlaceItem(player, data); break;
        case 'itemRemove': handleItemRemove(player, data); break;
        case 'itemSetText': handleItemSetText(player, data); break;
        case 'itemSetDrawingUrl': handleItemSetDrawingUrl(player, data); break;
        case 'voiceOffer': handleVoiceOffer(player, data); break;
        case 'voiceAnswer': handleVoiceAnswer(player, data); break;
        case 'voiceIceCandidate': handleVoiceIceCandidate(player, data); break;
        case 'saveProgress': handleSaveProgress(player); break;
        case 'locationChange': handleLocationChange(player, data); break;
        case 'clientReady': markPlayerReady(player); break;
        case 'emote': handleEmote(player, data); break;
        case 'cosmeticListRequest': handleCosmeticListRequest(player); break;
        case 'cosmeticBuy': handleCosmeticBuy(player, data); break;
        case 'cosmeticEquip': handleCosmeticEquip(player, data); break;
        case 'questInteract': handleQuestInteract(player, data); break;
        case 'questAccept': handleQuestAccept(player, data); break;
        case 'questTurnIn': handleQuestTurnIn(player, data); break;
        case 'canyonWarp': handleCanyonWarp(player, data); break;
        case 'canyonMapRequest': handleCanyonMapRequest(player); break;
        case 'canyonEnterDungeon': handleCanyonEnterDungeon(player); break;
        case 'canyonReturnToHub': handleCanyonReturnToHub(player); break;
        case 'canyonCrossThreshold': handleCanyonCrossThreshold(player); break;
        case 'factionCreate': handleFactionCreate(player, data); break;
        case 'factionJoin': handleFactionJoin(player, data); break;
        case 'factionLeave': handleFactionLeave(player, data); break;
        case 'factionSetDisplayed': handleFactionSetDisplayed(player, data); break;
        case 'factionMyListRequest': handleFactionMyListRequest(player); break;
        case 'factionSearch': handleFactionSearch(player, data); break;
        case 'factionList': handleFactionList(player, data); break;
        case 'factionInfo': handleFactionInfo(player, data); break;
        case 'factionTaskListRequest': handleFactionTaskListRequest(player); break;
        case 'factionAcceptTask': handleFactionAcceptTask(player, data); break;
        case 'factionClaimCreator': handleFactionClaimCreator(player, data); break;
        case 'factionQuestCreate': handleFactionQuestCreate(player, data); break;
        case 'factionQuestListRequest': handleFactionQuestListRequest(player); break;
        case 'factionQuestManageListRequest': handleFactionQuestManageListRequest(player, data); break;
        case 'factionQuestClaim': handleFactionQuestClaim(player, data); break;
        case 'playerProfileRequest': handlePlayerProfileRequest(player, data); break;
        case 'leaderboardRequest': handleLeaderboardRequest(player, data); break;
        case 'factionLeaderboardRequest': handleFactionLeaderboardRequest(player, data); break;
        case 'friendRequestSend': handleFriendRequestSend(player, data); break;
        case 'friendRequestAccept': handleFriendRequestAccept(player, data); break;
        case 'friendRequestDecline': handleFriendRequestDecline(player, data); break;
        case 'friendRemove': handleFriendRemove(player, data); break;
        case 'friendsListRequest': handleFriendsListRequest(player); break;
        case 'friendSearch': handleFriendSearch(player, data); break;
        case 'mailSend': handleMailSend(player, data); break;
        case 'mailInboxRequest': handleMailInboxRequest(player); break;
        case 'mailMarkRead': handleMailMarkRead(player, data); break;
        case 'respawnRequest': handleRespawnRequest(player); break;
        case 'tokenInfoRequest': handleTokenInfoRequest(player, data); break;
        case 'supportTicketSend': handleSupportTicketSend(player, data); break;
        case 'blockUser': handleBlockUser(player, data); break;
        case 'unblockUser': handleUnblockUser(player, data); break;
        case 'blockedListRequest': handleBlockedListRequest(player); break;
        case 'privateMessage': handlePrivateMessage(player, data); break;
        case 'factionChat': handleFactionChat(player, data); break;
        case 'factionInvite': handleFactionInvite(player, data); break;
        case 'tradeInvite': handleTradeInvite(player, data); break;
        case 'tradeInviteRespond': handleTradeInviteRespond(player, data); break;
        case 'tradeSetOffer': handleTradeSetOffer(player, data); break;
        case 'tradeSetReady': handleTradeSetReady(player, data); break;
        case 'tradeSubmitPayment': handleTradeSubmitPayment(player, data); break;
        case 'tradeCancel': handleTradeCancel(player, data); break;
      }
    } catch (error) {
      console.error('[!] Message parse error:', error.message);
    }
  });

  ws.on('close', () => {
    clearTimeout(player.authTimeout);
    if (player.pendingLocationChange) {
      clearTimeout(player.pendingLocationChange);
      player.pendingLocationChange = null;
    }

    if (player.readyTimer) {
      clearTimeout(player.readyTimer);
      player.readyTimer = null;
    }

    if (player.authenticated) {
      persistPlayer(player);
      callInternalApi('/api/internal/game/presence', { userId: player.userId, online: false }).catch((err) => {
        console.error('[Presence] offline update error:', err.message);
      });
    }

    if (player.userId && userIdToPlayer.get(player.userId) === player) {
      userIdToPlayer.delete(player.userId);
    }
    if (player.wallet && walletToPlayer.get(player.wallet) === player) {
      walletToPlayer.delete(player.wallet);
    }

    if (player.activeTradeId) {
      const tradeSession = activeTrades.get(player.activeTradeId);
     if (tradeSession && tradeSession.phase !== 'settling') {
        endTrade(tradeSession, 'cancelled');
      }
    }

    players.delete(playerId);
    console.log(`[-] Player left: ${playerId} (${player.userId || 'unauth'}). Total: ${players.size}`);

    if (player.authenticated) {
      notifyAOILeave(player);
      broadcastCount();
      if (isShardedLocation(player.locationId)) {
        broadcastShardState(player.locationId);
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`[!] WS error for ${playerId}:`, err.message);
  });

  async function handleAuth(player, data) {
    const token = data.token;
    if (!token || typeof token !== 'string') {
      safeSend(ws, { type: 'auth_error', error: 'invalid_token' });
      ws.close(4001, 'Invalid token');
      return;
    }

    const verifyResult = await verifyGameToken(token);

    if (!verifyResult || !verifyResult.valid) {
      const error = verifyResult?.error || 'invalid_token';
      console.log(`[!] Auth failed for ${playerId}: ${error}`);
      safeSend(ws, { type: 'auth_error', error });
      ws.close(4003, error);
      return;
    }

    const existingOwner = userIdToPlayer.get(verifyResult.userId);
    if (existingOwner && existingOwner !== player) {
      console.log(`[~] Duplicate session for user ${verifyResult.userId}, closing old connection ${existingOwner.id}`);
      if (existingOwner.authenticated) {
        persistPlayer(existingOwner);
        callInternalApi('/api/internal/game/presence', { userId: existingOwner.userId, online: false }).catch((err) => {
          console.error('[Presence] offline update error:', err.message);
        });
      }
      existingOwner.authenticated = false;
      safeSend(existingOwner.ws, { type: 'auth_error', error: 'duplicate_session' });
      try { existingOwner.ws.close(4009, 'duplicate_session'); } catch (e) { }
      if (players.get(existingOwner.id) === existingOwner) {
        players.delete(existingOwner.id);
        notifyAOILeave(existingOwner);
      }
      if (existingOwner.wallet && walletToPlayer.get(existingOwner.wallet) === existingOwner) {
        walletToPlayer.delete(existingOwner.wallet);
      }
    }
    userIdToPlayer.set(verifyResult.userId, player);
    walletToPlayer.set(verifyResult.wallet, player);

    player.userId = verifyResult.userId;
    player.wallet = verifyResult.wallet;
    player.gameId = verifyResult.gameId;
    player.gameSlug = verifyResult.gameSlug;
    player.mutedUntil = verifyResult.mutedUntil || null;
    player.isAdmin = !!verifyResult.isAdmin;

    callInternalApi('/api/internal/game/presence', { userId: player.userId, online: true }).catch((err) => {
      console.error('[Presence] online update error:', err.message);
    });

    clearTimeout(player.authTimeout);

    const savedProgress = await loadPlayerProgress(player.userId, player.gameId);

    if (savedProgress) {
      if (savedProgress.nickname) {
        player.nickname = savedProgress.nickname;
      } else {
        player.nickname = await assignUniqueNickname(player, `Player_${player.wallet.slice(0, 4)}`);
      }

      if (savedProgress.progress) {
        player.position = savedProgress.progress.position || [0, 0, 0];
        player.rotation = savedProgress.progress.rotation || 0;
        player.health = savedProgress.progress.health || 100;
        const savedLocation = savedProgress.progress.locationId;
        if (isKnownLocationId(savedLocation) && !SEALED_LOCATIONS.has(savedLocation)) {
          player.locationId = savedLocation;
        } else {
          player.locationId = 'tower-main-hall';
          spawnInSafeZone(player, player.locationId);
        }
        if (isShardedLocation(player.locationId)) {
          player.instance = pickShard(player.locationId, null);
        }
      } else {
        spawnInSafeZone(player);
      }

      if (savedProgress.statistics) {
        player.stats.kills = savedProgress.statistics.kills || 0;
        player.stats.deaths = savedProgress.statistics.deaths || 0;
        player.stats.shotsFired = savedProgress.statistics.shotsFired || 0;
        player.stats.buildingsPlaced = savedProgress.statistics.buildingsPlaced || 0;
        player.stats.playtimeSeconds = savedProgress.statistics.playtimeSeconds || 0;
      }

      player.ash = Math.max(0, Math.floor(Number(savedProgress.progress?.data?.ash) || 0));

      const savedPlaceables = savedProgress.progress?.data?.placeables;
      if (savedPlaceables && typeof savedPlaceables === 'object') {
        for (const itemId of Object.keys(SHOP_ITEMS)) {
          const qty = Math.max(0, Math.floor(Number(savedPlaceables[itemId]) || 0));
          if (qty > 0) player.placeables[itemId] = qty;
        }
      }

      player.skinTextureUrl = typeof savedProgress.progress?.data?.skinTextureUrl === 'string'
        ? savedProgress.progress.data.skinTextureUrl.slice(0, 500)
        : null;

      const savedQuests = savedProgress.progress?.data?.quests;
      if (savedQuests && typeof savedQuests === 'object') {
        for (const questId of Object.keys(QUESTS)) {
          const state = savedQuests[questId];
          if (!state || typeof state !== 'object') continue;
          const validStatuses = new Set(['active', 'ready_to_turn_in', 'completed']);
          if (!validStatuses.has(state.status)) continue;
          player.quests[questId] = {
            status: state.status,
            progress: Math.max(0, Math.min(QUESTS[questId].targetCount, Math.floor(Number(state.progress) || 0))),
          };
        }
      }

      const savedCanyon = savedProgress.progress?.data?.canyonProgress;
      if (savedCanyon && typeof savedCanyon === 'object') {
        const maxReached = Math.floor(Number(savedCanyon.maxSegmentReached));
        if (Number.isInteger(maxReached) && maxReached >= 1) {
          player.canyon.maxSegmentReached = maxReached;
        }
        if (Array.isArray(savedCanyon.clearedSegments)) {
          for (const s of savedCanyon.clearedSegments) {
            const seg = Math.floor(Number(s));
            if (Number.isInteger(seg) && seg >= 1) player.canyon.clearedSegments.add(seg);
          }
        }
      }

      if (Array.isArray(savedProgress.inventory)) {
        player.inventory = savedProgress.inventory
          .filter((i) => i && typeof i.itemId === 'string' && i.quantity > 0)
          .map((i) => ({
            address: i.itemId,
            quantity: i.quantity,
            name: i.data?.name || '',
            symbol: i.data?.symbol || '',
            image: i.data?.image || '',
          }));
      }
    } else {
      player.nickname = await assignUniqueNickname(player, `Player_${player.wallet.slice(0, 4)}`);
      spawnInSafeZone(player);
    }

    const verifyResult2 = await callInternalApi('/api/internal/game/faction/verify-memberships', {
      userId: player.userId, gameId: player.gameId, wallet: player.wallet,
    }).catch((err) => {
      console.error('[Faction] verify-memberships error:', err.message);
      return null;
    });

    if (verifyResult2) {
      applyPlayerFactions(player, verifyResult2.remaining);
      if (verifyResult2.kicked && verifyResult2.kicked.length > 0) {
        console.log(`[Faction] auto-kicked ${player.userId} from: ${verifyResult2.kicked.map((k) => k.factionName).join(', ')}`);
      }
    } else {
 
      await refreshPlayerFactions(player);
    }

    await refreshPlayerCosmetics(player);
    if (shopPriceOverrides.size === 0) await refreshShopPrices(player.gameId);

    const blocksResult = await callInternalApi('/api/internal/game/blocks/list', {
      userId: player.userId, gameId: player.gameId,
    }).catch((err) => {
      console.error('[Blocks] list error:', err.message);
      return null;
    });
    player.blockedUserIds = new Set((blocksResult?.blocked || []).map((b) => b.userId));

    player.justSpawned = true;

    player.authenticated = true;
    setPlayerLoading(player);
    players.set(playerId, player);

    console.log(`[+] Authenticated: ${playerId} (${player.userId}, ${player.nickname}, loc:${player.locationId}). Total: ${players.size}`);

    const existingPlayers = [];
    players.forEach((p, id) => {
      if (id !== playerId && p.authenticated) {
        if (isInAOI(player, p)) {
          if (p.ready) existingPlayers.push(buildPlayerJoinPayload(p));

          player.aoiNeighbors.add(id);
          p.aoiNeighbors.add(playerId);
        }
      }
    });

    safeSend(ws, {
      type: 'auth_success',
      playerId,
      nickname: player.nickname,
      userId: player.userId,
      wallet: player.wallet,
      gameId: player.gameId,
      daySyncEpoch: dayNightEpoch,
      dayDurationMs: DAY_NIGHT_CONFIG.dayDurationMs,
      nightDurationMs: DAY_NIGHT_CONFIG.nightDurationMs,
      skinTextureUrl: player.skinTextureUrl || null,
    });

    safeSend(ws, {
      type: 'init',
      playerId,
      players: existingPlayers,
      count: Array.from(players.values()).filter((p) => p.authenticated).length,
      spawnPosition: player.position,
    });

    safeSend(ws, { type: 'factionMyListResult', factions: player.factions });
    sendCosmeticState(player);

    if (player.locationId === 'main-world') {
      safeSend(ws, { type: 'lootState', loot: serializeLoot() });
      await ensureSignsLoaded(player.gameId);
      safeSend(ws, { type: 'signState', signs: serializeSigns() });
    }

    if (player.locationId === 'tower-first-floor') {
      enterCanyonHub(player);
    }

    if (player.locationId === GALAXY_LOCATION_ID) {
      safeSend(ws, { type: 'factionGatesState', gates: displayedFactionGatesList, accountCount });
      sendShardState(player);
    }

    if (typeof player.locationId === 'string' && player.locationId.startsWith(FACTION_ROOM_PREFIX)) {
      const joinRoomFactionId = player.locationId.slice(FACTION_ROOM_PREFIX.length);
      await ensureFurnitureLoaded(joinRoomFactionId);
      safeSend(ws, { type: 'furnitureState', items: serializeFurnitureForRoom(joinRoomFactionId) });
    }

    safeSend(ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });

    if (savedProgress) {
      safeSend(ws, {
        type: 'progress_loaded',
        progress: savedProgress,
      });
    }

    for (const quest of Object.values(QUESTS)) {
      const state = getQuestState(player, quest.id);
      if (state.status === 'active' || state.status === 'ready_to_turn_in') {
        safeSend(ws, {
          type: 'questInfo',
          questId: quest.id,
          npc: quest.npc,
          title: quest.title,
          description: quest.description,
          targetCount: quest.targetCount,
          rewardAsh: quest.rewardAsh,
          status: state.status,
          progress: state.progress,
        });
      }
    }

    broadcastCount();
  }

  function handlePlayerUpdate(player, data) {
    if (!player.alive) return;
    if (!isValidPositionForLocation(player.locationId, data.position)) return;

    const now = Date.now();
    const delta = now - player.lastUpdate;
    if (delta < CONFIG.world.maxPositionUpdateRate) return;

    if (!isValidMovement(player, data.position, delta)) {
      safeSend(ws, { type: 'positionCorrection', position: player.position });
      return;
    }

    if (data.jumping && !player.jumping) {
      if (now - player.lastJump < 400) {
        data.jumping = false;
      } else {
        player.lastJump = now;
      }
    }

    player.positionHistory.push({
      position: [...data.position],
      time: now,
    });
    player.positionHistory = player.positionHistory.filter(
      p => now - p.time < 500
    );

    player.position = data.position;
    player.rotation = typeof data.rotation === 'number' ? data.rotation : 0;
    player.pitch = typeof data.pitch === 'number' ? data.pitch : 0;

    player.state = VALID_STATES.has(data.state) ? data.state : 'idle';

    player.jumping = !!data.jumping;
    player.velocityY = typeof data.velocityY === 'number' ? data.velocityY : 0;
    const requestedWeaponEquipped = data.weaponEquipped !== false;
    player.weaponEquipped = player.locationId === 'tower-main-hall' ? false : requestedWeaponEquipped;
    player.isShooting = !!data.isShooting;
    player.lastUpdate = now;

    recomputeAOI(player);

    if (!player.ready) return;

    broadcast({
      type: 'playerUpdate',
      id: playerId,
      position: player.position,
      rotation: player.rotation,
      pitch: player.pitch,
      state: player.state,
      jumping: player.jumping,
      velocityY: player.velocityY,
      health: player.health,
      alive: player.alive,
      weaponEquipped: player.weaponEquipped,
      isShooting: player.isShooting,
    }, playerId, true, player);
  }

  function handleShoot(player, data) {
    if (!player.alive) return;
    clearSpawnProtection(player);

    if (!Array.isArray(data.origin) || !Array.isArray(data.direction)) return;
    if (data.origin.length !== 3 || data.direction.length !== 3) return;

    const now = Date.now();

    if (player.weaponAmmo <= 0) {
      if (now - player.ammoEmptyAt >= WEAPON_CONFIG.reloadDurationMs) {
        player.weaponAmmo = WEAPON_CONFIG.maxAmmo;
      } else {
        return; 
      }
    }

    if (now - player.lastShotAt < WEAPON_CONFIG.fireRateMs - WEAPON_CONFIG.fireRateToleranceMs) {
      console.log(`[!] Shoot hack: ${playerId} firing faster than weapon fire rate`);
      return;
    }

    const [px, , pz] = player.position;
    const [ox, oy, oz] = data.origin;
    const [dx, dy, dz] = data.direction;

    const distFromPlayer = Math.sqrt((ox - px) ** 2 + (oz - pz) ** 2);
    if (distFromPlayer > 3) {
      console.log(`[!] Shoot hack: origin ${distFromPlayer.toFixed(2)}m from player`);
      return;
    }

    const playerY = player.position[1];
    if (oy < playerY - 3 || oy > playerY + 5) {
      console.log(`[!] Shoot hack: invalid origin Y=${oy.toFixed(2)} at player Y=${playerY.toFixed(2)}`);
      return;
    }

    const dirLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dirLength < 0.001) return;
    const direction = [dx / dirLength, dy / dirLength, dz / dirLength];

    if (isInProtectedZone(player)) {
      safeSend(ws, { type: 'error', message: 'Cannot shoot in safe zone' });
      return;
    }

    player.weaponAmmo--;
    player.lastShotAt = now;
    if (player.weaponAmmo <= 0) player.ammoEmptyAt = now;

    player.stats.shotsFired++;
    bumpFactionTaskProgress(player, 'shots', 1).catch((err) => console.error('[FactionTask] bump error:', err.message));

    player.recentShots.push({ time: now, origin: [ox, oy, oz], direction });
    player.recentShots = player.recentShots.filter(
      s => now - s.time < CONFIG.combat.shotMatchWindowMs
    );

    broadcast({
      type: 'shoot',
      id: playerId,
      origin: data.origin,
      direction: direction,
    }, playerId, true, player);
  }

  async function handleNicknameChange(player, data) {
    if (typeof data.nickname !== 'string') return;
    const newNick = data.nickname.trim().slice(0, 30);
    if (newNick.length === 0) return;

    if (newNick === player.nickname) {
      safeSend(ws, { type: 'nicknameChanged', nickname: player.nickname });
      return;
    }

    const result = await callInternalApi('/api/internal/game/nickname/set', {
      userId: player.userId, gameId: player.gameId, nickname: newNick, allowSuffix: false,
    }).catch((err) => {
      console.error('[Nickname] change error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(ws, {
        type: 'error',
        message: result?.error === 'nickname_taken' ? 'That nickname is already taken' : 'Could not change nickname',
      });
      return;
    }

    player.nickname = result.nickname;

    broadcast({
      type: 'nicknameChange',
      id: playerId,
      nickname: player.nickname,
    }, playerId, true, player);

    safeSend(ws, { type: 'nicknameChanged', nickname: player.nickname });
  }

  async function handleSkinUpdate(player, data) {
    if (typeof data.url !== 'string' || data.url.length === 0 || data.url.length > 500) return;

    let parsed;
    try {
      parsed = new URL(data.url);
    } catch (e) {
      return;
    }

    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.public.blob.vercel-storage.com')) {
      safeSend(ws, { type: 'error', message: 'Invalid skin URL' });
      return;
    }

    player.skinTextureUrl = data.url;
    player.skinTextureUrlChangedAt = Date.now();
    persistPlayer(player);

    broadcast({
      type: 'skinUpdate',
      playerId: player.id,
      url: player.skinTextureUrl,
    }, playerId, true, player);

    safeSend(ws, { type: 'skinUpdate', playerId: player.id, url: player.skinTextureUrl });
  }

  function isMuted(player) {
    return !!player.mutedUntil && new Date(player.mutedUntil).getTime() > Date.now();
  }

  function handleChat(player, data) {
    if (typeof data.message !== 'string') return;

    if (isMuted(player)) {
      safeSend(player.ws, { type: 'error', message: `You are muted until ${new Date(player.mutedUntil).toLocaleString()}` });
      return;
    }

    const msg = sanitizeMessage(data.message.trim().slice(0, 200));
    if (msg.length === 0) return;

    if (containsLink(msg)) {
      safeSend(player.ws, { type: 'error', message: 'Links are not allowed in chat' });
      return;
    }

    broadcast({
      type: 'chat',
      id: generateId(),
      sender: player.nickname,
      senderWallet: player.wallet,
      senderFactionSymbol: player.displayedFactionSymbol,
      senderFactionImage: player.displayedFactionImage,
      senderIsAdmin: !!player.isAdmin,
      senderIsFactionCreator: !!player.isFactionCreator,
      message: msg,
      timestamp: Date.now(),
    }, null, false, player, true);

    logChatMessage(player, msg, null);
  }

  function handleFactionChat(player, data) {
    if (typeof data.message !== 'string') return;
    if (typeof data.factionId !== 'string' || !data.factionId) return;

    if (isMuted(player)) {
      safeSend(player.ws, { type: 'error', message: `You are muted until ${new Date(player.mutedUntil).toLocaleString()}` });
      return;
    }

    if (!player.factions?.some((f) => f.id === data.factionId)) {
      safeSend(player.ws, { type: 'error', message: 'You are not a member of that faction' });
      return;
    }

    const msg = sanitizeMessage(data.message.trim().slice(0, 200));
    if (msg.length === 0) return;

    if (containsLink(msg)) {
      safeSend(player.ws, { type: 'error', message: 'Links are not allowed in chat' });
      return;
    }

    broadcastToFaction(data.factionId, {
      type: 'factionChat',
      id: generateId(),
      factionId: data.factionId,
      sender: player.nickname,
      senderWallet: player.wallet,
      senderFactionSymbol: player.displayedFactionSymbol,
      senderFactionImage: player.displayedFactionImage,
      senderIsAdmin: !!player.isAdmin,
      senderIsFactionCreator: !!player.isFactionCreator,
      message: msg,
      timestamp: Date.now(),
    }, null, player.userId);

    logChatMessage(player, msg, data.factionId);
  }

  function logChatMessage(player, message, factionId) {
    callInternalApi('/api/internal/game/chat/log', {
      gameId: player.gameId,
      senderUserId: player.userId,
      senderWallet: player.wallet,
      senderNickname: player.nickname,
      factionId,
      message,
    }).catch((err) => {
      console.error('[Chat] log error:', err.message);
    });
  }

  function relayVoiceSignal(player, targetId, payload) {
    if (isMuted(player)) return;
    if (typeof targetId !== 'string') return;
    const target = players.get(targetId);
    if (!target || !target.authenticated || target.ws.readyState !== WebSocket.OPEN) return;
    if (target.locationId !== player.locationId) return;
    safeSend(target.ws, payload);
  }

  function handleVoiceOffer(player, data) {
    if (typeof data.sdp !== 'string') return;
    relayVoiceSignal(player, data.targetId, { type: 'voiceOffer', fromId: player.id, sdp: data.sdp });
  }

  function handleVoiceAnswer(player, data) {
    if (typeof data.sdp !== 'string') return;
    relayVoiceSignal(player, data.targetId, { type: 'voiceAnswer', fromId: player.id, sdp: data.sdp });
  }

  function handleVoiceIceCandidate(player, data) {
    if (!data.candidate || typeof data.candidate !== 'object') return;
    relayVoiceSignal(player, data.targetId, { type: 'voiceIceCandidate', fromId: player.id, candidate: data.candidate });
  }

  function handleHit(player, data) {
    if (!player.alive) return;

    if (!data.target || typeof data.target !== 'string') return;
    if (!Array.isArray(data.point) || data.point.length !== 3) return;

    const target = players.get(data.target);
    if (!target || !target.authenticated || !target.alive) return;
    if (data.target === playerId) return;

    if (player.locationId !== target.locationId) {
      console.log(`[!] Hit hack: different locations ${player.locationId} vs ${target.locationId}`);
      return;
    }

    if (isInProtectedZone(player) || isInProtectedZone(target)) {
      return;
    }

    const [px, , pz] = player.position;

    const shotTime = Date.now() - player.rtt;
    const historicalPos = getHistoricalPosition(target, shotTime);

    const [tx, , tz] = historicalPos;
    const dist = Math.sqrt((tx - px) ** 2 + (tz - pz) ** 2);
    if (dist > 300) {
      console.log(`[!] Hit hack: distance ${dist.toFixed(2)}m`);
      return;
    }

    const matchedShot = findMatchingShot(player, historicalPos, Date.now());
    if (!matchedShot) {
      console.log(`[!] Hit hack: no matching recent shot from ${playerId} explains hit on ${data.target}`);
      return;
    }

    if (isPathBlockedByEntity(player.position, historicalPos, player.locationId, new Set([playerId, data.target]))) {
      console.log(`[!] Hit rejected: shot from ${playerId} to ${data.target} blocked by another entity`);
      return;
    }

    if (isSpawnProtected(target)) return;

    const damage = 5;
    target.health = Math.max(0, target.health - damage);
    target.lastDamageTime = Date.now();

    broadcast({
      type: 'playerDamaged',
      targetId: data.target,
      attackerId: playerId,
      damage: damage,
      health: target.health,
      point: historicalPos,
      historicalPosition: historicalPos,
    }, null, true, player);

    if (target.health <= 0) {
      player.stats.kills++;
      bumpFactionTaskProgress(player, 'kills', 1).catch((err) => console.error('[FactionTask] bump error:', err.message));
      markPlayerDead(target, playerId, historicalPos);
    }
  }

  function handleEnemyHit(player, data) {
    if (!player.alive) return;
    if (typeof data.target !== 'string') return;
    if (!Array.isArray(data.point) || data.point.length !== 3) return;
    if (player.locationId !== 'tower-first-floor' || !player.canyon) return;

    const enemy = player.canyon.enemies.get(data.target);
    if (!enemy || !enemy.alive) return;

    const [px, , pz] = player.position;

    const shotTime = Date.now() - player.rtt;
    const historicalPos = getHistoricalPosition(enemy, shotTime);

    const dist = Math.sqrt((historicalPos[0] - px) ** 2 + (historicalPos[2] - pz) ** 2);
    if (dist > 300) {
      console.log(`[!] Enemy hit hack: distance ${dist.toFixed(2)}m`);
      return;
    }

    const matchedShot = findMatchingShot(player, historicalPos, Date.now(), CANYON_CONFIG.hitTolerance);
    if (!matchedShot) {
      console.log(`[!] Enemy hit hack: no matching recent shot from ${playerId} explains hit on ${data.target}`);
      return;
    }

    if (isPathBlockedByEntity(player.position, historicalPos, player.locationId, new Set([playerId, enemy.id]), player.canyon.enemies.values())) {
      console.log(`[!] Enemy hit rejected: shot from ${playerId} to ${data.target} blocked by another entity`);
      return;
    }

    enemy.health = Math.max(0, enemy.health - PLAYER_WEAPON_DAMAGE_TO_ENEMY);

    safeSend(player.ws, {
      type: 'enemyDamaged',
      id: enemy.id,
      health: enemy.health,
      attackerId: playerId,
      point: data.point,
    });

    if (enemy.health <= 0) {
      enemy.alive = false;
      enemy.targetId = null;

      safeSend(player.ws, {
        type: 'enemyDeath',
        id: enemy.id,
        killerId: playerId,
      });

      incrementKillQuests(player);

      const alreadyCleared = player.canyon.clearedSegments.has(player.canyon.segment);
      if (!alreadyCleared) {
        const cfg = ENEMY_TYPES[enemy.type];
        dropCanyonLoot(player, enemy.position, cfg.lootMin, cfg.lootMax);
      }

      if (enemy.type === 'slime_boss') {
        const clearedSegment = player.canyon.segment;
        if (!alreadyCleared) {
          player.canyon.clearedSegments.add(clearedSegment);
        }
        const nextSegment = Math.min(clearedSegment + 1, CANYON_MAX_SEGMENT_CAP);
        if (nextSegment > player.canyon.maxSegmentReached) {
          player.canyon.maxSegmentReached = nextSegment;
        }
        persistPlayer(player);

        player.canyon.pendingSegment = nextSegment;

        safeSend(player.ws, {
          type: 'canyonCleared',
          clearedSegment,
          segment: nextSegment,
          maxSegmentReached: player.canyon.maxSegmentReached,
          name: canyonSegmentName(nextSegment),
          biome: canyonBiomeFor(nextSegment).key,
        });
      }
    } else {
      enemy.targetId = playerId;
    }
  }

  function handleCanyonWarp(player, data) {
    if (player.locationId !== 'tower-first-floor' || !player.canyon) return;
    if (!player.canyon.inHub) return;
    const segment = Math.floor(Number(data.segment));
    if (!Number.isInteger(segment) || segment < 1 || segment > player.canyon.maxSegmentReached) return;

    populateCanyonSegment(player, segment);
  }

  function handleCanyonEnterDungeon(player) {
    if (player.locationId !== 'tower-first-floor' || !player.canyon) return;
    if (!player.canyon.inHub) return;

    populateCanyonSegment(player, 1);
  }

  function handleCanyonCrossThreshold(player) {
    if (player.locationId !== 'tower-first-floor' || !player.canyon) return;
    if (player.canyon.inHub || player.canyon.pendingSegment == null) return;

    const nextSegment = player.canyon.pendingSegment;
    player.canyon.pendingSegment = null;
    preparePlayerEnemiesForSegment(player, nextSegment);
    safeSend(player.ws, { type: 'enemyState', enemies: serializeCanyonEnemies(player) });
  }

  function handleCanyonReturnToHub(player) {
    if (player.locationId !== 'tower-first-floor' || !player.canyon) return;
    if (player.canyon.inHub) return;

    enterCanyonHub(player);
  }

  function handleCanyonMapRequest(player) {
    if (player.locationId !== 'tower-first-floor' || !player.canyon) return;
    safeSend(player.ws, {
      type: 'canyonMap',
      segment: player.canyon.segment,
      maxSegmentReached: player.canyon.maxSegmentReached,
      clearedSegments: Array.from(player.canyon.clearedSegments),
    });
  }

  function factionErrorMessage(code) {
    switch (code) {
      case 'already_in_faction': return 'You are already a member of that faction';
      case 'name_taken': return 'A faction for that token already exists';
      case 'faction_not_found': return 'That faction no longer exists';
      case 'invalid_name': return 'Could not determine a name for that token';
      case 'token_not_found': return 'Could not find a token for that address';
      case 'insufficient_token_balance': return 'You need to hold this faction\'s token in your wallet to do that';
      case 'balance_check_failed': return 'Could not verify your token balance right now, try again shortly';
      default: return 'Faction action failed';
    }
  }

  async function handleFactionCreate(player, data) {
    safeSend(player.ws, {
      type: 'error',
      message: 'Faction creation now happens through Alaric in-game and costs 1,000,000 TNJ. Please update your client.',
    });
  }

  async function handleFactionJoin(player, data) {
    if (typeof data.factionId !== 'string' || !data.factionId) return;

    const result = await callInternalApi('/api/internal/game/faction/join', {
      userId: player.userId,
      gameId: player.gameId,
      wallet: player.wallet,
      factionId: data.factionId,
    }).catch((err) => {
      console.error('[Faction] join error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: factionErrorMessage(result?.error) });
      return;
    }

    await refreshPlayerFactions(player);
    safeSend(player.ws, { type: 'factionJoined', faction: result.faction });
    broadcastFactionIdentity(player);
    notifyFactionRosterChanged(data.factionId);
  }

  async function handleFactionInvite(player, data) {
    if (typeof data.factionId !== 'string' || !data.factionId) return;
    if (typeof data.toWallet !== 'string' || !data.toWallet.trim()) return;

    if (!player.factions?.some((f) => f.id === data.factionId)) {
      safeSend(player.ws, { type: 'error', message: 'You are not a member of that faction' });
      return;
    }

    const result = await callInternalApi('/api/internal/game/faction/invite-mail', {
      inviterUserId: player.userId,
      gameId: player.gameId,
      factionId: data.factionId,
      toWallet: data.toWallet.trim(),
    }).catch((err) => {
      console.error('[Faction] invite error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not send faction invite' });
      return;
    }

    safeSend(player.ws, { type: 'factionInviteSent', toWallet: data.toWallet.trim() });
  }

  async function handleFactionLeave(player, data) {
    if (typeof data.factionId !== 'string' || !data.factionId) return;

    await callInternalApi('/api/internal/game/faction/leave', {
      userId: player.userId,
      gameId: player.gameId,
      factionId: data.factionId,
    }).catch((err) => console.error('[Faction] leave error:', err.message));

    await refreshPlayerFactions(player);
    safeSend(player.ws, { type: 'factionLeft', factionId: data.factionId });
    broadcastFactionIdentity(player);
    notifyFactionRosterChanged(data.factionId);
  }

  async function handleFactionSetDisplayed(player, data) {
    if (typeof data.factionId !== 'string' || !data.factionId) return;

    const result = await callInternalApi('/api/internal/game/faction/set-displayed', {
      userId: player.userId,
      gameId: player.gameId,
      factionId: data.factionId,
    }).catch((err) => {
      console.error('[Faction] set-displayed error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not switch displayed faction' });
      return;
    }

    await refreshPlayerFactions(player);
    safeSend(player.ws, { type: 'factionDisplayedSet', faction: result.faction });
    broadcastFactionIdentity(player);
  }

  async function handleFactionMyListRequest(player) {
    await refreshPlayerFactions(player);
    safeSend(player.ws, { type: 'factionMyListResult', factions: player.factions });
  }

  async function handleFactionSearch(player, data) {
    const ca = typeof data.ca === 'string' ? data.ca : '';
    const name = typeof data.name === 'string' ? data.name : '';

    if (!ca && !name) {
      safeSend(player.ws, { type: 'factionSearchResult', results: [] });
      return;
    }

    const result = await callInternalApi('/api/internal/game/faction/search', {
      gameId: player.gameId, ca, name,
    }).catch((err) => {
      console.error('[Faction] search error:', err.message);
      return null;
    });

    safeSend(player.ws, { type: 'factionSearchResult', results: result?.results || [] });
  }

  async function handleFactionList(player, data) {
    const page = Number.isInteger(data.page) && data.page > 0 ? data.page : 1;

    const result = await callInternalApi('/api/internal/game/faction/list', {
      gameId: player.gameId, page, limit: 20,
    }).catch((err) => {
      console.error('[Faction] list error:', err.message);
      return null;
    });

    safeSend(player.ws, {
      type: 'factionListResult',
      results: result?.results || [],
      page: result?.page || page,
    });
  }

  async function handleFactionInfo(player, data) {
    if (typeof data.factionId !== 'string' || !data.factionId) return;

    const result = await callInternalApi('/api/internal/game/faction/get-by-id', {
      gameId: player.gameId, factionId: data.factionId, viewerUserId: player.userId,
    }).catch((err) => {
      console.error('[Faction] info error:', err.message);
      return null;
    });
    safeSend(player.ws, { type: 'factionInfo', faction: result?.faction || null });
  }

  async function handlePlayerProfileRequest(player, data) {
    if (typeof data.wallet !== 'string' || !data.wallet) return;

    const result = await callInternalApi('/api/internal/game/player-profile', {
      gameId: player.gameId, wallet: data.wallet,
    }).catch((err) => {
      console.error('[Profile] request error:', err.message);
      return null;
    });

    safeSend(player.ws, { type: 'playerProfile', profile: result?.profile || null });
  }

  async function handleLeaderboardRequest(player, data) {
    const limit = Number.isInteger(data.limit) && data.limit > 0 ? data.limit : 20;

    const result = await cachedInternalCall(
      `leaderboard:${player.gameId}:${limit}`,
      5000,
      () => callInternalApi('/api/internal/game/leaderboard', { gameId: player.gameId, limit })
    ).catch((err) => {
      console.error('[Leaderboard] request error:', err.message);
      return null;
    });

    safeSend(player.ws, { type: 'leaderboardResult', leaderboard: result?.leaderboard || [] });
  }

  async function handleFactionLeaderboardRequest(player, data) {
    const limit = Number.isInteger(data.limit) && data.limit > 0 ? data.limit : 50;

    const result = await cachedInternalCall(
      `factionLeaderboard:${player.gameId}:${limit}`,
      5000,
      () => callInternalApi('/api/internal/game/faction/leaderboard', { gameId: player.gameId, limit })
    ).catch((err) => {
      console.error('[Faction] leaderboard request error:', err.message);
      return null;
    });

    safeSend(player.ws, { type: 'factionLeaderboardResult', leaderboard: result?.leaderboard || [] });
  }

  function applyPlayerFactions(player, factionsList) {
    player.factions = factionsList || [];
    const displayed = player.factions.find((f) => f.isDisplayed) || null;
    player.displayedFactionId = displayed?.id || null;
    player.displayedFactionName = displayed?.name || null;
    player.displayedFactionSymbol = displayed?.symbol || null;
    player.displayedFactionImage = displayed?.image || null;
    player.isFactionCreator = player.factions.some((f) => f.verifiedCreatorWallet === player.wallet);
  }

  function broadcastFactionIdentity(player) {
    broadcast({
      type: 'playerFactionIdentity',
      id: player.id,
      factionSymbol: player.displayedFactionSymbol,
      factionImage: player.displayedFactionImage,
      isFactionCreator: player.isFactionCreator,
    }, player.id, true, player);
  }

  function notifyFactionRosterChanged(factionId) {
    if (!factionId) return;

    internalCache.forEach((entry, key) => {
      if (entry.pending) return;
      if (key.startsWith('factionLeaderboard:') || key.startsWith('factionQuests:')) internalCache.delete(key);
    });

    players.forEach((p) => {
      if (!p.authenticated || p.ws.readyState !== WebSocket.OPEN) return;

      const isMember = !!p.factions?.some((f) => f.id === factionId);
      const showsBoards = p.locationId === 'tower-main-hall';
      if (!isMember && !showsBoards) return;

      safeSend(p.ws, { type: 'factionRosterChanged', factionId, mine: isMember });
    });
  }

  async function refreshPlayerFactions(player) {
    const result = await callInternalApi('/api/internal/game/faction/my-factions', {
      userId: player.userId, gameId: player.gameId,
    }).catch((err) => {
      console.error('[Faction] my-factions error:', err.message);
      return null;
    });
    applyPlayerFactions(player, result?.factions);
  }

  function broadcastToFaction(factionId, message, excludePlayerId, senderUserId = null) {
    players.forEach((p) => {
      if (p.authenticated && p.id !== excludePlayerId && p.factions?.some((f) => f.id === factionId)) {
        if (senderUserId && p.blockedUserIds?.has(senderUserId)) return;
        safeSend(p.ws, message);
      }
    });
  }

  async function hydrateFactionTaskState(factionId, gameId) {
    const myGen = nextFactionTaskGeneration(factionId);

    const result = await callInternalApi('/api/internal/game/faction/get-by-id', {
      gameId, factionId,
    }).catch((err) => {
      console.error('[FactionTask] hydrate error:', err.message);
      return null;
    });

    if (factionTaskGeneration.get(factionId) !== myGen) {
      return factionTaskState.get(factionId) || null;
    }

    const faction = result?.faction;
    if (!faction || !faction.activeTask) {
      factionTaskState.delete(factionId);
      return null;
    }

    const def = FACTION_TASKS_BY_KEY.get(faction.activeTask.key);
    const state = {
      taskKey: faction.activeTask.key,
      metric: def ? def.metric : null,
      target: faction.activeTask.target,
      progress: faction.activeTask.progress,
      dirty: false,
      contributions: new Map(),
    };
    factionTaskState.set(factionId, state);
    return state;
  }

  async function completeFactionTask(factionId, taskKey, gameId, contributions) {
    factionTaskState.delete(factionId);

    const contributionsPayload = contributions
      ? Array.from(contributions.entries()).map(([userId, amount]) => ({ userId, amount }))
      : [];

    const result = await callInternalApi('/api/internal/game/faction/complete-task', {
      factionId, taskKey, contributions: contributionsPayload,
    }).catch((err) => {
      console.error('[FactionTask] complete error:', err.message);
      return null;
    });

    if (!result || !result.success) return;

    const recipient = userIdToPlayer.get(result.rewardUserId);
    if (recipient) {
      recipient.ash += result.rewardAsh;
      safeSend(recipient.ws, { type: 'inventoryUpdate', inventory: recipient.inventory, ash: recipient.ash });
    }

    const def = FACTION_TASKS_BY_KEY.get(taskKey);
    broadcastToFaction(factionId, {
      type: 'factionTaskCompleted',
      taskKey,
      label: def ? def.label : taskKey,
      rewardAsh: result.rewardAsh,
      rewardNickname: result.rewardNickname,
    });

    const fresh = await callInternalApi('/api/internal/game/faction/get-by-id', {
      gameId, factionId,
    }).catch((err) => {
      console.error('[FactionTask] refresh error:', err.message);
      return null;
    });
    if (fresh?.faction) {
      broadcastToFaction(factionId, { type: 'factionInfo', faction: fresh.faction });
    }
  }

  async function getOrHydrateFactionTaskState(factionId, gameId) {
    const cached = factionTaskState.get(factionId);
    if (cached) return cached;

    let inflight = factionTaskHydrating.get(factionId);
    if (!inflight) {
      inflight = hydrateFactionTaskState(factionId, gameId).finally(() => {
        factionTaskHydrating.delete(factionId);
      });
      factionTaskHydrating.set(factionId, inflight);
    }
    return inflight;
  }

  async function bumpSingleFactionTask(factionId, gameId, metric, amount, userId) {
    const state = await getOrHydrateFactionTaskState(factionId, gameId);
    if (!state || !state.taskKey || state.metric !== metric) return;
    if (factionTaskState.get(factionId) !== state) return;

    state.progress += amount;
    state.dirty = true;

    if (userId) {
      if (!state.contributions) state.contributions = new Map();
      state.contributions.set(userId, (state.contributions.get(userId) || 0) + amount);
    }

    if (state.progress >= state.target) {
      await completeFactionTask(factionId, state.taskKey, gameId, state.contributions);
    }
  }

  async function bumpFactionTaskProgress(player, metric, amount) {
    if (!player.factions?.length || amount <= 0) return;
    await Promise.all(player.factions.map((f) => bumpSingleFactionTask(f.id, player.gameId, metric, amount, player.userId)));
  }

  function handleFactionTaskListRequest(player) {
    safeSend(player.ws, { type: 'factionTaskListResult', tasks: FACTION_TASKS });
  }

  async function handleFactionAcceptTask(player, data) {
    if (typeof data.factionId !== 'string' || !player.factions?.some((f) => f.id === data.factionId)) return;
    if (typeof data.taskKey !== 'string') return;
    const def = FACTION_TASKS_BY_KEY.get(data.taskKey);
    if (!def) {
      safeSend(player.ws, { type: 'error', message: 'Unknown task' });
      return;
    }

    const myGen = nextFactionTaskGeneration(data.factionId);

    const result = await callInternalApi('/api/internal/game/faction/accept-task', {
      userId: player.userId, gameId: player.gameId, factionId: data.factionId,
      taskKey: def.key, target: def.target, rewardAsh: def.rewardAsh,
    }).catch((err) => {
      console.error('[FactionTask] accept error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      const message = result?.error === 'task_already_active'
        ? 'A task is already active for your faction'
        : result?.error === 'not_authorized'
          ? 'Only the faction leader or verified token creator can accept tasks'
          : 'Could not accept task';
      safeSend(player.ws, { type: 'error', message });
      return;
    }

    if (factionTaskGeneration.get(data.factionId) === myGen) {
      factionTaskState.set(data.factionId, {
        taskKey: def.key, metric: def.metric, target: def.target, progress: 0, dirty: false, contributions: new Map(),
      });
    }

    broadcastToFaction(data.factionId, { type: 'factionTaskAccepted', faction: result.faction }, null);
  }

  async function handleFactionClaimCreator(player, data) {
    if (typeof data.factionId !== 'string' || !player.factions?.some((f) => f.id === data.factionId)) return;

    const result = await callInternalApi('/api/internal/game/faction/claim-creator', {
      userId: player.userId, gameId: player.gameId, wallet: player.wallet, factionId: data.factionId,
    }).catch((err) => {
      console.error('[FactionTask] claim-creator error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not verify token creator right now' });
      return;
    }

    safeSend(player.ws, { type: 'factionCreatorClaimResult', isCreator: result.isCreator, faction: result.faction });

    if (result.isCreator) {
      broadcastToFaction(data.factionId, { type: 'factionCreatorVerified', faction: result.faction }, player.id);
    }
  }

  async function handleFactionQuestCreate(player, data) {
    if (typeof data.factionId !== 'string' || !player.factions?.some((f) => f.id === data.factionId)) return;

    const targetUrl = typeof data.targetUrl === 'string' ? data.targetUrl.trim() : '';
    if (!isValidXPostUrl(targetUrl)) {
      safeSend(player.ws, { type: 'error', message: 'The quest link must be a post on https://x.com/' });
      return;
    }

    const slotsTotal = Number.isInteger(data.slotsTotal) ? data.slotsTotal : 0;
    const rewardAsh = Number.isInteger(data.rewardAsh) ? data.rewardAsh : 0;
    if (slotsTotal < QUEST_MIN_SLOTS || slotsTotal > QUEST_MAX_SLOTS) {
      safeSend(player.ws, { type: 'error', message: `Participants must be between ${QUEST_MIN_SLOTS} and ${QUEST_MAX_SLOTS}` });
      return;
    }
    if (rewardAsh < QUEST_MIN_REWARD_ASH || rewardAsh > QUEST_MAX_REWARD_ASH) {
      safeSend(player.ws, { type: 'error', message: `Reward must be between ${QUEST_MIN_REWARD_ASH} and ${QUEST_MAX_REWARD_ASH} Ash` });
      return;
    }

    const totalCost = questTotalCostAsh(slotsTotal, rewardAsh);
    if (player.ash < totalCost) {
      safeSend(player.ws, { type: 'error', message: `Not enough Ash — this quest costs ${totalCost} Ash` });
      return;
    }

    player.ash -= totalCost;
    player.economyChangedAt = Date.now();
    persistPlayer(player);
    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });

    const result = await callInternalApi('/api/internal/game/faction/quest/create', {
      userId: player.userId, gameId: player.gameId, wallet: player.wallet,
      factionId: data.factionId, targetUrl, slotsTotal, rewardAsh,
    }).catch((err) => {
      console.error('[FactionQuest] create error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      player.ash += totalCost;
      player.economyChangedAt = Date.now();
      persistPlayer(player);
      const message = result?.error === 'not_verified_creator'
        ? 'Only the verified token creator can publish faction quests'
        : result?.error === 'invalid_post_url'
          ? 'The quest link must be a post on https://x.com/'
          : 'Could not publish that quest right now';
      safeSend(player.ws, { type: 'error', message });
      safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
      return;
    }

    persistPlayer(player);
    safeSend(player.ws, { type: 'factionQuestCreated', quest: result.quest, chargedAsh: totalCost });
  }

  async function handleFactionQuestListRequest(player) {
    const result = await cachedInternalCall(
      `factionQuests:${player.gameId}:${player.userId}`,
      5000,
      () => callInternalApi('/api/internal/game/faction/quest/list', {
        gameId: player.gameId, viewerUserId: player.userId, limit: 50,
      })
    ).catch((err) => {
      console.error('[FactionQuest] list error:', err.message);
      return null;
    });

    safeSend(player.ws, { type: 'factionQuestListResult', quests: result?.quests || [] });
  }

  async function handleFactionQuestManageListRequest(player, data) {
    if (typeof data.factionId !== 'string' || !player.factions?.some((f) => f.id === data.factionId)) return;

    const result = await callInternalApi('/api/internal/game/faction/quest/faction-list', {
      gameId: player.gameId, factionId: data.factionId, userId: player.userId,
    }).catch((err) => {
      console.error('[FactionQuest] faction-list error:', err.message);
      return null;
    });

    safeSend(player.ws, {
      type: 'factionQuestManageListResult',
      factionId: data.factionId,
      canManage: !!result?.canManage,
      questTypes: FACTION_QUEST_TYPES,
      listingFeeAsh: QUEST_LISTING_FEE_ASH,
      quests: result?.quests || [],
    });
  }

  async function handleFactionQuestClaim(player, data) {
    if (typeof data.questId !== 'string' || !data.questId) return;

    const result = await callInternalApi('/api/internal/game/faction/quest/claim', {
      questId: data.questId, userId: player.userId, gameId: player.gameId, wallet: player.wallet,
    }).catch((err) => {
      console.error('[FactionQuest] claim error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      const message = result?.error === 'already_completed'
        ? 'You already claimed this quest'
        : result?.error === 'quest_full'
          ? 'All reward slots for this quest are taken'
          : result?.error === 'own_quest'
            ? "You can't claim your own faction's quest"
            : 'Could not claim that quest right now';
      safeSend(player.ws, { type: 'error', message });
      return;
    }

    player.ash += result.rewardAsh;
    player.economyChangedAt = Date.now();
    bumpFactionTaskProgress(player, 'ash', result.rewardAsh).catch((err) => console.error('[FactionTask] bump error:', err.message));
    persistPlayer(player);

    safeSend(player.ws, {
      type: 'factionQuestClaimed',
      questId: result.questId,
      rewardAsh: result.rewardAsh,
      slotsClaimed: result.slotsClaimed,
      slotsTotal: result.slotsTotal,
      status: result.status,
    });
    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
  }

  function friendErrorMessage(code) {
    switch (code) {
      case 'user_not_found': return 'No player found with that wallet or nickname';
      case 'cannot_friend_self': return "You can't friend yourself";
      case 'already_friends': return 'You are already friends';
      case 'request_already_sent': return 'Friend request already sent';
      case 'request_not_found': return 'That friend request no longer exists';
      default: return 'Friend action failed';
    }
  }

  async function handleFriendRequestSend(player, data) {
    const targetWallet = typeof data.wallet === 'string' && data.wallet.trim() ? data.wallet.trim() : null;
    const targetNickname = typeof data.nickname === 'string' && data.nickname.trim() ? data.nickname.trim() : null;
    if (!targetWallet && !targetNickname) return;

    if (targetWallet) {
      const targetPlayer = walletToPlayer.get(targetWallet);
      if (targetPlayer && targetPlayer.authenticated && targetPlayer.blockedUserIds?.has(player.userId)) {
        safeSend(player.ws, { type: 'error', message: 'This player is not accepting friend requests' });
        return;
      }
    }

    const result = await callInternalApi('/api/internal/game/friends/request', {
      userId: player.userId, gameId: player.gameId, targetWallet, targetNickname,
    }).catch((err) => {
      console.error('[Friends] request error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: friendErrorMessage(result?.error) });
      return;
    }

    safeSend(player.ws, { type: 'friendRequestSent', friend: result.friend, status: result.status });

    if (result.status !== 'accepted') {
      const targetPlayer = userIdToPlayer.get(result.friend.userId);
      if (targetPlayer && targetPlayer.authenticated) {
        safeSend(targetPlayer.ws, {
          type: 'friendRequestReceived',
          friend: { userId: player.userId, wallet: player.wallet, nickname: player.nickname },
        });
      }
    }
  }

  async function handleBlockUser(player, data) {
    const targetWallet = typeof data.wallet === 'string' && data.wallet.trim() ? data.wallet.trim() : null;
    const targetNickname = typeof data.nickname === 'string' && data.nickname.trim() ? data.nickname.trim() : null;
    if (!targetWallet && !targetNickname) return;

    const result = await callInternalApi('/api/internal/game/blocks/add', {
      blockerUserId: player.userId, gameId: player.gameId, targetWallet, targetNickname,
    }).catch((err) => {
      console.error('[Blocks] add error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not block player' });
      return;
    }

    player.blockedUserIds.add(result.blockedUserId);

    safeSend(player.ws, {
      type: 'userBlocked',
      userId: result.blockedUserId,
      wallet: result.blockedWallet,
      nickname: result.blockedNickname,
    });
  }

  async function handleUnblockUser(player, data) {
    if (typeof data.blockedUserId !== 'string' || !data.blockedUserId) return;

    await callInternalApi('/api/internal/game/blocks/remove', {
      blockerUserId: player.userId, blockedUserId: data.blockedUserId,
    }).catch((err) => console.error('[Blocks] remove error:', err.message));

    player.blockedUserIds.delete(data.blockedUserId);

    safeSend(player.ws, { type: 'userUnblocked', blockedUserId: data.blockedUserId });
  }

  async function handleBlockedListRequest(player) {
    const result = await callInternalApi('/api/internal/game/blocks/list', {
      userId: player.userId, gameId: player.gameId,
    }).catch((err) => {
      console.error('[Blocks] list error:', err.message);
      return null;
    });

    safeSend(player.ws, { type: 'blockedListResult', blocked: result?.blocked || [] });
  }

  async function handleFriendRequestAccept(player, data) {
    if (typeof data.requestUserId !== 'string' || !data.requestUserId) return;

    const result = await callInternalApi('/api/internal/game/friends/accept', {
      userId: player.userId, gameId: player.gameId, requestUserId: data.requestUserId,
    }).catch((err) => {
      console.error('[Friends] accept error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: friendErrorMessage(result?.error) });
      return;
    }

    safeSend(player.ws, { type: 'friendRequestAccepted', friend: result.friend });
  }

  async function handleFriendRequestDecline(player, data) {
    if (typeof data.requestUserId !== 'string' || !data.requestUserId) return;

    await callInternalApi('/api/internal/game/friends/decline', {
      userId: player.userId, requestUserId: data.requestUserId,
    }).catch((err) => console.error('[Friends] decline error:', err.message));

    safeSend(player.ws, { type: 'friendRequestDeclined', requestUserId: data.requestUserId });
  }

  async function handleFriendRemove(player, data) {
    if (typeof data.friendUserId !== 'string' || !data.friendUserId) return;

    await callInternalApi('/api/internal/game/friends/remove', {
      userId: player.userId, friendUserId: data.friendUserId,
    }).catch((err) => console.error('[Friends] remove error:', err.message));

    safeSend(player.ws, { type: 'friendRemoved', friendUserId: data.friendUserId });
  }

  async function handleFriendsListRequest(player) {
    const result = await callInternalApi('/api/internal/game/friends/list', {
      userId: player.userId, gameId: player.gameId,
    }).catch((err) => {
      console.error('[Friends] list error:', err.message);
      return null;
    });

    const withPresence = (list) => (list || []).map((f) => ({ ...f, online: userIdToPlayer.has(f.userId) }));

    safeSend(player.ws, {
      type: 'friendsListResult',
      friends: withPresence(result?.friends),
      incoming: result?.incoming || [],
      outgoing: result?.outgoing || [],
    });
  }

  async function handleFriendSearch(player, data) {
    const query = typeof data.query === 'string' ? data.query.trim() : '';
    if (!query) {
      safeSend(player.ws, { type: 'friendSearchResult', results: [] });
      return;
    }

    const result = await callInternalApi('/api/internal/game/friends/search', {
      gameId: player.gameId, userId: player.userId, query,
    }).catch((err) => {
      console.error('[Friends] search error:', err.message);
      return null;
    });

    safeSend(player.ws, { type: 'friendSearchResult', results: result?.results || [] });
  }

  function mailErrorMessage(code) {
    switch (code) {
      case 'recipient_not_found': return 'No player found with that wallet or nickname';
      case 'cannot_mail_self': return "You can't mail yourself";
      case 'invalid_message': return 'Subject and message cannot be empty';
      default: return 'Could not send mail';
    }
  }

  async function handleMailSend(player, data) {
    const recipientWallet = typeof data.wallet === 'string' && data.wallet.trim() ? data.wallet.trim() : null;
    const recipientNickname = typeof data.nickname === 'string' && data.nickname.trim() ? data.nickname.trim() : null;
    if (!recipientWallet && !recipientNickname) return;
    if (typeof data.subject !== 'string' || typeof data.body !== 'string') return;

    const result = await callInternalApi('/api/internal/game/mail/send', {
      userId: player.userId, gameId: player.gameId, wallet: player.wallet,
      recipientWallet, recipientNickname, subject: data.subject.slice(0, 100), body: data.body.slice(0, 2000),
    }).catch((err) => {
      console.error('[Mail] send error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: mailErrorMessage(result?.error) });
      return;
    }

    safeSend(player.ws, { type: 'mailSent', mailId: result.mailId });

    const recipientPlayer = result.recipientUserId ? userIdToPlayer.get(result.recipientUserId) : null;
    if (recipientPlayer && recipientPlayer.authenticated) {
      safeSend(recipientPlayer.ws, {
        type: 'mailReceived',
        mailId: result.mailId,
        senderNickname: player.nickname,
        subject: data.subject,
      });
    }
  }

  async function handlePrivateMessage(player, data) {
    if (isMuted(player)) {
      safeSend(player.ws, { type: 'error', message: `You are muted until ${new Date(player.mutedUntil).toLocaleString()}` });
      return;
    }

    const toWallet = typeof data.toWallet === 'string' && data.toWallet.trim() ? data.toWallet.trim() : null;
    if (!toWallet) return;

    const text = typeof data.text === 'string' ? sanitizeMessage(data.text.trim().slice(0, 500)) : '';
    if (text.length === 0) return;

    if (containsLink(text)) {
      safeSend(player.ws, { type: 'error', message: 'Links are not allowed in chat' });
      return;
    }

    const targetPlayer = walletToPlayer.get(toWallet);
    if (!targetPlayer || !targetPlayer.authenticated) {
      safeSend(player.ws, { type: 'privateMessageError', code: 'offline', toWallet });
      return;
    }

    if (targetPlayer.blockedUserIds?.has(player.userId)) {
      safeSend(player.ws, { type: 'privateMessageError', code: 'blocked', toWallet });
      return;
    }

    const timestamp = Date.now();

    safeSend(targetPlayer.ws, {
      type: 'privateMessage',
      fromWallet: player.wallet,
      fromNickname: player.nickname,
      text,
      timestamp,
    });

    safeSend(player.ws, {
      type: 'privateMessageSent',
      toWallet,
      toNickname: targetPlayer.nickname,
      text,
      timestamp,
    });
  }

  function tradePaymentErrorMessage(code) {
    switch (code) {
      case 'transaction_not_found': return 'Payment not found on-chain yet — wait a few seconds and try again';
      case 'transaction_failed': return 'The transaction failed on-chain';
      case 'transfer_verification_failed': return 'Could not verify the payment amount or recipient';
      case 'wrong_signer': return 'Payment must be sent from your registered wallet';
      case 'signature_already_used': return 'This transaction was already used elsewhere';
      default: return 'Payment verification failed — please try again';
    }
  }

  function handleTradeInvite(player, data) {
    const toWallet = typeof data.toWallet === 'string' && data.toWallet.trim() ? data.toWallet.trim() : null;
    if (!toWallet) return;

    if (toWallet === player.wallet) {
      safeSend(player.ws, { type: 'tradeInviteError', code: 'self', toWallet });
      return;
    }
    if (player.activeTradeId) {
      safeSend(player.ws, { type: 'tradeInviteError', code: 'already_active', toWallet });
      return;
    }

    const target = walletToPlayer.get(toWallet);
    if (!target || !target.authenticated) {
      safeSend(player.ws, { type: 'tradeInviteError', code: 'offline', toWallet });
      return;
    }
    if (target.activeTradeId) {
      safeSend(player.ws, { type: 'tradeInviteError', code: 'target_busy', toWallet });
      return;
    }
    if (target.blockedUserIds?.has(player.userId) || player.blockedUserIds?.has(target.userId)) {
      safeSend(player.ws, { type: 'tradeInviteError', code: 'blocked', toWallet });
      return;
    }

    const tradeId = generateId();
    const session = {
      id: tradeId,
      gameId: player.gameId,
      phase: 'pending_accept',
      inviterUserId: player.userId,
      participants: {
        [player.userId]: { userId: player.userId, wallet: player.wallet, nickname: player.nickname, ready: false },
        [target.userId]: { userId: target.userId, wallet: target.wallet, nickname: target.nickname, ready: false },
      },
      sellerId: null,
      itemId: null,
      itemName: null,
      priceTnj: null,
      createdAt: Date.now(),
      awaitingPaymentSince: null,
    };
    activeTrades.set(tradeId, session);
    player.activeTradeId = tradeId;

    safeSend(player.ws, { type: 'tradeSession', ...buildTradeSnapshot(session) });
    safeSend(target.ws, { type: 'tradeInviteReceived', tradeId, fromWallet: player.wallet, fromNickname: player.nickname });
  }

  function handleTradeInviteRespond(player, data) {
    const tradeId = typeof data.tradeId === 'string' ? data.tradeId : null;
    const session = tradeId ? activeTrades.get(tradeId) : null;
    if (!session || session.phase !== 'pending_accept') return;
    if (!session.participants[player.userId] || player.userId === session.inviterUserId) return;

    if (!data.accept) {
      endTrade(session, 'declined');
      return;
    }

    if (player.activeTradeId) {
      endTrade(session, 'cancelled');
      return;
    }
    const inviter = userIdToPlayer.get(session.inviterUserId);
    if (!inviter || !inviter.authenticated || inviter.activeTradeId !== tradeId) {
      endTrade(session, 'cancelled');
      return;
    }

    session.phase = 'negotiating';
    player.activeTradeId = tradeId;
    broadcastTradeState(session);
  }

  function handleTradeSetOffer(player, data) {
    const tradeId = typeof data.tradeId === 'string' ? data.tradeId : null;
    const session = tradeId ? activeTrades.get(tradeId) : null;
    if (!session || session.phase !== 'negotiating' || !session.participants[player.userId]) return;

    const itemId = typeof data.itemId === 'string' && data.itemId ? data.itemId : null;

    if (!itemId) {
      if (session.sellerId && session.sellerId !== player.userId) return;
      session.sellerId = null;
      session.itemId = null;
      session.itemName = null;
      session.priceTnj = null;
    } else {
      if (session.sellerId && session.sellerId !== player.userId) {
        safeSend(player.ws, { type: 'error', message: 'A seller is already set for this trade' });
        return;
      }
      const item = SHOP_ITEMS[itemId];
      if (!item || !item.tradeable) {
        safeSend(player.ws, { type: 'error', message: 'This item cannot be traded' });
        return;
      }
      if (!(player.placeables[itemId] > 0)) {
        safeSend(player.ws, { type: 'error', message: "You don't own that item" });
        return;
      }
      const priceTnj = Number.isInteger(data.priceTnj) ? data.priceTnj : null;
      if (!priceTnj || priceTnj <= 0 || priceTnj > 1_000_000_000) {
        safeSend(player.ws, { type: 'error', message: 'Invalid price' });
        return;
      }
      session.sellerId = player.userId;
      session.itemId = itemId;
      session.itemName = item.name;
      session.priceTnj = priceTnj;
    }

    for (const p of Object.values(session.participants)) p.ready = false;
    broadcastTradeState(session);
  }

  function handleTradeSetReady(player, data) {
    const tradeId = typeof data.tradeId === 'string' ? data.tradeId : null;
    const session = tradeId ? activeTrades.get(tradeId) : null;
    if (!session || session.phase !== 'negotiating' || !session.participants[player.userId]) return;

    const ready = !!data.ready;
    if (ready && (!session.sellerId || !session.itemId || !session.priceTnj)) {
      safeSend(player.ws, { type: 'error', message: 'Set an item and price before readying up' });
      return;
    }

    session.participants[player.userId].ready = ready;

    const allReady = Object.values(session.participants).every((p) => p.ready);
    if (allReady && session.sellerId) {
      const seller = userIdToPlayer.get(session.sellerId);
      if (!seller || !(seller.placeables[session.itemId] > 0)) {
        for (const p of Object.values(session.participants)) p.ready = false;
        sendToTradeParticipants(session, { type: 'error', message: 'Seller no longer has this item' });
        broadcastTradeState(session);
        return;
      }
      session.phase = 'awaiting_payment';
      session.awaitingPaymentSince = Date.now();
    }

    broadcastTradeState(session);
  }

  function handleTradeCancel(player, data) {
    const tradeId = typeof data.tradeId === 'string' ? data.tradeId : null;
    const session = tradeId ? activeTrades.get(tradeId) : null;
    if (!session || !session.participants[player.userId]) return;
    if (session.phase === 'settling') return;
    endTrade(session, 'cancelled');
  }

  async function handleTradeSubmitPayment(player, data) {
    const tradeId = typeof data.tradeId === 'string' ? data.tradeId : null;
    const signature = typeof data.signature === 'string' && data.signature.trim() ? data.signature.trim() : null;
    const session = tradeId ? activeTrades.get(tradeId) : null;
    if (!session || !signature) return;
    if (session.phase !== 'awaiting_payment') return;
    if (!session.participants[player.userId] || player.userId === session.sellerId) return;

    const sellerEntry = session.participants[session.sellerId];
    session.phase = 'settling';
    broadcastTradeState(session);

    const result = await callInternalApi('/api/internal/game/trade/settle', {
      tradeId: session.id,
      gameId: session.gameId,
      signature,
      sellerId: session.sellerId,
      sellerWallet: sellerEntry.wallet,
      buyerId: player.userId,
      buyerWallet: player.wallet,
      itemId: session.itemId,
      itemName: session.itemName,
      quantity: 1,
      priceTnj: session.priceTnj,
    }).catch((err) => {
      console.error('[Trade] settle call error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      const errorCode = result?.error || 'internal_error';
      if (errorCode === 'settlement_record_failed') {
        console.error('[Trade] CRITICAL: payment verified on-chain but not recorded:', {
          tradeId: session.id, signature, sellerWallet: sellerEntry.wallet, buyerWallet: player.wallet,
        });
        endTrade(session, 'failed', { reason: errorCode, critical: true });
        return;
      }
      session.phase = 'awaiting_payment';
      sendToTradeParticipants(session, { type: 'error', message: tradePaymentErrorMessage(errorCode) });
      broadcastTradeState(session);
      return;
    }

    const seller = userIdToPlayer.get(session.sellerId);
    if (seller) {
      seller.placeables[session.itemId] = Math.max(0, (seller.placeables[session.itemId] || 0) - 1);
      seller.economyChangedAt = Date.now();
      persistPlayer(seller);
      safeSend(seller.ws, { type: 'inventoryUpdate', inventory: seller.inventory, ash: seller.ash, placeables: seller.placeables });
    } else {
      console.error('[Trade] Seller offline at settlement — item not deducted in-memory, needs manual reconciliation:', {
        tradeId: session.id, sellerId: session.sellerId, itemId: session.itemId, dbTradeId: result.tradeId,
      });
    }

    player.placeables[session.itemId] = (player.placeables[session.itemId] || 0) + 1;
    player.economyChangedAt = Date.now();
    persistPlayer(player);
    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });

    endTrade(session, 'completed');
  }

  async function handleTokenInfoRequest(player, data) {
    const ca = typeof data.ca === 'string' && data.ca.trim() ? data.ca.trim() : null;
    if (!ca) return;

    const result = await callInternalApi('/api/internal/game/token-lookup-mail', {
      userId: player.userId, ca,
    }).catch((err) => {
      console.error('[TokenLookup] error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not look up token' });
      return;
    }

    safeSend(player.ws, { type: 'tokenInfoSent', mailId: result.mailId });
  }

  async function handleSupportTicketSend(player, data) {
    const subject = typeof data.subject === 'string' ? data.subject.trim().slice(0, 100) : '';
    const message = typeof data.message === 'string' ? data.message.trim().slice(0, 2000) : '';
    if (subject.length === 0 || message.length === 0) return;

    const result = await callInternalApi('/api/internal/game/support/send', {
      userId: player.userId, gameId: player.gameId, wallet: player.wallet, subject, message,
    }).catch((err) => {
      console.error('[Support] send error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not send message to support' });
      return;
    }

    safeSend(player.ws, { type: 'supportTicketSent', ticketId: result.ticketId });
  }

  async function handleMailInboxRequest(player) {
    const result = await callInternalApi('/api/internal/game/mail/inbox', {
      userId: player.userId, gameId: player.gameId,
    }).catch((err) => {
      console.error('[Mail] inbox error:', err.message);
      return null;
    });

    safeSend(player.ws, {
      type: 'mailInboxResult',
      mail: result?.mail || [],
      unreadCount: result?.unreadCount || 0,
    });
  }

  async function handleMailMarkRead(player, data) {
    if (typeof data.mailId !== 'string' || !data.mailId) return;

    await callInternalApi('/api/internal/game/mail/mark-read', {
      userId: player.userId, mailId: data.mailId,
    }).catch((err) => console.error('[Mail] mark-read error:', err.message));

    safeSend(player.ws, { type: 'mailMarkedRead', mailId: data.mailId });
  }

  function getQuest(questId) {
    return Object.prototype.hasOwnProperty.call(QUESTS, questId) ? QUESTS[questId] : null;
  }

  function getQuestState(player, questId) {
    return player.quests[questId] || { status: 'not_started', progress: 0 };
  }

  function incrementKillQuests(player) {
    for (const quest of Object.values(QUESTS)) {
      if (quest.type !== 'kill_enemies') continue;
      if (quest.locationId && player.locationId !== quest.locationId) continue;

      const state = getQuestState(player, quest.id);
      if (state.status !== 'active') continue;

      state.progress = Math.min(quest.targetCount, state.progress + 1);
      if (state.progress >= quest.targetCount) {
        state.status = 'ready_to_turn_in';
      }
      player.quests[quest.id] = state;
      persistPlayer(player);

      safeSend(player.ws, {
        type: 'questUpdate',
        questId: quest.id,
        status: state.status,
        progress: state.progress,
        targetCount: quest.targetCount,
      });
    }
  }

  function sendCosmeticState(player) {
    safeSend(player.ws, {
      type: 'cosmeticState',
      owned: Array.from(player.cosmeticsOwned || []),
      skinId: player.cosmeticSkinId || null,
      accessoryId: player.cosmeticAccessoryId || null,
    });
  }

  function broadcastCosmeticChange(player) {
    broadcastToLocation(player.locationId, {
      type: 'cosmeticUpdate',
      playerId: player.id,
      skinId: player.cosmeticSkinId || null,
      accessoryId: player.cosmeticAccessoryId || null,
    }, player.id);
  }

  async function refreshPlayerCosmetics(player) {
    const result = await callInternalApi('/api/internal/game/cosmetics/state', {
      userId: player.userId, gameId: player.gameId,
    }).catch((err) => {
      console.error('[Cosmetics] state error:', err.message);
      return null;
    });

    player.cosmeticsOwned = new Set(result?.owned || []);
    player.cosmeticSkinId = result?.skinId || null;
    player.cosmeticAccessoryId = result?.accessoryId || null;
  }

  async function handleCosmeticListRequest(player) {
    await refreshPlayerCosmetics(player);
    sendCosmeticState(player);
  }

  async function handleCosmeticBuy(player, data) {
    const slot = COSMETIC_SLOTS[data.itemId];
    if (!slot) return;

    if (!shopItemEnabled(data.itemId)) {
      safeSend(player.ws, { type: 'error', message: 'That item is not for sale right now' });
      return;
    }

    const cosmeticPrice = shopPriceFor(data.itemId, COSMETIC_PRICE_ASH);

    if (player.cosmeticsOwned?.has(data.itemId)) {
      safeSend(player.ws, { type: 'error', message: 'You already own that' });
      return;
    }
    if (player.ash < cosmeticPrice) {
      safeSend(player.ws, { type: 'error', message: `Not enough Ash — this costs ${cosmeticPrice} Ash` });
      return;
    }

    player.ash -= cosmeticPrice;
    player.economyChangedAt = Date.now();
    persistPlayer(player);
    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });

    const result = await callInternalApi('/api/internal/game/cosmetics/buy', {
      userId: player.userId, gameId: player.gameId, itemId: data.itemId,
    }).catch((err) => {
      console.error('[Cosmetics] buy error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      player.ash += cosmeticPrice;
      player.economyChangedAt = Date.now();
      persistPlayer(player);
      safeSend(player.ws, {
        type: 'error',
        message: result?.error === 'already_owned' ? 'You already own that' : 'Could not buy that right now',
      });
      safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
      return;
    }

    if (!player.cosmeticsOwned) player.cosmeticsOwned = new Set();
    player.cosmeticsOwned.add(data.itemId);
    sendCosmeticState(player);
  }

  async function handleCosmeticEquip(player, data) {
    const wantedSkin = COSMETIC_SLOTS[data.skinId] === 'skin' ? data.skinId : null;
    const wantedAccessory = COSMETIC_SLOTS[data.accessoryId] === 'accessory' ? data.accessoryId : null;

    if (wantedSkin && !player.cosmeticsOwned?.has(wantedSkin)) return;
    if (wantedAccessory && !player.cosmeticsOwned?.has(wantedAccessory)) return;

    const skinId = wantedSkin;
    const accessoryId = skinId ? null : wantedAccessory;

    const result = await callInternalApi('/api/internal/game/cosmetics/equip', {
      userId: player.userId, gameId: player.gameId, skinId, accessoryId,
    }).catch((err) => {
      console.error('[Cosmetics] equip error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not change your outfit right now' });
      return;
    }

    player.cosmeticSkinId = result.skinId || null;
    player.cosmeticAccessoryId = result.accessoryId || null;

    sendCosmeticState(player);
    broadcastCosmeticChange(player);
  }

  function handleEmote(player, data) {
    if (!player.alive) return;
    if (!EMOTE_KEYS.includes(data.key)) return;

    broadcastToLocation(player.locationId, {
      type: 'emote',
      playerId: player.id,
      key: data.key,
    }, player.id);
  }

  function handleQuestInteract(player, data) {
    if (typeof data.questId !== 'string') return;
    const quest = getQuest(data.questId);
    if (!quest) return;

    const state = getQuestState(player, quest.id);
    safeSend(player.ws, {
      type: 'questInfo',
      questId: quest.id,
      npc: quest.npc,
      title: quest.title,
      description: quest.description,
      targetCount: quest.targetCount,
      rewardAsh: quest.rewardAsh,
      status: state.status,
      progress: state.progress,
    });
  }

  function handleQuestAccept(player, data) {
    if (typeof data.questId !== 'string') return;
    const quest = getQuest(data.questId);
    if (!quest) return;

    const state = getQuestState(player, quest.id);
    if (state.status !== 'not_started') return;

    player.quests[quest.id] = { status: 'active', progress: 0 };
    persistPlayer(player);

    safeSend(player.ws, {
      type: 'questUpdate',
      questId: quest.id,
      status: 'active',
      progress: 0,
      targetCount: quest.targetCount,
    });
  }

  function handleQuestTurnIn(player, data) {
    if (typeof data.questId !== 'string') return;
    const quest = getQuest(data.questId);
    if (!quest) return;

    const state = getQuestState(player, quest.id);
    if (state.status !== 'ready_to_turn_in') return;

    player.quests[quest.id] = { status: 'completed', progress: quest.targetCount };
    player.ash += quest.rewardAsh;
    player.economyChangedAt = Date.now();
    bumpFactionTaskProgress(player, 'ash', quest.rewardAsh).catch((err) => console.error('[FactionTask] bump error:', err.message));
    persistPlayer(player);

    safeSend(player.ws, {
      type: 'questUpdate',
      questId: quest.id,
      status: 'completed',
      progress: quest.targetCount,
      targetCount: quest.targetCount,
      rewardAsh: quest.rewardAsh,
    });
    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
  }

  function handleLootPickup(player, data) {
    if (!player.alive) return;
    if (typeof data.id !== 'string') return;
    if (player.locationId !== 'main-world' && player.locationId !== 'tower-first-floor') return;

    const loot = lootDrops.get(data.id);
    if (!loot) return;
    if (loot.ownerId && loot.ownerId !== player.id) return;
    if (!loot.ownerId && player.locationId !== 'main-world') return;

    const [px, , pz] = player.position;
    const dist = Math.sqrt((loot.position[0] - px) ** 2 + (loot.position[2] - pz) ** 2);
    if (dist > LOOT_CONFIG.pickupRadius) return;

    lootDrops.delete(data.id);

    addTokensToInventory(player, loot.tokens);
    persistPlayer(player);

    safeSend(ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });

    if (loot.ownerId) {
      safeSend(ws, { type: 'lootDespawn', id: data.id });
    } else {
      broadcastToLocation('main-world', { type: 'lootDespawn', id: data.id });
    }
  }

  function handleSellToken(player, data) {
    if (!player.alive) return;
    if (typeof data.address !== 'string') return;
    if (player.locationId !== 'tower-main-hall') {
      safeSend(ws, { type: 'error', message: 'You need to be at the vendor in the main hall to sell' });
      return;
    }

    const entry = player.inventory.find((e) => e.address === data.address);
    if (!entry || entry.quantity <= 0) {
      safeSend(ws, { type: 'error', message: 'You no longer have that item' });
      return;
    }

    const requestedQty = Number.isInteger(data.quantity) && data.quantity > 0 ? data.quantity : entry.quantity;
    const sellQty = Math.min(requestedQty, entry.quantity);
    if (sellQty <= 0) return;

    if (!player.sellQueue) player.sellQueue = [];
    if (player.sellQueue.length >= 32) {
      safeSend(ws, { type: 'error', message: 'Too many pending sells, slow down' });
      return;
    }
    player.sellQueue.push({ address: data.address, quantity: sellQty });
    processSellQueue(player);
  }

  async function processSellQueue(player) {
    if (player.sellProcessing) return;
    player.sellProcessing = true;
    try {
      while (player.sellQueue && player.sellQueue.length > 0) {
        const job = player.sellQueue.shift();
        await performSell(player, job);
      }
    } finally {
      player.sellProcessing = false;
    }
  }

  async function performSell(player, job) {
    const current = player.inventory.find((e) => e.address === job.address);
    if (!current || current.quantity <= 0) return;
    const sellQty = Math.min(job.quantity, current.quantity);
    if (sellQty <= 0) return;

    let marketCap = 0;
    try {
      const url = new URL('/api/token-by-ca', CONFIG.siteUrl);
      url.searchParams.set('ca', job.address);
      const res = await fetch(url.toString());
      const json = await res.json();
      marketCap = Number(json?.mc) || 0;
    } catch (err) {
      console.error('[Vendor] Market cap lookup failed:', err.message);
      safeSend(ws, { type: 'error', message: 'Could not price token right now' });
      return;
    }

    const finalEntry = player.inventory.find((e) => e.address === job.address);
    if (!finalEntry || finalEntry.quantity <= 0) return;
    const finalQty = Math.min(sellQty, finalEntry.quantity);

    const ashPerToken = ashForMarketCap(marketCap);
    const ashEarned = ashPerToken * finalQty;

    finalEntry.quantity -= finalQty;
    player.inventory = player.inventory.filter((e) => e.quantity > 0);
    player.ash += ashEarned;
    player.economyChangedAt = Date.now();
    bumpFactionTaskProgress(player, 'ash', ashEarned).catch((err) => console.error('[FactionTask] bump error:', err.message));

    persistPlayer(player);

    safeSend(ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
    safeSend(ws, {
      type: 'sellResult',
      address: job.address,
      quantitySold: finalQty,
      ashEarned,
      marketCap,
    });
  }

  function handleShopBuyItem(player, data) {
    if (!player.alive) return;
    const item = SHOP_ITEMS[data.itemId];
    if (!item) {
      safeSend(player.ws, { type: 'error', message: 'Unknown item' });
      return;
    }

    const owned = player.placeables[item.id] || 0;
    const capRemaining = item.maxOwned - owned;
    if (capRemaining <= 0) {
      safeSend(player.ws, { type: 'error', message: `You already own the maximum of ${item.maxOwned}` });
      return;
    }

    if (!shopItemEnabled(item.id)) {
      safeSend(player.ws, { type: 'error', message: 'That item is not for sale right now' });
      return;
    }

    const unitPrice = shopPriceFor(item.id, item.price);
    const requestedQty = Number.isInteger(data.quantity) && data.quantity > 0 ? data.quantity : 1;
    const affordableQty = unitPrice > 0 ? Math.floor(player.ash / unitPrice) : requestedQty;
    const qty = Math.max(0, Math.min(requestedQty, capRemaining, affordableQty));
    if (qty <= 0) {
      safeSend(player.ws, { type: 'error', message: 'Not enough ash' });
      return;
    }

    player.ash -= unitPrice * qty;
    player.placeables[item.id] = owned + qty;
    player.economyChangedAt = Date.now();
    persistPlayer(player);

    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
  }

  async function handleSignPlace(player, data) {
    if (!player.alive) return;
    if (player.locationId !== 'main-world') {
      safeSend(player.ws, { type: 'error', message: 'Signs can only be placed in the open world' });
      return;
    }
    if (isMuted(player)) {
      safeSend(player.ws, { type: 'error', message: `You are muted until ${new Date(player.mutedUntil).toLocaleString()}` });
      return;
    }
    if (!(player.placeables['sign-on-a-stick'] > 0)) {
      safeSend(player.ws, { type: 'error', message: "You don't own any signs — buy one from the Shop" });
      return;
    }
    if (Array.from(worldSigns.values()).some((s) => s.ownerId === player.userId)) {
      safeSend(player.ws, { type: 'error', message: 'You can only have one sign placed at a time' });
      return;
    }
    if (!isValidPositionForLocation(player.locationId, data.position)) {
      safeSend(player.ws, { type: 'error', message: 'Invalid placement position' });
      return;
    }
    const rotation = typeof data.rotation === 'number' && isFinite(data.rotation) ? data.rotation : 0;

    player.placeables['sign-on-a-stick'] -= 1;

    const result = await callInternalApi('/api/internal/game/signs/create', {
      userId: player.userId, gameId: player.gameId, position: data.position, rotation,
    }).catch((err) => {
      console.error('[Signs] create error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      player.placeables['sign-on-a-stick'] += 1;
      safeSend(player.ws, { type: 'error', message: 'Could not place sign right now' });
      return;
    }

    player.stats.buildingsPlaced += 1;
    player.economyChangedAt = Date.now();
    persistPlayer(player);

    const sign = {
      id: result.id,
      ownerId: player.userId,
      ownerNickname: player.nickname,
      position: data.position,
      rotation,
      contentType: null,
      textContent: null,
      drawingUrl: null,
      createdAt: result.createdAt,
      createdAtMs: Date.now(),
    };
    worldSigns.set(sign.id, sign);

    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
    broadcastToLocation('main-world', { type: 'signSpawn', sign });
  }

  async function handleSignSetText(player, data) {
    const sign = worldSigns.get(data.id);
    if (!sign) return;
    if (sign.ownerId !== player.userId || sign.contentType !== null) {
      safeSend(player.ws, { type: 'error', message: 'You cannot edit this sign' });
      return;
    }
    if (isMuted(player)) {
      safeSend(player.ws, { type: 'error', message: `You are muted until ${new Date(player.mutedUntil).toLocaleString()}` });
      return;
    }
    if (typeof data.text !== 'string') return;

    const text = sanitizeMessage(data.text.trim().slice(0, 150));
    if (text.length === 0) return;
    if (containsLink(text)) {
      safeSend(player.ws, { type: 'error', message: 'Links are not allowed on signs' });
      return;
    }

    const result = await callInternalApi('/api/internal/game/signs/set-content', {
      signId: sign.id, userId: player.userId, contentType: 'text', textContent: text,
    }).catch((err) => {
      console.error('[Signs] set-content error:', err.message);
      return null;
    });
    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not save sign right now' });
      return;
    }

    sign.contentType = 'text';
    sign.textContent = text;
    broadcastToLocation('main-world', { type: 'signContentSet', id: sign.id, contentType: 'text', textContent: text });
  }

  async function handleSignSetDrawingUrl(player, data) {
    const sign = worldSigns.get(data.id);
    if (!sign) return;
    if (sign.ownerId !== player.userId || sign.contentType !== null) {
      safeSend(player.ws, { type: 'error', message: 'You cannot edit this sign' });
      return;
    }
    if (typeof data.url !== 'string' || !data.url.startsWith('https://') || data.url.length > 512) {
      safeSend(player.ws, { type: 'error', message: 'Invalid drawing' });
      return;
    }

    const result = await callInternalApi('/api/internal/game/signs/set-content', {
      signId: sign.id, userId: player.userId, contentType: 'draw', drawingUrl: data.url,
    }).catch((err) => {
      console.error('[Signs] set-content error:', err.message);
      return null;
    });
    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not save sign right now' });
      return;
    }

    sign.contentType = 'draw';
    sign.drawingUrl = data.url;
    broadcastToLocation('main-world', { type: 'signContentSet', id: sign.id, contentType: 'draw', drawingUrl: data.url });
  }

  async function handleSignRemove(player, data) {
    const sign = worldSigns.get(data.id);
    if (!sign) return;
    if (sign.ownerId !== player.userId) {
      safeSend(player.ws, { type: 'error', message: 'You can only remove your own sign' });
      return;
    }

    const removed = await deleteSign(sign);
    if (!removed) {
      safeSend(player.ws, { type: 'error', message: 'Could not remove sign right now' });
      return;
    }
  }

  async function handlePlaceItem(player, data) {
    if (!player.alive) return;
    const item = FURNITURE_ITEMS[data.itemId];
    if (!item) return;

    const roomFactionId = roomFactionIdFor(player);
    if (!roomFactionId) {
      safeSend(player.ws, { type: 'error', message: 'This can only be placed in a faction room' });
      return;
    }
    if (!player.factions?.some((f) => f.id === roomFactionId)) {
      safeSend(player.ws, { type: 'error', message: "You can only place furniture in your own faction's room" });
      return;
    }
    if (isMuted(player)) {
      safeSend(player.ws, { type: 'error', message: `You are muted until ${new Date(player.mutedUntil).toLocaleString()}` });
      return;
    }
    if (!Array.isArray(data.position) || data.position.length !== 3) return;
    if (!isValidPositionForLocation(player.locationId, data.position)) {
      safeSend(player.ws, { type: 'error', message: 'Invalid placement position' });
      return;
    }
    const rotation = typeof data.rotation === 'number' && isFinite(data.rotation) ? data.rotation : 0;

    await ensureFurnitureLoaded(roomFactionId);
    const roomItems = worldFurniture.get(roomFactionId) || new Map();
    const ownedOfType = Array.from(roomItems.values()).filter((f) => f.ownerId === player.userId && f.itemId === data.itemId).length;
    if (ownedOfType >= item.maxOwned) {
      safeSend(player.ws, { type: 'error', message: `You can only place ${item.maxOwned} of this here` });
      return;
    }

    if (item.price > 0) {
      if (!(player.placeables[data.itemId] > 0)) {
        safeSend(player.ws, { type: 'error', message: "You don't own any of that — buy one from the Shop" });
        return;
      }
      player.placeables[data.itemId] -= 1;
    }

    const result = await callInternalApi('/api/internal/game/furniture/create', {
      userId: player.userId, gameId: player.gameId, factionId: roomFactionId, itemId: data.itemId, position: data.position, rotation,
    }).catch((err) => {
      console.error('[Furniture] create error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      if (item.price > 0) player.placeables[data.itemId] += 1;
      safeSend(player.ws, { type: 'error', message: 'Could not place item right now' });
      return;
    }

    player.stats.buildingsPlaced += 1;
    player.economyChangedAt = Date.now();
    persistPlayer(player);

    const furnitureItem = {
      id: result.id,
      itemId: data.itemId,
      ownerId: player.userId,
      ownerNickname: player.nickname,
      factionId: roomFactionId,
      position: data.position,
      rotation,
      contentType: null,
      textContent: null,
      drawingUrl: null,
      createdAt: result.createdAt,
    };
    if (!worldFurniture.has(roomFactionId)) worldFurniture.set(roomFactionId, new Map());
    worldFurniture.get(roomFactionId).set(furnitureItem.id, furnitureItem);

    if (item.price > 0) {
      safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
    }
    broadcastToLocation(player.locationId, { type: 'furnitureSpawn', item: furnitureItem });
  }

  async function handleItemSetText(player, data) {
    const roomFactionId = roomFactionIdFor(player);
    if (!roomFactionId) return;
    const item = worldFurniture.get(roomFactionId)?.get(data.id);
    if (!item) return;
    if (item.ownerId !== player.userId) {
      safeSend(player.ws, { type: 'error', message: 'You cannot edit this item' });
      return;
    }
    if (isMuted(player)) {
      safeSend(player.ws, { type: 'error', message: `You are muted until ${new Date(player.mutedUntil).toLocaleString()}` });
      return;
    }
    if (typeof data.text !== 'string') return;

    const text = sanitizeMessage(data.text.trim().slice(0, 150));
    if (text.length === 0) return;
    if (containsLink(text)) {
      safeSend(player.ws, { type: 'error', message: 'Links are not allowed' });
      return;
    }

    const result = await callInternalApi('/api/internal/game/furniture/set-content', {
      itemId: item.id, userId: player.userId, contentType: 'text', textContent: text,
    }).catch((err) => {
      console.error('[Furniture] set-content error:', err.message);
      return null;
    });
    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not save item right now' });
      return;
    }

    item.contentType = 'text';
    item.textContent = text;
    broadcastToLocation(player.locationId, { type: 'furnitureContentSet', id: item.id, contentType: 'text', textContent: text });
  }

  async function handleItemSetDrawingUrl(player, data) {
    const roomFactionId = roomFactionIdFor(player);
    if (!roomFactionId) return;
    const item = worldFurniture.get(roomFactionId)?.get(data.id);
    if (!item) return;
    if (item.ownerId !== player.userId) {
      safeSend(player.ws, { type: 'error', message: 'You cannot edit this item' });
      return;
    }
    if (typeof data.url !== 'string' || !data.url.startsWith('https://') || data.url.length > 512) {
      safeSend(player.ws, { type: 'error', message: 'Invalid drawing' });
      return;
    }

    const result = await callInternalApi('/api/internal/game/furniture/set-content', {
      itemId: item.id, userId: player.userId, contentType: 'draw', drawingUrl: data.url,
    }).catch((err) => {
      console.error('[Furniture] set-content error:', err.message);
      return null;
    });
    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not save item right now' });
      return;
    }

    item.contentType = 'draw';
    item.drawingUrl = data.url;
    broadcastToLocation(player.locationId, { type: 'furnitureContentSet', id: item.id, contentType: 'draw', drawingUrl: data.url });
  }

  async function handleItemRemove(player, data) {
    const roomFactionId = roomFactionIdFor(player);
    if (!roomFactionId) return;
    const roomItems = worldFurniture.get(roomFactionId);
    const item = roomItems?.get(data.id);
    if (!item) return;
    if (item.ownerId !== player.userId) {
      safeSend(player.ws, { type: 'error', message: 'You can only remove your own item' });
      return;
    }

    const result = await callInternalApi('/api/internal/game/furniture/delete', {
      itemId: item.id, userId: item.ownerId,
    }).catch((err) => {
      console.error('[Furniture] delete error:', err.message);
      return null;
    });
    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not remove item right now' });
      return;
    }

    roomItems.delete(item.id);
    broadcastToLocation(player.locationId, { type: 'furnitureDespawn', id: item.id });
  }

  function handleSaveProgress(player) {
    persistPlayer(player);
  }

  async function handleLocationChange(player, data) {
    if (!player.alive) return;
    if (typeof data.locationId !== 'string') return;

    if (!isKnownLocationId(data.locationId)) {
      console.log(`[!] Invalid location: ${data.locationId} from ${player.id}`);
      return;
    }

    if (SEALED_LOCATIONS.has(data.locationId)) {
      safeSend(player.ws, { type: 'error', message: 'That place is sealed for now.' });
      return;
    }

    const oldLocation = player.locationId;
    if (oldLocation === data.locationId) {
      if (!isShardedLocation(oldLocation)) return;
      const requested = Number.isInteger(data.instance) ? data.instance : null;
      if (requested === null || requested === player.instance) return;

      const target = pickShard(oldLocation, requested);
      if (target === player.instance) return;

      for (const id of player.aoiNeighbors) {
        const other = players.get(id);
        safeSend(player.ws, { type: 'playerLeave', playerId: id });
        if (other) {
          safeSend(other.ws, { type: 'playerLeave', playerId: player.id });
          other.aoiNeighbors.delete(player.id);
        }
      }
      player.aoiNeighbors.clear();

      player.instance = target;
      spawnInSafeZone(player, oldLocation);
      player.justTeleported = true;
      grantSpawnProtection(player);
      player.positionHistory = [];
      player.recentShots = [];

      safeSend(player.ws, { type: 'shardTeleport', position: player.position, instance: target });
      recomputeAOI(player);
      broadcastShardState(oldLocation);
      return;
    }

    const now = Date.now();
    const sinceLast = now - player.lastLocationChangeAt;
    if (sinceLast < MIN_LOCATION_CHANGE_INTERVAL_MS) {
      if (player.pendingLocationChange) clearTimeout(player.pendingLocationChange);
      player.pendingLocationChange = setTimeout(() => {
        player.pendingLocationChange = null;
        if (player.authenticated) handleLocationChange(player, data);
      }, MIN_LOCATION_CHANGE_INTERVAL_MS - sinceLast);
      return;
    }
    if (player.pendingLocationChange) {
      clearTimeout(player.pendingLocationChange);
      player.pendingLocationChange = null;
    }
    player.lastLocationChangeAt = now;

    if (data.locationId.startsWith(PLAYER_ROOM_PREFIX) || data.locationId.startsWith(FACTION_ROOM_PREFIX)) {
      const verdict = await callInternalApi('/api/internal/game/room/can-enter', {
        userId: player.userId,
        locationId: data.locationId,
      }).catch((err) => {
        console.error('[RoomAccess] check error:', err.message);
        return null;
      });

      if (!verdict || verdict.allowed !== true) {
        safeSend(player.ws, {
          type: 'error',
          message: verdict?.reason || 'You cannot enter that room.',
        });
        return;
      }
    }

    if (oldLocation === 'tower-first-floor' && player.canyon) {
      player.canyon.enemies.clear();
      player.canyon.pendingSegment = null;
      clearCanyonLoot(player);
    }

    const previousInstance = player.instance;
    player.locationId = data.locationId;
    player.instance = isShardedLocation(data.locationId)
      ? pickShard(data.locationId, Number.isInteger(data.instance) ? data.instance : null)
      : 1;

    if (player.locationId === 'tower-main-hall' && player.weaponEquipped) {
      player.weaponEquipped = false;
      safeSend(ws, { type: 'weaponForceUnequip' });
    }

    spawnInSafeZone(player, data.locationId);
    player.justTeleported = true;
    grantSpawnProtection(player);
    player.positionHistory = [];
    player.recentShots = [];

    setPlayerLoading(player);
    notifyLocationTransition(player, oldLocation, data.locationId);

    if (isShardedLocation(oldLocation) && oldLocation !== data.locationId) {
      broadcastShardState(oldLocation);
    }
    if (isShardedLocation(data.locationId)) {
      broadcastShardState(data.locationId);
    } else if (isShardedLocation(oldLocation) && oldLocation === data.locationId && previousInstance !== player.instance) {
      broadcastShardState(oldLocation);
    }

    if (data.locationId === 'main-world') {
      safeSend(ws, { type: 'lootState', loot: serializeLoot() });
      await ensureSignsLoaded(player.gameId);
      safeSend(ws, { type: 'signState', signs: serializeSigns() });
    }

    if (data.locationId === 'tower-first-floor' && player.canyon) {
      enterCanyonHub(player);
    }

    if (data.locationId === GALAXY_LOCATION_ID) {
      safeSend(ws, { type: 'factionGatesState', gates: displayedFactionGatesList, accountCount });
    }

    if (data.locationId.startsWith(FACTION_ROOM_PREFIX)) {
      const newRoomFactionId = data.locationId.slice(FACTION_ROOM_PREFIX.length);
      await ensureFurnitureLoaded(newRoomFactionId);
      safeSend(ws, { type: 'furnitureState', items: serializeFurnitureForRoom(newRoomFactionId) });
    }
  }
});

function broadcast(data, excludeId = null, useAOI = false, senderPlayer = null, applyBlockFilter = false) {
  const message = getCachedMessage(data);
  players.forEach((p, id) => {
    if (id === excludeId) return;
    if (!p.authenticated || p.ws.readyState !== WebSocket.OPEN) return;

    if (useAOI && senderPlayer) {
      if (!isInAOI(senderPlayer, p)) return;
    }

    if (applyBlockFilter && senderPlayer && senderPlayer.userId && p.blockedUserIds?.has(senderPlayer.userId)) return;

    try {
      p.ws.send(message);
    } catch (err) {
      console.error('[!] Broadcast error:', err.message);
    }
  });
}

function broadcastCount() {
  const count = Array.from(players.values()).filter(p => p.authenticated).length;
  const msg = getCachedMessage({ type: 'count', count });
  players.forEach((p) => {
    if (p.authenticated && p.ws.readyState === WebSocket.OPEN) {
      try {
        p.ws.send(msg);
      } catch (err) { }
    }
  });
}

function shutdown(signal) {
  console.log(`\n[!] ${signal} received. Shutting down gracefully...`);

  const savePromises = [];
  players.forEach((player) => {
    if (player.authenticated && CONFIG.internalSecret) {
      savePromises.push(queuePlayerSave(player, buildSavePayload(player)));
    }
  });

  Promise.all(savePromises).finally(() => {
    const msg = getCachedMessage({ type: 'serverShutdown', reason: 'Server restarting' });
    players.forEach((p) => {
      try {
        p.ws.send(msg);
        p.ws.close(1001, 'Server shutdown');
      } catch (err) { }
    });

    setTimeout(() => {
      wss.close(() => {
        server.close(() => {
          console.log('[✓] Shutdown complete');
          process.exit(0);
        });
      });
    }, 2000);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('[!] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[!] Unhandled rejection:', reason);
});

server.listen(PORT, () => {
  console.log(`[TANJO] Game server running on port ${PORT}`);
  console.log(`[TANJO] Health check: http://localhost:${PORT}/health`);
  console.log(`[TANJO] Site URL: ${CONFIG.siteUrl}`);
  console.log(`[TANJO] Persistence: ${CONFIG.internalSecret ? 'enabled' : 'DISABLED'}`);
  console.log(`[TANJO] AoI: ${CONFIG.world.zoneSize}m zones, radius ${CONFIG.world.aoiRadius}`);
});