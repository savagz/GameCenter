/* ============================================================
   GAMECENTER — servidor único
   Sirve el lobby (public/) y monta cada juego bajo /games/<slug>.
   ============================================================ */

const path = require('path');
const http = require('http');
const express = require('express');

const cucaracha = require('./games/cucaracha/server.js');
const porqueyo = require('./games/porqueyo/server.js');
const benditosiete = require('./games/benditosiete/server.js');
const Ledger = require('./core/ledger.js');
const BetGate = require('./core/bet-gate.js');

const PORT = Number(process.env.PORT) || 3000;

const app = express();
const httpServer = http.createServer(app);

const deps = { Ledger, BetGate };

app.use('/games/cucaracha', cucaracha.createRouter(deps));
app.use('/games/porqueyo', porqueyo.createRouter(deps));
app.use('/games/benditosiete', benditosiete.createRouter(deps));

app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use(express.static(path.join(__dirname, 'public')));

async function start() {
  /* rummy es ESM (tiene su propio package.json "type":"module") */
  const rummy = await import('./games/rummy/server/index.js');
  const { router } = rummy.mount(httpServer, deps);
  app.use('/games/rummy', router);

  httpServer.listen(PORT, () => {
    console.log(`\n  🎲  GAMECENTER`);
    console.log(`  Lobby:  http://localhost:${PORT}/`);
    console.log(`  Cucaracha II:        http://localhost:${PORT}/games/cucaracha/`);
    console.log(`  Rummy:               http://localhost:${PORT}/games/rummy/`);
    console.log(`  ¿Por qué siempre yo?: http://localhost:${PORT}/games/porqueyo/`);
    console.log(`  Bendito 7:           http://localhost:${PORT}/games/benditosiete/\n`);
  });
}

start();
