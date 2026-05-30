export let WORLD_WIDTH  = 3072;
export let WORLD_HEIGHT = 2304;
export let GROUND_Y     = WORLD_HEIGHT - 61; // feet Y when standing on ground

export function updateWorldSize(w: number, h: number): void {
  WORLD_WIDTH  = w;
  WORLD_HEIGHT = h;
  GROUND_Y     = h - 61;
}

export const VIEWPORT_WIDTH  = 1024;
export const VIEWPORT_HEIGHT = 768;

export const PLAYER_COLLISION_RADIUS = 30;
export const PLAYER_BUMP_DISTANCE = 18;
export const PLAYER_COLOR_PALETTE = [
  0x2a6fdb,
  0xe63946,
  0x2a9d8f,
  0x8d6cab,
  0xf4a261,
  0x29d1c5
] as const;

export type PlayerSnapshot = {
  id: string;
  name: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  isMoving: boolean;
  isAlive: boolean;
  isWinner: boolean;
  hasCollectedMannaThisCycle?: boolean;
  deathReason: string | null;
  color?: string | number | null;
  facingDir?: number;
  lives?: number;
  isInvincible?: boolean;
};

export type WaveSide = "left" | "right" | "top" | "bottom";

export type RoundPhase = "WaitingToStart" | "Active" | "GameOver";

export type RoundSnapshot = {
  phase: RoundPhase;
  firstPlayerId: string | null;
  starterId: string | null;
  winnerPlayerId: string | null;
};

export type WaveSnapshot = {
  isActive: boolean;
  side: WaveSide | null;
  gapAxis: "x" | "y" | null;
  gapStart: number | null;
  gapEnd: number | null;
  progress: number | null;
  frontCoordinate: number | null;
  thickness: number | null;
  secondsUntilSpawn?: number | null;
};

export type CloudSnapshot = {
  isActive: boolean;
  x: number | null;
  y: number | null;
  radius: number | null;
  secondsUntilResolve?: number | null;
};

export type MannaPickupSnapshot = {
  id: string;
  x: number;
  y: number;
  isCollected: boolean;
  collectedByPlayerId: string | null;
};

export type MannaSnapshot = {
  isActive: boolean;
  cycleId: number;
  secondsUntilNextCycle: number;
  requiredPerPlayer: number;
  remainingPickupCount: number;
  pickups: MannaPickupSnapshot[];
};

export type HazardSnapshot = {
  wave: WaveSnapshot;
  cloud: CloudSnapshot;
};

export type GameEventType =
  | "wave_spawned"
  | "cloud_spawned"
  | "cloud_resolved"
  | "player_bumped"
  | "player_died"
  | "player_lost_life"
  | "winner_declared"
  | "manna_cycle_spawned"
  | "manna_collected"
  | "manna_cycle_resolved"
  | "monster_hit"
  | "monster_died";

export type GameEventSnapshot = {
  type: GameEventType;
  playerId?: string | null;
  otherPlayerId?: string | null;
  reason?: string | null;
  x?: number | null;
  y?: number | null;
  impulseX?: number | null;
  impulseY?: number | null;
  side?: WaveSide | null;
  gapAxis?: "x" | "y" | null;
  gapStart?: number | null;
  gapEnd?: number | null;
  progress?: number | null;
  frontCoordinate?: number | null;
  directionX?: number | null;
  directionY?: number | null;
  pickupId?: string | null;
  cycleId?: number | null;
  count?: number | null;
  remainingCount?: number | null;
  isActive?: boolean | null;
  secondsUntilStateChange?: number | null;
};

export type FireballSnapshot = {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  dirX: number;
};

export type MonsterSnapshot = {
  id: string;
  x: number;
  y: number;
  facingDir: number;
  hp: number;
  isPaused: boolean;
};

export type MonsterSpawnDto = {
  id: string;
  x: number;
  y: number;
};

export type SceneryObjectDto = {
  id: string;
  spriteKey: string;
  x: number;
  y: number;
  width: number;
  height: number;
  solid: boolean;
};

export type SceneryLibraryEntry = {
  key: string;
  solid: boolean;
};

export type WorldSnapshot = {
  tick: number;
  serverTimeMs: number;
  players: PlayerSnapshot[];
  round: RoundSnapshot;
  hazard: HazardSnapshot;
  manna?: MannaSnapshot;
  events: GameEventSnapshot[];
  winnerPlayerId: string | null;
  gameOver: boolean;
  fireballs?: FireballSnapshot[];
  monsters?: MonsterSnapshot[];
};

export type JoinRejectedSnapshot = {
  reason: string;
  game_over?: boolean;
  gameOver?: boolean;
};

export type PlayerStatus = "alive" | "dead" | "winner";

export type RoundStatus = "not-started" | "active" | "game-over";

export type RoundControlAction = "start" | "restart";

export type RoundControlState = {
  visible: boolean;
  action: RoundControlAction | null;
  label: string;
  helperText: string;
  tone: "info" | "success" | "danger";
  enabled: boolean;
};

export type PlayerView = {
  id: string;
  name: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  isMoving: boolean;
  isAlive: boolean;
  isWinner: boolean;
  hasCollectedMannaThisCycle: boolean;
  deathReason: string | null;
  color: number;
  outside: boolean;
  status: PlayerStatus;
  statusLabel: string;
  facingDir: number;
  lives: number;
  isInvincible: boolean;
};

export type WaveView = WaveSnapshot;
export type MannaView = MannaSnapshot;

export type WaveSegment = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WaveFoamDot = {
  x: number;
  y: number;
  radius: number;
  segmentIndex: number;
  side: WaveSide;
};

export type RoundView = {
  tick: number;
  serverTimeMs: number;
  round: RoundSnapshot;
  phase: RoundPhase;
  status: RoundStatus;
  statusLabel: string;
  players: PlayerView[];
  alivePlayers: PlayerView[];
  deadPlayers: PlayerView[];
  winner: PlayerView | null;
  hazard: HazardSnapshot;
  wave: WaveView;
  cloud: CloudSnapshot;
  manna: MannaView;
  events: GameEventSnapshot[];
  gameOver: boolean;
  hazardsActive: boolean;
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeDirection(x: number, y: number): { x: number; y: number } {
  const length = Math.hypot(x, y);
  if (length < 0.0001) {
    return { x: 0, y: 0 };
  }

  return { x: x / length, y: y / length };
}

export function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return hash >>> 0;
}

export function isOutOfBounds(player: Pick<PlayerSnapshot, "x" | "y">): boolean {
  return player.x < 0 || player.y < 0 || player.x > WORLD_WIDTH || player.y > WORLD_HEIGHT;
}

export function derivePlayerView(player: PlayerSnapshot, winnerPlayerId: string | null): PlayerView {
  const outside = isOutOfBounds(player);
  const isAlive = player.isAlive && !outside;
  const isWinner = Boolean(player.isWinner || (winnerPlayerId && player.id === winnerPlayerId));
  const status: PlayerStatus = isWinner ? "winner" : (isAlive ? "alive" : "dead");
  const hasCollectedMannaThisCycle = Boolean(player.hasCollectedMannaThisCycle);
  const statusLabel = isWinner
    ? "survived"
    : (isAlive ? (hasCollectedMannaThisCycle ? "fed" : "alive") : "dead");

  return {
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    targetX: player.targetX,
    targetY: player.targetY,
    isMoving: player.isMoving,
    isAlive,
    isWinner,
    hasCollectedMannaThisCycle,
    deathReason: player.deathReason,
    color: resolvePlayerColor(player),
    outside,
    status,
    statusLabel,
    facingDir: player.facingDir ?? 1,
    lives: player.lives ?? 3,
    isInvincible: player.isInvincible ?? false
  };
}

export function resolvePlayerColor(player: Pick<PlayerSnapshot, "id" | "color">): number {
  if (typeof player.color === "number" && Number.isFinite(player.color)) {
    return nearestPaletteColor(player.color >>> 0);
  }

  if (typeof player.color === "string") {
    const parsed = parseColorString(player.color);
    if (parsed != null) {
      return nearestPaletteColor(parsed);
    }
  }

  return PLAYER_COLOR_PALETTE[hashString(player.id) % PLAYER_COLOR_PALETTE.length];
}

export function deriveRoundStatus(phase: RoundPhase): RoundStatus {
  switch (phase) {
    case "WaitingToStart":
      return "not-started";
    case "Active":
      return "active";
    case "GameOver":
      return "game-over";
    default:
      return "not-started";
  }
}

export function formatRoundStatusLabel(status: RoundStatus): string {
  switch (status) {
    case "not-started":
      return "Waiting to start";
    case "active":
      return "Active";
    case "game-over":
      return "Game over";
    default:
      return "Waiting to start";
  }
}

export function deriveRoundControlState(round: RoundSnapshot, selfId: string | null): RoundControlState {
  const controllerId = round.firstPlayerId ?? round.starterId;
  if (!controllerId || selfId !== controllerId) {
    return {
      visible: false,
      action: null,
      label: "",
      helperText: "",
      tone: "info",
      enabled: false
    };
  }

  if (round.phase === "WaitingToStart") {
    return {
      visible: true,
      action: "start",
      label: "START",
      helperText: "You are first at the shore. Start the crossing when ready.",
      tone: "success",
      enabled: true
    };
  }

  if (round.phase === "GameOver") {
    return {
      visible: true,
      action: "restart",
      label: "RESTART",
      helperText: "You are first at the shore. Restart the crossing.",
      tone: "info",
      enabled: true
    };
  }

  return {
    visible: false,
    action: null,
    label: "",
    helperText: "",
    tone: "info",
    enabled: false
  };
}

export function selectWave(snapshot: WorldSnapshot): WaveView {
  return snapshot.hazard.wave;
}

export function selectCloud(snapshot: WorldSnapshot): CloudSnapshot {
  return snapshot.hazard.cloud;
}

export function selectManna(snapshot: WorldSnapshot, previous?: WorldSnapshot): MannaView {
  if (snapshot.manna) {
    return snapshot.manna;
  }

  return synthesizeManna(snapshot, previous);
}

export function computeComicKnockback(impulseX: number, impulseY: number, distance = 240): { x: number; y: number } {
  const length = Math.hypot(impulseX, impulseY);
  if (length < 0.0001) {
    return { x: distance, y: 0 };
  }

  return {
    x: (impulseX / length) * distance,
    y: (impulseY / length) * distance
  };
}

export function computeWaveSegments(wave: WaveView, worldWidth = WORLD_WIDTH, worldHeight = WORLD_HEIGHT): WaveSegment[] {
  if (!wave.isActive || wave.side == null || wave.gapAxis == null || wave.gapStart == null || wave.gapEnd == null) {
    return [];
  }

  const thickness = clamp(wave.thickness ?? 72, 24, 280);
  const front = wave.frontCoordinate ?? computeWaveFront(wave, worldWidth, worldHeight, thickness);

  if (wave.gapAxis === "y") {
    const topHeight = clamp(wave.gapStart, 0, worldHeight);
    const bottomY = clamp(wave.gapEnd, 0, worldHeight);
    const leftX = wave.side === "left" ? front : front - thickness;

    return [
      { x: leftX, y: 0, width: thickness, height: topHeight },
      { x: leftX, y: bottomY, width: thickness, height: Math.max(0, worldHeight - bottomY) }
    ].filter((segment) => segment.height > 0.5);
  }

  const leftWidth = clamp(wave.gapStart, 0, worldWidth);
  const rightX = clamp(wave.gapEnd, 0, worldWidth);
  const topY = wave.side === "top" ? front : front - thickness;

  return [
    { x: 0, y: topY, width: leftWidth, height: thickness },
    { x: rightX, y: topY, width: Math.max(0, worldWidth - rightX), height: thickness }
  ].filter((segment) => segment.width > 0.5);
}

export function computeWaveFoamDots(wave: WaveView, worldWidth = WORLD_WIDTH, worldHeight = WORLD_HEIGHT): WaveFoamDot[] {
  if (!wave.isActive || wave.side == null || wave.gapAxis == null || wave.gapStart == null || wave.gapEnd == null) {
    return [];
  }

  const thickness = clamp(wave.thickness ?? 72, 24, 280);
  const spacing = 18;
  const front = wave.frontCoordinate ?? computeWaveFront(wave, worldWidth, worldHeight, thickness);
  const dots: WaveFoamDot[] = [];

  if (wave.gapAxis === "y") {
    const edgeX = wave.side === "left" ? front : front - thickness;
    const segments: Array<[number, number]> = [
      [0, clamp(wave.gapStart, 0, worldHeight)],
      [clamp(wave.gapEnd, 0, worldHeight), worldHeight]
    ];

    segments.forEach(([start, end], segmentIndex) => {
      const length = Math.max(0, end - start);
      if (length < 1) {
        return;
      }

      const dotCount = Math.max(4, Math.round(length / spacing));
      for (let index = 0; index < dotCount; index += 1) {
        const t = (index + 0.5) / dotCount;
        dots.push({
          x: edgeX,
          y: start + (length * t),
          radius: 1.7 + ((index % 3) * 0.2),
          segmentIndex,
          side: wave.side
        });
      }
    });

    return dots;
  }

  const edgeY = wave.side === "top" ? front : front - thickness;
  const segments: Array<[number, number]> = [
    [0, clamp(wave.gapStart, 0, worldWidth)],
    [clamp(wave.gapEnd, 0, worldWidth), worldWidth]
  ];

  segments.forEach(([start, end], segmentIndex) => {
    const length = Math.max(0, end - start);
    if (length < 1) {
      return;
    }

    const dotCount = Math.max(4, Math.round(length / spacing));
    for (let index = 0; index < dotCount; index += 1) {
      const t = (index + 0.5) / dotCount;
      dots.push({
        x: start + (length * t),
        y: edgeY,
        radius: 1.7 + ((index % 3) * 0.2),
        segmentIndex,
        side: wave.side
      });
    }
  });

  return dots;
}

function computeWaveFront(wave: WaveView, worldWidth: number, worldHeight: number, thickness: number): number {
  const progress = clamp(wave.progress ?? 0, 0, 1);

  switch (wave.side) {
    case "left":
      return -thickness + ((worldWidth + (thickness * 2)) * progress);
    case "right":
      return worldWidth + thickness - ((worldWidth + (thickness * 2)) * progress);
    case "top":
      return -thickness + ((worldHeight + (thickness * 2)) * progress);
    case "bottom":
      return worldHeight + thickness - ((worldHeight + (thickness * 2)) * progress);
    default:
      return 0;
  }
}

export function deriveRoundView(snapshot: WorldSnapshot, previous?: WorldSnapshot): RoundView {
  const winnerPlayerId = snapshot.winnerPlayerId ?? snapshot.round.winnerPlayerId;
  const phase = snapshot.round.phase;
  const status = snapshot.gameOver ? "game-over" : deriveRoundStatus(phase);
  const players = snapshot.players.map((player) => derivePlayerView(player, winnerPlayerId));
  const alivePlayers = players.filter((player) => player.isAlive);
  const deadPlayers = players.filter((player) => !player.isAlive);
  const winner = players.find((player) => player.isWinner) ?? null;
  const events = snapshot.events.length > 0 ? snapshot.events : deriveFallbackEvents(snapshot, previous);

  return {
    tick: snapshot.tick,
    serverTimeMs: snapshot.serverTimeMs,
    round: snapshot.round,
    phase,
    status,
    statusLabel: formatRoundStatusLabel(status),
    players,
    alivePlayers,
    deadPlayers,
    winner,
    hazard: snapshot.hazard,
    wave: selectWave(snapshot),
    cloud: selectCloud(snapshot),
    manna: selectManna(snapshot, previous),
    events,
    gameOver: snapshot.gameOver || status === "game-over",
    hazardsActive: Boolean(snapshot.hazard.wave.isActive || snapshot.hazard.cloud.isActive)
  };
}

export function formatStatusLabel(player: PlayerView): string {
  switch (player.status) {
    case "winner":
      return "survived";
    case "dead":
      return player.deathReason === "wave"
        ? "washed out"
        : (player.deathReason === "boundary"
          ? "lost in the desert"
          : (player.deathReason === "starved"
            ? "starved"
            : (player.deathReason === "darkness" ? "lost in darkness" : "dead")));
    case "alive":
      return player.hasCollectedMannaThisCycle ? "fed" : "alive";
    default:
      return "alive";
  }
}

function deriveFallbackEvents(snapshot: WorldSnapshot, previous?: WorldSnapshot): GameEventSnapshot[] {
  if (!previous) {
    return [];
  }

  const previousPlayers = new Map(previous.players.map((player) => [player.id, player]));
  const events: GameEventSnapshot[] = [];

  for (const player of snapshot.players) {
    const old = previousPlayers.get(player.id);
    if (!old) {
      continue;
    }

    const oldAlive = old.isAlive && !isOutOfBounds(old);
    const newAlive = player.isAlive && !isOutOfBounds(player);
    if (oldAlive && !newAlive) {
      events.push({
        type: "player_died",
        playerId: player.id,
        reason: player.deathReason ?? (player.isAlive ? "boundary" : "dead"),
        x: player.x,
        y: player.y
      });
    }
  }

  const winnerPlayerId = snapshot.winnerPlayerId ?? snapshot.round.winnerPlayerId;
  const previousWinnerPlayerId = previous.winnerPlayerId ?? previous.round.winnerPlayerId;

  if (winnerPlayerId && winnerPlayerId !== previousWinnerPlayerId) {
    const winner = snapshot.players.find((player) => player.id === winnerPlayerId);
    events.push({
      type: "winner_declared",
      playerId: winnerPlayerId,
      x: winner?.x,
      y: winner?.y,
      reason: snapshot.gameOver ? "game_over" : null
    });
  }

  return events;
}

function synthesizeManna(snapshot: WorldSnapshot, previous?: WorldSnapshot): MannaSnapshot {
  const cycleId = Math.max(0, Math.floor(snapshot.serverTimeMs / 15000));
  const seed = hashString([
    cycleId,
    previous?.manna?.cycleId ?? -1,
    snapshot.tick,
    snapshot.serverTimeMs,
    snapshot.players.map((player) => `${player.id}:${player.x.toFixed(1)}:${player.y.toFixed(1)}`).join("|")
  ].join(":"));
  const pickupCount = 5;
  const columns = 4;
  const rows = 4;
  const cellWidth = WORLD_WIDTH / columns;
  const cellHeight = WORLD_HEIGHT / rows;
  const cellOrder = Array.from({ length: columns * rows }, (_, index) => index)
    .sort((left, right) => hashString(`${seed}:${left}`) - hashString(`${seed}:${right}`));
  const pickups = Array.from({ length: pickupCount }, (_, index) => {
    const cellIndex = cellOrder[index % cellOrder.length];
    const column = cellIndex % columns;
    const row = Math.floor(cellIndex / columns);
    const xSeed = hashString(`${seed}:${index}:x`);
    const ySeed = hashString(`${seed}:${index}:y`);
    const x = clamp(
      (column + 0.5) * cellWidth + (((xSeed / 0x100000000) - 0.5) * cellWidth * 0.55),
      72,
      WORLD_WIDTH - 72
    );
    const y = clamp(
      (row + 0.5) * cellHeight + (((ySeed / 0x100000000) - 0.5) * cellHeight * 0.55),
      96,
      WORLD_HEIGHT - 96
    );
    return {
      id: `synthetic-manna-${cycleId}-${index}`,
      x,
      y,
      isCollected: false,
      collectedByPlayerId: null
    };
  });

  return {
    isActive: snapshot.round.phase === "Active" && !snapshot.gameOver,
    cycleId,
    secondsUntilNextCycle: Math.max(0, 15 - ((snapshot.serverTimeMs / 1000) % 15)),
    requiredPerPlayer: Math.max(1, Math.ceil((pickupCount * 0.5) / Math.max(1, snapshot.players.length || 1))),
    remainingPickupCount: previous?.manna?.remainingPickupCount ?? pickups.length,
    pickups
  };
}

function nearestPaletteColor(color: number): number {
  const source = toRgb(color);
  let best = PLAYER_COLOR_PALETTE[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of PLAYER_COLOR_PALETTE) {
    const target = toRgb(candidate);
    const distance = colorDistance(source, target);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

function toRgb(color: number): { r: number; g: number; b: number } {
  return {
    r: (color >> 16) & 0xff,
    g: (color >> 8) & 0xff,
    b: color & 0xff
  };
}

function colorDistance(left: { r: number; g: number; b: number }, right: { r: number; g: number; b: number }): number {
  const dr = left.r - right.r;
  const dg = left.g - right.g;
  const db = left.b - right.b;
  return (dr * dr) + (dg * dg) + (db * db);
}

function parseColorString(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return Number.parseInt(normalized, 16) >>> 0;
  }

  if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
    const expanded = normalized
      .split("")
      .map((character) => `${character}${character}`)
      .join("");
    return Number.parseInt(expanded, 16) >>> 0;
  }

  if (/^0x[0-9a-fA-F]{6}$/.test(trimmed)) {
    return Number.parseInt(trimmed.slice(2), 16) >>> 0;
  }

  return null;
}
