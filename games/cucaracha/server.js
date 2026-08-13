/* ============================================================
   CUCARACHA — router de juego (montado por GameCenter)

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
      bettingEnabled,
      apuesta: bettingEnabled ? clampInt(cfg && cfg.apuesta, 0, 1e7, 500) : 0,
      castigo: bettingEnabled ? clampInt(cfg && cfg.castigo, 0, 1e7, 100) : 0,
      maxPlayers: clampInt(cfg && cfg.maxPlayers, 2, 6, 6)
    };

    const room = {
      id: roomCode(),
      hostId: null,
      config,
      players: [],
      status: 'lobby',
      pot: 0,
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
    if (Ledger) Ledger.configureRoom('cucaracha', room.id, config);
    pushEvent(room, 'info', `${host.name} creó la sala ${room.id}.`);
    return { room, player: host };
  }

  function addPlayer(room, name) {
    const player = {
      id: uid(),
      token: uid(),
      name: cleanName(name, `Jugador ${room.players.length + 1}`),
      credits: 0,
      board: E.newBoard(),
      online: false,
      hasConnected: false,
      offlineAt: Date.now(),
      streams: new Set()
    };
    room.players.push(player);
    return player;
  }

  /* ============================================================
     Dinero
     ============================================================ */

  /* sin capital inicial: no hay techo de saldo, credits es un contador
     informativo de ganancias/pérdidas de la partida (ver DESIGN.md sección 10) */
  function charge(player, amount) {
    player.credits -= amount;
    return amount;
  }

  /* todos menos `to` pagan el castigo a `to` */
  function othersPayPlayer(room, to) {
    let total = 0;
    for (const p of room.players) {
      if (p === to) continue;
      const paid = charge(p, room.config.castigo);
      total += paid;
      if (Ledger && room.config.bettingEnabled && paid) {
        Ledger.recordPenalty({
          gameSlug: 'cucaracha', roomCode: room.id,
          playerId: p.id, playerName: p.name, amount: paid, reason: 'castigo',
          toPlayerId: to.id, toPlayerName: to.name
        });
      }
    }
    to.credits += total;
    return total;
  }

  /* todos los jugadores pagan el castigo al pozo */
  function allPayPot(room) {
    let total = 0;
    for (const p of room.players) {
      const paid = charge(p, room.config.castigo);
      total += paid;
      if (Ledger && room.config.bettingEnabled && paid) {
        Ledger.recordPenalty({
          gameSlug: 'cucaracha', roomCode: room.id,
          playerId: p.id, playerName: p.name, amount: paid, reason: 'castigo-pozo'
        });
      }
    }
    room.pot += total;
    return total;
  }

  /* ============================================================
     Ciclo de partida
     ============================================================ */

  function startGame(room) {
    room.status = 'playing';
    room.winnerId = null;
    room.pot = 0;

    for (const p of room.players) {
      p.board = E.newBoard();
      const paid = charge(p, room.config.apuesta);
      room.pot += paid;
      if (Ledger && room.config.bettingEnabled && paid) {
        Ledger.recordEntry({ gameSlug: 'cucaracha', roomCode: room.id, playerId: p.id, playerName: p.name, amount: paid });
      }
    }

    room.turnIndex = 0;
    pushEvent(room, 'start',
      `Comienza la partida. Cada jugador aportó $${room.config.apuesta.toLocaleString('en-US')} al pozo.`);
    beginTurn(room);
  }

  function beginTurn(room) {
    clearEndTimer(room);
    room.turn = {
      rollNo: 0,
      dice: [],
      kept: [],
      pending: 0,
      phase: 'ready',      /* ready | active | ending */
      mustEnd: false,
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
    const n = room.players.length;
    let idx = (room.turnIndex + 1) % n;          /* por defecto, el siguiente */
    for (let i = 1; i <= n; i++) {               /* si hay alguien conectado, ese */
      const cand = (room.turnIndex + i) % n;
      if (room.players[cand].online) { idx = cand; break; }
    }
    room.turnIndex = idx;
    beginTurn(room);
  }

  function finishGame(room, winner, reason) {
    clearEndTimer(room);
    room.status = 'finished';
    room.winnerId = winner.id;
    const prize = room.pot;
    winner.credits += prize;
    room.pot = 0;
    room.turn = null;
    room.lastPrize = room.config.bettingEnabled ? prize : 0;
    if (Ledger && room.config.bettingEnabled && prize) {
      Ledger.recordWin({ gameSlug: 'cucaracha', roomCode: room.id, playerId: winner.id, playerName: winner.name, amount: prize, reason });
    }
    pushEvent(room, 'win',
      `${winner.name} gana ${reason} y se lleva $${prize.toLocaleString('en-US')} del pozo.`);
  }

  /* ---------- lanzar ---------- */

  function doRoll(room, player) {
    if (room.status !== 'playing') return err('La partida no está activa.');
    if (currentPlayer(room) !== player) return err('No es tu turno.');

    const t = room.turn;
    if (t.phase === 'ending') return err('Tu turno ya terminó.');

    const remaining = E.DICE_COUNT - t.kept.length;
    if (remaining <= 0) return err('No quedan dados por lanzar.');

    const dice = E.rollDice(remaining);
    const a = E.analyzeRoll(dice);

    t.rollNo += 1;
    t.dice = dice;
    t.log.push({ n: t.rollNo, dice, ones: a.ones });

    /* victoria inmediata: los cinco dados iguales en un mismo lanzamiento */
    if (a.fiveKind) {
      pushEvent(room, 'jackpot', `¡${player.name} sacó cinco ${a.fiveKind.value}! Final anticipado.`);
      finishGame(room, player, `con cinco dados de valor ${a.fiveKind.value}`);
      return ok();
    }

    for (let i = 0; i < a.ones; i++) t.kept.push(1);
    t.pending += a.ones;

    /* cuatro dados iguales distintos de 1 */
    if (a.fourKind) {
      if (a.fourKind.withOne) {
        const got = othersPayPlayer(room, player);
        pushEvent(room, 'reward',
          `${player.name} sacó cuatro ${a.fourKind.value} y un 1: los demás le pagan $${got.toLocaleString('en-US')}.`);
      } else {
        const put = allPayPot(room);
        pushEvent(room, 'penalty',
          `Cuatro ${a.fourKind.value} sin ningún 1: todos pagan al pozo ($${put.toLocaleString('en-US')}).`);
      }
    }

    /* castigo por no sacar ningun 1 en el primer lanzamiento
       (si hubo cuatro iguales, ese caso ya aplico su propio pago) */
    if (t.rollNo === 1 && a.ones === 0 && !a.fourKind) {
      const paid = charge(player, room.config.castigo);
      room.pot += paid;
      if (Ledger && room.config.bettingEnabled && paid) {
        Ledger.recordPenalty({
          gameSlug: 'cucaracha', roomCode: room.id,
          playerId: player.id, playerName: player.name, amount: paid, reason: 'sin-unos'
        });
      }
      pushEvent(room, 'penalty',
        `${player.name} no sacó ningún 1 y pagó $${paid.toLocaleString('en-US')} de multa al pozo.`);
    }

    /* los cinco dados en 1 durante los dos primeros lanzamientos */
    if (t.rollNo === 2 && t.kept.length === E.DICE_COUNT) {
      const got = othersPayPlayer(room, player);
      pushEvent(room, 'reward',
        `¡${player.name} completó cinco 1 en dos lanzamientos! Los demás le pagan $${got.toLocaleString('en-US')}.`);
    }

    /* transicion de fase */
    if (a.ones === 0) {
      t.phase = 'ending';
      scheduleEnd(room, 3400);
    } else {
      t.phase = 'active';
      if (t.kept.length >= E.DICE_COUNT) {
        t.mustEnd = true;
        if (!E.canPlaceAnything(player.board, t.pending)) scheduleEnd(room, 2600);
      }
    }

    return ok();
  }

  /* ---------- colocar ficha ---------- */

  function doPlace(room, player, slotId) {
    if (room.status !== 'playing') return err('La partida no está activa.');
    if (currentPlayer(room) !== player) return err('No es tu turno.');

    const t = room.turn;
    if (t.phase === 'ready') return err('Primero lanza los dados.');

    const slot = E.BY_ID[slotId];
    if (!slot) return err('Posición inexistente.');
    if (player.board[slotId]) return err('Esa posición ya está completa.');
    if (slot.v > t.pending) return err(`Necesitas ${slot.v} unos para esa posición.`);
    if (slot.id === E.FINAL_SLOT && E.boardFilled(player.board) < E.TOTAL - 1) {
      return err('La posición de valor 3 se completa al final.');
    }

    player.board[slotId] = true;
    t.pending -= slot.v;

    if (E.boardFilled(player.board) >= E.TOTAL) {
      finishGame(room, player, 'completando su tablero');
      return ok();
    }

    /* sin dados por lanzar y sin jugadas posibles: cerrar el turno */
    if (t.mustEnd && !E.canPlaceAnything(player.board, t.pending)) scheduleEnd(room, 1600);

    return ok();
  }

  /* ---------- terminar turno ---------- */

  function doEndTurn(room, player) {
    if (room.status !== 'playing') return err('La partida no está activa.');
    if (currentPlayer(room) !== player) return err('No es tu turno.');
    const t = room.turn;
    if (t.phase !== 'ending' && !t.mustEnd) return err('Aún debes seguir lanzando.');
    clearEndTimer(room);
    nextTurn(room);
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
      pot: room.pot,
      winnerId: room.winnerId,
      currentId: room.status === 'playing' && cur ? cur.id : null,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        credits: p.credits,
        online: p.online,
        filled: E.boardFilled(p.board),
        board: p.board
      })),
      turn: t
        ? {
            rollNo: t.rollNo,
            dice: t.dice,
            kept: t.kept.length,
            pending: t.pending,
            phase: t.phase,
            mustEnd: t.mustEnd,
            remaining: E.DICE_COUNT - t.kept.length,
            log: t.log,
            placeable: cur ? E.placeableSlots(cur.board, t.pending) : []
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
        const deleted = RK.removePlayerFromLobby(rooms, room, player, { Ledger, gameSlug: 'cucaracha' });
        if (!deleted) { pushEvent(room, 'info', `${player.name} salió de la sala.`); broadcast(room); }
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
  RK.scheduleRoomCleanup(rooms, { gameSlug: 'cucaracha', Ledger });

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
      broadcast(room);
      return ok({ roomId: room.id, playerId: player.id, token: player.token, state: publicState(room) });
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
        startGame(room);
        result = ok();
        break;

      case 'roll':   result = doRoll(room, player); break;
      case 'place':  result = doPlace(room, player, String(body.slotId || '')); break;
      case 'endturn': result = doEndTurn(room, player); break;

      case 'restart':
        if (player.id !== room.hostId) { result = err('Solo el anfitrión puede reiniciar.'); break; }
        if (room.status !== 'finished') { result = err('La partida sigue en curso.'); break; }
        pushEvent(room, 'info', 'Nueva partida con los mismos jugadores.');
        startGame(room);
        result = ok();
        break;

      case 'leave':
        if (room.status === 'lobby') {
          if (RK.removePlayerFromLobby(rooms, room, player, { Ledger, gameSlug: 'cucaracha' })) return ok();
          pushEvent(room, 'info', `${player.name} salió de la sala.`);
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
    label: 'cucaracha'
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
    console.log(`\n  🪳  CUCARACHA (standalone)`);
    console.log(`  Juego:  http://localhost:${PORT}/\n`);
  });
}
