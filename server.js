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

function createRoom(socketId, name, gameType, options) {
  let code = genCode();
  while (rooms[code]) code = genCode();
  rooms[code] = {
    code, gameType, options,
    players: { p1: { id: socketId, name } },
    scores: { p1: 0, p2: 0 },
    round: 0, maxRounds: options.maxRounds || 10,
    currentTurn: 'p1', phase: 'lobby',
    usedQuestions: []
  };
  return code;
}

io.on('connection', (socket) => {

  // --- CRÉER UNE SALLE ---
  socket.on('create_room', ({ name, gameType, options }) => {
    const code = createRoom(socket.id, name, gameType, options);
    socket.join(code);
    socket.roomCode = code;
    socket.playerId = 'p1';
    socket.emit('room_created', { code, gameType });
  });

  // --- REJOINDRE UNE SALLE ---
  socket.on('join_room', ({ name, code }) => {
    const room = rooms[code];
    if (!room) { socket.emit('join_error', { message: 'Code incorrect ou partie introuvable.' }); return; }
    if (room.players.p2) { socket.emit('join_error', { message: 'La partie est déjà complète.' }); return; }
    room.players.p2 = { id: socket.id, name };
    socket.join(code);
    socket.roomCode = code;
    socket.playerId = 'p2';
    io.to(code).emit('player_joined', { p1: room.players.p1.name, p2: name, gameType: room.gameType });
  });

  // --- LANCER LE JEU ---
  socket.on('start_game', ({ options }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;
    room.options = { ...room.options, ...options };
    room.maxRounds = room.options.maxRounds || 10;
    room.currentTurn = Math.random() < 0.5 ? 'p1' : 'p2';
    room.round = 1;
    room.phase = 'game';
    io.to(code).emit('game_started', {
      firstTurn: room.currentTurn,
      options: room.options,
      gameType: room.gameType,
      players: { p1: room.players.p1.name, p2: room.players.p2.name }
    });
  });

  // --- ACTION OU VÉRITÉ ---
  socket.on('pick_question', ({ question, qtype }) => {
    io.to(socket.roomCode).emit('question_picked', { question, qtype });
  });
  socket.on('submit_answer', ({ answer, playerName }) => {
    io.to(socket.roomCode).emit('answer_received', { answer, playerName });
  });
  socket.on('skip_question', () => {
    io.to(socket.roomCode).emit('question_skipped');
  });

  // --- QUIZ ---
  socket.on('quiz_answer', ({ answer, playerId, playerName, correct, points }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;
    if (correct) room.scores[playerId] = (room.scores[playerId] || 0) + points;
    io.to(code).emit('quiz_answer_received', {
      answer, playerId, playerName, correct,
      scores: room.scores
    });
  });
  socket.on('quiz_next', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;
    room.round += 1;
    if (room.round > room.maxRounds) {
      io.to(code).emit('game_over', { scores: room.scores });
    } else {
      io.to(code).emit('quiz_next', { round: room.round });
    }
  });

  // --- QUI FERAIT ÇA ---
  socket.on('qui_vote', ({ choice, playerId, playerName }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;
    if (!room.votes) room.votes = {};
    room.votes[playerId] = choice;
    io.to(code).emit('vote_received', { playerId, playerName, choice });
    const allVoted = room.players.p2 && room.votes.p1 !== undefined && room.votes.p2 !== undefined;
    if (allVoted) {
      const same = room.votes.p1 === room.votes.p2;
      if (same) {
        room.scores.p1 = (room.scores.p1 || 0) + 1;
        room.scores.p2 = (room.scores.p2 || 0) + 1;
      }
      io.to(code).emit('votes_revealed', {
        votes: room.votes,
        same,
        scores: room.scores
      });
      room.votes = {};
    }
  });
  socket.on('qui_next', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;
    room.round += 1;
    if (room.round > room.maxRounds) {
      io.to(code).emit('game_over', { scores: room.scores });
    } else {
      io.to(code).emit('qui_next', { round: room.round });
    }
  });

  // --- COMMUN ---
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
    io.to(code).emit('next_turn', { round: room.round, currentTurn: room.currentTurn });
  });
  socket.on('send_reaction', ({ emoji, playerName }) => {
    io.to(socket.roomCode).emit('reaction_received', { emoji, playerName });
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