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
const rummy = require('./games/rummy/server.js');
const Ledger = require('./core/ledger.js');

const PORT = Number(process.env.PORT) || 3000;

const app = express();
const httpServer = http.createServer(app);

const deps = { Ledger };

app.use('/games/cucaracha', cucaracha.createRouter(deps));
app.use('/games/porqueyo', porqueyo.createRouter(deps));
app.use('/games/benditosiete', benditosiete.createRouter(deps));
app.use('/games/rummy', rummy.createRouter(deps));

app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use(express.static(path.join(__dirname, 'public')));

httpServer.listen(PORT, () => {
  console.log(`\n  🎲  GAMECENTER`);
  console.log(`  Lobby:  http://localhost:${PORT}/`);
});
