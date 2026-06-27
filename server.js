const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const MODES = {
  '5v5': { maxPlayers: 10, playersPerTeam: 5, killsToWin: 50, teamBased: true },
  'ffa': { maxPlayers: 20, playersPerTeam: 1, killsToWin: 50, teamBased: false }
};

const MAX_SPEED = 15;
const MAIN_LOBBY_ID = 'main_lobby';
const lobbies = new Map();
const gameRooms = new Map();
const queues = { '5v5': [], 'ffa': [] };
let roomCounter = 1;

const SPAWN_POINTS = {
  team1: [
    { x: -20, z: -50 },
    { x: -15, z: -50 },
    { x: -25, z: -50 },
    { x: -18, z: -48 },
    { x: -22, z: -48 }
  ],
  team2: [
    { x: 20, z: -50 },
    { x: 15, z: -50 },
    { x: 25, z: -50 },
    { x: 18, z: -48 },
    { x: 22, z: -48 }
  ],
  ffa: [
    { x: 0, z: -45 },
    { x: -10, z: -40 },
    { x: 10, z: -40 },
    { x: -20, z: -35 },
    { x: 20, z: -35 },
    { x: -30, z: -30 },
    { x: 30, z: -30 },
    { x: 0, z: -30 },
    { x: -15, z: -25 },
    { x: 15, z: -25 }
  ]
};

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
    
    if (!isUsed) {
      return { x: point.x, y: 1, z: point.z };
    }
  }

  const randomPoint = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
  return { x: randomPoint.x, y: 1, z: randomPoint.z };
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
    respawnTimeout: null
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
    scores: room.scores
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
      
      if (queue.length > 0) {
        createNewRoom(mode, queue);
      }
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
  const room = {
    id: roomId,
    mode,
    players: new Map(),
    status: 'playing',
    scores: mode === '5v5' ? { 1: 0, 2: 0 } : {},
    killsToWin: modeConfig.killsToWin,
    createdAt: Date.now(),
    endGameTimeout: null
  };
  
  gameRooms.set(roomId, room);
  
  const playersToAdd = Math.min(queue.length, modeConfig.maxPlayers);
  for (let i = 0; i < playersToAdd; i++) {
    addPlayerToRoom(queue.shift(), room);
  }
  
  broadcastQueuesStatus();
}

function handleGameEnd(roomId, winnerData) {
  const room = gameRooms.get(roomId);
  if (!room) return;
  
  if (room.endGameTimeout) clearTimeout(room.endGameTimeout);
  
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
      
      const resetPlayer = {
        ...player,
        position: { x: Math.random() * 30 - 15, y: 1, z: Math.random() * 30 - 15 },
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
  lobbies.forEach(lobby => {
    lobby.players.forEach((p, pid) => {
      const s = io.sockets.sockets.get(pid);
      if (s) s.emit('queuesStatusUpdate', queuesStatus);
    });
  });
}

io.on('connection', (socket) => {
  socket.on('joinLobby', (data) => {
    if (socket.lobbyId && lobbies.has(socket.lobbyId)) {
      const existingLobby = lobbies.get(socket.lobbyId);
      if (existingLobby.players.has(socket.id)) return;
    }
    
    const lobbyId = getOrCreateLobby();
    const lobby = lobbies.get(lobbyId);
    
    const player = {
      id: socket.id,
      wallet: data.wallet,
      username: data.username || `Player_${socket.id.substring(0, 4)}`,
      team: 0,
      position: { x: Math.random() * 30 - 15, y: 1, z: Math.random() * 30 - 15 },
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
      scores: room.scores
    });
  });

  socket.on('lobbyMove', (data) => {
    if (!socket.lobbyId) return;
    const lobby = lobbies.get(socket.lobbyId);
    if (!lobby) return;
    
    const player = lobby.players.get(socket.id);
    if (!player) return;
    
    player.position = data.position;
    player.rotation = data.rotation;
    
    socket.to(socket.lobbyId).emit('playerMovedInLobby', {
      id: socket.id, position: data.position, rotation: data.rotation
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
    
    const room = gameRooms.get(socket.roomId);
    if (!room || room.status !== 'playing') return;
    
    const player = room.players.get(socket.id);
    if (!player || !player.isAlive) return;
    
    const oldPos = player.position;
    const newPos = data.position;
    const dx = newPos.x - oldPos.x;
    const dz = newPos.z - oldPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const timeDelta = (Date.now() - (player.lastMoveTime || Date.now())) / 1000;
    
    if (timeDelta > 0) {
      const speed = dist / timeDelta;
      if (speed > MAX_SPEED) {
        socket.emit('positionCorrection', { position: oldPos, rotation: player.rotation });
        return;
      }
    }
    
    player.position = newPos;
    player.rotation = data.rotation;
    player.lastMoveTime = Date.now();
    
    socket.to(socket.roomId).emit('playerMoved', {
      id: socket.id, position: newPos, rotation: data.rotation
    });
  });

  socket.on('shoot', (data) => {
    if (!socket.roomId) return;
    
    const room = gameRooms.get(socket.roomId);
    if (!room || room.status !== 'playing') return;
    
    const shooter = room.players.get(socket.id);
    if (!shooter || !shooter.isAlive) return;
    
    socket.to(socket.roomId).emit('playerShot', {
      shooterId: socket.id, origin: data.origin, direction: data.direction
    });
    
    const hitPlayer = room.players.get(data.targetId);
    
    if (hitPlayer && hitPlayer.isAlive) {
      const isFriendlyFire = room.mode === '5v5' && hitPlayer.team === shooter.team;
      
      if (!isFriendlyFire) {
        hitPlayer.health -= data.damage || 25;
        
        if (hitPlayer.health <= 0) {
          hitPlayer.health = 0;
          hitPlayer.isAlive = false;
          hitPlayer.deaths++;
          shooter.kills++;
          
          if (room.mode === '5v5') room.scores[shooter.team]++;
          else room.scores[shooter.id] = shooter.kills;
          
          io.to(socket.roomId).emit('playerKilled', {
            killerId: shooter.id, victimId: hitPlayer.id,
            scores: room.scores, killerKills: shooter.kills
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
            
            const usedPositions = Array.from(room.players.values())
              .filter(p => p.id !== hitPlayer.id && p.isAlive)
              .map(p => p.position);
            
            if (room.mode === '5v5') {
              hitPlayer.position = getSafeSpawnPoint(room.mode, hitPlayer.team, usedPositions);
            } else {
              hitPlayer.position = getSafeSpawnPoint(room.mode, 0, usedPositions);
            }
            
            io.to(socket.roomId).emit('playerRespawned', {
              id: hitPlayer.id, position: hitPlayer.position
            });
          }, 3000);
        }
        
        io.to(socket.roomId).emit('playerHit', {
          targetId: hitPlayer.id, damage: data.damage || 25, health: hitPlayer.health
        });
      }
    }
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
            id: socket.id,
            username: newUsername
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
            id: socket.id,
            username: newUsername
          });
        }
      }
    }

    for (const [mode, queue] of Object.entries(queues)) {
      const playerInQueue = queue.find(p => p.socketId === socket.id);
      if (playerInQueue) {
        playerInQueue.username = newUsername;
      }
    }

    console.log(`✅ Player ${socket.id} changed username to: ${newUsername}`);
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
        
        if (room.players.size === 0) {
          if (room.endGameTimeout) {
            clearTimeout(room.endGameTimeout);
            room.endGameTimeout = null;
          }
          gameRooms.delete(socket.roomId);
        }
      }
    }
    
    broadcastQueuesStatus();
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 Game server running on port ${PORT}`));