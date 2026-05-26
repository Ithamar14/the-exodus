# Desert Multiplayer MVP

Simple browser-based multiplayer desert room for up to 6 players.

## Stack
- Backend: ASP.NET Core 8 minimal API + SignalR
- Frontend: TypeScript + Phaser 3 + Vite
- Hosting: one ASP.NET Core process serving static frontend files and realtime backend

## What Was Built
- Single shared room with server-side max player limit of 6
- Name entry flow with immediate join attempt
- Server-authoritative movement from click/tap intent
- Fixed-tick world snapshots over SignalR
- Phaser desert scene with lightweight generated placeholder characters
- Player names below characters
- Funny transform-only walk sway while moving
- Y-based depth sorting for pseudo top-down presentation
- Basic reconnect and rejoin behavior for MVP

## Local Run
1. Build the frontend:
```bash
cd src/Client
npm install
npm run build
```
2. Run the server on the required port:
```bash
cd ../Server
dotnet run --urls http://0.0.0.0:55435
```
3. Open `http://localhost:55435` in two browser windows.

## Repo Layout
- `src/Server`
- `src/Client`
- `docs`
- `README.md`

## Protocol
The shared realtime contract is documented in `docs/protocol.md`.

## Gameplay Verification
- Verification matrix: `docs/gameplay-verification.md`
- Backend logic tests:
```bash
dotnet test src/Server/Tests/Server.Tests.csproj
```
- Frontend model tests:
```bash
cd src/Client
npm test
```
- Browser gameplay regression tests (runs local backend + frontend automatically):
```bash
cd src/Client
npm run test:browser
```

## MVP Notes
- State is fully in-memory.
- There is no auth, persistence, lobby, or matchmaking.
- Room capacity is enforced server-side.

## Feedback Needed
- Whether random spawn positions are acceptable for the first join experience
- Whether current movement speed and sway amplitude feel right
- Whether the placeholder art direction should stay minimal or become slightly more characterful next
