import express from 'express';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { createDeck, validateTurn, handPoints } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TURN_OPTIONS = [120, 90, 45];

/**
 * Monta Rummy en el proceso de GameCenter.
 * @param {import('http').Server} httpServer  servidor HTTP compartido (para socket.io)
 * @param {{ Ledger?: object, BetGate?: object }} deps
 * @returns {{ router: import('express').Router }}
 */
export function mount(httpServer, { Ledger, BetGate } = {}) {
  const router = express.Router();
  const io = new Server(httpServer, { path: '/games/rummy/socket.io' });

  const dist = path.join(__dirname, '..', 'dist');
  router.use(express.static(dist));
  router.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

  /** rooms: Map<code, room> */
  const rooms = new Map();
  /** socketId -> roomCode */
  const socketRoom = new Map();

  function makeCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code;
    do {
      code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    } while (rooms.has(code));
    return code;
  }

  function publicPlayers(room) {
    return room.players.map((p, i) => ({
      name: p.name,
      tiles: p.hand.length,
      hasMelded: p.hasMelded,
      connected: p.connected,
      isTurn: room.started && i === room.turn,
    }));
  }

  function emitState(room) {
    for (const p of room.players) {
      if (!p.connected) continue;
      io.to(p.id).emit('gameState', {
        code: room.code,
        started: room.started,
        board: room.board,
        hand: p.hand,
        players: publicPlayers(room),
        youIndex: room.players.indexOf(p),
        turn: room.turn,
        potCount: room.pot.length,
        hasMelded: p.hasMelded,
        hostIndex: room.players.findIndex((x) => x.isHost),
        turnDeadline: room.turnDeadline || null,
        turnSeconds: room.turnSeconds,
        betting: { enabled: !!room.bettingEnabled, amount: room.apuesta || 0 },
        betGate: BetGate ? BetGate.status('rummy', room.code) : null,
      });
    }
  }

  function clearTimer(room) {
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
  }

  function startTurn(room) {
    clearTimer(room);
    room.pendingPlay = null;
    room.turnDeadline = Date.now() + room.turnSeconds * 1000;
    room.timer = setTimeout(() => autoPass(room), room.turnSeconds * 1000);
    emitState(room);
  }

  function nextTurn(room) {
    for (let i = 0; i < room.players.length; i++) {
      room.turn = (room.turn + 1) % room.players.length;
      if (room.players[room.turn].connected) break;
    }
    startTurn(room);
  }

  // Turn ran out of time. If the player had a valid board arranged (tracked via
  // the `liveBoard` snapshot), accept it exactly like a manual "Terminar turno"
  // instead of discarding their work — only fall back to force-drawing a tile
  // when there's no pending play or it doesn't pass validateTurn.
  function autoPass(room) {
    const p = room.players[room.turn];
    const pending = room.pendingPlay;
    room.pendingPlay = null;

    if (pending) {
      const result = validateTurn({
        oldBoard: room.board,
        oldHand: p.hand,
        newBoard: pending.board,
        newHand: pending.hand,
        hasMelded: p.hasMelded,
      });
      if (result.ok) {
        room.board = pending.board;
        p.hand = pending.hand;
        if (result.meldedNow) p.hasMelded = true;
        room.passStreak = 0;
        io.to(room.code).emit('info', `${p.name} se quedó sin tiempo — su jugada era válida y fue aceptada.`);
        if (p.hand.length === 0) {
          const scores = room.players.map((pl) => ({ name: pl.name, points: handPoints(pl.hand) }));
          return endGame(room, p.name, scores, 'se quedó sin fichas');
        }
        nextTurn(room);
        return;
      }
      io.to(room.code).emit('info', `${p.name} se quedó sin tiempo con una jugada inválida y robó una ficha.`);
    } else {
      io.to(room.code).emit('info', `${p.name} se quedó sin tiempo y robó una ficha.`);
    }
    drawForPlayer(room, p);
    if (checkPotExhausted(room)) return;
    nextTurn(room);
  }

  function drawForPlayer(room, p) {
    if (room.pot.length > 0) {
      p.hand.push(room.pot.pop());
      room.passStreak = 0;
    } else {
      room.passStreak = (room.passStreak || 0) + 1;
    }
  }

  function checkPotExhausted(room) {
    if (room.pot.length === 0 && (room.passStreak || 0) >= room.players.length) {
      // Nobody can win: lowest hand points wins.
      const scores = room.players.map((p) => ({ name: p.name, points: handPoints(p.hand) }));
      const winner = scores.reduce((a, b) => (b.points < a.points ? b : a));
      endGame(room, winner.name, scores, 'pozo agotado — gana la menor puntuación');
      return true;
    }
    return false;
  }

  function endGame(room, winnerName, scores, reason) {
    clearTimer(room);
    room.started = false;
    const prize = room.bettingEnabled && room.apuesta ? room.apuesta * room.players.length : 0;
    if (Ledger && prize) {
      const winner = room.players.find((p) => p.name === winnerName);
      if (winner) {
        Ledger.recordWin({ gameSlug: 'rummy', roomCode: room.code, playerId: winner.pid, playerName: winner.name, amount: prize, reason });
      }
    }
    io.to(room.code).emit('gameOver', { winner: winnerName, scores, reason, prize });
    emitState(room);
  }

  function beginGame(room) {
    room.pot = createDeck();
    room.board = [];
    room.passStreak = 0;
    room._tileMap = null;
    for (const p of room.players) {
      p.hand = room.pot.splice(0, 14);
      p.hasMelded = false;
      if (Ledger && room.bettingEnabled && room.apuesta) {
        Ledger.recordEntry({ gameSlug: 'rummy', roomCode: room.code, playerId: p.pid, playerName: p.name, amount: room.apuesta });
      }
    }
    room.turn = Math.floor(Math.random() * room.players.length);
    room.started = true;
    io.to(room.code).emit('gameStarted');
    startTurn(room);
  }

  io.on('connection', (socket) => {
    socket.on('createRoom', ({ name, turnTime, bettingEnabled, betAmount }, cb) => {
      name = String(name || '').trim().slice(0, 16);
      if (!name) return cb?.({ error: 'Nombre requerido.' });
      const code = makeCode();
      const betting = {
        bettingEnabled: !!bettingEnabled,
        apuesta: bettingEnabled ? Math.max(0, Math.floor(Number(betAmount) || 0)) : 0,
      };
      const room = {
        code,
        turnSeconds: TURN_OPTIONS.includes(+turnTime) ? +turnTime : 120,
        players: [{ id: socket.id, pid: randomUUID(), name, hand: [], hasMelded: false, connected: true, isHost: true }],
        pot: [],
        board: [],
        turn: 0,
        started: false,
        timer: null,
        turnDeadline: null,
        passStreak: 0,
        pendingPlay: null,
        ...betting,
      };
      rooms.set(code, room);
      if (Ledger) Ledger.configureRoom('rummy', code, betting);
      socket.join(code);
      socketRoom.set(socket.id, code);
      cb?.({ code });
      emitState(room);
    });

    socket.on('joinRoom', ({ code, name }, cb) => {
      code = String(code || '').trim().toUpperCase();
      name = String(name || '').trim().slice(0, 16);
      const room = rooms.get(code);
      if (!room) return cb?.({ error: 'Sala no encontrada.' });
      if (!name) return cb?.({ error: 'Nombre requerido.' });

      // Reclaim a disconnected seat (same name) in a started game.
      const seat = room.players.find((p) => p.name === name && !p.connected);
      if (seat) {
        seat.id = socket.id;
        seat.connected = true;
        socket.join(code);
        socketRoom.set(socket.id, code);
        cb?.({ code });
        io.to(code).emit('info', `${name} se reconectó.`);
        emitState(room);
        return;
      }

      if (room.started) return cb?.({ error: 'La partida ya empezó.' });
      if (room.players.length >= 4) return cb?.({ error: 'Sala llena (máx 4).' });
      if (room.players.some((p) => p.name === name)) return cb?.({ error: 'Ese nombre ya está en uso.' });

      room.players.push({ id: socket.id, pid: randomUUID(), name, hand: [], hasMelded: false, connected: true, isHost: false });
      socket.join(code);
      socketRoom.set(socket.id, code);
      cb?.({ code });
      emitState(room);
    });

    socket.on('startGame', () => {
      const room = getRoom(socket);
      if (!room || room.started) return;
      const me = room.players.find((p) => p.id === socket.id);
      if (!me?.isHost) return;
      if (room.players.length < 2) return socket.emit('invalid', 'Se necesitan al menos 2 jugadores.');

      if (BetGate && room.bettingEnabled) {
        BetGate.open('rummy', room.code, room.players.map((p) => p.id), { amount: room.apuesta });
        io.to(room.code).emit('info', 'Confirma tu apuesta para comenzar.');
        emitState(room);
      } else {
        beginGame(room);
      }
    });

    socket.on('betConfirm', () => {
      const room = getRoom(socket);
      if (!room || room.started || !BetGate) return;
      const gate = BetGate.confirm('rummy', room.code, socket.id);
      if (gate && gate.allConfirmed) {
        BetGate.close('rummy', room.code);
        beginGame(room);
      } else {
        emitState(room);
      }
    });

    socket.on('betCancel', () => {
      const room = getRoom(socket);
      if (!room || room.started) return;
      if (BetGate) BetGate.cancel('rummy', room.code, socket.id);
      const p = room.players.find((x) => x.id === socket.id);
      if (p) {
        room.players = room.players.filter((x) => x !== p);
        socketRoom.delete(socket.id);
        socket.leave(room.code);
        io.to(room.code).emit('info', `${p.name} canceló su apuesta y salió de la sala.`);
      }
      if (room.players.length === 0) {
        rooms.delete(room.code);
        if (Ledger) Ledger.disposeRoom('rummy', room.code);
        return;
      }
      if (p?.isHost) room.players[0].isHost = true;
      emitState(room);
    });

    // Live provisional board while the active player rearranges. Broadcast is
    // visual-only for other players, but the server also keeps the resolved
    // board+hand as `pendingPlay` so a timeout can validate/accept it (see
    // autoPass).
    socket.on('liveBoard', ({ board, hand } = {}) => {
      const room = getRoom(socket);
      if (!room?.started) return;
      const p = room.players[room.turn];
      if (p?.id !== socket.id) return;
      const resolvedBoard = resolveBoard(room, board);
      const resolvedHand = resolveHand(room, p, hand);
      if (!resolvedBoard || !resolvedHand) return;
      room.pendingPlay = { board: resolvedBoard, hand: resolvedHand };
      socket.to(room.code).emit('liveBoard', resolvedBoard);
    });

    socket.on('endTurn', ({ board, hand }) => {
      const room = getRoom(socket);
      if (!room?.started) return;
      const p = room.players[room.turn];
      if (p?.id !== socket.id) return socket.emit('invalid', 'No es tu turno.');

      const newBoard = resolveBoard(room, board);
      const newHand = resolveHand(room, p, hand);
      if (!newBoard || !newHand) return socket.emit('invalid', 'Jugada malformada.');

      const result = validateTurn({
        oldBoard: room.board,
        oldHand: p.hand,
        newBoard,
        newHand,
        hasMelded: p.hasMelded,
      });
      if (!result.ok) return socket.emit('invalid', result.error);

      room.board = newBoard;
      p.hand = newHand;
      if (result.meldedNow) p.hasMelded = true;
      room.passStreak = 0;

      if (p.hand.length === 0) {
        const scores = room.players.map((pl) => ({ name: pl.name, points: handPoints(pl.hand) }));
        return endGame(room, p.name, scores, 'se quedó sin fichas');
      }
      io.to(room.code).emit('info', `${p.name} jugó ${result.placedIds.length} ficha(s).`);
      nextTurn(room);
    });

    socket.on('drawTile', ({ hand } = {}) => {
      const room = getRoom(socket);
      if (!room?.started) return;
      const p = room.players[room.turn];
      if (p?.id !== socket.id) return socket.emit('invalid', 'No es tu turno.');

      // Board reverts to server state automatically (provisional moves ignored).
      // Accept a reordered hand (same tiles) so the rack layout persists.
      if (hand) {
        const reordered = resolveHand(room, p, hand);
        if (reordered && sameIds(reordered, p.hand)) p.hand = reordered;
      }
      drawForPlayer(room, p);
      io.to(room.code).emit('info', `${p.name} robó una ficha.`);
      if (checkPotExhausted(room)) return;
      nextTurn(room);
    });

    socket.on('disconnect', () => {
      const code = socketRoom.get(socket.id);
      socketRoom.delete(socket.id);
      const room = rooms.get(code);
      if (!room) return;
      const p = room.players.find((x) => x.id === socket.id);
      if (!p) return;

      if (!room.started) {
        room.players = room.players.filter((x) => x !== p);
        if (room.players.length === 0) {
          rooms.delete(code);
          if (Ledger) Ledger.disposeRoom('rummy', code);
          return;
        }
        if (p.isHost) room.players[0].isHost = true;
        emitState(room);
        return;
      }

      p.connected = false;
      io.to(code).emit('info', `${p.name} se desconectó.`);
      if (room.players.every((x) => !x.connected)) {
        clearTimer(room);
        rooms.delete(code);
        if (Ledger) Ledger.disposeRoom('rummy', code);
        return;
      }
      if (room.players[room.turn] === p) {
        drawForPlayer(room, p);
        if (!checkPotExhausted(room)) nextTurn(room);
      } else {
        emitState(room);
      }
    });
  });

  function getRoom(socket) {
    return rooms.get(socketRoom.get(socket.id));
  }

  /** Build tile catalog lazily per room. */
  function tileMap(room) {
    if (!room._tileMap) {
      room._tileMap = new Map();
      const all = [...room.pot, ...room.board.flat(), ...room.players.flatMap((p) => p.hand)];
      for (const t of all) room._tileMap.set(t.id, t);
    }
    return room._tileMap;
  }

  function resolveBoard(room, boardIds) {
    if (!Array.isArray(boardIds)) return null;
    const map = tileMap(room);
    const out = [];
    for (const meld of boardIds) {
      if (!Array.isArray(meld)) return null;
      const tiles = [];
      for (const id of meld) {
        const t = map.get(id);
        if (!t) return null;
        tiles.push(t);
      }
      if (tiles.length > 0) out.push(tiles);
    }
    return out;
  }

  function resolveHand(room, player, handIds) {
    if (!Array.isArray(handIds)) return null;
    const map = tileMap(room);
    const tiles = [];
    for (const id of handIds) {
      const t = map.get(id);
      if (!t) return null;
      tiles.push(t);
    }
    return tiles;
  }

  function sameIds(a, b) {
    return a.map((t) => t.id).sort().join(',') === b.map((t) => t.id).sort().join(',');
  }

  return { router };
}

/* ---------- standalone (fuera de GameCenter) ---------- */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { createServer } = await import('http');
  const app = express();
  const httpServer = createServer(app);
  const { router } = mount(httpServer, {});
  app.use('/games/rummy', router);
  const PORT = process.env.PORT || 3001;
  httpServer.listen(PORT, () => {
    console.log(`Rummikub server (standalone) on http://localhost:${PORT}/games/rummy/`);
  });
}
