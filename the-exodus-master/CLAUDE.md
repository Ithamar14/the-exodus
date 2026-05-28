# CLAUDE.md — The Exodus

Read this at the start of every session. It is the source of truth for how to work in this repo.

---

## Project

Browser-based multiplayer desert game. Players move, shoot fireballs, and knock each other out.

- **Backend:** ASP.NET Core 8 minimal API + SignalR hub (`src/Server/`)
- **Frontend:** TypeScript + Phaser 3 + Vite (`src/Client/`)
- **Port:** 55435
- **Current version:** 0.1.0 (in `src/Client/package.json`)

---

## Build steps (run after every pull)

```bash
# Client
cd src/Client
npm install
npm run build        # compiles TS, copies output to src/Server/wwwroot/

# Server (separate terminal)
cd src/Server
dotnet run
```

`dist/` and `wwwroot/` are gitignored — always rebuild after pulling.

### Sprite generation (only needed if sprites are missing)

```bash
cd src/Client
node scripts/gen-sprites.mjs
```

Writes placeholder PNGs to `public/sprites/`. Replace with pixel art at the same dimensions.

---

## Push / version protocol — STRICT

- **Never push to main without the user explicitly asking.**
- **Never bump the version without the user explicitly confirming** — always ask "patch / minor / major?" first.
- Version lives in `src/Client/package.json`. Semver: MAJOR.MINOR.PATCH.
- After bumping: rebuild, update `VERSION_HISTORY.md`, then commit and push.

---

## Repo structure

```
src/
  Client/
    public/sprites/     PNG sprites for character body parts (committed)
    scripts/
      gen-sprites.mjs   Generates placeholder PNGs (pure Node.js, no deps)
      sync-wwwroot.mjs  Copies dist/ → Server/wwwroot/ after build
    src/
      app.ts            All Phaser game logic and SignalR client
      model.ts          Shared data model / view derivation
      model.test.ts     Unit tests
    package.json
  Server/
    Game/
      Contracts.cs      Shared record types (snapshots, events, DTOs)
      GameHub.cs        SignalR hub — all client↔server messages
      GameLoopService.cs  Background tick loop
      GameRules.cs      All tunable gameplay constants
      GameWorld.cs      Authoritative game simulation
      TunableAttribute.cs  [Tunable] attribute for settings panel reflection
      RandomSource.cs
    Program.cs
    Tests/
      GameWorldTests.cs
    appsettings.json
VERSION_HISTORY.md
```

---

## Key architecture decisions

**Server-authoritative:** All game state lives on the server. The client sends intent (click target, shoot) and receives world snapshots over SignalR at a fixed tick rate.

**Schema-driven tuning panel:** Any `GameRules` property tagged `[Tunable(...)]` automatically appears in the host's settings panel. Changes apply live without restart. Settings persist to `gamerules.json` (gitignored).

**Sprite system:** Each player body part is a separate `Phaser.GameObjects.Image`. The head and gun are not tinted. The sprites live in `public/sprites/` and are committed to the repo.

**Sprite rule — always ask:** Whenever adding any new visual object (Graphics primitive, shape, icon, indicator, effect, etc.), always ask the user: *"Should I add a placeholder sprite PNG for this to `public/sprites/`?"* before implementing it as a programmatic drawing. Examples of things that should prompt this question: fireballs, life/health indicators, manna orbs, emote bubbles, UI icons, particle effects.

**Character rendering (PlayerAvatar in app.ts):**
- `figure` container: `scaleX = facingDir * bodySquish`
- Head counteracts squish: `head.scaleX = 1 / bodySquish` (so world scaleX = facingDir only)
- Gun tracks `armFront` rotation every frame, positioned at the wrist (18.4px from pivot)
- Recoil animation: `triggerRecoil()` called when a new fireball is detected for that player

**Sprite dimensions:**
| Sprite      | Display size | Origin     | Notes |
|-------------|-------------|------------|-------|
| head        | 20 × 22     | (0.5, 0.5) | not tinted |
| torso       | 12 × 28     | (0.5, 0.5) | |
| arm         | 8 × 20      | (0.5, 0.08)| ×2, shoulder pivot |
| leg         | 8 × 22      | (0.5, 0.08)| ×2, hip pivot |
| gun         | 38 × 14     | (0, 5/14)  | tracks armFront each frame |
| fireball    | 36 × 36     | (0.5, 0.5) | sprite per active fireball; trail still drawn with Graphics |
| life_dot    | 10 × 10     | (0.5, 0.5) | tinted red (alive) or grey (spent) |
| platform    | 64 × 26     | (0.5, 0)   | stretched to platform width via setDisplaySize |

---

## Git workflow (two machines)

1. **Before leaving any machine:** commit and push all changes.
2. **Before starting on any machine:** `git pull` first, always.
3. After pulling: run build steps above before testing.
4. Never start editing if the other machine has unpushed commits.
