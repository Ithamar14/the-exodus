import { expect, test, type Page } from "@playwright/test";

type DebugAvatar = {
  id: string;
  x: number;
  y: number;
  depth: number;
  moving: boolean;
  figureRotation: number;
  rootRotation: number;
  legFrontRotation: number;
  legBackRotation: number;
  armFrontRotation: number;
  armBackRotation: number;
  emoteText: string;
  emoteVisible: boolean;
  emoteExpiresInMs: number;
};

type DebugState = {
  serverTimeMs: number;
  cloudActive: boolean;
  waveActive: boolean;
  mannaActive: boolean;
  mannaPhase: "inactive" | "steady" | "blink" | "expired";
  avatars: DebugAvatar[];
};

async function joinWanderer(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#connection-badge")).toHaveText("Connected");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator("#game-root")).toHaveAttribute("data-self-joined", "true", { timeout: 30_000 });
  await expect(page.locator("#player-list")).toContainText(name, { timeout: 30_000 });
}

test("solo start stays active and click-to-move changes local target and position", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await page.goto("/");

  await expect(page).toHaveTitle("The Exodus");
  await expect(page.getByRole("heading", { name: "The Exodus" })).toBeVisible();
  await expect(page.locator("#connection-badge")).toHaveText("Connected");
  await expect(page.locator("#game-root canvas")).toBeVisible();

  await page.getByLabel("Name").fill("Alpha");
  await page.getByRole("button", { name: "Join" }).click();

  const gameRoot = page.locator("#game-root");
  await expect(page.locator("#game-root")).toHaveAttribute("data-self-joined", "true", { timeout: 30_000 });
  await expect(page.locator("#player-list")).toContainText("Alpha", { timeout: 30_000 });
  await expect(page.locator("#player-count")).toHaveText("1", { timeout: 30_000 });
  const startButton = page.getByRole("button", { name: "START" });
  await expect(startButton).toBeVisible();
  await expect(startButton).toBeEnabled();
  await expect(page.locator("#round-state")).toContainText("Waiting to start");
  await startButton.click({ force: true });

  await expect(page.locator("#round-state")).toContainText("Active");
  await expect(page.locator("#game-root")).toHaveAttribute("data-round-state", "active");
  await page.waitForTimeout(1200);
  await expect(page.locator("#game-root")).toHaveAttribute("data-round-state", "active");

  const canvas = page.locator("#game-root canvas");
  await expect.poll(async () => gameRoot.getAttribute("data-self-target-x"), {
    timeout: 15_000
  }).not.toBeNull();

  const readDebugState = async () => {
    const [x, y, targetX, targetY] = await Promise.all([
      gameRoot.getAttribute("data-self-x"),
      gameRoot.getAttribute("data-self-y"),
      gameRoot.getAttribute("data-self-target-x"),
      gameRoot.getAttribute("data-self-target-y")
    ]);

    return {
      x: Number(x),
      y: Number(y),
      targetX: Number(targetX),
      targetY: Number(targetY)
    };
  };

  const before = await readDebugState();
  expect(Number.isFinite(before.targetX)).toBe(true);
  expect(Number.isFinite(before.targetY)).toBe(true);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const clickPosition = {
    x: Math.max(24, Math.round(box!.width * 0.82)),
    y: Math.max(24, Math.round(box!.height * 0.24))
  };

  await canvas.click({ position: clickPosition });

  let afterClickTarget = before;
  await expect.poll(async () => {
    afterClickTarget = await readDebugState();
    return afterClickTarget.targetX === before.targetX && afterClickTarget.targetY === before.targetY;
  }, { timeout: 20_000 }).toBe(false);

  await expect.poll(async () => {
    const current = await readDebugState();
    return Number.isFinite(current.x) && Number.isFinite(current.y);
  }, { timeout: 20_000 }).toBe(true);

  const afterClickPosition = await readDebugState();
  const initialDistanceToNewTarget = Math.hypot(afterClickPosition.x - afterClickTarget.targetX, afterClickPosition.y - afterClickTarget.targetY);
  expect(initialDistanceToNewTarget).toBeGreaterThan(20);

  await page.waitForTimeout(1200);
  const later = await readDebugState();
  expect(Math.hypot(later.x - afterClickTarget.targetX, later.y - afterClickTarget.targetY)).toBeLessThan(initialDistanceToNewTarget - 3);

  expect(
    consoleErrors.filter((message) => !message.includes("Failed to load resource: the server responded with a status of 404 (Not Found)"))
  ).toEqual([]);
});

test("wave, manna, and pillar cloud states are reflected in the debug dataset", async ({ page }) => {
  test.setTimeout(180_000);
  const waitUntil = async (predicate: () => Promise<boolean>, timeoutMs: number): Promise<boolean> => {
    const startedAt = Date.now();
    while ((Date.now() - startedAt) < timeoutMs) {
      if (await predicate()) {
        return true;
      }

      await page.waitForTimeout(250);
    }

    return false;
  };

  await joinWanderer(page, "HazardWatcher");

  const startButton = page.getByRole("button", { name: "START" });
  await expect(startButton).toBeVisible();
  await startButton.click({ force: true });

  await expect(page.locator("#game-root")).toHaveAttribute("data-round-state", "active");
  await expect(page.locator("#wave-notice")).toHaveText("וַיָּבֹאוּ בְנֵי-יִשְׂרָאֵל בְּתוֹךְ הַיָּם, בַּיַּבָּשָׁה");
  await expect(page.locator("#cloud-notice")).toHaveText("וַה' הֹלֵךְ לִפְנֵיהֶם יוֹמָם בְּעַמּוּד עָנָן לַנְחֹתָם הַדֶּרֶךְ");
  const mannaSeen = await waitUntil(async () => {
    const mannaState = await page.locator("#game-root").getAttribute("data-manna");
    return mannaState === "active";
  }, 60_000);
  if (mannaSeen) {
    await expect(page.locator("#manna-notice")).toHaveText("הִנְנִי מַמְטִיר לָכֶם מָן מִן-הַשָּׁמָיִם");
    await expect(page.locator("#manna-notice")).toBeVisible();
    await expect.poll(async () => page.locator("#game-root").getAttribute("data-manna-phase"), { timeout: 20_000 }).toBe("blink");
  }

  const waveWarningSeen = await waitUntil(async () => {
    const warningHidden = await page.locator("#wave-warning").evaluate((el) => el.classList.contains("hidden"));
    return !warningHidden;
  }, 45_000);
  if (waveWarningSeen) {
    const warningSide = await page.locator("#wave-warning").getAttribute("data-side");
    const waveState = await page.locator("#game-root").getAttribute("data-wave");
    expect(warningSide).not.toBeNull();
    expect(/left|right|top|bottom/.test(warningSide ?? "")).toBe(true);
    expect(waveState).toBe("paused");
    await expect(page.locator("#wave-notice")).toBeVisible();
  }

  const cloudSeen = await waitUntil(async () => {
    const cloudState = await page.locator("#game-root").getAttribute("data-cloud");
    return cloudState === "active";
  }, 60_000);
  if (cloudSeen) {
    await expect(page.locator("#cloud-notice")).toBeVisible();
  }
});

test("emotes stay visible for five seconds and refresh cleanly when spammed", async ({ page }) => {
  await joinWanderer(page, "Emoter");
  await page.getByRole("button", { name: "START" }).click({ force: true });

  await page.locator("body").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("1");
  await page.waitForTimeout(120);
  await page.keyboard.press("2");
  await page.waitForTimeout(120);
  await page.keyboard.press("3");

  await expect.poll(async () => {
    const debug = await page.evaluate(() => window.__desertDebugState ?? null);
    const self = debug?.avatars[0];
    return self?.emoteText ?? null;
  }, { timeout: 20_000 }).toBe("🥖");

  await expect.poll(async () => {
    const debug = await page.evaluate(() => window.__desertDebugState ?? null);
    const self = debug?.avatars[0];
    return self?.emoteVisible ?? false;
  }, { timeout: 20_000 }).toBe(true);

  await expect.poll(async () => {
    const debug = await page.evaluate(() => window.__desertDebugState ?? null);
    const self = debug?.avatars[0];
    return self?.emoteExpiresInMs ?? 0;
  }, { timeout: 20_000 }).toBeGreaterThan(4500);

  await page.waitForTimeout(5400);
  const expired = await page.evaluate(() => window.__desertDebugState ?? null);
  const self = expired?.avatars[0];
  expect(self?.emoteVisible).toBe(false);
  expect(self?.emoteText).toBe("");
});

test("walking sway uses transform changes and avatar depth tracks y position", async ({ browser }) => {
  const alphaContext = await browser.newContext();
  const betaContext = await browser.newContext();
  try {
    const alpha = await alphaContext.newPage();
    const beta = await betaContext.newPage();

    await joinWanderer(alpha, "Alpha");
    await joinWanderer(beta, "Beta");
    await expect(alpha.locator("#player-count")).toHaveText("2", { timeout: 30_000 });
    await expect.poll(async () => alpha.locator("#layout").evaluate((el) => el.classList.contains("menu-hidden")), { timeout: 30_000 }).toBe(false);
    await expect.poll(async () => beta.locator("#layout").evaluate((el) => el.classList.contains("menu-hidden")), { timeout: 30_000 }).toBe(true);

    const startButton = alpha.getByRole("button", { name: "START" });
    await expect(startButton).toBeVisible();
    await startButton.click({ force: true });
    await expect(alpha.locator("#round-state")).toContainText("Active");

    const canvas = alpha.locator("#game-root canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await canvas.click({
      position: {
        x: Math.max(28, Math.round(box!.width * 0.82)),
        y: Math.max(28, Math.round(box!.height * 0.74))
      }
    });

    const readDebug = async (): Promise<DebugState | null> => alpha.evaluate(() => window.__desertDebugState ?? null);

    await expect.poll(async () => {
      const debug = await readDebug();
      if (!debug) {
        return false;
      }
      const moving = debug.avatars.find((avatar) => avatar.moving);
      return Boolean(moving);
    }, { timeout: 20_000 }).toBe(true);

    let first: DebugState | null = null;
    let later: DebugState | null = null;
    await expect.poll(async () => {
      first = await readDebug();
      await alpha.waitForTimeout(220);
      later = await readDebug();
      if (!first || !later) {
        return false;
      }
      const trackedId = first.avatars.find((avatar) => avatar.moving)?.id ?? first.avatars[0]?.id;
      if (!trackedId) {
        return false;
      }
      const a0 = first.avatars.find((avatar) => avatar.id === trackedId);
      const a1 = later.avatars.find((avatar) => avatar.id === trackedId);
      if (!a0 || !a1) {
        return false;
      }
      return Math.abs(a1.legFrontRotation - a0.legFrontRotation) > 0.02 || Math.abs(a1.figureRotation - a0.figureRotation) > 0.01;
    }, { timeout: 20_000 }).toBe(true);

    expect(later).not.toBeNull();
    const avatars = later!.avatars;
    expect(avatars.length).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < avatars.length; i += 1) {
      for (let j = i + 1; j < avatars.length; j += 1) {
        const a = avatars[i];
        const b = avatars[j];
        if (a.depth >= 900 || b.depth >= 900) {
          continue;
        }
        if (Math.abs(a.y - b.y) <= 0.5) {
          continue;
        }

        if (a.y < b.y) {
          expect(a.depth).toBeLessThan(b.depth);
        } else {
          expect(a.depth).toBeGreaterThan(b.depth);
        }
      }
    }
    for (const avatar of avatars) {
      if (avatar.depth >= 900) {
        continue;
      }
      expect(Math.abs(avatar.depth - avatar.y)).toBeLessThan(1.5);
    }
  } finally {
    await alphaContext.close();
    await betaContext.close();
  }
});
