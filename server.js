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

  socket.on('create_room', ({ name, mode, maxRounds }) => {
    let code = genCode();
    while (rooms[code]) code = genCode();

    rooms[code] = {
      code, mode, maxRounds: maxRounds || 10,
      players: { p1: { id: socket.id, name } },
      scores: { p1: 0, p2: 0 },
      round: 0,
      currentTurn: 'p1',
      usedQuestions: { action: [], verite: [] },
      phase: 'lobby'
    };

    socket.join(code);
    socket.roomCode = code;
    socket.playerId = 'p1';
    socket.emit('room_created', { code });
  });

  socket.on('join_room', ({ name, code }) => {
    const room = rooms[code];
    if (!room) { socket.emit('join_error', { message: 'Code incorrect ou partie introuvable.' }); return; }
    if (room.players.p2) { socket.emit('join_error', { message: 'La partie est déjà complète.' }); return; }

    room.players.p2 = { id: socket.id, name };
    socket.join(code);
    socket.roomCode = code;
    socket.playerId = 'p2';

    io.to(code).emit('player_joined', { p1: room.players.p1.name, p2: name });
  });

  socket.on('start_game', ({ mode, maxRounds }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;

    room.mode = mode;
    room.maxRounds = maxRounds;
    room.currentTurn = Math.random() < 0.5 ? 'p1' : 'p2';
    room.round = 1;
    room.phase = 'game';

    io.to(code).emit('game_started', {
      firstTurn: room.currentTurn,
      mode: room.mode,
      maxRounds: room.maxRounds,
      players: { p1: room.players.p1.name, p2: room.players.p2.name }
    });
  });

  socket.on('pick_question', ({ question, qtype, theme }) => {
    const code = socket.roomCode;
    io.to(code).emit('question_picked', { question, qtype, theme });
  });

  socket.on('submit_answer', ({ answer, playerName }) => {
    const code = socket.roomCode;
    io.to(code).emit('answer_received', { answer, playerName });
  });

  socket.on('send_reaction', ({ emoji, playerName }) => {
    const code = socket.roomCode;
    io.to(code).emit('reaction_received', { emoji, playerName });
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

  socket.on('skip_question', () => {
    const code = socket.roomCode;
    io.to(code).emit('question_skipped');
  });

  socket.on('next_turn', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;

    room.round += 1;
    room.currentTurn = room.currentTurn === 'p1' ? 'p2' : 'p1';

    io.to(code).emit('next_turn', { round: room.round, currentTurn: room.currentTurn });
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
server.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));