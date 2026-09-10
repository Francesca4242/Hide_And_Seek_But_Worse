import type { Env } from './worker';

// --- Map layout -------------------------------------------------------
// 16x12 grid. A handful of rectangular obstacles form hiding spots while
// the outer ring is always kept open, so the map is never fully blocked.
export const GRID_W = 16;
export const GRID_H = 12;

const WALL_BLOCKS: [number, number, number, number][] = [
  [2, 2, 4, 3],
  [7, 2, 9, 4],
  [12, 2, 13, 5],
  [2, 6, 3, 9],
  [6, 7, 9, 8],
  [11, 7, 13, 9],
  [5, 4, 6, 5],
];

const WALLS = new Set<string>();
for (const [x0, y0, x1, y1] of WALL_BLOCKS) {
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) WALLS.add(`${x},${y}`);
  }
}

const HIDE_SECONDS = 10;
const SEEK_SECONDS = 60;
const VISION_RADIUS = 4; // chebyshev distance a seeker can spot hiders from

const COLORS = ['#e6533c', '#3ca7e6', '#3ce695', '#e6c93c', '#c33ce6', '#e68a3c', '#3ce6df', '#e63c8a'];

type Phase = 'lobby' | 'hiding' | 'seeking' | 'ended';

interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  role: 'seeker' | 'hider';
  found: boolean;
  ws: WebSocket;
}

interface RoundResult {
  reason: 'all_found' | 'time_up';
  found: number;
  total: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export class GameRoom {
  private players = new Map<string, Player>();
  private phase: Phase = 'lobby';
  private seekerId: string | null = null;
  private joinOrder: string[] = [];
  private hideDeadline = 0;
  private seekDeadline = 0;
  private lastResult: RoundResult | null = null;

  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/ws') {
      return new Response('Not found', { status: 404 });
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const name = (url.searchParams.get('name') || 'Player').slice(0, 16) || 'Player';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.addPlayer(server, name);

    return new Response(null, { status: 101, webSocket: client });
  }

  // --- Session management ----------------------------------------------

  private addPlayer(ws: WebSocket, name: string) {
    const id = crypto.randomUUID();
    const spawn = this.findSpawn();
    const role: Player['role'] = this.players.size === 0 ? 'seeker' : 'hider';
    const color = COLORS[this.players.size % COLORS.length];

    const player: Player = { id, name, x: spawn.x, y: spawn.y, color, role, found: false, ws };
    this.players.set(id, player);
    this.joinOrder.push(id);
    if (role === 'seeker') this.seekerId = id;

    ws.addEventListener('message', (evt) => this.onMessage(id, evt));
    ws.addEventListener('close', () => this.onLeave(id));
    ws.addEventListener('error', () => this.onLeave(id));

    this.send(ws, { type: 'init', id, grid: { w: GRID_W, h: GRID_H, walls: [...WALLS] } });
    this.broadcastState();
  }

  private onLeave(id: string) {
    const wasSeeker = this.seekerId === id;
    this.players.delete(id);
    this.joinOrder = this.joinOrder.filter((pid) => pid !== id);

    if (this.players.size === 0) {
      this.phase = 'lobby';
      this.seekerId = null;
      return;
    }

    if (wasSeeker) {
      // Seeker left mid-round: reset to the lobby and hand the role to
      // whoever has been waiting longest.
      this.phase = 'lobby';
      this.lastResult = null;
      this.seekerId = this.joinOrder[0];
      for (const p of this.players.values()) {
        p.found = false;
        p.role = p.id === this.seekerId ? 'seeker' : 'hider';
      }
    }
    this.broadcastState();
  }

  private onMessage(id: string, evt: MessageEvent) {
    const player = this.players.get(id);
    if (!player) return;

    let msg: any;
    try {
      msg = JSON.parse(evt.data as string);
    } catch {
      return;
    }

    switch (msg?.type) {
      case 'move':
        this.handleMove(player, msg.dx, msg.dy);
        break;
      case 'start':
        this.handleStart();
        break;
      case 'restart':
        this.handleRestart();
        break;
    }
  }

  // --- Game logic --------------------------------------------------------

  private findSpawn(): { x: number; y: number } {
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = Math.floor(Math.random() * GRID_W);
      const y = Math.floor(Math.random() * GRID_H);
      if (!WALLS.has(`${x},${y}`)) return { x, y };
    }
    return { x: 0, y: 0 };
  }

  private handleMove(player: Player, dx: number, dy: number) {
    if (this.phase === 'lobby' || this.phase === 'ended') return;
    if (player.found) return;
    if (player.role === 'seeker' && this.phase === 'hiding') return; // seeker is frozen while hiders scatter

    const nx = clamp(player.x + Math.sign(dx), 0, GRID_W - 1);
    const ny = clamp(player.y + Math.sign(dy), 0, GRID_H - 1);
    if (WALLS.has(`${nx},${ny}`)) return;

    player.x = nx;
    player.y = ny;

    if (this.phase === 'seeking' && player.role === 'seeker') this.checkCatches();
    this.broadcastState();
  }

  private checkCatches() {
    const seeker = this.seekerId ? this.players.get(this.seekerId) : undefined;
    if (!seeker) return;

    let foundCount = 0;
    let total = 0;
    for (const p of this.players.values()) {
      if (p.role !== 'hider') continue;
      total++;
      if (p.found) {
        foundCount++;
        continue;
      }
      if (p.x === seeker.x && p.y === seeker.y) {
        p.found = true;
        foundCount++;
      }
    }

    if (total > 0 && foundCount >= total) this.endRound('all_found', foundCount, total);
  }

  private handleStart() {
    if (this.phase !== 'lobby' && this.phase !== 'ended') return;
    if (this.players.size < 2) return;

    this.phase = 'hiding';
    this.lastResult = null;
    for (const p of this.players.values()) {
      p.found = false;
      const spawn = this.findSpawn();
      p.x = spawn.x;
      p.y = spawn.y;
    }

    this.hideDeadline = Date.now() + HIDE_SECONDS * 1000;
    void this.state.storage.setAlarm(this.hideDeadline);
    this.broadcastState();
  }

  private handleRestart() {
    if (this.phase !== 'ended') return;
    // Rotate the seeker role to the next player in join order.
    const order = this.joinOrder;
    const prevIdx = this.seekerId ? order.indexOf(this.seekerId) : -1;
    const nextIdx = order.length > 0 ? (prevIdx + 1) % order.length : -1;
    this.seekerId = nextIdx >= 0 ? order[nextIdx] : null;

    for (const p of this.players.values()) {
      p.role = p.id === this.seekerId ? 'seeker' : 'hider';
      p.found = false;
    }

    this.phase = 'lobby';
    this.lastResult = null;
    this.broadcastState();
  }

  async alarm() {
    if (this.phase === 'hiding') {
      this.phase = 'seeking';
      this.seekDeadline = Date.now() + SEEK_SECONDS * 1000;
      void this.state.storage.setAlarm(this.seekDeadline);
      this.broadcastState();
    } else if (this.phase === 'seeking') {
      const hiders = [...this.players.values()].filter((p) => p.role === 'hider');
      const found = hiders.filter((p) => p.found).length;
      this.endRound('time_up', found, hiders.length);
    }
  }

  private endRound(reason: RoundResult['reason'], found: number, total: number) {
    this.phase = 'ended';
    this.lastResult = { reason, found, total };
    this.broadcastState();
  }

  // --- Broadcasting with fog-of-war -------------------------------------

  private isVisibleTo(viewer: Player, target: Player): boolean {
    if (viewer.id === target.id) return true;
    if (this.phase === 'lobby' || this.phase === 'ended') return true;
    if (target.found) return true;

    if (this.phase === 'hiding') {
      // Seeker doesn't get to watch hiders scatter; hiders can see each other.
      return viewer.role === 'hider' && target.role === 'hider';
    }

    // Seeking phase: hiders always see each other, but only see the seeker
    // (and the seeker only sees hiders) within a limited radius.
    if (viewer.role === 'hider' && target.role === 'hider') return true;
    const dist = Math.max(Math.abs(viewer.x - target.x), Math.abs(viewer.y - target.y));
    return dist <= VISION_RADIUS;
  }

  private broadcastState() {
    for (const viewer of this.players.values()) {
      this.send(viewer.ws, this.buildStateFor(viewer));
    }
  }

  private buildStateFor(viewer: Player) {
    const hiders = [...this.players.values()].filter((p) => p.role === 'hider');
    const players = [...this.players.values()]
      .filter((p) => this.isVisibleTo(viewer, p))
      .map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, color: p.color, role: p.role, found: p.found }));

    return {
      type: 'state',
      you: viewer.id,
      phase: this.phase,
      seekerId: this.seekerId,
      hideDeadline: this.hideDeadline,
      seekDeadline: this.seekDeadline,
      players,
      foundCount: hiders.filter((p) => p.found).length,
      totalHiders: hiders.length,
      lastResult: this.lastResult,
    };
  }

  private send(ws: WebSocket, data: unknown) {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      // Socket already closed; onLeave will clean it up.
    }
  }
}
