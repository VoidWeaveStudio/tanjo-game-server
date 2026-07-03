//server.js

const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 3001;
const MAX_PLAYERS = 100;

const CONFIG = {
  world: {
    size: 500,
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
    y >= 0 && y <= 50 &&
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
  return (
    Math.random().toString(36).substr(2, 9) +
    Date.now().toString(36).substr(-4) +
    Math.random().toString(36).substr(2, 4)
  );
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
    health: 100,
    locationId: 'main-world',
    ws,
    authenticated: false,
    lastSeen: Date.now(),
    lastPong: Date.now(),
    lastUpdate: 0,
    justSpawned: false,
    justTeleported: false,
    sessionStart: Date.now(),
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
      broadcast({ type: 'playerLeave', playerId }, playerId);
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

    const existingPlayers = [];
    players.forEach((p, id) => {
      if (id !== playerId && p.authenticated) {
        existingPlayers.push({
          type: 'playerJoin',
          id: p.id,
          nickname: p.nickname,
          position: p.position,
          rotation: p.rotation,
          pitch: p.pitch,
          animation: p.animation,
        });
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

    broadcast({
      type: 'playerJoin',
      id: playerId,
      nickname: player.nickname,
      position: player.position,
      rotation: player.rotation,
      pitch: 0,
      animation: 'idle',
    }, playerId);

    broadcastCount();
  }

  function spawnInSafeZone(player) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * 25;
    player.position = [Math.cos(angle) * r, 0, Math.sin(angle) * r];
  }

  function handlePlayerUpdate(player, data) {
    if (!isValidPosition(data.position)) return;
    
    const now = Date.now();
    const delta = now - player.lastUpdate;
    if (delta < CONFIG.world.maxPositionUpdateRate) return;

    if (!isValidMovement(player, data.position, delta)) {
      console.log(`[!] Speed hack: ${playerId}`);
      safeSend(ws, { type: 'positionCorrection', position: player.position });
      return;
    }

    player.position = data.position;
    player.rotation = typeof data.rotation === 'number' ? data.rotation : 0;
    player.pitch = typeof data.pitch === 'number' ? data.pitch : 0;
    player.animation = typeof data.animation === 'string' ? data.animation.slice(0, 20) : 'idle';
    player.lastUpdate = now;

    broadcast({
      type: 'playerUpdate',
      id: playerId,
      position: player.position,
      rotation: player.rotation,
      pitch: player.pitch,
      animation: player.animation,
    }, playerId);
  }

  function handleShoot(player, data) {
    if (!Array.isArray(data.origin) || !Array.isArray(data.direction)) return;
    if (data.origin.length !== 3 || data.direction.length !== 3) return;
    
    const [x, , z] = player.position;
    const distFromCenter = Math.sqrt(x * x + z * z);
    if (distFromCenter < 30) {
      safeSend(ws, { type: 'error', message: 'Cannot shoot in safe zone' });
      return;
    }

    player.stats.shotsFired++;

    broadcast({
      type: 'shoot',
      id: playerId,
      origin: data.origin,
      direction: data.direction,
    }, playerId);
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
    }, playerId);
    
    safeSend(ws, { type: 'nicknameChanged', nickname: player.nickname });
  }

  function handleChat(player, data) {
    if (typeof data.message !== 'string') return;
    const msg = data.message.trim().slice(0, 200);
    if (msg.length === 0) return;

    broadcast({
      type: 'chat',
      id: generateId(),
      sender: player.nickname,
      message: msg,
      timestamp: Date.now(),
    }, null);
  }

  function handleHit(player, data) {
    console.log(`[HIT] ${playerId} -> ${data.target}`);
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

function broadcast(data, excludeId = null) {
  const message = JSON.stringify(data);
  players.forEach((p, id) => {
    if (id !== excludeId && p.authenticated && p.ws.readyState === WebSocket.OPEN) {
      try {
        p.ws.send(message);
      } catch (err) {
        console.error('[!] Broadcast error:', err.message);
      }
    }
  });
}

function broadcastCount() {
  const count = Array.from(players.values()).filter(p => p.authenticated).length;
  const msg = JSON.stringify({ type: 'count', count });
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
        }).catch(() => {})
      );
    }
  });
  
  Promise.all(savePromises).finally(() => {
    const msg = JSON.stringify({ type: 'serverShutdown', reason: 'Server restarting' });
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
});