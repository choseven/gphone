const Reveal = (function () {
  let chains = [];
  let entriesByChain = {};
  let chainIdx = 0;
  let stepIdx = 0;
  let autoTimer = null;
  let revealSpeed = 3;
  let settings = {};

  async function load(room, set) {
    settings = set || {};
    revealSpeed = settings.reveal_speed || 3;
    const { data: ch } = await db().from('chains').select('*').eq('room_id', room.id).order('position', { ascending: true });
    chains = ch || [];
    const { data: entries } = await db().from('chain_entries').select('*').eq('room_id', room.id).order('step', { ascending: true });
    const { data: players } = await db().from('players').select('id, username, avatar').eq('room_id', room.id);
    const pmap = {};
    (players || []).forEach(p => pmap[p.id] = p);
    const { data: drawings } = await db().from('drawings').select('id, data').eq('room_id', room.id);
    const dmap = {};
    (drawings || []).forEach(d => dmap[d.id] = d.data);

    entriesByChain = {};
    (entries || []).forEach(e => {
      e._author = pmap[e.author_player_id] || { username: 'Someone', avatar: '0' };
      if (e.drawing_id) e._drawing = dmap[e.drawing_id];
      entriesByChain[e.chain_id] = entriesByChain[e.chain_id] || [];
      entriesByChain[e.chain_id].push(e);
    });

    chainIdx = 0;
    show();
    bind();
  }

  function bind() {
    $('#reveal-prev').onclick = () => { stopAuto(); chainIdx = (chainIdx - 1 + chains.length) % chains.length; show(); };
    $('#reveal-next').onclick = () => { stopAuto(); chainIdx = (chainIdx + 1) % chains.length; show(); };
    $('#reveal-step').onclick = () => { stopAuto(); revealNext(); };
    $('#reveal-auto').onclick = () => toggleAuto();
    $('#reveal-full').onclick = () => {
      const el = $('#screen-reveal');
      if (!document.fullscreenElement) el.requestFullscreen?.(); else document.exitFullscreen?.();
    };
    $('#reveal-home').onclick = () => { stopAuto(); Lobby.returnToLobby(); };
  }

  function currentEntries() { return entriesByChain[chains[chainIdx]?.id] || []; }

  function show() {
    stepIdx = 0;
    const stage = $('#reveal-stage');
    stage.innerHTML = '';
    $('#reveal-pos').textContent = `${chainIdx + 1} / ${chains.length}`;
    revealNext();
  }

  function revealNext() {
    const entries = currentEntries();
    if (stepIdx >= entries.length) return false;
    const e = entries[stepIdx];
    const stage = $('#reveal-stage');
    const wrap = document.createElement('div');
    wrap.className = 'reveal-entry';
    const side = stepIdx % 2 === 0 ? '' : 'right';

    if (e.type === 'drawing' && e._drawing) {
      wrap.innerHTML = `<div class="author">${avatarFor(e._author.avatar)} <b>${escapeHtml(e._author.username)}</b> drew</div>`;
      const holder = document.createElement('div');
      holder.className = 'reveal-draw';
      wrap.appendChild(holder);
      const eng = createCanvasEngine(holder, { size: (e._drawing && e._drawing.size) || 720 });
      eng.loadData(e._drawing, false);
      eng.canvas.style.width = '100%';
    } else {
      wrap.innerHTML = `<div class="author">${avatarFor(e._author.avatar)} <b>${escapeHtml(e._author.username)}</b> ${e.step === 0 ? 'wrote' : 'guessed'}</div>
        <div class="reveal-bubble ${side}">${escapeHtml(e.content || '')}</div>`;
    }
    stage.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('show'));
    wrap.scrollIntoView({ behavior: 'smooth', block: 'end' });
    stepIdx++;
    return stepIdx < entries.length;
  }

  function toggleAuto() {
    if (autoTimer) { stopAuto(); return; }
    $('#reveal-auto').textContent = 'Pause';
    const delay = 2400 - (revealSpeed - 1) * 450;
    autoTimer = setInterval(() => {
      const more = revealNext();
      if (!more) {
        if (chainIdx < chains.length - 1) { chainIdx++; show(); }
        else stopAuto();
      }
    }, delay);
  }

  function stopAuto() {
    clearInterval(autoTimer);
    autoTimer = null;
    const b = $('#reveal-auto');
    if (b) b.textContent = 'Auto play';
  }

  return { load };
})();
