/* ============================================================
   ¿POR QUÉ SIEMPRE YO? — router de juego (montado por GameCenter)

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
      maxPlayers: clampInt(cfg && cfg.maxPlayers, 2, 8, 6),
      startMarbles: clampInt(cfg && cfg.startMarbles, 10, 20, 10),
      bettingEnabled,
      apuesta: bettingEnabled ? clampInt(cfg && cfg.apuesta, 0, 1e7, 500) : 0
    };

    const room = {
      id: roomCode(),
      hostId: null,
      config,
      players: [],
      status: 'lobby',
      board: E.newBoard(),
      turnIndex: 0,
      winnerId: null,
      turn: null,
      rollSeq: 0,
      rollLock: false,
      gameNo: 0,
      events: [],
      eventSeq: 0,
      endTimer: null,
      createdAt: Date.now()
    };

    const host = addPlayer(room, hostName);
    room.hostId = host.id;
    rooms.set(room.id, room);
    if (Ledger) Ledger.configureRoom('porqueyo', room.id, config);
    pushEvent(room, 'info', `${host.name} creó la sala ${room.id}.`);
    return { room, player: host };
  }

  function addPlayer(room, name) {
    const player = {
      id: uid(),
      token: uid(),
      name: cleanName(name, `Jugador ${room.players.length + 1}`),
      marbles: room.config.startMarbles,
      online: false,
      hasConnected: false,
      offlineAt: Date.now(),
      streams: new Set()
    };
    room.players.push(player);
    return player;
  }

  /* ============================================================
     Ciclo de partida
     ============================================================ */

  function startGame(room) {
    room.status = 'playing';
    room.winnerId = null;
    room.board = E.newBoard();
    room.gameNo += 1;

    for (const p of room.players) {
      p.marbles = room.config.startMarbles;
      if (Ledger && room.config.bettingEnabled && room.config.apuesta) {
        Ledger.recordEntry({ gameSlug: 'porqueyo', roomCode: room.id, playerId: p.id, playerName: p.name, amount: room.config.apuesta });
      }
    }

    room.lastRoll = null;
    room.turnIndex = Math.floor(Math.random() * room.players.length);   /* sorteo de quien empieza */
    pushEvent(room, 'info', `Sorteo: empieza ${room.players[room.turnIndex].name}.`);
    pushEvent(room, 'start',
      `Comienza la partida. Cada jugador tiene ${room.config.startMarbles} canicas.`);
    beginTurn(room);
  }

  function beginTurn(room) {
    RK.touchTurn(room);
    clearEndTimer(room);
    room.turn = null;
    room.rollLock = false;
    const p = currentPlayer(room);
    if (p) pushEvent(room, 'turn', `Turno de ${p.name}.`);
  }

  function clearEndTimer(room) {
    if (room.endTimer) {
      clearTimeout(room.endTimer);
      room.endTimer = null;
    }
  }

  /* el turno pasa al siguiente jugador tras un margen, para que el
     cliente termine de animar el lanzamiento y la colocacion */
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
    /* siempre el siguiente que sigue en la partida; a un desconectado se le
       salta el turno tras 25 s (scheduleSkipDisconnected) */
    const idx = RK.nextActiveIndex(room);
    room.turnIndex = idx;
    beginTurn(room);
  }

  function finishGame(room, winner, reason, text) {
    clearEndTimer(room);
    room.status = 'finished';
    room.winnerId = winner.id;
    room.rollLock = true;
    const prize = room.config.bettingEnabled ? room.config.apuesta * room.players.length : 0;
    room.lastPrize = prize;
    if (Ledger && prize) {
      Ledger.recordWin({ gameSlug: 'porqueyo', roomCode: room.id, playerId: winner.id, playerName: winner.name, amount: prize, reason });
    }
    pushEvent(room, 'win', text || `${winner.name} se queda sin canicas ${reason} y gana la partida.`);
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
      if (active.length === 1) finishGame(room, active[0], 'por abandono de los demás jugadores', `${active[0].name} gana por abandono de los demás jugadores.`);
      return;
    }
    if (wasCurrent) { clearEndTimer(room); nextTurn(room); }
  }

  /* ---------- lanzar el dado (resuelve todo el turno de una vez) ---------- */

  function doRoll(room, player) {
    if (room.status !== 'playing') return err('La partida no está activa.');
    if (currentPlayer(room) !== player) return err('No es tu turno.');
    if (room.rollLock) return err('Ya lanzaste. Espera el siguiente turno.');

    room.rollLock = true;

    const face = E.rollFace();
    const res = E.resolveRoll(room.board, face);
    room.board = res.board;

    let text;
    if (res.type === 'black') {
      player.marbles = Math.max(0, player.marbles - 1);
      text = `${player.name} sacó NEGRO: pierde 1 canica para siempre.`;
    } else if (res.type === 'place') {
      player.marbles = Math.max(0, player.marbles - 1);
      const zone = E.BY_ID[res.color];
      text = `${player.name} sacó ${zone.short}: coloca 1 canica (${res.filledAfter}/${res.cap}).`;
    } else {
      player.marbles += res.stolen;
      const zone = E.BY_ID[res.color];
      text = `${player.name} sacó ${zone.short} con la zona llena: se lleva ${res.stolen} canica${res.stolen === 1 ? '' : 's'}.`;
    }

    room.turn = {
      seq: ++room.rollSeq,
      playerId: player.id,
      playerName: player.name,
      face,
      resolution: res
    };
    room.lastRoll = room.turn;   /* el dado y el panel la conservan entre turnos */
    pushEvent(room, 'roll', text);

    const decreased = res.type === 'black' || res.type === 'place';
    if (decreased && player.marbles === 0) {
      finishGame(room, player, res.type === 'black' ? 'en la zona negra' : 'colocando su última canica');
      return ok();
    }

    scheduleEnd(room, 2200);
    return ok();
  }

  const ok = (extra) => Object.assign({ ok: true }, extra || {});
  const err = (message) => ({ ok: false, error: message });

  /* ============================================================
     Estado publico (sin tokens)
     ============================================================ */

  function publicState(room) {
    const cur = currentPlayer(room);

    return {
      id: room.id,
      status: room.status,
      hostId: room.hostId,
      config: room.config,
      winnerId: room.winnerId,
      currentId: room.status === 'playing' && cur ? cur.id : null,
      turnDeadline: RK.turnDeadline(room),
      now: Date.now(),
      board: room.board,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        marbles: p.marbles,
        online: p.online
      })),
      turn: room.turn,
      lastRoll: room.lastRoll || null,
      events: room.events.slice(-10),
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
          const deleted = RK.removePlayerFromLobby(rooms, room, player, { Ledger, gameSlug: 'porqueyo' });
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
    /* en este juego el turno es un unico lanzamiento: si se agota el tiempo
       se lanza el dado automaticamente por el jugador (el turno pasa despues,
       como en cualquier tirada) */
    onIdle(room, cur) {
      if (room.rollLock) return;
      pushEvent(room, 'timeout', `${cur.name} no lanzó en 45 s: el dado se lanza automáticamente.`);
      doRoll(room, cur);
    }
  });
  RK.scheduleRoomCleanup(rooms, { gameSlug: 'porqueyo', Ledger });
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
        const deleted = RK.removePlayerFromLobby(rooms, room, player, { Ledger, gameSlug: 'porqueyo' });
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
          if (RK.removePlayerFromLobby(rooms, room, player, { Ledger, gameSlug: 'porqueyo' })) return ok();
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
    label: 'porqueyo'
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
    console.log(`\n  🎲  ¿POR QUÉ SIEMPRE YO? (standalone)`);
    console.log(`  Juego:  http://localhost:${PORT}/\n`);
  });
}
