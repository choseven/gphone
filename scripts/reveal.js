const Reveal = (function () {
  let chains = [];
  let entriesByChain = {};
  let playerMap = {};
  let chainIdx = 0;
  let stepIdx = 0;
  let currentRoom = null;
  let currentMe = null;
  // Reaction counts (local)
  const rxnCounts = { '😂': 0, '😲': 0, '❤️': 0 };

  async function load(room, set) {
    currentRoom = room;
    const { data: ch } = await db()
      .from('chains').select('*').eq('room_id', room.id).order('position', { ascending: true });
    chains = ch || [];

    const { data: entries } = await db()
      .from('chain_entries').select('*').eq('room_id', room.id).order('step', { ascending: true });

    const { data: players } = await db()
      .from('players').select('id, username, avatar').eq('room_id', room.id);
    playerMap = {};
    (players || []).forEach(p => playerMap[p.id] = p);

    const { data: drawings } = await db()
      .from('drawings').select('id, data').eq('room_id', room.id);
    const dmap = {};
    (drawings || []).forEach(d => dmap[d.id] = d.data);

    entriesByChain = {};
    (entries || []).forEach(e => {
      e._author = playerMap[e.author_player_id] || { username: 'Someone', avatar: '0' };
      if (e.drawing_id) e._drawingData = dmap[e.drawing_id];
      entriesByChain[e.chain_id] = entriesByChain[e.chain_id] || [];
      entriesByChain[e.chain_id].push(e);
    });

    chainIdx = 0;
    stepIdx = 0;

    App.showScreen('reveal');
    bind(room);
    showCurrentChain();
  }

  function bind(room) {
    currentMe = Room.getMe();

    // Prev/Next entry buttons
    $('#btn-prev-entry').onclick = () => {
      if (stepIdx > 1) { stepIdx--; rebuildChain(); }
    };
    $('#btn-next-entry').onclick = () => {
      revealNext();
    };

    // Host chain navigation
    const hostControls = $('#host-reveal-controls');
    if (currentMe?.is_host) {
      hostControls.classList.remove('hidden');

      $('#btn-prev-chain').onclick = () => {
        if (chainIdx > 0) { chainIdx--; stepIdx = 0; showCurrentChain(); }
      };
      $('#btn-next-chain').onclick = () => {
        if (chainIdx < chains.length - 1) { chainIdx++; stepIdx = 0; showCurrentChain(); }
        else showGameOver();
      };
      $('#btn-finish-reveal').onclick = showGameOver;
    } else {
      hostControls.classList.add('hidden');
    }

    // Reaction buttons
    $$('.reaction-btn').forEach(btn => {
      btn.onclick = () => {
        const emoji = btn.dataset.emoji;
        rxnCounts[emoji] = (rxnCounts[emoji] || 0) + 1;
        updateReactionCounts();
        floatEmoji(emoji);
      };
    });

    // Reveal chat
    Chat.initReveal(room, currentMe || { id: 'anon', username: 'Guest' });
  }

  function showCurrentChain() {
    stepIdx = 0;
    const container = $('#reveal-chain');
    container.innerHTML = '';
    $('#reveal-chain-label').textContent = `Chain ${chainIdx + 1} / ${chains.length}`;
    revealNext(); // show first entry automatically
  }

  function rebuildChain() {
    const container = $('#reveal-chain');
    container.innerHTML = '';
    const entries = currentEntries();
    const target = stepIdx;
    stepIdx = 0;
    for (let i = 0; i < target; i++) {
      appendEntry(entries[i]);
      stepIdx++;
    }
  }

  function revealNext() {
    const entries = currentEntries();
    if (stepIdx >= entries.length) return;
    appendEntry(entries[stepIdx]);
    stepIdx++;
  }

  function appendEntry(e) {
    const container = $('#reveal-chain');
    const card = document.createElement('div');

    if (e.type === 'drawing') {
      card.className = 'chain-entry drawing-entry';
      const authorLabel = document.createElement('div');
      authorLabel.className = 'entry-type-label';
      authorLabel.innerHTML = `<span>🎨 Drawing</span><span class="entry-author">by ${escapeHtml(e._author.username)}</span>`;
      card.appendChild(authorLabel);

      if (e._drawingData) {
        const img = document.createElement('img');
        img.className = 'entry-image';
        img.src = drawingToDataURL(e._drawingData);
        img.alt = 'Drawing';
        card.appendChild(img);
      } else {
        const ph = document.createElement('p');
        ph.textContent = '(empty drawing)';
        ph.style.color = 'var(--text-muted)';
        card.appendChild(ph);
      }
    } else {
      const isPrompt = e.step === 0 || e.type === 'prompt';
      card.className = 'chain-entry ' + (isPrompt ? 'prompt-entry' : 'description-entry');

      const label = isPrompt ? '✍️ Prompt' : '💬 Description';
      const authorLabel = document.createElement('div');
      authorLabel.className = 'entry-type-label';
      authorLabel.innerHTML = `<span>${label}</span><span class="entry-author">by ${escapeHtml(e._author.username)}</span>`;

      const text = document.createElement('div');
      text.className = 'entry-text';
      text.textContent = e.content || '(nothing)';

      card.appendChild(authorLabel);
      card.appendChild(text);
    }

    container.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  function currentEntries() {
    return entriesByChain[chains[chainIdx]?.id] || [];
  }

  function updateReactionCounts() {
    const el = document.getElementById('rxn-laugh');
    if (el) el.textContent = rxnCounts['😂'] || 0;
    const el2 = document.getElementById('rxn-wow');
    if (el2) el2.textContent = rxnCounts['😲'] || 0;
    const el3 = document.getElementById('rxn-heart');
    if (el3) el3.textContent = rxnCounts['❤️'] || 0;
  }

  function showGameOver() {
    App.showScreen('gameover');
    renderScoreboard();

    $('#btn-play-again').onclick = async () => {
      if (currentRoom && currentMe?.is_host) {
        await Game.start();
      } else {
        Lobby.returnToLobby();
      }
    };

    $('#btn-back-lobby').onclick = () => {
      Lobby.returnToLobby();
    };
  }

  async function renderScoreboard() {
    const board = $('#scoreboard');
    if (!board) return;
    board.innerHTML = '';

    // Build simple scoreboard from all players
    const room = Room.get();
    if (!room) return;
    const { data: players } = await db()
      .from('players')
      .select('id, username, avatar, score')
      .eq('room_id', room.id)
      .order('score', { ascending: false });

    (players || []).forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'score-row';
      const medals = ['🥇', '🥈', '🥉'];
      row.innerHTML = `
        <span class="score-rank">${medals[i] || (i + 1)}</span>
        <span class="score-name">${avatarFor(p.avatar)} ${escapeHtml(p.username)}</span>
        <span class="score-pts">${p.score || 0} pts</span>
      `;
      board.appendChild(row);
    });
  }

  return { load };
})();
