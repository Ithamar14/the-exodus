#!/usr/bin/env node
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(scriptDir, "..");
const sourceDir = path.join(clientDir, "dist");
const targetDir = path.resolve(clientDir, "..", "Server", "wwwroot");

await rm(targetDir, { recursive: true, force: true });
await mkdir(path.dirname(targetDir), { recursive: true });
await cp(sourceDir, targetDir, { recursive: true });
