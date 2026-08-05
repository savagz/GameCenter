import { useEffect, useRef } from 'react';

/**
 * Cartel "TURNO DE ..." unificado (DESIGN.md §7) — mismo componente
 * visual que Cucaracha, Bendito 7 y ¿Por qué siempre yo?, generalizado
 * en shared/ui/turn-banner.js + turn-banner.css.
 */
export default function TurnBanner({ gs }) {
  const lastKeyRef = useRef(null);

  useEffect(() => {
    if (!gs || !gs.started || !window.GCTurnBanner) return;
    const key = `${gs.code}|${gs.turn}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;

    const cur = gs.players[gs.turn];
    if (!cur) return;
    window.GCTurnBanner.show(gs.turn === gs.youIndex ? '¡Es tu turno!' : `Turno de ${cur.name}`);
  }, [gs]);

  return (
    <div id="turnFlash" className="is-hidden">
      <span id="turnFlashText"></span>
    </div>
  );
}
