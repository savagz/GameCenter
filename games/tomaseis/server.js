/* ============================================================
   TOMA 6 — router de juego (montado por GameCenter)

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
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10; /* 104 cartas = 10 jugadores x 10 cartas + 4 de las filas */
const REVEAL_PAUSE_MS = 1100; /* pausa entre cada carta revelada al resolver la ronda */
const CHOOSE_SECONDS = 45;    /* tiempo para elegir carta; al agotarse se juega la mas baja */
const ROW_SECONDS = 20;       /* tiempo para elegir fila; al agotarse se toma la mas barata */

function createRouter({ Ledger } = {}) {
  const router = express.Router();

  /* ============================================================
     Estado en memoria
     ============================================================ */

  const rooms = new Map();

  const roomCode = RK.makeRoomCode(rooms);
  const { uid, cleanName, findPlayer, pushEvent, sseSend } = RK;

  /* ============================================================
     Sala
     ============================================================ */

  function createRoom(hostName, cfg) {
    const bettingEnabled = !!(cfg && cfg.bettingEnabled);
    const maxPlayers = RK.clampInt(cfg && cfg.maxPlayers, MIN_PLAYERS, MAX_PLAYERS, 6);
    const config = {
      maxPlayers,
      bettingEnabled,
      apuesta: bettingEnabled ? Math.max(0, Math.floor(Number(cfg && cfg.apuesta) || 0)) : 0
    };

    const room = {
      id: roomCode(),
      hostId: null,
      config,
      players: [],
      status: 'lobby',
      rows: [],
      round: 0,
      totalRounds: E.HAND_SIZE,
      phase: 'choosing',
      resolveQueue: null,
      resolveIndex: 0,
      awaitingPlayerId: null,
      placements: [],
      resolveTimer: null,
      phaseTimer: null,
      deadline: null,
      emptyTimer: null,
      lastResult: null,
      events: [],
      eventSeq: 0,
      createdAt: Date.now()
    };

    const host = addPlayer(room, hostName);
    room.hostId = host.id;
    rooms.set(room.id, room);
    if (Ledger) Ledger.configureRoom('tomaseis', room.id, config);
    pushEvent(room, 'info', `${host.name} creó la sala ${room.id}.`);
    return { room, player: host };
  }

  function addPlayer(room, name) {
    const player = {
      id: uid(),
      token: uid(),
      name: cleanName(name, `Jugador ${room.players.length + 1}`),
      hand: [],
      stars: 0,
      cardsTaken: 0,
      chosenCardId: null,
      online: false,
      offlineAt: Date.now(),
      streams: new Set()
    };
    room.players.push(player);
    return player;
  }

  function removePlayer(room, player) {
    const deleted = RK.removePlayerFromLobby(rooms, room, player, { Ledger, gameSlug: 'tomaseis' });
    return deleted;
  }

  /* ============================================================
     Ciclo de partida
     ============================================================ */

  function beginGame(room) {
    const { hands, rows } = E.dealGame(room.players.length);
    room.rows = rows;
    room.round = 0;
    room.status = 'playing';
    room.lastResult = null;
    room.players.forEach((p, i) => { p.hand = hands[i]; p.stars = 0; p.cardsTaken = 0; p.chosenCardId = null; });
    if (Ledger && room.config.bettingEnabled && room.config.apuesta) {
      for (const p of room.players) {
        Ledger.recordEntry({ gameSlug: 'tomaseis', roomCode: room.id, playerId: p.id, playerName: p.name, amount: room.config.apuesta });
      }
    }

    pushEvent(room, 'start', 'Comienza la partida. ¡Buena suerte a todos!');
    startRound(room);
  }

  function clearEmptyTimer(room) {
    if (room.emptyTimer) {
      clearTimeout(room.emptyTimer);
      room.emptyTimer = null;
    }
  }

  function clearResolveTimer(room) {
    if (room.resolveTimer) {
      clearTimeout(room.resolveTimer);
      room.resolveTimer = null;
    }
  }

  function clearPhaseTimer(room) {
    if (room.phaseTimer) {
      clearTimeout(room.phaseTimer);
      room.phaseTimer = null;
    }
    room.deadline = null;
  }

  function clearAllTimers(room) {
    clearResolveTimer(room);
    clearPhaseTimer(room);
  }

  /* reloj de la fase actual (elegir carta o elegir fila): al vencer ejecuta
     la jugada automatica y transmite el nuevo estado */
  function startPhaseTimer(room, seconds, onExpire) {
    clearPhaseTimer(room);
    room.deadline = Date.now() + seconds * 1000;
    room.phaseTimer = setTimeout(() => {
      room.phaseTimer = null;
      room.deadline = null;
      if (room.status !== 'playing') return;
      onExpire();
      broadcast(room);
    }, seconds * 1000);
  }

  /* quien no eligio a tiempo juega su carta mas baja (la mano esta ordenada) */
  function autoChooseCards(room) {
    if (room.phase !== 'choosing') return;
    for (const p of room.players) {
      if (p.chosenCardId || p.hand.length === 0) continue;
      p.chosenCardId = p.hand[0].id;
      pushEvent(room, 'info', `${p.name} no eligió a tiempo: se juega automáticamente su carta más baja.`);
    }
    beginReveal(room);
    resolveLoop(room);
  }

  /* fila mas barata: menos estrellas; si empatan, menos cartas; si siguen
     empatadas, la de menor indice */
  function cheapestRowIndex(rows) {
    let best = 0;
    rows.forEach((row, i) => {
      const s = E.rowStars(row);
      const bs = E.rowStars(rows[best]);
      if (s < bs || (s === bs && row.length < rows[best].length)) best = i;
    });
    return best;
  }

  function startRound(room) {
    clearAllTimers(room);
    room.round += 1;
    room.phase = 'choosing';
    room.resolveQueue = null;
    room.resolveIndex = 0;
    room.awaitingPlayerId = null;
    room.placements = [];
    room.players.forEach((p) => { p.chosenCardId = null; });

    const active = room.players.filter((p) => p.hand.length > 0);
    const isLastRound = active.length > 0 && active.every((p) => p.hand.length === 1);
    if (isLastRound) {
      active.forEach((p) => { p.chosenCardId = p.hand[0].id; });
      pushEvent(room, 'lastRound', 'Última ronda: a cada jugador le queda una sola carta y se juega automáticamente.');
      beginReveal(room);
      resolveLoop(room);
      return;
    }

    pushEvent(room, 'turn', `Ronda ${room.round}: elige una carta.`);
    for (const p of room.players) {
      if (p.left && p.hand.length > 0) {
        p.chosenCardId = p.hand[0].id;
        pushEvent(room, 'info', `${p.name} abandonó: se juega automáticamente su carta más baja.`);
      }
    }
    startPhaseTimer(room, CHOOSE_SECONDS, () => autoChooseCards(room));
  }

  function beginReveal(room) {
    const queue = room.players
      .filter((p) => p.chosenCardId)
      .map((p) => ({ playerId: p.id, card: p.hand.find((c) => c.id === p.chosenCardId) }))
      .sort((a, b) => a.card.num - b.card.num);
    clearPhaseTimer(room);
    room.resolveQueue = queue;
    room.resolveIndex = 0;
    room.placements = [];
    room.phase = 'resolving';
    pushEvent(room, 'reveal', `Cartas reveladas: ${queue.map((q) => {
      const p = room.players.find((pl) => pl.id === q.playerId);
      return `${p.name}(${q.card.num})`;
    }).join(', ')}`);
  }

  /* procesa la cola de resolución de a una carta por vez: cada carta se
     coloca, se transmite ese estado a todos (para que el cliente anuncie
     "Carta de N en fila X") y recién luego de una pausa se procesa la
     siguiente. Se detiene si topa con una carta que exige elección manual
     de fila (regla 8), a la espera de doChooseRow. */
  function resolveLoop(room) {
    clearResolveTimer(room);

    if (room.resolveIndex >= room.resolveQueue.length) {
      finishRound(room);
      broadcast(room);
      return;
    }

    const item = room.resolveQueue[room.resolveIndex];
    const player = room.players.find((p) => p.id === item.playerId);
    const card = item.card;
    const result = E.placeCard(room.rows, card);

    if (result.type === 'needChoice') {
      room.phase = 'awaitingRow';
      room.awaitingPlayerId = item.playerId;
      pushEvent(room, 'info', `${player.name} debe elegir una fila: su ${card.num} es menor que todas.`);
      startPhaseTimer(room, ROW_SECONDS, () => {
        if (room.phase !== 'awaitingRow' || room.awaitingPlayerId !== player.id) return;
        const ri = cheapestRowIndex(room.rows);
        pushEvent(room, 'info', `${player.name} no eligió fila a tiempo: se lleva automáticamente la fila ${ri + 1}, ` +
          `la más barata (★ ${E.rowStars(room.rows[ri])}, ${room.rows[ri].length} carta${room.rows[ri].length === 1 ? '' : 's'}).`);
        resolveAwaitingRow(room, ri);
      });
      broadcast(room);
      return;
    }

    applyPlacement(room, player, card, result);
    room.resolveIndex += 1;
    broadcast(room);

    room.resolveTimer = setTimeout(() => resolveLoop(room), REVEAL_PAUSE_MS);
  }

  function applyPlacement(room, player, card, result) {
    let taken = [];
    if (result.type === 'take') {
      taken = room.rows[result.rowIndex];
      room.rows[result.rowIndex] = [card];
    } else {
      room.rows[result.rowIndex].push(card);
    }
    if (taken.length > 0) {
      const gained = E.rowStars(taken);
      player.stars += gained;
      player.cardsTaken += taken.length;
      pushEvent(room, 'info', `${player.name} se lleva ${taken.length} cartas (+${gained} estrellas).`);
    }
    room.placements.push({ playerId: player.id, card, rowIndex: result.rowIndex, taken, mode: result.type });
    player.hand = player.hand.filter((c) => c.id !== card.id);
  }

  function resolveAwaitingRow(room, rowIndex) {
    const item = room.resolveQueue[room.resolveIndex];
    const player = room.players.find((p) => p.id === item.playerId);
    const card = item.card;
    clearPhaseTimer(room);
    const taken = room.rows[rowIndex];
    room.rows[rowIndex] = [card];
    player.stars += E.rowStars(taken);
    player.cardsTaken += taken.length;
    pushEvent(room, 'info', `${player.name} elige la fila y se lleva ${taken.length} cartas (+${E.rowStars(taken)} estrellas).`);
    room.placements.push({ playerId: player.id, card, rowIndex, taken, mode: 'choice' });
    player.hand = player.hand.filter((c) => c.id !== card.id);
    room.resolveIndex += 1;
    room.phase = 'resolving';
    room.awaitingPlayerId = null;
    broadcast(room);

    clearResolveTimer(room);
    room.resolveTimer = setTimeout(() => resolveLoop(room), REVEAL_PAUSE_MS);
  }

  function finishRound(room) {
    if (room.players.every((p) => p.hand.length === 0)) {
      endGame(room);
      return;
    }
    startRound(room);
  }

  /* gana quien tenga menos estrellas; si empatan, quien se haya llevado menos
     cartas; si siguen empatados, la partida termina en empate y el bote se
     reparte a partes iguales entre ellos */
  function endGame(room) {
    clearAllTimers(room);
    room.status = 'finished';
    const scores = room.players.map((p) => ({ id: p.id, name: p.name, points: p.stars, cards: p.cardsTaken }));
    const contenders = RK.activePlayers(room).length ? RK.activePlayers(room) : room.players;
    const minStars = Math.min(...contenders.map((p) => p.stars));
    const byStars = contenders.filter((p) => p.stars === minStars);
    const minCards = Math.min(...byStars.map((p) => p.cardsTaken));
    const winners = byStars.filter((p) => p.cardsTaken === minCards);
    const tie = winners.length > 1;
    const reason = tie
      ? `empate con ${minStars} estrellas y ${minCards} cartas`
      : byStars.length > 1
        ? `menos cartas recogidas en el empate a ${minStars} estrellas`
        : 'menor cantidad de estrellas';

    const prize = room.config.bettingEnabled ? room.config.apuesta * room.players.length : 0;
    const share = winners.length ? Math.floor(prize / winners.length) : 0;
    if (Ledger && prize) {
      winners.forEach((w, i) => {
        const amount = share + (i === 0 ? prize - share * winners.length : 0);
        Ledger.recordWin({ gameSlug: 'tomaseis', roomCode: room.id, playerId: w.id, playerName: w.name, amount, reason });
      });
    }

    const names = winners.map((w) => w.name);
    pushEvent(room, 'win', tie
      ? `Empate entre ${names.join(' y ')} con ${minStars} estrellas y ${minCards} cartas.`
      : `${names[0]} gana con ${minStars} estrellas (${reason}).`);
    room.lastResult = {
      seq: room.eventSeq,
      tie,
      winnerIds: winners.map((w) => w.id),
      winnerId: tie ? null : winners[0].id,
      winnerName: tie ? null : winners[0].name,
      winnerNames: names,
      scores,
      reason,
      prize,
      share: tie ? share : prize
    };
  }

  /* salir durante la partida o al terminarla: el jugador queda fuera de los
     turnos, cobros y revanchas. Si solo queda un jugador en la partida, gana
     por abandono de los demas */
  function leaveGame(room, player) {
    RK.markLeft(room, player);
    if (room.status !== 'playing') return;
    if (RK.activePlayers(room).length < 2) { endGame(room); return; }
    /* no se espera al reloj: su carta o su fila se resuelven ya */
    if (room.phase === 'choosing' && !player.chosenCardId && player.hand.length > 0) {
      player.chosenCardId = player.hand[0].id;
      pushEvent(room, 'info', `${player.name} abandonó: se juega automáticamente su carta más baja.`);
      if (room.players.every((p) => p.chosenCardId || p.hand.length === 0)) {
        beginReveal(room);
        resolveLoop(room);
      }
    } else if (room.phase === 'awaitingRow' && room.awaitingPlayerId === player.id) {
      const ri = cheapestRowIndex(room.rows);
      pushEvent(room, 'info', `${player.name} abandonó: se lleva automáticamente la fila ${ri + 1}, la más barata.`);
      resolveAwaitingRow(room, ri);
    }
  }

  /* ---------- acciones de juego ---------- */

  function doChooseCard(room, player, body) {
    if (room.status !== 'playing') return err('La partida no está activa.');
    if (room.phase !== 'choosing') return err('Ya se están revelando las cartas de esta ronda.');
    if (player.chosenCardId) return err('Ya elegiste tu carta para esta ronda.');
    const card = player.hand.find((c) => c.id === body.cardId);
    if (!card) return err('Carta inválida.');
    player.chosenCardId = card.id;
    pushEvent(room, 'info', `${player.name} eligió su carta.`);

    if (room.players.every((p) => p.chosenCardId || p.hand.length === 0)) {
      beginReveal(room);
      resolveLoop(room);
    }
    return ok();
  }

  function doChooseRow(room, player, body) {
    if (room.status !== 'playing') return err('La partida no está activa.');
    if (room.phase !== 'awaitingRow' || room.awaitingPlayerId !== player.id) return err('No te toca elegir fila.');
    const rowIndex = Math.floor(Number(body.rowIndex));
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= room.rows.length) return err('Fila inválida.');
    resolveAwaitingRow(room, rowIndex);
    return ok();
  }

  const ok = (extra) => Object.assign({ ok: true }, extra || {});
  const err = (message) => ({ ok: false, error: message });

  /* ============================================================
     Estado publico (por jugador: cada uno ve solo su propia mano)
     ============================================================ */

  function stateFor(room, viewer) {
    return {
      id: room.id,
      status: room.status,
      hostId: room.hostId,
      config: room.config,
      round: room.round,
      totalRounds: room.totalRounds,
      phase: room.status === 'playing' ? room.phase : null,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        online: p.online,
        stars: p.stars,
        handCount: p.hand.length,
        hasChosen: !!p.chosenCardId
      })),
      youId: viewer.id,
      rows: room.rows,
      hand: viewer.hand,
      revealed: room.phase === 'choosing' ? null : (room.resolveQueue || []).map((q) => ({
        playerId: q.playerId, num: q.card.num, stars: q.card.stars
      })),
      resolveIndex: room.resolveIndex,
      placements: room.placements,
      awaitingPlayerId: room.awaitingPlayerId,
      deadline: room.status === 'playing' ? room.deadline : null,
      now: Date.now(),
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
      player.offlineAt = Date.now();

      if (room.status === 'lobby') {
        /* margen de gracia: una recarga o un corte breve no expulsan de la sala */
        RK.scheduleLobbyRemoval(room, player, () => {
          const deleted = removePlayer(room, player);
          if (!deleted) { pushEvent(room, 'info', `${player.name} salió de la sala.`); broadcast(room); }
        });
        broadcast(room);
        return;
      }

      pushEvent(room, 'info', `${player.name} se desconectó.`);
      if (room.players.every((p) => !p.online)) {
        clearEmptyTimer(room);
        room.emptyTimer = setTimeout(() => {
          room.emptyTimer = null;
          if (room.players.every((p) => !p.online)) {
            clearAllTimers(room);
            rooms.delete(room.id);
            if (Ledger) Ledger.disposeRoom('tomaseis', room.id);
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

  RK.scheduleRoomCleanup(rooms, { gameSlug: 'tomaseis', Ledger, onDispose: clearAllTimers });
  RK.scheduleHostCheck(rooms, { broadcast });

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
      if (room.players.length >= room.config.maxPlayers) return err(`Sala llena (máx ${room.config.maxPlayers}).`);
      const nameResult = RK.requireUniqueName(room, body.name);
      if (nameResult.error) return err(nameResult.error);
      const player = addPlayer(room, nameResult.name);
      pushEvent(room, 'info', `${player.name} se unió a la sala.`);
      /* quien se une y nunca abre la conexion no ocupa el asiento para siempre */
      RK.scheduleLobbyRemoval(room, player, () => {
        const deleted = removePlayer(room, player);
        if (!deleted) { pushEvent(room, 'info', `${player.name} no llegó a conectarse y salió de la sala.`); broadcast(room); }
      }, RK.GHOST_MS);
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
        if (room.status === 'finished') {
          const restartError = RK.prepareRestart(room);
          if (restartError) { result = err(restartError); break; }
        }
        if (room.players.length < MIN_PLAYERS) { result = err('Se necesitan al menos 2 jugadores.'); break; }
        beginGame(room);
        result = ok();
        break;

      case 'chooseCard': result = doChooseCard(room, player, body); break;
      case 'chooseRow': result = doChooseRow(room, player, body); break;

      case 'restart':
        if (player.id !== room.hostId) { result = err('Solo el anfitrión puede reiniciar.'); break; }
        if (room.status !== 'finished') { result = err('La partida sigue en curso.'); break; }
        { const restartError = RK.prepareRestart(room); if (restartError) { result = err(restartError); break; } }
        pushEvent(room, 'info', 'Nueva partida con los mismos jugadores.');
        beginGame(room);
        result = ok();
        break;

      case 'leave':
        if (room.status === 'lobby') {
          if (removePlayer(room, player)) return ok();
          pushEvent(room, 'info', `${player.name} salió de la sala.`);
        } else {
          leaveGame(room, player);
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
    label: 'tomaseis'
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
    console.log(`\n  🐴  TOMA 6 (standalone)`);
    console.log(`  Juego:  http://localhost:${PORT}/\n`);
  });
}
