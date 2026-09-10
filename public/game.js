(() => {
  const joinScreen = document.getElementById('join-screen');
  const gameScreen = document.getElementById('game-screen');
  const nameInput = document.getElementById('name-input');
  const roomInput = document.getElementById('room-input');
  const joinBtn = document.getElementById('join-btn');
  const startBtn = document.getElementById('start-btn');
  const restartBtn = document.getElementById('restart-btn');
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const hudRole = document.getElementById('hud-role');
  const hudPhase = document.getElementById('hud-phase');
  const hudTimer = document.getElementById('hud-timer');
  const hudFound = document.getElementById('hud-found');
  const playerList = document.getElementById('player-list');
  const dpadButtons = document.querySelectorAll('.dpad-btn');

  const CELL = 32;
  const MOVE_COOLDOWN_MS = 110;
  const DPAD_REPEAT_MS = 130;

  let ws = null;
  let myId = null;
  let grid = null; // { w, h, walls: Set<string> }
  let latestState = null;
  let lastMoveAt = 0;

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
        canvas.width = grid.w * CELL;
        canvas.height = grid.h * CELL;
      } else if (msg.type === 'state') {
        latestState = msg;
        render();
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

  startBtn.addEventListener('click', () => send({ type: 'start' }));
  restartBtn.addEventListener('click', () => send({ type: 'restart' }));

  window.addEventListener('keydown', (evt) => {
    const dir = KEY_DIRS[evt.key];
    if (!dir) return;
    evt.preventDefault();
    attemptMove(dir[0], dir[1]);
  });

  // Touch/mouse D-pad: fire immediately on press, then repeat while held,
  // using Pointer Events so it works the same for touch, mouse, and pen.
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

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  function render() {
    if (!latestState || !grid) return;
    const s = latestState;
    const me = s.players.find((p) => p.id === myId);

    hudRole.textContent = `Role: ${me ? (me.role === 'seeker' ? 'Seeker' : 'Hider') : '—'}`;
    hudPhase.textContent = `Phase: ${s.phase}`;
    hudFound.textContent = `Found: ${s.foundCount}/${s.totalHiders}`;

    const deadline = s.phase === 'hiding' ? s.hideDeadline : s.phase === 'seeking' ? s.seekDeadline : 0;
    if (deadline) {
      const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      hudTimer.textContent = `Time: ${secs}s`;
    } else {
      hudTimer.textContent = 'Time: —';
    }

    startBtn.classList.toggle('hidden', s.phase !== 'lobby');
    restartBtn.classList.toggle('hidden', s.phase !== 'ended');

    drawBoard(s, me);
    renderPlayerList(s);

    if (deadline && (s.phase === 'hiding' || s.phase === 'seeking')) {
      requestAnimationFrame(() => { if (latestState === s) render(); });
    }
  }

  function drawBoard(s, me) {
    ctx.fillStyle = '#0b0c11';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#262a38';
    for (const key of grid.walls) {
      const [x, y] = key.split(',').map(Number);
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    for (let x = 0; x <= grid.w; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL, 0);
      ctx.lineTo(x * CELL, grid.h * CELL);
      ctx.stroke();
    }
    for (let y = 0; y <= grid.h; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL);
      ctx.lineTo(grid.w * CELL, y * CELL);
      ctx.stroke();
    }

    for (const p of s.players) {
      const cx = p.x * CELL + CELL / 2;
      const cy = p.y * CELL + CELL / 2;

      ctx.beginPath();
      ctx.arc(cx, cy, CELL / 2 - 5, 0, Math.PI * 2);
      ctx.fillStyle = p.found ? '#4a4e5c' : p.color;
      ctx.fill();
      if (p.id === myId) {
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
      ctx.fillText(p.name.slice(0, 10), cx, cy - CELL / 2 - 3);
    }

    if (s.phase === 'lobby') {
      overlayText(s.players.length < 2 ? 'Waiting for another player…' : 'Ready! Press Start Game.');
    } else if (s.phase === 'hiding') {
      overlayText(me && me.role === 'seeker' ? 'Hiders are scattering…' : 'Find a hiding spot!');
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
    ctx.fillText(text, canvas.width / 2, canvas.height - 13);
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
})();
