(() => {
  const $ = (id) => document.getElementById(id);

  const joinScreen = $('join-screen');
  const gameScreen = $('game-screen');
  const nameInput = $('name-input');
  const roomInput = $('room-input');
  const joinBtn = $('join-btn');
  const notifBtn = $('notif-btn');
  const toastContainer = $('toast-container');

  const hudRole = $('hud-role');
  const hudPhase = $('hud-phase');
  const hudTimer = $('hud-timer');
  const hudFound = $('hud-found');

  const lobbyPanel = $('lobby-panel');
  const modeButtons = document.querySelectorAll('.mode-btn');
  const startBtn = $('start-btn');
  const restartBtn = $('restart-btn');
  const controlsHint = $('controls-hint');

  const briefingPanel = $('briefing-panel');
  const briefingTimer = $('briefing-timer');
  const briefingHider = $('briefing-hider');
  const briefingSeeker = $('briefing-seeker');
  const briefingProgress = $('briefing-progress');
  const formLocation = $('form-location');
  const formEta = $('form-eta');
  const formRisk = $('form-risk');
  const formVent = $('form-vent');
  const submitFormBtn = $('submit-form-btn');
  const formStatus = $('form-status');

  const cardBanner = $('card-banner');
  const cardLabel = cardBanner.querySelector('.card-label');
  const cardText = cardBanner.querySelector('.card-text');
  const chaosBanner = $('chaos-banner');
  const chaosText = chaosBanner.querySelector('.chaos-text');
  const resultBanner = $('result-banner');

  const canvas = $('board');
  const ctx = canvas.getContext('2d');
  const dpad = $('dpad');
  const dpadButtons = document.querySelectorAll('.dpad-btn');

  const physicalPanel = $('physical-panel');
  const physicalHider = $('physical-hider');
  const physicalSeeker = $('physical-seeker');
  const accuseBox = $('accuse-box');
  const accuseInput = $('accuse-input');
  const accuseBtn = $('accuse-btn');
  const foundRoster = $('found-roster');

  const foiPanel = $('foi-panel');
  const foiList = $('foi-list');

  const electionPanel = $('election-panel');
  const electionCandidates = $('election-candidates');

  const playerList = $('player-list');

  const disputeModal = $('dispute-modal');
  const disputeAccused = $('dispute-accused');
  const disputeAcceptBtn = $('dispute-accept-btn');
  const appealReasons = $('appeal-reasons');
  const appealCustom = $('appeal-custom');
  const appealSubmitBtn = $('appeal-submit-btn');
  const disputeSeeker = $('dispute-seeker');
  const disputeSeekerText = $('dispute-seeker-text');
  const disputeJuror = $('dispute-juror');
  const disputeJurorText = $('dispute-juror-text');
  const jurorVoteButtons = $('juror-vote-buttons');
  const voteUpholdBtn = $('vote-uphold-btn');
  const voteRejectBtn = $('vote-reject-btn');
  const jurorVotedText = $('juror-voted-text');

  const CELL = 30;
  const MARGIN = 24; // reserves space for grid-reference labels (A, B, C… / 1, 2, 3…)
  const MOVE_COOLDOWN_MS = 110;
  const DPAD_REPEAT_MS = 130;

  let ws = null;
  let myId = null;
  let grid = null;
  let latestState = null;
  let lastMoveAt = 0;
  let previousPhase = null;
  let selectedMode = 'virtual';

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // --- Alerts: toast + Notification API + vibration + beep --------------

  function beep() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const actx = new AudioCtx();
      const osc = actx.createOscillator();
      const gain = actx.createGain();
      osc.frequency.value = 660;
      osc.connect(gain);
      gain.connect(actx.destination);
      gain.gain.setValueAtTime(0.15, actx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.25);
      osc.start();
      osc.stop(actx.currentTime + 0.25);
      osc.onended = () => actx.close();
    } catch {
      // Audio unavailable; ignore.
    }
  }

  function showToast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  function alertEvent(text) {
    showToast(text);
    beep();
    if (navigator.vibrate) navigator.vibrate(200);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('Hide and Seek But Worse', { body: text });
      } catch {
        // Some browsers refuse Notification() outside a service worker; ignore.
      }
    }
  }

  notifBtn.addEventListener('click', () => {
    if (typeof Notification === 'undefined') {
      showToast('Notifications are not supported on this device.');
      return;
    }
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') {
        showToast('Alerts enabled.');
        beep();
      }
    });
  });

  // --- Connection ----------------------------------------------------------

  function connect(name, room) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`;
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      joinScreen.classList.add('hidden');
      gameScreen.classList.remove('hidden');
    });

    ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'init') {
        myId = msg.id;
        grid = { w: msg.grid.w, h: msg.grid.h, walls: new Set(msg.grid.walls) };
        canvas.width = grid.w * CELL + MARGIN;
        canvas.height = grid.h * CELL + MARGIN;
      } else if (msg.type === 'state') {
        latestState = msg;
        render(msg);
      } else if (msg.type === 'notice') {
        alertEvent(msg.text);
      }
    });

    ws.addEventListener('close', () => {
      joinScreen.classList.remove('hidden');
      gameScreen.classList.add('hidden');
      hudPhase.textContent = 'Phase: disconnected';
    });
  }

  joinBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || `Player${Math.floor(Math.random() * 1000)}`;
    const room = roomInput.value.trim() || 'default';
    connect(name, room);
  });

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  // Keep the render loop ticking so countdowns and banner expiries update
  // even when no new state message has arrived.
  setInterval(() => {
    if (latestState) render(latestState);
  }, 500);

  // --- Lobby ---------------------------------------------------------------

  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedMode = btn.dataset.mode;
      send({ type: 'setMode', mode: selectedMode });
    });
  });

  startBtn.addEventListener('click', () => send({ type: 'start' }));
  restartBtn.addEventListener('click', () => send({ type: 'restart' }));

  // --- Briefing form ---------------------------------------------------------

  submitFormBtn.addEventListener('click', () => {
    send({
      type: 'submitForm',
      location: formLocation.value,
      eta: Number(formEta.value) || 0,
      risk: formRisk.checked,
      ventilation: formVent.checked,
    });
    formStatus.textContent = 'Declaration filed.';
  });

  // --- Accusation (seeking card gate) ---------------------------------------

  accuseBtn.addEventListener('click', () => {
    send({ type: 'accuse', text: accuseInput.value });
    accuseInput.value = '';
  });

  // --- Movement: keyboard + touch D-pad -------------------------------------

  const KEY_DIRS = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
  };

  function attemptMove(dx, dy) {
    const now = performance.now();
    if (now - lastMoveAt < MOVE_COOLDOWN_MS) return;
    lastMoveAt = now;
    send({ type: 'move', dx, dy });
  }

  window.addEventListener('keydown', (evt) => {
    const dir = KEY_DIRS[evt.key];
    if (!dir) return;
    evt.preventDefault();
    attemptMove(dir[0], dir[1]);
  });

  dpadButtons.forEach((btn) => {
    const dx = Number(btn.dataset.dx);
    const dy = Number(btn.dataset.dy);
    let repeatTimer = null;
    const stop = () => {
      if (repeatTimer) {
        clearInterval(repeatTimer);
        repeatTimer = null;
      }
    };
    btn.addEventListener('pointerdown', (evt) => {
      evt.preventDefault();
      btn.setPointerCapture(evt.pointerId);
      attemptMove(dx, dy);
      stop();
      repeatTimer = setInterval(() => attemptMove(dx, dy), DPAD_REPEAT_MS);
    });
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('contextmenu', (evt) => evt.preventDefault());
  });

  // --- Dispute modal ---------------------------------------------------------

  disputeAcceptBtn.addEventListener('click', () => send({ type: 'disputeResponse', action: 'accept' }));

  appealSubmitBtn.addEventListener('click', () => {
    const reason = appealCustom.value.trim();
    if (!reason) return;
    send({ type: 'disputeResponse', action: 'appeal', reason });
    appealCustom.value = '';
  });

  voteUpholdBtn.addEventListener('click', () => send({ type: 'tribunalVote', vote: 'uphold' }));
  voteRejectBtn.addEventListener('click', () => send({ type: 'tribunalVote', vote: 'reject' }));

  // --- Render ----------------------------------------------------------------

  function fmtTimer(deadline) {
    if (!deadline) return '—';
    const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    return `${secs}s`;
  }

  function render(s) {
    if (!grid) return;
    const me = s.players.find((p) => p.id === myId) || { role: s.you === s.seekerId ? 'seeker' : 'hider' };

    if (previousPhase !== s.phase) {
      if (s.phase === 'lobby') {
        formLocation.value = '';
        formEta.value = '';
        formRisk.checked = false;
        formVent.checked = false;
        formStatus.textContent = '';
        appealCustom.value = '';
      }
      previousPhase = s.phase;
    }

    // HUD
    hudRole.textContent = `Role: ${me.role === 'seeker' ? 'Seeker' : 'Hider'}`;
    hudPhase.textContent = `Phase: ${s.phase}`;
    hudFound.textContent = `Found: ${s.foundCount}/${s.totalHiders}`;
    const deadline = s.phase === 'briefing' ? s.briefingDeadline
      : s.phase === 'hiding' ? s.hideDeadline
      : s.phase === 'seeking' ? s.seekDeadline
      : 0;
    hudTimer.textContent = `Time: ${fmtTimer(deadline)}`;

    renderLobby(s);
    renderBriefing(s, me);
    renderCardBanner(s, me);
    renderChaosBanner(s);
    renderResultBanner(s);
    renderBoardAndPhysical(s, me);
    renderFoi(s);
    renderElection(s, me);
    renderDispute(s, me);
    renderPlayerList(s);

    restartBtn.classList.toggle('hidden', s.phase !== 'ended');
    controlsHint.textContent = s.mode === 'physical'
      ? "This screen keeps everyone in sync. Go hide for real!"
      : 'Arrow keys / WASD, or the pad below on touch screens.';
  }

  function renderLobby(s) {
    lobbyPanel.classList.toggle('hidden', s.phase !== 'lobby');
    startBtn.classList.toggle('hidden', s.phase !== 'lobby');
    if (s.phase !== 'lobby') return;
    modeButtons.forEach((btn) => btn.classList.toggle('selected', btn.dataset.mode === s.mode));
    startBtn.disabled = s.players.length < 2;
    startBtn.textContent = s.players.length < 2 ? 'Waiting for another player…' : 'Start Game';
  }

  function renderBriefing(s, me) {
    const show = s.phase === 'briefing';
    briefingPanel.classList.toggle('hidden', !show);
    if (!show) return;
    briefingTimer.textContent = fmtTimer(s.briefingDeadline);

    const isHider = me.role === 'hider';
    briefingHider.classList.toggle('hidden', !isHider);
    briefingSeeker.classList.toggle('hidden', isHider);
    if (isHider && s.myForm && !formStatus.textContent) {
      formStatus.textContent = 'Declaration filed. You may resubmit before the deadline.';
    }
    if (!isHider) {
      briefingProgress.textContent = `${s.formsSubmitted}/${s.totalHiders} declarations filed.`;
    }
  }

  function renderCardBanner(s, me) {
    let card = null;
    let label = '';
    if (me.role === 'hider' && s.hidingCard && (s.phase === 'hiding' || s.phase === 'seeking')) {
      card = s.hidingCard;
      label = 'Your Hiding Obligation';
    } else if (me.role === 'seeker' && s.seekingCard && s.phase === 'seeking') {
      card = s.seekingCard;
      label = 'Your Seeking Obligation';
    }
    cardBanner.classList.toggle('hidden', !card);
    if (card) {
      cardLabel.textContent = label;
      cardText.textContent = card.text;
    }
  }

  function renderChaosBanner(s) {
    const active = s.chaosEvent && Date.now() < s.chaosEvent.expiresAt;
    chaosBanner.classList.toggle('hidden', !active);
    if (active) chaosText.textContent = s.chaosEvent.text;
  }

  function renderResultBanner(s) {
    const show = s.phase === 'ended' && s.lastResult;
    resultBanner.classList.toggle('hidden', !show);
    if (!show) return;
    const r = s.lastResult;
    resultBanner.textContent = r.reason === 'all_found'
      ? `Round concluded: all hiders located (${r.found}/${r.total}).`
      : `Round concluded: time expired (${r.found}/${r.total} located).`;
  }

  function renderBoardAndPhysical(s, me) {
    const active = s.phase === 'hiding' || s.phase === 'seeking' || s.phase === 'ended';
    const virtual = s.mode === 'virtual' && active;
    const physical = s.mode === 'physical' && s.phase !== 'ended' && (s.phase === 'hiding' || s.phase === 'seeking');

    canvas.classList.toggle('hidden', !virtual);
    dpad.classList.toggle('hidden', !virtual);
    if (virtual) drawBoard(s, me);

    physicalPanel.classList.toggle('hidden', !physical);
    if (physical) {
      const isSeeker = me.role === 'seeker';
      physicalHider.classList.toggle('hidden', isSeeker);
      physicalSeeker.classList.toggle('hidden', !isSeeker);
      if (isSeeker) {
        const needsAccusation = s.phase === 'seeking' && s.seekingCard?.effect === 'accuse_first' && !s.youHaveAccused;
        accuseBox.classList.toggle('hidden', !needsAccusation);

        foundRoster.innerHTML = '';
        for (const p of s.players) {
          if (p.role !== 'hider') continue;
          const li = document.createElement('li');
          li.className = p.found ? 'is-found' : '';
          const nameSpan = document.createElement('span');
          nameSpan.textContent = `${p.name} ${p.found ? '(found)' : ''}`;
          li.appendChild(nameSpan);
          if (!p.found) {
            const btn = document.createElement('button');
            btn.textContent = 'Found!';
            btn.disabled = !!s.dispute;
            btn.addEventListener('click', () => send({ type: 'declareFound', targetId: p.id }));
            li.appendChild(btn);
          }
          foundRoster.appendChild(li);
        }
      }
    }
  }

  function renderFoi(s) {
    const show = !!s.foi && s.foi.length > 0;
    foiPanel.classList.toggle('hidden', !show);
    if (!show) return;
    foiList.innerHTML = s.foi.map((f) => `
      <div class="foi-entry">
        <span class="foi-name ${f.found ? 'is-found' : ''}">${esc(f.name)}${f.found ? ' — LOCATED' : ''}</span>
        <p>Declared location: &ldquo;${esc(f.location)}&rdquo;<br />
        Estimated discovery: ${esc(f.eta)} min (non-binding) &middot;
        Risk assessment: ${f.risk ? 'Completed' : 'Not on file'} &middot;
        Ventilation: ${f.ventilation ? 'Confirmed' : 'Not on file'}</p>
      </div>
    `).join('');
  }

  function renderElection(s, me) {
    const show = !!s.pendingVote;
    electionPanel.classList.toggle('hidden', !show);
    if (!show) return;
    if (!s.pendingVote.eligible) {
      electionCandidates.innerHTML = '<p class="hint">Voting is open to hiders only.</p>';
      return;
    }
    if (s.pendingVote.youVoted) {
      electionCandidates.innerHTML = '<p class="hint">Vote recorded. Awaiting the rest of the ballot.</p>';
      return;
    }
    electionCandidates.innerHTML = '';
    for (const c of s.pendingVote.candidates) {
      const btn = document.createElement('button');
      btn.textContent = c.name;
      btn.addEventListener('click', () => send({ type: 'vote', candidateId: c.id }));
      electionCandidates.appendChild(btn);
    }
  }

  function renderDispute(s, me) {
    const d = s.dispute;
    disputeModal.classList.toggle('hidden', !d);
    if (!d) return;

    disputeAccused.classList.toggle('hidden', d.role !== 'accused');
    disputeSeeker.classList.toggle('hidden', d.role !== 'seeker');
    disputeJuror.classList.toggle('hidden', d.role !== 'juror');

    if (d.role === 'accused') {
      appealReasons.innerHTML = '';
      for (const reason of d.reasons) {
        const btn = document.createElement('button');
        btn.textContent = reason;
        btn.addEventListener('click', () => send({ type: 'disputeResponse', action: 'appeal', reason }));
        appealReasons.appendChild(btn);
      }
    } else if (d.role === 'seeker') {
      disputeSeekerText.textContent = d.stage === 'tribunal'
        ? `${d.accusedName} has appealed. The tribunal is voting.`
        : `Your finding of ${d.accusedName} is on file, pending their response.`;
    } else if (d.role === 'juror') {
      const inTribunal = d.stage === 'tribunal';
      jurorVoteButtons.classList.toggle('hidden', !inTribunal || d.hasVoted);
      jurorVotedText.classList.toggle('hidden', !(inTribunal && d.hasVoted));
      disputeJurorText.textContent = inTribunal
        ? `${d.accusedName} has appealed their discovery. Cast your vote.`
        : `A case is pending review against ${d.accusedName}.`;
    }
  }

  function renderPlayerList(s) {
    playerList.innerHTML = '';
    for (const p of s.players) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'swatch';
      dot.style.background = p.color;
      li.appendChild(dot);
      const label = p.role === 'seeker' ? 'seeker' : p.found ? 'found' : 'hider';
      li.appendChild(document.createTextNode(`${p.name} (${label})`));
      playerList.appendChild(li);
    }
  }

  function colLabel(i) {
    return String.fromCharCode(65 + (i % 26));
  }

  function drawBoard(s, me) {
    const ox = MARGIN;
    const oy = MARGIN;
    const w = grid.w * CELL;
    const h = grid.h * CELL;

    // Label strip background
    ctx.fillStyle = '#0a1626';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Map field — blueprint blue
    ctx.fillStyle = '#0f2340';
    ctx.fillRect(ox, oy, w, h);

    // Fine grid ruling
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(140,180,220,0.10)';
    for (let x = 0; x <= grid.w; x++) {
      ctx.beginPath();
      ctx.moveTo(ox + x * CELL + 0.5, oy);
      ctx.lineTo(ox + x * CELL + 0.5, oy + h);
      ctx.stroke();
    }
    for (let y = 0; y <= grid.h; y++) {
      ctx.beginPath();
      ctx.moveTo(ox, oy + y * CELL + 0.5);
      ctx.lineTo(ox + w, oy + y * CELL + 0.5);
      ctx.stroke();
    }

    // Section ruling every 4 columns / 3 rows, like a plan reference grid
    ctx.strokeStyle = 'rgba(140,180,220,0.26)';
    for (let x = 0; x <= grid.w; x += 4) {
      ctx.beginPath();
      ctx.moveTo(ox + x * CELL + 0.5, oy);
      ctx.lineTo(ox + x * CELL + 0.5, oy + h);
      ctx.stroke();
    }
    for (let y = 0; y <= grid.h; y += 3) {
      ctx.beginPath();
      ctx.moveTo(ox, oy + y * CELL + 0.5);
      ctx.lineTo(ox + w, oy + y * CELL + 0.5);
      ctx.stroke();
    }

    // Grid reference labels
    ctx.fillStyle = '#6f9bd1';
    ctx.font = '10px "Courier New", monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (let x = 0; x < grid.w; x++) {
      ctx.fillText(colLabel(x), ox + x * CELL + CELL / 2, oy / 2);
    }
    ctx.textAlign = 'right';
    for (let y = 0; y < grid.h; y++) {
      ctx.fillText(String(y + 1), ox - 6, oy + y * CELL + CELL / 2);
    }

    // Walls as hatched "restricted zone" partitions
    ctx.fillStyle = '#1c2e4a';
    for (const key of grid.walls) {
      const [x, y] = key.split(',').map(Number);
      ctx.fillRect(ox + x * CELL, oy + y * CELL, CELL, CELL);
    }
    ctx.save();
    ctx.strokeStyle = 'rgba(140,180,220,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const key of grid.walls) {
      const [x, y] = key.split(',').map(Number);
      const px = ox + x * CELL;
      const py = oy + y * CELL;
      ctx.moveTo(px, py + CELL);
      ctx.lineTo(px + CELL, py);
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(140,180,220,0.3)';
    ctx.lineWidth = 1;
    for (const key of grid.walls) {
      const [x, y] = key.split(',').map(Number);
      ctx.strokeRect(ox + x * CELL + 0.5, oy + y * CELL + 0.5, CELL - 1, CELL - 1);
    }

    // Faint diagonal watermark
    ctx.save();
    ctx.translate(ox + w / 2, oy + h / 2);
    ctx.rotate(-Math.PI / 14);
    ctx.fillStyle = 'rgba(140,180,220,0.07)';
    ctx.font = `bold ${Math.round(w / 16)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('OFFICIAL FLOOR PLAN — DO NOT DISTRIBUTE', 0, 0);
    ctx.restore();

    // Dashed technical-drawing border
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(140,180,220,0.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ox + 0.5, oy + 0.5, w - 1, h - 1);
    ctx.setLineDash([]);

    // Player tokens, styled like rubber-stamp impressions
    for (const p of s.players) {
      const cx = ox + p.x * CELL + CELL / 2;
      const cy = oy + p.y * CELL + CELL / 2;

      ctx.beginPath();
      ctx.arc(cx, cy, CELL / 2 - 6, 0, Math.PI * 2);
      ctx.fillStyle = p.found ? '#4a4e5c' : p.color;
      ctx.fill();

      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(cx, cy, CELL / 2 - 3, 0, Math.PI * 2);
      ctx.strokeStyle = p.found ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      if (p.id === myId) {
        ctx.beginPath();
        ctx.arc(cx, cy, CELL / 2 - 5, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
      if (p.role === 'seeker') {
        ctx.beginPath();
        ctx.arc(cx, cy, CELL / 2 - 1, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.fillStyle = '#e8e9ee';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(p.name.slice(0, 10), cx, cy - CELL / 2 - 3);
    }

    if (s.phase === 'hiding') {
      overlayText(me.role === 'seeker' ? 'Hiders are scattering…' : 'Find a hiding spot!');
    } else if (s.phase === 'ended' && s.lastResult) {
      const r = s.lastResult;
      overlayText(
        r.reason === 'all_found'
          ? `All hiders found! (${r.found}/${r.total})`
          : `Time's up — ${r.found}/${r.total} found.`
      );
    }
  }

  function overlayText(text) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, canvas.height - 34, canvas.width, 34);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, canvas.width / 2, canvas.height - 13);
  }
})();
