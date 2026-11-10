/* ============================================================
   core/ledger.js — apuestas y ganancias centralizadas (DESIGN.md §9)

   Cada juego llama a estos métodos en los puntos exactos donde YA
   detecta un buy-in, una victoria o una penalización. El ledger no
   conoce reglas de ningún juego: solo acumula movimientos de dinero
   por sala.
   ============================================================ */

function roomKey(gameSlug, roomCode) {
  return `${gameSlug}:${roomCode}`;
}

function blankPlayer(name) {
  return { name, balance: 0, paidIn: 0, won: 0, penalized: 0 };
}

const rooms = new Map();

function configureRoom(gameSlug, roomCode, { bettingEnabled = false, apuesta = 0, castigo = 0 } = {}) {
  rooms.set(roomKey(gameSlug, roomCode), {
    gameSlug,
    roomCode,
    bettingEnabled: !!bettingEnabled,
    apuesta,
    castigo,
    players: new Map(),
    potTotal: 0,
    winnerId: null,
    prizeAmount: 0,
    events: [],
    createdAt: Date.now()
  });
}

function getRoom(gameSlug, roomCode) {
  return rooms.get(roomKey(gameSlug, roomCode));
}

function ensurePlayer(room, playerId, playerName) {
  let p = room.players.get(playerId);
  if (!p) {
    p = blankPlayer(playerName);
    room.players.set(playerId, p);
  } else if (playerName) {
    p.name = playerName;
  }
  return p;
}

function pushEvent(room, type, data) {
  room.events.push({ type, ts: Date.now(), ...data });
  if (room.events.length > 40) room.events.shift();
}

function recordEntry({ gameSlug, roomCode, playerId, playerName, amount }) {
  const room = getRoom(gameSlug, roomCode);
  if (!room || !amount) return;
  const p = ensurePlayer(room, playerId, playerName);
  p.balance -= amount;
  p.paidIn += amount;
  room.potTotal += amount;
  pushEvent(room, 'entry', { playerId, amount });
}

function recordWin({ gameSlug, roomCode, playerId, playerName, amount, reason }) {
  const room = getRoom(gameSlug, roomCode);
  if (!room) return;
  const p = ensurePlayer(room, playerId, playerName);
  p.balance += amount;
  p.won += amount;
  room.winnerId = playerId;
  room.prizeAmount = amount;
  room.potTotal = Math.max(0, room.potTotal - amount);
  pushEvent(room, 'win', { playerId, amount, reason });
}

function recordPenalty({ gameSlug, roomCode, playerId, playerName, amount, reason, toPlayerId, toPlayerName }) {
  const room = getRoom(gameSlug, roomCode);
  if (!room || !amount) return;
  const p = ensurePlayer(room, playerId, playerName);
  p.balance -= amount;
  p.penalized += amount;

  if (toPlayerId) {
    const to = ensurePlayer(room, toPlayerId, toPlayerName);
    to.balance += amount;
    to.won += amount;
  } else {
    room.potTotal += amount;
  }
  pushEvent(room, 'penalty', { playerId, amount, reason, toPlayerId });
}

function disposeRoom(gameSlug, roomCode) {
  rooms.delete(roomKey(gameSlug, roomCode));
}

/* limpieza de salas abandonadas (2 h) */
setInterval(() => {
  const now = Date.now();
  for (const [key, room] of rooms) {
    if (now - room.createdAt > 2 * 3600 * 1000) rooms.delete(key);
  }
}, 600000);

module.exports = {
  configureRoom,
  recordEntry,
  recordWin,
  recordPenalty,
  disposeRoom
};
