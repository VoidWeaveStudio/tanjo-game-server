// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const app = express();
app.use(cors());

const lobbies = new Map();
const MAIN_LOBBY_ID = 'main_lobby';

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: Date.now(),
        uptime: process.uptime(),
        players: lobbies.get(MAIN_LOBBY_ID)?.players.size || 0,
        lobbiesCount: lobbies.size
    });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',').map(s => s.trim()) : true,
    methods: ['GET', 'POST'],
  },
  pingTimeout: 20000,
  pingInterval: 10000
});

const moveRateLimiter = new RateLimiterMemory({ points: 100, duration: 1 });
const shootRateLimiter = new RateLimiterMemory({ points: 10, duration: 1 });
const generalRateLimiter = new RateLimiterMemory({ points: 30, duration: 1 });

const SHOOT_COOLDOWN_MS = 120;
const MAX_LOBBY_PLAYERS = 100;
const FIXED_DAMAGE = 25;
const RESPAWN_TIME_MS = 3000;
const MAX_PLAYER_SPEED = 15;

const LOBBY_SPAWN_POINTS = [
  { x: -10, z: -10 }, { x: 10, z: -10 }, { x: -10, z: 10 }, { x: 10, z: 10 },
  { x: 0, z: -15 }, { x: 0, z: 15 }, { x: -15, z: 0 }, { x: 15, z: 0 },
  { x: -20, z: -20 }, { x: 20, z: -20 }, { x: -20, z: 20 }, { x: 20, z: 20 },
  { x: -5, z: -5 }, { x: 5, z: -5 }, { x: -5, z: 5 }, { x: 5, z: 5 }
];

function rayIntersectsAABB(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = -Infinity, tmax = Infinity;
  if (Math.abs(dx) > 1e-8) {
    const t1 = (minX - ox) / dx, t2 = (maxX - ox) / dx;
    tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  } else { if (ox < minX || ox > maxX) return null; }
  if (Math.abs(dy) > 1e-8) {
    const t1 = (minY - oy) / dy, t2 = (maxY - oy) / dy;
    tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  } else { if (oy < minY || oy > maxY) return null; }
  if (Math.abs(dz) > 1e-8) {
    const t1 = (minZ - oz) / dz, t2 = (maxZ - oz) / dz;
    tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  } else { if (oz < minZ || oz > maxZ) return null; }
  if (tmax < 0 || tmin > tmax) return null;
  return tmin >= 0 ? tmin : tmax;
}

function getPositionAtTime(player, targetTime) {
    const history = player.positionHistory;
    if (!history || history.length === 0) return player.position;
    if (history[0].time >= targetTime) return history[0].pos;
    if (history[history.length - 1].time <= targetTime) return history[history.length - 1].pos;

    for (let i = 0; i < history.length - 1; i++) {
        const older = history[i];
        const newer = history[i + 1];
        if (older.time <= targetTime && newer.time >= targetTime) {
            const t = (targetTime - older.time) / (newer.time - older.time);
            return {
                x: older.pos.x + (newer.pos.x - older.pos.x) * t,
                y: older.pos.y + (newer.pos.y - older.pos.y) * t,
                z: older.pos.z + (newer.pos.z - older.pos.z) * t
            };
        }
    }
    return player.position;
}

function serverSideRaycastWithLagComp(origin, direction, players, shooterId, targetTime) {
    const { x: ox, y: oy, z: oz } = origin;
    const len = Math.sqrt(direction.x ** 2 + direction.y ** 2 + direction.z ** 2);
    if (len < 0.001) return null;
    const dx = direction.x / len, dy = direction.y / len, dz = direction.z / len;

    let closestPlayer = null, closestDist = Infinity;

    for (const [id, player] of players) {
        if (id === shooterId || !player.isAlive) continue;
        
        const pastPos = getPositionAtTime(player, targetTime);
        const px = pastPos.x, py = pastPos.y || 0, pz = pastPos.z;

        const dist = rayIntersectsAABB(
            ox, oy, oz, dx, dy, dz,
            px - 0.4, py, pz - 0.4, px + 0.4, py + 1.8, pz + 0.4
        );

        if (dist !== null && dist < closestDist) {
            closestDist = dist;
            closestPlayer = player;
        }
    }
    return closestPlayer;
}

function getOrCreateLobby() {
  if (!lobbies.has(MAIN_LOBBY_ID)) lobbies.set(MAIN_LOBBY_ID, { id: MAIN_LOBBY_ID, players: new Map() });
  return MAIN_LOBBY_ID;
}

function getLobbySpawnPoint(usedPositions = []) {
  for (const point of LOBBY_SPAWN_POINTS) {
    const isUsed = usedPositions.some(pos => Math.abs(pos.x - point.x) < 3 && Math.abs(pos.z - point.z) < 3);
    if (!isUsed) return { x: point.x, y: 1, z: point.z };
  }
  const randomPoint = LOBBY_SPAWN_POINTS[Math.floor(Math.random() * LOBBY_SPAWN_POINTS.length)];
  return { x: randomPoint.x, y: 1, z: randomPoint.z };
}

function validatePosition(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.position) || data.position.length !== 3) return false;
  if (!Array.isArray(data.rotation) || data.rotation.length !== 3) return false;
  for (let i = 0; i < 3; i++) {
    if (typeof data.position[i] !== 'number' || !isFinite(data.position[i])) return false;
    if (typeof data.rotation[i] !== 'number' || !isFinite(data.rotation[i])) return false;
  }
  if (Math.abs(data.position[0]) > 200 || Math.abs(data.position[2]) > 200) return false;
  if (data.position[1] < 0 || data.position[1] > 50) return false;
  return true;
}

function validateShoot(data) {
  if (!data || typeof data !== 'object') return false;
  if (!data.origin || typeof data.origin !== 'object') return false;
  const { x: ox, y: oy, z: oz } = data.origin;
  if (!isFinite(ox) || !isFinite(oy) || !isFinite(oz)) return false;
  if (Math.abs(ox) > 150 || Math.abs(oy) > 50 || Math.abs(oz) > 150) return false;
  if (!data.direction || typeof data.direction !== 'object') return false;
  const { x: dx, y: dy, z: dz } = data.direction;
  if (!isFinite(dx) || !isFinite(dy) || !isFinite(dz)) return false;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 0.8 || len > 1.2) return false;
  return true;
}

function unpackMoveData(data) {
  return {
    position: { x: data.position[0], y: data.position[1], z: data.position[2] },
    rotation: { x: data.rotation[0], y: data.rotation[1], z: data.rotation[2] }
  };
}

io.on('connection', async (socket) => {
  console.log(`🔌 [${socket.id}] Connected from ${socket.handshake.address}`);

  socket.use(async ([event, data], next) => {
    try {
      if (event === 'lobbyShoot') {
        await shootRateLimiter.consume(socket.id);
      } else if (event === 'playerMove') {
        await moveRateLimiter.consume(socket.id);
      } else if (event !== 'joinLobby' && event !== 'disconnect') {
        await generalRateLimiter.consume(socket.id);
      }
      next();
    } catch (rlRejected) {
      console.warn(`⚠️ [${socket.id}] Rate limited on event: ${event}`);
    }
  });

  socket.on('joinLobby', (data) => {
    console.log(`🎮 [${socket.id}] joinLobby received. Username: ${data?.username}, Wallet: ${data?.wallet?.substring(0, 8)}`);
    
    const lobbyId = getOrCreateLobby();
    const lobby = lobbies.get(lobbyId);
    
    if (lobby.players.size >= MAX_LOBBY_PLAYERS) { 
      console.log(`❌ [${socket.id}] Lobby full (${lobby.players.size}/${MAX_LOBBY_PLAYERS})`);
      socket.emit('lobbyFull'); 
      return; 
    }
    if (lobby.players.has(socket.id)) {
      console.log(`⚠️ [${socket.id}] Already in lobby, skipping`);
      return;
    }

    const usedPositions = Array.from(lobby.players.values()).map(p => p.position);
    const spawnPoint = getLobbySpawnPoint(usedPositions);

    const player = {
      id: socket.id,
      wallet: data.wallet,
      username: data.username || `Player_${socket.id.substring(0, 4)}`,
      position: spawnPoint,
      rotation: { x: 0, y: 0, z: 0 },
      health: 100,
      isAlive: true,
      lastShotTime: 0,
      respawnTimeoutId: null,
      lastMoveTime: Date.now(),
      positionHistory: [],     
      velocity: { x: 0, z: 0 }
    };

    lobby.players.set(player.id, player);
    socket.join(lobbyId);
    socket.lobbyId = lobbyId;

    console.log(`✅ [${socket.id}] Added to lobby "${lobbyId}". Total players: ${lobby.players.size}`);
    console.log(`📋 [${socket.id}] Spawn position:`, spawnPoint);

    socket.emit('lobbyJoined', {
      lobbyId, player,
      players: Array.from(lobby.players.values()),
      playersCount: lobby.players.size
    });
    socket.to(lobbyId).emit('playerJoinedLobby', player);
    socket.to(lobbyId).emit('lobbyPlayersCount', lobby.players.size);
    
    console.log(`📤 [${socket.id}] Sent lobbyJoined to client with ${lobby.players.size} players`);
  });

  socket.on('playerMove', (data) => {
    if (!socket.lobbyId) {
      console.warn(`⚠️ [${socket.id}] playerMove without lobbyId`);
      return;
    }
    if (!validatePosition(data)) {
      console.warn(`⚠️ [${socket.id}] Invalid position data`);
      return;
    }
    
    const lobby = lobbies.get(socket.lobbyId);
    if (!lobby) return;
    const player = lobby.players.get(socket.id);
    if (!player || !player.isAlive) return;

    const unpacked = unpackMoveData(data);
    const now = Date.now();
    const dt = (now - player.lastMoveTime) / 1000;

    if (dt > 0 && dt < 1) {
        const dx = unpacked.position.x - player.position.x;
        const dz = unpacked.position.z - player.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        const speed = distance / dt;

        if (speed > MAX_PLAYER_SPEED) {
            console.warn(`⚠️ [${socket.id}] Speed hack detected: ${speed.toFixed(2)} > ${MAX_PLAYER_SPEED}`);
            socket.emit('positionCorrection', {
                position: [player.position.x, player.position.y, player.position.z],
                rotation: [player.rotation.x, player.rotation.y, player.rotation.z]
            });
            return; 
        }
        
        player.velocity = { x: dx / dt, z: dz / dt };
    }
    
    player.lastMoveTime = now;

    player.positionHistory.push({ time: now, pos: unpacked.position });
    if (player.positionHistory.length > 60) player.positionHistory.shift();

    player.position = unpacked.position;
    player.rotation = unpacked.rotation;

    socket.to(socket.lobbyId).emit('playerMovedInLobby', {
      id: socket.id,
      position: [unpacked.position.x, unpacked.position.y, unpacked.position.z],
      rotation: [unpacked.rotation.x, unpacked.rotation.y, unpacked.rotation.z],
      serverTime: now,
      velocity: [player.velocity.x, player.velocity.z] 
    });
  });

  socket.on('lobbyShoot', (data) => {
    if (!socket.lobbyId || !validateShoot(data)) return;
    const lobby = lobbies.get(socket.lobbyId);
    if (!lobby) return;
    const shooter = lobby.players.get(socket.id);
    if (!shooter || !shooter.isAlive) return;

    const now = Date.now();
    if (now - (shooter.lastShotTime || 0) < SHOOT_COOLDOWN_MS) return;
    shooter.lastShotTime = now;

    const clientTimestamp = data.clientTimestamp || now;
    const clientLatency = Math.max(0, now - clientTimestamp);
    const targetTime = now - clientLatency;

    const hitPlayer = serverSideRaycastWithLagComp(
        data.origin, data.direction, lobby.players, shooter.id, targetTime
    );

    console.log(`🔫 [${socket.id}] Shot. Hit: ${hitPlayer?.id || 'none'}`);

    socket.to(socket.lobbyId).emit('playerShotInLobby', {
      shooterId: shooter.id, origin: data.origin, direction: data.direction,
      hitPlayerId: hitPlayer?.id || null
    });

    if (hitPlayer) {
      hitPlayer.health -= FIXED_DAMAGE;
      io.to(socket.lobbyId).emit('playerHitInLobby', { shooterId: shooter.id, targetId: hitPlayer.id, damage: FIXED_DAMAGE });
      io.to(socket.lobbyId).emit('playerHealthChanged', { targetId: hitPlayer.id, health: hitPlayer.health });

      if (hitPlayer.health <= 0) {
        hitPlayer.health = 0;
        hitPlayer.isAlive = false;
        io.to(socket.lobbyId).emit('playerDiedInLobby', { targetId: hitPlayer.id, killerId: shooter.id });

        hitPlayer.respawnTimeoutId = setTimeout(() => {
          const lobby = lobbies.get(socket.lobbyId);
          if (lobby && lobby.players.has(hitPlayer.id)) {
            const deadPlayer = lobby.players.get(hitPlayer.id);
            if (!deadPlayer.isAlive) {
              const usedPositions = Array.from(lobby.players.values()).map(p => p.position);
              const spawnPoint = getLobbySpawnPoint(usedPositions);
              deadPlayer.position = spawnPoint;
              deadPlayer.rotation = { x: 0, y: 0, z: 0 };
              deadPlayer.health = 100;
              deadPlayer.isAlive = true;
              deadPlayer.positionHistory = []; 
              
              io.to(socket.lobbyId).emit('playerRespawnedInLobby', {
                targetId: deadPlayer.id, position: spawnPoint,
                rotation: { x: 0, y: 0, z: 0 }, health: 100
              });
            }
          }
        }, RESPAWN_TIME_MS);
      }
    }
  });

  socket.on('lobbyBuild', (data) => {
    if (!socket.lobbyId) return;
    const lobby = lobbies.get(socket.lobbyId);
    if (!lobby) return;
    const player = lobby.players.get(socket.id);
    if (!player) return;
    socket.to(socket.lobbyId).emit('playerBuildInLobby', {
      playerId: socket.id, action: data.action, pieceType: data.pieceType,
      position: data.position, rotation: data.rotation
    });
  });

  socket.on('lobbyEmote', (data) => {
    if (!socket.lobbyId) return;
    const lobby = lobbies.get(socket.lobbyId);
    if (!lobby) return;
    const player = lobby.players.get(socket.id);
    if (!player) return;
    socket.to(socket.lobbyId).emit('playerEmoteInLobby', { playerId: socket.id, emoteId: data.emoteId });
  });

  socket.on('chatMessage', (data) => {
    const channelId = data.channelId;
    if (!channelId) return;
    const messageText = typeof data.message === 'string' ? data.message.substring(0, 200).trim() : '';
    if (!messageText) return;
    const lobby = lobbies.get(channelId);
    if (!lobby) return;
    const player = lobby.players.get(socket.id);
    if (!player) return;
    const message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      username: player.username.substring(0, 20), message: messageText, timestamp: Date.now()
    };
    io.to(channelId).emit('chatMessage', message);
  });

  socket.on('startVoiceChat', (data) => {
    const channelId = data.channelId || socket.lobbyId;
    if (!channelId) return;
    socket.to(channelId).emit('playerTalking', { playerId: socket.id, isTalking: true });
  });

  socket.on('stopVoiceChat', (data) => {
    const channelId = data.channelId || socket.lobbyId;
    if (!channelId) return;
    socket.to(channelId).emit('playerTalking', { playerId: socket.id, isTalking: false });
  });

  socket.on('voiceSignal', (data) => {
    if (!data || !data.targetId) return;
    const targetSocket = io.sockets.sockets.get(data.targetId);
    if (targetSocket) {
      targetSocket.emit('voiceSignal', {
        type: data.type, senderId: socket.id, description: data.description, candidate: data.candidate
      });
    }
  });

  socket.on('changeUsername', (data) => {
    const newUsername = data.username?.trim();
    if (!newUsername || newUsername.length === 0 || newUsername.length > 20) {
      socket.emit('usernameError', 'Invalid username (1-20 characters)'); return;
    }
    if (socket.lobbyId) {
      const lobby = lobbies.get(socket.lobbyId);
      if (lobby) {
        const player = lobby.players.get(socket.id);
        if (player) {
          player.username = newUsername;
          socket.to(socket.lobbyId).emit('playerUsernameChanged', { id: socket.id, username: newUsername });
        }
      }
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`🔌 [${socket.id}] Disconnected: ${reason}`);
    if (socket.lobbyId) {
      const lobby = lobbies.get(socket.lobbyId);
      if (lobby) {
        const player = lobby.players.get(socket.id);
        
        if (player && player.respawnTimeoutId) {
          clearTimeout(player.respawnTimeoutId);
          player.respawnTimeoutId = null;
        }
        
        lobby.players.delete(socket.id);
        socket.to(socket.lobbyId).emit('playerLeftLobby', socket.id);
        socket.to(socket.lobbyId).emit('lobbyPlayersCount', lobby.players.size);
        console.log(`📤 [${socket.id}] Removed from lobby. Remaining: ${lobby.players.size}`);
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 Game server running on port ${PORT}`));