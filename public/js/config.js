(function () {
  const $ = (id) => document.getElementById(id);

  const GAMES = {
    rummy:        { title: 'RUMMY',              castigo: false },
    cucaracha:    { title: 'CUCARACHA II',       castigo: true  },
    benditosiete: { title: 'BENDITO 7',          castigo: true  },
    porqueyo:     { title: '¿POR QUÉ SIEMPRE YO?', castigo: false }
  };

  const params = new URLSearchParams(location.search);
  const slug = params.get('game');
  const meta = GAMES[slug];

  if (!meta) {
    location.href = 'index.html';
    return;
  }

  const playerName = sessionStorage.getItem('gc_playerName');
  if (!playerName) {
    location.href = 'index.html';
    return;
  }

  $('gameTitle').textContent = meta.title;
  $('playerSub').textContent = playerName;

  const penaltyField = $('penaltyField');
  if (!meta.castigo) penaltyField.style.display = 'none';

  const toggle = $('bettingToggle');
  const amountFields = $('amountFields');

  toggle.addEventListener('change', () => {
    amountFields.classList.toggle('is-visible', toggle.checked);
  });

  $('continueBtn').addEventListener('click', () => {
    const qs = new URLSearchParams();
    qs.set('name', playerName);

    if (toggle.checked) {
      const bet = Math.max(0, Math.floor(Number($('betAmount').value) || 0));
      qs.set('betting', '1');
      qs.set('bet', String(bet));
      if (meta.castigo) {
        const penalty = Math.max(0, Math.floor(Number($('penaltyAmount').value) || 0));
        qs.set('penalty', String(penalty));
      }
    } else {
      qs.set('betting', '0');
    }

    location.href = '/games/' + slug + '/?' + qs.toString();
  });
})();
