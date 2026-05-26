# Desert Multiplayer MVP Plan

## Scope
Build a single-room browser multiplayer MVP for up to 6 players with server-authoritative movement.

## Phases
1. Orchestrator baseline
- Define implementation plan and shared protocol docs.
- Set repo shape and branch strategy.

2. Backend PR-sized phase (`backend/realtime-mvp`)
- Create ASP.NET Core 8 minimal API app.
- Add SignalR hub and in-memory world/player state.
- Enforce max 6 players.
- Accept join (name) and move intent (target x/y).
- Simulate movement on fixed tick.
- Broadcast world snapshots.
- Serve built frontend static files.
- Configure app to run on port 55435.

3. Frontend PR-sized phase (`frontend/game-mvp`)
- Create Vite + TypeScript + Phaser client.
- Add name entry and immediate join.
- Connect to SignalR hub and apply protocol.
- Render desert scene and player placeholders.
- Implement click/tap move intent.
- Show names under players.
- Add y-depth sorting.
- Add walking sway via transform-only animation.
- Add reconnect handling sufficient for MVP.

4. Orchestrator integration/review
- Verify protocol compatibility.
- Verify local run flow.
- Keep complexity minimal and MVP-focused.
- Final README with exact local run instructions.

## Non-goals
- No auth, persistence, lobby, matchmaking, inventory, combat, or multiple rooms.
