import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 15_000
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4174",
    launchOptions: {
      executablePath: "/usr/bin/chromium"
    }
  }
});
