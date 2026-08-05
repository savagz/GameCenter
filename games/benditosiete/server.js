/* ============================================================
   BENDITO SIETE — router de juego (montado por GameCenter)

   Expone createRouter({ Ledger, BetGate }) -> express.Router
     - GET  /                  -> game.html
     - GET  /events?...        -> stream SSE con el estado de la sala
     - POST /api/<accion>      -> acciones del jugador

   Standalone (fuera de GameCenter): node server.js  (ver bottom de archivo)
   ============================================================ */

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const E = require('./engine.js');

const ROOT = __dirname;

function createRouter({ Ledger, BetGate } = {}) {
  const router = express.Router();

  /* ============================================================
     Estado en memoria
     ============================================================ */

  const rooms = new Map();

  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; /* sin I,O,0,1 */

  function roomCode() {
    let code;
    do {
      code = Array.from({ length: 4 },
        () => CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)]).join('');
    } while (rooms.has(code));
    return code;
  }

  const uid = () => crypto.randomBytes(9).toString('base64url');

  function cleanName(raw, fallback) {
    const name = String(raw || '').replace(/[<>]/g, '').trim().slice(0, 16);
    return name || fallback;
  }

  function clampInt(v, min, max, def) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  }

  /* ============================================================
     Sala
     ============================================================ */

  function createRoom(hostName, cfg) {
    const bettingEnabled = !!(cfg && cfg.bettingEnabled);
    const config = {
      lances: clampInt(cfg && cfg.lances, 1, 10, 3),
      maxPlayers: clampInt(cfg && cfg.maxPlayers, 2, 8, 4),
      bettingEnabled,
      apuesta: bettingEnabled ? clampInt(cfg && cfg.apuesta, 0, 1e7, 500) : 0,
      castigo: bettingEnabled ? clampInt(cfg && cfg.castigo, 0, 1e7, 100) : 0
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
    if (Ledger) Ledger.configureRoom('benditosiete', room.id, config);
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

  function findPlayer(room, pid, token) {
    const p = room.players.find((x) => x.id === pid);
    if (!p || (token && p.token !== token)) return null;
    return p;
  }

  const currentPlayer = (room) => room.players[room.turnIndex] || null;

  function pushEvent(room, type, text) {
    room.events.push({ id: ++room.eventSeq, type, text, ts: Date.now() });
    if (room.events.length > 30) room.events.shift();
  }

  /* siguiente indice de turno: prioriza jugadores conectados */
  function computeNextIndex(room) {
    const n = room.players.length;
    let idx = (room.turnIndex + 1) % n;
    for (let i = 1; i <= n; i++) {
      const cand = (room.turnIndex + i) % n;
      if (room.players[cand].online) { idx = cand; break; }
    }
    return idx;
  }

  /* ============================================================
     Ciclo de partida
     ============================================================ */

  function startGame(room) {
    room.status = 'playing';
    room.winnerId = null;

    for (const p of room.players) {
      p.board = E.newBoard();
      if (Ledger && room.config.bettingEnabled && room.config.apuesta) {
        Ledger.recordEntry({ gameSlug: 'benditosiete', roomCode: room.id, playerId: p.id, playerName: p.name, amount: room.config.apuesta });
      }
    }

    room.turnIndex = 0;
    pushEvent(room, 'start', 'Comienza la partida. ¡Buena suerte a todos!');
    beginTurn(room);
  }

  function beginTurn(room) {
    clearEndTimer(room);
    room.turn = {
      rollNo: 0,
      dice: [],
      sum: null,
      lancesUsed: 0,
      lancesMax: room.config.lances,
      phase: 'ready',        /* ready | active | ending */
      finalPending: false,   /* true = el proximo lanzamiento decide el Bendito Siete */
      log: []
    };
    const p = currentPlayer(room);
    if (p) {
      const final = E.boardComplete(p.board);
      pushEvent(room, 'turn',
        final ? `Turno de ${p.name}. ¡Tablero completo, va por el Bendito Siete!`
              : `Turno de ${p.name}.`);
      if (final) room.turn.finalPending = true;
    }
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
    room.turn = null;
    const prize = room.config.bettingEnabled ? room.config.apuesta * room.players.length : 0;
    room.lastPrize = prize;
    if (Ledger && prize) {
      Ledger.recordWin({ gameSlug: 'benditosiete', roomCode: room.id, playerId: winner.id, playerName: winner.name, amount: prize, reason });
    }
    pushEvent(room, 'win', `${winner.name} gana ${reason}.`);
  }

  /* ---------- lanzar ---------- */

  function doRoll(room, player) {
    if (room.status !== 'playing') return err('La partida no está activa.');
    if (currentPlayer(room) !== player) return err('No es tu turno.');

    const t = room.turn;
    if (t.phase === 'ending') return err('Tu turno ya terminó.');

    const dice = E.rollDice();
    const sum = E.sumDice(dice);

    t.rollNo += 1;
    t.dice = dice;
    t.sum = sum;

    /* fase final: tablero completo, un unico lanzamiento decide */
    if (E.boardComplete(player.board)) {
      if (sum === E.SEVEN) {
        t.log.push({ n: t.rollNo, dice, sum, result: 'win' });
        pushEvent(room, 'jackpot', `🎲 ¡${player.name} sacó BENDITO SIETE y gana la partida!`);
        finishGame(room, player, 'con el Bendito Siete');
        return ok();
      }
      t.log.push({ n: t.rollNo, dice, sum, result: 'final-fail' });
      t.phase = 'ending';
      t.finalPending = false;
      if (Ledger && room.config.bettingEnabled && room.config.castigo) {
        Ledger.recordPenalty({
          gameSlug: 'benditosiete', roomCode: room.id,
          playerId: player.id, playerName: player.name, amount: room.config.castigo, reason: 'sin-siete-final'
        });
      }
      pushEvent(room, 'penalty',
        `${player.name} lanzó ${sum} y no consiguió el 7. Pierde su oportunidad final.`);
      scheduleEnd(room, 2200);
      return ok();
    }

    /* siete durante el juego normal: turno termina, no tapa nada */
    if (sum === E.SEVEN) {
      t.log.push({ n: t.rollNo, dice, sum, result: 'seven' });
      t.phase = 'ending';
      if (Ledger && room.config.bettingEnabled && room.config.castigo) {
        Ledger.recordPenalty({
          gameSlug: 'benditosiete', roomCode: room.id,
          playerId: player.id, playerName: player.name, amount: room.config.castigo, reason: 'siete-antes-de-tiempo'
        });
      }
      pushEvent(room, 'penalty', `${player.name} sacó 7. Su turno termina.`);
      scheduleEnd(room, 2200);
      return ok();
    }

    /* numero destapado: se tapa */
    if (!player.board[sum]) {
      player.board[sum] = true;
      t.lancesUsed += 1;
      t.log.push({ n: t.rollNo, dice, sum, result: 'covered' });
      pushEvent(room, 'cover', `${player.name} tapa el ${sum}.`);

      if (E.boardComplete(player.board)) {
        t.finalPending = true;
        t.phase = 'active';
        pushEvent(room, 'info',
          `¡${player.name} completó su tablero! Le queda un único lanzamiento para el Bendito Siete.`);
        return ok();
      }

      if (t.lancesUsed >= t.lancesMax) {
        t.phase = 'ending';
        pushEvent(room, 'info', `${player.name} agotó sus lances. Turno termina.`);
        scheduleEnd(room, 1800);
      } else {
        t.phase = 'active';
      }
      return ok();
    }

    /* numero ya tapado: pasa al siguiente jugador */
    t.log.push({ n: t.rollNo, dice, sum, result: 'passed' });
    const nextIdx = computeNextIndex(room);
    const next = room.players[nextIdx];
    if (next && !E.boardComplete(next.board) && !next.board[sum]) {
      next.board[sum] = true;
      pushEvent(room, 'info',
        `${player.name} ya tenía el ${sum} tapado: pasa a ${next.name}, quien lo tapa.`);
    } else if (next) {
      pushEvent(room, 'info', `${player.name} ya tenía el ${sum} tapado: pasa a ${next.name}.`);
    }
    t.phase = 'ending';
    scheduleEnd(room, 2000);
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
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        online: p.online,
        filled: E.boardFilled(p.board),
        board: p.board
      })),
      turn: t
        ? {
            rollNo: t.rollNo,
            dice: t.dice,
            sum: t.sum,
            lancesUsed: t.lancesUsed,
            lancesMax: t.lancesMax,
            phase: t.phase,
            finalPending: t.finalPending,
            log: t.log
          }
        : null,
      events: room.events.slice(-10),
      total: E.TOTAL,
      prize: room.status === 'finished' ? (room.lastPrize || 0) : 0,
      betGate: BetGate ? BetGate.status('benditosiete', room.id) : null
    };
  }

  /* ============================================================
     SSE
     ============================================================ */

  function sseSend(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

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
      if (player.streams.size === 0) {
        player.online = false;
        player.offlineAt = Date.now();
        pushEvent(room, 'info', `${player.name} se desconectó.`);
        broadcast(room);
      }
    };
    res.on('close', close);
    res.on('error', close);

    sseSend(res, 'state', publicState(room));
    broadcast(room);
  }

  /* si el jugador en turno lleva 25 s desconectado, se salta su turno */
  setInterval(() => {
    for (const room of rooms.values()) {
      if (room.status !== 'playing') continue;
      const cur = currentPlayer(room);
      if (cur && cur.hasConnected && !cur.online && Date.now() - cur.offlineAt > 25000) {
        pushEvent(room, 'info', `Se saltó el turno de ${cur.name} (desconectado).`);
        nextTurn(room);
        broadcast(room);
      }
    }
  }, 5000);

  /* limpieza de salas abandonadas (2 h sin nadie conectado) */
  setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
      const anyone = room.players.some((p) => p.online);
      if (!anyone && now - room.createdAt > 2 * 3600 * 1000) {
        rooms.delete(id);
        if (Ledger) Ledger.disposeRoom('benditosiete', id);
      }
    }
  }, 600000);

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
      const player = addPlayer(room, body.name);
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
        if (BetGate && room.config.bettingEnabled) {
          BetGate.open('benditosiete', room.id, room.players.map((p) => p.id),
            { amount: room.config.apuesta, penalty: room.config.castigo });
          pushEvent(room, 'info', 'Confirma tu apuesta para comenzar.');
        } else {
          startGame(room);
        }
        result = ok();
        break;

      case 'betConfirm': {
        if (!BetGate) { result = err('No disponible.'); break; }
        const gate = BetGate.confirm('benditosiete', room.id, player.id);
        if (gate && gate.allConfirmed) {
          BetGate.close('benditosiete', room.id);
          startGame(room);
        }
        result = ok();
        break;
      }

      case 'betCancel':
        if (BetGate) BetGate.cancel('benditosiete', room.id, player.id);
        if (room.status === 'lobby') {
          room.players = room.players.filter((p) => p !== player);
          if (room.players.length === 0) {
            rooms.delete(room.id);
            if (Ledger) Ledger.disposeRoom('benditosiete', room.id);
            return ok();
          }
          if (room.hostId === player.id) room.hostId = room.players[0].id;
          pushEvent(room, 'info', `${player.name} canceló su apuesta y salió de la sala.`);
        }
        result = ok();
        break;

      case 'roll': result = doRoll(room, player); break;

      case 'restart':
        if (player.id !== room.hostId) { result = err('Solo el anfitrión puede reiniciar.'); break; }
        if (room.status !== 'finished') { result = err('La partida sigue en curso.'); break; }
        pushEvent(room, 'info', 'Nueva partida con los mismos jugadores.');
        startGame(room);
        result = ok();
        break;

      case 'leave':
        if (room.status === 'lobby') {
          room.players = room.players.filter((p) => p !== player);
          if (room.players.length === 0) {
            rooms.delete(room.id);
            if (Ledger) Ledger.disposeRoom('benditosiete', room.id);
            return ok();
          }
          if (room.hostId === player.id) room.hostId = room.players[0].id;
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

  router.use(express.static(ROOT, { index: false }));
  router.get('/', (req, res) => res.sendFile(path.join(ROOT, 'game.html')));

  router.get('/events', (req, res) => {
    const room = rooms.get(String(req.query.room || '').toUpperCase());
    if (!room) { res.writeHead(404).end(); return; }
    const player = findPlayer(room, req.query.pid, req.query.token);
    if (!player) { res.writeHead(403).end(); return; }
    attachStream(room, player, res);
  });

  router.post('/api/:action', express.json(), (req, res) => {
    try {
      const out = handleAction(req.params.action, req.body || {});
      res.status(out.ok ? 200 : 400).json(out);
    } catch (e) {
      console.error('[benditosiete]', e);
      res.status(500).json(err('Error interno del servidor.'));
    }
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
    console.log(`\n  🎲  BENDITO SIETE (standalone)`);
    console.log(`  Juego:  http://localhost:${PORT}/\n`);
  });
}
