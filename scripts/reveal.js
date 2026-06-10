const Reveal = (function () {
  var chains = [];
  var entriesByChain = {};
  var playerMap = {};
  var chainIdx = 0;
  var stepIdx = 0;
  var currentRoom = null;
  var currentMe = null;
  var rxnCounts = { laugh: 0, wow: 0, heart: 0 };

  async function load(room, set) {
    currentRoom = room;
    var chRes = await db().from('chains').select('*').eq('room_id', room.id).order('position', { ascending: true });
    chains = chRes.data || [];

    var eRes = await db().from('chain_entries').select('*').eq('room_id', room.id).order('step', { ascending: true });
    var pRes = await db().from('players').select('id, username, avatar').eq('room_id', room.id);
    playerMap = {};
    (pRes.data || []).forEach(function(p) { playerMap[p.id] = p; });

    var dRes = await db().from('drawings').select('id, data').eq('room_id', room.id);
    var dmap = {};
    (dRes.data || []).forEach(function(d) { dmap[d.id] = d.data; });

    entriesByChain = {};
    (eRes.data || []).forEach(function(e) {
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

    var prevBtn = document.getElementById('btn-prev-entry');
    if (prevBtn) prevBtn.onclick = function() {
      if (stepIdx > 1) { stepIdx--; rebuildChain(); }
    };

    var nextBtn = document.getElementById('btn-next-entry');
    if (nextBtn) nextBtn.onclick = revealNext;

    var hostControls = document.getElementById('host-reveal-controls');
    if (currentMe && currentMe.is_host) {
      if (hostControls) hostControls.classList.remove('hidden');

      var prevChain = document.getElementById('btn-prev-chain');
      if (prevChain) prevChain.onclick = function() {
        if (chainIdx > 0) { chainIdx--; stepIdx = 0; showCurrentChain(); }
      };

      var nextChain = document.getElementById('btn-next-chain');
      if (nextChain) nextChain.onclick = function() {
        if (chainIdx < chains.length - 1) { chainIdx++; stepIdx = 0; showCurrentChain(); }
        else showGameOver();
      };

      var finishBtn = document.getElementById('btn-finish-reveal');
      if (finishBtn) finishBtn.onclick = showGameOver;
    } else {
      if (hostControls) hostControls.classList.add('hidden');
    }

    document.querySelectorAll('.reaction-btn').forEach(function(btn) {
      btn.onclick = function() {
        var emoji = btn.dataset.emoji;
        var key = emoji === '😂' ? 'laugh' : emoji === '😲' ? 'wow' : 'heart';
        rxnCounts[key] = (rxnCounts[key] || 0) + 1;
        updateReactionCounts();
        floatEmoji(emoji);
      };
    });

    Chat.initReveal(room, currentMe || { id: 'anon', username: 'Guest', avatar: '0' });
  }

  function showCurrentChain() {
    stepIdx = 0;
    var container = document.getElementById('reveal-chain');
    if (container) container.innerHTML = '';
    var label = document.getElementById('reveal-chain-label');
    if (label) label.textContent = 'Chain ' + (chainIdx + 1) + ' / ' + chains.length;
    revealNext();
  }

  function rebuildChain() {
    var container = document.getElementById('reveal-chain');
    if (!container) return;
    container.innerHTML = '';
    var entries = currentEntries();
    var target = stepIdx;
    stepIdx = 0;
    for (var i = 0; i < target; i++) {
      appendEntry(entries[i]);
      stepIdx++;
    }
  }

  function revealNext() {
    var entries = currentEntries();
    if (stepIdx >= entries.length) return;
    appendEntry(entries[stepIdx]);
    stepIdx++;
  }

  function appendEntry(e) {
    var container = document.getElementById('reveal-chain');
    if (!container) return;
    var card = document.createElement('div');

    if (e.type === 'drawing') {
      card.className = 'chain-entry drawing-entry';
      var authorLabel = document.createElement('div');
      authorLabel.className = 'entry-type-label';
      authorLabel.innerHTML = '<span>Drawing</span><span class="entry-author">by ' + escapeHtml(e._author.username) + '</span>';
      card.appendChild(authorLabel);

      if (e._drawingData) {
        var img = document.createElement('img');
        img.className = 'entry-image';
        img.src = drawingToDataURL(e._drawingData);
        img.alt = 'Drawing';
        card.appendChild(img);
      } else {
        var ph = document.createElement('p');
        ph.textContent = '(empty drawing)';
        ph.style.color = 'var(--text-muted)';
        card.appendChild(ph);
      }
    } else {
      var isPrompt = e.step === 0 || e.type === 'prompt';
      card.className = 'chain-entry ' + (isPrompt ? 'prompt-entry' : 'description-entry');
      var labelText = isPrompt ? 'Prompt' : 'Description';
      var authorLabel2 = document.createElement('div');
      authorLabel2.className = 'entry-type-label';
      authorLabel2.innerHTML = '<span>' + labelText + '</span><span class="entry-author">by ' + escapeHtml(e._author.username) + '</span>';
      var text = document.createElement('div');
      text.className = 'entry-text';
      text.textContent = e.content || '(nothing)';
      card.appendChild(authorLabel2);
      card.appendChild(text);
    }

    container.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  function currentEntries() {
    var chain = chains[chainIdx];
    return chain ? (entriesByChain[chain.id] || []) : [];
  }

  function updateReactionCounts() {
    var el = document.getElementById('rxn-laugh');
    if (el) el.textContent = rxnCounts.laugh || 0;
    var el2 = document.getElementById('rxn-wow');
    if (el2) el2.textContent = rxnCounts.wow || 0;
    var el3 = document.getElementById('rxn-heart');
    if (el3) el3.textContent = rxnCounts.heart || 0;
  }

  function showGameOver() {
    App.showScreen('gameover');
    renderScoreboard();

    var playAgainBtn = document.getElementById('btn-play-again');
    if (playAgainBtn) {
      playAgainBtn.onclick = async function() {
        if (currentRoom && currentMe && currentMe.is_host) await Game.start();
        else Lobby.returnToLobby();
      };
    }

    var backLobbyBtn = document.getElementById('btn-back-lobby');
    if (backLobbyBtn) {
      backLobbyBtn.onclick = function() { Lobby.returnToLobby(); };
    }
  }

  async function renderScoreboard() {
    var board = document.getElementById('scoreboard');
    if (!board) return;
    board.innerHTML = '';
    var room = Room.get();
    if (!room) return;
    var pRes = await db().from('players').select('id, username, avatar, score')
      .eq('room_id', room.id).order('score', { ascending: false });
    var medals = ['1st', '2nd', '3rd'];
    (pRes.data || []).forEach(function(p, i) {
      var row = document.createElement('div');
      row.className = 'score-row';
      row.innerHTML =
        '<span class="score-rank">' + (medals[i] || (i + 1)) + '</span>' +
        '<span class="score-name">' + avatarFor(p.avatar) + ' ' + escapeHtml(p.username) + '</span>' +
        '<span class="score-pts">' + (p.score || 0) + ' pts</span>';
      board.appendChild(row);
    });
  }

  return { load: load };
})();
