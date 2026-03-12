/**
 * Superhuman Auto-Update Awareness
 *
 * Detects pending Electron auto-updates and active installer processes
 * to prevent launch/relaunch conflicts during update cycles.
 *
 * The Superhuman desktop client uses electron-builder's auto-updater,
 * which downloads installers to a cache directory and applies them
 * on quit-and-restart. If we launch Superhuman while the installer
 * is running, we get flash/restart loops.
 */

import { join } from "node:path";
import { createLogger } from "./logger";

const log = createLogger("update");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingUpdateInfo {
  fileName: string;
  version: string;
  sha512: string;
  isAdminRightsRequired: boolean;
}

// ---------------------------------------------------------------------------
// Updater cache paths (platform-specific)
// ---------------------------------------------------------------------------

export function getUpdaterCachePath(): string {
  switch (process.platform) {
    case "win32": {
      const localAppData =
        process.env.LOCALAPPDATA ||
        join(process.env.USERPROFILE || ".", "AppData", "Local");
      return join(localAppData, "superhuman-updater");
    }
    case "darwin":
      return join(
        process.env.HOME || ".",
        "Library",
        "Caches",
        "superhuman-updater"
      );
    default:
      return join(
        process.env.XDG_CACHE_HOME || join(process.env.HOME || ".", ".cache"),
        "superhuman-updater"
      );
  }
}

// ---------------------------------------------------------------------------
// Pending update detection
// ---------------------------------------------------------------------------

/**
 * Check if a Superhuman update is downloaded and staged for installation.
 * Returns update info if pending, null otherwise.
 */
export async function getPendingUpdateInfo(): Promise<PendingUpdateInfo | null> {
  try {
    const infoPath = join(getUpdaterCachePath(), "pending", "update-info.json");
    const file = Bun.file(infoPath);
    if (!(await file.exists())) return null;

    const raw = await file.json();
    if (!raw?.fileName) return null;

    const versionMatch = raw.fileName.match(/(\d+\.\d+\.\d+)/);
    return {
      fileName: raw.fileName,
      version: versionMatch?.[1] ?? "unknown",
      sha512: raw.sha512 ?? "",
      isAdminRightsRequired: raw.isAdminRightsRequired ?? false,
    };
  } catch (e) {
    log.debug("Failed to read pending update info:", (e as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Updater process detection
// ---------------------------------------------------------------------------

async function runCommand(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout.trim();
}

/**
 * Check if a Superhuman update installer process is currently running.
 */
export async function isUpdaterRunning(): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      // Check for NSIS installer or Squirrel updater processes
      const raw = await runCommand([
        "powershell",
        "-NoProfile",
        "-Command",
        `Get-Process -ErrorAction SilentlyContinue | ` +
          `Where-Object { $_.ProcessName -match 'Superhuman.Setup|Superhuman.Update|Update' -and $_.Path -match 'superhuman' } | ` +
          `Select-Object -First 1 Id | ConvertTo-Json -Compress`,
      ]);
      return raw !== "" && raw !== "null";
    }

    if (process.platform === "darwin") {
      // Check for macOS installer processes
      const raw = await runCommand([
        "pgrep",
        "-f",
        "Superhuman.*[Uu]pdate",
      ]);
      return raw !== "";
    }

    return false;
  } catch {
    return false;
  }
}
