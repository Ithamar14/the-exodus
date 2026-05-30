using System.Numerics;
using System.Reflection;
using System.Text.Json;

namespace Server.Game;

public sealed class GameWorld
{
    public const int MaxPlayers = 6;
    public const float WorldWidthBase  = 1024f;
    public const float WorldHeightBase = 768f;

    public float WorldWidth  => WorldWidthBase  * _rules.WorldWidthMultiplier;
    public float WorldHeight => WorldHeightBase * _rules.WorldHeightMultiplier;
    public float GroundY         => WorldHeight - 88f;
    public float GroundSurfaceY  => WorldHeight - 61f;

    private float PlayerHalfHeight  => 27f * _rules.PlayerSize;
    private float PlayerBodyHalfWidth => 10f * _rules.PlayerSize;
    private float PlayerBodyHeight    => 54f * _rules.PlayerSize;
    private float EffectiveGroundY => GroundSurfaceY;
    private float EffectivePlayerCollisionRadius => _rules.PlayerCollisionRadius * _rules.PlayerSize;

    // (centerX, surfaceY, width) — scaled proportionally to the effective world size.
    // Fractions from the original 1024×768 layout, multiplied by current WorldWidth/Height.
    public (float CenterX, float SurfaceY, float Width)[] DefaultPlatforms =>
    [
        (WorldWidth * 0.146f, WorldHeight * 0.778f, WorldWidth * 0.195f),   // left low
        (WorldWidth * 0.500f, WorldHeight * 0.765f, WorldWidth * 0.176f),   // center low
        (WorldWidth * 0.830f, WorldHeight * 0.778f, WorldWidth * 0.195f),   // right low
        (WorldWidth * 0.273f, WorldHeight * 0.583f, WorldWidth * 0.137f),   // left mid
        (WorldWidth * 0.713f, WorldHeight * 0.596f, WorldWidth * 0.137f),   // right mid
        (WorldWidth * 0.500f, WorldHeight * 0.439f, WorldWidth * 0.117f),   // top center
    ];
    private (float CenterX, float SurfaceY, float Width)[] _platforms = [];
    private SceneryObjectDto[] _sceneryObjects = [];
    private static readonly HashSet<string> AllowedEmotes = new(StringComparer.OrdinalIgnoreCase)
    {
        "dove",
        "trumpet",
        "bread",
        "laugh",
        "wave"
    };
    private static readonly string[] PlayerColorPalette =
    [
        "#2a6fdb",
        "#e63946",
        "#2a9d8f",
        "#8d6cab",
        "#f4a261",
        "#29d1c5"
    ];

    public enum RoundPhase
    {
        WaitingToStart,
        Active,
        GameOver
    }

    private readonly object _sync = new();
    private readonly Dictionary<string, PlayerState> _playersByConnection = new();
    private readonly List<string> _availablePlayerColors = new();
    private readonly IGameRandom _random;
    private GameRules _rules;

    private long _tick;
    private RoundPhase _phase = RoundPhase.WaitingToStart;
    private string? _starterPlayerId;
    private long _nextJoinOrder;
    private float _waveCooldownRemaining;
    private WaveState? _wave;
    private HazardEdge? _nextWaveSide;
    private float _cloudCooldownRemaining;
    private CloudState? _cloud;
    private HazardType _nextHazard;
    private MannaCycleState? _mannaCycle;
    private float _mannaSpawnDelayRemaining;
    private long _nextMannaCycleId = 1;
    private string? _winnerPlayerId;
    private bool _winnerCheckEnabled;
    private readonly List<FireballState> _fireballs = [];
    private long _nextFireballId;

    private readonly List<MonsterSpawn> _monsterSpawns = [];
    private readonly List<MonsterState> _monsters = [];
    private long _nextMonsterId = 1;

    private const float MonsterHalfHeight = 45f;  // head(60)+legs(30)=90 total, half=45
    private const float MonsterHalfWidth  = 30f;  // head is 60px wide, half=30
    private const float MonsterWalkSpeed     = 80f;
    private const float MonsterWalkMin       = 1.0f;
    private const float MonsterWalkMax       = 4.0f;
    private const float MonsterPauseMin      = 0.5f;
    private const float MonsterPauseMax      = 2.2f;
    private const float MonsterContactRadius = 38f;
    private float EffectiveMonsterGroundY => GroundSurfaceY;

    private readonly string _mapsDirectory;

    public GameWorld()
        : this(new SystemGameRandom(), GameRules.Default, null)
    {
    }

    public GameWorld(IGameRandom random, GameRules? rules = null, string? mapsDirectory = null)
    {
        _random = random;
        _rules = rules ?? GameRules.Default;
        _mapsDirectory = mapsDirectory ?? "maps";
        _platforms = DefaultPlatforms;
        ResetAvailablePlayerColors();
        ResetRoundMechanics();
    }

    public (bool Success, string? PlayerId, string? Reason) TryAddPlayer(string connectionId, string requestedName)
    {
        var name = (requestedName ?? string.Empty).Trim();
        if (name.Length is < 1 or > 20)
        {
            return (false, null, "invalid_name");
        }

        lock (_sync)
        {
            if (_playersByConnection.ContainsKey(connectionId))
            {
                return (false, null, "already_joined");
            }

            if (_playersByConnection.Count >= MaxPlayers)
            {
                return (false, null, "room_full");
            }

            var spawn = RandomSpawn();
            var id = Guid.NewGuid().ToString("N");
            var color = TakePlayerColor(connectionId, _nextJoinOrder);
            var state = new PlayerState(id, connectionId, name, color, spawn.X, spawn.Y, spawn.X, spawn.Y, _nextJoinOrder++);
            _playersByConnection[connectionId] = state;
            if (_starterPlayerId is null)
            {
                _starterPlayerId = id;
            }

            return (true, id, null);
        }
    }

    public void RemovePlayer(string connectionId)
    {
        lock (_sync)
        {
            if (!_playersByConnection.TryGetValue(connectionId, out var player))
            {
                return;
            }

            _playersByConnection.Remove(connectionId);
            _availablePlayerColors.Add(player.Color);

            if (_starterPlayerId == player.Id)
            {
                _starterPlayerId = _playersByConnection.Values
                    .OrderBy(p => p.JoinOrder)
                    .Select(p => p.Id)
                    .FirstOrDefault();
            }

            if (_playersByConnection.Count == 0)
            {
                ResetWorld();
            }
        }
    }

    public bool TrySetTarget(string connectionId, float x, float y)
    {
        lock (_sync)
        {
            if (_phase == RoundPhase.GameOver)
            {
                return false;
            }

            if (!_playersByConnection.TryGetValue(connectionId, out var player) || !player.IsAlive)
            {
                return false;
            }

            player.TargetX = Math.Clamp(x, 0f, WorldWidth);
            player.TargetY = Math.Clamp(y, 0f, WorldHeight);
            return true;
        }
    }

    public bool TrySetInput(string connectionId, int dirX, bool jump)
    {
        lock (_sync)
        {
            if (_phase == RoundPhase.GameOver)
            {
                return false;
            }

            if (!_playersByConnection.TryGetValue(connectionId, out var player) || !player.IsAlive)
            {
                return false;
            }

            player.InputDirX = Math.Clamp(dirX, -1, 1);
            if (jump)
            {
                player.JumpRequested = true;
            }

            player.UsePhysics = true;
            return true;
        }
    }

    public void TryShootFireball(string connectionId)
    {
        lock (_sync)
        {
            if (!_playersByConnection.TryGetValue(connectionId, out var player) || !player.IsAlive) return;
            _fireballs.Add(new FireballState(
                $"fb-{_nextFireballId++}",
                player.Id,
                player.X + 24f * player.FacingDir,
                player.Y - PlayerHalfHeight - 9f,
                player.FacingDir));
        }
    }

    public (bool Success, string? StarterId, string? Reason) TryStartRound(string connectionId)
    {
        lock (_sync)
        {
            if (_phase != RoundPhase.WaitingToStart)
            {
                return (false, null, "not_waiting");
            }

            if (_starterPlayerId is null)
            {
                return (false, null, "no_players");
            }

            if (!TryGetPlayerByConnection(connectionId, out var player) || player.Id != _starterPlayerId)
            {
                return (false, null, "not_authorized");
            }

            _phase = RoundPhase.Active;
            StartRoundSystems();
            _winnerCheckEnabled = _playersByConnection.Count >= 2;
            return (true, _starterPlayerId, null);
        }
    }

    public (bool Success, string? StarterId, string? Reason) TryRestartRound(string connectionId)
    {
        lock (_sync)
        {
            if (_phase != RoundPhase.GameOver)
            {
                return (false, null, "not_game_over");
            }

            if (_starterPlayerId is null)
            {
                return (false, null, "no_players");
            }

            if (!TryGetPlayerByConnection(connectionId, out var player) || player.Id != _starterPlayerId)
            {
                return (false, null, "not_authorized");
            }

            ResetRoundState();
            return (true, _starterPlayerId, null);
        }
    }

    public (bool Success, string? PlayerId, string? Code) TryEmote(string connectionId, string requestedCode)
    {
        var code = NormalizeEmoteCode(requestedCode);
        if (code is null)
        {
            return (false, null, null);
        }

        lock (_sync)
        {
            if (!TryGetPlayerByConnection(connectionId, out var player))
            {
                return (false, null, null);
            }

            return (true, player.Id, code);
        }
    }

    public WorldSnapshot TickAndSnapshot(float deltaSeconds)
    {
        lock (_sync)
        {
            var events = new List<GameEventSnapshot>();
            _tick += 1;

            MovePlayers(deltaSeconds);
            TickInvincibility(deltaSeconds);
            TickFireballs(deltaSeconds, events);

            if (_phase == RoundPhase.Active)
            {
                TickMonsters(deltaSeconds, events);
                AdvanceWave(deltaSeconds, events);
                AdvanceCloud(deltaSeconds, events);
                ResolveCollisions(events);
                ResolveMonsterPlayerContact(events);
                ResolveWaveDeaths(events);
                ResolveOutOfBoundsDeaths(events);
                AdvanceManna(deltaSeconds, events);
                ResolveWinner(events);
            }

            return BuildSnapshot(events);
        }
    }

    public RoundPhase Phase
    {
        get
        {
            lock (_sync)
            {
                return _phase;
            }
        }
    }

    private void StartRoundSystems()
    {
        _winnerPlayerId = null;
        _wave = null;
        _cloud = null;
        PickNextHazard(applyTransitionDelay: false);
        _mannaCycle = null;
        _mannaSpawnDelayRemaining = _nextHazard == HazardType.Manna ? _mannaSpawnDelayRemaining : 0f;

        foreach (var player in _playersByConnection.Values)
        {
            player.IsAlive = true;
            player.Lives = _rules.LivesPerPlayer;
            player.InvincibilityRemaining = 0f;
            player.IsWinner = false;
            player.DeathReason = null;
            player.IsMoving = false;
            player.HasCollectedMannaThisCycle = false;
            player.VelocityX = 0f;
            player.VelocityY = 0f;
            player.IsGrounded = false;
            player.JumpRequested = false;
        }

        SpawnMonstersFromSpawns();
    }

    private void SpawnMonstersFromSpawns()
    {
        _monsters.Clear();
        foreach (var spawn in _monsterSpawns)
        {
            var monster = new MonsterState($"m-{_nextMonsterId++}", spawn.X, spawn.Y);
            monster.FacingDir = _random.NextInt(2) == 0 ? 1 : -1;
            monster.StateTimer = Lerp(0f, MonsterWalkMax, _random.NextSingle());
            _monsters.Add(monster);
        }
    }

    private void AdvanceWave(float deltaSeconds, ICollection<GameEventSnapshot> events)
    {
        if (_cloud is not null || _mannaCycle is not null)
        {
            return;
        }

        if (_wave is null)
        {
            if (_nextHazard != HazardType.Wave)
            {
                return;
            }

            _waveCooldownRemaining -= deltaSeconds;
            if (_waveCooldownRemaining > 0f)
            {
                return;
            }

            var side = _nextWaveSide ?? (HazardEdge)_random.NextInt(4);
            _wave = CreateWave(side);
            _waveCooldownRemaining = _rules.WaveCooldownSeconds;
            events.Add(new GameEventSnapshot(
                "wave_spawned",
                Side: _wave.Side.ToString().ToLowerInvariant(),
                GapAxis: _wave.GapAxis,
                GapStart: _wave.GapStart,
                GapEnd: _wave.GapEnd,
                Progress: _wave.Progress,
                FrontCoordinate: _wave.FrontCoordinate));
            return;
        }

        _wave.PreviousFrontCoordinate = _wave.FrontCoordinate;
        _wave.Progress = Math.Min(1f, _wave.Progress + deltaSeconds / _rules.WaveTravelSeconds);
        _wave.FrontCoordinate = _wave.StartCoordinate + ((_wave.EndCoordinate - _wave.StartCoordinate) * _wave.Progress);

        if (_wave.Progress >= 1f)
        {
            _wave = null;
            PickNextHazard(applyTransitionDelay: true);
        }
    }

    private void AdvanceCloud(float deltaSeconds, ICollection<GameEventSnapshot> events)
    {
        if (_wave is not null || _mannaCycle is not null)
        {
            return;
        }

        if (_cloud is null)
        {
            if (_nextHazard != HazardType.Cloud)
            {
                return;
            }

            _cloudCooldownRemaining -= deltaSeconds;
            if (_cloudCooldownRemaining > 0f)
            {
                return;
            }

            _cloud = CreateCloud();
            events.Add(new GameEventSnapshot(
                "cloud_spawned",
                X: _cloud.X,
                Y: _cloud.Y,
                Count: (int)MathF.Round(_cloud.Radius),
                IsActive: true,
                SecondsUntilStateChange: _cloud.RemainingSeconds));
            return;
        }

        _cloud.RemainingSeconds -= deltaSeconds;
        if (_cloud.RemainingSeconds > 0f)
        {
            return;
        }

        ResolveCloudCycle(events);
    }

    private void MovePlayers(float deltaSeconds)
    {
        foreach (var player in _playersByConnection.Values)
        {
            if (!player.IsAlive)
            {
                continue;
            }

            if (player.UsePhysics)
            {
                MovePlayerPhysics(player, deltaSeconds);
            }
            else
            {
                MovePlayerTarget(player, deltaSeconds);
            }
        }
    }

    private void TickInvincibility(float deltaSeconds)
    {
        foreach (var player in _playersByConnection.Values)
        {
            if (player.InvincibilityRemaining > 0f)
                player.InvincibilityRemaining = MathF.Max(0f, player.InvincibilityRemaining - deltaSeconds);
        }
    }

    private void TickFireballs(float deltaSeconds, ICollection<GameEventSnapshot> events)
    {
        var speed = _rules.FireballSpeed;
        var hitRadius = _rules.FireballHitRadius;
        for (var i = _fireballs.Count - 1; i >= 0; i--)
        {
            var fb = _fireballs[i];
            fb.X += fb.DirX * speed * deltaSeconds;
            if (fb.X < -30f || fb.X > WorldWidth + 30f)
            {
                _fireballs.RemoveAt(i);
                continue;
            }

            var hit = _playersByConnection.Values.FirstOrDefault(p =>
                p.IsAlive &&
                p.InvincibilityRemaining <= 0f &&
                p.Id != fb.OwnerId &&
                IsWithinRadius(fb.X, fb.Y, p.X, p.Y - PlayerHalfHeight, hitRadius));

            if (hit is not null)
            {
                Kill(hit, "fireball", events);
                _fireballs.RemoveAt(i);
                continue;
            }

            var monsterHit = _monsters.FirstOrDefault(m =>
                m.Hp > 0 &&
                m.InvincibilityRemaining <= 0f &&
                IsWithinRadius(fb.X, fb.Y, m.X, m.Y, hitRadius));

            if (monsterHit is not null)
            {
                DamageMonster(monsterHit, events);
                _fireballs.RemoveAt(i);
            }
        }
    }

    private void MovePlayerPhysics(PlayerState player, float deltaSeconds)
    {
        player.VelocityX = player.InputDirX * _rules.WalkSpeed;
        if (player.InputDirX != 0) player.FacingDir = player.InputDirX;
        player.VelocityY += _rules.Gravity * deltaSeconds;

        if (player.JumpRequested && player.IsGrounded)
        {
            player.VelocityY = _rules.JumpVelocity;
            player.IsGrounded = false;
        }

        player.JumpRequested = false;

        var prevFeetY = player.Y;
        player.X += player.VelocityX * deltaSeconds;
        player.Y += player.VelocityY * deltaSeconds;
        player.X = Math.Clamp(player.X, 0f, WorldWidth);
        var newFeetY = player.Y;

        if (player.Y >= EffectiveGroundY)
        {
            player.Y = EffectiveGroundY;
            player.VelocityY = 0f;
            player.IsGrounded = true;
        }
        else
        {
            player.IsGrounded = false;

            // One-way platform landing: only triggers when falling onto the top surface
            if (player.VelocityY >= 0f)
            {
                foreach (var (cx, surfaceY, width) in _platforms)
                {
                    if (prevFeetY > surfaceY || newFeetY < surfaceY) continue;
                    if (player.X < cx - width * 0.5f || player.X > cx + width * 0.5f) continue;
                    player.Y = surfaceY;
                    player.VelocityY = 0f;
                    player.IsGrounded = true;
                    break;
                }
            }
        }

        player.IsMoving = Math.Abs(player.VelocityX) > 0.1f || !player.IsGrounded;
        ResolveSceneryCollisionPlayer(player);
    }

    private void MovePlayerTarget(PlayerState player, float deltaSeconds)
    {
        var current = new Vector2(player.X, player.Y);
        var target = new Vector2(player.TargetX, player.TargetY);
        var toTarget = target - current;
        var distance = toTarget.Length();
        var moved = false;

        if (distance > 0.001f)
        {
            var maxStep = _rules.MoveSpeed * deltaSeconds;
            var move = distance <= maxStep ? toTarget : Vector2.Normalize(toTarget) * maxStep;
            current += move;
            moved = move.LengthSquared() > 0f;
        }

        player.X = current.X;
        player.Y = current.Y;
        player.IsMoving = moved;
    }

    private void ResolveCollisions(ICollection<GameEventSnapshot> events)
    {
        var alivePlayers = _playersByConnection.Values
            .Where(p => p.IsAlive)
            .OrderBy(p => p.JoinOrder)
            .ToArray();

        for (var i = 0; i < alivePlayers.Length; i++)
        {
            for (var j = i + 1; j < alivePlayers.Length; j++)
            {
                var a = alivePlayers[i];
                var b = alivePlayers[j];
                var delta = new Vector2(b.X - a.X, b.Y - a.Y);
                var distance = delta.Length();
                if (distance > EffectivePlayerCollisionRadius || distance < 0.001f)
                {
                    continue;
                }

                var normal = Vector2.Normalize(delta);
                var overlap = Math.Max(0f, EffectivePlayerCollisionRadius - distance);
                var separation = Math.Max(overlap + _rules.CollisionBumpDistance, _rules.CollisionLaunchDistance);
                var impulse = normal * (separation * 0.5f);
                a.X -= impulse.X;
                a.Y -= impulse.Y;
                b.X += impulse.X;
                b.Y += impulse.Y;
                a.TargetX = a.X;
                a.TargetY = a.Y;
                b.TargetX = b.X;
                b.TargetY = b.Y;
                a.IsMoving = true;
                b.IsMoving = true;

                events.Add(new GameEventSnapshot(
                    "player_bumped",
                    PlayerId: a.Id,
                    OtherPlayerId: b.Id,
                    ImpulseX: impulse.X,
                    ImpulseY: impulse.Y,
                    X: (a.X + b.X) * 0.5f,
                    Y: (a.Y + b.Y) * 0.5f));
            }
        }
    }

    private void ResolveWaveDeaths(ICollection<GameEventSnapshot> events)
    {
        if (_wave is null)
        {
            return;
        }

        foreach (var player in _playersByConnection.Values.OrderBy(p => p.JoinOrder))
        {
            if (!player.IsAlive)
            {
                continue;
            }

            if (!DidWaveHitPlayer(player, _wave))
            {
                continue;
            }

            Kill(player, "wave", events);
        }
    }

    private void ResolveOutOfBoundsDeaths(ICollection<GameEventSnapshot> events)
    {
        foreach (var player in _playersByConnection.Values.OrderBy(p => p.JoinOrder))
        {
            if (!player.IsAlive)
            {
                continue;
            }

            if (player.X >= 0f && player.X <= WorldWidth && player.Y >= 0f && player.Y <= WorldHeight)
            {
                continue;
            }

            Kill(player, "boundary", events);
        }
    }

    private void AdvanceManna(float deltaSeconds, ICollection<GameEventSnapshot> events)
    {
        if (_wave is not null || _cloud is not null)
        {
            return;
        }

        if (_mannaCycle is null)
        {
            if (_nextHazard != HazardType.Manna)
            {
                return;
            }

            _mannaSpawnDelayRemaining -= deltaSeconds;
            if (_mannaSpawnDelayRemaining > 0f)
            {
                return;
            }

            SpawnMannaCycle(events);
            return;
        }

        _mannaCycle.AgeSeconds += deltaSeconds;

        if (!_mannaCycle.BlinkStarted && _mannaCycle.AgeSeconds >= _rules.MannaBlinkStartSeconds)
        {
            _mannaCycle.BlinkStarted = true;
            events.Add(new GameEventSnapshot(
                "manna_cycle_blink_started",
                CycleId: _mannaCycle.CycleId,
                RemainingCount: _mannaCycle.RemainingPickupCount,
                IsActive: true,
                SecondsUntilStateChange: Math.Max(0f, _rules.MannaLifetimeSeconds - _mannaCycle.AgeSeconds)));
        }

        var alivePlayers = _playersByConnection.Values
            .Where(p => p.IsAlive)
            .OrderBy(p => p.JoinOrder)
            .ToArray();

        if (alivePlayers.Length > 0)
        {
            foreach (var pickup in _mannaCycle.Pickups)
            {
                if (pickup.IsCollected)
                {
                    continue;
                }

                foreach (var player in alivePlayers)
                {
                    if (!IsWithinRadius(player.X, player.Y, pickup.X, pickup.Y, _rules.MannaCollectRadius))
                    {
                        continue;
                    }

                    pickup.IsCollected = true;
                    pickup.CollectedByPlayerId = player.Id;
                    player.HasCollectedMannaThisCycle = true;
                    player.Lives = Math.Min(_rules.LivesPerPlayer, player.Lives + 1);
                    _mannaCycle.RemainingPickupCount -= 1;
                    events.Add(new GameEventSnapshot(
                        "manna_collected",
                        PlayerId: player.Id,
                        PickupId: pickup.Id,
                        CycleId: _mannaCycle.CycleId,
                        RemainingCount: _mannaCycle.RemainingPickupCount,
                        X: pickup.X,
                        Y: pickup.Y));
                    break;
                }
            }
        }

        if (_mannaCycle.RemainingPickupCount <= 0 || _mannaCycle.AgeSeconds >= _rules.MannaLifetimeSeconds)
        {
            ResolveMannaCycle(events);
        }
    }

    private void ResolveWinner(ICollection<GameEventSnapshot> events)
    {
        if (_winnerPlayerId is not null)
        {
            return;
        }

        var alivePlayers = _playersByConnection.Values.Where(p => p.IsAlive).ToArray();
        if (alivePlayers.Length == 0)
        {
            _phase = RoundPhase.GameOver;
            return;
        }

        if (!_winnerCheckEnabled || alivePlayers.Length != 1)
        {
            return;
        }

        var winner = alivePlayers[0];
        winner.IsWinner = true;
        _winnerPlayerId = winner.Id;
        _phase = RoundPhase.GameOver;
        events.Add(new GameEventSnapshot("winner_declared", PlayerId: winner.Id));
    }

    private void Kill(PlayerState player, string reason, ICollection<GameEventSnapshot> events)
    {
        if (!player.IsAlive || player.InvincibilityRemaining > 0f) return;

        player.Lives--;

        if (player.Lives > 0)
        {
            player.InvincibilityRemaining = _rules.InvincibilitySeconds;
            events.Add(new GameEventSnapshot(
                "player_lost_life",
                PlayerId: player.Id,
                Reason: reason,
                X: player.X,
                Y: player.Y,
                Count: player.Lives));
        }
        else
        {
            player.IsAlive = false;
            player.IsMoving = false;
            player.DeathReason = reason;
            player.TargetX = player.X;
            player.TargetY = player.Y;
            player.VelocityX = 0f;
            player.VelocityY = 0f;
            player.InputDirX = 0;
            player.JumpRequested = false;

            events.Add(new GameEventSnapshot(
                "player_died",
                PlayerId: player.Id,
                Reason: reason,
                X: player.X,
                Y: player.Y));
        }
    }

    private void SpawnMannaCycle(ICollection<GameEventSnapshot> events)
    {
        _mannaCycle = CreateMannaCycle();
        _mannaSpawnDelayRemaining = 0f;

        foreach (var player in _playersByConnection.Values)
        {
            player.HasCollectedMannaThisCycle = false;
        }

        events.Add(new GameEventSnapshot(
            "manna_cycle_spawned",
            CycleId: _mannaCycle.CycleId,
            Count: _mannaCycle.Pickups.Count,
            RemainingCount: _mannaCycle.RemainingPickupCount,
            IsActive: true,
            SecondsUntilStateChange: _rules.MannaBlinkStartSeconds));
    }

    private void ResolveMannaCycle(ICollection<GameEventSnapshot> events)
    {
        if (_mannaCycle is null)
        {
            return;
        }

        var cycle = _mannaCycle;
        _mannaCycle = null;
        PickNextHazard(applyTransitionDelay: true);

        var missedPlayers = _playersByConnection.Values
            .Where(player => player.IsAlive && !player.HasCollectedMannaThisCycle)
            .OrderBy(player => player.JoinOrder)
            .ToArray();

        foreach (var player in missedPlayers)
        {
            Kill(player, "starved", events);
        }

        events.Add(new GameEventSnapshot(
            "manna_cycle_resolved",
            CycleId: cycle.CycleId,
            Count: cycle.Pickups.Count,
            RemainingCount: cycle.RemainingPickupCount,
            IsActive: false,
            SecondsUntilStateChange: NextSelectedPhaseSecondsUntilStart()));
    }

    private void ResolveCloudCycle(ICollection<GameEventSnapshot> events)
    {
        if (_cloud is null)
        {
            return;
        }

        var cloud = _cloud;
        _cloud = null;
        PickNextHazard(applyTransitionDelay: true);

        var eliminatedCount = 0;
        foreach (var player in _playersByConnection.Values
                     .Where(player => player.IsAlive)
                     .OrderBy(player => player.JoinOrder))
        {
            if (IsWithinRadius(player.X, player.Y, cloud.X, cloud.Y, cloud.Radius))
            {
                continue;
            }

            Kill(player, "darkness", events);
            eliminatedCount += 1;
        }

        events.Add(new GameEventSnapshot(
            "cloud_resolved",
            X: cloud.X,
            Y: cloud.Y,
            Count: eliminatedCount,
            IsActive: false,
            SecondsUntilStateChange: _cloudCooldownRemaining));
    }

    private bool DidWaveHitPlayer(PlayerState player, WaveState wave)
    {
        var previous = wave.PreviousFrontCoordinate;
        var current = wave.FrontCoordinate;

        var crossed = wave.Side switch
        {
            HazardEdge.Left or HazardEdge.Right => IsBetween(player.X, previous, current),
            HazardEdge.Top or HazardEdge.Bottom => IsBetween(player.Y - PlayerHalfHeight, previous, current),
            _ => false
        };

        if (!crossed)
        {
            return false;
        }

        return wave.Side switch
        {
            HazardEdge.Left or HazardEdge.Right => !IsBetween(player.Y - PlayerHalfHeight, wave.GapStart, wave.GapEnd),
            HazardEdge.Top or HazardEdge.Bottom => !IsBetween(player.X, wave.GapStart, wave.GapEnd),
            _ => false
        };
    }

    private WorldSnapshot BuildSnapshot(IReadOnlyList<GameEventSnapshot> events)
    {
        var players = _playersByConnection.Values
            .OrderBy(player => player.JoinOrder)
            .Select(player => new PlayerSnapshot(
                player.Id,
                player.Name,
                player.X,
                player.Y,
                player.TargetX,
                player.TargetY,
                player.Color,
                player.IsMoving,
                player.IsAlive,
                player.IsWinner,
                player.HasCollectedMannaThisCycle,
                player.DeathReason,
                player.FacingDir,
                player.Lives,
                player.InvincibilityRemaining > 0f))
            .ToArray();

        var hideQueuedHazardsForManna = _mannaCycle is not null || _nextHazard == HazardType.Manna;

        var waveSnapshot = _wave is null
            ? new WaveSnapshot(
                false,
                _phase == RoundPhase.Active && !hideQueuedHazardsForManna && _nextHazard == HazardType.Wave
                    ? _nextWaveSide?.ToString().ToLowerInvariant()
                    : null,
                null,
                null,
                null,
                null,
                null,
                null,
                _phase == RoundPhase.Active && !hideQueuedHazardsForManna && _nextHazard == HazardType.Wave
                    ? Math.Max(0f, _waveCooldownRemaining)
                    : null)
            : new WaveSnapshot(
                true,
                _wave.Side.ToString().ToLowerInvariant(),
                _wave.GapAxis,
                _wave.GapStart,
                _wave.GapEnd,
                _wave.Progress,
                _wave.FrontCoordinate,
                _wave.Thickness,
                null);

        var cloudSnapshot = _cloud is null
            ? new CloudSnapshot(
                false,
                null,
                null,
                _rules.CloudRadius,
                _phase == RoundPhase.Active && !hideQueuedHazardsForManna && _nextHazard == HazardType.Cloud
                    ? Math.Max(0f, _cloudCooldownRemaining)
                    : null)
            : new CloudSnapshot(
                true,
                _cloud.X,
                _cloud.Y,
                _cloud.Radius,
                Math.Max(0f, _cloud.RemainingSeconds));

        var mannaSnapshot = BuildMannaSnapshot();

        return new WorldSnapshot(
            _tick,
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            players,
            new RoundSnapshot(
                _phase.ToString(),
                _starterPlayerId,
                _starterPlayerId,
                _winnerPlayerId),
            new HazardSnapshot(waveSnapshot, cloudSnapshot),
            mannaSnapshot,
            events,
            _winnerPlayerId,
            _winnerPlayerId is not null,
            _fireballs.Select(fb => new FireballSnapshot(fb.Id, fb.OwnerId, fb.X, fb.Y, fb.DirX)).ToArray(),
            _monsters.Select(m => new MonsterSnapshot(m.Id, m.X, m.Y, m.FacingDir, m.Hp, m.IsPaused)).ToArray(),
            WorldWidth,
            WorldHeight);
    }

    private MannaSnapshot BuildMannaSnapshot()
    {
        if (_mannaCycle is null)
        {
            var secondsUntilNextCycle = _phase == RoundPhase.Active && _nextHazard == HazardType.Manna
                ? Math.Max(0f, _mannaSpawnDelayRemaining)
                : 0f;
            return new MannaSnapshot(false, 0, secondsUntilNextCycle, 0f, 0f, false, _rules.RequiredMannaPerPlayer, 0, Array.Empty<MannaPickupSnapshot>());
        }

        var pickups = _mannaCycle.Pickups
            .Select(pickup => new MannaPickupSnapshot(
                pickup.Id,
                pickup.X,
                pickup.Y,
                pickup.IsCollected,
                pickup.CollectedByPlayerId))
            .ToArray();
        var secondsUntilBlink = Math.Max(0f, _rules.MannaBlinkStartSeconds - _mannaCycle.AgeSeconds);
        var secondsUntilDisappear = Math.Max(0f, _rules.MannaLifetimeSeconds - _mannaCycle.AgeSeconds);

        return new MannaSnapshot(
            true,
            _mannaCycle.CycleId,
            0f,
            secondsUntilBlink,
            secondsUntilDisappear,
            _mannaCycle.AgeSeconds >= _rules.MannaBlinkStartSeconds,
            _rules.RequiredMannaPerPlayer,
            _mannaCycle.RemainingPickupCount,
            pickups);
    }

    private bool TryGetPlayerByConnection(string connectionId, out PlayerState player)
    {
        return _playersByConnection.TryGetValue(connectionId, out player!);
    }

    private void ResetWorld()
    {
        _playersByConnection.Clear();
        _starterPlayerId = null;
        _nextJoinOrder = 0;
        _tick = 0;
        _phase = RoundPhase.WaitingToStart;
        _winnerPlayerId = null;
        _winnerCheckEnabled = false;
        _monsters.Clear();
        _monsterSpawns.Clear();
        ResetAvailablePlayerColors();
        ResetRoundMechanics();
    }

    private void ResetRoundState()
    {
        _phase = RoundPhase.WaitingToStart;
        _winnerPlayerId = null;
        _winnerCheckEnabled = false;
        _monsters.Clear();
        ResetRoundMechanics();

        foreach (var player in _playersByConnection.Values)
        {
            var spawn = RandomSpawn();
            player.IsAlive = true;
            player.Lives = _rules.LivesPerPlayer;
            player.InvincibilityRemaining = 0f;
            player.IsWinner = false;
            player.DeathReason = null;
            player.IsMoving = false;
            player.X = spawn.X;
            player.Y = spawn.Y;
            player.TargetX = spawn.X;
            player.TargetY = spawn.Y;
            player.HasCollectedMannaThisCycle = false;
            player.VelocityX = 0f;
            player.VelocityY = 0f;
            player.IsGrounded = false;
            player.InputDirX = 0;
            player.JumpRequested = false;
        }
    }

    private void ResetRoundMechanics()
    {
        _waveCooldownRemaining = _rules.WaveCooldownSeconds;
        _wave = null;
        _nextWaveSide = null;
        _cloudCooldownRemaining = _rules.CloudCooldownSeconds;
        _cloud = null;
        _nextHazard = HazardType.Wave;
        _mannaCycle = null;
        _mannaSpawnDelayRemaining = 0f;
        _nextMannaCycleId = 1;
    }

    private void PickNextHazard(bool applyTransitionDelay)
    {
        var transitionDelay = applyTransitionDelay ? Math.Max(0f, _rules.HazardTransitionDelaySeconds) : 0f;
        var roll = _random.NextInt(10);
        _nextHazard = roll switch
        {
            <= 4 => HazardType.Wave,
            <= 7 => HazardType.Cloud,
            _ => HazardType.Manna
        };

        if (_nextHazard == HazardType.Wave)
        {
            _waveCooldownRemaining = _rules.WaveCooldownSeconds + transitionDelay;
            _nextWaveSide = (HazardEdge)_random.NextInt(4);
            return;
        }

        if (_nextHazard == HazardType.Cloud)
        {
            _cloudCooldownRemaining = _rules.CloudCooldownSeconds + transitionDelay;
            return;
        }

        _mannaSpawnDelayRemaining = _rules.MannaPhaseLeadSeconds + transitionDelay;
    }

    private float? NextSelectedPhaseSecondsUntilStart()
    {
        return _nextHazard switch
        {
            HazardType.Wave => _waveCooldownRemaining,
            HazardType.Cloud => _cloudCooldownRemaining,
            HazardType.Manna => _mannaSpawnDelayRemaining,
            _ => null
        };
    }

    private MannaCycleState CreateMannaCycle()
    {
        var cycleId = _nextMannaCycleId++;
        var pickups = new List<MannaPickupState>(_rules.MannaPickupCount);
        var minX = Math.Min(_rules.MannaSpawnMarginFraction * WorldWidth, WorldWidth - (_rules.MannaSpawnMarginFraction * WorldWidth));
        var maxX = Math.Max(_rules.MannaSpawnMarginFraction * WorldWidth, WorldWidth - (_rules.MannaSpawnMarginFraction * WorldWidth));
        // Spawn within jump reach above ground so players can collect by walking or jumping
        var minY = EffectiveGroundY - 160f;
        var maxY = EffectiveGroundY;

        for (var index = 0; index < _rules.MannaPickupCount; index += 1)
        {
            var x = Lerp(minX, maxX, _random.NextSingle());
            var y = Lerp(minY, maxY, _random.NextSingle());
            pickups.Add(new MannaPickupState($"{cycleId}:{index}", x, y));
        }

        return new MannaCycleState(cycleId, pickups);
    }

    private WaveState CreateWave(HazardEdge side)
    {
        var gapFraction = _rules.WaveGapFraction;
        var gapLength = side is HazardEdge.Left or HazardEdge.Right ? WorldHeight * gapFraction : WorldWidth * gapFraction;
        var minCenter = side is HazardEdge.Left or HazardEdge.Right
            ? WorldHeight * _rules.WaveGapCenterMinFraction
            : WorldWidth * _rules.WaveGapCenterMinFraction;
        var maxCenter = side is HazardEdge.Left or HazardEdge.Right
            ? WorldHeight * _rules.WaveGapCenterMaxFraction
            : WorldWidth * _rules.WaveGapCenterMaxFraction;
        var center = Lerp(minCenter, maxCenter, _random.NextSingle());
        var gapStart = Math.Clamp(
            center - (gapLength * 0.5f),
            0f,
            side is HazardEdge.Left or HazardEdge.Right ? WorldHeight - gapLength : WorldWidth - gapLength);
        var gapEnd = gapStart + gapLength;

        return side switch
        {
            HazardEdge.Left => new WaveState(side, "y", gapStart, gapEnd, -_rules.WaveThickness, WorldWidth + _rules.WaveThickness, _rules.WaveThickness),
            HazardEdge.Right => new WaveState(side, "y", gapStart, gapEnd, WorldWidth + _rules.WaveThickness, -_rules.WaveThickness, _rules.WaveThickness),
            HazardEdge.Top => new WaveState(side, "x", gapStart, gapEnd, -_rules.WaveThickness, WorldHeight + _rules.WaveThickness, _rules.WaveThickness),
            HazardEdge.Bottom => new WaveState(side, "x", gapStart, gapEnd, WorldHeight + _rules.WaveThickness, -_rules.WaveThickness, _rules.WaveThickness),
            _ => throw new InvalidOperationException("Unexpected wave edge.")
        };
    }

    private CloudState CreateCloud()
    {
        var radius = Math.Clamp(_rules.CloudRadius, 48f, Math.Min(WorldWidth, WorldHeight) * 0.45f);
        var minX = Math.Max(radius, WorldWidth * _rules.CloudCenterMinFractionX);
        var maxX = Math.Min(WorldWidth - radius, WorldWidth * _rules.CloudCenterMaxFractionX);
        var minY = Math.Max(radius, WorldHeight * _rules.CloudCenterMinFractionY);
        var maxY = Math.Min(WorldHeight - radius, WorldHeight * _rules.CloudCenterMaxFractionY);
        var x = Lerp(minX, Math.Max(minX, maxX), _random.NextSingle());
        var y = Lerp(minY, Math.Max(minY, maxY), _random.NextSingle());
        return new CloudState(x, y, radius, _rules.CloudActiveSeconds);
    }

    private void TickMonsters(float deltaSeconds, ICollection<GameEventSnapshot> events)
    {
        foreach (var monster in _monsters)
        {
            if (monster.Hp <= 0) continue;

            monster.VelocityY += _rules.Gravity * deltaSeconds;
            monster.StateTimer -= deltaSeconds;
            UpdateMonsterAI(monster);
            ApplyMonsterPhysics(monster, deltaSeconds);

            if (monster.InvincibilityRemaining > 0f)
                monster.InvincibilityRemaining = MathF.Max(0f, monster.InvincibilityRemaining - deltaSeconds);
        }
    }

    private void UpdateMonsterAI(MonsterState monster)
    {
        if (monster.IsPaused)
        {
            monster.VelocityX = 0f;
            if (monster.StateTimer <= 0f)
            {
                monster.IsPaused = false;
                monster.FacingDir = ChooseMonsterDirection(monster);
                monster.StateTimer = Lerp(MonsterWalkMin, MonsterWalkMax, _random.NextSingle());
            }
            return;
        }

        // At a ledge: try opposite direction, otherwise pause briefly and reassess
        if (monster.IsGrounded && !HasGroundAheadForMonster(monster, monster.FacingDir))
        {
            if (HasGroundAheadForMonster(monster, -monster.FacingDir))
            {
                monster.FacingDir = -monster.FacingDir;
            }
            else
            {
                monster.IsPaused = true;
                monster.VelocityX = 0f;
                monster.StateTimer = Lerp(MonsterPauseMin, MonsterPauseMax, _random.NextSingle());
                return;
            }
        }

        monster.VelocityX = monster.FacingDir * MonsterWalkSpeed;

        if (monster.StateTimer <= 0f)
        {
            monster.IsPaused = true;
            monster.VelocityX = 0f;
            monster.StateTimer = Lerp(MonsterPauseMin, MonsterPauseMax, _random.NextSingle());
        }
    }

    private int ChooseMonsterDirection(MonsterState monster)
    {
        var canForward  = HasGroundAheadForMonster(monster,  monster.FacingDir);
        var canBackward = HasGroundAheadForMonster(monster, -monster.FacingDir);
        if (canForward && canBackward)
            return _random.NextInt(2) == 0 ? monster.FacingDir : -monster.FacingDir;
        if (canBackward) return -monster.FacingDir;
        return monster.FacingDir;
    }

    private void ApplyMonsterPhysics(MonsterState monster, float deltaSeconds)
    {
        var prevFeetY = monster.Y;
        monster.X += monster.VelocityX * deltaSeconds;
        monster.Y += monster.VelocityY * deltaSeconds;
        monster.X = Math.Clamp(monster.X, MonsterHalfWidth, WorldWidth - MonsterHalfWidth);
        var newFeetY = monster.Y;

        if (monster.Y >= EffectiveMonsterGroundY)
        {
            monster.Y = EffectiveMonsterGroundY;
            monster.VelocityY = 0f;
            monster.IsGrounded = true;
        }
        else
        {
            monster.IsGrounded = false;
            if (monster.VelocityY >= 0f)
            {
                foreach (var (cx, surfaceY, width) in _platforms)
                {
                    if (prevFeetY > surfaceY || newFeetY < surfaceY) continue;
                    if (monster.X < cx - width * 0.5f || monster.X > cx + width * 0.5f) continue;
                    monster.Y = surfaceY;
                    monster.VelocityY = 0f;
                    monster.IsGrounded = true;
                    break;
                }
            }
        }
        ResolveSceneryCollisionMonster(monster);
    }

    private bool HasGroundAheadForMonster(MonsterState monster, int direction)
    {
        var lookX = monster.X + direction * (MonsterHalfWidth + 4f);
        if (lookX < 0f || lookX > WorldWidth) return false;

        if (monster.Y >= EffectiveMonsterGroundY - 2f) return true;

        foreach (var (cx, surfaceY, width) in _platforms)
        {
            if (lookX >= cx - width * 0.5f && lookX <= cx + width * 0.5f)
                if (Math.Abs(surfaceY - monster.Y) < 3f) return true;
        }
        return false;
    }

    private void ResolveSceneryCollisionPlayer(PlayerState player)
    {
        var halfW = PlayerBodyHalfWidth;
        var fullH = PlayerBodyHeight;
        foreach (var obj in _sceneryObjects)
        {
            if (!obj.Solid) continue;
            float pL = player.X - halfW, pR = player.X + halfW;
            float pT = player.Y - fullH, pB = player.Y;
            float rL = obj.X, rR = obj.X + obj.Width, rT = obj.Y, rB = obj.Y + obj.Height;
            if (pR <= rL || pL >= rR || pB <= rT || pT >= rB) continue;
            float ovL = pR - rL, ovR = rR - pL, ovT = pB - rT, ovB = rB - pT;
            float resX = ovL < ovR ? -ovL : ovR;
            float resY = ovT < ovB ? -ovT : ovB;
            if (MathF.Abs(resX) <= MathF.Abs(resY))
            {
                player.X += resX;
                player.VelocityX = 0f;
            }
            else
            {
                player.Y += resY;
                player.VelocityY = 0f;
                if (resY < 0f) player.IsGrounded = true;
            }
        }
    }

    private void ResolveSceneryCollisionMonster(MonsterState monster)
    {
        const float fullH = MonsterHalfHeight * 2f;
        foreach (var obj in _sceneryObjects)
        {
            if (!obj.Solid) continue;
            float pL = monster.X - MonsterHalfWidth, pR = monster.X + MonsterHalfWidth;
            float pT = monster.Y - fullH, pB = monster.Y;
            float rL = obj.X, rR = obj.X + obj.Width, rT = obj.Y, rB = obj.Y + obj.Height;
            if (pR <= rL || pL >= rR || pB <= rT || pT >= rB) continue;
            float ovL = pR - rL, ovR = rR - pL, ovT = pB - rT, ovB = rB - pT;
            float resX = ovL < ovR ? -ovL : ovR;
            float resY = ovT < ovB ? -ovT : ovB;
            if (MathF.Abs(resX) <= MathF.Abs(resY))
            {
                monster.X += resX;
                monster.VelocityX = 0f;
            }
            else
            {
                monster.Y += resY;
                monster.VelocityY = 0f;
                if (resY < 0f) monster.IsGrounded = true;
            }
        }
    }

    private void ResolveMonsterPlayerContact(ICollection<GameEventSnapshot> events)
    {
        foreach (var monster in _monsters)
        {
            if (monster.Hp <= 0) continue;

            foreach (var player in _playersByConnection.Values.OrderBy(p => p.JoinOrder))
            {
                if (!player.IsAlive || player.InvincibilityRemaining > 0f) continue;
                if (!IsWithinRadius(monster.X, monster.Y - MonsterHalfHeight, player.X, player.Y - PlayerHalfHeight, MonsterContactRadius)) continue;

                Kill(player, "monster", events);
            }
        }
    }

    private void DamageMonster(MonsterState monster, ICollection<GameEventSnapshot> events)
    {
        monster.Hp--;
        if (monster.Hp <= 0)
        {
            monster.Hp = 0;
            events.Add(new GameEventSnapshot("monster_died", X: monster.X, Y: monster.Y));
        }
        else
        {
            monster.InvincibilityRemaining = 0.8f;
            events.Add(new GameEventSnapshot("monster_hit", X: monster.X, Y: monster.Y));
        }
    }

    public IReadOnlyList<MonsterSpawnDto> GetMonsterSpawns()
    {
        lock (_sync)
        {
            return _monsterSpawns.Select(s => new MonsterSpawnDto(s.Id, s.X, s.Y)).ToArray();
        }
    }

    public (bool Success, string? Reason) TryApplyMonsterSpawns(string connectionId, List<MonsterSpawnDto> spawns)
    {
        lock (_sync)
        {
            if (_phase == RoundPhase.Active) return (false, "round_active");
            if (!CanEdit(connectionId)) return (false, "not_authorized");

            _monsterSpawns.Clear();
            foreach (var s in spawns)
                _monsterSpawns.Add(new MonsterSpawn(s.Id, s.X, s.Y));
        }
        return (true, null);
    }

    // Allow edits when no players are joined yet (pre-join editor) or when the caller is the host.
    private bool CanEdit(string connectionId)
    {
        if (_playersByConnection.Count == 0) return true;
        return TryGetPlayerByConnection(connectionId, out var p) && p.Id == _starterPlayerId;
    }

    private static bool IsWithinRadius(float x1, float y1, float x2, float y2, float radius)
    {
        var dx = x1 - x2;
        var dy = y1 - y2;
        return ((dx * dx) + (dy * dy)) <= (radius * radius);
    }

    private static ulong HashValues(params ulong[] values)
    {
        const ulong offsetBasis = 1469598103934665603UL;
        const ulong prime = 1099511628211UL;

        var hash = offsetBasis;
        foreach (var value in values)
        {
            hash ^= value;
            hash *= prime;
        }

        return hash;
    }

    private static float HashToUnitFloat(ulong a, ulong b, ulong c)
    {
        var hash = HashValues(a, b, c);
        return (hash & 0xFFFFFFUL) / 16777216f;
    }

    private static bool IsBetween(float value, float a, float b)
    {
        var min = Math.Min(a, b);
        var max = Math.Max(a, b);
        return value >= min && value <= max;
    }

    private static float Lerp(float min, float max, float t) => min + ((max - min) * t);

    private Vector2 RandomSpawn()
    {
        var x = Lerp(_rules.SpawnMarginFraction * WorldWidth, (1f - _rules.SpawnMarginFraction) * WorldWidth, _random.NextSingle());
        var y = Lerp(_rules.SpawnMarginFraction * WorldHeight, (1f - _rules.SpawnMarginFraction) * WorldHeight, _random.NextSingle());
        return new Vector2(x, y);
    }

    private void ResetAvailablePlayerColors()
    {
        _availablePlayerColors.Clear();
        _availablePlayerColors.AddRange(PlayerColorPalette);
    }

    private string TakePlayerColor(string connectionId, long joinOrder)
    {
        if (_availablePlayerColors.Count == 0)
        {
            return "#ffffff";
        }

        var index = (int)(StableColorHash(connectionId, joinOrder) % (ulong)_availablePlayerColors.Count);
        var color = _availablePlayerColors[index];
        _availablePlayerColors.RemoveAt(index);
        return color;
    }

    private static ulong StableColorHash(string connectionId, long joinOrder)
    {
        const ulong offsetBasis = 1469598103934665603UL;
        const ulong prime = 1099511628211UL;

        var hash = offsetBasis;
        foreach (var character in connectionId)
        {
            hash ^= character;
            hash *= prime;
        }

        hash ^= (ulong)joinOrder;
        hash *= prime;
        return hash;
    }

    private static string? NormalizeEmoteCode(string requestedCode)
    {
        var code = (requestedCode ?? string.Empty).Trim().ToLowerInvariant();
        return AllowedEmotes.Contains(code) ? code : null;
    }

    public IReadOnlyList<TunableFieldDto> GetRulesSchema()
    {
        lock (_sync)
        {
            return BuildRulesSchema(_rules);
        }
    }

    public (bool Success, string? Reason, IReadOnlyList<TunableFieldDto>? Schema) TryUpdateRules(
        string connectionId, Dictionary<string, float> updates)
    {
        GameRules newRules;
        lock (_sync)
        {
            if (_phase == RoundPhase.Active)
                return (false, "round_active", null);

            if (!CanEdit(connectionId))
                return (false, "not_authorized", null);

            newRules = ApplyRulesUpdates(_rules, updates);
            _rules = newRules;
        }

        PersistRules(newRules);
        return (true, null, BuildRulesSchema(newRules));
    }

    private static IReadOnlyList<TunableFieldDto> BuildRulesSchema(GameRules rules)
    {
        var result = new List<TunableFieldDto>();
        foreach (var prop in typeof(GameRules).GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            var attr = prop.GetCustomAttribute<TunableAttribute>();
            if (attr == null) continue;
            var value = Convert.ToSingle(prop.GetValue(rules));
            result.Add(new TunableFieldDto(prop.Name, attr.Label, attr.Category, attr.Min, attr.Max, attr.Step, value));
        }
        return result;
    }

    private static GameRules ApplyRulesUpdates(GameRules current, Dictionary<string, float> updates)
    {
        var newRules = new GameRules();
        var type = typeof(GameRules);
        var props = type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                        .Where(p => p.CanRead && p.CanWrite)
                        .ToArray();

        foreach (var prop in props)
            prop.SetValue(newRules, prop.GetValue(current));

        foreach (var (key, value) in updates)
        {
            var prop = type.GetProperty(key, BindingFlags.Public | BindingFlags.Instance);
            if (prop == null) continue;
            var attr = prop.GetCustomAttribute<TunableAttribute>();
            if (attr == null) continue;
            var clamped = Math.Clamp(value, attr.Min, attr.Max);
            prop.SetValue(newRules, Convert.ChangeType(clamped, prop.PropertyType));
        }

        return newRules;
    }

    public IReadOnlyList<PlatformDto> GetPlatforms()
    {
        lock (_sync)
        {
            return _platforms.Select(p => new PlatformDto(p.CenterX, p.SurfaceY, p.Width)).ToArray();
        }
    }

    public IReadOnlyList<SceneryObjectDto> GetSceneryObjects()
    {
        lock (_sync) { return _sceneryObjects; }
    }

    public (bool Success, string? Reason) TryApplyScenery(string connectionId, List<SceneryObjectDto> objects)
    {
        lock (_sync)
        {
            if (_phase == RoundPhase.Active) return (false, "round_active");
            if (!CanEdit(connectionId)) return (false, "not_authorized");
            _sceneryObjects = objects.ToArray();
        }
        return (true, null);
    }

    public (bool Success, string? Reason) TryApplyPlatforms(string connectionId, List<PlatformDto> platforms)
    {
        lock (_sync)
        {
            if (_phase == RoundPhase.Active)
                return (false, "round_active");

            if (!CanEdit(connectionId)) return (false, "not_authorized");

            _platforms = platforms.Select(p => (p.Cx, p.SurfaceY, p.Width)).ToArray();
        }
        return (true, null);
    }

    // Versioned map file format. Old maps were a bare PlatformDto array.
    private sealed class MapFileDto
    {
        public List<PlatformDto>? Platforms { get; set; }
        public List<SceneryObjectDto>? Scenery { get; set; }
    }

    public (bool Success, string? Reason) TrySaveMap(string connectionId, string name, List<PlatformDto> platforms, List<SceneryObjectDto> scenery)
    {
        if (!IsValidMapName(name))
            return (false, "invalid_name");

        lock (_sync)
        {
            if (_phase == RoundPhase.Active)
                return (false, "round_active");

            if (!CanEdit(connectionId)) return (false, "not_authorized");

            _platforms = platforms.Select(p => (p.Cx, p.SurfaceY, p.Width)).ToArray();
            _sceneryObjects = scenery.ToArray();
        }

        try
        {
            Directory.CreateDirectory(_mapsDirectory);
            var mapFile = new MapFileDto { Platforms = platforms, Scenery = scenery };
            var json = JsonSerializer.Serialize(mapFile, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(Path.Combine(_mapsDirectory, $"{name}.json"), json);
        }
        catch { }

        return (true, null);
    }

    public (bool Success, string? Reason) TryLoadMap(string connectionId, string name)
    {
        if (!IsValidMapName(name))
            return (false, "invalid_name");

        lock (_sync)
        {
            if (_phase == RoundPhase.Active)
                return (false, "round_active");

            if (!TryGetPlayerByConnection(connectionId, out var player) || player.Id != _starterPlayerId)
                return (false, "not_authorized");
        }

        string json;
        try
        {
            var path = Path.Combine(_mapsDirectory, $"{name}.json");
            if (!File.Exists(path)) return (false, "not_found");
            json = File.ReadAllText(path);
        }
        catch { return (false, "invalid_file"); }

        // Try new versioned format; fall back to legacy bare-array format.
        MapFileDto? mapFile = null;
        try { mapFile = JsonSerializer.Deserialize<MapFileDto>(json); } catch { }
        if (mapFile?.Platforms == null)
        {
            try
            {
                var legacy = JsonSerializer.Deserialize<List<PlatformDto>>(json);
                if (legacy != null) mapFile = new MapFileDto { Platforms = legacy, Scenery = null };
            }
            catch { return (false, "invalid_file"); }
        }
        if (mapFile?.Platforms == null) return (false, "invalid_file");

        lock (_sync)
        {
            _platforms = mapFile.Platforms.Select(p => (p.Cx, p.SurfaceY, p.Width)).ToArray();
            _sceneryObjects = mapFile.Scenery?.ToArray() ?? [];
        }

        return (true, null);
    }

    public IReadOnlyList<string> ListMaps()
    {
        try
        {
            if (!Directory.Exists(_mapsDirectory)) return Array.Empty<string>();
            return Directory.GetFiles(_mapsDirectory, "*.json")
                .Select(Path.GetFileNameWithoutExtension)
                .Where(n => n is not null)
                .Order()
                .ToArray()!;
        }
        catch { return Array.Empty<string>(); }
    }

    private static bool IsValidMapName(string name)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Length > 40) return false;
        return name.All(c => char.IsLetterOrDigit(c) || c == ' ' || c == '-' || c == '_');
    }

    private static void PersistRules(GameRules rules)
    {
        try
        {
            var json = JsonSerializer.Serialize(rules, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText("gamerules.json", json);
        }
        catch
        {
            // best-effort
        }
    }

    private sealed class PlayerState(
        string id,
        string connectionId,
        string name,
        string color,
        float x,
        float y,
        float targetX,
        float targetY,
        long joinOrder)
    {
        public string Id { get; } = id;
        public string ConnectionId { get; } = connectionId;
        public string Name { get; } = name;
        public string Color { get; } = color;
        public float X { get; set; } = x;
        public float Y { get; set; } = y;
        public float TargetX { get; set; } = targetX;
        public float TargetY { get; set; } = targetY;
        public bool IsMoving { get; set; }
        public bool IsAlive { get; set; } = true;
        public int Lives { get; set; } = 3;
        public float InvincibilityRemaining { get; set; }
        public bool IsWinner { get; set; }
        public bool HasCollectedMannaThisCycle { get; set; }
        public string? DeathReason { get; set; }
        public long JoinOrder { get; } = joinOrder;
        // Platformer physics fields (active when UsePhysics = true)
        public float VelocityX { get; set; }
        public float VelocityY { get; set; }
        public bool IsGrounded { get; set; }
        public int InputDirX { get; set; }
        public int FacingDir { get; set; } = 1;
        public bool JumpRequested { get; set; }
        public bool UsePhysics { get; set; }
    }

    private sealed class MonsterSpawn(string id, float x, float y)
    {
        public string Id { get; } = id;
        public float X { get; } = x;
        public float Y { get; } = y;
    }

    private sealed class MonsterState(string id, float x, float y)
    {
        public string Id { get; } = id;
        public float X { get; set; } = x;
        public float Y { get; set; } = y;
        public float VelocityX { get; set; }
        public float VelocityY { get; set; }
        public bool IsGrounded { get; set; }
        public int FacingDir { get; set; } = 1;
        public int Hp { get; set; } = 2;
        public bool IsPaused { get; set; }
        public float StateTimer { get; set; } = MonsterWalkMax;
        public float InvincibilityRemaining { get; set; }
    }

    private sealed class FireballState(string id, string ownerId, float x, float y, int dirX)
    {
        public string Id { get; } = id;
        public string OwnerId { get; } = ownerId;
        public float X { get; set; } = x;
        public float Y { get; } = y;
        public int DirX { get; } = dirX;
    }

    private sealed class MannaCycleState(long cycleId, List<MannaPickupState> pickups)
    {
        public long CycleId { get; } = cycleId;
        public List<MannaPickupState> Pickups { get; } = pickups;
        public int RemainingPickupCount { get; set; } = pickups.Count;
        public float AgeSeconds { get; set; }
        public bool BlinkStarted { get; set; }
    }

    private sealed class MannaPickupState(string id, float x, float y)
    {
        public string Id { get; } = id;
        public float X { get; } = x;
        public float Y { get; } = y;
        public bool IsCollected { get; set; }
        public string? CollectedByPlayerId { get; set; }
    }

    private sealed class WaveState(
        HazardEdge side,
        string gapAxis,
        float gapStart,
        float gapEnd,
        float startCoordinate,
        float endCoordinate,
        float thickness)
    {
        public HazardEdge Side { get; } = side;
        public string GapAxis { get; } = gapAxis;
        public float GapStart { get; } = gapStart;
        public float GapEnd { get; } = gapEnd;
        public float StartCoordinate { get; } = startCoordinate;
        public float EndCoordinate { get; } = endCoordinate;
        public float Thickness { get; } = thickness;
        public float Progress { get; set; }
        public float PreviousFrontCoordinate { get; set; } = startCoordinate;
        public float FrontCoordinate { get; set; } = startCoordinate;
    }

    private sealed class CloudState(float x, float y, float radius, float remainingSeconds)
    {
        public float X { get; } = x;
        public float Y { get; } = y;
        public float Radius { get; } = radius;
        public float RemainingSeconds { get; set; } = remainingSeconds;
    }

    private enum HazardEdge
    {
        Left,
        Right,
        Top,
        Bottom
    }

    private enum HazardType
    {
        Wave,
        Cloud,
        Manna
    }
}
