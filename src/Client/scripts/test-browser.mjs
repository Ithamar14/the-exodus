#!/usr/bin/env node

import { closeSync, openSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(scriptDir, "..");
const serverDir = path.resolve(clientDir, "..", "Server");
const playwrightBin = path.join(clientDir, "node_modules", ".bin", "playwright");
const dotnetBin = process.env.DOTNET_BIN ?? "dotnet";
const npmBin = process.env.NPM_BIN ?? "npm";
const readinessTimeoutMs = Number.parseInt(process.env.TEST_BROWSER_TIMEOUT_MS ?? "240000", 10);
const tmpDir = process.env.TMPDIR ?? "/tmp";
const runId = process.pid;
const backendLogPath = path.join(tmpDir, `desert-backend-browser-${runId}.log`);
const frontendLogPath = path.join(tmpDir, `desert-frontend-browser-${runId}.log`);
const playwrightLogPath = path.join(tmpDir, `desert-playwright-browser-${runId}.log`);

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate a local port.")));
        return;
      }

      const port = address.port;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve(port);
      });
    });
  });
}

function tailFile(filePath, maxBytes = 12000) {
  try {
    const text = readFileSync(filePath, "utf8");
    return text.length > maxBytes ? text.slice(-maxBytes).trimStart() : text.trimEnd();
  } catch {
    return "";
  }
}

function spawnLoggedProcess(command, args, cwd, logPath, extraEnv = {}) {
  const logFd = openSync(logPath, "w");
  try {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      env: {
        ...process.env,
        ...extraEnv,
        CI: "1"
      },
      stdio: ["ignore", logFd, logFd]
    });

    const state = { error: null, code: null, signal: null };
    const done = new Promise((resolve) => {
      child.once("error", (error) => {
        state.error = error;
        resolve({ code: null, signal: null });
      });
      child.once("exit", (code, signal) => {
        state.code = code;
        state.signal = signal;
        resolve({ code, signal });
      });
    });

    return {
      child,
      done,
      logPath,
      getExitInfo: () => {
        if (state.error || state.code != null || state.signal != null) {
          return { error: state.error, code: state.code, signal: state.signal };
        }
        return null;
      }
    };
  } finally {
    closeSync(logFd);
  }
}

async function waitForUrl(url, name, processHandle) {
  const deadline = Date.now() + readinessTimeoutMs;
  let nextProgressAt = Date.now() + 5000;
  while (Date.now() < deadline) {
    const exitInfo = processHandle.getExitInfo();
    if (exitInfo) {
      const logs = tailFile(processHandle.logPath);
      if (exitInfo.error) {
        throw new Error(`${name} failed to start: ${exitInfo.error.message}\n${logs}`);
      }

      throw new Error(`${name} exited before becoming ready (${exitInfo.code ?? exitInfo.signal ?? "unknown"})\n${logs}`);
    }

    if (Date.now() >= nextProgressAt) {
      console.log(`[browser] waiting for ${name.toLowerCase()} at ${url}`);
      nextProgressAt = Date.now() + 5000;
    }

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the process is ready or exits.
    }

    await delay(500);
  }

  throw new Error(`${name} did not become ready at ${url}\n${tailFile(processHandle.logPath)}`);
}

async function stopProcess(processHandle) {
  if (!processHandle?.child?.pid) {
    return;
  }

  const killTargets = [-processHandle.child.pid, processHandle.child.pid];
  for (const target of killTargets) {
    try {
      process.kill(target, "SIGTERM");
      break;
    } catch {
      // Try the next target or ignore if the process already exited.
    }
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const exitInfo = processHandle.getExitInfo();
    if (exitInfo) {
      return;
    }
    await delay(100);
  }

  for (const target of killTargets) {
    try {
      process.kill(target, "SIGKILL");
      break;
    } catch {
      // Ignore if the process already exited or cannot be killed.
    }
  }
}

async function main() {
  const backendPort = await findFreePort();
  const frontendPort = await findFreePort();
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;

  const backend = spawnLoggedProcess(
    dotnetBin,
    ["run", "--no-launch-profile", "--", "--urls", backendUrl],
    serverDir,
    backendLogPath,
    {
      ASPNETCORE_URLS: backendUrl,
      BACKEND_URL: backendUrl
    }
  );

  console.log(`[browser] backend log: ${backend.logPath}`);

  try {
    await waitForUrl(`${backendUrl}/health`, "Backend", backend);

    const frontend = spawnLoggedProcess(
      npmBin,
      ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"],
      clientDir,
      frontendLogPath,
      {
        BACKEND_URL: backendUrl,
        PLAYWRIGHT_BASE_URL: frontendUrl
      }
    );

    console.log(`[browser] frontend log: ${frontend.logPath}`);

    try {
      await waitForUrl(frontendUrl, "Frontend", frontend);

      const playwright = spawnLoggedProcess(
        playwrightBin,
        ["test", "tests/browser-regression.spec.ts"],
        clientDir,
        playwrightLogPath,
        {
          BACKEND_URL: backendUrl,
          PLAYWRIGHT_BASE_URL: frontendUrl
        }
      );

      console.log(`[browser] playwright log: ${playwright.logPath}`);

      try {
        const heartbeat = setInterval(() => {
          console.log("[browser] playwright scenario still running");
        }, 5000);
        try {
          const result = await playwright.done;
          const exitInfo = playwright.getExitInfo();
          if (exitInfo?.error) {
            throw new Error(`Playwright failed to launch: ${exitInfo.error.message}\n${tailFile(playwright.logPath)}`);
          }
          if (result.code !== 0) {
            throw new Error(`Playwright failed with exit code ${result.code ?? "null"}\n${tailFile(playwright.logPath)}`);
          }
        } finally {
          clearInterval(heartbeat);
        }
      } finally {
        await stopProcess(playwright);
      }
    } finally {
      await stopProcess(frontend);
    }
  } finally {
    await stopProcess(backend);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
