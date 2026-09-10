# Hide and Seek But Worse

A small real-time multiplayer hide-and-seek game that runs entirely on
[Cloudflare Workers](https://developers.cloudflare.com/workers/), using a
[Durable Object](https://developers.cloudflare.com/durable-objects/) per game
room to hold authoritative state and a WebSocket per player for live updates.
It's meant as a compact, readable example of building a multiplayer game on
Workers — not a polished product.

## How it plays

- Open the page, pick a name and a room code, and join. Anyone who shares the
  same room code lands in the same game.
- The first player to join is the **seeker**; everyone else is a **hider**.
- Once 2+ players are in, anyone can hit **Start Game**:
  1. **Hiding phase** (10s) — hiders scatter around the map. The seeker is
     frozen and can't see anyone.
  2. **Seeking phase** (60s) — the seeker moves around and "catches" a hider
     by stepping on their tile. The seeker can only see hiders within a
     limited radius (fog of war); hiders can always see each other.
  3. The round ends when every hider is found or the timer runs out.
- Hit **Play Again** to reset — the seeker role rotates to the next player.

Move with Arrow Keys or WASD.

## Architecture

```
src/worker.ts     Routes /ws to the right Durable Object, serves static assets otherwise
src/gameRoom.ts   The GameRoom Durable Object: one instance per room, holds
                  all player state, movement/collision logic, phase timers
                  (via DO alarms), and per-player fog-of-war filtering
public/           Static frontend: canvas renderer + WebSocket client
```

Each room is a separate Durable Object instance (keyed by room code via
`idFromName`), so state, movement validation, and win conditions all live in
one place per room with no external database needed. Phase transitions (hide
→ seek → round end) are scheduled with the Durable Object [Alarms
API](https://developers.cloudflare.com/durable-objects/api/alarms/) rather
than timers, so they survive the object being evicted and restarted between
messages.

## Getting started

```bash
npm install
npm run dev       # starts a local dev server (wrangler dev)
```

Open the printed local URL, join from two browser tabs (or two devices on
the same network), and play.

## Deploying

```bash
npx wrangler login   # first time only
npm run deploy
```

This publishes the Worker and its Durable Object under your Cloudflare
account. Durable Objects here use the SQLite storage backend
(`new_sqlite_classes` in `wrangler.toml`), which is available on Cloudflare's
free Workers plan.

## To do

- **More hiding/seeking/chaos cards.** The three decks are small (6/5/5
  cards), so with only a few hiders and short rounds the same cards come up
  repeatedly. Needs a bigger pool of cards — and ideally a "no immediate
  repeat" rule — so a run of several rounds doesn't feel samey.

## Ideas for extending it

- Persist high scores or best hider survival times using the Durable
  Object's SQL storage.
- Add walls the seeker can "listen" through (sound radius vs. sight radius).
- Support more than one seeker, or a "freeze tag" variant.
- Switch to the [WebSocket Hibernation
  API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/#websocket-hibernation-api)
  so idle rooms don't keep the Durable Object billed as active.
