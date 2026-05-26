namespace Server.Game;

public sealed record GameRules
{
    public static GameRules Default { get; } = new();

    public float TickSeconds { get; init; } = 0.05f;
    public float MoveSpeed { get; init; } = 180f;
    public float PlayerCollisionRadius { get; init; } = 30f;
    public float CollisionBumpDistance { get; init; } = 18f;
    public float WaveCooldownSeconds { get; init; } = 10f;
    public float WaveTravelSeconds { get; init; } = 4f;
    public float WaveThickness { get; init; } = 72f;
    public float WaveGapFraction { get; init; } = 0.18f;
    public float WaveGapCenterMinFraction { get; init; } = 0.2f;
    public float WaveGapCenterMaxFraction { get; init; } = 0.8f;
    public float CloudCooldownSeconds { get; init; } = 7f;
    public float CloudActiveSeconds { get; init; } = 9f;
    public float HazardTransitionDelaySeconds { get; init; } = 3f;
    public float CloudRadius { get; init; } = 140f;
    public float CloudCenterMinFractionX { get; init; } = 0.2f;
    public float CloudCenterMaxFractionX { get; init; } = 0.8f;
    public float CloudCenterMinFractionY { get; init; } = 0.22f;
    public float CloudCenterMaxFractionY { get; init; } = 0.78f;
    public float SpawnMarginFraction { get; init; } = 0.12f;
    public int MannaPickupCount { get; init; } = 5;
    public float MannaCollectRadius { get; init; } = 28f;
    public float MannaSpawnMarginFraction { get; init; } = 0.1f;
    public float MannaRespawnDelaySeconds { get; init; } = 3f;
}
