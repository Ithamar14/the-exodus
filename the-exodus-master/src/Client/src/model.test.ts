import assert from "node:assert/strict";
import test from "node:test";
import {
  computeComicKnockback,
  computeWaveFoamDots,
  computeWaveSegments,
  deriveRoundControlState,
  deriveRoundView,
  formatRoundStatusLabel,
  formatStatusLabel,
  PLAYER_COLOR_PALETTE,
  resolvePlayerColor,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type WorldSnapshot
} from "./model";

function makeSnapshot(overrides: Partial<WorldSnapshot>): WorldSnapshot {
  return {
    tick: 1,
    serverTimeMs: 123456,
    players: [],
    round: {
      phase: "WaitingToStart",
      firstPlayerId: null,
      starterId: null,
      winnerPlayerId: null
    },
    hazard: {
      wave: {
        isActive: false,
        side: null,
        gapAxis: null,
        gapStart: null,
        gapEnd: null,
        progress: null,
        frontCoordinate: null,
        thickness: null
      },
      cloud: {
        isActive: false,
        x: null,
        y: null,
        radius: null,
        secondsUntilResolve: null
      }
    },
    events: [],
    winnerPlayerId: null,
    gameOver: false,
    ...overrides
  };
}

test("derives winner and player statuses from exact snapshot fields", () => {
  const snapshot = makeSnapshot({
    players: [
      { id: "a", name: "A", x: 10, y: 10, targetX: 10, targetY: 10, isMoving: false, isAlive: false, isWinner: false, deathReason: "boundary" },
      { id: "b", name: "B", x: 20, y: 20, targetX: 20, targetY: 20, isMoving: true, isAlive: true, isWinner: false, deathReason: null },
      { id: "c", name: "C", x: 30, y: 30, targetX: 30, targetY: 30, isMoving: false, isAlive: false, isWinner: false, deathReason: "wave" }
    ],
    winnerPlayerId: "b",
    gameOver: true
  });

  const view = deriveRoundView(snapshot);

  assert.equal(view.players.find((player) => player.id === "a")?.status, "dead");
  assert.equal(view.players.find((player) => player.id === "b")?.status, "winner");
  assert.equal(view.players.find((player) => player.id === "b")?.isMoving, true);
  assert.equal(view.alivePlayers.length, 1);
  assert.equal(view.winner?.id, "b");
  assert.equal(view.gameOver, true);
  assert.equal(view.status, "game-over");
  assert.equal(view.statusLabel, "Game over");
  assert.equal(view.hazardsActive, false);
});

test("falls back to a death event when a player crosses the boundary", () => {
  const previous = makeSnapshot({
    players: [
      { id: "a", name: "A", x: 100, y: 100, targetX: 100, targetY: 100, isMoving: true, isAlive: true, isWinner: false, deathReason: null }
    ]
  });

  const current = makeSnapshot({
    players: [
      { id: "a", name: "A", x: 1040, y: 200, targetX: 1040, targetY: 200, isMoving: true, isAlive: false, isWinner: false, deathReason: "boundary" }
    ]
  });

  const view = deriveRoundView(current, previous);

  assert.equal(view.players[0]?.outside, true);
  assert.equal(view.events.some((event) => event.type === "player_died" && event.playerId === "a"), true);
});

test("splits a top wave into two readable segments around the gap", () => {
  const segments = computeWaveSegments({
    isActive: true,
    side: "top",
    gapAxis: "y",
    gapStart: 180,
    gapEnd: 330,
    progress: 0.3,
    frontCoordinate: 220,
    thickness: 200
  });

  assert.equal(segments.length, 2);
  assert.equal(segments[0].y, 0);
  assert.equal(segments[0].height, 180);
  assert.equal(segments[1].y, 330);
  assert.equal(segments[1].height, 768 - 330);
});

test("positions a bottom wave below the gap and keeps the opening readable", () => {
  const segments = computeWaveSegments({
    isActive: true,
    side: "bottom",
    gapAxis: "x",
    gapStart: 260,
    gapEnd: 720,
    progress: 0.4,
    frontCoordinate: 640,
    thickness: 120
  });

  assert.equal(segments.length, 2);
  assert.equal(segments[0].x, 0);
  assert.equal(segments[0].y, 520);
  assert.equal(segments[0].width, 260);
  assert.equal(segments[0].height, 120);
  assert.equal(segments[1].x, 720);
  assert.equal(segments[1].y, 520);
  assert.equal(segments[1].width, 1024 - 720);
  assert.equal(segments[1].height, 120);
});

test("derives round control visibility for only the first wanderer", () => {
  const waiting = makeSnapshot({
    round: {
      phase: "WaitingToStart",
      firstPlayerId: "a",
      starterId: null,
      winnerPlayerId: null
    }
  });

  const active = makeSnapshot({
    round: {
      phase: "Active",
      firstPlayerId: "a",
      starterId: "a",
      winnerPlayerId: null
    }
  });

  const gameOver = makeSnapshot({
    round: {
      phase: "GameOver",
      firstPlayerId: "a",
      starterId: "a",
      winnerPlayerId: "b"
    },
    winnerPlayerId: "b",
    gameOver: true
  });

  assert.equal(deriveRoundControlState(waiting.round, "a").visible, true);
  assert.equal(deriveRoundControlState(waiting.round, "a").action, "start");
  assert.equal(deriveRoundControlState(waiting.round, "b").visible, false);
  assert.equal(deriveRoundControlState(active.round, "a").visible, false);
  assert.equal(deriveRoundControlState(gameOver.round, "a").action, "restart");
  assert.equal(deriveRoundControlState(gameOver.round, "b").visible, false);
});

test("maps round phases to readable status labels", () => {
  assert.equal(formatRoundStatusLabel("not-started"), "Waiting to start");
  assert.equal(formatRoundStatusLabel("active"), "Active");
  assert.equal(formatRoundStatusLabel("game-over"), "Game over");
});

test("maps starvation deaths to the starved label", () => {
  assert.equal(formatStatusLabel({
    id: "a",
    name: "A",
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    isMoving: false,
    isAlive: false,
    isWinner: false,
    hasCollectedMannaThisCycle: false,
    deathReason: "starved",
    color: PLAYER_COLOR_PALETTE[0],
    outside: false,
    status: "dead",
    statusLabel: "dead"
  }), "starved");
});

test("computes a comic knockback vector with a fixed launch distance", () => {
  const launch = computeComicKnockback(3, 4, 240);

  assert.equal(Math.round(Math.hypot(launch.x, launch.y)), 240);
  assert.equal(launch.x > 0, true);
  assert.equal(launch.y > 0, true);
});

test("computes evenly spaced wave foam dots on the leading edge", () => {
  const dots = computeWaveFoamDots({
    isActive: true,
    side: "left",
    gapAxis: "y",
    gapStart: 180,
    gapEnd: 330,
    progress: 0.3,
    frontCoordinate: 220,
    thickness: 200
  });

  assert.ok(dots.length > 0);
  assert.ok(dots.every((dot) => dot.side === "left"));
  assert.ok(dots.every((dot) => dot.x === 220));
  const grouped = new Map<number, number[]>();
  for (const dot of dots) {
    const group = grouped.get(dot.segmentIndex) ?? [];
    group.push(dot.y);
    grouped.set(dot.segmentIndex, group);
  }

  for (const group of grouped.values()) {
    const sorted = [...group].sort((left, right) => left - right);
    if (sorted.length < 3) {
      continue;
    }

    const deltas = sorted.slice(1).map((value, index) => value - sorted[index]);
    const target = deltas[0];
    for (const delta of deltas) {
      assert.ok(Math.abs(delta - target) < 0.6);
    }
  }
});

test("synthesizes a manna cycle with five pickups when backend manna is absent", () => {
  const snapshot = makeSnapshot({
    round: {
      phase: "Active",
      firstPlayerId: "a",
      starterId: "a",
      winnerPlayerId: null
    },
    players: [
      { id: "a", name: "A", x: 160, y: 180, targetX: 160, targetY: 180, isMoving: false, isAlive: true, isWinner: false, deathReason: null },
      { id: "b", name: "B", x: 320, y: 260, targetX: 320, targetY: 260, isMoving: false, isAlive: true, isWinner: false, deathReason: null }
    ]
  });

  const first = deriveRoundView(snapshot);
  const second = deriveRoundView(snapshot);

  assert.equal(first.manna.isActive, true);
  assert.equal(first.manna.pickups.length, 5);
  assert.equal(first.manna.cycleId, second.manna.cycleId);
  assert.deepEqual(first.manna.pickups.map((pickup) => pickup.id), second.manna.pickups.map((pickup) => pickup.id));
});

test("synthesizes manna pickups scattered across the map rather than on a grid", () => {
  const snapshot = makeSnapshot({
    serverTimeMs: 987654,
    round: {
      phase: "Active",
      firstPlayerId: "a",
      starterId: "a",
      winnerPlayerId: null
    },
    players: [
      { id: "a", name: "A", x: 120, y: 120, targetX: 120, targetY: 120, isMoving: false, isAlive: true, isWinner: false, deathReason: null },
      { id: "b", name: "B", x: 300, y: 420, targetX: 300, targetY: 420, isMoving: false, isAlive: true, isWinner: false, deathReason: null },
      { id: "c", name: "C", x: 700, y: 540, targetX: 700, targetY: 540, isMoving: false, isAlive: true, isWinner: false, deathReason: null }
    ]
  });

  const view = deriveRoundView(snapshot);
  const xs = view.manna.pickups.map((pickup) => pickup.x);
  const ys = view.manna.pickups.map((pickup) => pickup.y);

  assert.ok(Math.max(...xs) - Math.min(...xs) > WORLD_WIDTH * 0.2);
  assert.ok(Math.max(...ys) - Math.min(...ys) > WORLD_HEIGHT * 0.2);
  assert.ok(view.manna.pickups.every((pickup) => pickup.x >= 72 && pickup.x <= WORLD_WIDTH - 72));
  assert.ok(view.manna.pickups.every((pickup) => pickup.y >= 96 && pickup.y <= WORLD_HEIGHT - 96));
});

test("shows manna-fed status for collected wanderers", () => {
  const snapshot = makeSnapshot({
    players: [
      {
        id: "a",
        name: "A",
        x: 10,
        y: 10,
        targetX: 10,
        targetY: 10,
        isMoving: false,
        isAlive: true,
        isWinner: false,
        hasCollectedMannaThisCycle: true,
        deathReason: null
      }
    ]
  });

  const view = deriveRoundView(snapshot);

  assert.equal(formatStatusLabel(view.players[0]), "fed");
});

test("prefers an explicit backend player color when provided", () => {
  assert.deepEqual([...PLAYER_COLOR_PALETTE], [
    0x2a6fdb,
    0xe63946,
    0x2a9d8f,
    0x8d6cab,
    0xf4a261,
    0x4ecdc4
  ]);
  assert.equal(resolvePlayerColor({ id: "alpha", color: "#2a6fdb" }), 0x2a6fdb);
  assert.equal(resolvePlayerColor({ id: "alpha", color: "#204060" }), 0x2a9d8f);
});

test("falls back to a stable derived player color when the backend omits one", () => {
  const first = resolvePlayerColor({ id: "alpha" });
  const second = resolvePlayerColor({ id: "alpha" });
  const other = resolvePlayerColor({ id: "beta" });

  assert.equal(first, second);
  assert.notEqual(first, other);
});
