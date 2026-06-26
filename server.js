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

// Константы режимов
const MODES = {
  '5v5': { maxPlayers: 10, playersPerTeam: 5, killsToWin: 50, teamBased: true, waitForFull: true },
  'ffa': { maxPlayers: 20, playersPerTeam: 1, killsToWin: 50, teamBased: false, waitForFull: false }
};

// Структуры данных
const MAIN_LOBBY_ID = 'main_lobby';
const lobbies = new Map();
const gameRooms = new Map();
const queues = {
  '5v5': [],
  'ffa': []
};

let roomCounter = 1;

// ✅ ИСПРАВЛЕНИЕ: Всегда используем ОДНО главное лобби
function getOrCreateLobby() {
  if (!lobbies.has(MAIN_LOBBY_ID)) {
    lobbies.set(MAIN_LOBBY_ID, { 
      id: MAIN_LOBBY_ID, 
      players: new Map() 
    });
    console.log(`✅ Main lobby created: ${MAIN_LOBBY_ID}`);
  }
  return MAIN_LOBBY_ID;
}

// Получить статус очередей
function getQueuesStatus() {
  return {
    '5v5': { count: queues['5v5'].length, max: MODES['5v5'].maxPlayers },
    'ffa': { count: queues['ffa'].length, max: MODES['ffa'].maxPlayers }
  };
}

// Получить статус игровых комнат
function getGameRoomsStatus() {
  return Array.from(gameRooms.values()).map(room => ({
    id: room.id,
    mode: room.mode,
    playersCount: room.players.size,
    maxPlayers: MODES[room.mode].maxPlayers,
    status: room.status,
    scores: room.scores,
    acceptingPlayers: room.players.size < MODES[room.mode].maxPlayers
  }));
}

// Найти FFA комнату, которая принимает игроков
function findAvailableFFARoom() {
  for (const [roomId, room] of gameRooms.entries()) {
    if (room.mode === 'ffa' && room.status === 'playing' && room.players.size < MODES['ffa'].maxPlayers) {
      return room;
    }
  }
  return null;
}

// Добавить игрока в FFA комнату
function addPlayerToFFARoom(playerData, room) {
  const socket = io.sockets.sockets.get(playerData.socketId);
  if (!socket) return false;
  
  // Убираем из лобби
  if (socket.lobbyId) {
    const lobby = lobbies.get(socket.lobbyId);
    if (lobby) {
      lobby.players.delete(playerData.socketId);
      socket.leave(socket.lobbyId);
      socket.to(socket.lobbyId).emit('playerLeftLobby', playerData.socketId);
      console.log(`📤 Player ${playerData.username} left lobby ${socket.lobbyId}`);
    }
  }
  
  // Убираем из очереди
  const queueIndex = queues['ffa'].findIndex(p => p.socketId === playerData.socketId);
  if (queueIndex !== -1) {
    queues['ffa'].splice(queueIndex, 1);
  }
  
  // Позиция по кругу
  const index = room.players.size;
  const angle = (index / MODES['ffa'].maxPlayers) * Math.PI * 2;
  const radius = 25;
  const position = { x: Math.cos(angle) * radius, y: 1, z: Math.sin(angle) * radius };
  const rotation = { x: 0, y: -angle + Math.PI, z: 0 };
  
  const player = {
    id: playerData.socketId,
    wallet: playerData.wallet,
    username: playerData.username,
    team: 0,
    position,
    rotation,
    health: 100,
    kills: 0,
    deaths: 0,
    isAlive: true
  };
  
  room.players.set(player.id, player);
  socket.join(room.id);
  socket.roomId = room.id;
  socket.lobbyId = null;
  
  // Отправляем игроку состояние игры
  socket.emit('joinedFFAGame', {
    roomId: room.id,
    mode: 'ffa',
    player,
    players: Array.from(room.players.values()),
    scores: room.scores
  });
  
  // Уведомляем других игроков
  socket.to(room.id).emit('playerJoinedFFAGame', player);
  
  console.log(`🎮 Player ${player.username} joined FFA room ${room.id} (${room.players.size}/${MODES['ffa'].maxPlayers})`);
  
  return true;
}

// Попытаться начать игру из очереди
function tryStartGame(mode) {
  const queue = queues[mode];
  const modeConfig = MODES[mode];
  
  if (mode === 'ffa') {
    // Для FFA - проверяем, есть ли уже идущая комната
    const existingRoom = findAvailableFFARoom();
    
    if (existingRoom && queue.length > 0) {
      // Добавляем игроков в существующую комнату
      while (queue.length > 0 && existingRoom.players.size < modeConfig.maxPlayers) {
        const playerData = queue.shift();
        addPlayerToFFARoom(playerData, existingRoom);
      }
      broadcastQueuesStatus();
      return;
    }
    
    // Создаём новую комнату даже с 1 игроком
    if (queue.length > 0) {
      const roomId = `room_${roomCounter++}`;
      const room = {
        id: roomId,
        mode: 'ffa',
        players: new Map(),
        status: 'playing',
        scores: {},
        killsToWin: modeConfig.killsToWin,
        createdAt: Date.now()
      };
      
      gameRooms.set(roomId, room);
      console.log(`🎮 FFA game started: ${roomId} with ${Math.min(queue.length, modeConfig.maxPlayers)} players`);
      
      // Добавляем игроков (до maxPlayers)
      const playersToAdd = Math.min(queue.length, modeConfig.maxPlayers);
      for (let i = 0; i < playersToAdd; i++) {
        const playerData = queue.shift();
        addPlayerToFFARoom(playerData, room);
      }
      
      broadcastQueuesStatus();
    }
    return;
  }
  
  // Для 5v5 - ждём полного заполнения
  if (queue.length < modeConfig.maxPlayers) return;
  
  const playersToMove = queue.splice(0, modeConfig.maxPlayers);
  
  const roomId = `room_${roomCounter++}`;
  const room = {
    id: roomId,
    mode,
    players: new Map(),
    status: 'playing',
    scores: { 1: 0, 2: 0 },
    killsToWin: modeConfig.killsToWin,
    createdAt: Date.now()
  };
  
  gameRooms.set(roomId, room);
  
  console.log(`🎮 Game started: ${roomId} (${mode}) with ${playersToMove.length} players`);
  
  playersToMove.forEach((playerData, index) => {
    const socket = io.sockets.sockets.get(playerData.socketId);
    if (!socket) return;
    
    if (socket.lobbyId) {
      const lobby = lobbies.get(socket.lobbyId);
      if (lobby) {
        lobby.players.delete(playerData.socketId);
        socket.leave(socket.lobbyId);
        socket.to(socket.lobbyId).emit('playerLeftLobby', playerData.socketId);
        console.log(`📤 Player ${playerData.username} left lobby ${socket.lobbyId}`);
      }
    }
    
    const team = index < modeConfig.playersPerTeam ? 1 : 2;
    const position = { x: team === 1 ? -20 : 20, y: 1, z: (index % 5) * 2 - 4 };
    const rotation = { x: 0, y: team === 1 ? 0 : Math.PI, z: 0 };
    
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
      isAlive: true
    };
    
    room.players.set(player.id, player);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.lobbyId = null;
    
    socket.emit('gameStarted', {
      roomId,
      mode,
      player,
      players: Array.from(room.players.values()),
      scores: room.scores
    });
    
    socket.to(roomId).emit('playerJoinedGame', player);
  });
  
  broadcastQueuesStatus();
}

// Обработать конец игры
function handleGameEnd(roomId, winnerData) {
  const room = gameRooms.get(roomId);
  if (!room) return;
  
  console.log(`🏆 Game ended: ${roomId}, winner:`, winnerData);
  
  io.to(roomId).emit('gameEnded', {
    winner: winnerData,
    scores: room.scores,
    players: Array.from(room.players.values())
  });
  
  setTimeout(() => {
    const players = Array.from(room.players.values());
    room.players.clear();
    gameRooms.delete(roomId);
    
    console.log(`🔄 Returning ${players.length} players to lobby`);
    
    // ✅ ИСПРАВЛЕНИЕ: Возвращаем всех в ОДНО главное лобби
    const lobbyId = getOrCreateLobby();
    const lobby = lobbies.get(lobbyId);
    
    players.forEach(player => {
      const socket = io.sockets.sockets.get(player.id);
      if (!socket) return;
      
      socket.leave(roomId);
      socket.roomId = null;
      
      // ✅ ИСПРАВЛЕНИЕ: Позиция спавна в безопасной зоне лобби
      const resetPlayer = {
        ...player,
        position: { 
          x: Math.random() * 30 - 15, // От -15 до 15
          y: 1, 
          z: Math.random() * 30 - 15  // От -15 до 15
        },
        rotation: { x: 0, y: 0, z: 0 },
        health: 100,
        kills: 0,
        deaths: 0,
        team: 0,
        isAlive: true
      };
      
      lobby.players.set(player.id, resetPlayer);
      socket.join(lobbyId);
      socket.lobbyId = lobbyId;
      
      console.log(`✅ Player ${player.username} returned to lobby ${lobbyId} (total: ${lobby.players.size})`);
      
      // Отправляем игроку данные о возврате
      socket.emit('returnedToLobby', {
        lobbyId,
        player: resetPlayer,
        players: Array.from(lobby.players.values()),
        queues: getQueuesStatus(),
        gameRooms: getGameRoomsStatus()
      });
      
      // Уведомляем остальных в лобби
      socket.to(lobbyId).emit('playerJoinedLobby', resetPlayer);
    });
    
    broadcastQueuesStatus();
  }, 5000);
}

// Отправить статус очередей всем в лобби
function broadcastQueuesStatus() {
  const queuesStatus = getQueuesStatus();
  const roomsStatus = getGameRoomsStatus();
  
  lobbies.forEach(lobby => {
    lobby.players.forEach((p, pid) => {
      const s = io.sockets.sockets.get(pid);
      if (s) {
        s.emit('queuesStatusUpdate', queuesStatus);
        s.emit('gameRoomsStatusUpdate', roomsStatus);
      }
    });
  });
}

io.on('connection', (socket) => {
  console.log(`🔌 Player connected: ${socket.id}`);

  socket.on('joinLobby', (data) => {
    // ✅ ИСПРАВЛЕНИЕ: Если игрок уже в лобби, не добавляем снова
    if (socket.lobbyId && lobbies.has(socket.lobbyId)) {
      const existingLobby = lobbies.get(socket.lobbyId);
      if (existingLobby.players.has(socket.id)) {
        console.log(`⚠️ Player ${data.username} already in lobby ${socket.lobbyId}`);
        return;
      }
    }
    
    const lobbyId = getOrCreateLobby();
    const lobby = lobbies.get(lobbyId);
    
    // ✅ ИСПРАВЛЕНИЕ: Безопасная позиция спавна (не внутри стен)
    const player = {
      id: socket.id,
      wallet: data.wallet,
      username: data.username || `Player_${socket.id.substring(0, 4)}`,
      team: 0,
      position: { 
        x: Math.random() * 30 - 15, // От -15 до 15
        y: 1, 
        z: Math.random() * 30 - 15  // От -15 до 15
      },
      rotation: { x: 0, y: 0, z: 0 },
      health: 100,
      kills: 0,
      deaths: 0,
      isAlive: true
    };
    
    lobby.players.set(player.id, player);
    socket.join(lobbyId);
    socket.lobbyId = lobbyId;
    socket.roomId = null;
    
    let queuePosition = null;
    let queueMode = null;
    for (const [mode, queue] of Object.entries(queues)) {
      const idx = queue.findIndex(p => p.socketId === socket.id);
      if (idx !== -1) {
        queuePosition = idx + 1;
        queueMode = mode;
        break;
      }
    }
    
    console.log(`✅ Player ${player.username} joined lobby ${lobbyId} (total: ${lobby.players.size})`);
    
    socket.emit('lobbyJoined', {
      lobbyId,
      player,
      players: Array.from(lobby.players.values()),
      queues: getQueuesStatus(),
      gameRooms: getGameRoomsStatus(),
      queuePosition,
      queueMode
    });
    
    socket.to(lobbyId).emit('playerJoinedLobby', player);
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
      id: socket.id,
      position: data.position,
      rotation: data.rotation
    });
  });

  socket.on('joinQueue', (data) => {
    const mode = data.mode;
    if (!MODES[mode]) {
      socket.emit('queueError', 'Invalid game mode');
      return;
    }
    
    for (const [m, queue] of Object.entries(queues)) {
      if (queue.some(p => p.socketId === socket.id)) {
        socket.emit('queueError', `You are already in ${m} queue`);
        return;
      }
    }
    
    if (socket.roomId) {
      socket.emit('queueError', 'You are already in a game');
      return;
    }
    
    queues[mode].push({
      socketId: socket.id,
      wallet: data.wallet,
      username: data.username
    });
    
    const position = queues[mode].length;
    socket.emit('joinedQueue', { mode, position });
    
    console.log(`📋 Player ${data.username} joined ${mode} queue at position ${position}`);
    
    tryStartGame(mode);
    broadcastQueuesStatus();
  });

  socket.on('leaveQueue', () => {
    for (const [mode, queue] of Object.entries(queues)) {
      const index = queue.findIndex(p => p.socketId === socket.id);
      if (index !== -1) {
        queue.splice(index, 1);
        socket.emit('leftQueue');
        
        queue.forEach((p, i) => {
          const s = io.sockets.sockets.get(p.socketId);
          if (s) s.emit('queuePositionUpdate', { position: i + 1 });
        });
        
        console.log(`📋 Player left ${mode} queue`);
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
    
    player.position = data.position;
    player.rotation = data.rotation;
    
    socket.to(socket.roomId).emit('playerMoved', {
      id: socket.id,
      position: data.position,
      rotation: data.rotation
    });
  });

  socket.on('shoot', (data) => {
    if (!socket.roomId) return;
    
    const room = gameRooms.get(socket.roomId);
    if (!room || room.status !== 'playing') return;
    
    const shooter = room.players.get(socket.id);
    if (!shooter || !shooter.isAlive) return;
    
    socket.to(socket.roomId).emit('playerShot', {
      shooterId: socket.id,
      origin: data.origin,
      direction: data.direction
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
          
          if (room.mode === '5v5') {
            room.scores[shooter.team]++;
          } else {
            room.scores[shooter.id] = shooter.kills;
          }
          
          io.to(socket.roomId).emit('playerKilled', {
            killerId: shooter.id,
            killerName: shooter.username,
            victimId: hitPlayer.id,
            victimName: hitPlayer.username,
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
          
          setTimeout(() => {
            if (!room.players.has(hitPlayer.id)) return;
            
            hitPlayer.health = 100;
            hitPlayer.isAlive = true;
            
            if (room.mode === '5v5') {
              hitPlayer.position = { 
                x: hitPlayer.team === 1 ? -20 : 20, 
                y: 1, 
                z: Math.random() * 10 - 5 
              };
            } else {
              const angle = Math.random() * Math.PI * 2;
              const radius = 20 + Math.random() * 10;
              hitPlayer.position = { 
                x: Math.cos(angle) * radius, 
                y: 1, 
                z: Math.sin(angle) * radius 
              };
            }
            
            io.to(socket.roomId).emit('playerRespawned', {
              id: hitPlayer.id,
              position: hitPlayer.position
            });
          }, 3000);
        }
        
        io.to(socket.roomId).emit('playerHit', {
          targetId: hitPlayer.id,
          damage: data.damage || 25,
          health: hitPlayer.health
        });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Player disconnected: ${socket.id}`);
    
    for (const [mode, queue] of Object.entries(queues)) {
      const index = queue.findIndex(p => p.socketId === socket.id);
      if (index !== -1) {
        queue.splice(index, 1);
        queue.forEach((p, i) => {
          const s = io.sockets.sockets.get(p.socketId);
          if (s) s.emit('queuePositionUpdate', { position: i + 1 });
        });
      }
    }
    
    if (socket.lobbyId) {
      const lobby = lobbies.get(socket.lobbyId);
      if (lobby) {
        lobby.players.delete(socket.id);
        socket.to(socket.lobbyId).emit('playerLeftLobby', socket.id);
        
        console.log(`📤 Player left lobby ${socket.lobbyId} (remaining: ${lobby.players.size})`);
        
        // ✅ ИСПРАВЛЕНИЕ: Не удаляем главное лобби
        if (lobby.players.size === 0 && lobby.id !== MAIN_LOBBY_ID) {
          lobbies.delete(socket.lobbyId);
          console.log(`🗑️ Empty lobby deleted: ${socket.lobbyId}`);
        }
      }
    }
    
    if (socket.roomId) {
      const room = gameRooms.get(socket.roomId);
      if (room) {
        room.players.delete(socket.id);
        socket.to(socket.roomId).emit('playerLeft', socket.id);
        
        if (room.players.size === 0) {
          gameRooms.delete(socket.roomId);
          console.log(`🗑️ Empty game room deleted: ${socket.roomId}`);
        }
      }
    }
    
    broadcastQueuesStatus();
  });
});

app.get('/health', (req, res) => {
  const totalPlayers = 
    Array.from(lobbies.values()).reduce((sum, lobby) => sum + lobby.players.size, 0) +
    Array.from(gameRooms.values()).reduce((sum, room) => sum + room.players.size, 0);
  
  res.json({ 
    status: 'ok', 
    lobbies: lobbies.size,
    gameRooms: gameRooms.size,
    queues: {
      '5v5': queues['5v5'].length,
      'ffa': queues['ffa'].length
    },
    totalPlayers
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Game server running on port ${PORT}`);
  console.log(`🎮 Modes: 5v5 (${MODES['5v5'].maxPlayers} players), FFA (${MODES['ffa'].maxPlayers} players)`);
});