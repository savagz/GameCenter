import React from 'react';
import { JokerFace } from './Lobby.jsx';

export default function Tile({ tile, onPointerDown, dragging, ghost, placed, locked }) {
  const cls = ['tile', tile.joker ? 't-joker' : 't-' + tile.color];
  if (dragging) cls.push('dragging-src');
  if (ghost) cls.push('drag-ghost');
  if (placed) cls.push('just-placed');
  if (locked) cls.push('locked');
  return (
    <div className={cls.join(' ')} onPointerDown={onPointerDown}>
      <div className="tile-face">
        {tile.joker ? <JokerFace /> : <span className="num">{tile.num}</span>}
        <span className="pip" />
      </div>
    </div>
  );
}
