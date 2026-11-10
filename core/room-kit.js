/* ============================================================
   core/room-kit.js — utilidades compartidas por los routers de sala
   (códigos de sala, jugadores, SSE, limpieza, montaje HTTP).
   No conoce reglas de ningún juego.
   ============================================================ */

const crypto = require('crypto');
const path = require('path');
const express = require('express');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; /* sin I,O,0,1 */
const LOBBY_GRACE_MS = 15000; /* margen antes de sacar de la sala de espera a quien se desconecta */
const HOST_GRACE_MS = 10000;  /* margen antes de traspasar el anfitrion si se desconecta en partida */
const GHOST_MS = 20000;       /* quien se une y no abre la conexion en este tiempo pierde el asiento */
const IDLE_TURN_MS = 45000;   /* turno sin ninguna accion del jugador conectado: lo pierde */

function makeRoomCode(rooms) {
  return function roomCode() {
    let code;
    do {
      code = Array.from({ length: 4 },
        () => CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)]).join('');
    } while (rooms.has(code));
    return code;
  };
}

const uid = () => crypto.randomBytes(9).toString('base64url');

function cleanName(raw, fallback) {
  const name = String(raw || '').replace(/[<>]/g, '').trim().slice(0, 16);
  return name || fallback;
}

/* nombre para unirse a una sala: exige no vacío y sin duplicados */
function requireUniqueName(room, raw) {
  const name = cleanName(raw, null);
  if (!name) return { error: 'Nombre requerido.' };
  if (room.players.some((p) => p.name === name)) return { error: 'Ese nombre ya está en uso.' };
  return { name };
}

function clampInt(v, min, max, def) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/* identifica al jugador: exige siempre su token secreto (el playerId es
   publico en el estado de la sala) y rechaza a quien ya abandono la partida */
function findPlayer(room, pid, token) {
  if (typeof token !== 'string' || !token) return null;
  const p = room.players.find((x) => x.id === pid);
  if (!p || p.left || p.token !== token) return null;
  return p;
}

/* jugadores que siguen en la partida (no la abandonaron) */
const activePlayers = (room) => room.players.filter((p) => !p.left);

/* indice del siguiente jugador que sigue en la partida, a partir de `from` */
function nextActiveIndex(room, from = room.turnIndex) {
  const n = room.players.length;
  for (let i = 1; i <= n; i++) {
    const cand = (from + i) % n;
    if (!room.players[cand].left) return cand;
  }
  return from;
}

/* ---------- anfitrion ---------- */

/* si el anfitrion abandono, o lleva `graceMs` desconectado, el rol pasa al
   primer jugador conectado que siga en la sala. Devuelve true si cambio */
function ensureHost(room, { graceMs = HOST_GRACE_MS } = {}) {
  const host = room.players.find((p) => p.id === room.hostId);
  const gone = !host || host.left ||
    (!host.online && Date.now() - (host.offlineAt || 0) > graceMs);
  if (!gone) return false;
  const next = room.players.find((p) => !p.left && p.online && p !== host) ||
    room.players.find((p) => !p.left && p !== host);
  if (!next) return false;
  room.hostId = next.id;
  pushEvent(room, 'info', `${next.name} es ahora el anfitrión.`);
  return true;
}

/* revisa periodicamente el anfitrion de las salas en partida o terminadas */
function scheduleHostCheck(rooms, { broadcast } = {}) {
  return setInterval(() => {
    for (const room of rooms.values()) {
      if (room.status === 'lobby') continue;
      if (ensureHost(room) && broadcast) broadcast(room);
    }
  }, 5000);
}

/* ---------- abandono de la partida ---------- */

/* el jugador sale durante la partida o al terminarla: queda fuera de turnos,
   cobros y revanchas (su puntuacion se conserva en la tabla) */
function markLeft(room, player) {
  if (player.left) return;
  player.left = true;
  cancelLobbyRemoval(player);
  pushEvent(room, 'info', `${player.name} abandonó la partida.`);
  if (room.hostId === player.id) ensureHost(room, { graceMs: 0 });
}

/* antes de una revancha: exige 2 jugadores conectados y saca de la sala a
   quienes abandonaron o estan desconectados (no se les cobra ni se les reparte).
   Devuelve un mensaje de error o null */
function prepareRestart(room) {
  const keep = room.players.filter((p) => !p.left && p.online);
  if (keep.length < 2) return 'Se necesitan al menos 2 jugadores conectados para la revancha.';
  room.players = keep;
  ensureHost(room, { graceMs: 0 });
  return null;
}

/* ---------- sala de espera: margen ante desconexiones ---------- */

/* una recarga o un corte breve no expulsan de la sala de espera: solo se
   saca al jugador si sigue desconectado tras el margen */
function scheduleLobbyRemoval(room, player, onExpire, graceMs = LOBBY_GRACE_MS) {
  cancelLobbyRemoval(player);
  player.lobbyTimer = setTimeout(() => {
    player.lobbyTimer = null;
    if (room.status !== 'lobby' || player.online || !room.players.includes(player)) return;
    onExpire();
  }, graceMs);
}

function cancelLobbyRemoval(player) {
  if (player.lobbyTimer) {
    clearTimeout(player.lobbyTimer);
    player.lobbyTimer = null;
  }
}

const currentPlayer = (room) => room.players[room.turnIndex] || null;

function pushEvent(room, type, text) {
  room.events.push({ id: ++room.eventSeq, type, text, ts: Date.now() });
  if (room.events.length > 30) room.events.shift();
}

function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/* saca a un jugador de una sala en lobby; si queda vacía, borra la sala.
   Devuelve true si la sala fue eliminada. */
function removePlayerFromLobby(rooms, room, player, { Ledger, gameSlug } = {}) {
  room.players = room.players.filter((p) => p !== player);
  if (room.players.length === 0) {
    rooms.delete(room.id);
    if (Ledger) Ledger.disposeRoom(gameSlug, room.id);
    return true;
  }
  if (room.hostId === player.id) room.hostId = room.players[0].id;
  return false;
}

/* limpieza de salas abandonadas (2 h sin nadie conectado, contadas desde la ultima desconexion) */
function scheduleRoomCleanup(rooms, { gameSlug, Ledger, onDispose, hours = 2 } = {}) {
  return setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
      const anyone = room.players.some((p) => p.online);
      const lastSeen = Math.max(room.createdAt || 0, ...room.players.map((p) => p.offlineAt || 0));
      if (!anyone && now - lastSeen > hours * 3600 * 1000) {
        if (onDispose) onDispose(room);
        rooms.delete(id);
        if (Ledger) Ledger.disposeRoom(gameSlug, id);
      }
    }
  }, 600000);
}

/* salta el turno del jugador activo si lleva `thresholdMs` desconectado
   (incluye a quien se unio y nunca abrio la conexion: offlineAt se fija al unirse) */
function scheduleSkipDisconnected(rooms, { thresholdMs = 25000, nextTurn, broadcast } = {}) {
  return setInterval(() => {
    for (const room of rooms.values()) {
      if (room.status !== 'playing') continue;
      const cur = currentPlayer(room);
      if (cur && cur.left) { nextTurn(room); broadcast(room); continue; }
      if (cur && !cur.online && Date.now() - (cur.offlineAt || 0) > thresholdMs) {
        pushEvent(room, 'info', `Se saltó el turno de ${cur.name} (desconectado).`);
        nextTurn(room);
        broadcast(room);
      }
    }
  }, 5000);
}

/* ---------- inactividad del turno ---------- */

/* marca actividad en el turno actual (cada accion del jugador de turno) */
function touchTurn(room) {
  room.lastActionAt = Date.now();
}

/* hora limite del turno actual, para la cuenta atras del cliente:
   conectado -> ultima accion + idleMs (pierde el turno);
   desconectado -> desconexion + skipMs (se salta su turno);
   null mientras el turno ya se esta cerrando (endTimer) o fuera de partida */
function turnDeadline(room, { idleMs = IDLE_TURN_MS, skipMs = 25000 } = {}) {
  if (room.status !== 'playing' || room.endTimer) return null;
  const cur = currentPlayer(room);
  if (!cur || cur.left) return null;
  if (!cur.online) return (cur.offlineAt || Date.now()) + skipMs;
  return (room.lastActionAt || Date.now()) + idleMs;
}

/* el jugador de turno, conectado, que no hace nada en `idleMs` pierde el
   turno (onIdle). No actua mientras el turno ya se esta cerrando (endTimer) */
function scheduleIdleTurns(rooms, { idleMs = IDLE_TURN_MS, onIdle, broadcast } = {}) {
  return setInterval(() => {
    for (const room of rooms.values()) {
      if (room.status !== 'playing' || room.endTimer) continue;
      const cur = currentPlayer(room);
      if (!cur || cur.left || !cur.online) continue;
      if (Date.now() - (room.lastActionAt || 0) <= idleMs) continue;
      onIdle(room, cur);
      touchTurn(room);
      broadcast(room);
    }
  }, 5000);
}

/* monta GET /, GET /events y POST /api/:action sobre el router del juego */
function mountRoomRoutes(router, { root, getRoom, findPlayer: findP, attachStream, handleAction, label }) {
  router.use(express.static(root, { index: false }));
  router.get('/', (req, res) => res.sendFile(path.join(root, 'game.html')));

  router.get('/events', (req, res) => {
    const room = getRoom(String(req.query.room || '').toUpperCase());
    if (!room) { res.writeHead(404).end(); return; }
    const player = findP(room, req.query.pid, req.query.token);
    if (!player) { res.writeHead(403).end(); return; }
    attachStream(room, player, res);
  });

  router.post('/api/:action', express.json(), (req, res) => {
    try {
      const out = handleAction(req.params.action, req.body || {});
      res.status(out.ok ? 200 : 400).json(out);
    } catch (e) {
      console.error(`[${label}]`, e);
      res.status(500).json({ ok: false, error: 'Error interno del servidor.' });
    }
  });
}

module.exports = {
  makeRoomCode, uid, cleanName, requireUniqueName, clampInt,
  findPlayer, currentPlayer, activePlayers, nextActiveIndex, pushEvent, sseSend,
  removePlayerFromLobby, scheduleRoomCleanup, scheduleSkipDisconnected, mountRoomRoutes,
  ensureHost, scheduleHostCheck, markLeft, prepareRestart,
  scheduleLobbyRemoval, cancelLobbyRemoval, touchTurn, scheduleIdleTurns, turnDeadline,
  GHOST_MS, IDLE_TURN_MS
};
