/* ============================================================
   core/bet-gate.js — confirmación de apuesta antes de jugar (DESIGN.md §6)

   Independiente del estado interno de cada juego: solo lleva la
   cuenta de quién ya dijo "OK — COLOCAR APUESTA" en una sala dada.
   El juego decide cuándo abrir el gate (al pulsar "Iniciar" con
   apuestas ON) y cuándo arrancar de verdad (cuando todos confirmaron).
   ============================================================ */

function roomKey(gameSlug, roomCode) {
  return `${gameSlug}:${roomCode}`;
}

const gates = new Map();

function open(gameSlug, roomCode, playerIds, { amount = 0, penalty = 0 } = {}) {
  const gate = {
    pending: true,
    amount,
    penalty,
    requiredIds: new Set(playerIds),
    confirmedIds: new Set()
  };
  gates.set(roomKey(gameSlug, roomCode), gate);
  return status(gameSlug, roomCode);
}

function confirm(gameSlug, roomCode, playerId) {
  const gate = gates.get(roomKey(gameSlug, roomCode));
  if (!gate) return null;
  if (gate.requiredIds.has(playerId)) gate.confirmedIds.add(playerId);
  return status(gameSlug, roomCode);
}

/* el jugador que cancela sale del gate por completo (y de la sala, a
   cargo del juego). Si ya no hay suficientes jugadores para apostar
   (<2), el gate se cierra sin arrancar la partida. */
function cancel(gameSlug, roomCode, playerId) {
  const gate = gates.get(roomKey(gameSlug, roomCode));
  if (!gate) return null;
  gate.requiredIds.delete(playerId);
  gate.confirmedIds.delete(playerId);
  if (gate.requiredIds.size < 2) {
    close(gameSlug, roomCode);
    return null;
  }
  return status(gameSlug, roomCode);
}

function status(gameSlug, roomCode) {
  const gate = gates.get(roomKey(gameSlug, roomCode));
  if (!gate) return null;
  return {
    pending: gate.pending,
    amount: gate.amount,
    penalty: gate.penalty,
    requiredIds: Array.from(gate.requiredIds),
    confirmedIds: Array.from(gate.confirmedIds),
    allConfirmed: gate.requiredIds.size > 0 &&
      gate.confirmedIds.size === gate.requiredIds.size
  };
}

function close(gameSlug, roomCode) {
  gates.delete(roomKey(gameSlug, roomCode));
}

module.exports = { open, confirm, cancel, status, close };
