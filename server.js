// server.js
require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const PORT = process.env.PORT || 3001;
const MAX_PLAYERS = 100;

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
    maxMessageSize: 16 * 1024,
    chatRateLimit: 3,
    updateRateLimit: 25,
    shootRateLimit: 10,
    hitRateLimit: 15,
    sellRateLimit: 20,
    locationChangeRateLimit: 10,
    nicknameChangeRateLimit: 3,
    saveProgressRateLimit: 5,
    questRateLimit: 10,
    canyonRateLimit: 10,
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
const CANYON_HUB_POSITION = [0, 0, 40];

function canyonSegmentStartZ(segment) {
  return CANYON_START_Z + (segment - 1) * CANYON_SEGMENT_LENGTH;
}

function canyonSegmentName(segment) {
  return segment === 1 ? 'Slime Valley' : `Slime Valley — Segment ${segment}`;
}

const ENEMY_TYPES = {
  slime: {
    name: 'Slime',
    maxHealth: 100,
    attackDamage: 10,
    attackRange: 1.5,
    aggroRadius: 20,
    aggroLeash: 150,
    attackCooldown: 1000,
    chaseSpeedNear: 5,
    chaseSpeedFar: 17.5,
    chaseNearThreshold: 10,
    patrolSpeed: 1.8,
    patrolRadius: 18,
    scale: 1,
    lootMin: 1,
    lootMax: 3,
  },
  slime_boss: {
    name: 'Slime Boss',
    maxHealth: 600,
    attackDamage: 25,
    attackRange: 2.5,
    aggroRadius: 30,
    aggroLeash: 180,
    attackCooldown: 1200,
    chaseSpeedNear: 4,
    chaseSpeedFar: 10,
    chaseNearThreshold: 12,
    patrolSpeed: 1.2,
    patrolRadius: 10,
    scale: 3,
    lootMin: 10,
    lootMax: 20,
  },
};

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
const rateLimits = new Map();

const VALID_STATES = new Set(['idle', 'walk', 'sprint', 'jump']);
const VALID_LOCATIONS = new Set([
  'main-world',
  'cave',
  'tower-main-hall',
  'tower-first-floor',
  'tower-token-gates',
  'tower-basement',
  'open-world-canyon',
  ...Array.from({ length: 39 }, (_, i) => `canyon-token-${String(i + 1).padStart(2, '0')}`),
]);

const LOCATION_MAX_RADIUS = {
  'tower-main-hall': 140,
  'tower-token-gates': 70,
  'tower-basement': 70,
  cave: 180,
  'open-world-canyon': 150,
};
const MIN_LOCATION_CHANGE_INTERVAL_MS = 1000;
const TELEPORT_SETTLE_TOLERANCE = 20;

function getLocationMaxRadius(locationId) {
  if (LOCATION_MAX_RADIUS[locationId] != null) return LOCATION_MAX_RADIUS[locationId];
  if (locationId.startsWith('canyon-token-')) return 150;
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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\x00/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
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
    !isFinite(x) || !isFinite(y) || !isFinite(z) ||
    y < -30 || y > 50
  ) {
    return false;
  }

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
    return distance <= TELEPORT_SETTLE_TOLERANCE;
  }

  const seconds = deltaTimeMs / 1000;
  const speed = distance / seconds;
  return speed <= CONFIG.world.maxSpeed * 1.5;
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

  if (player.locationId === 'tower-first-floor') {
    return !!(player.canyon && other.canyon && player.canyon.inHub && other.canyon.inHub);
  }

  const pZone = getPlayerZone(player);
  const oZone = getPlayerZone(other);
  const dx = Math.abs(pZone.zoneX - oZone.zoneX);
  const dz = Math.abs(pZone.zoneZ - oZone.zoneZ);
  return dx <= CONFIG.world.aoiRadius && dz <= CONFIG.world.aoiRadius;
}

function spawnInSafeZone(player) {
  const angle = Math.random() * Math.PI * 2;
  const r = 10 + Math.random() * 15;
  player.position = [Math.cos(angle) * r, 0, Math.sin(angle) * r];
}

function broadcastToLocation(locationId, data, excludeId = null) {
  const message = getCachedMessage(data);
  players.forEach((p, id) => {
    if (id === excludeId) return;
    if (!p.authenticated || p.ws.readyState !== WebSocket.OPEN) return;
    if (p.locationId !== locationId) return;
    try {
      p.ws.send(message);
    } catch (err) {
      console.error('[!] Broadcast error:', err.message);
    }
  });
}

function getSegmentDifficulty(segment) {
  const healthMult = 1 + (segment - 1) * 0.2;
  const damageMult = 1 + (segment - 1) * 0.15;
  const slimeCount = Math.min(10 + (segment - 1) * 2, 24);
  return { healthMult, damageMult, slimeCount };
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

  const { healthMult, damageMult, slimeCount } = getSegmentDifficulty(segment);
  for (let i = 0; i < slimeCount; i++) {
    spawnCanyonEnemy(player, 'slime', randomCanyonCombatPoint(segment), healthMult, damageMult);
  }
  spawnCanyonEnemy(player, 'slime_boss', randomCanyonBossPoint(segment), healthMult, damageMult);
}

function populateCanyonSegment(player, segment) {
  player.canyon.inHub = false;
  preparePlayerEnemiesForSegment(player, segment);
  player.position = canyonSegmentEntrancePosition(segment);
  player.justTeleported = true;

  safeSend(player.ws, {
    type: 'canyonSegment',
    segment,
    maxSegmentReached: player.canyon.maxSegmentReached,
    cleared: player.canyon.clearedSegments.has(segment),
    name: canyonSegmentName(segment),
  });
  safeSend(player.ws, { type: 'enemyState', enemies: serializeCanyonEnemies(player) });
}

function enterCanyonHub(player) {
  player.canyon.inHub = true;
  player.canyon.enemies.clear();
  clearCanyonLoot(player);
  player.position = [...CANYON_HUB_POSITION];
  player.justTeleported = true;

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

function killPlayerAndRespawn(target, killerId, position, respawnDelayMs = 3000) {
  target.alive = false;
  target.stats.deaths++;

  broadcast({
    type: 'playerDeath',
    playerId: target.id,
    killerId,
    position,
  }, null, true, target);

  const respawnToken = Date.now() + Math.random();
  target.respawnToken = respawnToken;

  setTimeout(() => {
    if (target.respawnToken !== respawnToken) return;
    if (target.ws.readyState !== WebSocket.OPEN) return;
    if (!target.alive) {
      target.health = target.maxHealth;
      target.alive = true;
      if (target.locationId === 'tower-first-floor' && target.canyon) {
        enterCanyonHub(target);
      } else {
        spawnInSafeZone(target);
      }
      target.justTeleported = true;
      target.respawnToken = null;

      safeSend(target.ws, {
        type: 'respawn',
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
  }, respawnDelayMs);
}

function damagePlayerByCanyonEnemy(player, enemy) {
  if (!player.alive) return;

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
    killPlayerAndRespawn(player, enemy.id, player.position);
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
        quests: player.quests,
        canyonProgress: {
          maxSegmentReached: player.canyon.maxSegmentReached,
          clearedSegments: Array.from(player.canyon.clearedSegments),
        },
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
      playtimeSeconds: Math.floor((Date.now() - player.sessionStart) / 1000),
      kills: player.stats.kills,
      deaths: player.stats.deaths,
      shotsFired: player.stats.shotsFired,
      buildingsPlaced: player.stats.buildingsPlaced,
    },
  };
}

function persistPlayer(player) {
  if (!CONFIG.internalSecret) return;
  savePlayerProgress(player.userId, player.gameId, buildSavePayload(player))
    .catch((err) => console.error(`[Save] Error for ${player.id}:`, err.message));
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
    respawnToken: null,
    inventory: [],
    ash: 0,
    quests: {},
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
    },
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
      } else if (data.type === 'locationChange') {
        if (!checkRateLimit(playerId, 'locationChange', CONFIG.network.locationChangeRateLimit)) return;
      } else if (data.type === 'nicknameChange') {
        if (!checkRateLimit(playerId, 'nicknameChange', CONFIG.network.nicknameChangeRateLimit)) return;
      } else if (data.type === 'saveProgress') {
        if (!checkRateLimit(playerId, 'saveProgress', CONFIG.network.saveProgressRateLimit)) return;
      } else if (data.type === 'questInteract' || data.type === 'questAccept' || data.type === 'questTurnIn') {
        if (!checkRateLimit(playerId, 'quest', CONFIG.network.questRateLimit)) return;
      } else if (data.type === 'canyonWarp' || data.type === 'canyonMapRequest' || data.type === 'canyonEnterDungeon' || data.type === 'canyonReturnToHub' || data.type === 'canyonCrossThreshold') {
        if (!checkRateLimit(playerId, 'canyon', CONFIG.network.canyonRateLimit)) return;
      }

      switch (data.type) {
        case 'playerUpdate': handlePlayerUpdate(player, data); break;
        case 'shoot': handleShoot(player, data); break;
        case 'nicknameChange': handleNicknameChange(player, data); break;
        case 'chat': handleChat(player, data); break;
        case 'hit': handleHit(player, data); break;
        case 'enemyHit': handleEnemyHit(player, data); break;
        case 'lootPickup': handleLootPickup(player, data); break;
        case 'sellToken': handleSellToken(player, data); break;
        case 'saveProgress': handleSaveProgress(player); break;
        case 'locationChange': handleLocationChange(player, data); break;
        case 'questInteract': handleQuestInteract(player, data); break;
        case 'questAccept': handleQuestAccept(player, data); break;
        case 'questTurnIn': handleQuestTurnIn(player, data); break;
        case 'canyonWarp': handleCanyonWarp(player, data); break;
        case 'canyonMapRequest': handleCanyonMapRequest(player); break;
        case 'canyonEnterDungeon': handleCanyonEnterDungeon(player); break;
        case 'canyonReturnToHub': handleCanyonReturnToHub(player); break;
        case 'canyonCrossThreshold': handleCanyonCrossThreshold(player); break;
      }
    } catch (error) {
      console.error('[!] Message parse error:', error.message);
    }
  });

  ws.on('close', () => {
    clearTimeout(player.authTimeout);

    if (player.authenticated) {
      persistPlayer(player);
    }

    if (player.userId && userIdToPlayer.get(player.userId) === player) {
      userIdToPlayer.delete(player.userId);
    }

    players.delete(playerId);
    console.log(`[-] Player left: ${playerId} (${player.userId || 'unauth'}). Total: ${players.size}`);

    if (player.authenticated) {
      broadcast({ type: 'playerLeave', playerId }, playerId, true, player);
      broadcastCount();
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
      existingOwner.authenticated = false;
      safeSend(existingOwner.ws, { type: 'auth_error', error: 'duplicate_session' });
      try { existingOwner.ws.close(4009, 'duplicate_session'); } catch (e) { }
      if (players.get(existingOwner.id) === existingOwner) {
        players.delete(existingOwner.id);
        broadcast({ type: 'playerLeave', playerId: existingOwner.id }, existingOwner.id, true, existingOwner);
      }
    }
    userIdToPlayer.set(verifyResult.userId, player);

    player.userId = verifyResult.userId;
    player.wallet = verifyResult.wallet;
    player.gameId = verifyResult.gameId;
    player.gameSlug = verifyResult.gameSlug;
    player.authenticated = true;

    clearTimeout(player.authTimeout);

    const savedProgress = await loadPlayerProgress(player.userId, player.gameId);

    if (savedProgress) {
      if (savedProgress.nickname) {
        player.nickname = savedProgress.nickname;
      } else {
        player.nickname = generateUniqueNickname(`Player_${player.wallet.slice(0, 4)}`);
      }

      if (savedProgress.progress) {
        player.position = savedProgress.progress.position || [0, 0, 0];
        player.rotation = savedProgress.progress.rotation || 0;
        player.health = savedProgress.progress.health || 100;
        player.locationId = VALID_LOCATIONS.has(savedProgress.progress.locationId)
          ? savedProgress.progress.locationId
          : 'tower-main-hall';
      } else {
        spawnInSafeZone(player);
      }

      if (savedProgress.statistics) {
        player.stats.kills = savedProgress.statistics.kills || 0;
        player.stats.deaths = savedProgress.statistics.deaths || 0;
        player.stats.shotsFired = savedProgress.statistics.shotsFired || 0;
        player.stats.buildingsPlaced = savedProgress.statistics.buildingsPlaced || 0;
      }

      player.ash = Math.max(0, Math.floor(Number(savedProgress.progress?.data?.ash) || 0));

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
      player.nickname = generateUniqueNickname(`Player_${player.wallet.slice(0, 4)}`);
      spawnInSafeZone(player);
    }

    player.justSpawned = true;
    players.set(playerId, player);

    console.log(`[+] Authenticated: ${playerId} (${player.userId}, ${player.nickname}, loc:${player.locationId}). Total: ${players.size}`);

    const existingPlayers = [];
    players.forEach((p, id) => {
      if (id !== playerId && p.authenticated) {
        if (isInAOI(player, p)) {
          existingPlayers.push({
            type: 'playerJoin',
            id: p.id,
            nickname: p.nickname,
            position: p.position,
            rotation: p.rotation,
            pitch: p.pitch,
            state: p.state || 'idle',
            jumping: p.jumping || false,
            velocityY: p.velocityY || 0,
            health: p.health,
            alive: p.alive,
            locationId: p.locationId,
          });
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
    });

    safeSend(ws, {
      type: 'init',
      playerId,
      players: existingPlayers,
      count: Array.from(players.values()).filter((p) => p.authenticated).length,
      spawnPosition: player.position,
    });

    if (player.locationId === 'main-world') {
      safeSend(ws, { type: 'lootState', loot: serializeLoot() });
    }

    if (player.locationId === 'tower-first-floor') {
      enterCanyonHub(player);
    }

    safeSend(ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash });

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

    broadcast({
      type: 'playerJoin',
      id: playerId,
      nickname: player.nickname,
      position: player.position,
      rotation: player.rotation,
      pitch: 0,
      state: 'idle',
      jumping: false,
      velocityY: 0,
      health: player.health,
      alive: player.alive,
      locationId: player.locationId,
    }, playerId, true, player);

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
    player.weaponEquipped = data.weaponEquipped !== false;
    player.isShooting = !!data.isShooting;
    player.lastUpdate = now;

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

    if (oy < 0 || oy > 5) {
      console.log(`[!] Shoot hack: invalid origin Y=${oy.toFixed(2)}`);
      return;
    }

    const dirLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dirLength < 0.001) return;
    const direction = [dx / dirLength, dy / dirLength, dz / dirLength];

    if (player.locationId === 'tower-main-hall') {
      safeSend(ws, { type: 'error', message: 'Cannot shoot in safe zone' });
      return;
    }

    player.weaponAmmo--;
    player.lastShotAt = now;
    if (player.weaponAmmo <= 0) player.ammoEmptyAt = now;

    player.stats.shotsFired++;

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

  function handleNicknameChange(player, data) {
    if (typeof data.nickname !== 'string') return;
    const newNick = data.nickname.trim().slice(0, 30);
    if (newNick.length === 0) return;

    const existing = Array.from(players.values())
      .filter(p => p.id !== playerId && p.authenticated)
      .map(p => p.nickname);

    player.nickname = existing.includes(newNick) ? generateUniqueNickname(newNick) : newNick;

    broadcast({
      type: 'nicknameChange',
      id: playerId,
      nickname: player.nickname,
    }, playerId, true, player);

    safeSend(ws, { type: 'nicknameChanged', nickname: player.nickname });
  }

  function handleChat(player, data) {
    if (typeof data.message !== 'string') return;

    const msg = sanitizeMessage(data.message.trim().slice(0, 200));
    if (msg.length === 0) return;

    broadcast({
      type: 'chat',
      id: generateId(),
      sender: player.nickname,
      message: msg,
      timestamp: Date.now(),
    }, null, false);
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

    if (player.locationId === 'tower-main-hall') {
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
      killPlayerAndRespawn(target, playerId, historicalPos);
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
    persistPlayer(player);

    safeSend(player.ws, {
      type: 'questUpdate',
      questId: quest.id,
      status: 'completed',
      progress: quest.targetCount,
      targetCount: quest.targetCount,
      rewardAsh: quest.rewardAsh,
    });
    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash });
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

    safeSend(ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash });

    if (loot.ownerId) {
      safeSend(ws, { type: 'lootDespawn', id: data.id });
    } else {
      broadcastToLocation('main-world', { type: 'lootDespawn', id: data.id });
    }
  }

  async function handleSellToken(player, data) {
    if (!player.alive) return;
    if (typeof data.address !== 'string') return;
    if (player.locationId !== 'tower-main-hall') {
      safeSend(ws, { type: 'error', message: 'You need to be at the vendor in the main hall to sell' });
      return;
    }

    if (player.sellInFlight) {
      safeSend(ws, { type: 'error', message: 'A sell is already in progress' });
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

    player.sellInFlight = true;
    try {
      let marketCap = 0;
      try {
        const url = new URL('/api/token-by-ca', CONFIG.siteUrl);
        url.searchParams.set('ca', data.address);
        const res = await fetch(url.toString());
        const json = await res.json();
        marketCap = Number(json?.mc) || 0;
      } catch (err) {
        console.error('[Vendor] Market cap lookup failed:', err.message);
        safeSend(ws, { type: 'error', message: 'Could not price token right now' });
        return;
      }

      const current = player.inventory.find((e) => e.address === data.address);
      if (!current || current.quantity <= 0) return;
      const finalQty = Math.min(sellQty, current.quantity);

      const ashPerToken = ashForMarketCap(marketCap);
      const ashEarned = ashPerToken * finalQty;

      current.quantity -= finalQty;
      player.inventory = player.inventory.filter((e) => e.quantity > 0);
      player.ash += ashEarned;

      persistPlayer(player);

      safeSend(ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash });
      safeSend(ws, {
        type: 'sellResult',
        address: data.address,
        quantitySold: finalQty,
        ashEarned,
        marketCap,
      });
    } finally {
      player.sellInFlight = false;
    }
  }

  function handleSaveProgress(player) {
    persistPlayer(player);
  }

  function handleLocationChange(player, data) {
    if (!player.alive) return;
    if (typeof data.locationId !== 'string') return;

    if (!VALID_LOCATIONS.has(data.locationId)) {
      console.log(`[!] Invalid location: ${data.locationId} from ${player.id}`);
      return;
    }

    const oldLocation = player.locationId;
    if (oldLocation === data.locationId) return;

    const now = Date.now();
    if (now - player.lastLocationChangeAt < MIN_LOCATION_CHANGE_INTERVAL_MS) {
      return;
    }
    player.lastLocationChangeAt = now;

    if (oldLocation === 'tower-first-floor' && player.canyon) {
      player.canyon.enemies.clear();
      player.canyon.pendingSegment = null;
      clearCanyonLoot(player);
    }

    player.locationId = data.locationId;
    spawnInSafeZone(player);
    player.justTeleported = true;
    player.positionHistory = [];
    player.recentShots = [];

    broadcast({
      type: 'playerLeaveLocation',
      playerId: player.id,
      fromLocation: oldLocation,
      toLocation: data.locationId,
    }, playerId, true, { ...player, locationId: oldLocation });

    broadcast({
      type: 'playerJoinLocation',
      id: player.id,
      nickname: player.nickname,
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
      locationId: data.locationId,
    }, playerId, true, player);

    if (data.locationId === 'main-world') {
      safeSend(ws, { type: 'lootState', loot: serializeLoot() });
    }

    if (data.locationId === 'tower-first-floor' && player.canyon) {
      enterCanyonHub(player);
    }
  }
});

function broadcast(data, excludeId = null, useAOI = false, senderPlayer = null) {
  const message = getCachedMessage(data);
  players.forEach((p, id) => {
    if (id === excludeId) return;
    if (!p.authenticated || p.ws.readyState !== WebSocket.OPEN) return;

    if (useAOI && senderPlayer) {
      if (!isInAOI(senderPlayer, p)) return;
    }

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
      savePromises.push(
        savePlayerProgress(player.userId, player.gameId, buildSavePayload(player)).catch(() => { })
      );
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