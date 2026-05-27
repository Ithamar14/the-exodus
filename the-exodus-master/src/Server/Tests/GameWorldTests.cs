using Server.Game;
using Xunit;

namespace Server.Tests;

public sealed class GameWorldTests
{
    [Fact]
    public void JoinValidationRejectsInvalidNamesAndDuplicateConnection()
    {
        var world = CreateWorld(
            singles: [0.5f, 0.5f, 0.2f, 0.2f],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f
            });

        var empty = world.TryAddPlayer("conn-1", "   ");
        Assert.False(empty.Success);
        Assert.Equal("invalid_name", empty.Reason);

        var tooLong = world.TryAddPlayer("conn-1", "abcdefghijklmnopqrstu");
        Assert.False(tooLong.Success);
        Assert.Equal("invalid_name", tooLong.Reason);

        var accepted = world.TryAddPlayer("conn-1", "Ada");
        Assert.True(accepted.Success);

        var duplicate = world.TryAddPlayer("conn-1", "Ada");
        Assert.False(duplicate.Success);
        Assert.Equal("already_joined", duplicate.Reason);
    }

    [Fact]
    public void RoomCapacityIsLimitedToSixPlayers()
    {
        var world = CreateWorld(
            singles: [0.1f, 0.1f, 0.2f, 0.2f, 0.3f, 0.3f, 0.4f, 0.4f, 0.5f, 0.5f, 0.6f, 0.6f, 0.7f, 0.7f],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f
            });

        for (var index = 1; index <= GameWorld.MaxPlayers; index += 1)
        {
            var accepted = world.TryAddPlayer($"conn-{index}", $"P{index}");
            Assert.True(accepted.Success);
        }

        var rejected = world.TryAddPlayer("conn-7", "P7");
        Assert.False(rejected.Success);
        Assert.Equal("room_full", rejected.Reason);
    }

    [Fact]
    public void TargetIsClampedToWorldBounds()
    {
        var world = CreateWorld(
            singles: [0.4f, 0.4f],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 120f,
                SpawnMarginFraction = 0f
            });

        Assert.True(world.TryAddPlayer("conn-1", "Ada").Success);
        Assert.True(world.TrySetTarget("conn-1", -100f, GameWorld.WorldHeight + 50f));

        var snapshot = world.TickAndSnapshot(0.05f);
        var player = Assert.Single(snapshot.Players);

        Assert.Equal(0f, player.TargetX);
        Assert.Equal(GameWorld.WorldHeight, player.TargetY);
    }

    [Fact]
    public void WaveSpawnsWithGapAndAdvancesDeterministically()
    {
        var world = CreateWorld(
            singles: [0.5f, 0.25f],
            ints: [0, 0],
            rules: new GameRules
            {
                WaveCooldownSeconds = 0.05f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f
            });

        var ada = world.TryAddPlayer("conn-1", "Ada");
        var bea = world.TryAddPlayer("conn-2", "Bea");
        Assert.True(ada.Success);
        Assert.True(bea.Success);
        StartRound(world, "conn-1");

        var first = world.TickAndSnapshot(0.05f);

        Assert.Contains(first.Events, e => e.Type == "wave_spawned");
        Assert.True(first.Hazard.Wave.IsActive);
        Assert.Equal("left", first.Hazard.Wave.Side);
        Assert.Equal("y", first.Hazard.Wave.GapAxis);
        Assert.InRange(first.Hazard.Wave.GapStart ?? -1f, 0f, GameWorld.WorldHeight);
        Assert.InRange(first.Hazard.Wave.GapEnd ?? -1f, 0f, GameWorld.WorldHeight);

        var second = world.TickAndSnapshot(0.25f);

        Assert.True(second.Hazard.Wave.IsActive);
        Assert.NotNull(second.Hazard.Wave.Progress);
        Assert.True(second.Hazard.Wave.Progress > 0f);
    }

    [Fact]
    public void WaveWarningMetadataIsAvailableFiveSecondsBeforeSpawn()
    {
        var world = CreateWorld(
            singles: [0.2f, 0.2f, 0.1f],
            ints: [0, 0],
            rules: new GameRules
            {
                WaveCooldownSeconds = 8f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f
            });

        Assert.True(world.TryAddPlayer("conn-1", "Ada").Success);
        StartRound(world, "conn-1");

        var warning = world.TickAndSnapshot(3f);
        Assert.False(warning.Hazard.Wave.IsActive);
        Assert.Equal("left", warning.Hazard.Wave.Side);
        Assert.InRange(warning.Hazard.Wave.SecondsUntilSpawn ?? -1f, 4.9f, 5.1f);

        var spawned = world.TickAndSnapshot(5f);
        Assert.True(spawned.Hazard.Wave.IsActive);
        Assert.Null(spawned.Hazard.Wave.SecondsUntilSpawn);
        Assert.Contains(spawned.Events, eventSnapshot => eventSnapshot.Type == "wave_spawned");
    }

    [Fact]
    public void MannaCycleDoesNotStartWhileHazardWarningWindowIsActive()
    {
        var world = CreateWorld(
            singles: [0.5f, 0.5f],
            ints: [0, 0],
            rules: new GameRules
            {
                WaveCooldownSeconds = 3f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f,
                HazardTransitionDelaySeconds = 0f
            });

        Assert.True(world.TryAddPlayer("conn-1", "Ada").Success);
        StartRound(world, "conn-1");

        var snapshot = world.TickAndSnapshot(1f);
        Assert.False(snapshot.Manna.IsActive);
        Assert.False(snapshot.Hazard.Wave.IsActive);
        Assert.Equal("left", snapshot.Hazard.Wave.Side);
        Assert.InRange(snapshot.Hazard.Wave.SecondsUntilSpawn ?? -1f, 1.9f, 2.1f);
    }

    [Fact]
    public void MannaDoesNotSpawnWhileHazardIsActiveOrImminent()
    {
        var world = CreateWorld(
            singles: [0.5f, 0.5f],
            ints: [0, 0],
            rules: new GameRules
            {
                WaveCooldownSeconds = 0.1f,
                WaveTravelSeconds = 2f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f,
                HazardTransitionDelaySeconds = 0f
            });

        Assert.True(world.TryAddPlayer("conn-1", "Ada").Success);
        StartRound(world, "conn-1");

        var snapshot = world.TickAndSnapshot(1f);
        Assert.True(snapshot.Hazard.Wave.IsActive);
        Assert.False(snapshot.Manna.IsActive);
    }

    [Fact]
    public void SoloStartedRoundStaysPlayable()
    {
        var world = CreateWorld(
            singles: [0.4f, 0.2f],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 100f,
                SpawnMarginFraction = 0f
            });

        var starter = world.TryAddPlayer("conn-1", "Solo");
        Assert.True(starter.Success);
        StartRound(world, "conn-1");

        var before = world.TickAndSnapshot(0.05f);
        Assert.Equal("Active", before.Round.Phase);
        Assert.False(before.GameOver);

        var moved = world.TrySetTarget("conn-1", GameWorld.WorldWidth - 50f, GameWorld.WorldHeight * 0.2f);
        Assert.True(moved);

        var after = world.TickAndSnapshot(0.1f);
        var player = Assert.Single(after.Players);

        Assert.Equal("Active", after.Round.Phase);
        Assert.False(after.GameOver);
        Assert.True(player.X > before.Players[0].X);
        Assert.True(player.IsAlive);
        Assert.False(player.IsWinner);
    }

    [Fact]
    public void PlayersCanMoveBeforeTheRoundStarts()
    {
        var world = CreateWorld(
            singles: [0.1f, 0.1f, 0.9f, 0.3f],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 120f,
                SpawnMarginFraction = 0f
            });

        var starter = world.TryAddPlayer("conn-1", "Starter");
        Assert.True(starter.Success);

        var waiting = world.TickAndSnapshot(0.05f);
        Assert.Equal("WaitingToStart", waiting.Round.Phase);

        var before = Assert.Single(waiting.Players);
        var moved = world.TrySetTarget("conn-1", GameWorld.WorldWidth - 40f, GameWorld.WorldHeight * 0.25f);
        Assert.True(moved);

        var after = world.TickAndSnapshot(0.1f);
        var player = Assert.Single(after.Players);

        Assert.Equal("WaitingToStart", after.Round.Phase);
        Assert.False(after.GameOver);
        Assert.True(player.X > before.X);
        Assert.InRange(player.TargetX, (GameWorld.WorldWidth - 40f) - 0.01f, (GameWorld.WorldWidth - 40f) + 0.01f);
        Assert.True(player.IsAlive);
    }

    [Fact]
    public void ColorsAreAssignedOnJoinAndPropagateThroughSnapshots()
    {
        var firstWorld = CreateWorld(
            singles: [0.15f, 0.35f, 0.55f, 0.75f],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f
            });

        var secondWorld = CreateWorld(
            singles: [0.15f, 0.35f, 0.55f, 0.75f],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f
            });

        foreach (var world in new[] { firstWorld, secondWorld })
        {
            Assert.True(world.TryAddPlayer("conn-1", "Ada").Success);
            Assert.True(world.TryAddPlayer("conn-2", "Bea").Success);
            Assert.True(world.TryAddPlayer("conn-3", "Cy").Success);
            Assert.True(world.TryAddPlayer("conn-4", "Dee").Success);
            Assert.True(world.TryAddPlayer("conn-5", "Eli").Success);
            Assert.True(world.TryAddPlayer("conn-6", "Fox").Success);
        }

        var firstSnapshot = firstWorld.TickAndSnapshot(0.05f);
        var secondSnapshot = secondWorld.TickAndSnapshot(0.05f);
        var firstPlayers = firstSnapshot.Players.OrderBy(player => player.Name).ToArray();
        var secondPlayers = secondSnapshot.Players.OrderBy(player => player.Name).ToArray();
        var allowedColors = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "#2a6fdb",
            "#e63946",
            "#2a9d8f",
            "#8d6cab",
            "#f4a261",
            "#4ecdc4"
        };

        Assert.Equal(firstPlayers.Select(player => player.Color), secondPlayers.Select(player => player.Color));
        Assert.Equal(6, firstPlayers.Length);
        Assert.Equal(6, firstPlayers.Select(player => player.Color).Distinct(StringComparer.OrdinalIgnoreCase).Count());
        Assert.True(allowedColors.SetEquals(firstPlayers.Select(player => player.Color)));
    }

    [Fact]
    public void CloudHazardSpawnsWithExpectedMetadata()
    {
        var world = CreateWorld(
            singles: [0.25f, 0.75f, 0.5f, 0.5f],
            ints: [5],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f,
                CloudCooldownSeconds = 0.05f,
                CloudActiveSeconds = 0.2f,
                CloudRadius = 120f,
                CloudCenterMinFractionX = 0.5f,
                CloudCenterMaxFractionX = 0.5f,
                CloudCenterMinFractionY = 0.5f,
                CloudCenterMaxFractionY = 0.5f,
                MannaCollectRadius = 0f
            });

        var player = world.TryAddPlayer("conn-1", "Ada");
        Assert.True(player.Success);
        StartRound(world, "conn-1");

        var snapshot = world.TickAndSnapshot(0.05f);
        Assert.True(snapshot.Hazard.Cloud.IsActive);
        Assert.Equal(GameWorld.WorldWidth * 0.5f, snapshot.Hazard.Cloud.X ?? -1f, 3);
        Assert.Equal(GameWorld.WorldHeight * 0.5f, snapshot.Hazard.Cloud.Y ?? -1f, 3);
        Assert.Equal(120f, snapshot.Hazard.Cloud.Radius ?? -1f, 3);
        Assert.InRange(snapshot.Hazard.Cloud.SecondsUntilResolve ?? -1f, 0.19f, 0.21f);
        Assert.Contains(snapshot.Events, eventSnapshot => eventSnapshot.Type == "cloud_spawned");
    }

    [Fact]
    public void MannaCycleSpawnsRandomlyAcrossMap()
    {
        var world = CreateWorld(
            singles: [0.9f, 0.1f, 0.15f, 0.2f, 0.75f, 0.8f, 0.45f, 0.6f],
            ints: [8],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f,
                MannaPickupCount = 3,
                MannaSpawnMarginFraction = 0f
            });

        Assert.True(world.TryAddPlayer("conn-1", "Ada").Success);
        StartRound(world, "conn-1");

        var snapshot = world.TickAndSnapshot(1f);

        Assert.True(snapshot.Manna.IsActive);
        Assert.Equal(3, snapshot.Manna.Pickups.Count);
        Assert.Equal(5f, snapshot.Manna.SecondsUntilBlink);
        Assert.Equal(10f, snapshot.Manna.SecondsUntilDisappear);
        Assert.False(snapshot.Manna.IsBlinking);
        Assert.Contains(snapshot.Events, e => e.Type == "manna_cycle_spawned" && e.CycleId == 1);

        Assert.All(snapshot.Manna.Pickups, pickup =>
        {
            Assert.InRange(pickup.X, 0f, GameWorld.WorldWidth);
            Assert.InRange(pickup.Y, GameWorld.GroundY - 165f, GameWorld.GroundY + 1f);
        });

        var xSpread = snapshot.Manna.Pickups.Max(p => p.X) - snapshot.Manna.Pickups.Min(p => p.X);
        var ySpread = snapshot.Manna.Pickups.Max(p => p.Y) - snapshot.Manna.Pickups.Min(p => p.Y);
        Assert.True(xSpread > (GameWorld.WorldWidth * 0.2f));
        Assert.True(ySpread > 50f); // platformer: manna spawns within jump range near ground
    }

    [Fact]
    public void MannaCycleBlinksAfterFiveSecondsAndExpiresAfterTenSeconds()
    {
        var world = CreateWorld(
            singles: [0.1f, 0.1f, 0.9f, 0.9f],
            ints: [8],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f,
                MannaPickupCount = 1,
                MannaSpawnMarginFraction = 0f,
                MannaRespawnDelaySeconds = 3f
            });

        Assert.True(world.TryAddPlayer("conn-1", "Ada").Success);
        StartRound(world, "conn-1");

        var spawn = world.TickAndSnapshot(1f);
        Assert.True(spawn.Manna.IsActive);
        Assert.False(spawn.Manna.IsBlinking);
        Assert.Equal(5f, spawn.Manna.SecondsUntilBlink, 3);
        Assert.Equal(10f, spawn.Manna.SecondsUntilDisappear, 3);

        var beforeBlink = world.TickAndSnapshot(4.9f);
        Assert.True(beforeBlink.Manna.IsActive);
        Assert.False(beforeBlink.Manna.IsBlinking);
        Assert.InRange(beforeBlink.Manna.SecondsUntilBlink, 0f, 0.2f);
        Assert.InRange(beforeBlink.Manna.SecondsUntilDisappear, 4.8f, 5.1f);
        Assert.DoesNotContain(beforeBlink.Events, e => e.Type == "manna_cycle_blink_started");

        var blinking = world.TickAndSnapshot(0.2f);
        Assert.True(blinking.Manna.IsActive);
        Assert.True(blinking.Manna.IsBlinking);
        Assert.Equal(0f, blinking.Manna.SecondsUntilBlink, 3);
        Assert.InRange(blinking.Manna.SecondsUntilDisappear, 4.7f, 5.0f);
        Assert.Contains(blinking.Events, e => e.Type == "manna_cycle_blink_started" && e.CycleId == 1);

        var expired = world.TickAndSnapshot(4.9f);
        var player = Assert.Single(expired.Players);
        Assert.False(expired.Manna.IsActive);
        Assert.Equal(0f, expired.Manna.SecondsUntilBlink, 3);
        Assert.Equal(0f, expired.Manna.SecondsUntilDisappear, 3);
        Assert.False(expired.Manna.IsBlinking);
        Assert.Contains(expired.Events, e => e.Type == "manna_cycle_resolved" && e.CycleId == 1);
        Assert.False(player.IsAlive);
        Assert.Equal("starved", player.DeathReason);
    }

    [Fact]
    public void MannaCycleSpawnsAndTracksCollection()
    {
        var world = CreateWorld(
            singles: [0.15f, 0.35f, 0.55f, 0.75f],
            ints: [8],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 4000f,
                SpawnMarginFraction = 0f,
                MannaSpawnMarginFraction = 0.1f,
                MannaRespawnDelaySeconds = 2f
            });

        Assert.True(world.TryAddPlayer("conn-1", "Ada").Success);
        StartRound(world, "conn-1");

        Assert.True(world.TrySetTarget("conn-1", 0f, 0f));
        var spawn = world.TickAndSnapshot(1f);
        Assert.True(spawn.Manna.IsActive);
        Assert.Equal(1L, spawn.Manna.CycleId);
        Assert.Equal(1, spawn.Manna.RequiredPerPlayer);
        Assert.Equal(5, spawn.Manna.Pickups.Count);
        Assert.Equal(5, spawn.Manna.RemainingPickupCount);
        Assert.Contains(spawn.Events, e => e.Type == "manna_cycle_spawned" && e.CycleId == 1);

        var firstPickup = spawn.Manna.Pickups[0];
        Assert.True(world.TrySetTarget("conn-1", firstPickup.X, firstPickup.Y));
        var afterCollection = world.TickAndSnapshot(1f);

        var collector = Assert.Single(afterCollection.Players, player => player.Name == "Ada");
        Assert.True(collector.HasCollectedMannaThisCycle);
        Assert.Contains(afterCollection.Manna.Pickups, pickup => pickup.Id == firstPickup.Id && pickup.IsCollected && pickup.CollectedByPlayerId == collector.Id);
        Assert.Contains(afterCollection.Events, e => e.Type == "manna_collected" && e.PlayerId == collector.Id && e.PickupId == firstPickup.Id);
    }

    [Fact]
    public void PlayersWhoMissMannaDieWhenCycleCompletes()
    {
        var world = CreateWorld(
            singles: [0.15f, 0.35f, 0.55f, 0.75f, 0.25f, 0.45f],
            ints: [8],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 4000f,
                SpawnMarginFraction = 0f,
                MannaSpawnMarginFraction = 0.1f,
                MannaRespawnDelaySeconds = 2f
            });

        Assert.True(world.TryAddPlayer("conn-1", "Ada").Success);
        Assert.True(world.TryAddPlayer("conn-2", "Bea").Success);
        StartRound(world, "conn-1");

        Assert.True(world.TrySetTarget("conn-2", 0f, 0f));
        Assert.True(world.TrySetTarget("conn-1", 0f, 0f));
        var spawn = world.TickAndSnapshot(1f);
        var snapshots = new List<WorldSnapshot> { spawn };
        WorldSnapshot? resolved = null;

        foreach (var pickup in spawn.Manna.Pickups)
        {
            if (world.Phase == GameWorld.RoundPhase.GameOver)
            {
                break;
            }

            Assert.True(world.TrySetTarget("conn-1", pickup.X, pickup.Y));
            var snapshot = world.TickAndSnapshot(1f);
            snapshots.Add(snapshot);
            if (snapshot.Events.Any(e => e.Type == "manna_cycle_resolved"))
            {
                resolved = snapshot;
                break;
            }
        }

        resolved ??= snapshots[^1];
        var ada = Assert.Single(resolved.Players, player => player.Name == "Ada");
        var bea = Assert.Single(resolved.Players, player => player.Name == "Bea");

        Assert.True(ada.IsAlive);
        Assert.True(ada.IsWinner);
        Assert.False(bea.IsAlive);
        Assert.Equal("starved", bea.DeathReason);
        Assert.True(resolved.GameOver);
        Assert.Equal(ada.Id, resolved.WinnerPlayerId);
        Assert.Contains(resolved.Events, e => e.Type == "manna_cycle_resolved" && e.CycleId == 1);
        Assert.Contains(resolved.Events, e => e.Type == "player_died" && e.PlayerId == bea.Id && e.Reason == "starved");
    }

    [Fact]
    public void PlayersOutsideCloudAreEliminatedWhenCloudResolves()
    {
        var world = CreateWorld(
            singles: [0f, 0f, 1f, 1f, 0.5f, 0.5f],
            ints: [5],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 2200f,
                SpawnMarginFraction = 0f,
                CloudCooldownSeconds = 0.05f,
                CloudActiveSeconds = 0.2f,
                CloudRadius = 120f,
                CloudCenterMinFractionX = 0.5f,
                CloudCenterMaxFractionX = 0.5f,
                CloudCenterMinFractionY = 0.5f,
                CloudCenterMaxFractionY = 0.5f
            });

        var ada = world.TryAddPlayer("conn-1", "Ada");
        var bea = world.TryAddPlayer("conn-2", "Bea");
        Assert.True(ada.Success);
        Assert.True(bea.Success);
        StartRound(world, "conn-1");

        var spawned = world.TickAndSnapshot(0.05f);
        var cloudX = spawned.Hazard.Cloud.X ?? throw new InvalidOperationException("Missing cloud center X.");
        var cloudY = spawned.Hazard.Cloud.Y ?? throw new InvalidOperationException("Missing cloud center Y.");
        Assert.True(world.TrySetTarget("conn-2", cloudX, cloudY));
        var cloudRadius = spawned.Hazard.Cloud.Radius ?? throw new InvalidOperationException("Missing cloud radius.");
        var expectedOutside = spawned.Players
            .Where(player => MathF.Sqrt(MathF.Pow(player.X - cloudX, 2) + MathF.Pow(player.Y - cloudY, 2)) > cloudRadius)
            .Select(player => player.Id)
            .ToHashSet(StringComparer.Ordinal);
        Assert.NotEmpty(expectedOutside);

        var snapshots = TickSeries(world, 8, 0.1f);
        var resolved = snapshots[^1];
        Assert.Contains(spawned.Events, eventSnapshot => eventSnapshot.Type == "cloud_spawned");
        Assert.Contains(snapshots.SelectMany(frame => frame.Events), eventSnapshot => eventSnapshot.Type == "cloud_resolved");
        foreach (var outsidePlayerId in expectedOutside)
        {
            var player = Assert.Single(resolved.Players, current => current.Id == outsidePlayerId);
            Assert.False(player.IsAlive);
            Assert.Equal("darkness", player.DeathReason);
        }
        Assert.Contains(snapshots.SelectMany(frame => frame.Events), eventSnapshot => eventSnapshot.Type == "player_died" && expectedOutside.Contains(eventSnapshot.PlayerId ?? string.Empty) && eventSnapshot.Reason == "darkness");
    }

    [Fact]
    public void WaveWarningMetadataIsHiddenWhenCloudIsNextAndAppearsWhenWaveBecomesNext()
    {
        var world = CreateWorld(
            singles: [0.5f, 0.5f, 0.5f, 0.5f],
            ints: [5, 0, 0],
            rules: new GameRules
            {
                WaveCooldownSeconds = 0.1f,
                WaveTravelSeconds = 1f,
                CloudCooldownSeconds = 0.05f,
                CloudActiveSeconds = 0.2f,
                HazardTransitionDelaySeconds = 0f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f
            });

        Assert.True(world.TryAddPlayer("conn-1", "Ada").Success);
        StartRound(world, "conn-1");

        var cloudSpawned = world.TickAndSnapshot(0.05f);
        Assert.True(cloudSpawned.Hazard.Cloud.IsActive);
        Assert.False(cloudSpawned.Hazard.Wave.IsActive);
        Assert.Null(cloudSpawned.Hazard.Wave.Side);
        Assert.Null(cloudSpawned.Hazard.Wave.SecondsUntilSpawn);
        Assert.False(cloudSpawned.Hazard.Wave.IsActive && cloudSpawned.Hazard.Cloud.IsActive);

        var cloudResolved = world.TickAndSnapshot(0.2f);
        Assert.False(cloudResolved.Hazard.Wave.IsActive);
        Assert.False(cloudResolved.Hazard.Cloud.IsActive);
        Assert.Equal("left", cloudResolved.Hazard.Wave.Side);
        Assert.InRange(cloudResolved.Hazard.Wave.SecondsUntilSpawn ?? -1f, 0.09f, 0.11f);

        var warning = world.TickAndSnapshot(0.05f);
        Assert.False(warning.Hazard.Wave.IsActive);
        Assert.False(warning.Hazard.Cloud.IsActive);
        Assert.Equal("left", warning.Hazard.Wave.Side);
        Assert.InRange(warning.Hazard.Wave.SecondsUntilSpawn ?? -1f, 0.04f, 0.06f);
        Assert.False(warning.Hazard.Wave.IsActive && warning.Hazard.Cloud.IsActive);
    }

    [Fact]
    public void HazardSelectionCanRepeatTheSameHazardKind()
    {
        var world = CreateWorld(
            singles: [0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f],
            ints: [0, 0, 0, 1],
            rules: new GameRules
            {
                WaveCooldownSeconds = 0.05f,
                WaveTravelSeconds = 0.1f,
                CloudCooldownSeconds = 0.05f,
                CloudActiveSeconds = 0.1f,
                HazardTransitionDelaySeconds = 0f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f
            });

        Assert.True(world.TryAddPlayer("conn-1", "Ada").Success);
        StartRound(world, "conn-1");

        var snapshots = TickSeries(world, 12, 0.05f);
        var spawnTypes = snapshots
            .SelectMany(frame => frame.Events)
            .Where(eventSnapshot => eventSnapshot.Type is "wave_spawned" or "cloud_spawned")
            .Select(eventSnapshot => eventSnapshot.Type)
            .ToArray();

        Assert.True(spawnTypes.Length >= 2);
        Assert.Equal("wave_spawned", spawnTypes[0]);
        Assert.Equal("wave_spawned", spawnTypes[1]);
    }

    [Fact]
    public void HazardSelectionCanChooseMannaPhase()
    {
        var world = CreateWorld(
            singles: [0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f],
            ints: [9],
            rules: new GameRules
            {
                HazardTransitionDelaySeconds = 0f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f
            });

        Assert.True(world.TryAddPlayer("conn-1", "Ada").Success);
        StartRound(world, "conn-1");

        var beforeSpawn = world.TickAndSnapshot(0.5f);
        Assert.False(beforeSpawn.Hazard.Wave.IsActive);
        Assert.False(beforeSpawn.Hazard.Cloud.IsActive);
        Assert.False(beforeSpawn.Manna.IsActive);
        Assert.Null(beforeSpawn.Hazard.Wave.Side);
        Assert.Null(beforeSpawn.Hazard.Wave.SecondsUntilSpawn);
        Assert.Null(beforeSpawn.Hazard.Cloud.SecondsUntilResolve);

        var spawned = world.TickAndSnapshot(0.5f);
        Assert.True(spawned.Manna.IsActive);
        Assert.Contains(spawned.Events, e => e.Type == "manna_cycle_spawned");
    }

    [Fact]
    public void AtMostOneHazardIsActiveAtAnyTime()
    {
        var world = CreateWorld(
            singles: Enumerable.Repeat(0.5f, 200),
            ints: Enumerable.Repeat(0, 80),
            rules: new GameRules
            {
                WaveCooldownSeconds = 0.08f,
                WaveTravelSeconds = 0.4f,
                CloudCooldownSeconds = 0.06f,
                CloudActiveSeconds = 0.3f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f
            });

        Assert.True(world.TryAddPlayer("conn-1", "Ada").Success);
        StartRound(world, "conn-1");

        var snapshots = TickSeries(world, 120, 0.05f);
        Assert.All(snapshots, snapshot =>
        {
            Assert.False(snapshot.Hazard.Wave.IsActive && snapshot.Hazard.Cloud.IsActive);
        });
    }

    [Fact]
    public void TransitionDelayAddsThreeSecondsBeforeTheNextHazard()
    {
        var world = CreateWorld(
            singles: [0.5f, 0.5f, 0.5f, 0.5f],
            ints: [5, 0, 0],
            rules: new GameRules
            {
                WaveCooldownSeconds = 0.1f,
                WaveTravelSeconds = 1f,
                CloudCooldownSeconds = 0.05f,
                CloudActiveSeconds = 0.2f,
                HazardTransitionDelaySeconds = 3f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f
            });

        Assert.True(world.TryAddPlayer("conn-1", "Ada").Success);
        StartRound(world, "conn-1");

        var cloudSpawned = world.TickAndSnapshot(0.05f);
        Assert.True(cloudSpawned.Hazard.Cloud.IsActive);

        var cloudResolved = world.TickAndSnapshot(0.2f);
        Assert.False(cloudResolved.Hazard.Cloud.IsActive);
        Assert.False(cloudResolved.Hazard.Wave.IsActive);
        Assert.Equal("left", cloudResolved.Hazard.Wave.Side);
        Assert.InRange(cloudResolved.Hazard.Wave.SecondsUntilSpawn ?? -1f, 3.05f, 3.15f);
    }

    [Fact]
    public void CollisionProducesBumpEventAndSeparatesPlayers()
    {
        var world = CreateWorld(
            singles: [0.1f, 0.1f, 0.12f, 0.12f],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f,
                PlayerCollisionRadius = 30f,
                CollisionBumpDistance = 18f
            });

        var a = world.TryAddPlayer("conn-a", "A");
        var b = world.TryAddPlayer("conn-b", "B");
        Assert.True(a.Success);
        Assert.True(b.Success);
        StartRound(world, "conn-a");

        var before = world.TickAndSnapshot(0.05f);
        var players = before.Players.OrderBy(player => player.Name).ToArray();

        Assert.Contains(before.Events, e => e.Type == "player_bumped");
        Assert.Equal(2, players.Length);
        Assert.True(Distance(players[0], players[1]) > 200f);
        Assert.All(players, player =>
        {
            Assert.True(player.IsAlive);
            Assert.False(player.IsWinner);
        });
    }

    [Fact]
    public void CollisionKnockbackResetsTargetsAndPreventsImmediateRepeatCollision()
    {
        var world = CreateWorld(
            singles: [0.1f, 0.1f, 0.12f, 0.12f],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 180f,
                SpawnMarginFraction = 0f,
                PlayerCollisionRadius = 30f,
                CollisionBumpDistance = 18f
            });

        var a = world.TryAddPlayer("conn-a", "A");
        var b = world.TryAddPlayer("conn-b", "B");
        Assert.True(a.Success);
        Assert.True(b.Success);
        StartRound(world, "conn-a");

        var first = world.TickAndSnapshot(0.05f);
        Assert.Contains(first.Events, e => e.Type == "player_bumped");
        var firstPlayers = first.Players.OrderBy(player => player.Name).ToArray();
        Assert.Equal(2, firstPlayers.Length);
        Assert.True(Distance(firstPlayers[0], firstPlayers[1]) > 200f);

        Assert.True(MathF.Abs(firstPlayers[0].TargetX - firstPlayers[0].X) < 0.01f);
        Assert.True(MathF.Abs(firstPlayers[0].TargetY - firstPlayers[0].Y) < 0.01f);
        Assert.True(MathF.Abs(firstPlayers[1].TargetX - firstPlayers[1].X) < 0.01f);
        Assert.True(MathF.Abs(firstPlayers[1].TargetY - firstPlayers[1].Y) < 0.01f);

        var second = world.TickAndSnapshot(0.05f);
        Assert.DoesNotContain(second.Events, e => e.Type == "player_bumped");
    }

    [Fact]
    public void WinnerDeclaredWhenOnlyOnePlayerRemainsAlive()
    {
        var world = CreateWorld(
            singles: [0.2f, 0.2f, 0.4f, 0.4f, 0.6f, 0.6f],
            ints: [8],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 4000f,
                SpawnMarginFraction = 0f,
                MannaPickupCount = 1
            });

        var one = world.TryAddPlayer("conn-1", "One");
        var two = world.TryAddPlayer("conn-2", "Two");
        var three = world.TryAddPlayer("conn-3", "Three");
        Assert.True(one.Success);
        Assert.True(two.Success);
        Assert.True(three.Success);
        StartRound(world, "conn-1");

        var spawn = world.TickAndSnapshot(1f);
        var pickup = Assert.Single(spawn.Manna.Pickups);
        Assert.True(world.TrySetTarget("conn-1", pickup.X, pickup.Y));
        var snapshot = world.TickAndSnapshot(1f);
        Assert.Contains(snapshot.Events, e => e.Type == "winner_declared");
        var winner = Assert.Single(snapshot.Players, player => player.IsAlive);

        Assert.True(snapshot.GameOver);
        Assert.Equal(winner.Id, snapshot.WinnerPlayerId);
        Assert.True(winner.IsWinner);
        Assert.Equal(winner.Id, snapshot.Events.Single(e => e.Type == "winner_declared").PlayerId);
    }

    [Fact]
    public void WaveCanEliminatePlayerOutsideTheGap()
    {
        var world = CreateWorld(
            singles: [0.5f, 0.25f, 0.9f, 0.95f, 0.9f, 0.5f],
            ints: [0, 0],
            rules: new GameRules
            {
                WaveCooldownSeconds = 0.05f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f
            });

        var ada = world.TryAddPlayer("conn-1", "Ada");
        var bea = world.TryAddPlayer("conn-2", "Bea");
        Assert.True(ada.Success);
        Assert.True(bea.Success);
        StartRound(world, "conn-1");

        var spawn = world.TickAndSnapshot(0.05f).Players.Single(player => player.Name == "Ada");
        Assert.True(spawn.IsAlive);

        var snapshots = TickSeries(world, 8, 0.1f);
        var snapshot = snapshots[^1];
        Assert.Contains(snapshots, frame => frame.Players.Any(player => player.Name == "Ada" && !player.IsAlive));
        var player = Assert.Single(snapshot.Players, current => current.Name == "Ada");

        Assert.False(player.IsAlive);
        Assert.Equal("wave", player.DeathReason);
        Assert.Contains(snapshots, frame => frame.Events.Any(e => e.Type == "player_died" && e.Reason == "wave"));
    }

    [Fact]
    public void PlayerInsideWaveGapSurvivesThePass()
    {
        var world = CreateWorld(
            singles: [0.5f, 0.25f, 0.5f, 0.5f, 0.5f],
            ints: [0, 0],
            rules: new GameRules
            {
                WaveCooldownSeconds = 0.05f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 2400f,
                SpawnMarginFraction = 0f
            });

        var ada = world.TryAddPlayer("conn-1", "Ada");
        Assert.True(ada.Success);
        StartRound(world, "conn-1");

        var spawned = world.TickAndSnapshot(0.05f);
        Assert.True(spawned.Hazard.Wave.IsActive);
        var gapStart = spawned.Hazard.Wave.GapStart ?? throw new InvalidOperationException("Missing wave gap start.");
        var gapEnd = spawned.Hazard.Wave.GapEnd ?? throw new InvalidOperationException("Missing wave gap end.");
        var playerAtSpawn = Assert.Single(spawned.Players);
        var gapCenter = (gapStart + gapEnd) * 0.5f;
        Assert.True(world.TrySetTarget("conn-1", playerAtSpawn.X, gapCenter));
        world.TickAndSnapshot(0.1f);

        var snapshots = TickSeries(world, 10, 0.1f);
        var finalSnapshot = snapshots[^1];
        var player = Assert.Single(finalSnapshot.Players);

        Assert.True(player.IsAlive);
        Assert.DoesNotContain(snapshots.SelectMany(frame => frame.Events), e => e.Type == "player_died" && e.PlayerId == player.Id && e.Reason == "wave");
    }

    [Fact]
    public void DeadPlayersCannotReceiveNewMovementTarget()
    {
        var world = CreateWorld(
            singles: [0.5f, 0.25f, 0.9f, 0.95f, 0.9f, 0.5f],
            ints: [0, 0],
            rules: new GameRules
            {
                WaveCooldownSeconds = 0.05f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f
            });

        Assert.True(world.TryAddPlayer("conn-1", "Ada").Success);
        Assert.True(world.TryAddPlayer("conn-2", "Bea").Success);
        StartRound(world, "conn-1");

        var deadSnapshot = TickSeries(world, 8, 0.1f)[^1];
        var ada = Assert.Single(deadSnapshot.Players, player => player.Name == "Ada");
        Assert.False(ada.IsAlive);

        var accepted = world.TrySetTarget("conn-1", 120f, 120f);
        Assert.False(accepted);
    }

    [Fact]
    public void StartRoundIsGatedToTheFirstConnectedPlayer()
    {
        var world = CreateWorld(
            singles: [0.2f, 0.4f, 0.6f, 0.8f],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f
            });

        var starter = world.TryAddPlayer("conn-1", "Starter");
        var guest = world.TryAddPlayer("conn-2", "Guest");
        Assert.True(starter.Success);
        Assert.True(guest.Success);

        var waiting = world.TickAndSnapshot(0.05f);
        Assert.Equal("WaitingToStart", waiting.Round.Phase);
        Assert.False(waiting.Hazard.Wave.IsActive);

        var denied = world.TryStartRound("conn-2");
        Assert.False(denied.Success);
        Assert.Equal("not_authorized", denied.Reason);

        var accepted = world.TryStartRound("conn-1");
        Assert.True(accepted.Success);
        Assert.Equal(starter.PlayerId, accepted.StarterId);

        var active = world.TickAndSnapshot(0.05f);
        Assert.Equal("Active", active.Round.Phase);
    }

    [Fact]
    public void RestartRoundIsGatedToTheFirstConnectedPlayer()
    {
        var world = CreateWorld(
            singles: [0.2f, 0.2f, 0.8f, 0.8f],
            ints: [8],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 4000f,
                SpawnMarginFraction = 0f,
                MannaPickupCount = 1
            });

        var starter = world.TryAddPlayer("conn-1", "Starter");
        var safe = world.TryAddPlayer("conn-2", "Safe");
        Assert.True(starter.Success);
        Assert.True(safe.Success);
        StartRound(world, "conn-1");

        var spawn = world.TickAndSnapshot(1f);
        var pickup = Assert.Single(spawn.Manna.Pickups);
        Assert.True(world.TrySetTarget("conn-1", pickup.X, pickup.Y));
        var resolved = world.TickAndSnapshot(1f);
        Assert.True(resolved.GameOver);

        var denied = world.TryRestartRound("conn-2");
        Assert.False(denied.Success);
        Assert.Equal("not_authorized", denied.Reason);

        var accepted = world.TryRestartRound("conn-1");
        Assert.True(accepted.Success);
        Assert.Equal(starter.PlayerId, accepted.StarterId);

        var restarted = world.TickAndSnapshot(0.05f);
        Assert.Equal("WaitingToStart", restarted.Round.Phase);
        Assert.False(restarted.GameOver);
    }

    [Fact]
    public void RestartRoundRespawnsPlayersAtNewRandomPositions()
    {
        var world = CreateWorld(
            singles: [0.05f, 0.05f, 0.95f, 0.95f, 0.5f, 0.5f, 0.25f, 0.30f, 0.70f, 0.75f],
            ints: [8, 0, 0],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 4000f,
                SpawnMarginFraction = 0f,
                MannaPickupCount = 1
            });

        var starter = world.TryAddPlayer("conn-1", "Starter");
        var guest = world.TryAddPlayer("conn-2", "Guest");
        Assert.True(starter.Success);
        Assert.True(guest.Success);
        StartRound(world, "conn-1");

        var beforeRestart = world.TickAndSnapshot(0.01f).Players.ToDictionary(player => player.Id, player => (player.X, player.Y));
        var mannaSpawn = world.TickAndSnapshot(0.99f);
        var pickup = Assert.Single(mannaSpawn.Manna.Pickups);
        Assert.True(world.TrySetTarget("conn-1", pickup.X, pickup.Y));
        var resolved = world.TickAndSnapshot(1f);
        Assert.True(resolved.GameOver);

        var restart = world.TryRestartRound("conn-1");
        Assert.True(restart.Success);
        var restarted = world.TickAndSnapshot(0.01f);
        Assert.Equal("WaitingToStart", restarted.Round.Phase);

        foreach (var player in restarted.Players)
        {
            Assert.True(player.IsAlive);
            Assert.True(beforeRestart.TryGetValue(player.Id, out var previous));
            Assert.NotEqual(previous.X, player.X);
            Assert.NotEqual(previous.Y, player.Y);
            Assert.InRange(player.X, 0f, GameWorld.WorldWidth);
            Assert.InRange(player.Y, 0f, GameWorld.WorldHeight);
        }
    }

    [Fact]
    public void EmptyRoomResetsTheWorldAutomatically()
    {
        var world = CreateWorld(
            singles: [0.1f, 0.2f, 0.3f, 0.4f],
            rules: new GameRules
            {
                WaveCooldownSeconds = 999f,
                WaveTravelSeconds = 1f,
                MoveSpeed = 0f,
                SpawnMarginFraction = 0f
            });

        var starter = world.TryAddPlayer("conn-1", "Starter");
        var guest = world.TryAddPlayer("conn-2", "Guest");
        Assert.True(starter.Success);
        Assert.True(guest.Success);
        StartRound(world, "conn-1");

        world.RemovePlayer("conn-1");
        world.RemovePlayer("conn-2");

        var snapshot = world.TickAndSnapshot(0.05f);

        Assert.Empty(snapshot.Players);
        Assert.Equal("WaitingToStart", snapshot.Round.Phase);
        Assert.Null(snapshot.Round.FirstPlayerId);
        Assert.Null(snapshot.Round.StarterId);
        Assert.Null(snapshot.WinnerPlayerId);
        Assert.False(snapshot.GameOver);
        Assert.False(snapshot.Hazard.Wave.IsActive);
    }

    [Fact]
    public void PhysicsPlayerFallsAndLandsAtGround()
    {
        // Spawn high up; gravity should settle player at GroundY
        var world = CreateWorld(
            singles: [0.5f, 0.1f], // X=512, Y≈77
            rules: new GameRules { WaveCooldownSeconds = 999f, WaveTravelSeconds = 1f, SpawnMarginFraction = 0f });

        world.TryAddPlayer("conn-1", "Ada");
        world.TrySetInput("conn-1", 0, false);
        StartRound(world, "conn-1");

        var snapshot = Tick(world, 50, 0.05f); // 2.5 s — enough to fall from anywhere
        var player = Assert.Single(snapshot.Players);

        Assert.InRange(player.Y, GameWorld.GroundY - 0.5f, GameWorld.GroundY + 0.5f);
    }

    [Fact]
    public void PhysicsPlayerLandsOnPlatformFromAbove()
    {
        // Spawn directly above the left-low platform (cx=150, surfaceY=597, width=200).
        // At X=150 no other platform is in range, so the player must land at Y=570 (surfaceY-27).
        var world = CreateWorld(
            singles: [150f / GameWorld.WorldWidth, 200f / GameWorld.WorldHeight],
            rules: new GameRules { WaveCooldownSeconds = 999f, WaveTravelSeconds = 1f, SpawnMarginFraction = 0f });

        world.TryAddPlayer("conn-1", "Ada");
        world.TrySetInput("conn-1", 0, false);
        StartRound(world, "conn-1");

        var snapshot = Tick(world, 40, 0.05f);
        var player = Assert.Single(snapshot.Players);

        Assert.InRange(player.Y, 569f, 571f); // left-low landing Y = 597 - 27 = 570
    }

    [Fact]
    public void PhysicsJumpFromGroundLandsOnPlatform()
    {
        // Spawn on ground at X=150 (left-low platform range), jump, expect to land on the platform.
        // Jump apex ≈ Y=492 (feet≈519), which clears the platform surface at Y=597, so the player
        // lands there on the way down rather than falling all the way back to the ground.
        var world = CreateWorld(
            singles: [150f / GameWorld.WorldWidth, GameWorld.GroundY / GameWorld.WorldHeight],
            rules: new GameRules { WaveCooldownSeconds = 999f, WaveTravelSeconds = 1f, SpawnMarginFraction = 0f });

        world.TryAddPlayer("conn-1", "Ada");
        world.TrySetInput("conn-1", 0, false);
        StartRound(world, "conn-1");

        world.TickAndSnapshot(0.05f);                  // settle on ground
        world.TrySetInput("conn-1", 0, true);           // request jump
        world.TickAndSnapshot(0.05f);                  // jump executes
        var snapshot = Tick(world, 25, 0.05f);          // arc plays out; landing at ~tick 21

        var player = Assert.Single(snapshot.Players);
        Assert.InRange(player.Y, 569f, 571f);          // left-low landing Y = 570
    }

    private static GameWorld CreateWorld(IEnumerable<float> singles, IEnumerable<int>? ints = null, GameRules? rules = null)
    {
        return new GameWorld(new ScriptedGameRandom(singles, ints), rules);
    }

    private static void StartRound(GameWorld world, string connectionId)
    {
        var result = world.TryStartRound(connectionId);
        Assert.True(result.Success, result.Reason);
    }

    private static WorldSnapshot Tick(GameWorld world, int count, float deltaSeconds)
    {
        var snapshot = default(WorldSnapshot)!;
        for (var index = 0; index < count; index += 1)
        {
            snapshot = world.TickAndSnapshot(deltaSeconds);
        }

        return snapshot;
    }

    private static WorldSnapshot[] TickSeries(GameWorld world, int count, float deltaSeconds)
    {
        var snapshots = new WorldSnapshot[count];
        for (var index = 0; index < count; index += 1)
        {
            snapshots[index] = world.TickAndSnapshot(deltaSeconds);
        }

        return snapshots;
    }

    private static float Distance(PlayerSnapshot left, PlayerSnapshot right)
    {
        var dx = left.X - right.X;
        var dy = left.Y - right.Y;
        return MathF.Sqrt((dx * dx) + (dy * dy));
    }
}
