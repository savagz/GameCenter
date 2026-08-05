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
    playerModal.classList.remove('is-hidden');
    playerNameInput.focus();
  });

  $('playerCancel').addEventListener('click', () => playerModal.classList.add('is-hidden'));

  $('playerSave').addEventListener('click', () => {
    const name = playerNameInput.value.trim().slice(0, 16);
    if (name) {
      sessionStorage.setItem('gc_playerName', name);
      playerLabel.textContent = name;
    }
    playerModal.classList.add('is-hidden');
  });

  playerNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('playerSave').click();
  });

  /* ---------- configuración general (stub) ---------- */
  $('settingsBtn').addEventListener('click', () => $('settingsModal').classList.remove('is-hidden'));
  $('settingsClose').addEventListener('click', () => $('settingsModal').classList.add('is-hidden'));

  /* ---------- carrusel de selección de juego ---------- */
  const cards = Array.from(document.querySelectorAll('.game-card'));
  const viewport = $('cardViewport');
  const row = $('cardRow');
  const gap = 22;
  let currentIndex = Math.max(0, cards.findIndex((c) => c.classList.contains('selected')));

  function cardWidth() {
    return parseFloat(getComputedStyle(cards[0]).width);
  }

  function renderCarousel() {
    const step = cardWidth() + gap;
    const offset = (viewport.getBoundingClientRect().width - cardWidth()) / 2 - currentIndex * step;
    row.style.transform = `translateX(${offset}px)`;
    cards.forEach((c, i) => c.classList.toggle('selected', i === currentIndex));
  }

  function goTo(index) {
    currentIndex = (index + cards.length) % cards.length;
    renderCarousel();
  }

  cards.forEach((card, i) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.enter-btn')) return;
      goTo(i);
    });
  });

  function goToGame(slug) {
    if (!sessionStorage.getItem('gc_playerName')) {
      playerModal.classList.remove('is-hidden');
      playerNameInput.focus();
      return;
    }
    location.href = 'config.html?game=' + encodeURIComponent(slug);
  }

  document.querySelectorAll('.enter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      goTo(cards.indexOf(btn.closest('.game-card')));
      goToGame(btn.dataset.game);
    });
  });

  $('navLeft').addEventListener('click', () => goTo(currentIndex - 1));
  $('navRight').addEventListener('click', () => goTo(currentIndex + 1));

  window.addEventListener('resize', renderCarousel);
  window.addEventListener('load', renderCarousel);
  renderCarousel();

  loadPlayerName();
})();
