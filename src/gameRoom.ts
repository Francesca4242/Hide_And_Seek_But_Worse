import type { Env } from './worker';

// --- Map layout (virtual mode only) ------------------------------------
// 24x18 grid, laid out like an office floor plan (cubicle rows and filing
// cabinet blocks). Blocks are kept within a 2-cell margin of every edge so
// a double-wide perimeter corridor always stays open.
export const GRID_W = 24;
export const GRID_H = 18;

const WALL_BLOCKS: [number, number, number, number][] = [
  [2, 2, 5, 3],
  [9, 2, 12, 3],
  [16, 2, 19, 3],
  [2, 5, 4, 6],
  [7, 5, 9, 6],
  [14, 5, 16, 6],
  [19, 5, 21, 6],
  [2, 8, 5, 11],
  [9, 8, 14, 9],
  [9, 11, 14, 12],
  [18, 8, 21, 11],
  [2, 13, 4, 15],
  [7, 13, 10, 15],
  [13, 13, 16, 15],
  [19, 13, 21, 15],
];

const WALLS = new Set<string>();
for (const [x0, y0, x1, y1] of WALL_BLOCKS) {
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) WALLS.add(`${x},${y}`);
  }
}

const COLORS = ['#e6533c', '#3ca7e6', '#3ce695', '#e6c93c', '#c33ce6', '#e68a3c', '#3ce6df', '#e63c8a'];

// Must match the ICONS list in public/game.js — kept in sync by hand since
// this is the server-side whitelist (anything else falls back to DEFAULT_ICON).
const ICONS = [
  '🕵️', '🧥', '🗄️', '📎', '🪴', '📦', '🧦', '🎩',
  '🦊', '🐱', '🐭', '🐢', '🦉', '🐧', '🦝', '🐇', '👻', '🐸',
];
const DEFAULT_ICON = ICONS[0];

// --- Timing --------------------------------------------------------------
const BRIEFING_SECONDS = 25;
const HIDING_SECONDS: Record<Mode, number> = { virtual: 18, physical: 45 };
const SEEK_SECONDS: Record<Mode, number> = { virtual: 120, physical: 180 };
const DISPUTE_RESPONSE_SECONDS = 15;
const TRIBUNAL_VOTE_SECONDS = 12;
const SEEKER_ELECTION_SECONDS = 15;
const CHAOS_MIN_FRACTION = 0.25;
const CHAOS_MAX_FRACTION = 0.65;
const PING_INTERVAL_MS = 30_000;
const PING_VISIBLE_MS = 3_000;
const IMMUNITY_MS = 6_000;
const NEAR_SEEKER_RADIUS = 2;
const VISION_RADIUS = 4; // chebyshev distance a seeker can spot hiders from, virtual mode
const BLACKOUT_MS = 10_000;
const BLACKOUT_RADIUS = 1;
const FLOODLIGHT_MS = 4_000;
const FREEZE_MS = 4_000;
const FORM_SUBMIT_POINTS = 10;
const AUDIT_PASS_POINTS = 15;
const AUDIT_INTERVAL_MS = 25_000;
const AUDIT_CHANCE = 0.5;
const AUDIT_RESPONSE_MS = 10_000;
const AUDIT_REVEAL_MS = 4_000;

// --- Card decks ------------------------------------------------------------
// "effect" is a machine-checked tag; null means the card is honour-system
// flavour. Virtual mode only deals cards with a real effect (nobody's
// there to notice if you ignore "pretend to be furniture" on a screen);
// physical mode deals from the full deck since real people enforce it.
interface Card {
  id: string;
  text: string;
  effect: string | null;
}

const HIDING_CARDS: Card[] = [
  { id: 'yellow', text: "You must hide somewhere yellow. No, we don't know why either — it's in the bylaws.", effect: null },
  { id: 'visible', text: 'You must remain visible at all times. Transparency is this Department’s middle name.', effect: 'always_visible' },
  { id: 'noise', text: 'You must make a noise every 30 seconds. Silence may be construed as contempt.', effect: 'ping_30s' },
  { id: 'plain_sight', text: "You must hide in plain sight. We call this 'strategic non-concealment.'", effect: null },
  { id: 'stay_close', text: 'You must hide within 2 metres of the seeker. Proximity is not the same as cooperation.', effect: 'stay_near_seeker' },
  { id: 'furniture', text: 'You must pretend to be furniture: hold perfectly still from the moment seeking begins, and you cannot be spotted from a distance — only found by touch.', effect: 'camouflage' },
];

const SEEKING_CARDS: Card[] = [
  { id: 'backwards', text: 'You may only walk backwards. Progress, like this Department, moves in reverse.', effect: 'invert_controls' },
  { id: 'documentary', text: 'You must narrate your search like a wildlife documentary. David Attenborough was unavailable for comment.', effect: null },
  { id: 'permission', text: 'You must ask permission before looking somewhere. Applications may take 6-8 weeks.', effect: null },
  { id: 'no_under', text: 'You cannot look under anything. Under-the-table dealings are strictly for management.', effect: null },
  { id: 'accuse_first', text: 'You must formally accuse an innocent object before your first arrest. Due process applies to lamps too.', effect: 'accuse_first' },
  { id: 'tunnel_vision', text: 'Department-issued blinders are now mandatory. Your search radius is significantly reduced.', effect: 'reduced_vision' },
  { id: 'sluggish', text: 'Budget cuts have halved your patrol speed. Every other step now goes unregistered.', effect: 'half_speed' },
];

const CHAOS_CARDS: Card[] = [
  { id: 'swap', text: 'Everyone must swap hiding places, immediately. Call it a reorganisation.', effect: 'swap' },
  { id: 'seeker_hider', text: 'The seeker is reassigned to hiding duties, effective immediately. A lateral move, not a demotion.', effect: 'seeker_becomes_hider' },
  { id: 'elect', text: "The hiders must elect a new seeker. Democracy — it's in the manual somewhere.", effect: 'hiders_elect_seeker' },
  { id: 'together', text: 'All hiders must now cluster together, in the same general vicinity. Efficiency drive. Do not ask questions.', effect: 'together' },
  { id: 'blackout', text: `BLACKOUT: a Department power-saving measure has reduced the seeker's visibility to almost nothing for ${BLACKOUT_MS / 1000} seconds.`, effect: 'blackout' },
  { id: 'floodlight', text: `FLOODLIGHT: emergency lighting has been triggered. All hiders are illuminated to the seeker for ${FLOODLIGHT_MS / 1000} seconds.`, effect: 'floodlight' },
  { id: 'freeze', text: `FREEZE! By order of the Department, nobody may move a muscle for ${FREEZE_MS / 1000} seconds. This is not a drill. Actually, it might be.`, effect: 'freeze' },
  { id: 'third_person', text: 'By order of the Department, all players must now refer to themselves in the third person for the remainder of the round.', effect: null },
];

const APPEAL_REASONS = [
  "That's not a finding, that's an identification.",
  "You said my name but you didn't physically touch me.",
  'I was partially behind the plant.',
  'The lighting in here was misleading.',
  'I was technically still hiding, just badly.',
  'This finding has not been through the correct channels.',
  'You were clearly guessing.',
  "I have a doctor's note excusing me from being found today.",
  'The seeker exceeded their jurisdiction by looking there.',
  'This is a case of mistaken identity.',
  'I move to have this finding stricken from the record.',
  'The rules were never read aloud at the start of the round, as required.',
];

const APPEAL_UPHELD_LINES = [
  'case dismissed.',
  'the objection stands.',
  'the Department regrets the inconvenience.',
  'a partial victory for common sense.',
];

const APPEAL_REJECTED_LINES = [
  'the finding stands.',
  'the appeal is noted and ignored.',
  'the paperwork was in order after all.',
  'due process has been observed and is now concluded.',
];

function dealCard(deck: Card[], mechanicalOnly: boolean): Card {
  const pool = mechanicalOnly ? deck.filter((c) => c.effect !== null) : deck;
  const finalPool = pool.length > 0 ? pool : deck;
  return finalPool[Math.floor(Math.random() * finalPool.length)];
}

function pickOne<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickRandomSubset<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

type Mode = 'virtual' | 'physical';
type Phase = 'lobby' | 'briefing' | 'hiding' | 'seeking' | 'ended';

interface PendingAudit {
  field: 'location' | 'eta';
  correct: string;
  options: string[];
  expiresAt: number;
}

interface Player {
  id: string;
  name: string;
  icon: string;
  x: number;
  y: number;
  color: string;
  role: 'seeker' | 'hider';
  found: boolean;
  foundAt: number | null;
  ready: boolean;
  ws: WebSocket;
  hidingCard: Card | null;
  hasAccused: boolean;
  immuneUntil: number;
  pingedUntil: number;
  moveSkip: boolean;
  score: number;
  alibiChits: number;
  pendingAudit: PendingAudit | null;
}

interface HidingForm {
  location: string;
  eta: number;
  risk: boolean;
  ventilation: boolean;
}

interface Dispute {
  accusedId: string;
  seekerId: string;
  stage: 'awaiting_response' | 'tribunal';
  reason: string | null;
  votes: Map<string, 'uphold' | 'reject'>;
  availableReasons: string[];
}

interface PendingVote {
  votes: Map<string, string>; // voterId -> candidateId
}

interface RoundResult {
  reason: 'all_found' | 'time_up';
  found: number;
  total: number;
}

type TimerKind =
  | 'briefing_end'
  | 'hiding_end'
  | 'seek_end'
  | 'chaos_draw'
  | 'ping'
  | 'dispute_timeout'
  | 'tribunal_timeout'
  | 'vote_timeout'
  | 'audit_check'
  | 'audit_timeout';

interface TimerEntry {
  at: number;
  kind: TimerKind;
  payload?: any;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export class GameRoom {
  private players = new Map<string, Player>();
  private mode: Mode = 'virtual';
  private phase: Phase = 'lobby';
  private seekerId: string | null = null;
  private joinOrder: string[] = [];

  private briefingDeadline = 0;
  private hideDeadline = 0;
  private seekDeadline = 0;
  private seekStartedAt = 0;
  private seekPausedAt: number | null = null;
  private lastResult: RoundResult | null = null;

  private forms = new Map<string, HidingForm>();
  private seekingCard: Card | null = null;
  private dispute: Dispute | null = null;
  private pendingVote: PendingVote | null = null;
  private chaosEvent: { id: string; text: string; at: number; expiresAt: number } | null = null;
  private chaosVisionUntil = 0;
  private moveFreezeUntil = 0;

  private timers: TimerEntry[] = [];

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
    const rawIcon = url.searchParams.get('icon') || '';
    const icon = ICONS.includes(rawIcon) ? rawIcon : DEFAULT_ICON;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.addPlayer(server, name, icon);

    return new Response(null, { status: 101, webSocket: client });
  }

  // --- Session management ----------------------------------------------

  private addPlayer(ws: WebSocket, name: string, icon: string) {
    const id = crypto.randomUUID();
    const spawn = this.findSpawn();
    const role: Player['role'] = this.players.size === 0 ? 'seeker' : 'hider';
    const color = COLORS[this.players.size % COLORS.length];

    const player: Player = {
      id, name, icon, x: spawn.x, y: spawn.y, color, role, found: false, foundAt: null, ready: false, ws,
      hidingCard: null, hasAccused: false, immuneUntil: 0, pingedUntil: 0,
      moveSkip: false, score: 0, alibiChits: 0, pendingAudit: null,
    };
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
    this.forms.delete(id);
    if (this.pendingVote) this.pendingVote.votes.delete(id);
    if (this.dispute && (this.dispute.accusedId === id || this.dispute.seekerId === id)) {
      this.clearTimers('dispute_timeout');
      this.clearTimers('tribunal_timeout');
      this.dispute = null;
      this.resumeClockIfPaused();
    }

    if (this.players.size === 0) {
      this.phase = 'lobby';
      this.seekerId = null;
      this.timers = [];
      void this.resyncAlarm();
      return;
    }

    if (wasSeeker) {
      // Seeker left mid-round: reset to the lobby and hand the role to
      // whoever has been waiting longest.
      this.phase = 'lobby';
      this.lastResult = null;
      this.dispute = null;
      this.pendingVote = null;
      this.chaosEvent = null;
      this.timers = [];
      void this.resyncAlarm();
      this.seekerId = this.joinOrder[0];
      for (const p of this.players.values()) {
        p.found = false;
        p.ready = false;
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
      case 'setMode': this.handleSetMode(msg.mode); break;
      case 'toggleReady': this.handleToggleReady(player); break;
      case 'start': this.handleStart(msg.mode); break;
      case 'restart': this.handleRestart(); break;
      case 'submitForm': this.handleSubmitForm(player, msg); break;
      case 'move': this.handleMove(player, msg.dx, msg.dy); break;
      case 'accuse': this.handleAccuse(player, msg.text); break;
      case 'declareFound': this.handleDeclareFound(player, msg.targetId); break;
      case 'disputeResponse': this.handleDisputeResponse(player, msg.action, msg.reason); break;
      case 'tribunalVote': this.handleTribunalVote(player, msg.vote); break;
      case 'vote': this.handleVote(player, msg.candidateId); break;
      case 'auditAnswer': this.handleAuditAnswer(player, msg.choice); break;
    }
  }

  // --- Lobby / round lifecycle ------------------------------------------

  private handleSetMode(mode: string) {
    if (this.phase !== 'lobby') return;
    if (mode !== 'virtual' && mode !== 'physical') return;
    this.mode = mode;
    this.broadcastState();
  }

  private handleToggleReady(player: Player) {
    if (this.phase !== 'lobby') return;
    player.ready = !player.ready;
    this.broadcastState();
  }

  private allPlayersReady(): boolean {
    return this.players.size >= 2 && [...this.players.values()].every((p) => p.ready);
  }

  private resetRoundState() {
    this.forms.clear();
    this.dispute = null;
    this.pendingVote = null;
    this.chaosEvent = null;
    this.seekingCard = null;
    this.seekStartedAt = 0;
    this.seekPausedAt = null;
    this.chaosVisionUntil = 0;
    this.moveFreezeUntil = 0;
    this.timers = [];
    for (const p of this.players.values()) {
      p.found = false;
      p.foundAt = null;
      p.hidingCard = null;
      p.hasAccused = false;
      p.immuneUntil = 0;
      p.pingedUntil = 0;
      p.moveSkip = false;
      p.alibiChits = 0;
      p.pendingAudit = null;
      // p.score intentionally NOT reset — it's a running total for the session.
    }
  }

  private handleStart(mode?: string) {
    if (this.phase !== 'lobby' && this.phase !== 'ended') return;
    if (!this.allPlayersReady()) return;
    if (mode === 'virtual' || mode === 'physical') this.mode = mode;

    this.resetRoundState();
    this.phase = 'briefing';
    this.briefingDeadline = Date.now() + BRIEFING_SECONDS * 1000;
    this.scheduleTimer(BRIEFING_SECONDS * 1000, 'briefing_end');
    this.broadcastNotice(
      'The Department has scheduled a new round. Hiders, please complete Form 27B (Hiding Declaration) within the allotted time. Late filings will be logged under Wishful Thinking.'
    );
    this.broadcastState();
  }

  private handleRestart() {
    if (this.phase !== 'ended') return;
    const order = this.joinOrder;
    const prevIdx = this.seekerId ? order.indexOf(this.seekerId) : -1;
    const nextIdx = order.length > 0 ? (prevIdx + 1) % order.length : -1;
    this.seekerId = nextIdx >= 0 ? order[nextIdx] : null;

    for (const p of this.players.values()) {
      p.role = p.id === this.seekerId ? 'seeker' : 'hider';
      p.found = false;
      p.ready = false;
    }

    this.phase = 'lobby';
    this.lastResult = null;
    this.dispute = null;
    this.pendingVote = null;
    this.broadcastState();
  }

  private handleSubmitForm(player: Player, data: any) {
    if (this.phase !== 'briefing') return;
    if (player.role !== 'hider') return;
    const firstSubmission = !this.forms.has(player.id);
    this.forms.set(player.id, {
      location: String(data.location ?? '').slice(0, 80).trim() || 'Unspecified',
      eta: Number.isFinite(data.eta) ? clamp(Math.round(data.eta), 0, 999) : 0,
      risk: !!data.risk,
      ventilation: !!data.ventilation,
    });
    if (firstSubmission) {
      player.score += FORM_SUBMIT_POINTS;
      player.alibiChits += 1;
      this.notice(player, `Form 27B received. +${FORM_SUBMIT_POINTS} Compliance Points, +1 Alibi Chit for your trouble.`);
    }
    this.broadcastState();
  }

  private endBriefing() {
    if (this.phase !== 'briefing') return;
    for (const p of this.players.values()) {
      if (p.role === 'hider' && !this.forms.has(p.id)) {
        this.forms.set(p.id, { location: 'Unspecified (form not received)', eta: 0, risk: false, ventilation: false });
      }
    }

    this.phase = 'hiding';
    const secs = HIDING_SECONDS[this.mode];
    this.hideDeadline = Date.now() + secs * 1000;

    if (this.mode === 'virtual') {
      const seeker = this.seekerId ? this.players.get(this.seekerId) : null;
      if (seeker) {
        const spawn = this.findSpawn();
        seeker.x = spawn.x;
        seeker.y = spawn.y;
      }
      for (const p of this.players.values()) {
        if (p.role !== 'hider') continue;
        p.hidingCard = dealCard(HIDING_CARDS, this.mode === 'virtual');
        const spawn = p.hidingCard.effect === 'stay_near_seeker' && seeker
          ? this.findSpawnNear(seeker.x, seeker.y, NEAR_SEEKER_RADIUS)
          : this.findSpawn();
        p.x = spawn.x;
        p.y = spawn.y;
      }
    } else {
      for (const p of this.players.values()) {
        if (p.role === 'hider') p.hidingCard = dealCard(HIDING_CARDS, false);
      }
    }

    this.scheduleTimer(secs * 1000, 'hiding_end');
    this.broadcastNotice('Hiding phase has begun. Hiders, assume your positions. The Department wishes you a productive disappearance.');
    this.broadcastGo();
    this.broadcastState();
  }

  private endHiding() {
    if (this.phase !== 'hiding') return;
    this.phase = 'seeking';
    const secs = SEEK_SECONDS[this.mode];
    this.seekDeadline = Date.now() + secs * 1000;
    this.seekStartedAt = Date.now();
    this.scheduleTimer(secs * 1000, 'seek_end');

    const seeker = this.seekerId ? this.players.get(this.seekerId) : null;
    if (seeker) seeker.hasAccused = false;
    this.seekingCard = dealCard(SEEKING_CARDS, this.mode === 'virtual');

    for (const p of this.players.values()) {
      if (p.role !== 'hider') continue;
      if (p.hidingCard?.effect === 'ping_30s') {
        this.scheduleTimer(PING_INTERVAL_MS, 'ping', { playerId: p.id });
      }
      if (this.forms.has(p.id)) {
        this.scheduleTimer(AUDIT_INTERVAL_MS, 'audit_check', { playerId: p.id });
      }
    }

    const delayMs = secs * 1000 * (CHAOS_MIN_FRACTION + Math.random() * (CHAOS_MAX_FRACTION - CHAOS_MIN_FRACTION));
    this.scheduleTimer(delayMs, 'chaos_draw');

    this.broadcastNotice('Seeking phase has begun. The seeker has received an FOI response regarding hider whereabouts, redacted as per policy.');
    this.broadcastState();
  }

  private endRound(reason: RoundResult['reason'], found: number, total: number) {
    this.phase = 'ended';
    this.lastResult = { reason, found, total };
    this.dispute = null;
    this.pendingVote = null;
    this.timers = [];
    void this.resyncAlarm();
    this.broadcastNotice(
      reason === 'all_found'
        ? `Round concluded: all hiders located (${found}/${total}). Case closed, file archived.`
        : `Round concluded: time expired (${found}/${total} located). The remainder are hereby classified At Large.`
    );
    this.broadcastState();
  }

  // --- Movement (virtual mode) --------------------------------------------

  private findSpawn(): { x: number; y: number } {
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = Math.floor(Math.random() * GRID_W);
      const y = Math.floor(Math.random() * GRID_H);
      if (!WALLS.has(`${x},${y}`)) return { x, y };
    }
    return { x: 0, y: 0 };
  }

  private findSpawnNear(cx: number, cy: number, radius: number): { x: number; y: number } {
    for (let attempt = 0; attempt < 100; attempt++) {
      const x = clamp(cx + Math.floor(Math.random() * (radius * 2 + 1)) - radius, 0, GRID_W - 1);
      const y = clamp(cy + Math.floor(Math.random() * (radius * 2 + 1)) - radius, 0, GRID_H - 1);
      if (!WALLS.has(`${x},${y}`) && Math.max(Math.abs(x - cx), Math.abs(y - cy)) <= radius) return { x, y };
    }
    return this.findSpawn();
  }

  private handleMove(player: Player, rawDx: number, rawDy: number) {
    if (this.mode !== 'virtual') return;
    if (this.phase !== 'hiding' && this.phase !== 'seeking') return;
    if (player.found) return;
    if (this.dispute && (this.dispute.accusedId === player.id || this.dispute.seekerId === player.id)) return;
    if (player.role === 'seeker' && this.phase === 'hiding') return; // frozen while hiders scatter
    if (Date.now() < this.moveFreezeUntil) return; // CHAOS CARD: freeze
    if (this.phase === 'seeking' && player.role === 'hider' && player.hidingCard?.effect === 'camouflage') return;

    if (player.role === 'seeker' && this.seekingCard?.effect === 'half_speed') {
      player.moveSkip = !player.moveSkip;
      if (player.moveSkip) return; // every other attempt is dropped
    }

    let dx = Math.sign(rawDx);
    let dy = Math.sign(rawDy);
    if (player.role === 'seeker' && this.seekingCard?.effect === 'invert_controls') {
      dx = -dx;
      dy = -dy;
    }

    const nx = clamp(player.x + dx, 0, GRID_W - 1);
    const ny = clamp(player.y + dy, 0, GRID_H - 1);
    if (WALLS.has(`${nx},${ny}`)) return;

    if (player.role === 'hider' && player.hidingCard?.effect === 'stay_near_seeker') {
      const seeker = this.seekerId ? this.players.get(this.seekerId) : null;
      if (seeker && Math.max(Math.abs(nx - seeker.x), Math.abs(ny - seeker.y)) > NEAR_SEEKER_RADIUS) return;
    }

    player.x = nx;
    player.y = ny;

    if (this.phase === 'seeking' && player.role === 'seeker') this.tryCatch(player);
    this.broadcastState();
  }

  private tryCatch(seeker: Player) {
    if (this.dispute) return;
    for (const p of this.players.values()) {
      if (p.role === 'hider' && !p.found && p.x === seeker.x && p.y === seeker.y) {
        this.tryOpenDisputeAgainst(seeker.id, p.id);
        return;
      }
    }
  }

  // --- Physical mode: manual "found" declaration --------------------------

  private handleDeclareFound(seeker: Player, targetId: string) {
    if (this.mode !== 'physical') return;
    if (seeker.id !== this.seekerId) return;
    if (this.phase !== 'seeking') return;
    if (Date.now() < this.moveFreezeUntil) {
      this.notice(seeker, 'Everyone must freeze. No arrests until it lifts.');
      return;
    }
    this.tryOpenDisputeAgainst(seeker.id, targetId);
  }

  private handleAccuse(player: Player, text: string) {
    if (player.id !== this.seekerId) return;
    if (this.phase !== 'seeking') return;
    if (player.hasAccused) return;
    player.hasAccused = true;
    const clean = String(text ?? '').slice(0, 60).trim() || 'the nearest houseplant';
    this.broadcastNotice(`${player.name} formally accuses ${clean} of harbouring a fugitive.`);
    this.broadcastState();
  }

  // --- Formal discovery / appeals / tribunal ------------------------------

  private tryOpenDisputeAgainst(seekerId: string, targetId: string): boolean {
    if (this.dispute) return false;
    const seeker = this.players.get(seekerId);
    const target = this.players.get(targetId);
    if (!seeker || !target || target.role !== 'hider' || target.found) return false;
    if (Date.now() < target.immuneUntil) {
      this.notice(seeker, `${target.name} currently holds statutory immunity from a recent dismissal. Try again once it lapses.`);
      return false;
    }
    if (this.seekingCard?.effect === 'accuse_first' && !seeker.hasAccused) {
      this.notice(seeker, 'You must formally accuse an innocent object before making an arrest.');
      return false;
    }
    this.openDispute(targetId);
    return true;
  }

  private openDispute(accusedId: string) {
    if (this.dispute || !this.seekerId) return;
    this.dispute = {
      accusedId, seekerId: this.seekerId, stage: 'awaiting_response', reason: null,
      votes: new Map(), availableReasons: pickRandomSubset(APPEAL_REASONS, 4),
    };
    this.seekPausedAt = Date.now();
    this.scheduleTimer(DISPUTE_RESPONSE_SECONDS * 1000, 'dispute_timeout');

    const accused = this.players.get(accusedId);
    const seeker = this.players.get(this.seekerId);
    if (accused) this.notice(accused, 'You have been formally discovered. Respond within the statutory period, or forever hold your peace.');
    if (seeker && accused) this.notice(seeker, `Your finding of ${accused.name} is now on file, pending response.`);
    this.broadcastState();
  }

  private handleDisputeResponse(player: Player, action: 'accept' | 'appeal' | 'alibi', reason?: string) {
    if (!this.dispute || this.dispute.accusedId !== player.id) return;
    if (this.dispute.stage !== 'awaiting_response') return;

    if (action === 'alibi') {
      if (player.alibiChits < 1) {
        this.notice(player, 'You have no Alibi Chits on file.');
        return;
      }
      this.clearTimers('dispute_timeout');
      player.alibiChits -= 1;
      player.immuneUntil = Date.now() + IMMUNITY_MS;
      this.broadcastNotice(`${player.name} presents a Pre-Approved Alibi Chit. The finding is withdrawn, no questions asked.`);
      this.dispute = null;
      this.resumeClockIfPaused();
      this.broadcastState();
      return;
    }

    this.clearTimers('dispute_timeout');

    if (action === 'accept') {
      this.broadcastNotice(`${player.name} accepts the finding. Case closed.`);
      this.finalizeDispute(true);
      return;
    }

    const clean = (reason ?? '').slice(0, 120).trim() || 'No comment.';
    this.dispute.stage = 'tribunal';
    this.dispute.reason = clean;

    const eligible = [...this.players.values()].filter(
      (p) => p.id !== this.dispute!.accusedId && p.id !== this.dispute!.seekerId
    ).length;

    if (eligible === 0) {
      this.broadcastNotice('No quorum available for tribunal. The objection is dismissed on a technicality — the best kind of dismissal.');
      this.finalizeDispute(true);
      return;
    }

    this.scheduleTimer(TRIBUNAL_VOTE_SECONDS * 1000, 'tribunal_timeout');
    this.broadcastNotice(`${player.name} has filed an appeal: "${clean}" — cast your vote!`);
    // Appeals are dramatic occasions: a chaos card is drawn on the spot.
    this.drawChaosCard();
    this.broadcastState();
  }

  private handleTribunalVote(player: Player, vote: 'uphold' | 'reject') {
    if (!this.dispute || this.dispute.stage !== 'tribunal') return;
    if (player.id === this.dispute.accusedId || player.id === this.dispute.seekerId) return;
    if (vote !== 'uphold' && vote !== 'reject') return;
    this.dispute.votes.set(player.id, vote);

    const eligible = [...this.players.values()].filter(
      (p) => p.id !== this.dispute!.accusedId && p.id !== this.dispute!.seekerId
    ).length;

    if (this.dispute.votes.size >= eligible) {
      this.clearTimers('tribunal_timeout');
      this.resolveTribunal();
    } else {
      this.broadcastState();
    }
  }

  private resolveDisputeTimeout() {
    if (!this.dispute || this.dispute.stage !== 'awaiting_response') return;
    this.broadcastNotice('No response filed within the statutory period. Silence is deemed consent, per Form 27B, footnote 9.');
    this.finalizeDispute(true);
  }

  private resolveTribunal() {
    if (!this.dispute || this.dispute.stage !== 'tribunal') return;
    let uphold = 0;
    let reject = 0;
    for (const v of this.dispute.votes.values()) {
      if (v === 'uphold') uphold++;
      else reject++;
    }
    const upheld = uphold > reject; // ties side with the finding

    if (upheld) {
      const accused = this.players.get(this.dispute.accusedId);
      if (accused) accused.immuneUntil = Date.now() + IMMUNITY_MS;
      this.broadcastNotice(`Appeal upheld (${uphold}-${reject}): "${this.dispute.reason}" — ${pickOne(APPEAL_UPHELD_LINES)}`);
      this.dispute = null;
      this.resumeClockIfPaused();
      this.broadcastState();
    } else {
      this.broadcastNotice(`Appeal rejected (${reject}-${uphold}): ${pickOne(APPEAL_REJECTED_LINES)}`);
      this.finalizeDispute(true);
    }
  }

  private finalizeDispute(markFound: boolean) {
    if (!this.dispute) return;
    const accused = this.players.get(this.dispute.accusedId);
    this.dispute = null;
    this.resumeClockIfPaused();

    if (accused && markFound) {
      accused.found = true;
      accused.foundAt = Date.now();
      const hiders = [...this.players.values()].filter((p) => p.role === 'hider');
      const found = hiders.filter((p) => p.found).length;
      if (hiders.length > 0 && found >= hiders.length) {
        this.endRound('all_found', found, hiders.length);
        return;
      }
    }
    this.broadcastState();
  }

  // --- Chaos cards ---------------------------------------------------------

  private drawChaosCard() {
    if (this.phase !== 'seeking') return;
    const card = dealCard(CHAOS_CARDS, false);
    this.chaosEvent = { id: `${card.id}:${Date.now()}`, text: card.text, at: Date.now(), expiresAt: Date.now() + 8000 };
    this.applyChaosEffect(card);
    this.broadcastNotice(`CHAOS CARD: ${card.text}`);
    this.broadcastState();
  }

  private applyChaosEffect(card: Card) {
    switch (card.effect) {
      case 'swap':
        if (this.mode === 'virtual') {
          const seeker = this.seekerId ? this.players.get(this.seekerId) : null;
          for (const p of this.players.values()) {
            if (p.role !== 'hider' || p.found) continue;
            const spawn = p.hidingCard?.effect === 'stay_near_seeker' && seeker
              ? this.findSpawnNear(seeker.x, seeker.y, NEAR_SEEKER_RADIUS)
              : this.findSpawn();
            p.x = spawn.x;
            p.y = spawn.y;
          }
        }
        break;
      case 'together':
        if (this.mode === 'virtual') {
          const unfound = [...this.players.values()].filter((p) => p.role === 'hider' && !p.found);
          if (unfound.length > 1) {
            const anchor = unfound[Math.floor(Math.random() * unfound.length)];
            for (const p of unfound) {
              if (p.id === anchor.id) continue;
              const spot = this.findSpawnNear(anchor.x, anchor.y, NEAR_SEEKER_RADIUS);
              p.x = spot.x;
              p.y = spot.y;
            }
          }
        }
        break;
      case 'blackout':
        this.chaosVisionUntil = Date.now() + BLACKOUT_MS;
        break;
      case 'floodlight':
        for (const p of this.players.values()) {
          if (p.role === 'hider' && !p.found) p.pingedUntil = Date.now() + FLOODLIGHT_MS;
        }
        break;
      case 'freeze':
        this.moveFreezeUntil = Date.now() + FREEZE_MS;
        break;
      case 'seeker_becomes_hider':
        this.reassignSeekerRandomly();
        break;
      case 'hiders_elect_seeker':
        this.startSeekerElection();
        break;
      default:
        break; // flavour-only card, self-enforced
    }
  }

  private reassignSeekerRandomly() {
    const candidates = [...this.players.values()].filter((p) => p.role === 'hider' && !p.found);
    if (candidates.length === 0) return;
    const newSeeker = candidates[Math.floor(Math.random() * candidates.length)];

    const oldSeeker = this.seekerId ? this.players.get(this.seekerId) : null;
    if (oldSeeker) {
      oldSeeker.role = 'hider';
      oldSeeker.found = false;
      oldSeeker.immuneUntil = Date.now() + IMMUNITY_MS;
      if (this.mode === 'virtual') {
        const spawn = this.findSpawn();
        oldSeeker.x = spawn.x;
        oldSeeker.y = spawn.y;
      }
    }

    newSeeker.role = 'seeker';
    newSeeker.hasAccused = false;
    this.seekerId = newSeeker.id;
    this.dispute = null;
    this.resumeClockIfPaused();
    this.broadcastNotice(`${newSeeker.name} has been reassigned to Seeking duties by order of the Department. Congratulations, or condolences.`);
  }

  private startSeekerElection() {
    const hiders = [...this.players.values()].filter((p) => p.role === 'hider' && !p.found);
    if (hiders.length < 2) return;
    this.pendingVote = { votes: new Map() };
    this.scheduleTimer(SEEKER_ELECTION_SECONDS * 1000, 'vote_timeout');
    this.broadcastNotice('Hiders must now elect a new Seeker by majority vote. Campaigning is discouraged but not, strictly speaking, banned.');
  }

  private handleVote(player: Player, candidateId: string) {
    if (!this.pendingVote) return;
    if (player.role !== 'hider' || player.found) return;
    if (!this.players.has(candidateId)) return;
    this.pendingVote.votes.set(player.id, candidateId);

    const eligible = [...this.players.values()].filter((p) => p.role === 'hider' && !p.found).length;
    if (this.pendingVote.votes.size >= eligible) {
      this.clearTimers('vote_timeout');
      this.tallySeekerVote();
    } else {
      this.broadcastState();
    }
  }

  private tallySeekerVote() {
    if (!this.pendingVote) return;
    const tally = new Map<string, number>();
    for (const c of this.pendingVote.votes.values()) tally.set(c, (tally.get(c) ?? 0) + 1);
    this.pendingVote = null;

    if (tally.size === 0) {
      this.broadcastNotice('No votes were cast. The current Seeker remains in post, by voter apathy rather than merit.');
      this.broadcastState();
      return;
    }

    let winnerId: string | null = null;
    let max = -1;
    for (const [candidateId, count] of tally) {
      if (count > max) {
        max = count;
        winnerId = candidateId;
      }
    }
    const newSeeker = winnerId ? this.players.get(winnerId) : null;
    if (!newSeeker) return;

    const oldSeeker = this.seekerId ? this.players.get(this.seekerId) : null;
    if (oldSeeker && oldSeeker.id !== newSeeker.id) {
      oldSeeker.role = 'hider';
      oldSeeker.found = false;
      oldSeeker.immuneUntil = Date.now() + IMMUNITY_MS;
      if (this.mode === 'virtual') {
        const spawn = this.findSpawn();
        oldSeeker.x = spawn.x;
        oldSeeker.y = spawn.y;
      }
    }
    newSeeker.role = 'seeker';
    newSeeker.hasAccused = false;
    this.seekerId = newSeeker.id;
    this.dispute = null;
    this.resumeClockIfPaused();
    this.broadcastNotice(`${newSeeker.name} has been elected the new Seeker. A landslide, a mandate, a formality — take your pick.`);
    this.broadcastState();
  }

  // --- Unified timer queue (Durable Objects allow only one active alarm) --

  private scheduleTimer(delayMs: number, kind: TimerKind, payload?: any) {
    this.timers.push({ at: Date.now() + delayMs, kind, payload });
    void this.resyncAlarm();
  }

  private clearTimers(kind: TimerKind) {
    this.timers = this.timers.filter((t) => t.kind !== kind);
    void this.resyncAlarm();
  }

  private clearTimerForPlayer(kind: TimerKind, playerId: string) {
    this.timers = this.timers.filter((t) => !(t.kind === kind && t.payload?.playerId === playerId));
    void this.resyncAlarm();
  }

  private adjustTimerAt(kind: TimerKind, deltaMs: number) {
    const entry = this.timers.find((t) => t.kind === kind);
    if (entry) entry.at += deltaMs;
    void this.resyncAlarm();
  }

  // Formal discovery / tribunal proceedings pause the round clock: the seek
  // timer is extended by however long the case took to resolve, so disputes
  // never eat into a hider's actual hiding time.
  private resumeClockIfPaused() {
    if (this.seekPausedAt === null) return;
    const elapsed = Date.now() - this.seekPausedAt;
    this.seekPausedAt = null;
    if (elapsed <= 0) return;
    this.seekDeadline += elapsed;
    this.adjustTimerAt('seek_end', elapsed);
  }

  private async resyncAlarm() {
    if (this.timers.length === 0) {
      await this.state.storage.deleteAlarm();
      return;
    }
    const next = Math.min(...this.timers.map((t) => t.at));
    await this.state.storage.setAlarm(next);
  }

  async alarm() {
    const now = Date.now();
    const due = this.timers.filter((t) => t.at <= now);
    this.timers = this.timers.filter((t) => t.at > now);
    for (const t of due) this.handleTimer(t);
    await this.resyncAlarm();
  }

  private handleTimer(t: TimerEntry) {
    switch (t.kind) {
      case 'briefing_end': this.endBriefing(); break;
      case 'hiding_end': this.endHiding(); break;
      case 'seek_end': {
        const hiders = [...this.players.values()].filter((p) => p.role === 'hider');
        const found = hiders.filter((p) => p.found).length;
        this.endRound('time_up', found, hiders.length);
        break;
      }
      case 'chaos_draw': this.drawChaosCard(); break;
      case 'ping': this.handlePing(t.payload.playerId); break;
      case 'dispute_timeout': this.resolveDisputeTimeout(); break;
      case 'tribunal_timeout': this.resolveTribunal(); break;
      case 'vote_timeout': this.tallySeekerVote(); break;
      case 'audit_check': this.auditCheck(t.payload.playerId); break;
      case 'audit_timeout': this.auditTimeoutFor(t.payload.playerId); break;
    }
  }

  private handlePing(playerId: string) {
    if (this.phase !== 'seeking') return;
    const p = this.players.get(playerId);
    if (!p || p.found) return;
    p.pingedUntil = Date.now() + PING_VISIBLE_MS;
    this.broadcastState();
    this.scheduleTimer(PING_INTERVAL_MS, 'ping', { playerId });
  }

  // --- Departmental Audits: pop quizzes on your own Form 27B --------------

  private auditQuestionText(field: 'location' | 'eta'): string {
    return field === 'location'
      ? 'What did you declare as your intended hiding location on Form 27B?'
      : 'What did you declare as your Estimated Time of Discovery (minutes) on Form 27B?';
  }

  private auditCheck(playerId: string) {
    if (this.phase !== 'seeking') return;
    const p = this.players.get(playerId);
    if (!p || p.role !== 'hider' || p.found || p.pendingAudit) {
      if (p && !p.found) this.scheduleTimer(AUDIT_INTERVAL_MS, 'audit_check', { playerId });
      return;
    }
    const form = this.forms.get(playerId);
    if (!form || Math.random() > AUDIT_CHANCE) {
      this.scheduleTimer(AUDIT_INTERVAL_MS, 'audit_check', { playerId });
      return;
    }

    const field: 'location' | 'eta' = Math.random() < 0.5 ? 'location' : 'eta';
    const correct = field === 'location' ? form.location : String(form.eta);
    const decoyPool = [...new Set(
      [...this.forms.values()]
        .map((f) => (field === 'location' ? f.location : String(f.eta)))
        .filter((v) => v !== correct)
    )];
    const decoys = pickRandomSubset(decoyPool, 2);
    const stockDecoys = field === 'location'
      ? ['Behind the good curtains', 'Under a suspiciously large coat', 'The stationery cupboard']
      : ['3', '12', '27'];
    let d = 0;
    while (decoys.length < 2) decoys.push(stockDecoys[d++ % stockDecoys.length]);

    p.pendingAudit = { field, correct, options: pickRandomSubset([correct, ...decoys], 3), expiresAt: Date.now() + AUDIT_RESPONSE_MS };
    this.scheduleTimer(AUDIT_RESPONSE_MS, 'audit_timeout', { playerId });
    this.notice(p, `Compliance Audit: ${this.auditQuestionText(field)} Answer within ${AUDIT_RESPONSE_MS / 1000} seconds.`);
    this.broadcastState();
  }

  private handleAuditAnswer(player: Player, choice: string) {
    if (!player.pendingAudit) return;
    const { field, correct } = player.pendingAudit;
    this.clearTimerForPlayer('audit_timeout', player.id);
    player.pendingAudit = null;

    if (choice === correct) {
      player.score += AUDIT_PASS_POINTS;
      player.alibiChits += 1;
      this.notice(player, `Audit passed: you correctly recalled your declared ${field === 'location' ? 'location' : 'ETA'}. +${AUDIT_PASS_POINTS} Compliance Points, +1 Alibi Chit.`);
    } else {
      player.pingedUntil = Date.now() + AUDIT_REVEAL_MS;
      this.notice(player, 'Audit failed: your testimony was inconsistent. Your position has been logged.');
    }
    this.scheduleTimer(AUDIT_INTERVAL_MS, 'audit_check', { playerId: player.id });
    this.broadcastState();
  }

  private auditTimeoutFor(playerId: string) {
    const p = this.players.get(playerId);
    if (!p || !p.pendingAudit) return;
    p.pendingAudit = null;
    p.pingedUntil = Date.now() + AUDIT_REVEAL_MS;
    this.notice(p, 'Audit lapsed: no response filed. Your position has been logged by default.');
    this.scheduleTimer(AUDIT_INTERVAL_MS, 'audit_check', { playerId });
    this.broadcastState();
  }

  // --- Broadcasting with fog-of-war / FOI ---------------------------------

  private isVisibleTo(viewer: Player, target: Player): boolean {
    if (this.mode === 'physical') return true; // no map to hide behind digitally
    if (viewer.id === target.id) return true;
    if (this.phase === 'lobby' || this.phase === 'briefing' || this.phase === 'ended') return true;
    if (target.found) return true;
    if (Date.now() < target.pingedUntil) return true; // "making a noise" reveal
    if (target.hidingCard?.effect === 'always_visible' && this.phase === 'seeking') return true;

    if (this.phase === 'hiding') {
      return viewer.role === 'hider' && target.role === 'hider';
    }

    if (viewer.role === 'hider' && target.role === 'hider') return true;

    if (target.hidingCard?.effect === 'camouflage') {
      // Undetectable by proximity — only caught if the seeker lands on the exact tile.
      return viewer.x === target.x && viewer.y === target.y;
    }

    const radius = viewer.role === 'seeker' ? this.effectiveVisionRadius() : VISION_RADIUS;
    const dist = Math.max(Math.abs(viewer.x - target.x), Math.abs(viewer.y - target.y));
    return dist <= radius;
  }

  private effectiveVisionRadius(): number {
    if (Date.now() < this.chaosVisionUntil) return BLACKOUT_RADIUS;
    if (this.seekingCard?.effect === 'reduced_vision') return 2;
    return VISION_RADIUS;
  }

  private redactName(name: string): string {
    if (name.length <= 1) return name;
    return name[0] + '█'.repeat(Math.max(1, name.length - 1));
  }

  // A hider's "concealment rating" is how much of the seek window they
  // survived before being finalized as found (or 100% if never found).
  private concealmentRating(p: Player): number {
    if (this.seekStartedAt <= 0) return 0;
    const totalMs = SEEK_SECONDS[this.mode] * 1000;
    if (totalMs <= 0) return 0;
    const endAt = p.found && p.foundAt ? p.foundAt : Date.now();
    const elapsed = endAt - this.seekStartedAt;
    return Math.max(0, Math.min(100, Math.round((elapsed / totalMs) * 100)));
  }

  private buildFoi(revealAll: boolean) {
    return [...this.players.values()]
      .filter((p) => p.role === 'hider')
      .map((p) => {
        const form = this.forms.get(p.id);
        const reveal = revealAll || p.found;
        return {
          id: p.id,
          name: reveal ? p.name : this.redactName(p.name),
          icon: reveal ? p.icon : '❓',
          found: p.found,
          location: form ? form.location : 'Unspecified',
          eta: form ? form.eta : 0,
          risk: form ? form.risk : false,
          ventilation: form ? form.ventilation : false,
          concealmentRating: this.concealmentRating(p),
          score: p.score,
        };
      });
  }

  private buildDisputeView(viewer: Player) {
    if (!this.dispute) return null;
    const accused = this.players.get(this.dispute.accusedId);
    const base = { stage: this.dispute.stage, accusedName: accused?.name ?? 'Unknown', reason: this.dispute.reason };
    if (viewer.id === this.dispute.accusedId) {
      return { ...base, role: 'accused' as const, reasons: this.dispute.availableReasons, alibiChits: viewer.alibiChits };
    }
    if (viewer.id === this.dispute.seekerId) {
      return { ...base, role: 'seeker' as const };
    }
    return { ...base, role: 'juror' as const, hasVoted: this.dispute.votes.has(viewer.id) };
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
      .map((p) => ({ id: p.id, name: p.name, icon: p.icon, x: p.x, y: p.y, color: p.color, role: p.role, found: p.found, ready: p.ready, score: p.score }));

    const isSeeker = viewer.id === this.seekerId;
    const isHider = viewer.role === 'hider';
    const showFoi = this.phase === 'ended' || (isSeeker && this.phase === 'seeking');

    return {
      type: 'state',
      you: viewer.id,
      mode: this.mode,
      phase: this.phase,
      seekerId: this.seekerId,
      briefingDeadline: this.briefingDeadline,
      hideDeadline: this.hideDeadline,
      seekDeadline: this.seekDeadline,
      clockPaused: this.seekPausedAt !== null,
      allReady: this.allPlayersReady(),
      players,
      foundCount: hiders.filter((p) => p.found).length,
      totalHiders: hiders.length,
      lastResult: this.lastResult,

      formsSubmitted: this.forms.size,
      myForm: this.forms.get(viewer.id) ?? null,

      hidingCard: isHider ? viewer.hidingCard : null,
      seekingCard: isSeeker ? this.seekingCard : null,
      youHaveAccused: isSeeker ? viewer.hasAccused : false,

      score: viewer.score,
      alibiChits: viewer.alibiChits,
      pendingAudit: viewer.pendingAudit
        ? { field: viewer.pendingAudit.field, options: viewer.pendingAudit.options, expiresAt: viewer.pendingAudit.expiresAt, question: this.auditQuestionText(viewer.pendingAudit.field) }
        : null,

      foi: showFoi ? this.buildFoi(this.phase === 'ended') : null,

      chaosEvent: this.chaosEvent,
      dispute: this.buildDisputeView(viewer),
      pendingVote: this.pendingVote
        ? {
            candidates: [...this.players.values()]
              .filter((p) => p.role === 'hider' && !p.found)
              .map((p) => ({ id: p.id, name: p.name })),
            youVoted: this.pendingVote.votes.has(viewer.id),
            eligible: viewer.role === 'hider' && !viewer.found,
          }
        : null,
    };
  }

  private notice(player: Player, text: string) {
    this.send(player.ws, { type: 'notice', text });
  }

  private broadcastGo() {
    for (const p of this.players.values()) this.send(p.ws, { type: 'go' });
  }

  private broadcastNotice(text: string) {
    for (const p of this.players.values()) this.notice(p, text);
  }

  private send(ws: WebSocket, data: unknown) {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      // Socket already closed; onLeave will clean it up.
    }
  }
}
