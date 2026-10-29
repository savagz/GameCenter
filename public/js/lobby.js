(function () {
  const $ = (id) => document.getElementById(id);

  /* ---------- nombre del jugador ---------- */
  const playerBtn = $('playerBtn');
  const playerLabel = $('playerLabel');
  const playerModal = $('playerModal');
  const playerNameInput = $('playerNameInput');

  function loadPlayerName() {
    const name = sessionStorage.getItem('gc_playerName');
    if (name) playerLabel.textContent = name;
  }

  playerBtn.addEventListener('click', () => {
    playerNameInput.value = sessionStorage.getItem('gc_playerName') || '';
    playerModal.classList.add('is-open');
    playerNameInput.focus();
  });

  $('playerCancel').addEventListener('click', () => playerModal.classList.remove('is-open'));

  $('playerSave').addEventListener('click', () => {
    const name = playerNameInput.value.trim().slice(0, 16);
    if (name) {
      sessionStorage.setItem('gc_playerName', name);
      playerLabel.textContent = name;
    }
    playerModal.classList.remove('is-open');
  });

  playerNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('playerSave').click();
  });

  /* ---------- configuración general (apuestas + defaults por juego) ---------- */

  const SLUGS = ['rummy', 'cucaracha', 'benditosiete', 'porqueyo', 'tapados', 'tomaseis'];
  const SETTINGS_KEY = 'gc_settings';

  const DEFAULT_SETTINGS = {
    betting: { enabled: false, bet: 500, penalty: 100 },
    rummy:        { turnSeconds: 120 },
    cucaracha:    { maxPlayers: 6 },
    benditosiete: { maxPlayers: 4, lances: 3 },
    porqueyo:     { maxPlayers: 6, startMarbles: 10 },
    tapados:      { maxPlayers: 4 },
    tomaseis:     { maxPlayers: 6 }
  };

  function clampInt(v, min, max, def) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  }

  function loadSettings() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (_) { saved = null; }
    const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    if (saved && saved.betting) {
      if (typeof saved.betting.enabled === 'boolean') s.betting.enabled = saved.betting.enabled;
      if (typeof saved.betting.bet === 'number') s.betting.bet = saved.betting.bet;
      if (typeof saved.betting.penalty === 'number') s.betting.penalty = saved.betting.penalty;
    }
    SLUGS.forEach((slug) => { if (saved && saved[slug]) Object.assign(s[slug], saved[slug]); });
    return s;
  }

  function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

  function populateSettingsForm() {
    const s = loadSettings();
    $('bet-enabled').checked = s.betting.enabled;
    $('bet-fields').classList.toggle('is-visible', s.betting.enabled);
    $('bet-amount').value = s.betting.bet;
    $('bet-penalty').value = s.betting.penalty;
    $('cuc-maxplayers').value = s.cucaracha.maxPlayers;
    $('bs-maxplayers').value = s.benditosiete.maxPlayers;
    $('bs-lances').value = s.benditosiete.lances;
    $('pq-maxplayers').value = s.porqueyo.maxPlayers;
    $('pq-marbles').value = s.porqueyo.startMarbles;
    $('tp-maxplayers').value = s.tapados.maxPlayers;
    $('t6-maxplayers').value = s.tomaseis.maxPlayers;

    $('rummyLevelPicker').querySelectorAll('.level-opt').forEach((btn) => {
      const on = Number(btn.dataset.seconds) === s.rummy.turnSeconds;
      btn.classList.toggle('selected', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function persistSettingsFromForm() {
    const s = loadSettings();
    s.betting.enabled = $('bet-enabled').checked;
    s.betting.bet = clampInt($('bet-amount').value, 0, 1e7, s.betting.bet);
    s.betting.penalty = clampInt($('bet-penalty').value, 0, 1e7, s.betting.penalty);
    s.cucaracha.maxPlayers = clampInt($('cuc-maxplayers').value, 2, 6, s.cucaracha.maxPlayers);
    s.benditosiete.maxPlayers = clampInt($('bs-maxplayers').value, 2, 8, s.benditosiete.maxPlayers);
    s.benditosiete.lances = clampInt($('bs-lances').value, 1, 10, s.benditosiete.lances);
    s.porqueyo.maxPlayers = clampInt($('pq-maxplayers').value, 2, 8, s.porqueyo.maxPlayers);
    s.porqueyo.startMarbles = clampInt($('pq-marbles').value, 3, 30, s.porqueyo.startMarbles);
    s.tapados.maxPlayers = clampInt($('tp-maxplayers').value, 2, 6, s.tapados.maxPlayers);
    s.tomaseis.maxPlayers = clampInt($('t6-maxplayers').value, 2, 10, s.tomaseis.maxPlayers);
    const selectedLevel = $('rummyLevelPicker').querySelector('.level-opt.selected');
    s.rummy.turnSeconds = selectedLevel ? Number(selectedLevel.dataset.seconds) : s.rummy.turnSeconds;
    saveSettings(s);
  }

  function buildConfig(slug) {
    const s = loadSettings();
    const bet = s.betting;
    if (slug === 'rummy') {
      return { turnSeconds: s.rummy.turnSeconds, bettingEnabled: bet.enabled, apuesta: bet.enabled ? bet.bet : 0 };
    }
    if (slug === 'cucaracha') {
      return {
        maxPlayers: s.cucaracha.maxPlayers,
        bettingEnabled: bet.enabled,
        apuesta: bet.enabled ? bet.bet : 0,
        castigo: bet.enabled ? bet.penalty : 0
      };
    }
    if (slug === 'benditosiete') {
      return {
        maxPlayers: s.benditosiete.maxPlayers,
        lances: s.benditosiete.lances,
        bettingEnabled: bet.enabled,
        apuesta: bet.enabled ? bet.bet : 0,
        castigo: bet.enabled ? bet.penalty : 0
      };
    }
    if (slug === 'porqueyo') {
      return {
        maxPlayers: s.porqueyo.maxPlayers,
        startMarbles: s.porqueyo.startMarbles,
        bettingEnabled: bet.enabled,
        apuesta: bet.enabled ? bet.bet : 0
      };
    }
    if (slug === 'tapados') {
      return {
        maxPlayers: s.tapados.maxPlayers,
        bettingEnabled: bet.enabled,
        apuesta: bet.enabled ? bet.bet : 0
      };
    }
    return {
      maxPlayers: s.tomaseis.maxPlayers,
      bettingEnabled: bet.enabled,
      apuesta: bet.enabled ? bet.bet : 0
    };
  }

  $('settingsBtn').addEventListener('click', () => {
    populateSettingsForm();
    $('settingsModal').classList.add('is-open');
  });
  $('settingsClose').addEventListener('click', () => $('settingsModal').classList.remove('is-open'));

  $('bet-enabled').addEventListener('change', () => {
    $('bet-fields').classList.toggle('is-visible', $('bet-enabled').checked);
    persistSettingsFromForm();
  });

  $('settingsModal').querySelectorAll('input[type="number"]').forEach((input) => {
    input.addEventListener('change', persistSettingsFromForm);
  });

  $('rummyLevelPicker').querySelectorAll('.level-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('rummyLevelPicker').querySelectorAll('.level-opt').forEach((b) => {
        b.classList.toggle('selected', b === btn);
        b.setAttribute('aria-checked', b === btn ? 'true' : 'false');
      });
      persistSettingsFromForm();
    });
  });

  /* ---------- ventana de sala (crear / unirse, unificada en el lobby) ---------- */

  const SESSION_KEYS = {
    rummy: 'rummy:session',
    cucaracha: 'cucaracha:session',
    benditosiete: 'bendito7:session',
    porqueyo: 'porqueyo:session',
    tapados: 'tapados:session',
    tomaseis: 'tomaseis:session'
  };

  const GAME_NAMES = {
    rummy: 'RUMMY',
    cucaracha: 'CUCARACHA II',
    benditosiete: 'BENDITO 7',
    porqueyo: '¿POR QUÉ SIEMPRE YO?',
    tapados: 'TAPADOS',
    tomaseis: 'TOMA 6'
  };

  const GAME_DISPLAY = {
    rummy: 'Rummy',
    cucaracha: 'Cucaracha II',
    benditosiete: 'Bendito 7',
    porqueyo: '¿Por qué siempre yo?',
    tapados: 'Tapados',
    tomaseis: 'Toma 6'
  };

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'gc-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
    setTimeout(() => {
      el.classList.remove('is-in');
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 250);
    }, 3200);
  }

  async function roomApi(slug, action, body) {
    const res = await fetch('/games/' + slug + '/api/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const json = await res.json().catch(() => ({ ok: false, error: 'Respuesta inválida.' }));
    if (!json.ok) throw new Error(json.error || 'Error desconocido.');
    return json;
  }

  const Room = { slug: null, roomId: null, playerId: null, token: null, source: null };
  const seenPlayerIds = new Set();

  function closeRoomConnection() {
    if (Room.source) { Room.source.close(); Room.source = null; }
  }

  function showRoomError(msg) {
    const el = $('roomError');
    el.textContent = msg;
    el.classList.remove('is-hidden');
  }

  function renderRoom(slug, me, st) {
    if (st.status !== 'lobby') {
      closeRoomConnection();
      location.href = '/games/' + slug + '/';
      return;
    }

    $('roomCode').textContent = st.id;
    const maxPlayers = (st.config && st.config.maxPlayers) || 4;
    $('roomHint').textContent = 'Comparte este código. Máximo ' + maxPlayers + ' jugadores.';

    const betNote = $('roomBetNote');
    if (st.config && st.config.bettingEnabled) {
      let txt = 'Apuesta: $' + Number(st.config.apuesta || 0).toLocaleString('en-US');
      if (st.config.castigo) txt += ' · Multa: $' + Number(st.config.castigo).toLocaleString('en-US');
      betNote.textContent = txt;
      betNote.classList.remove('is-hidden');
    } else {
      betNote.classList.add('is-hidden');
    }

    const list = $('roomPlayers');
    list.textContent = '';
    st.players.forEach((p, i) => {
      const li = document.createElement('li');
      if (!p.online) li.classList.add('off');
      if (!seenPlayerIds.has(p.id)) li.classList.add('li-enter');
      seenPlayerIds.add(p.id);
      li.style.setProperty('--p', 'var(--p' + ((i % 6) + 1) + ')');
      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.textContent = (p.name || '?').trim().charAt(0).toUpperCase();
      li.appendChild(avatar);
      const nameSpan = document.createElement('span');
      nameSpan.className = 'player-name';
      nameSpan.textContent = p.name;
      li.appendChild(nameSpan);
      const tags = [];
      if (p.id === st.hostId) tags.push('anfitrión');
      if (p.id === me.playerId) tags.push('tú');
      if (tags.length) {
        const em = document.createElement('em');
        em.textContent = tags.join(' · ');
        li.appendChild(em);
      }
      list.appendChild(li);
    });

    const isHost = st.hostId === me.playerId;
    const enough = st.players.length >= 2;
    $('roomStart').classList.toggle('is-hidden', !isHost);
    $('roomStart').disabled = !enough;

    const waitEl = $('roomWait');
    if (!enough) {
      waitEl.textContent = `Esperando jugadores… (${st.players.length}/2 mínimo)`;
      waitEl.classList.remove('is-hidden');
    } else if (!isHost) {
      waitEl.textContent = 'Esperando a que el anfitrión inicie…';
      waitEl.classList.remove('is-hidden');
    } else {
      waitEl.classList.add('is-hidden');
    }
  }

  function connectRoom(slug, me) {
    closeRoomConnection();
    const q = `room=${encodeURIComponent(me.roomId)}&pid=${encodeURIComponent(me.playerId)}&token=${encodeURIComponent(me.token)}`;
    const src = new EventSource('/games/' + slug + '/events?' + q);
    Room.source = src;
    src.addEventListener('state', (e) => {
      try { renderRoom(slug, me, JSON.parse(e.data)); } catch (err) { console.error(err); }
    });
  }

  function openRoom(slug, me) {
    seenPlayerIds.clear();
    Room.slug = slug;
    Room.roomId = me.roomId;
    Room.playerId = me.playerId;
    Room.token = me.token;
    sessionStorage.setItem(SESSION_KEYS[slug], JSON.stringify({ roomId: me.roomId, playerId: me.playerId, token: me.token }));

    $('roomGameName').textContent = GAME_NAMES[slug];
    $('roomError').classList.add('is-hidden');
    $('roomModal').classList.add('is-open');
    connectRoom(slug, me);
  }

  async function leaveRoom() {
    const { slug, roomId, playerId, token } = Room;
    closeRoomConnection();
    $('roomModal').classList.remove('is-open');
    if (slug) sessionStorage.removeItem(SESSION_KEYS[slug]);
    Room.slug = null; Room.roomId = null; Room.playerId = null; Room.token = null;
    if (slug && roomId) {
      try { await roomApi(slug, 'leave', { roomId, playerId, token }); } catch (_) { /* ya no importa */ }
    }
  }

  $('roomLeave').addEventListener('click', leaveRoom);

  $('roomStart').addEventListener('click', async () => {
    if (!Room.roomId) return;
    try {
      await roomApi(Room.slug, 'start', { roomId: Room.roomId, playerId: Room.playerId, token: Room.token });
    } catch (e) { showRoomError(e.message); }
  });

  let joinSlug = null;

  function showJoinError(msg) {
    const el = $('joinError');
    el.textContent = msg;
    el.classList.remove('is-hidden');
  }

  function openJoinPrompt(slug) {
    joinSlug = slug;
    $('joinModalTitle').textContent = 'Unirse · ' + GAME_DISPLAY[slug];
    $('joinCodeInput').value = '';
    $('joinError').classList.add('is-hidden');
    $('joinModal').classList.add('is-open');
    $('joinCodeInput').focus();
  }

  $('joinCancel').addEventListener('click', () => $('joinModal').classList.remove('is-open'));

  async function doJoinRoom() {
    const code = $('joinCodeInput').value.toUpperCase().trim();
    if (code.length !== 4) { showJoinError('El código tiene 4 letras.'); return; }
    const name = sessionStorage.getItem('gc_playerName');
    try {
      const res = await roomApi(joinSlug, 'join', { name, roomId: code });
      $('joinModal').classList.remove('is-open');
      openRoom(joinSlug, res);
    } catch (e) { showJoinError(e.message); }
  }

  $('joinConfirm').addEventListener('click', doJoinRoom);
  $('joinCodeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoinRoom(); });

  async function doCreateRoom(slug, btn) {
    const name = sessionStorage.getItem('gc_playerName');
    if (btn) btn.classList.add('is-busy');
    try {
      const res = await roomApi(slug, 'create', { name, config: buildConfig(slug) });
      openRoom(slug, res);
    } catch (e) { toast(e.message); }
    finally { if (btn) btn.classList.remove('is-busy'); }
  }

  /* ---------- grid de juegos: selección + carrusel móvil ---------- */
  const cards = Array.from(document.querySelectorAll('.game-card'));
  const grid = $('gameGrid');

  function selectCard(card) {
    cards.forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
  }

  cards.forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.enter-btn')) return;
      selectCard(card);
    });
    card.addEventListener('keydown', (e) => {
      if (e.target.closest('.enter-btn')) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCard(card); }
    });
    card.addEventListener('focus', () => selectCard(card));
  });

  document.querySelectorAll('.game-actions .enter-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectCard(btn.closest('.game-card'));
      if (!sessionStorage.getItem('gc_playerName')) {
        playerModal.classList.add('is-open');
        playerNameInput.focus();
        return;
      }
      const slug = btn.dataset.game;
      if (btn.dataset.action === 'create') doCreateRoom(slug, btn);
      else openJoinPrompt(slug);
    });
  });

  /* dots del carrusel móvil */
  const dots = Array.from(document.querySelectorAll('#carouselDots button'));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const idx = cards.indexOf(entry.target);
          dots.forEach((d, i) => d.classList.toggle('active', i === idx));
        }
      });
    }, { root: grid, threshold: 0.6 });
    cards.forEach((c) => io.observe(c));
  }
  dots.forEach((dot, i) => {
    dot.addEventListener('click', () => {
      cards[i].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
  });

  /* foco de luz que sigue al cursor en cada tarjeta */
  cards.forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });

  /* ---------- hero, barra superior y revelado al hacer scroll ---------- */
  $('heroSettings').addEventListener('click', () => $('settingsBtn').click());

  const topbar = $('topbar');
  const onScroll = () => topbar.classList.toggle('is-scrolled', window.scrollY > 24);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const revealEls = Array.from(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window) {
    const ro = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          ro.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    revealEls.forEach((el) => ro.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-in'));
  }

  /* cerrar modales con Escape o clic fuera (la sala solo se abandona con su botón) */
  document.querySelectorAll('.gc-overlay').forEach((overlay) => {
    if (overlay.id === 'roomModal') return;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('is-open'); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.gc-overlay.is-open').forEach((o) => { if (o.id !== 'roomModal') o.classList.remove('is-open'); });
  });

  loadPlayerName();
})();
