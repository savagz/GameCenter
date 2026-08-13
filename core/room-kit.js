/* ============================================================
   core/room-kit.js — utilidades compartidas por los routers de sala
   (códigos de sala, jugadores, SSE, limpieza, montaje HTTP).
   No conoce reglas de ningún juego.
   ============================================================ */

const crypto = require('crypto');
const path = require('path');
const express = require('express');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; /* sin I,O,0,1 */

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

/* limpieza de salas abandonadas (2 h sin nadie conectado) */
function scheduleRoomCleanup(rooms, { gameSlug, Ledger, onDispose, hours = 2 } = {}) {
  return setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
      const anyone = room.players.some((p) => p.online);
      if (!anyone && now - room.createdAt > hours * 3600 * 1000) {
        if (onDispose) onDispose(room);
        rooms.delete(id);
        if (Ledger) Ledger.disposeRoom(gameSlug, id);
      }
    }
  }, 600000);
}

/* salta el turno del jugador activo si lleva `thresholdMs` desconectado.
   Pensado para juegos sin timer de turno propio (usa hasConnected/offlineAt). */
function scheduleSkipDisconnected(rooms, { thresholdMs = 25000, nextTurn, broadcast } = {}) {
  return setInterval(() => {
    for (const room of rooms.values()) {
      if (room.status !== 'playing') continue;
      const cur = currentPlayer(room);
      if (cur && cur.hasConnected && !cur.online && Date.now() - cur.offlineAt > thresholdMs) {
        pushEvent(room, 'info', `Se saltó el turno de ${cur.name} (desconectado).`);
        nextTurn(room);
        broadcast(room);
      }
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
  findPlayer, currentPlayer, pushEvent, sseSend,
  removePlayerFromLobby, scheduleRoomCleanup, scheduleSkipDisconnected, mountRoomRoutes
};
