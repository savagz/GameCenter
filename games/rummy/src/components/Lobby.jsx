import React, { useState } from 'react';
import { socket } from '../socket.js';

const LEVELS = [
  { seconds: 120, label: 'Relajado', time: '120s' },
  { seconds: 90, label: 'Normal', time: '90s' },
  { seconds: 45, label: 'Experto', time: '45s' },
];

/* nombre y apuesta llegan de GameCenter por query string (?name=&betting=&bet=) */
const gcParams = new URLSearchParams(location.search);
const gcName = gcParams.get('name');
const gcBetting = gcParams.get('betting') === '1';
const gcBet = Math.max(0, Math.floor(Number(gcParams.get('bet')) || 0));

export default function Lobby({ onError }) {
  const [name, setName] = useState(gcName || localStorage.getItem('rmk-name') || '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [turnTime, setTurnTime] = useState(120);

  function remember() {
    localStorage.setItem('rmk-name', name.trim());
  }

  function create() {
    if (!name.trim()) return onError('Escribe tu nombre.');
    remember();
    setBusy(true);
    socket.emit('createRoom', { name: name.trim(), turnTime, bettingEnabled: gcBetting, betAmount: gcBet }, (res) => {
      setBusy(false);
      if (res?.error) onError(res.error);
    });
  }

  function join() {
    if (!name.trim()) return onError('Escribe tu nombre.');
    if (code.trim().length !== 4) return onError('El código tiene 4 letras.');
    remember();
    setBusy(true);
    socket.emit('joinRoom', { code: code.trim(), name: name.trim() }, (res) => {
      setBusy(false);
      if (res?.error) onError(res.error);
    });
  }

  return (
    <div className="lobby-screen">
      <div className="panel">
        <h1 className="logo">RUMMIKUB<span>II</span></h1>
        <div className="lobby-tiles" aria-hidden="true">
          <div className="tile t-red demo"><span className="num">7</span><span className="pip" /></div>
          <div className="tile t-blue demo"><span className="num">7</span><span className="pip" /></div>
          <div className="tile t-black demo"><span className="num">7</span><span className="pip" /></div>
          <div className="tile t-joker demo"><JokerFace /><span className="pip" /></div>
        </div>

        <label className="field">
          <span>Tu nombre</span>
          <input
            value={name}
            maxLength={16}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Samuel"
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
        </label>

        {gcBetting && (
          <div className="field">
            <span>Apuesta de GameCenter: ${gcBet.toLocaleString('en-US')}</span>
          </div>
        )}

        <div className="field">
          <span>Nivel de juego</span>
          <div className="level-picker" role="radiogroup" aria-label="Nivel de juego">
            {LEVELS.map((l) => (
              <button
                key={l.seconds}
                type="button"
                role="radio"
                aria-checked={turnTime === l.seconds}
                className={'level-opt' + (turnTime === l.seconds ? ' selected' : '')}
                onClick={() => setTurnTime(l.seconds)}
              >
                <strong>{l.label}</strong>
                <small>{l.time} / turno</small>
              </button>
            ))}
          </div>
        </div>

        <button className="btn btn-primary" disabled={busy} onClick={create}>
          Crear sala
        </button>

        <div className="divider"><span>o únete a una</span></div>

        <div className="join-row">
          <input
            className="code-input"
            value={code}
            maxLength={4}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="CÓDIGO"
            onKeyDown={(e) => e.key === 'Enter' && join()}
          />
          <button className="btn" disabled={busy} onClick={join}>
            Unirse
          </button>
        </div>

        <div className="version-tag">v1.1.0 · 2026-07-12</div>
      </div>
    </div>
  );
}

export function JokerFace() {
  return (
    <svg className="joker-face" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="11.5" cy="13" r="2" fill="currentColor" />
      <circle cx="20.5" cy="13" r="2" fill="currentColor" />
      <path d="M10 19.5c1.8 2.6 4 3.8 6 3.8s4.2-1.2 6-3.8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
