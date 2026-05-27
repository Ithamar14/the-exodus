# Version History

## v0.0.2 — Schema-driven tuning panel
**Status:** Main build

### What Was Built
- In-game version indicator (top-left of canvas, reads from package.json)
- `[Tunable]` attribute on `GameRules` — any new property annotated with it automatically appears in the settings panel
- All gameplay constants moved from hardcoded `GameWorld` values into `GameRules`: lives, invincibility, walk speed, gravity, jump velocity, collision launch distance, fireball speed/radius, manna timing
- Host-only settings panel in the sidebar, visible only between rounds
- Fields grouped into collapsible categories (Core, Players, Movement, Collision, Fireball, Wave, Cloud, Manna)
- Changes apply immediately without a server restart
- Settings persist to `gamerules.json` and reload on next server start
- Fireball visual speed on the client stays in sync with the server-side `FireballSpeed` rule

## v0.0.1 — Initial MVP
**Status:** Local build complete

### What Was Built
- Single shared room with server-side max player limit of 6
- Name entry flow with immediate join attempt
- Server-authoritative movement from click/tap intent
- Fixed-tick world snapshots over SignalR (ASP.NET Core 8 + SignalR backend)
- Phaser 3 desert scene with lightweight generated placeholder characters
- Player names rendered below characters
- Transform-only walk sway animation while moving
- Y-based depth sorting for pseudo top-down presentation
- Basic reconnect and rejoin behavior for MVP
- Backend unit tests (GameWorld, GameRules)
- Frontend model unit tests
- Browser regression tests (Playwright)

### Stack
- Backend: ASP.NET Core 8 minimal API + SignalR
- Frontend: TypeScript + Phaser 3 + Vite
- Port: 55435

### Known Limitations / Open Items
- State is fully in-memory (no persistence)
- No auth, lobby, or matchmaking
- Spawn positions are random on join
- Placeholder art direction (no sprite sheets)
- Feedback needed on movement speed and sway amplitude
