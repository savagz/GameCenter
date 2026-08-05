import React, { useEffect, useState, useCallback, useRef } from 'react';
import { socket } from './socket.js';
import Lobby from './components/Lobby.jsx';
import Game from './components/Game.jsx';
import TurnBanner from './components/TurnBanner.jsx';
import { sfx } from './sound.js';

export default function App() {
  const [gs, setGs] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [gameOver, setGameOver] = useState(null);
  const gsRef = useRef(null);

  const toast = useCallback((msg, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  useEffect(() => {
    socket.on('gameState', (state) => {
      gsRef.current = state;
      setGs(state);
      if (state.started) setGameOver(null);
    });
    socket.on('invalid', (msg) => {
      toast(msg, 'error');
      sfx.invalid();
    });
    socket.on('info', (msg) => toast(msg, 'info'));
    socket.on('gameOver', (data) => {
      setGameOver(data);
      const me = gsRef.current?.players?.[gsRef.current.youIndex]?.name;
      if (me === data.winner) sfx.win();
      else sfx.lose();
    });
    socket.on('gameStarted', () => setGameOver(null));
    return () => {
      socket.off('gameState');
      socket.off('invalid');
      socket.off('info');
      socket.off('gameOver');
      socket.off('gameStarted');
    };
  }, [toast]);

  useEffect(() => {
    if (!window.GCBetModal) return;
    window.GCBetModal.render(gs?.betGate || null, socket.id, {
      onConfirm: () => socket.emit('betConfirm'),
      onCancel: () => socket.emit('betCancel'),
    });
  }, [gs]);

  return (
    <>
      <TurnBanner gs={gs} />
      {!gs ? (
        <Lobby onError={(m) => toast(m, 'error')} />
      ) : !gs.started ? (
        <WaitingRoom gs={gs} gameOver={gameOver} onCloseGameOver={() => setGameOver(null)} />
      ) : (
        <Game gs={gs} toast={toast} />
      )}
      {gameOver && <GameOverModal data={gameOver} gs={gs} onClose={() => setGameOver(null)} />}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.msg}</div>
        ))}
      </div>
    </>
  );
}

function WaitingRoom({ gs }) {
  const isHost = gs.youIndex === gs.hostIndex;
  return (
    <div className="lobby-screen">
      <div className="panel waiting">
        <h1 className="logo">RUMMIKUB<span>II</span></h1>
        <p className="room-code-label">Código de sala</p>
        <div className="room-code">{gs.code}</div>
        <p className="hint">
          Comparte este código. Máximo 4 jugadores.
          {gs.turnSeconds && <> · Turno: {gs.turnSeconds}s</>}
        </p>
        <ul className="waiting-players">
          {gs.players.map((p, i) => (
            <li key={p.name} className={p.connected ? '' : 'off'}>
              <span className="dot" />
              {p.name}
              {i === gs.hostIndex && <em> · anfitrión</em>}
              {i === gs.youIndex && <em> · tú</em>}
            </li>
          ))}
        </ul>
        {isHost ? (
          <button
            className="btn btn-primary"
            disabled={gs.players.length < 2}
            onClick={() => socket.emit('startGame')}
          >
            {gs.players.length < 2 ? 'Esperando jugadores…' : 'Comenzar partida'}
          </button>
        ) : (
          <p className="hint pulse">Esperando a que el anfitrión inicie…</p>
        )}
      </div>
    </div>
  );
}

function GameOverModal({ data, gs, onClose }) {
  const isHost = gs && gs.youIndex === gs.hostIndex;
  const mine = gs && gs.players[gs.youIndex]?.name === data.winner;
  const banner = window.GCVictoryBanner
    ? GCVictoryBanner.text({ winnerName: data.winner, amountWon: data.prize || 0, mine, fallback: data.reason })
    : { title: `${data.winner} gana`, body: data.reason };
  return (
    <div className="overlay">
      <div className="panel gameover">
        <svg className="trophy" viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0V4Z" />
          <path d="M7 6H4a1 1 0 0 0-1 1c0 2.2 1.8 4 4 4M17 6h3a1 1 0 0 1 1 1c0 2.2-1.8 4-4 4" />
        </svg>
        <h1>{banner.title}</h1>
        <p className="hint">{banner.body}</p>
        {data.prize > 0 && <p className="hint">{data.reason}</p>}
        <table className="scores">
          <tbody>
            {[...data.scores]
              .sort((a, b) => a.points - b.points)
              .map((s) => (
                <tr key={s.name} className={s.name === data.winner ? 'winner' : ''}>
                  <td>{s.name}</td>
                  <td>{s.points} pts</td>
                </tr>
              ))}
          </tbody>
        </table>
        <div className="row">
          {isHost && (
            <button className="btn btn-primary" onClick={() => { socket.emit('startGame'); onClose(); }}>
              Jugar de nuevo
            </button>
          )}
          <button className="btn" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
