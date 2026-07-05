// server.js
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
    aoiRadius: 2, // Радиус видимости в зонах (2 = 5x5 зон)
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
  },
  siteUrl: process.env.SITE_URL || 'https://theadvenjo.online',
  internalSecret: process.env.INTERNAL_API_SECRET,
  gameTokenSecret: process.env.GAME_TOKEN_SECRET || process.env.JWT_SECRET,
  autoSaveInterval: 30000,
};

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
const rateLimits = new Map();

const VALID_STATES = new Set(['idle', 'walk', 'sprint', 'jump']);

const broadcastCache = new Map();
const CACHE_TTL = 100;

function getCachedMessage(data) {
  const key = JSON.stringify(data);
  const cached = broadcastCache.get(key);
  const now = Date.now();

  if (cached && now - cached.time < CACHE_TTL) {
    return cached.message;
  }

  const message = key;
  broadcastCache.set(key, { message, time: now });

  if (broadcastCache.size > 1000) {
    for (const [k, v] of broadcastCache) {
      if (now - v.time > CACHE_TTL * 10) {
        broadcastCache.delete(k);
      }
    }
  }

  return message;
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

function isValidPosition(pos) {
  if (!Array.isArray(pos) || pos.length !== 3) return false;
  const [x, y, z] = pos;
  const halfSize = CONFIG.world.size / 2;
  return (
    typeof x === 'number' && typeof y === 'number' && typeof z === 'number' &&
    !isNaN(x) && !isNaN(y) && !isNaN(z) &&
    Math.abs(x) <= halfSize && Math.abs(z) <= halfSize &&
    y >= -30 && y <= 50 &&
    isFinite(x) && isFinite(y) && isFinite(z)
  );
}

function isValidMovement(player, newPosition, deltaTimeMs) {
  const [ox, , oz] = player.position;
  const [nx, , nz] = newPosition;
  const dx = nx - ox;
  const dz = nz - oz;
  const distance = Math.sqrt(dx * dx + dz * dz);
  const seconds = deltaTimeMs / 1000;
  const speed = distance / seconds;

  if (player.justSpawned || player.justTeleported) {
    player.justSpawned = false;
    player.justTeleported = false;
    return true;
  }

  return speed <= CONFIG.world.maxSpeed * 1.5;
}

function getHistoricalPosition(player, targetTime) {
  const history = player.positionHistory || [];
  if (history.length === 0) return player.position;

  let before = history[0];
  let after = history[history.length - 1];

  for (let i = 0; i < history.length - 1; i++) {
    if (history[i].time <= targetTime && history[i + 1].time >= targetTime) {
      before = history[i];
      after = history[i + 1];
      break;
    }
  }

  const timeDiff = after.time - before.time;
  if (timeDiff <= 0) return before.position;

  const t = (targetTime - before.time) / timeDiff;
  return [
    before.position[0] + (after.position[0] - before.position[0]) * t,
    before.position[1] + (after.position[1] - before.position[1]) * t,
    before.position[2] + (after.position[2] - before.position[2]) * t,
  ];
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

// Area of Interest функции
function getPlayerZone(player) {
  const halfSize = CONFIG.world.size / 2;
  const zoneX = Math.floor((player.position[0] + halfSize) / CONFIG.world.zoneSize);
  const zoneZ = Math.floor((player.position[2] + halfSize) / CONFIG.world.zoneSize);
  return { zoneX, zoneZ };
}

function isInAOI(player, other) {
  const pZone = getPlayerZone(player);
  const oZone = getPlayerZone(other);
  const dx = Math.abs(pZone.zoneX - oZone.zoneX);
  const dz = Math.abs(pZone.zoneZ - oZone.zoneZ);
  return dx <= CONFIG.world.aoiRadius && dz <= CONFIG.world.aoiRadius;
}

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

setInterval(() => {
  const now = Date.now();
  players.forEach((player) => {
    if (!player.authenticated) return;
    safeSend(player.ws, { type: 'ping', t: now });
    if (now - player.lastPong > CONFIG.network.heartbeatTimeout) {
      console.log(`[!] Heartbeat timeout: ${player.id}`);
      player.ws.terminate();
    }
  });
}, CONFIG.network.heartbeatInterval);

setInterval(() => {
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

setInterval(() => {
  if (!CONFIG.internalSecret) return;

  players.forEach((player) => {
    if (!player.authenticated) return;

    savePlayerProgress(player.userId, player.gameId, {
      progress: {
        locationId: player.locationId,
        position: player.position,
        rotation: player.rotation,
        health: player.health,
      },
      nickname: player.nickname,
      statistics: {
        playtimeSeconds: Math.floor((Date.now() - player.sessionStart) / 1000),
        kills: player.stats.kills,
        deaths: player.stats.deaths,
        shotsFired: player.stats.shotsFired,
        buildingsPlaced: player.stats.buildingsPlaced,
      },
    }).catch(err => {
      console.error(`[AutoSave] Error for ${player.id}:`, err.message);
    });
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
    locationId: 'main-world',
    ws,
    authenticated: false,
    lastSeen: Date.now(),
    lastPong: Date.now(),
    lastUpdate: 0,
    justSpawned: false,
    justTeleported: false,
    sessionStart: Date.now(),
    health: 100,
    maxHealth: 100,
    alive: true,
    lastDamageTime: 0,
    positionHistory: [],
    weaponEquipped: true,
    isShooting: false,
    respawnToken: null,  
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
  };

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      player.lastSeen = Date.now();

      if (!player.authenticated) {
        if (data.type === 'auth') {
          handleAuth(player, data);
          return;
        } else {
          safeSend(ws, { type: 'auth_error', error: 'auth_required' });
          ws.close(4001, 'Authentication required');
          return;
        }
      }

      if (data.type === 'pong') {
        player.lastPong = Date.now();
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
      } else if (data.type === 'hit') {
        if (!checkRateLimit(playerId, 'hit', CONFIG.network.hitRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Hit rate limit exceeded' });
          return;
        }
      }

      switch (data.type) {
        case 'playerUpdate': handlePlayerUpdate(player, data); break;
        case 'shoot': handleShoot(player, data); break;
        case 'nicknameChange': handleNicknameChange(player, data); break;
        case 'chat': handleChat(player, data); break;
        case 'hit': handleHit(player, data); break;
        case 'saveProgress': handleSaveProgress(player, data); break;
      }
    } catch (error) {
      console.error('[!] Message parse error:', error.message);
    }
  });

  ws.on('close', () => {
    clearTimeout(player.authTimeout);

    if (player.authenticated && CONFIG.internalSecret) {
      savePlayerProgress(player.userId, player.gameId, {
        progress: {
          locationId: player.locationId,
          position: player.position,
          rotation: player.rotation,
          health: player.health,
        },
        nickname: player.nickname,
        statistics: {
          playtimeSeconds: Math.floor((Date.now() - player.sessionStart) / 1000),
          kills: player.stats.kills,
          deaths: player.stats.deaths,
          shotsFired: player.stats.shotsFired,
          buildingsPlaced: player.stats.buildingsPlaced,
        },
      }).catch(err => console.error('[FinalSave] Error:', err.message));
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
        player.locationId = savedProgress.progress.locationId || 'main-world';
      } else {
        spawnInSafeZone(player);
      }

      if (savedProgress.statistics) {
        player.stats.kills = savedProgress.statistics.kills || 0;
        player.stats.deaths = savedProgress.statistics.deaths || 0;
        player.stats.shotsFired = savedProgress.statistics.shotsFired || 0;
        player.stats.buildingsPlaced = savedProgress.statistics.buildingsPlaced || 0;
      }
    } else {
      player.nickname = generateUniqueNickname(`Player_${player.wallet.slice(0, 4)}`);
      spawnInSafeZone(player);
    }

    player.justSpawned = true;
    players.set(playerId, player);

    console.log(`[+] Authenticated: ${playerId} (${player.userId}, ${player.nickname}). Total: ${players.size}`);

    // Отправляем только игроков в Area of Interest
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
    });

    safeSend(ws, {
      type: 'init',
      playerId,
      players: existingPlayers,
      count: players.size,
      spawnPosition: player.position,
    });

    if (savedProgress) {
      safeSend(ws, {
        type: 'progress_loaded',
        progress: savedProgress,
      });
    }

    // Broadcast с AoI
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
    }, playerId, true, player);

    broadcastCount();
  }

  function spawnInSafeZone(player) {
    const angle = Math.random() * Math.PI * 2;
    const r = 10 + Math.random() * 15;
    player.position = [Math.cos(angle) * r, 0, Math.sin(angle) * r];
  }

  function handlePlayerUpdate(player, data) {
    if (!player.alive) return;
    if (!isValidPosition(data.position)) return;

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

    // Broadcast с AoI
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

    const distFromCenter = Math.sqrt(px * px + pz * pz);
    if (distFromCenter < 30) {
      safeSend(ws, { type: 'error', message: 'Cannot shoot in safe zone' });
      return;
    }

    player.stats.shotsFired++;

    // Broadcast с AoI
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

    // Чат шлём всем (без AoI)
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

    const ping = Math.max(0, Date.now() - player.lastPong);
    const shotTime = Date.now() - ping;
    const historicalPos = getHistoricalPosition(target, shotTime);

    const [px, , pz] = player.position;
    const [tx, , tz] = historicalPos;
    const dist = Math.sqrt((tx - px) ** 2 + (tz - pz) ** 2);
    if (dist > 300) {
      console.log(`[!] Hit hack: distance ${dist.toFixed(2)}m`);
      return;
    }

    const [hx, , hz] = data.point;
    const hitDist = Math.sqrt((tx - hx) ** 2 + (tz - hz) ** 2);
    if (hitDist > 3) {
      console.log(`[!] Hit hack: hit point ${hitDist.toFixed(2)}m from historical pos`);
      return;
    }

    const targetDistFromCenter = Math.sqrt(tx * tx + tz * tz);
    if (targetDistFromCenter < 30) {
      safeSend(ws, { type: 'error', message: 'Target is in safe zone' });
      return;
    }

    const damage = 5;
    target.health = Math.max(0, target.health - damage);
    target.lastDamageTime = Date.now();

    // Broadcast с AoI
    broadcast({
      type: 'playerDamaged',
      targetId: data.target,
      attackerId: playerId,
      damage: damage,
      health: target.health,
      point: data.point,
      historicalPosition: historicalPos,
    }, null, true, player);

    if (target.health <= 0) {
      target.alive = false;
      player.stats.kills++;
      target.stats.deaths++;

      broadcast({
        type: 'playerDeath',
        playerId: data.target,
        killerId: playerId,
        position: historicalPos,
      }, null, true, player);

      const respawnToken = Date.now() + Math.random();
      target.respawnToken = respawnToken;

      setTimeout(() => {
        if (target.respawnToken !== respawnToken) return;
        if (target.ws.readyState !== WebSocket.OPEN) return;
        if (!target.alive) {
          target.health = target.maxHealth;
          target.alive = true;
          spawnInSafeZone(target);
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
      }, 3000);
    }
  }

  function handleSaveProgress(player, data) {
    if (!CONFIG.internalSecret) return;

    savePlayerProgress(player.userId, player.gameId, {
      progress: data.progress,
      buildings: data.buildings,
      inventory: data.inventory,
    }).catch(err => console.error('[Save] Error:', err.message));
  }
});

// Обновлённая функция broadcast с поддержкой AoI
function broadcast(data, excludeId = null, useAOI = false, senderPlayer = null) {
  const message = getCachedMessage(data);
  players.forEach((p, id) => {
    if (id === excludeId) return;
    if (!p.authenticated || p.ws.readyState !== WebSocket.OPEN) return;
    
    // Если используем AoI — проверяем зону
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
      } catch (err) { /* ignore */ }
    }
  });
}

function shutdown(signal) {
  console.log(`\n[!] ${signal} received. Shutting down gracefully...`);

  const savePromises = [];
  players.forEach((player) => {
    if (player.authenticated && CONFIG.internalSecret) {
      savePromises.push(
        savePlayerProgress(player.userId, player.gameId, {
          progress: {
            locationId: player.locationId,
            position: player.position,
            rotation: player.rotation,
            health: player.health,
          },
          nickname: player.nickname,
        }).catch(() => { })
      );
    }
  });

  Promise.all(savePromises).finally(() => {
    const msg = getCachedMessage({ type: 'serverShutdown', reason: 'Server restarting' });
    players.forEach((p) => {
      try {
        p.ws.send(msg);
        p.ws.close(1001, 'Server shutdown');
      } catch (err) { /* ignore */ }
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

server.listen(PORT, () => {
  console.log(`[TANJO] Game server running on port ${PORT}`);
  console.log(`[TANJO] Health check: http://localhost:${PORT}/health`);
  console.log(`[TANJO] Site URL: ${CONFIG.siteUrl}`);
  console.log(`[TANJO] Persistence: ${CONFIG.internalSecret ? 'enabled' : 'DISABLED'}`);
  console.log(`[TANJO] AoI: ${CONFIG.world.zoneSize}m zones, radius ${CONFIG.world.aoiRadius}`);
});