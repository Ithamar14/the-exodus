# Realtime Protocol (SignalR)

Hub route: `/hubs/game`

## Client -> Server

### `Join`
Join the single shared room after entering a name.

Payload:
```json
{
  "name": "string (1-20 chars after trim)"
}
```

Behavior:
- First successful `Join` binds connection to a server player id.
- Reject if already joined.
- Reject if room full (6 active players).
- Join is allowed while waiting, active, or after game over. The round is gated separately.

### `SetTarget`
Send movement intent only.

Payload:
```json
{
  "x": 400,
  "y": 300
}
```

Behavior:
- Server clamps target inside world bounds.
- Server updates authoritative target for caller during `WaitingToStart` and `Active` rounds.
- Movement remains server-authoritative while waiting, but hazards stay gated until the round starts.

### `StartRound`
Start the round from the pre-round waiting state.

Payload:
```json
{}
```

Behavior:
- Only the designated first player may start the round.
- The designated first player is the earliest currently connected player when the round is waiting.
- Reject if the round is not waiting.
- Reject if the caller is not the designated first player.

### `RestartRound`
Restart after game over.

Payload:
```json
{}
```

Behavior:
- Only the same designated first player may restart the round.
- Reject if the round is not game over.
- Reject if the caller is not the designated first player.
- On success, all connected players are respawned at new random in-bounds positions.

### `Emote`
Broadcast a quick expressive emote from the caller.

Payload:
```json
{
  "code": "dove | trumpet | bread | laugh | wave"
}
```

Behavior:
- Ignored if caller is not a joined player.
- Ignored for unknown emote codes.
- On success, server broadcasts `PlayerEmoted`.

## Server -> Client

### `Joined`
Sent to caller on successful join.

Payload:
```json
{
  "selfId": "player-id"
}
```

### `JoinRejected`
Sent to caller when join fails.

Payload:
```json
{
  "reason": "room_full | invalid_name | already_joined"
}
```

### `RoundActionRejected`
Sent to caller when `StartRound` or `RestartRound` fails.

Payload:
```json
{
  "action": "start | restart",
  "reason": "not_waiting | not_game_over | not_authorized | no_players"
}
```

### `RoundStarted`
Broadcast when the round starts.

Payload:
```json
{
  "starterId": "player-id"
}
```

### `RoundRestarted`
Broadcast when the round restarts after game over.

Payload:
```json
{
  "starterId": "player-id"
}
```

### `PlayerEmoted`
Broadcast when a joined player triggers an emote.

Payload:
```json
{
  "playerId": "player-id",
  "code": "dove | trumpet | bread | laugh | wave"
}
```

### `WorldSnapshot`
Broadcast at fixed tick (includes all current connected players, alive and dead).

Payload:
```json
{
  "tick": 123,
  "serverTimeMs": 123456789,
  "round": {
    "phase": "WaitingToStart | Active | GameOver",
    "firstPlayerId": "player-id",
    "starterId": "player-id",
    "winnerPlayerId": "player-id"
  },
  "players": [
    {
      "id": "player-id",
      "name": "Ada",
      "x": 100,
      "y": 120,
      "targetX": 350,
      "targetY": 240,
      "color": "#2a6fdb",
      "isMoving": true,
      "isAlive": true,
      "isWinner": false,
      "hasCollectedMannaThisCycle": false,
      "deathReason": null
    }
  ],
  "hazard": {
    "wave": {
      "isActive": true,
      "side": "left",
      "gapAxis": "y",
      "gapStart": 240,
      "gapEnd": 378,
      "progress": 0.42,
      "frontCoordinate": 420,
      "thickness": 72,
      "secondsUntilSpawn": null
    },
    "cloud": {
      "isActive": false,
      "x": null,
      "y": null,
      "radius": 140,
      "secondsUntilResolve": 6.4
    }
  },
  "manna": {
    "isActive": true,
    "cycleId": 1,
    "secondsUntilNextCycle": 0,
    "secondsUntilBlink": 5,
    "secondsUntilDisappear": 10,
    "isBlinking": false,
    "requiredPerPlayer": 1,
    "remainingPickupCount": 5,
    "pickups": [
      {
        "id": "1:0",
        "x": 200,
        "y": 140,
        "isCollected": false,
        "collectedByPlayerId": null
      }
    ]
  },
  "events": [
    {
      "type": "player_bumped",
      "playerId": "a",
      "otherPlayerId": "b",
      "impulseX": 7.2,
      "impulseY": -1.4,
      "x": 312,
      "y": 240
    },
    {
      "type": "manna_cycle_spawned",
      "cycleId": 1,
      "count": 5,
      "remainingCount": 5,
      "isActive": true
    }
  ],
  "winnerPlayerId": null,
  "gameOver": false
}
```

Notes:
- Snapshot is authoritative.
- At most one hazard is active at a time (`hazard.wave.isActive` and `hazard.cloud.isActive` are never both `true`).
- Hazards and manna phase are separated: queued hazard metadata is hidden while manna is active, and manna spawn is deferred while hazards are active or imminent.
- Hazard order is server-randomized per cycle with weighted selection: wave 50%, cloud 30%, manna 20%.
- After a hazard resolves/completes, server applies an extra 3-second transition delay before the next phase countdown.
- `hazard.wave.secondsUntilSpawn` and `hazard.wave.side` are populated only when wave is the next queued hazard.
- `hazard.cloud.secondsUntilResolve` is populated while cloud is active, and also while cloud is the next queued hazard.
- Client may interpolate for smoothness.
- Dead players remain in snapshots until they disconnect so the UI can keep a live/dead list.
- `color` is assigned authoritatively on join from the fixed six-color palette: blue (`#2a6fdb`), red (`#e63946`), green (`#2a9d8f`), purple (`#8d6cab`), orange (`#f4a261`), cyan (`#4ecdc4`).
- `hasCollectedMannaThisCycle` resets each manna cycle and tells the UI who still needs manna this round.
- `hazard.cloud` marks the active cloud safe zone during darkness checks.
- While `hazard.cloud.isActive` is true, players outside the cloud radius are eliminated when the cloud resolves.
- `manna` is the authoritative pickup cycle state, including blink and expire timers.
- `manna.secondsUntilBlink`, `manna.secondsUntilDisappear`, and `manna.isBlinking` let the client show the warning blink phase without guessing locally.
- `events` is the animation/sound feed for bumps, deaths, wave spawns, cloud spawn/resolve, manna spawn/blink/collection/resolution, and victory.
- `hazard.wave.secondsUntilSpawn` is set while no wave is active; clients can show a warning in the final 5 seconds before spawn, then transition to the active wave.
- `deathReason` values currently used are `wave`, `boundary`, `starved`, and `darkness`.
- `round.phase` controls when gameplay is active.
- Only `round.firstPlayerId` may send `StartRound` or `RestartRound`.
- Client UI policy: only the host (`round.firstPlayerId` / `round.starterId`) sees the side menu after joining.

### `GameEventSnapshot`
Event types currently used by the server:
- `wave_spawned`
- `cloud_spawned`
- `cloud_resolved`
- `manna_cycle_spawned`
- `manna_cycle_blink_started`
- `manna_collected`
- `manna_cycle_resolved`
- `player_bumped`
- `player_died`
- `winner_declared`

Common fields:
- `type`
- `playerId`
- `otherPlayerId`
- `reason`
- `x`
- `y`
- `impulseX`
- `impulseY`
- `side`
- `gapAxis`
- `gapStart`
- `gapEnd`
- `progress`
- `frontCoordinate`
- `directionX`
- `directionY`
- `strength`
- `pickupId`
- `cycleId`
- `count`
- `remainingCount`
- `isActive`
- `secondsUntilStateChange`

## Constants
- Max players: `6`
- World size: `1024 x 768`
- Server tick: `20 Hz` (50 ms)
- Move speed: `180 units/s`
