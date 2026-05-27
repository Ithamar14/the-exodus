# Codex Version Checklist

Before marking a version done:

1. Build
- `cd src/Client && npm run build`

2. Tests
- `dotnet test src/Server/Tests/Server.Tests.csproj`
- `cd src/Client && npm test`
- `cd src/Client && npm run test:browser`

3. Visual inspection
- Run app locally.
- Join at least two clients.
- Verify movement intent, sway animation, name labels, y-sort depth behavior.
- Play a short real flow to catch regressions (join, move, round interaction).

4. Feature test rule
- Any new feature in this version must include unit tests.

5. Contract consistency
- If protocol changed, update `docs/protocol.md` and related tests.

6. Pre-serve gate
- Do not serve the build to the user until steps 1-5 are complete and passing.
- Before reporting back, start the server on `http://localhost:55435` unless the user says not to.

7. Ship note
- Record changed files and any known residual risk.
