# Version History

## v0.1.1 — Level editor, sprite-driven character model
**Status:** Main build

### What Was Built
- **Level editor** redesigned as a floating right-side panel, opened from a button in the settings menu
  - Add Platform toggle: when ON, each click spawns a platform; when OFF, click to select / drag to move / corner-drag to resize
  - Selected platform highlighted in yellow; Delete key removes it
  - Save / load map controls in the same panel
- **Platform hitbox sync**: drag, add, and delete all call `ApplyPlatforms` to keep server physics in sync in real time (`ApplyPlatforms` hub method + `TryApplyPlatforms` on `GameWorld`)
- **PlayerSize tunable** added to `GameRules` ("Players" category, 0.25–3.0, default 1.0)
  - Server physics (`PlayerHalfHeight`, `EffectiveGroundY`) scale with it
  - Client reads it from `RulesSchema` and applies `root.scaleX/Y = PlayerSize` to all player avatars
- **Sprite-driven character layout**: `setDisplaySize()` removed from all body parts — sprites render at natural PNG dimensions
  - All body-part positions (head, arms, legs, dots, labels, halo) are computed proportionally from sprite dimensions in the constructor; no hardcoded pixel offsets remain
  - Gun wrist-tracking distance derived from arm sprite height (`armFront.height × 0.92`)
  - Shadow projects to the fixed ground surface (Y=707) correctly at any `PlayerSize`
- **Fireball sprite** flips horizontally to face the direction of travel

### Bug Fixes
- Drag editor state was reset every server tick (editor interaction re-initialized from `handleSnapshot`); cursor flickered and selection was lost immediately
- Deleting a platform removed the interaction border but left the sprite visible
- Saving a map had no effect on server physics (hitboxes remained at original positions)

## v0.1.0 — Sprite-based characters & combat feel
**Status:** Main build

### What Was Built
- Player characters rebuilt with individual PNG sprites per body part: head, torso, arm (×2), leg (×2), gun
- `scripts/gen-sprites.mjs` generates placeholder PNGs — replace with pixel art at same dimensions
- Head sprite is directional — flips with facing without distorting walk squish
- Gun replaced from Graphics primitives to sprite (`gun.png`, 38×14 display size)
- Arm swing amplitude increased to ±0.4 rad (±23°), visibly matching leg swing scale
- Recoil animation on shoot: front arm and gun kick back ~40° over 220 ms, triggered for all players when a fireball is detected as new

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
