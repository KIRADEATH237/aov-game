const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function genCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {

  socket.on('create_room', ({ name, mode }) => {
    let code = genCode();
    while (rooms[code]) code = genCode();

    rooms[code] = {
      code,
      mode,
      players: { p1: { id: socket.id, name } },
      scores: { p1: 0, p2: 0 },
      round: 0,
      maxRounds: 10,
      currentTurn: 'p1',
      usedQuestions: { action: [], verite: [] }
    };

    socket.join(code);
    socket.roomCode = code;
    socket.playerId = 'p1';

    socket.emit('room_created', { code });
  });

  socket.on('join_room', ({ name, code }) => {
    const room = rooms[code];
    if (!room) {
      socket.emit('join_error', { message: 'Code incorrect ou partie introuvable.' });
      return;
    }
    if (room.players.p2) {
      socket.emit('join_error', { message: 'La partie est déjà complète.' });
      return;
    }

    room.players.p2 = { id: socket.id, name };
    socket.join(code);
    socket.roomCode = code;
    socket.playerId = 'p2';

    io.to(code).emit('player_joined', {
      p1: room.players.p1.name,
      p2: name
    });
  });

  socket.on('start_game', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;

    const firstTurn = Math.random() < 0.5 ? 'p1' : 'p2';
    room.currentTurn = firstTurn;
    room.round = 1;

    io.to(code).emit('game_started', {
      firstTurn,
      mode: room.mode,
      players: {
        p1: room.players.p1.name,
        p2: room.players.p2.name
      }
    });
  });

  socket.on('pick_question', ({ question, qtype }) => {
    const code = socket.roomCode;
    io.to(code).emit('question_picked', { question, qtype });
  });

  socket.on('mark_done', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;

    room.scores[room.currentTurn] = (room.scores[room.currentTurn] || 0) + 1;

    if (room.round >= room.maxRounds) {
      io.to(code).emit('game_over', { scores: room.scores });
    } else {
      io.to(code).emit('turn_done', { scores: room.scores });
    }
  });

  socket.on('next_turn', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;

    room.round += 1;
    room.currentTurn = room.currentTurn === 'p1' ? 'p2' : 'p1';

    io.to(code).emit('next_turn', {
      round: room.round,
      currentTurn: room.currentTurn
    });
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (code && rooms[code]) {
      io.to(code).emit('player_left');
      delete rooms[code];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
});