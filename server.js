const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 10000,
  pingInterval: 5000
});

const rateLimiter = new RateLimiterMemory({
  points: 60,
  duration: 1
});

const shootRateLimiter = new RateLimiterMemory({
  points: 10,
  duration: 1
});


const MODES = {
  '5v5': { maxPlayers: 10, playersPerTeam: 5, killsToWin: 50, teamBased: true, matchDuration: 600000 },
  'ffa': { maxPlayers: 20, playersPerTeam: 1, killsToWin: 50, teamBased: false, matchDuration: 600000 }
};

const MAX_SPEED = 25;
const MAX_WEAPON_RANGE_SQ = 10000;
const SHOOT_COOLDOWN_MS = 120;
const MAIN_LOBBY_ID = 'main_lobby';
const SPAWN_PROTECTION_MS = 3000;
const FIXED_DAMAGE = 25;

const lobbies = new Map();
const gameRooms = new Map();
const queues = { '5v5': [], 'ffa': [] };
let roomCounter = 1;

const SPAWN_POINTS = {
  team1: [
    { x: -20, z: -50 }, { x: -15, z: -50 }, { x: -25, z: -50 },
    { x: -18, z: -48 }, { x: -22, z: -48 }
  ],
  team2: [
    { x: 20, z: 55 }, { x: 15, z: 55 }, { x: 25, z: 55 },
    { x: 18, z: 53 }, { x: 22, z: 53 }
  ],
  ffa: [
    { x: 0, z: -45 }, { x: -10, z: -40 }, { x: 10, z: -40 },
    { x: -20, z: -35 }, { x: 20, z: -35 }, { x: -30, z: -30 },
    { x: 30, z: -30 }, { x: 0, z: -30 }, { x: -15, z: -25 }, { x: 15, z: -25 },
    { x: -40, z: -20 }, { x: 40, z: -20 }, { x: -50, z: -10 },
    { x: 50, z: -10 }, { x: -45, z: 0 }, { x: 45, z: 0 },
    { x: -35, z: 10 }, { x: 35, z: 10 }, { x: -25, z: 20 }, { x: 25, z: 20 }
  ]
};

const LOBBY_SPAWN_POINTS = [
  { x: -10, z: -10 }, { x: 10, z: -10 }, { x: -10, z: 10 }, { x: 10, z: 10 },
  { x: 0, z: -15 }, { x: 0, z: 15 }, { x: -15, z: 0 }, { x: 15, z: 0 }
];

function rayIntersectsAABB(
  ox, oy, oz, dx, dy, dz,
  minX, minY, minZ, maxX, maxY, maxZ
) {
  let tmin = -Infinity;
  let tmax = Infinity;

  if (Math.abs(dx) > 1e-8) {
    const t1 = (minX - ox) / dx;
    const t2 = (maxX - ox) / dx;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  } else {
    if (ox < minX || ox > maxX) return null;
  }

  if (Math.abs(dy) > 1e-8) {
    const t1 = (minY - oy) / dy;
    const t2 = (maxY - oy) / dy;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  } else {
    if (oy < minY || oy > maxY) return null;
  }

  if (Math.abs(dz) > 1e-8) {
    const t1 = (minZ - oz) / dz;
    const t2 = (maxZ - oz) / dz;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  } else {
    if (oz < minZ || oz > maxZ) return null;
  }

  if (tmax < 0 || tmin > tmax) return null;

  return tmin >= 0 ? tmin : tmax;
}

function serverSideRaycast(origin, direction, players, shooterId) {
  const { x: ox, y: oy, z: oz } = origin;
  const len = Math.sqrt(direction.x ** 2 + direction.y ** 2 + direction.z ** 2);
  if (len < 0.001) return null;
  const dx = direction.x / len;
  const dy = direction.y / len;
  const dz = direction.z / len;

  let closestPlayer = null;
  let closestDist = Infinity;

  for (const [id, player] of players) {
    if (id === shooterId || !player.isAlive) continue;

    const px = player.position.x;
    const py = player.position.y || 0;
    const pz = player.position.z;

    const dist = rayIntersectsAABB(
      ox, oy, oz, dx, dy, dz,
      px - 0.4, py, pz - 0.4,
      px + 0.4, py + 1.8, pz + 0.4
    );

    if (dist !== null && dist < closestDist) {
      closestDist = dist;
      closestPlayer = player;
    }
  }

  return closestPlayer;
}


function getOrCreateLobby() {
  if (!lobbies.has(MAIN_LOBBY_ID)) {
    lobbies.set(MAIN_LOBBY_ID, { id: MAIN_LOBBY_ID, players: new Map() });
  }
  return MAIN_LOBBY_ID;
}

function getQueuesStatus() {
  return {
    '5v5': { count: queues['5v5'].length, max: MODES['5v5'].maxPlayers },
    'ffa': { count: queues['ffa'].length, max: MODES['ffa'].maxPlayers }
  };
}

function findAvailableRoom(mode) {
  for (const [roomId, room] of gameRooms.entries()) {
    if (room.mode === mode && room.status === 'playing' && room.players.size < MODES[mode].maxPlayers) {
      return room;
    }
  }
  return null;
}

function getSafeSpawnPoint(mode, team, usedPositions = []) {
  let spawnPoints;
  if (mode === '5v5') {
    spawnPoints = team === 1 ? SPAWN_POINTS.team1 : SPAWN_POINTS.team2;
  } else {
    spawnPoints = SPAWN_POINTS.ffa;
  }

  for (const point of spawnPoints) {
    const isUsed = usedPositions.some(pos =>
      Math.abs(pos.x - point.x) < 2 && Math.abs(pos.z - point.z) < 2
    );
    if (!isUsed) return { x: point.x, y: 1, z: point.z };
  }

  const randomPoint = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
  return { x: randomPoint.x, y: 1, z: randomPoint.z };
}

function getLobbySpawnPoint(usedPositions = []) {
  for (const point of LOBBY_SPAWN_POINTS) {
    const isUsed = usedPositions.some(pos =>
      Math.abs(pos.x - point.x) < 3 && Math.abs(pos.z - point.z) < 3
    );
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

function addPlayerToRoom(playerData, room) {
  const socket = io.sockets.sockets.get(playerData.socketId);
  if (!socket) return false;

  if (socket.lobbyId) {
    const lobby = lobbies.get(socket.lobbyId);
    if (lobby) {
      lobby.players.delete(playerData.socketId);
      socket.leave(socket.lobbyId);
      socket.to(socket.lobbyId).emit('playerLeftLobby', playerData.socketId);
    }
  }

  const queueIndex = queues[room.mode].findIndex(p => p.socketId === playerData.socketId);
  if (queueIndex !== -1) queues[room.mode].splice(queueIndex, 1);

  let team = 0;
  let position = { x: 0, y: 1, z: 0 };
  let rotation = { x: 0, y: 0, z: 0 };

  const modeConfig = MODES[room.mode];
  const index = room.players.size;

  if (room.mode === '5v5') {
    team = index < modeConfig.playersPerTeam ? 1 : 2;
    const usedPositions = Array.from(room.players.values())
      .filter(p => p.team === team)
      .map(p => p.position);
    position = getSafeSpawnPoint(room.mode, team, usedPositions);
    rotation = { x: 0, y: team === 1 ? 0 : Math.PI, z: 0 };
  } else if (room.mode === 'ffa') {
    const usedPositions = Array.from(room.players.values()).map(p => p.position);
    position = getSafeSpawnPoint(room.mode, 0, usedPositions);
    rotation = { x: 0, y: Math.random() * Math.PI * 2, z: 0 };
  }

  const player = {
    id: playerData.socketId,
    wallet: playerData.wallet,
    username: playerData.username,
    team,
    position,
    rotation,
    health: 100,
    kills: 0,
    deaths: 0,
    isAlive: true,
    lastMoveTime: Date.now(),
    lastShotTime: 0,
    respawnTimeout: null,
    spawnProtectionUntil: Date.now() + SPAWN_PROTECTION_MS
  };

  room.players.set(player.id, player);
  socket.join(room.id);
  socket.roomId = room.id;
  socket.lobbyId = null;

  const joinEvent = room.mode === 'ffa' ? 'joinedFFAGame' : 'gameStarted';
  socket.emit(joinEvent, {
    roomId: room.id,
    mode: room.mode,
    player,
    players: Array.from(room.players.values()),
    scores: room.scores,
    matchEndTime: room.matchEndTime,
    spawnProtectionUntil: player.spawnProtectionUntil
  });

  socket.to(room.id).emit(room.mode === 'ffa' ? 'playerJoinedFFAGame' : 'playerJoinedGame', player);
  return true;
}

function tryStartGame(mode) {
  const queue = queues[mode];
  const modeConfig = MODES[mode];

  if (mode === 'ffa') {
    const existingRoom = findAvailableRoom(mode);
    if (existingRoom && queue.length > 0) {
      while (queue.length > 0 && existingRoom.players.size < modeConfig.maxPlayers) {
        addPlayerToRoom(queue.shift(), existingRoom);
      }
      if (queue.length > 0) createNewRoom(mode, queue);
    } else if (queue.length > 0) {
      createNewRoom(mode, queue);
    }
    broadcastQueuesStatus();
    return;
  }

  if (mode === '5v5') {
    if (queue.length >= modeConfig.maxPlayers) {
      createNewRoom(mode, queue);
    }
    broadcastQueuesStatus();
    return;
  }
}

function createNewRoom(mode, queue) {
  const modeConfig = MODES[mode];
  const roomId = `room_${roomCounter++}`;
  const matchEndTime = Date.now() + modeConfig.matchDuration;

  const room = {
    id: roomId,
    mode,
    players: new Map(),
    status: 'playing',
    scores: mode === '5v5' ? { 1: 0, 2: 0 } : {},
    killsToWin: modeConfig.killsToWin,
    createdAt: Date.now(),
    matchEndTime,
    matchTimer: null,
    endGameTimeout: null
  };

  gameRooms.set(roomId, room);

  room.matchTimer = setTimeout(() => {
    handleMatchTimeout(roomId);
  }, modeConfig.matchDuration);

  const playersToAdd = Math.min(queue.length, modeConfig.maxPlayers);
  for (let i = 0; i < playersToAdd; i++) {
    addPlayerToRoom(queue.shift(), room);
  }

  broadcastQueuesStatus();
}

function handleMatchTimeout(roomId) {
  const room = gameRooms.get(roomId);
  if (!room || room.status !== 'playing') return;

  let winner = null;
  if (room.mode === '5v5') {
    const team1Score = room.scores[1] || 0;
    const team2Score = room.scores[2] || 0;
    if (team1Score > team2Score) winner = { type: 'team', team: 1 };
    else if (team2Score > team1Score) winner = { type: 'team', team: 2 };
    else winner = { type: 'draw' };
  } else {
    let maxKills = 0;
    let topPlayer = null;
    room.players.forEach(player => {
      if (player.kills > maxKills) {
        maxKills = player.kills;
        topPlayer = player;
      }
    });
    if (topPlayer) {
      winner = { type: 'player', playerId: topPlayer.id, username: topPlayer.username };
    }
  }

  handleGameEnd(roomId, winner);
}

function handleGameEnd(roomId, winnerData) {
  const room = gameRooms.get(roomId);
  if (!room) return;

  if (room.endGameTimeout) clearTimeout(room.endGameTimeout);
  if (room.matchTimer) clearTimeout(room.matchTimer);

  io.to(roomId).emit('gameEnded', {
    winner: winnerData,
    scores: room.scores,
    players: Array.from(room.players.values())
  });

  room.endGameTimeout = setTimeout(() => {
    const players = Array.from(room.players.values());
    room.players.clear();
    gameRooms.delete(roomId);

    const lobbyId = getOrCreateLobby();
    const lobby = lobbies.get(lobbyId);

    players.forEach(player => {
      const socket = io.sockets.sockets.get(player.id);
      if (!socket) return;

      socket.leave(roomId);
      socket.roomId = null;

      const usedPositions = Array.from(lobby.players.values()).map(p => p.position);
      const spawnPoint = getLobbySpawnPoint(usedPositions);

      const resetPlayer = {
        ...player,
        position: spawnPoint,
        rotation: { x: 0, y: 0, z: 0 },
        health: 100, kills: 0, deaths: 0, team: 0, isAlive: true
      };

      lobby.players.set(player.id, resetPlayer);
      socket.join(lobbyId);
      socket.lobbyId = lobbyId;

      socket.emit('returnedToLobby', {
        lobbyId, player: resetPlayer,
        players: Array.from(lobby.players.values()),
        queues: getQueuesStatus()
      });

      socket.to(lobbyId).emit('playerJoinedLobby', resetPlayer);
    });

    broadcastQueuesStatus();
  }, 5000);
}

function broadcastQueuesStatus() {
  const queuesStatus = getQueuesStatus();
  const lobby = lobbies.get(MAIN_LOBBY_ID);
  if (!lobby) return;

  lobby.players.forEach((p, pid) => {
    const s = io.sockets.sockets.get(pid);
    if (s) s.emit('queuesStatusUpdate', queuesStatus);
  });
}

function returnPlayerToLobby(socket, playerData = null) {
  const lobbyId = getOrCreateLobby();
  const lobby = lobbies.get(lobbyId);

  const usedPositions = Array.from(lobby.players.values())
    .filter(p => p.id !== socket.id)
    .map(p => p.position);
  const spawnPoint = getLobbySpawnPoint(usedPositions);

  const resetPlayer = {
    id: socket.id,
    wallet: playerData?.wallet || '',
    username: playerData?.username || `Player_${socket.id.substring(0, 4)}`,
    team: 0,
    position: spawnPoint,
    rotation: { x: 0, y: 0, z: 0 },
    health: 100, kills: 0, deaths: 0, isAlive: true
  };

  if (lobby.players.has(socket.id)) {
    lobby.players.set(socket.id, resetPlayer);
  } else {
    lobby.players.set(socket.id, resetPlayer);
    socket.join(lobbyId);
    socket.to(lobbyId).emit('playerJoinedLobby', resetPlayer);
  }

  socket.lobbyId = lobbyId;
  socket.roomId = null;

  socket.emit('returnedToLobby', {
    lobbyId,
    player: resetPlayer,
    players: Array.from(lobby.players.values()),
    queues: getQueuesStatus()
  });
}

io.on('connection', async (socket) => {
  socket.use(async ([event, data], next) => {
    try {
      if (event === 'shoot') {
        await shootRateLimiter.consume(socket.id);
      } else {
        await rateLimiter.consume(socket.id);
      }
      next();
    } catch (rlRejected) {
      console.warn(`⚠️ Rate limit exceeded for ${socket.id} on ${event}`);
    }
  });

  socket.on('joinLobby', (data) => {
    if (socket.lobbyId && lobbies.has(socket.lobbyId)) {
      const existingLobby = lobbies.get(socket.lobbyId);
      if (existingLobby.players.has(socket.id)) return;
    }

    const lobbyId = getOrCreateLobby();
    const lobby = lobbies.get(lobbyId);

    const usedPositions = Array.from(lobby.players.values()).map(p => p.position);
    const spawnPoint = getLobbySpawnPoint(usedPositions);

    const player = {
      id: socket.id,
      wallet: data.wallet,
      username: data.username || `Player_${socket.id.substring(0, 4)}`,
      team: 0,
      position: spawnPoint,
      rotation: { x: 0, y: 0, z: 0 },
      health: 100, kills: 0, deaths: 0, isAlive: true
    };

    lobby.players.set(player.id, player);
    socket.join(lobbyId);
    socket.lobbyId = lobbyId;
    socket.roomId = null;

    socket.emit('lobbyJoined', {
      lobbyId, player,
      players: Array.from(lobby.players.values()),
      queues: getQueuesStatus()
    });

    socket.to(lobbyId).emit('playerJoinedLobby', player);
  });

  socket.on('joinGameRoom', (data) => {
    if (!socket.roomId) return;

    const room = gameRooms.get(socket.roomId);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    socket.emit('joinedGameRoom', {
      roomId: room.id,
      mode: room.mode,
      player: player,
      players: Array.from(room.players.values()),
      scores: room.scores,
      matchEndTime: room.matchEndTime,
      spawnProtectionUntil: player.spawnProtectionUntil
    });
  });

  socket.on('lobbyMove', (data) => {
    if (!socket.lobbyId) return;
    if (!validatePosition(data)) return;

    const lobby = lobbies.get(socket.lobbyId);
    if (!lobby) return;

    const player = lobby.players.get(socket.id);
    if (!player) return;

    const unpacked = unpackMoveData(data);
    player.position = unpacked.position;
    player.rotation = unpacked.rotation;

    socket.to(socket.lobbyId).emit('playerMovedInLobby', {
      id: socket.id,
      position: [unpacked.position.x, unpacked.position.y, unpacked.position.z],
      rotation: [unpacked.rotation.x, unpacked.rotation.y, unpacked.rotation.z],
      serverTime: Date.now()
    });
  });

  socket.on('joinQueue', (data) => {
    const mode = data.mode;
    if (!MODES[mode]) return socket.emit('queueError', 'Invalid game mode');

    for (const [m, queue] of Object.entries(queues)) {
      if (queue.some(p => p.socketId === socket.id)) {
        return socket.emit('queueError', `You are already in ${m} queue`);
      }
    }

    if (socket.roomId) return socket.emit('queueError', 'You are already in a game');

    queues[mode].push({ socketId: socket.id, wallet: data.wallet, username: data.username });
    socket.emit('joinedQueue', { mode, position: queues[mode].length });

    tryStartGame(mode);
    broadcastQueuesStatus();
  });

  socket.on('leaveQueue', () => {
    for (const [mode, queue] of Object.entries(queues)) {
      const index = queue.findIndex(p => p.socketId === socket.id);
      if (index !== -1) {
        queue.splice(index, 1);
        socket.emit('leftQueue');
        broadcastQueuesStatus();
        return;
      }
    }
  });

  socket.on('playerMove', (data) => {
    if (!socket.roomId) return;
    if (!validatePosition(data)) return;

    const room = gameRooms.get(socket.roomId);
    if (!room || room.status !== 'playing') return;

    const player = room.players.get(socket.id);
    if (!player || !player.isAlive) return;

    const unpacked = unpackMoveData(data);
    const oldPos = player.position;
    const newPos = unpacked.position;
    const dx = newPos.x - oldPos.x;
    const dz = newPos.z - oldPos.z;

    const distSq = dx * dx + dz * dz;
    const timeDelta = (Date.now() - (player.lastMoveTime || Date.now())) / 1000;
    const maxDistSq = timeDelta > 0 ? (MAX_SPEED * timeDelta) ** 2 : 0;

    if (timeDelta > 0 && distSq > maxDistSq * 1.5) {
      socket.emit('positionCorrection', {
        position: [oldPos.x, oldPos.y, oldPos.z],
        rotation: [player.rotation.x, player.rotation.y, player.rotation.z],
        serverTime: Date.now()
      });
      return;
    }

    player.position = newPos;
    player.rotation = unpacked.rotation;
    player.lastMoveTime = Date.now();

    socket.to(socket.roomId).emit('playerMoved', {
      id: socket.id,
      position: [newPos.x, newPos.y, newPos.z],
      rotation: [unpacked.rotation.x, unpacked.rotation.y, unpacked.rotation.z],
      serverTime: Date.now()
    });
  });

  socket.on('shoot', (data) => {
    if (!socket.roomId) return;

    if (!validateShoot(data)) {
      console.warn(`⚠️ Invalid shoot data from ${socket.id}`);
      return;
    }

    const room = gameRooms.get(socket.roomId);
    if (!room || room.status !== 'playing') return;

    const shooter = room.players.get(socket.id);
    if (!shooter || !shooter.isAlive) return;

    const now = Date.now();
    if (now - shooter.lastShotTime < SHOOT_COOLDOWN_MS) {
      return;
    }
    shooter.lastShotTime = now;

    const damage = FIXED_DAMAGE;

    socket.to(socket.roomId).emit('playerShot', {
      shooterId: socket.id,
      origin: data.origin,
      direction: data.direction
    });

    const hitPlayer = serverSideRaycast(
      data.origin,
      data.direction,
      room.players,
      shooter.id
    );

    if (hitPlayer) {
      if (now < hitPlayer.spawnProtectionUntil) {
        return;
      }

      const isFriendlyFire = room.mode === '5v5' && hitPlayer.team === shooter.team;
      if (isFriendlyFire) return;

      const pdx = hitPlayer.position.x - shooter.position.x;
      const pdz = hitPlayer.position.z - shooter.position.z;
      const distSq = pdx * pdx + pdz * pdz;
      if (distSq > MAX_WEAPON_RANGE_SQ) return;

      hitPlayer.health -= damage;

      if (hitPlayer.health <= 0) {
        hitPlayer.health = 0;
        hitPlayer.isAlive = false;
        hitPlayer.deaths++;
        shooter.kills++;

        if (room.mode === '5v5') room.scores[shooter.team]++;
        else room.scores[shooter.id] = shooter.kills;

        io.to(socket.roomId).emit('playerKilled', {
          killerId: shooter.id,
          victimId: hitPlayer.id,
          scores: room.scores,
          killerKills: shooter.kills
        });

        let winner = null;
        if (room.mode === '5v5') {
          if (room.scores[shooter.team] >= room.killsToWin) {
            winner = { type: 'team', team: shooter.team };
          }
        } else {
          if (shooter.kills >= room.killsToWin) {
            winner = { type: 'player', playerId: shooter.id, username: shooter.username };
          }
        }

        if (winner) {
          handleGameEnd(socket.roomId, winner);
          return;
        }

        if (hitPlayer.respawnTimeout) clearTimeout(hitPlayer.respawnTimeout);

        hitPlayer.respawnTimeout = setTimeout(() => {
          if (!room.players.has(hitPlayer.id)) return;

          hitPlayer.health = 100;
          hitPlayer.isAlive = true;
          hitPlayer.respawnTimeout = null;
          hitPlayer.spawnProtectionUntil = Date.now() + SPAWN_PROTECTION_MS;

          const usedPositions = Array.from(room.players.values())
            .filter(p => p.id !== hitPlayer.id && p.isAlive)
            .map(p => p.position);

          hitPlayer.position = getSafeSpawnPoint(
            room.mode,
            room.mode === '5v5' ? hitPlayer.team : 0,
            usedPositions
          );

          io.to(socket.roomId).emit('playerRespawned', {
            id: hitPlayer.id,
            position: [hitPlayer.position.x, hitPlayer.position.y, hitPlayer.position.z],
            spawnProtectionUntil: hitPlayer.spawnProtectionUntil
          });
        }, 3000);
      }

      io.to(socket.roomId).emit('playerHit', {
        targetId: hitPlayer.id,
        damage: damage,
        health: hitPlayer.health
      });
    }
  });

  socket.on('chatMessage', (data) => {
    const channelId = data.channelId;
    if (!channelId) return;

    const messageText = typeof data.message === 'string' ? data.message.substring(0, 200).trim() : '';
    if (!messageText) return;

    const isFromLobby = lobbies.has(channelId);
    const isFromRoom = gameRooms.has(channelId);

    if (!isFromLobby && !isFromRoom) return;

    let username = `Player_${socket.id.substring(0, 4)}`;
    let team = 0;

    if (isFromRoom) {
      const room = gameRooms.get(channelId);
      const player = room?.players.get(socket.id);
      if (!player) return;
      username = player.username;
      team = player.team;
    } else if (isFromLobby) {
      const lobby = lobbies.get(channelId);
      const player = lobby?.players.get(socket.id);
      if (player) username = player.username;
    }

    const message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      username: username.substring(0, 20),
      message: messageText,
      timestamp: Date.now(),
      team: team,
      isTeamChat: false
    };

    if (data.isTeamChat && isFromRoom) {
      const room = gameRooms.get(channelId);
      if (room && room.mode === '5v5') {
        room.players.forEach((p, pid) => {
          if (p.team === team) {
            const s = io.sockets.sockets.get(pid);
            if (s) s.emit('chatMessage', message);
          }
        });
        return;
      }
    }

    io.to(channelId).emit('chatMessage', message);
  });

  socket.on('startVoiceChat', (data) => {
    const channelId = data.channelId || socket.roomId || socket.lobbyId;
    if (!channelId) return;

    socket.to(channelId).emit('playerTalking', {
      playerId: socket.id,
      isTalking: true
    });
  });

  socket.on('stopVoiceChat', (data) => {
    const channelId = data.channelId || socket.roomId || socket.lobbyId;
    if (!channelId) return;

    socket.to(channelId).emit('playerTalking', {
      playerId: socket.id,
      isTalking: false
    });
  });
  socket.on('voiceSignal', (data) => {
    if (!data || !data.targetId) return;
    const targetSocket = io.sockets.sockets.get(data.targetId);
    if (targetSocket) {
      targetSocket.emit('voiceSignal', {
        type: data.type,
        senderId: socket.id,
        description: data.description,
        candidate: data.candidate
      });
    }
  });

  socket.on('leaveGame', (data) => {
    if (!socket.roomId) {
      if (!socket.lobbyId) returnPlayerToLobby(socket, data);
      return;
    }

    const room = gameRooms.get(socket.roomId);
    const player = room?.players.get(socket.id);
    const oldRoomId = socket.roomId;

    if (room) {
      if (player && player.respawnTimeout) {
        clearTimeout(player.respawnTimeout);
        player.respawnTimeout = null;
      }

      room.players.delete(socket.id);
      socket.leave(oldRoomId);
      socket.to(oldRoomId).emit('playerLeft', socket.id);
      socket.to(oldRoomId).emit('playerTalking', { playerId: socket.id, isTalking: false });

      if (room.players.size === 0) {
        if (room.endGameTimeout) clearTimeout(room.endGameTimeout);
        if (room.matchTimer) clearTimeout(room.matchTimer);
        gameRooms.delete(oldRoomId);
      }
    }

    socket.roomId = null;
    returnPlayerToLobby(socket, player);
  });

  socket.on('changeUsername', (data) => {
    const newUsername = data.username?.trim();
    if (!newUsername || newUsername.length === 0 || newUsername.length > 20) {
      socket.emit('usernameError', 'Invalid username (1-20 characters)');
      return;
    }

    if (socket.lobbyId) {
      const lobby = lobbies.get(socket.lobbyId);
      if (lobby) {
        const player = lobby.players.get(socket.id);
        if (player) {
          player.username = newUsername;
          socket.to(socket.lobbyId).emit('playerUsernameChanged', {
            id: socket.id, username: newUsername
          });
        }
      }
    }

    if (socket.roomId) {
      const room = gameRooms.get(socket.roomId);
      if (room) {
        const player = room.players.get(socket.id);
        if (player) {
          player.username = newUsername;
          socket.to(socket.roomId).emit('playerUsernameChanged', {
            id: socket.id, username: newUsername
          });
        }
      }
    }

    for (const [mode, queue] of Object.entries(queues)) {
      const playerInQueue = queue.find(p => p.socketId === socket.id);
      if (playerInQueue) playerInQueue.username = newUsername;
    }
  });

  socket.on('disconnect', () => {
    for (const [mode, queue] of Object.entries(queues)) {
      const index = queue.findIndex(p => p.socketId === socket.id);
      if (index !== -1) queue.splice(index, 1);
    }

    if (socket.lobbyId) {
      const lobby = lobbies.get(socket.lobbyId);
      if (lobby) {
        lobby.players.delete(socket.id);
        socket.to(socket.lobbyId).emit('playerLeftLobby', socket.id);
      }
    }

    if (socket.roomId) {
      const room = gameRooms.get(socket.roomId);
      if (room) {
        const player = room.players.get(socket.id);
        if (player && player.respawnTimeout) {
          clearTimeout(player.respawnTimeout);
          player.respawnTimeout = null;
        }

        room.players.delete(socket.id);
        socket.to(socket.roomId).emit('playerLeft', socket.id);
        socket.to(socket.roomId).emit('playerTalking', { playerId: socket.id, isTalking: false });

        if (room.players.size === 0) {
          if (room.endGameTimeout) clearTimeout(room.endGameTimeout);
          if (room.matchTimer) clearTimeout(room.matchTimer);
          gameRooms.delete(socket.roomId);
        }
      }
    }

    broadcastQueuesStatus();
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 Game server running on port ${PORT}`));