import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { socket } from '../socket.js';
import Tile from './Tile.jsx';
import { sfx, isMuted, setMuted } from '../sound.js';

const RACK_COLS = 14;
const RACK_ROWS = 3;
const RACK_SLOTS = RACK_COLS * RACK_ROWS;
const COLOR_ORDER = { red: 0, blue: 1, yellow: 2, black: 3, joker: 4 };

let uidCounter = 0;
const uid = () => 'm' + ++uidCounter;

// If tiles form a run (single color, distinct numbers), return them sorted
// ascending with jokers filling gaps. Otherwise return unchanged (e.g. groups,
// or a still-incomplete/invalid mix where sorting would just be confusing).
function sortRunMeld(tiles) {
  const jokers = tiles.filter((t) => t.joker);
  const rest = tiles.filter((t) => !t.joker);
  if (rest.length < 2) return tiles;

  const colors = new Set(rest.map((t) => t.color));
  if (colors.size !== 1) return tiles;

  const nums = new Set(rest.map((t) => t.num));
  if (nums.size !== rest.length) return tiles;

  const sorted = [...rest].sort((a, b) => a.num - b.num);
  const min = sorted[0].num;
  const max = sorted[sorted.length - 1].num;

  // Jokers the caller placed before the first non-joker tile (e.g. dragged
  // to the front of 6-7-8-* to make it *-6-7-8) — leftover jokers beyond
  // what's needed to fill internal gaps honor that side instead of always
  // snapping to the high end.
  const firstRestIdx = tiles.findIndex((t) => !t.joker);
  const leadingJokers = tiles.slice(0, firstRestIdx).filter((t) => t.joker).length;

  const pool = [...jokers];
  const seq = [];
  for (let n = min; n <= max; n++) {
    const t = sorted.find((x) => x.num === n);
    if (t) seq.push(t);
    else if (pool.length) seq.push(pool.pop());
    else return tiles; // gap too big for available jokers, leave as-is
  }
  // Leftover jokers extend the run — toward the low end first if that's
  // where they were dragged, then upward while room below 13, then
  // downward while room above 1. Never past 13 or before 1.
  let hi = max;
  let lo = min;
  let lead = Math.min(leadingJokers, pool.length);
  while (lead > 0 && lo > 1) {
    lo--;
    seq.unshift(pool.pop());
    lead--;
  }
  while (pool.length) {
    if (hi < 13) {
      hi++;
      seq.push(pool.pop());
    } else if (lo > 1) {
      lo--;
      seq.unshift(pool.pop());
    } else {
      seq.push(...pool); // no room either side — meld invalid, leave as-is for validation
      break;
    }
  }
  return seq;
}

function isRunMeld(tiles) {
  const nonJoker = tiles.filter((t) => !t.joker);
  if (nonJoker.length < 2) return false;
  return new Set(nonJoker.map((t) => t.color)).size === 1;
}

export default function Game({ gs, toast }) {
  const myTurn = gs.started && gs.turn === gs.youIndex;

  const [board, setBoard] = useState([]); // [{id, tiles:[]}] working copy
  const [rack, setRack] = useState(() => Array(RACK_SLOTS).fill(null));
  const [placed, setPlaced] = useState(() => new Set());
  const [drag, setDrag] = useState(null);
  const [liveBoard, setLiveBoard] = useState(null);
  const [now, setNow] = useState(Date.now());

  const snapshotRef = useRef(null);
  const boardRef = useRef(board);
  const rackRef = useRef(rack);
  const placedRef = useRef(placed);
  const prevTurnKey = useRef(null);
  const lastLiveEmit = useRef(0);
  const liveTimer = useRef(null);
  const lastTickSecond = useRef(null);
  const pendingSendRef = useRef(null);
  const [muted, setMutedState] = useState(isMuted());

  boardRef.current = board;
  rackRef.current = rack;
  placedRef.current = placed;

  // ---- sync from server state ----
  useEffect(() => {
    // Merge hand into rack, preserving slot arrangement.
    setRack((prev) => {
      const handIds = new Set(gs.hand.map((t) => t.id));
      const next = prev.map((t) => (t && handIds.has(t.id) ? t : null));
      const present = new Set(next.filter(Boolean).map((t) => t.id));
      for (const t of gs.hand) {
        if (present.has(t.id)) continue;
        const free = next.findIndex((s) => s === null);
        if (free === -1) break;
        next[free] = t;
      }
      return next;
    });

    const turnKey = `${gs.turn}:${gs.started}:${gs.turnDeadline}`;
    const isNewTurn = prevTurnKey.current !== turnKey;
    prevTurnKey.current = turnKey;

    if (isNewTurn && myTurn) {
      sfx.yourTurn();
      lastTickSecond.current = null;
    }

    if (!myTurn || isNewTurn) {
      const fresh = gs.board.map((tiles) => ({ id: uid(), tiles: [...tiles] }));
      setBoard(fresh);
      setPlaced(new Set());
      setLiveBoard(null);
      if (myTurn) {
        snapshotRef.current = {
          board: gs.board.map((tiles) => [...tiles]),
          hand: [...gs.hand],
        };
      }
    }
  }, [gs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onLive = (b) => setLiveBoard(b.map((tiles) => ({ id: uid(), tiles })));
    socket.on('liveBoard', onLive);
    return () => socket.off('liveBoard', onLive);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // Repeating 8-bit tick during the last 10 seconds of your own turn.
  useEffect(() => {
    if (!myTurn || !gs.turnDeadline) return;
    const remaining = Math.max(0, Math.ceil((gs.turnDeadline - now) / 1000));
    if (remaining <= 10 && remaining >= 1 && lastTickSecond.current !== remaining) {
      lastTickSecond.current = remaining;
      sfx.tick(remaining <= 5);
    }
  }, [now, myTurn, gs.turnDeadline]);

  // Flush any throttled liveBoard update immediately once the clock is
  // almost out, so the server's `pendingPlay` snapshot (used by autoPass)
  // reflects your very last move instead of a stale, pre-move one — otherwise
  // a play finished right as time runs out can get discarded as invalid.
  useEffect(() => {
    if (!myTurn || !gs.turnDeadline || !pendingSendRef.current) return;
    if (gs.turnDeadline - now <= 1000) {
      clearTimeout(liveTimer.current);
      pendingSendRef.current();
    }
  }, [now, myTurn, gs.turnDeadline]);

  // ---- live board relay (throttled) ----
  // Also keeps the server's `pendingPlay` snapshot up to date so that if the
  // turn timer runs out mid-arrangement, the server can validate and accept
  // this exact board/hand instead of just forcing a draw.
  const emitLive = useCallback((b, r) => {
    const send = () => {
      lastLiveEmit.current = Date.now();
      pendingSendRef.current = null;
      socket.emit('liveBoard', {
        board: b.map((m) => m.tiles.map((t) => t.id)),
        hand: (r || rackRef.current).filter(Boolean).map((t) => t.id),
      });
    };
    clearTimeout(liveTimer.current);
    const elapsed = Date.now() - lastLiveEmit.current;
    if (elapsed > 200) {
      send();
    } else {
      pendingSendRef.current = send;
      liveTimer.current = setTimeout(send, 220 - elapsed);
    }
  }, []);

  // ---- drag engine (pointer events => works with touch) ----
  const startDrag = useCallback(
    (e, tile, from) => {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      if (from.type === 'meld') {
        if (!myTurn) return;
        if (!gs.hasMelded && !placedRef.current.has(tile.id)) {
          toast('Antes de tu primera bajada (30 pts) no puedes tocar la mesa.', 'error');
          return;
        }
      }
      if (from.type === 'rack' && !myTurn) {
        // Rearranging your own rack is always allowed.
      }
      e.preventDefault();
      sfx.pickup();
      const rect = e.currentTarget.getBoundingClientRect();
      setDrag({
        tile,
        from,
        x: e.clientX,
        y: e.clientY,
        dx: e.clientX - rect.left,
        dy: e.clientY - rect.top,
        w: rect.width,
        h: rect.height,
      });
    },
    [myTurn, gs.hasMelded, toast]
  );

  useEffect(() => {
    if (!drag) return;
    const move = (e) => {
      e.preventDefault();
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    };
    const up = (e) => {
      finishDrag(e.clientX, e.clientY);
    };
    const cancel = () => setDrag(null);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [drag?.tile.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function nearestMeldWithin(x, y, margin) {
    const tails = document.querySelectorAll('.meld-tail[data-drop]');
    let best = null;
    let bestDist = margin;
    for (const tail of tails) {
      const r = tail.getBoundingClientRect();
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const dist = Math.hypot(dx, dy);
      if (dist <= bestDist) {
        bestDist = dist;
        best = tail;
      }
    }
    return best;
  }

  function finishDrag(x, y) {
    const d = drag;
    setDrag(null);
    if (!d) return;
    let el = document.elementFromPoint(x, y)?.closest('[data-drop]');
    // Snap to the nearest meld if the drop misses its target by a small
    // margin (e.g. slightly past the tail) so it merges instead of
    // silently spawning a separate, invalid single-tile meld.
    if (el?.getAttribute('data-drop') === 'newmeld') {
      const near = nearestMeldWithin(x, y, 28);
      if (near) el = near;
    }
    if (!el) return;
    const spec = el.getAttribute('data-drop');
    const rect = el.getBoundingClientRect();
    let to = null;

    if (spec === 'newmeld') to = { type: 'newmeld' };
    else if (spec.startsWith('rack:')) to = { type: 'rack', index: +spec.slice(5) };
    else if (spec.startsWith('meld:')) {
      const [, mi, pos] = spec.split(':');
      let p = +pos;
      // Drop on the right half of a tile inserts after it.
      if (el.classList.contains('slot-wrap') && x > rect.left + rect.width / 2) p++;
      to = { type: 'meld', meldIndex: +mi, pos: p };
    }
    if (!to) return;

    // Legality
    if (to.type !== 'rack' && !myTurn) {
      toast('No es tu turno.', 'error');
      return;
    }
    if (d.from.type === 'meld' && to.type === 'rack' && !placedRef.current.has(d.tile.id)) {
      toast('Solo puedes devolver a tu atril fichas que colocaste este turno.', 'error');
      return;
    }
    applyMove(d.from, to, d.tile);
  }

  function applyMove(from, to, tile) {
    let b = boardRef.current.map((m) => ({ ...m, tiles: [...m.tiles] }));
    const r = [...rackRef.current];
    const p = new Set(placedRef.current);

    // no-op guard
    if (from.type === 'rack' && to.type === 'rack' && from.index === to.index) return;
    if (
      from.type === 'meld' &&
      to.type === 'meld' &&
      from.meldIndex === to.meldIndex &&
      (to.pos === from.index || to.pos === from.index + 1)
    )
      return;

    // remove from source. Pulling a tile out of the *middle* of a run
    // breaks its consecutive sequence, so split the remainder into two
    // melds (left of the gap / right of the gap) instead of leaving one
    // meld with a hole in it. Not needed for groups (no order) or when
    // the tile is just being reordered within the same meld.
    let splitTiles = null;
    if (from.type === 'rack') {
      r[from.index] = null;
    } else {
      const meldTiles = b[from.meldIndex].tiles;
      const stayingInSameMeld = to.type === 'meld' && to.meldIndex === from.meldIndex;
      const removedAtEdge = from.index === 0 || from.index === meldTiles.length - 1;
      const wasRun = !stayingInSameMeld && !removedAtEdge && isRunMeld(meldTiles);
      meldTiles.splice(from.index, 1);
      if (wasRun && meldTiles.length > 0) splitTiles = meldTiles.splice(from.index);
    }

    // insert into target
    if (to.type === 'meld') {
      let pos = to.pos;
      if (from.type === 'meld' && from.meldIndex === to.meldIndex && from.index < pos) pos--;
      b[to.meldIndex].tiles.splice(pos, 0, tile);
      b[to.meldIndex].tiles = sortRunMeld(b[to.meldIndex].tiles);
    } else if (to.type === 'newmeld') {
      b.push({ id: uid(), tiles: [tile] });
    } else {
      const displaced = r[to.index];
      r[to.index] = tile;
      if (displaced) {
        if (from.type === 'rack') {
          r[from.index] = displaced; // swap
        } else {
          const free = r.findIndex((s) => s === null);
          if (free === -1) {
            toast('Atril lleno.', 'error');
            return;
          }
          r[free] = displaced;
        }
      }
    }

    if (splitTiles && splitTiles.length > 0) b.push({ id: uid(), tiles: splitTiles });
    b = b.filter((m) => m.tiles.length > 0);

    if (from.type === 'rack' && to.type !== 'rack') p.add(tile.id);
    if (from.type === 'meld' && to.type === 'rack') p.delete(tile.id);

    if (to.type === 'meld' || to.type === 'newmeld') sfx.place();

    setBoard(b);
    setRack(r);
    setPlaced(p);
    if (myTurn) emitLive(b, r);
  }

  // ---- actions ----
  function undo() {
    if (!myTurn || !snapshotRef.current) return;
    const snap = snapshotRef.current;
    const fresh = snap.board.map((tiles) => ({ id: uid(), tiles: [...tiles] }));
    setBoard(fresh);
    setPlaced(new Set());
    let nextRack;
    setRack((prev) => {
      const handIds = new Set(snap.hand.map((t) => t.id));
      const next = prev.map((t) => (t && handIds.has(t.id) ? t : null));
      const present = new Set(next.filter(Boolean).map((t) => t.id));
      for (const t of snap.hand) {
        if (present.has(t.id)) continue;
        const free = next.findIndex((s) => s === null);
        if (free !== -1) next[free] = t;
      }
      nextRack = next;
      return next;
    });
    emitLive(fresh, nextRack);
  }

  function endTurn() {
    if (!myTurn) return;
    socket.emit('endTurn', {
      board: boardRef.current.map((m) => m.tiles.map((t) => t.id)),
      hand: rackRef.current.filter(Boolean).map((t) => t.id),
    });
  }

  function draw() {
    if (!myTurn) return;
    if (placedRef.current.size > 0) undo();
    const handIds = (snapshotRef.current?.hand || rackRef.current.filter(Boolean)).map((t) => t.id);
    sfx.draw();
    socket.emit('drawTile', { hand: handIds });
  }

  function toggleMute() {
    const v = !muted;
    setMuted(v);
    setMutedState(v);
  }

  function sortRack(mode) {
    setRack((prev) => {
      const tiles = prev.filter(Boolean);
      tiles.sort((a, b) => {
        if (a.joker !== b.joker) return a.joker ? 1 : -1;
        if (mode === 'runs') {
          return COLOR_ORDER[a.color] - COLOR_ORDER[b.color] || a.num - b.num;
        }
        return a.num - b.num || COLOR_ORDER[a.color] - COLOR_ORDER[b.color];
      });
      const next = Array(RACK_SLOTS).fill(null);
      tiles.forEach((t, i) => (next[i] = t));
      return next;
    });
  }

  // ---- render helpers ----
  const shownBoard = myTurn ? board : liveBoard || board;
  const remaining = gs.turnDeadline ? Math.max(0, Math.ceil((gs.turnDeadline - now) / 1000)) : null;
  const activePlayer = gs.players[gs.turn];
  const handTiles = rack.filter(Boolean);
  const handValue = useMemo(() => handTiles.reduce((s, t) => s + (t.joker ? 30 : t.num), 0), [rack]);

  return (
    <div className="game" data-drag={drag ? '1' : '0'}>
      <header className="topbar">
        <div className="brand">R<span>II</span></div>
        <div className="players">
          {gs.players.map((p, i) => (
            <div
              key={p.name}
              className={
                'chip' +
                (p.isTurn ? ' active' : '') +
                (!p.connected ? ' off' : '') +
                (i === gs.youIndex ? ' you' : '')
              }
            >
              <span className="chip-name">{p.name}</span>
              <span className="chip-count">{p.tiles}</span>
              {!p.hasMelded && <span className="chip-lock" title="Sin bajada inicial">30</span>}
            </div>
          ))}
        </div>
        <div className="status">
          <div className="pot" title="Fichas en el pozo">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="4" y="3" width="10" height="14" rx="2" />
              <rect x="9" y="7" width="10" height="14" rx="2" />
            </svg>
            {gs.potCount}
          </div>
          {remaining !== null && (
            <div className={'timer' + (remaining <= 15 ? ' danger' : '')}>{fmt(remaining)}</div>
          )}
          <button
            className="btn-mute"
            onClick={toggleMute}
            title={muted ? 'Activar sonido' : 'Silenciar'}
            aria-label={muted ? 'Activar sonido' : 'Silenciar'}
          >
            {muted ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                <path d="m17 9 5 6M22 9l-5 6" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <main className="board" data-drop="newmeld">
        <div className="board-inner">
          {shownBoard.map((meld, mi) => (
            <div className="meld" key={meld.id}>
              {meld.tiles.map((t, i) => (
                <div className="slot-wrap" key={t.id} data-drop={`meld:${mi}:${i}`}>
                  <Tile
                    tile={t}
                    dragging={drag?.tile.id === t.id}
                    placed={placed.has(t.id)}
                    locked={myTurn && !gs.hasMelded && !placed.has(t.id)}
                    onPointerDown={(e) => startDrag(e, t, { type: 'meld', meldIndex: mi, index: i })}
                  />
                </div>
              ))}
              <div className="meld-tail" data-drop={`meld:${mi}:${meld.tiles.length}`} />
            </div>
          ))}
          {drag && (
            <div className="newmeld-hint" data-drop="newmeld">
              + Nueva combinación
            </div>
          )}
          {shownBoard.length === 0 && !drag && (
            <div className="board-empty">
              {myTurn ? 'Arrastra fichas aquí para formar grupos o escaleras' : `Turno de ${activePlayer?.name}…`}
            </div>
          )}
        </div>
      </main>

      <footer className="bottom">
        <div className="bottom-row">
          <div className="side">
            <button className="btn btn-icon" onClick={() => sortRack('groups')} title="Ordenar por número">
              777
            </button>
            <button className="btn btn-icon" onClick={() => sortRack('runs')} title="Ordenar por color">
              789
            </button>
            <span className="hand-value" title="Puntos en mano">{handValue} pts</span>
          </div>

          <div className={'rack' + (myTurn ? ' my-turn' : '')}>
            {rack.map((t, i) => (
              <div className="rack-slot" key={i} data-drop={`rack:${i}`}>
                {t && (
                  <Tile
                    tile={t}
                    dragging={drag?.tile.id === t.id}
                    onPointerDown={(e) => startDrag(e, t, { type: 'rack', index: i })}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="side">
            <button
              className="btn btn-round"
              disabled={!myTurn || placed.size === 0}
              onClick={undo}
              title="Deshacer"
              aria-label="Deshacer jugada"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 14 4 9l5-5" />
                <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
              </svg>
            </button>
            <button
              className="btn btn-round btn-draw"
              disabled={!myTurn || gs.potCount === 0}
              onClick={draw}
              title="Robar ficha y pasar"
              aria-label="Robar ficha y pasar"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="5" y="3" width="14" height="18" rx="2.5" />
                <path d="M12 8v6M9 11h6" />
              </svg>
            </button>
            <button
              className="btn btn-round btn-go"
              disabled={!myTurn || placed.size === 0}
              onClick={endTurn}
              title="Terminar turno"
              aria-label="Terminar turno"
            >
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </button>
          </div>
        </div>
      </footer>

      {drag && (
        <div
          className="ghost-layer"
          style={{
            transform: `translate(${drag.x - drag.dx}px, ${drag.y - drag.dy}px)`,
            width: drag.w,
            height: drag.h,
          }}
        >
          <Tile tile={drag.tile} ghost />
        </div>
      )}
    </div>
  );
}

function fmt(s) {
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}
