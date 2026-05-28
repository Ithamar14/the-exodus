namespace Server.Game;

public sealed class JoinRequest
{
    public string Name { get; set; } = string.Empty;
}

public sealed class MoveTargetRequest
{
    public float X { get; set; }
    public float Y { get; set; }
}

public sealed class MoveInputRequest
{
    public int DirX { get; set; }
    public bool Jump { get; set; }
}

public sealed class StartRoundRequest
{
}

public sealed class RestartRoundRequest
{
}

public sealed class EmoteRequest
{
    public string Code { get; set; } = string.Empty;
}

public sealed record JoinRejected(string Reason);
public sealed record Joined(string SelfId);
public sealed record RoundActionRejected(string Action, string Reason);
public sealed record RoundStarted(string StarterId);
public sealed record RoundRestarted(string StarterId);
public sealed record PlayerEmoted(string PlayerId, string Code);

public sealed record WaveSnapshot(
    bool IsActive,
    string? Side,
    string? GapAxis,
    float? GapStart,
    float? GapEnd,
    float? Progress,
    float? FrontCoordinate,
    float? Thickness,
    float? SecondsUntilSpawn);

public sealed record CloudSnapshot(
    bool IsActive,
    float? X,
    float? Y,
    float? Radius,
    float? SecondsUntilResolve);

public sealed record HazardSnapshot(WaveSnapshot Wave, CloudSnapshot Cloud);

public sealed record MannaPickupSnapshot(
    string Id,
    float X,
    float Y,
    bool IsCollected,
    string? CollectedByPlayerId);

public sealed record MannaSnapshot(
    bool IsActive,
    long CycleId,
    float SecondsUntilNextCycle,
    float SecondsUntilBlink,
    float SecondsUntilDisappear,
    bool IsBlinking,
    int RequiredPerPlayer,
    int RemainingPickupCount,
    IReadOnlyList<MannaPickupSnapshot> Pickups);

public sealed record RoundSnapshot(
    string Phase,
    string? FirstPlayerId,
    string? StarterId,
    string? WinnerPlayerId);

public sealed record GameEventSnapshot(
    string Type,
    string? PlayerId = null,
    string? OtherPlayerId = null,
    string? Reason = null,
    float? X = null,
    float? Y = null,
    float? ImpulseX = null,
    float? ImpulseY = null,
    string? Side = null,
    string? GapAxis = null,
    float? GapStart = null,
    float? GapEnd = null,
    float? Progress = null,
    float? FrontCoordinate = null,
    float? DirectionX = null,
    float? DirectionY = null,
    float? Strength = null,
    string? PickupId = null,
    long? CycleId = null,
    int? Count = null,
    int? RemainingCount = null,
    bool? IsActive = null,
    float? SecondsUntilStateChange = null);

public sealed record FireballSnapshot(string Id, string OwnerId, float X, float Y, int DirX);

public sealed record TunableFieldDto(
    string Key,
    string Label,
    string Category,
    float Min,
    float Max,
    float Step,
    float Value);

public sealed record RulesSchemaPayload(IReadOnlyList<TunableFieldDto> Fields);

public sealed class UpdateRulesRequest
{
    public Dictionary<string, float> Updates { get; set; } = new();
}

public sealed record RulesUpdateRejected(string Reason);

public sealed record PlatformDto(float Cx, float SurfaceY, float Width);
public sealed record PlatformsUpdatedPayload(IReadOnlyList<PlatformDto> Platforms);
public sealed record MapListPayload(IReadOnlyList<string> Names);
public sealed record MapActionRejected(string Action, string Reason);

public sealed class SaveMapRequest
{
    public string Name { get; set; } = string.Empty;
    public List<PlatformDto> Platforms { get; set; } = new();
}

public sealed class ApplyPlatformsRequest
{
    public List<PlatformDto> Platforms { get; set; } = new();
}

public sealed class LoadMapRequest
{
    public string Name { get; set; } = string.Empty;
}

public sealed record PlayerSnapshot(
    string Id,
    string Name,
    float X,
    float Y,
    float TargetX,
    float TargetY,
    string Color,
    bool IsMoving,
    bool IsAlive,
    bool IsWinner,
    bool HasCollectedMannaThisCycle,
    string? DeathReason,
    int FacingDir = 1,
    int Lives = 3,
    bool IsInvincible = false);

public sealed record WorldSnapshot(
    long Tick,
    long ServerTimeMs,
    IReadOnlyList<PlayerSnapshot> Players,
    RoundSnapshot Round,
    HazardSnapshot Hazard,
    MannaSnapshot Manna,
    IReadOnlyList<GameEventSnapshot> Events,
    string? WinnerPlayerId,
    bool GameOver,
    IReadOnlyList<FireballSnapshot> Fireballs);
