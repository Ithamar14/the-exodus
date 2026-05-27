# Product Scope: Desert Multiplayer MVP

## Goal
Build and maintain a simple browser-based multiplayer 2D desert game for up to 6 players.
Single shared room only. No lobby, no matchmaking, no persistence, no auth.

## Required Stack
- Backend: ASP.NET Core 8 minimal API + SignalR
- Frontend: TypeScript + Phaser 3 + Vite
- Hosting: one ASP.NET Core process serving the built frontend and realtime backend

## Gameplay Requirements
- A player opens the page, enters a name, and immediately joins the single shared room.
- All connected players are visible to each other on the same screen.
- Clicking or touching anywhere moves the local player toward that point.
- Name appears below each character.
- Character has a funny side-to-side sway while walking.
- Sway must use transforms only: rotation / translation / scale. No sprite-sheet animation.
- Pseudo-perspective top-down view:
  - characters are visually side-on
  - up/down movement represents depth
  - render order follows y position

## Technical Rules
- Keep it simple.
- In-memory state only.
- Max 6 active players.
- Server-authoritative movement.
- Client may interpolate remote players for smoothness.
- No database.
- No login.
- No lobby/session browser.
- No heavy UI frameworks unless clearly needed.

## Architecture
- Backend owns truth for player id, name, position, target, and movement updates.
- Frontend sends intent (target point), not per-frame positions.
- Backend broadcasts snapshots / movement updates to all clients.
- Frontend renders players and local interaction.
- Shared protocol is documented in `docs/protocol.md`.

## Repo Shape
- `src/Server`
- `src/Client`
- `docs`
- `README.md`

## Quality Bar
- Keep iterating on a working MVP without over-building.
- Before finishing a version, verify build + tests + visual inspection.
- Verification is local run + automated tests + manual play check.
