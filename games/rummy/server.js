/* ============================================================
   RUMMY — router de juego (montado por GameCenter)

   Expone createRouter({ Ledger }) -> express.Router
     - GET  /                  -> game.html
     - GET  /events?...        -> stream SSE con el estado de la sala
     - POST /api/<accion>      -> acciones del jugador

   Standalone (fuera de GameCenter): node server.js  (ver bottom de archivo)
   ============================================================ */

const express = require('express');
const E = require('./engine.js');
const RK = require('../../core/room-kit.js');

const ROOT = __dirname;
const TURN_OPTIONS = [120, 90, 45];
const MAX_PLAYERS = 4;

function createRouter({ Ledger } = {}) {
  const router = express.Router();

  /* ============================================================
     Estado en memoria
     ============================================================ */

  const rooms = new Map();

  const roomCode = RK.makeRoomCode(rooms);
  const { uid, cleanName, findPlayer, currentPlayer, pushEvent, sseSend } = RK;

  /* ============================================================
     Sala
     ============================================================ */

  function createRoom(hostName, cfg) {
    const bettingEnabled = !!(cfg && cfg.bettingEnabled);
    const turnSeconds = TURN_OPTIONS.includes(Number(cfg && cfg.turnSeconds)) ? Number(cfg.turnSeconds) : 120;
    const config = {
      turnSeconds,
      bettingEnabled,
      apuesta: bettingEnabled ? Math.max(0, Math.floor(Number(cfg && cfg.apuesta) || 0)) : 0
    };

    const room = {
      id: roomCode(),
      hostId: null,
      config,
      players: [],
      status: 'lobby',
      pot: [],
      board: [],
      turnIndex: 0,
      turnDeadline: null,
      turnTimer: null,
      emptyTimer: null,
      pendingPlay: null,
      lastResult: null,
      events: [],
      eventSeq: 0,
      tileMap: null,
      createdAt: Date.now()
    };

    const host = addPlayer(room, hostName);
    room.hostId = host.id;
    rooms.set(room.id, room);
    if (Ledger) Ledger.configureRoom('rummy', room.id, config);
    pushEvent(room, 'info', `${host.name} creó la sala ${room.id}.`);
    return { room, player: host };
  }

  function addPlayer(room, name) {
    const player = {
      id: uid(),
      token: uid(),
      name: cleanName(name, `Jugador ${room.players.length + 1}`),
      hand: [],
      hasMelded: false,
      online: false,
      streams: new Set()
    };
    room.players.push(player);
    return player;
  }

  function removePlayer(room, player) {
    clearTurnTimer(room);
    const deleted = RK.removePlayerFromLobby(rooms, room, player, { Ledger, gameSlug: 'rummy' });
    return deleted;
  }

  /* ============================================================
     Ciclo de partida
     ============================================================ */

  function beginGame(room) {
    room.pot = E.createDeck();
    room.board = [];
    room.tileMap = null;
    room.status = 'playing';
    room.lastResult = null;

    for (const p of room.players) {
      p.hand = room.pot.splice(0, 14);
      p.hasMelded = false;
      if (Ledger && room.config.bettingEnabled && room.config.apuesta) {
        Ledger.recordEntry({ gameSlug: 'rummy', roomCode: room.id, playerId: p.id, playerName: p.name, amount: room.config.apuesta });
      }
    }

    room.turnIndex = Math.floor(Math.random() * room.players.length);
    pushEvent(room, 'start', 'Comienza la partida. ¡Buena suerte a todos!');
    startTurn(room);
  }

  function clearTurnTimer(room) {
    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }
  }

  function clearEmptyTimer(room) {
    if (room.emptyTimer) {
      clearTimeout(room.emptyTimer);
      room.emptyTimer = null;
    }
  }

  function startTurn(room) {
    clearTurnTimer(room);
    room.pendingPlay = null;
    room.turnDeadline = Date.now() + room.config.turnSeconds * 1000;
    room.turnTimer = setTimeout(() => { autoPass(room); broadcast(room); }, room.config.turnSeconds * 1000);
    const p = currentPlayer(room);
    if (p) pushEvent(room, 'turn', `Turno de ${p.name}.`);
  }

  function nextTurn(room) {
    if (room.status !== 'playing') return;
    const n = room.players.length;
    let idx = (room.turnIndex + 1) % n;
    for (let i = 1; i <= n; i++) {
      const cand = (room.turnIndex + i) % n;
      if (room.players[cand].online) { idx = cand; break; }
    }
    room.turnIndex = idx;
    startTurn(room);
  }

  /* el turno se acabo. Si habia una jugada valida en curso (liveBoard), se
     acepta igual que un "terminar turno" manual; si no, roba una ficha */
  function autoPass(room) {
    const p = currentPlayer(room);
    if (!p) return;
    const pending = room.pendingPlay;
    room.pendingPlay = null;

    if (pending) {
      const result = E.validateTurn({
        oldBoard: room.board,
        oldHand: p.hand,
        newBoard: pending.board,
        newHand: pending.hand,
        hasMelded: p.hasMelded
      });
      if (result.ok) {
        room.board = pending.board;
        p.hand = pending.hand;
        if (result.meldedNow) p.hasMelded = true;
        pushEvent(room, 'info', `${p.name} se quedó sin tiempo — su jugada era válida y fue aceptada.`);
        if (p.hand.length === 0) return finishGame(room, p, computeScores(room), 'se quedó sin fichas');
        nextTurn(room);
        return;
      }
      pushEvent(room, 'info', `${p.name} se quedó sin tiempo con una jugada inválida y robó una ficha.`);
    } else {
      pushEvent(room, 'info', `${p.name} se quedó sin tiempo y robó una ficha.`);
    }
    drawForPlayer(room, p);
    if (checkPotExhausted(room)) return;
    nextTurn(room);
  }

  function drawForPlayer(room, p) {
    if (room.pot.length > 0) p.hand.push(room.pot.pop());
  }

  /* pozo vacio: la partida termina en ese momento. Se suman las fichas sin
     jugar de cada jugador (comodin = 10) y gana quien menos tenga; en caso de
     empate gana el primero en orden de asiento */
  function checkPotExhausted(room) {
    if (room.pot.length > 0) return false;
    const scores = computeScores(room);
    const winner = room.players.reduce((a, b) =>
      E.handPoints(b.hand) < E.handPoints(a.hand) ? b : a);
    finishGame(room, winner, scores, 'pozo agotado — gana la menor puntuación');
    return true;
  }

  function computeScores(room) {
    return room.players.map((p) => ({ id: p.id, name: p.name, points: E.handPoints(p.hand) }));
  }

  function finishGame(room, winner, scores, reason) {
    clearTurnTimer(room);
    room.status = 'finished';
    room.turnDeadline = null;
    const prize = room.config.bettingEnabled ? room.config.apuesta * room.players.length : 0;
    if (Ledger && prize) {
      Ledger.recordWin({ gameSlug: 'rummy', roomCode: room.id, playerId: winner.id, playerName: winner.name, amount: prize, reason });
    }
    pushEvent(room, 'win', `${winner.name} gana (${reason}).`);
    room.lastResult = { seq: room.eventSeq, winnerId: winner.id, winnerName: winner.name, scores, reason, prize };
  }

  /* ---------- mesa: resolver ids -> fichas ---------- */

  function tileMap(room) {
    if (!room.tileMap) {
      room.tileMap = new Map();
      const all = [...room.pot, ...room.board.flat(), ...room.players.flatMap((p) => p.hand)];
      for (const t of all) room.tileMap.set(t.id, t);
    }
    return room.tileMap;
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

  function resolveHand(room, handIds) {
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

  /* una jugada en curso solo puede redistribuir las fichas de la mesa y de la
     mano del jugador: mismas fichas en total, sin duplicados, y la mano nueva
     solo puede contener fichas que ya eran suyas (nada pasa de la mesa a la mano) */
  function isRearrangement(room, player, board, hand) {
    if (!sameIds([...board.flat(), ...hand], [...room.board.flat(), ...player.hand])) return false;
    const own = new Set(player.hand.map((t) => t.id));
    return hand.every((t) => own.has(t.id));
  }

  /* ---------- acciones de juego ---------- */

  function doLiveBoard(room, player, body) {
    if (room.status !== 'playing') return err('La partida no está activa.');
    if (currentPlayer(room) !== player) return err('No es tu turno.');
    const resolvedBoard = resolveBoard(room, body.board);
    const resolvedHand = resolveHand(room, body.hand);
    if (!resolvedBoard || !resolvedHand) return err('Jugada malformada.');
    if (!isRearrangement(room, player, resolvedBoard, resolvedHand)) return err('Jugada malformada.');
    room.pendingPlay = { board: resolvedBoard, hand: resolvedHand };
    relayLiveBoard(room, player, resolvedBoard);
    return ok();
  }

  function doEndTurn(room, player, body) {
    if (room.status !== 'playing') return err('La partida no está activa.');
    if (currentPlayer(room) !== player) return err('No es tu turno.');

    const newBoard = resolveBoard(room, body.board);
    const newHand = resolveHand(room, body.hand);
    if (!newBoard || !newHand) return err('Jugada malformada.');

    const result = E.validateTurn({
      oldBoard: room.board,
      oldHand: player.hand,
      newBoard,
      newHand,
      hasMelded: player.hasMelded
    });
    if (!result.ok) return err(result.error);

    room.board = newBoard;
    player.hand = newHand;
    room.tileMap = null;
    if (result.meldedNow) player.hasMelded = true;

    if (player.hand.length === 0) {
      finishGame(room, player, computeScores(room), 'se quedó sin fichas');
      return ok();
    }
    pushEvent(room, 'info', `${player.name} jugó ${result.placedIds.length} ficha(s).`);
    nextTurn(room);
    return ok();
  }

  function doDrawTile(room, player, body) {
    if (room.status !== 'playing') return err('La partida no está activa.');
    if (currentPlayer(room) !== player) return err('No es tu turno.');

    if (body.hand) {
      const reordered = resolveHand(room, body.hand);
      if (reordered && sameIds(reordered, player.hand)) player.hand = reordered;
    }
    drawForPlayer(room, player);
    pushEvent(room, 'info', `${player.name} robó una ficha.`);
    if (checkPotExhausted(room)) return ok();
    nextTurn(room);
    return ok();
  }

  const ok = (extra) => Object.assign({ ok: true }, extra || {});
  const err = (message) => ({ ok: false, error: message });

  /* ============================================================
     Estado publico (por jugador: cada uno ve solo su propia mano)
     ============================================================ */

  function stateFor(room, viewer) {
    const cur = currentPlayer(room);
    return {
      id: room.id,
      status: room.status,
      hostId: room.hostId,
      config: room.config,
      players: room.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        online: p.online,
        tiles: p.hand.length,
        hasMelded: p.hasMelded,
        isTurn: room.status === 'playing' && i === room.turnIndex
      })),
      youId: viewer.id,
      currentId: room.status === 'playing' && cur ? cur.id : null,
      board: room.board,
      hand: viewer.hand,
      potCount: room.pot.length,
      turnDeadline: room.turnDeadline,
      result: room.status === 'finished' ? room.lastResult : null,
      events: room.events.slice(-10)
    };
  }

  /* ============================================================
     SSE
     ============================================================ */

  function broadcast(room) {
    for (const p of room.players) {
      const state = stateFor(room, p);
      for (const res of p.streams) {
        try { sseSend(res, 'state', state); } catch (_) { /* stream muerto */ }
      }
    }
  }

  /* relevo visual del tablero mientras el jugador activo reordena: solo
     para los demas, no toca el estado autoritativo (eso lo hace liveBoard
     al guardar room.pendingPlay) */
  function relayLiveBoard(room, from, resolvedBoard) {
    for (const p of room.players) {
      if (p === from) continue;
      for (const res of p.streams) {
        try { sseSend(res, 'liveBoard', resolvedBoard); } catch (_) { /* stream muerto */ }
      }
    }
  }

  function attachStream(room, player, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 2000\n\n');

    player.streams.add(res);
    const wasOffline = !player.online;
    player.online = true;
    clearEmptyTimer(room);
    if (wasOffline && room.status !== 'lobby') pushEvent(room, 'info', `${player.name} se reconectó.`);

    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (_) { /* ignorado */ }
    }, 20000);

    const close = () => {
      clearInterval(ping);
      player.streams.delete(res);
      if (player.streams.size > 0) return;
      player.online = false;

      if (room.status === 'lobby') {
        const deleted = removePlayer(room, player);
        if (!deleted) { pushEvent(room, 'info', `${player.name} salió de la sala.`); broadcast(room); }
        return;
      }

      pushEvent(room, 'info', `${player.name} se desconectó.`);
      /* margen antes de borrar la sala: al pasar del lobby al juego, todas
         las conexiones viejas cierran casi juntas mientras las nuevas del
         cliente aún no llegan — sin este margen se borraría una sala activa */
      if (room.players.every((p) => !p.online)) {
        clearEmptyTimer(room);
        room.emptyTimer = setTimeout(() => {
          room.emptyTimer = null;
          if (room.players.every((p) => !p.online)) {
            clearTurnTimer(room);
            rooms.delete(room.id);
            if (Ledger) Ledger.disposeRoom('rummy', room.id);
          }
        }, 8000);
      }
      broadcast(room);
    };
    res.on('close', close);
    res.on('error', close);

    sseSend(res, 'state', stateFor(room, player));
    broadcast(room);
  }

  RK.scheduleRoomCleanup(rooms, { gameSlug: 'rummy', Ledger, onDispose: clearTurnTimer });

  /* ---------- acciones ---------- */

  function handleAction(action, body) {
    /* crear sala */
    if (action === 'create') {
      const { room, player } = createRoom(body.name, body.config);
      return ok({ roomId: room.id, playerId: player.id, token: player.token, state: stateFor(room, player) });
    }

    /* unirse */
    if (action === 'join') {
      const room = rooms.get(String(body.roomId || '').toUpperCase().trim());
      if (!room) return err('No existe esa sala.');
      if (room.status !== 'lobby') return err('La partida ya comenzó.');
      if (room.players.length >= MAX_PLAYERS) return err(`Sala llena (máx ${MAX_PLAYERS}).`);
      const nameResult = RK.requireUniqueName(room, body.name);
      if (nameResult.error) return err(nameResult.error);
      const player = addPlayer(room, nameResult.name);
      pushEvent(room, 'info', `${player.name} se unió a la sala.`);
      broadcast(room);
      return ok({ roomId: room.id, playerId: player.id, token: player.token, state: stateFor(room, player) });
    }

    /* el resto exige identidad */
    const room = rooms.get(String(body.roomId || '').toUpperCase().trim());
    if (!room) return err('No existe esa sala.');
    const player = findPlayer(room, body.playerId, body.token);
    if (!player) return err('Jugador no reconocido.');

    let result;
    switch (action) {
      case 'start':
        if (player.id !== room.hostId) { result = err('Solo el anfitrión puede iniciar.'); break; }
        if (room.status === 'playing') { result = err('La partida ya está en curso.'); break; }
        if (room.players.length < 2) { result = err('Se necesitan al menos 2 jugadores.'); break; }
        beginGame(room);
        result = ok();
        break;

      case 'liveBoard': result = doLiveBoard(room, player, body); break;
      case 'endTurn': result = doEndTurn(room, player, body); break;
      case 'drawTile': result = doDrawTile(room, player, body); break;

      case 'restart':
        if (player.id !== room.hostId) { result = err('Solo el anfitrión puede reiniciar.'); break; }
        if (room.status !== 'finished') { result = err('La partida sigue en curso.'); break; }
        pushEvent(room, 'info', 'Nueva partida con los mismos jugadores.');
        beginGame(room);
        result = ok();
        break;

      case 'leave':
        if (room.status === 'lobby') {
          if (removePlayer(room, player)) return ok();
          pushEvent(room, 'info', `${player.name} salió de la sala.`);
        }
        result = ok();
        break;

      case 'state':
        result = ok({ state: stateFor(room, player) });
        break;

      default:
        return err('Acción desconocida.');
    }

    broadcast(room);
    return Object.assign(result, { state: stateFor(room, player) });
  }

  /* ============================================================
     HTTP (Express)
     ============================================================ */

  RK.mountRoomRoutes(router, {
    root: ROOT,
    getRoom: (code) => rooms.get(code),
    findPlayer,
    attachStream,
    handleAction,
    label: 'rummy'
  });

  return router;
}

module.exports = { createRouter };

/* ---------- standalone (fuera de GameCenter) ---------- */
if (require.main === module) {
  const http = require('http');
  const app = express();
  app.use('/', createRouter());
  const PORT = Number(process.env.PORT) || 3000;
  http.createServer(app).listen(PORT, () => {
    console.log(`\n  🁢  RUMMY (standalone)`);
    console.log(`  Juego:  http://localhost:${PORT}/\n`);
  });
}
