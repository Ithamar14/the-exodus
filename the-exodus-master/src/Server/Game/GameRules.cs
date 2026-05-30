namespace Server.Game;

public sealed record GameRules
{
    public static GameRules Default { get; } = new();

    // ── Core ──────────────────────────────────────────────────────────────
    [Tunable("Tick Rate (s)", "Core", 0.016f, 0.2f, 0.005f)]
    public float TickSeconds { get; init; } = 0.05f;

    [Tunable("Hazard Transition Delay (s)", "Core", 0f, 15f, 0.5f)]
    public float HazardTransitionDelaySeconds { get; init; } = 3f;

    [Tunable("Spawn Margin", "Core", 0.05f, 0.4f, 0.01f)]
    public float SpawnMarginFraction { get; init; } = 0.12f;

    // ── Players ───────────────────────────────────────────────────────────
    [Tunable("Lives Per Player", "Players", 1f, 10f, 1f)]
    public int LivesPerPlayer { get; init; } = 3;

    [Tunable("Invincibility Duration (s)", "Players", 0f, 5f, 0.1f)]
    public float InvincibilitySeconds { get; init; } = 1.0f;

    [Tunable("Player Size", "Players", 0.25f, 3.0f, 0.05f)]
    public float PlayerSize { get; init; } = 1.0f;

    // ── Movement ──────────────────────────────────────────────────────────
    [Tunable("Walk Speed — physics (px/s)", "Movement", 50f, 800f, 10f)]
    public float WalkSpeed { get; init; } = 220f;

    [Tunable("Move Speed — target (px/s)", "Movement", 50f, 800f, 10f)]
    public float MoveSpeed { get; init; } = 180f;

    [Tunable("Gravity (px/s²)", "Movement", 100f, 3000f, 50f)]
    public float Gravity { get; init; } = 900f;

    [Tunable("Jump Velocity (px/s)", "Movement", -1500f, -100f, 10f)]
    public float JumpVelocity { get; init; } = -560f;

    // ── Collision ─────────────────────────────────────────────────────────
    [Tunable("Collision Radius (px)", "Collision", 5f, 100f, 1f)]
    public float PlayerCollisionRadius { get; init; } = 30f;

    [Tunable("Bump Distance (px)", "Collision", 1f, 80f, 1f)]
    public float CollisionBumpDistance { get; init; } = 18f;

    [Tunable("Launch Distance (px)", "Collision", 50f, 600f, 5f)]
    public float CollisionLaunchDistance { get; init; } = 224f;

    // ── Fireball ──────────────────────────────────────────────────────────
    [Tunable("Fireball Speed (px/s)", "Fireball", 100f, 2000f, 10f)]
    public float FireballSpeed { get; init; } = 680f;

    [Tunable("Fireball Hit Radius (px)", "Fireball", 5f, 100f, 1f)]
    public float FireballHitRadius { get; init; } = 20f;

    // ── Wave ──────────────────────────────────────────────────────────────
    [Tunable("Wave Cooldown (s)", "Wave", 1f, 60f, 0.5f)]
    public float WaveCooldownSeconds { get; init; } = 10f;

    [Tunable("Wave Travel Duration (s)", "Wave", 0.5f, 20f, 0.5f)]
    public float WaveTravelSeconds { get; init; } = 4f;

    [Tunable("Wave Thickness (px)", "Wave", 10f, 300f, 5f)]
    public float WaveThickness { get; init; } = 72f;

    [Tunable("Wave Gap Fraction", "Wave", 0.05f, 0.8f, 0.01f)]
    public float WaveGapFraction { get; init; } = 0.18f;

    [Tunable("Wave Gap Min Center", "Wave", 0f, 0.49f, 0.01f)]
    public float WaveGapCenterMinFraction { get; init; } = 0.2f;

    [Tunable("Wave Gap Max Center", "Wave", 0.51f, 1f, 0.01f)]
    public float WaveGapCenterMaxFraction { get; init; } = 0.8f;

    // ── Cloud ─────────────────────────────────────────────────────────────
    [Tunable("Cloud Cooldown (s)", "Cloud", 1f, 60f, 0.5f)]
    public float CloudCooldownSeconds { get; init; } = 7f;

    [Tunable("Cloud Active Duration (s)", "Cloud", 1f, 30f, 0.5f)]
    public float CloudActiveSeconds { get; init; } = 9f;

    [Tunable("Cloud Radius (px)", "Cloud", 30f, 400f, 5f)]
    public float CloudRadius { get; init; } = 140f;

    [Tunable("Cloud Min X", "Cloud", 0f, 0.49f, 0.01f)]
    public float CloudCenterMinFractionX { get; init; } = 0.2f;

    [Tunable("Cloud Max X", "Cloud", 0.51f, 1f, 0.01f)]
    public float CloudCenterMaxFractionX { get; init; } = 0.8f;

    [Tunable("Cloud Min Y", "Cloud", 0f, 0.49f, 0.01f)]
    public float CloudCenterMinFractionY { get; init; } = 0.22f;

    [Tunable("Cloud Max Y", "Cloud", 0.51f, 1f, 0.01f)]
    public float CloudCenterMaxFractionY { get; init; } = 0.78f;

    // ── World ─────────────────────────────────────────────────────────────
    [Tunable("Width Multiplier", "World", 1f, 10f, 0.5f)]
    public float WorldWidthMultiplier { get; init; } = 3f;

    [Tunable("Height Multiplier", "World", 1f, 10f, 0.5f)]
    public float WorldHeightMultiplier { get; init; } = 3f;

    // ── Manna ─────────────────────────────────────────────────────────────
    [Tunable("Pickup Count", "Manna", 1f, 20f, 1f)]
    public int MannaPickupCount { get; init; } = 5;

    [Tunable("Collect Radius (px)", "Manna", 5f, 80f, 1f)]
    public float MannaCollectRadius { get; init; } = 28f;

    [Tunable("Spawn Margin", "Manna", 0.01f, 0.4f, 0.01f)]
    public float MannaSpawnMarginFraction { get; init; } = 0.1f;

    [Tunable("Respawn Delay (s)", "Manna", 0f, 20f, 0.5f)]
    public float MannaRespawnDelaySeconds { get; init; } = 3f;

    [Tunable("Blink Start (s)", "Manna", 1f, 30f, 0.5f)]
    public float MannaBlinkStartSeconds { get; init; } = 5f;

    [Tunable("Lifetime (s)", "Manna", 2f, 60f, 0.5f)]
    public float MannaLifetimeSeconds { get; init; } = 10f;

    [Tunable("Phase Lead (s)", "Manna", 0f, 10f, 0.5f)]
    public float MannaPhaseLeadSeconds { get; init; } = 1f;

    [Tunable("Required Per Player", "Manna", 1f, 5f, 1f)]
    public int RequiredMannaPerPlayer { get; init; } = 1;
}
