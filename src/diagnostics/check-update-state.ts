#!/usr/bin/env bun
/**
 * One-shot report of Superhuman auto-update state.
 *
 * Checks:
 * - Pending update installer and version
 * - Installed version from app-update.yml
 * - Updater cache directory contents
 * - Active updater processes
 *
 * Usage: bun run src/diagnostics/check-update-state.ts
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { getUpdaterProcesses } from "./lib/process-utils";

const LOCALAPPDATA = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || ".", "AppData", "Local");
const UPDATER_DIR = join(LOCALAPPDATA, "superhuman-updater");
const PENDING_DIR = join(UPDATER_DIR, "pending");
const INSTALL_DIR = join(LOCALAPPDATA, "Programs", "Superhuman");
const APP_UPDATE_YML = join(INSTALL_DIR, "resources", "app-update.yml");

function heading(text: string): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${text}`);
  console.log("=".repeat(60));
}

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch {
    return null;
  }
}

async function listDir(dir: string): Promise<{ name: string; size: number; mtime: Date }[]> {
  try {
    const entries = await readdir(dir);
    const results = [];
    for (const name of entries) {
      try {
        const s = await stat(join(dir, name));
        results.push({ name, size: s.size, mtime: s.mtime });
      } catch {
        results.push({ name, size: 0, mtime: new Date(0) });
      }
    }
    return results;
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  heading("INSTALLED VERSION");
  const yml = await readFileOrNull(APP_UPDATE_YML);
  if (yml) {
    console.log(yml);
  } else {
    console.log("  app-update.yml NOT FOUND");
  }

  heading("UPDATER CACHE DIRECTORY");
  const cacheFiles = await listDir(UPDATER_DIR);
  if (cacheFiles.length === 0) {
    console.log("  Directory empty or not found");
  } else {
    for (const f of cacheFiles) {
      const sizeMB = (f.size / 1024 / 1024).toFixed(1);
      console.log(`  ${f.name.padEnd(50)} ${sizeMB.padStart(8)} MB  ${f.mtime.toISOString()}`);
    }
  }

  heading("PENDING UPDATE");
  const updateInfo = await readFileOrNull(join(PENDING_DIR, "update-info.json"));
  if (updateInfo) {
    const info = JSON.parse(updateInfo);
    console.log(`  Installer: ${info.fileName}`);
    console.log(`  SHA-512:   ${info.sha512?.slice(0, 32)}...`);
    console.log(`  Admin req: ${info.isAdminRightsRequired}`);

    // Parse version from filename
    const versionMatch = info.fileName?.match(/(\d+\.\d+\.\d+)/);
    if (versionMatch) {
      console.log(`  Version:   ${versionMatch[1]}`);
    }
  } else {
    console.log("  No pending update found");
  }

  const pendingFiles = await listDir(PENDING_DIR);
  if (pendingFiles.length > 0) {
    console.log("\n  Pending directory contents:");
    for (const f of pendingFiles) {
      const sizeMB = (f.size / 1024 / 1024).toFixed(1);
      console.log(`    ${f.name.padEnd(50)} ${sizeMB.padStart(8)} MB  ${f.mtime.toISOString()}`);
    }
  }

  heading("UPDATER PROCESSES (running now)");
  const updaters = await getUpdaterProcesses();
  if (updaters.length === 0) {
    console.log("  No updater processes detected");
  } else {
    for (const p of updaters) {
      console.log(`  PID ${p.pid}: ${p.name} — ${p.windowTitle || "(no window)"}`);
    }
  }

  heading("DIAGNOSIS");
  if (updateInfo) {
    const info = JSON.parse(updateInfo);
    const versionMatch = info.fileName?.match(/(\d+\.\d+\.\d+)/);
    const pendingVersion = versionMatch ? versionMatch[1] : "unknown";
    console.log(`  ⚠ PENDING UPDATE DETECTED: installed → v${pendingVersion}`);
    console.log(`  The auto-updater has downloaded v${pendingVersion} and is waiting to install.`);
    console.log(`  This could cause restart cycles if the updater quits Superhuman to install`);
    console.log(`  and something (e.g., an MCP health monitor) relaunches it before the`);
    console.log(`  installer finishes.`);
  } else {
    console.log("  No pending update — auto-updater is unlikely to be the cause.");
  }
}

main().catch((e) => {
  console.error(`Fatal: ${(e as Error).message}`);
  process.exit(1);
});
