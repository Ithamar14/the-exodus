# Gameplay Verification Matrix

This file defines how each gameplay mechanic is verified going forward.

## Automated Commands

Run from repo root:

```bash
dotnet test src/Server/Tests/Server.Tests.csproj
cd src/Client && npm test
cd src/Client && npm run test:browser
```

Notes:
- `npm run test:browser` boots a local server + Vite and runs Playwright.
- Container tooling is not part of gameplay verification.

## Mechanic Coverage

| Mechanic | Verification Path | Test(s) |
| --- | --- | --- |
| Name validation (1-20 chars) | Backend unit | `GameWorldTests.JoinValidationRejectsInvalidNamesAndDuplicateConnection` |
| Duplicate join rejected | Backend unit | `GameWorldTests.JoinValidationRejectsInvalidNamesAndDuplicateConnection` |
| Max 6 players | Backend unit | `GameWorldTests.RoomCapacityIsLimitedToSixPlayers` |
| First player controls start | Backend unit | `GameWorldTests.StartRoundIsGatedToTheFirstConnectedPlayer` |
| First player controls restart | Backend unit | `GameWorldTests.RestartRoundIsGatedToTheFirstConnectedPlayer` |
| Restart respawns players at new random positions | Backend unit | `GameWorldTests.RestartRoundRespawnsPlayersAtNewRandomPositions` |
| Solo round remains playable | Backend unit | `GameWorldTests.SoloStartedRoundStaysPlayable` |
| Movement allowed before start | Backend unit | `GameWorldTests.PlayersCanMoveBeforeTheRoundStarts` |
| Target intent clamped to world | Backend unit | `GameWorldTests.TargetIsClampedToWorldBounds` |
| Dead players cannot move | Backend unit | `GameWorldTests.DeadPlayersCannotReceiveNewMovementTarget` |
| Collision bumps launch players far apart | Backend unit | `GameWorldTests.CollisionProducesBumpEventAndSeparatesPlayers` |
| Collision reset prevents jitter-lock | Backend unit | `GameWorldTests.CollisionKnockbackResetsTargetsAndPreventsImmediateRepeatCollision` |
| Pillar cloud spawn metadata is emitted | Backend unit | `GameWorldTests.CloudHazardSpawnsWithExpectedMetadata` |
| Players outside pillar cloud are eliminated on resolve | Backend unit | `GameWorldTests.PlayersOutsideCloudAreEliminatedWhenCloudResolves` |
| Manna spawns randomly across map | Backend unit | `GameWorldTests.MannaCycleSpawnsRandomlyAcrossMap` |
| Manna blinks after 5s and expires after 10s | Backend unit | `GameWorldTests.MannaCycleBlinksAfterFiveSecondsAndExpiresAfterTenSeconds` |
| Wave warning metadata available 5s pre-spawn | Backend unit | `GameWorldTests.WaveWarningMetadataIsAvailableFiveSecondsBeforeSpawn` |
| Wave spawns with deterministic gap | Backend unit | `GameWorldTests.WaveSpawnsWithGapAndAdvancesDeterministically` |
| Wave kills players outside gap | Backend unit | `GameWorldTests.WaveCanEliminatePlayerOutsideTheGap` |
| Wave allows players inside gap | Backend unit | `GameWorldTests.PlayerInsideWaveGapSurvivesThePass` |
| Manna cycle spawn + collection events | Backend unit | `GameWorldTests.MannaCycleSpawnsAndTracksCollection` |
| Missing manna causes starvation elimination | Backend unit | `GameWorldTests.PlayersWhoMissMannaDieWhenCycleCompletes` |
| Winner declared when one survives | Backend unit | `GameWorldTests.WinnerDeclaredWhenOnlyOnePlayerRemainsAlive` |
| Empty room reset behavior | Backend unit | `GameWorldTests.EmptyRoomResetsTheWorldAutomatically` |
| Client status derivation / winner mapping | Frontend unit | `model.test.ts` (`derives winner...`, `falls back to a death event...`) |
| Wave segment rendering math | Frontend unit | `model.test.ts` (`splits a top wave...`, `positions a bottom wave...`) |
| Round control rendering state | Frontend unit | `model.test.ts` (`derives round control visibility...`) |
| Cloud darkness model integration remains protocol-safe when cloud is inactive | Frontend unit | `model.test.ts` (round/status + hazard derivation suite) |
| Manna fallback + status labels | Frontend unit | `model.test.ts` (`synthesizes a manna cycle...`, `shows manna-fed status...`) |
| Join/start/move loop in browser | Browser e2e | `browser-regression.spec.ts` (`solo start stays active...`) |
| Wave + manna + pillar cloud state reflected in UI | Browser e2e | `browser-regression.spec.ts` (`wave, manna, and pillar cloud states are reflected...`) |
| Walk sway transform changes while moving | Browser e2e | `browser-regression.spec.ts` (`walking sway uses transform changes...`) |
| Y-based depth sort tracks player y | Browser e2e | `browser-regression.spec.ts` (`walking sway uses transform changes...`) |

## Manual Spot Check (Fast)

Use this after automated tests pass:

1. Start server and open two browser tabs.
2. Join two players and start round.
3. Confirm both players visible, names shown below avatars.
4. Click/tap to move and confirm local avatar moves toward target.
5. Wait for wave/manna cycle and confirm UI summaries update.
6. Confirm walking sway is visible while moving and stops at idle.
7. Confirm player lower on screen visually layers in front.
