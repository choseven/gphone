// ═══════════════════════════════════════════════════════════
//  reveal.js — Chain reveal, reactions, chat, host controls
// ═══════════════════════════════════════════════════════════

const Reveal = (() => {

  let roomId    = null;
  let playerId  = null;
  let chains    = {};
  let chainList = [];
  let chainIdx  = 0;
  let entryIdx  = 0;
  let unsubFns  = [];

  const REACTION_EMOJIS = { '😂': 'laugh', '😲': 'wow', '❤️': 'heart' };

  // ── Enter reveal phase ────────────────────────────────────
  async function enter(room) {
    roomId   = Lobby.getRoomId();
    playerId = Lobby.getPlayerId();
    chains   = room.chains || {};

    App.showScreen('reveal');

    // Build ordered chain list
    const order = room.playerOrder || room.player_order || [];

    // ── CHANGED: fetch entries from entries table for each chain ──
    chainList = [];
    for (const uid of order) {
      const cid = Object.keys(chains).find(id =>
        chains[id].owner === uid || chains[id].owner_uid === uid
      );
      if (!cid) continue;

      let entries;
      if (chains[cid].entries && Object.keys(chains[cid].entries).length > 0) {
        // already loaded (passed from lobby fetchAndSync)
        entries = Object.values(chains[cid].entries).sort((a, b) => (a.created_at || a.t || 0) - (b.created_at || b.t || 0));
      } else {
        // fetch from DB
        const rows = await FB.dbGetAll('entries', { chain_id: cid });
        entries = rows.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
      }

      chainList.push({ chainId: cid, owner: uid, entries });
    }

    chainIdx = room.revealChainIdx || room.reveal_chain_idx || 0;
    entryIdx = room.revealEntryIdx || room.reveal_entry_idx || 0;

    renderChain(chainIdx, entryIdx);

    const isHost = Lobby.getIsHost();
    document.getElementById('host-reveal-controls').classList.toggle('hidden', !isHost);

    if (isHost) {
      document.getElementById('btn-next-chain').onclick = async () => {
        if (chainIdx >= chainList.length - 1) {
          await FB.dbUpdate('rooms', { id: roomId }, { state: 'GAME_OVER' });
          return;
        }
        chainIdx++;
        entryIdx = 0;
        // ── CHANGED: update rooms table ──
        await FB.dbUpdate('rooms', { id: roomId }, {
          reveal_chain_idx: chainIdx,
          reveal_entry_idx: entryIdx
        });
      };

      document.getElementById('btn-prev-chain').onclick = async () => {
        if (chainIdx <= 0) return;
        chainIdx--;
        entryIdx = 0;
        await FB.dbUpdate('rooms', { id: roomId }, {
          reveal_chain_idx: chainIdx,
          reveal_entry_idx: entryIdx
        });
      };
    }

    document.getElementById('btn-next-entry').onclick = () => {
      const chain = chainList[chainIdx];
      if (!chain) return;
      if (entryIdx < chain.entries.length - 1) {
        entryIdx++;
        renderChain(chainIdx, entryIdx);
      } else if (isHost) {
        document.getElementById('btn-next-chain').click();
      }
    };

    document.getElementById('btn-prev-entry').onclick = () => {
      if (entryIdx > 0) { entryIdx--; renderChain(chainIdx, entryIdx); }
    };

    // ── CHANGED: watch rooms table for host advancing reveal ──
    const unsub = FB.dbOn({
      table: 'rooms', event: 'UPDATE',
      match: { id: roomId },
      callback: payload => {
        const r = payload.new;
        if (!r) return;
        if (r.state === 'GAME_OVER') {
          // Build minimal room obj and pass to Game
          Lobby.fetchAndSync(r);
          return;
        }
        const newCI = r.reveal_chain_idx || 0;
        const newEI = r.reveal_entry_idx || 0;
        if (newCI !== chainIdx || newEI !== entryIdx) {
          chainIdx = newCI;
          entryIdx = newEI;
          renderChain(chainIdx, entryIdx);
        }
      }
    });
    unsubFns.push(unsub);

    setupReactions();
    Lobby.setupChat('reveal');
  }

  // ── Render chain entries up to entryIdx ───────────────────
  function renderChain(ci, ei) {
    const chain     = chainList[ci];
    const container = document.getElementById('reveal-chain');
    container.innerHTML = '';
    if (!chain) return;

    document.getElementById('reveal-chain-label').textContent =
      `Chain ${ci + 1} / ${chainList.length}`;

    const visible = chain.entries.slice(0, ei + 1);
    visible.forEach((entry, i) => {
      const div = document.createElement('div');
      const typeClass = entry.type === 'prompt'      ? 'prompt-entry'
                      : entry.type === 'drawing'     ? 'drawing-entry'
                      :                                'description-entry';
      div.className = `chain-entry ${typeClass}`;

      const typeLabel = entry.type === 'prompt'      ? '✍️ Original Prompt'
                      : entry.type === 'drawing'     ? '🎨 Drawing'
                      :                                '💬 Description';

      const authorName = getPlayerName(entry.author);

      div.innerHTML = `
        <div class="entry-type-label">
          <span>${typeLabel}</span>
          <span class="entry-author">by ${Lobby.escHtml(authorName)}</span>
        </div>
        ${entry.type === 'drawing'
          ? `<img class="entry-image" src="${Lobby.escHtml(entry.content)}" alt="Drawing" />`
          : `<div class="entry-text">${Lobby.escHtml(entry.content)}</div>`
        }
      `;
      container.appendChild(div);

      if (i === visible.length - 1) {
        div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    const isLast      = ei >= chain.entries.length - 1;
    const isLastChain = ci >= chainList.length - 1;
    const btn = document.getElementById('btn-next-entry');
    if (isLast) {
      btn.textContent = isLastChain
        ? (Lobby.getIsHost() ? 'Finish Game →' : '(Host advances)')
        : (Lobby.getIsHost() ? 'Next Chain →'  : '(Waiting for host)');
    } else {
      btn.textContent = 'Next →';
    }

    document.getElementById('btn-prev-entry').style.display = ei > 0 ? '' : 'none';
  }

  function getPlayerName(uid) {
    if (!uid) return 'Unknown';
    // Look across all chains for this author
    for (const chain of chainList) {
      const entry = chain.entries.find(e => e.author === uid);
      if (entry) return uid.slice(0, 6); // fallback — player name isn't stored on entries
    }
    return uid.slice(0, 6);
  }

  // ── Reactions ─────────────────────────────────────────────
  function setupReactions() {
    // ── CHANGED: watch reactions table ──
    const unsub = FB.dbOn({
      table: 'reactions', event: '*',
      match: { room_id: roomId },
      callback: async () => {
        const rows = await FB.dbGetAll('reactions', { room_id: roomId });
        document.getElementById('rxn-laugh').textContent = rows.filter(r => r.type === 'laugh').length;
        document.getElementById('rxn-wow').textContent   = rows.filter(r => r.type === 'wow').length;
        document.getElementById('rxn-heart').textContent = rows.filter(r => r.type === 'heart').length;
      }
    });
    unsubFns.push(unsub);

    // Load initial counts
    FB.dbGetAll('reactions', { room_id: roomId }).then(rows => {
      document.getElementById('rxn-laugh').textContent = rows.filter(r => r.type === 'laugh').length;
      document.getElementById('rxn-wow').textContent   = rows.filter(r => r.type === 'wow').length;
      document.getElementById('rxn-heart').textContent = rows.filter(r => r.type === 'heart').length;
    });

    document.querySelectorAll('.reaction-btn').forEach(btn => {
      btn.onclick = async () => {
        const emoji = btn.dataset.emoji;
        const key   = REACTION_EMOJIS[emoji];
        if (!key) return;

        // ── CHANGED: upsert/delete from reactions table ──
        const already = await FB.dbGet('reactions', { room_id: roomId, type: key, uid: playerId });
        if (already) {
          await FB.dbDelete('reactions', { room_id: roomId, type: key, uid: playerId });
        } else {
          await FB.dbSet('reactions', { room_id: roomId, type: key, uid: playerId });
          spawnFloatingEmoji(emoji, btn);
        }
      };
    });

    // Floating emoji on any new reaction
    const unsubNew = FB.dbOn({
      table: 'reactions', event: 'INSERT',
      match: { room_id: roomId },
      callback: payload => {
        const key   = payload.new?.type;
        const emoji = Object.entries(REACTION_EMOJIS).find(([, v]) => v === key)?.[0];
        if (emoji) spawnFloatingEmoji(emoji, null);
      }
    });
    unsubFns.push(unsubNew);
  }

  function spawnFloatingEmoji(emoji, originEl) {
    const container = document.getElementById('float-reactions');
    const el = document.createElement('div');
    el.className  = 'float-emoji';
    el.textContent = emoji;

    let left = 50;
    if (originEl) {
      const rect = originEl.getBoundingClientRect();
      left = ((rect.left + rect.width / 2) / window.innerWidth) * 100;
    } else {
      left = 20 + Math.random() * 60;
    }
    el.style.left = left + '%';

    container.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function cleanup() {
    unsubFns.forEach(fn => fn());
    unsubFns = [];
  }

  return { enter, cleanup };
})();

window.Reveal = Reveal;
