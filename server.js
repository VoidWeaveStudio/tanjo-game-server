//game-server\server.js
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

const MAX_LOBBY_PLAYERS = 50;
const MAX_GAME_ROOMS = 10;
const PLAYERS_PER_TEAM = 5;
const PLAYERS_PER_GAME = PLAYERS_PER_TEAM * 2; // 10
const KILLS_TO_WIN = 50;

const lobbies = new Map(); 
const gameRooms = new Map();
const queue = []; 

for (let i = 1; i <= MAX_GAME_ROOMS; i++) {
  const roomId = `game_room_${i}`;
  gameRooms.set(roomId, {
    id: roomId,
    players: new Map(),
    status: 'waiting', 
    scores: { 1: 0, 2: 0 },
    createdAt: Date.now()
  });
}

function findAvailableLobby() {
  for (const [lobbyId, lobby] of lobbies.entries()) {
    if (lobby.players.size < MAX_LOBBY_PLAYERS) {
      return lobbyId;
    }
  }
  return null;
}

function createLobby() {
  const lobbyId = `lobby_${lobbies.size + 1}`;
  lobbies.set(lobbyId, {
    id: lobbyId,
    players: new Map()
  });
  console.log(`Lobby created: ${lobbyId}`);
  return lobbyId;
}

function getOrCreateLobby() {
  let lobbyId = findAvailableLobby();
  if (!lobbyId) {
    lobbyId = createLobby();
  }
  return lobbyId;
}

function tryStartGame(roomId) {
  const room = gameRooms.get(roomId);
  if (!room || room.status !== 'waiting') return;
  
  if (room.players.size === PLAYERS_PER_GAME) {
    room.status = 'playing';
    
    const players = Array.from(room.players.values());
    players.forEach((player, index) => {
      player.team = index < PLAYERS_PER_TEAM ? 1 : 2;
      player.position = { 
        x: player.team === 1 ? -20 : 20, 
        y: 1, 
        z: 0 
      };
      player.rotation = { 
        x: 0, 
        y: player.team === 1 ? 0 : Math.PI, 
        z: 0 
      };
    });
    
    io.to(roomId).emit('gameStarted', {
      players: Array.from(room.players.values()),
      scores: room.scores
    });
    
    console.log(`Game started in ${roomId}`);
  }
}

function handleGameEnd(roomId, winningTeam) {
  const room = gameRooms.get(roomId);
  if (!room) return;
  
  console.log(`Game ended in ${roomId}, team ${winningTeam} won`);
  
  io.to(roomId).emit('gameEnded', {
    winningTeam,
    scores: room.scores
  });
  
  const players = Array.from(room.players.values());
  room.players.clear();
  room.status = 'waiting';
  room.scores = { 1: 0, 2: 0 };
  
  players.forEach(player => {
    const socket = io.sockets.sockets.get(player.id);
    if (socket) {
      socket.leave(roomId);
      
      const lobbyId = getOrCreateLobby();
      const lobby = lobbies.get(lobbyId);
      
      player.position = { x: 0, y: 1, z: 0 };
      player.rotation = { x: 0, y: 0, z: 0 };
      player.health = 100;
      player.kills = 0;
      player.deaths = 0;
      player.isAlive = true;
      player.team = 0;
      
      lobby.players.set(player.id, player);
      socket.join(lobbyId);
      socket.lobbyId = lobbyId;
      socket.roomId = null;
      
      socket.emit('returnedToLobby', {
        lobbyId,
        player
      });
      
      socket.to(lobbyId).emit('playerJoinedLobby', player);
    }
  });
  
  processQueue(roomId);
}

function processQueue(roomId) {
  if (queue.length < PLAYERS_PER_GAME) return;
  
  const room = gameRooms.get(roomId);
  if (!room || room.status !== 'waiting' || room.players.size > 0) return;
  
  console.log(`Processing queue for ${roomId}, taking ${PLAYERS_PER_GAME} players`);
  
  const playersToMove = queue.splice(0, PLAYERS_PER_GAME);
  
  playersToMove.forEach((playerData, index) => {
    const socket = io.sockets.sockets.get(playerData.socketId);
    if (!socket) return;
    
    if (socket.lobbyId) {
      const lobby = lobbies.get(socket.lobbyId);
      if (lobby) {
        lobby.players.delete(playerData.socketId);
        socket.leave(socket.lobbyId);
        socket.to(socket.lobbyId).emit('playerLeftLobby', playerData.socketId);
      }
    }
    
    const team = index < PLAYERS_PER_TEAM ? 1 : 2;
    const player = {
      id: playerData.socketId,
      wallet: playerData.wallet,
      username: playerData.username,
      team,
      position: { x: team === 1 ? -20 : 20, y: 1, z: 0 },
      rotation: { x: 0, y: team === 1 ? 0 : Math.PI, z: 0 },
      health: 100,
      kills: 0,
      deaths: 0,
      isAlive: true
    };
    
    room.players.set(player.id, player);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.lobbyId = null;
    
    socket.emit('joinedGameRoom', {
      roomId,
      player,
      players: Array.from(room.players.values())
    });
    
    socket.to(roomId).emit('playerJoinedGameRoom', player);
  });
  
  queue.forEach((p, i) => {
    const socket = io.sockets.sockets.get(p.socketId);
    if (socket) {
      socket.emit('queuePositionUpdate', { position: i + 1 });
    }
  });
  
  tryStartGame(roomId);
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('joinLobby', (data) => {
    const lobbyId = getOrCreateLobby();
    const lobby = lobbies.get(lobbyId);
    
    const player = {
      id: socket.id,
      wallet: data.wallet,
      username: data.username || `Player_${socket.id.substring(0, 4)}`,
      team: 0,
      position: { x: Math.random() * 20 - 10, y: 1, z: Math.random() * 20 - 10 },
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
    
    console.log(`Player ${player.username} joined lobby ${lobbyId}`);
    
    const gameRoomsStatus = Array.from(gameRooms.entries()).map(([id, room]) => ({
      id,
      playersCount: room.players.size,
      status: room.status
    }));
    
    socket.emit('lobbyJoined', {
      lobbyId,
      player,
      players: Array.from(lobby.players.values()),
      gameRooms: gameRoomsStatus,
      queuePosition: queue.findIndex(p => p.socketId === socket.id) + 1 || null
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

  socket.on('enterGameRoom', (data) => {
    if (!socket.lobbyId) return;
    
    const roomId = data.roomId;
    const room = gameRooms.get(roomId);
    
    if (!room) {
      socket.emit('enterGameRoomError', 'Room not found');
      return;
    }
    
    if (room.status !== 'waiting') {
      socket.emit('enterGameRoomError', 'Game already in progress');
      return;
    }
    
    if (room.players.size >= PLAYERS_PER_GAME) {
      socket.emit('enterGameRoomError', 'Room is full');
      return;
    }
    
    const lobby = lobbies.get(socket.lobbyId);
    if (!lobby) return;
    
    const playerData = lobby.players.get(socket.id);
    if (!playerData) return;
    
    lobby.players.delete(socket.id);
    socket.leave(socket.lobbyId);
    socket.to(socket.lobbyId).emit('playerLeftLobby', socket.id);
    
    const team1Count = Array.from(room.players.values()).filter(p => p.team === 1).length;
    const team2Count = Array.from(room.players.values()).filter(p => p.team === 2).length;
    const team = team1Count <= team2Count ? 1 : 2;
    
    const player = {
      id: socket.id,
      wallet: playerData.wallet,
      username: playerData.username,
      team,
      position: { x: team === 1 ? -20 : 20, y: 1, z: 0 },
      rotation: { x: 0, y: team === 1 ? 0 : Math.PI, z: 0 },
      health: 100,
      kills: 0,
      deaths: 0,
      isAlive: true
    };
    
    room.players.set(player.id, player);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.lobbyId = null;
    
    console.log(`Player ${player.username} entered game room ${roomId} (Team ${team})`);
    
    socket.emit('joinedGameRoom', {
      roomId,
      player,
      players: Array.from(room.players.values())
    });
    
    socket.to(roomId).emit('playerJoinedGameRoom', player);
    
    const gameRoomsStatus = Array.from(gameRooms.entries()).map(([id, room]) => ({
      id,
      playersCount: room.players.size,
      status: room.status
    }));
    
    lobbies.forEach(lobby => {
      lobby.players.forEach((p, pid) => {
        const s = io.sockets.sockets.get(pid);
        if (s) s.emit('gameRoomsStatusUpdate', gameRoomsStatus);
      });
    });
    
    tryStartGame(roomId);
  });

  socket.on('joinQueue', (data) => {
    if (queue.some(p => p.socketId === socket.id)) {
      socket.emit('queueError', 'You are already in the queue');
      return;
    }
    
    queue.push({
      socketId: socket.id,
      wallet: data.wallet,
      username: data.username
    });
    
    const position = queue.length;
    socket.emit('joinedQueue', { position });
    
    console.log(`Player ${data.username} joined queue at position ${position}`);
  });

  socket.on('leaveQueue', () => {
    const index = queue.findIndex(p => p.socketId === socket.id);
    if (index !== -1) {
      queue.splice(index, 1);
      
      queue.forEach((p, i) => {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) s.emit('queuePositionUpdate', { position: i + 1 });
      });
      
      socket.emit('leftQueue');
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
    
    if (hitPlayer && hitPlayer.isAlive && hitPlayer.team !== shooter.team) {
      hitPlayer.health -= data.damage || 25;
      
      if (hitPlayer.health <= 0) {
        hitPlayer.health = 0;
        hitPlayer.isAlive = false;
        hitPlayer.deaths++;
        shooter.kills++;
        
        room.scores[shooter.team]++;
        
        io.to(socket.roomId).emit('playerKilled', {
          killerId: shooter.id,
          killerName: shooter.username,
          victimId: hitPlayer.id,
          victimName: hitPlayer.username,
          scores: room.scores
        });
        
        if (room.scores[shooter.team] >= KILLS_TO_WIN) {
          handleGameEnd(socket.roomId, shooter.team);
          return;
        }
        
        setTimeout(() => {
          if (!room.players.has(hitPlayer.id)) return;
          
          hitPlayer.health = 100;
          hitPlayer.isAlive = true;
          hitPlayer.position = { 
            x: hitPlayer.team === 1 ? -20 : 20, 
            y: 1, 
            z: Math.random() * 10 - 5 
          };
          
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
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    
    const queueIndex = queue.findIndex(p => p.socketId === socket.id);
    if (queueIndex !== -1) {
      queue.splice(queueIndex, 1);
      queue.forEach((p, i) => {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) s.emit('queuePositionUpdate', { position: i + 1 });
      });
    }
    
    if (socket.lobbyId) {
      const lobby = lobbies.get(socket.lobbyId);
      if (lobby) {
        lobby.players.delete(socket.id);
        socket.to(socket.lobbyId).emit('playerLeftLobby', socket.id);
        
        if (lobby.players.size === 0) {
          lobbies.delete(socket.lobbyId);
          console.log(`Lobby deleted: ${socket.lobbyId}`);
        }
      }
    }
    
    if (socket.roomId) {
      const room = gameRooms.get(socket.roomId);
      if (room) {
        room.players.delete(socket.id);
        socket.to(socket.roomId).emit('playerLeft', socket.id);
      }
    }
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
    queueLength: queue.length,
    totalPlayers
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
}); 