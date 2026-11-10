/* ============================================================
   TAPADOS — router de juego (montado por GameCenter)

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

function createRouter({ Ledger } = {}) {
  const router = express.Router();

  /* ============================================================
     Estado en memoria
     ============================================================ */

  const rooms = new Map();

  const roomCode = RK.makeRoomCode(rooms);
  const { uid, cleanName, clampInt, findPlayer, currentPlayer, pushEvent, sseSend } = RK;

  /* ============================================================
     Sala
     ============================================================ */

  function createRoom(hostName, cfg) {
    const bettingEnabled = !!(cfg && cfg.bettingEnabled);
    const config = {
      maxPlayers: clampInt(cfg && cfg.maxPlayers, 2, 6, 4),
      bettingEnabled,
      apuesta: bettingEnabled ? clampInt(cfg && cfg.apuesta, 0, 1e7, 500) : 0
    };

    const room = {
      id: roomCode(),
      hostId: null,
      config,
      players: [],
      status: 'lobby',
      turnIndex: 0,
      winnerId: null,
      turn: null,
      events: [],
      eventSeq: 0,
      endTimer: null,
      createdAt: Date.now()
    };

    const host = addPlayer(room, hostName);
    room.hostId = host.id;
    rooms.set(room.id, room);
    if (Ledger) Ledger.configureRoom('tapados', room.id, config);
    pushEvent(room, 'info', `${host.name} creó la sala ${room.id}.`);
    return { room, player: host };
  }

  function addPlayer(room, name) {
    const player = {
      id: uid(),
      token: uid(),
      name: cleanName(name, `Jugador ${room.players.length + 1}`),
      board: E.newBoard(),
      online: false,
      hasConnected: false,
      offlineAt: Date.now(),
      streams: new Set()
    };
    room.players.push(player);
    return player;
  }

  /* siguiente indice de turno: prioriza jugadores conectados */
  function computeNextIndex(room) {
    /* siempre el siguiente que sigue en la partida; a un desconectado se le
       salta el turno tras 25 s (scheduleSkipDisconnected) */
    const idx = RK.nextActiveIndex(room);
    return idx;
  }

  /* ============================================================
     Ciclo de partida
     ============================================================ */

  function startGame(room) {
    room.status = 'playing';
    room.winnerId = null;
    room.lastDie = null;   /* ultima tirada de la partida: el dado la conserva entre turnos */

    for (const p of room.players) {
      p.board = E.newBoard();
      if (room.config.bettingEnabled && room.config.apuesta && Ledger) {
        Ledger.recordEntry({ gameSlug: 'tapados', roomCode: room.id, playerId: p.id, playerName: p.name, amount: room.config.apuesta });
      }
    }

    room.turnIndex = Math.floor(Math.random() * room.players.length);   /* sorteo de quien empieza */
    pushEvent(room, 'info', `Sorteo: empieza ${room.players[room.turnIndex].name}.`);
    pushEvent(room, 'start', 'Comienza la partida. ¡Buena suerte a todos!');
    beginTurn(room);
  }

  function beginTurn(room) {
    RK.touchTurn(room);
    clearEndTimer(room);
    room.turn = {
      rolled: false,
      die: null,
      action: null,      /* 'covered' | 'uncovered' */
      phase: 'ready',     /* ready | ending */
      log: []
    };
    const p = currentPlayer(room);
    if (p) pushEvent(room, 'turn', `Turno de ${p.name}.`);
  }

  function clearEndTimer(room) {
    if (room.endTimer) {
      clearTimeout(room.endTimer);
      room.endTimer = null;
    }
  }

  /* el turno se cierra tras un margen para que el cliente termine sus animaciones */
  function scheduleEnd(room, ms) {
    clearEndTimer(room);
    room.endTimer = setTimeout(() => {
      room.endTimer = null;
      nextTurn(room);
      broadcast(room);
    }, ms);
  }

  function nextTurn(room) {
    if (room.status !== 'playing') return;
    room.turnIndex = computeNextIndex(room);
    beginTurn(room);
  }

  function finishGame(room, winner, reason) {
    clearEndTimer(room);
    room.status = 'finished';
    room.winnerId = winner.id;
    /* room.turn se conserva: el cliente anima la tirada ganadora (dado y
       registro) antes de mostrar el modal; startGame lo reinicia */
    const prize = room.config.bettingEnabled ? room.config.apuesta * room.players.length : 0;
    room.lastPrize = prize;
    if (Ledger && prize) {
      Ledger.recordWin({ gameSlug: 'tapados', roomCode: room.id, playerId: winner.id, playerName: winner.name, amount: prize, reason });
    }
    pushEvent(room, 'win', `${winner.name} gana ${reason}.`);
  }

  /* salir durante la partida o al terminarla: el jugador queda fuera de los
     turnos, cobros y revanchas. Si solo queda un jugador en la partida, gana
     por abandono de los demas */
  function leaveGame(room, player) {
    const wasCurrent = room.status === 'playing' && currentPlayer(room) === player;
    RK.markLeft(room, player);
    if (room.status !== 'playing') return;
    const active = RK.activePlayers(room);
    if (active.length < 2) {
      if (active.length === 1) finishGame(room, active[0], 'por abandono de los demás jugadores');
      return;
    }
    if (wasCurrent) { clearEndTimer(room); nextTurn(room); }
  }

  /* ---------- lanzar ---------- */

  function doRoll(room, player) {
    if (room.status !== 'playing') return err('La partida no está activa.');
    if (currentPlayer(room) !== player) return err('No es tu turno.');

    const t = room.turn;
    if (t.rolled) return err('Ya lanzaste el dado en este turno.');

    const die = E.rollDie();
    const wasCovered = !!player.board[die];
    player.board[die] = !wasCovered;

    t.rolled = true;
    t.die = die;
    room.lastDie = die;
    t.action = wasCovered ? 'uncovered' : 'covered';
    t.log.push({ n: 1, die, result: t.action });

    pushEvent(room, t.action === 'covered' ? 'cover' : 'uncover',
      t.action === 'covered'
        ? `${player.name} lanza ${die} y tapa el ${die}.`
        : `${player.name} lanza ${die} y destapa el ${die}.`);

    if (E.boardComplete(player.board)) {
      finishGame(room, player, 'tapando las 6 posiciones');
      return ok();
    }

    t.phase = 'ending';
    scheduleEnd(room, 1600);
    return ok();
  }

  const ok = (extra) => Object.assign({ ok: true }, extra || {});
  const err = (message) => ({ ok: false, error: message });

  /* ============================================================
     Estado publico (sin tokens)
     ============================================================ */

  function publicState(room) {
    const cur = currentPlayer(room);
    const t = room.turn;

    return {
      id: room.id,
      status: room.status,
      hostId: room.hostId,
      config: room.config,
      winnerId: room.winnerId,
      currentId: room.status === 'playing' && cur ? cur.id : null,
      turnDeadline: RK.turnDeadline(room),
      now: Date.now(),
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        online: p.online,
        filled: E.boardFilled(p.board),
        board: p.board
      })),
      lastDie: room.lastDie || null,
      turn: t
        ? {
            rolled: t.rolled,
            die: t.die,
            action: t.action,
            phase: t.phase,
            log: t.log
          }
        : null,
      events: room.events.slice(-10),
      total: E.TOTAL,
      prize: room.status === 'finished' ? (room.lastPrize || 0) : 0
    };
  }

  /* ============================================================
     SSE
     ============================================================ */

  function broadcast(room) {
    const state = publicState(room);
    for (const p of room.players) {
      for (const res of p.streams) {
        try { sseSend(res, 'state', state); } catch (_) { /* stream muerto */ }
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
    RK.cancelLobbyRemoval(player);
    player.online = true;
    player.hasConnected = true;

    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (_) { /* ignorado */ }
    }, 20000);

    const close = () => {
      clearInterval(ping);
      player.streams.delete(res);
      if (player.streams.size > 0) return;
      player.online = false;
      player.offlineAt = Date.now();

      if (room.status === 'lobby') {
        /* margen de gracia: una recarga o un corte breve no expulsan de la sala */
        RK.scheduleLobbyRemoval(room, player, () => {
          const deleted = RK.removePlayerFromLobby(rooms, room, player, { Ledger, gameSlug: 'tapados' });
          if (!deleted) { pushEvent(room, 'info', `${player.name} salió de la sala.`); broadcast(room); }
        });
        broadcast(room);
        return;
      }

      pushEvent(room, 'info', `${player.name} se desconectó.`);
      broadcast(room);
    };
    res.on('close', close);
    res.on('error', close);

    sseSend(res, 'state', publicState(room));
    broadcast(room);
  }

  RK.scheduleSkipDisconnected(rooms, { nextTurn, broadcast });
  RK.scheduleIdleTurns(rooms, {
    broadcast,
    onIdle(room, cur) {
      pushEvent(room, 'timeout', `${cur.name} no jugó en 45 s: pierde el turno.`);
      clearEndTimer(room);
      nextTurn(room);
    }
  });
  RK.scheduleRoomCleanup(rooms, { gameSlug: 'tapados', Ledger });
  RK.scheduleHostCheck(rooms, { broadcast });

  /* ---------- acciones ---------- */

  function handleAction(action, body) {
    /* crear sala */
    if (action === 'create') {
      const { room, player } = createRoom(body.name, body.config);
      return ok({ roomId: room.id, playerId: player.id, token: player.token, state: publicState(room) });
    }

    /* unirse */
    if (action === 'join') {
      const room = rooms.get(String(body.roomId || '').toUpperCase().trim());
      if (!room) return err('No existe esa sala.');
      if (room.status !== 'lobby') return err('La partida ya comenzó.');
      if (room.players.length >= room.config.maxPlayers) return err('La sala está llena.');
      const nameResult = RK.requireUniqueName(room, body.name);
      if (nameResult.error) return err(nameResult.error);
      const player = addPlayer(room, nameResult.name);
      pushEvent(room, 'info', `${player.name} se unió a la sala.`);
      /* quien se une y nunca abre la conexion no ocupa el asiento para siempre */
      RK.scheduleLobbyRemoval(room, player, () => {
        const deleted = RK.removePlayerFromLobby(rooms, room, player, { Ledger, gameSlug: 'tapados' });
        if (!deleted) { pushEvent(room, 'info', `${player.name} no llegó a conectarse y salió de la sala.`); broadcast(room); }
      }, RK.GHOST_MS);
      broadcast(room);
      return ok({ roomId: room.id, playerId: player.id, token: player.token, state: publicState(room) });
    }

    /* el resto exige identidad */
    const room = rooms.get(String(body.roomId || '').toUpperCase().trim());
    if (!room) return err('No existe esa sala.');
    const player = findPlayer(room, body.playerId, body.token);
    if (!player) return err('Jugador no reconocido.');
    if (room.status === 'playing' && action !== 'state' && RK.currentPlayer(room) === player) RK.touchTurn(room);

    let result;
    switch (action) {
      case 'start':
        if (player.id !== room.hostId) { result = err('Solo el anfitrión puede iniciar.'); break; }
        if (room.status === 'playing') { result = err('La partida ya está en curso.'); break; }
        if (room.status === 'finished') {
          const restartError = RK.prepareRestart(room);
          if (restartError) { result = err(restartError); break; }
        }
        if (room.players.length < 2) { result = err('Se necesitan al menos 2 jugadores.'); break; }
        startGame(room);
        result = ok();
        break;

      case 'roll': result = doRoll(room, player); break;

      case 'restart':
        if (player.id !== room.hostId) { result = err('Solo el anfitrión puede reiniciar.'); break; }
        if (room.status !== 'finished') { result = err('La partida sigue en curso.'); break; }
        { const restartError = RK.prepareRestart(room); if (restartError) { result = err(restartError); break; } }
        pushEvent(room, 'info', 'Nueva partida con los mismos jugadores.');
        startGame(room);
        result = ok();
        break;

      case 'leave':
        if (room.status === 'lobby') {
          if (RK.removePlayerFromLobby(rooms, room, player, { Ledger, gameSlug: 'tapados' })) return ok();
          pushEvent(room, 'info', `${player.name} salió de la sala.`);
        } else {
          leaveGame(room, player);
        }
        result = ok();
        break;

      case 'state':
        result = ok({ state: publicState(room) });
        break;

      default:
        return err('Acción desconocida.');
    }

    broadcast(room);
    return Object.assign(result, { state: publicState(room) });
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
    label: 'tapados'
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
    console.log(`\n  🔲  TAPADOS (standalone)`);
    console.log(`  Juego:  http://localhost:${PORT}/\n`);
  });
}
