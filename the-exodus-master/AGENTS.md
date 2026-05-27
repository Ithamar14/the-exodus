# AGENTS.md

This file defines how Codex agents should operate in this repository.
Product requirements live in `docs/product-scope.md`.

## Current Phase
MVP continuation and stabilization (not expansion).

## Working Model (Best-Practice For This Repo)
- Use one coding agent by default.
- Stay on one branch (offline workflow; no PR requirement).
- Keep changes small, focused, and shippable.
- Do not run parallel implementation agents unless explicitly requested.

Why: with offline/single-branch development, one active coding stream reduces merge risk and review overhead.

## Source-of-Truth Docs
- Product scope: `docs/product-scope.md`
- Realtime protocol: `docs/protocol.md`
- Verification matrix: `docs/gameplay-verification.md`

## Definition of Done (Per Version)
A version is only complete when all are true:
1. Build succeeds.
2. Automated tests pass.
3. Full regression verification is run before serving the build to the user.
4. Manual visual inspection and play check are completed.
5. Any protocol changes are reflected in `docs/protocol.md`.
6. Any changed behavior is reflected in tests and docs.
7. Every new feature includes unit tests.

## Required Validation Commands
Run from repo root unless noted:
1. `dotnet test src/Server/Tests/Server.Tests.csproj`
2. `cd src/Client && npm test`
3. `cd src/Client && npm run test:browser`
4. `cd src/Client && npm run build`

## Pre-Serve Gate
- Do not present a build to the user until build + tests + play verification are complete.
- If any verification step fails, fix first and re-run the failed step plus affected regressions.
- When reporting completion of code changes, start the local server on `http://localhost:55435` unless the user asks not to.

## Protocol Compatibility Rule
If a hub method payload or snapshot shape changes, do all of the following in the same version:
1. Update server implementation.
2. Update client consumption.
3. Update `docs/protocol.md`.
4. Update/add backend/frontend tests for the changed contract.

## Anti-Overbuild Guardrails
- Prefer minimal fixes over broad refactors.
- Do not add persistence/auth/lobby/matchmaking.
- Do not introduce heavy frameworks.
- Defer nice-to-have polish unless it removes current MVP friction.

## Build & Release Protocol

### Local vs Main Build
- All active development happens on the **local build** (current working branch).
- The **main build** is the stable, versioned, published state.
- **Never push to main without the user explicitly asking and confirming.**
- When the user asks to push to main, confirm the action before executing.

### Version Bumping
- **Never bump the version without explicit user confirmation.**
- When a push to main is requested, ask: "Should I bump the version? If so, what level — patch / minor / major?"
- On confirmation, update the version in `src/Client/package.json` and add a new entry to `VERSION_HISTORY.md`.
- Version format follows semantic versioning: `MAJOR.MINOR.PATCH`.

### VERSION_HISTORY.md
- Every version pushed to main must have a corresponding entry in `VERSION_HISTORY.md`.
- Each entry should include: version number, status, what changed, and any known limitations.

## Completion Report Format
When finishing a version, report:
1. What changed.
2. Validation commands run and pass/fail.
3. Manual visual/play checks performed.
4. Open risks (if any).
