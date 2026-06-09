/**
 * Doctor — environment diagnostics for the Superhuman CLI/MCP server.
 *
 * Pure logic module (no CLI dependencies): collects a structured report of
 * everything that affects whether tools can reach Superhuman — CDP port,
 * process state, lifecycle lock, pending updates, app install path, token
 * cache, config/log files, and (Windows) shortcut drift.
 *
 * Every probe is independently try/caught: a failed probe reports "unknown"
 * (null), it never throws. Also hosts the explicit user-action fixers:
 * fixPort (graceful restart with the debug port — NEVER force-kills) and
 * patchShortcuts (adds the debug-port flag to Windows .lnk shortcuts).
 */

import { isSuperhumanRunning, launchSuperhuman, getSuperhumanPath, getCDPHost } from "./cdp/connection";
import { isSuperhumanProcessRunning } from "./lifecycle/process-detect";
import { readLock, isLockStale, defaultLockDeps } from "./lifecycle/lock";
import { getPendingUpdateInfo, isUpdaterRunning, type PendingUpdateInfo } from "./update-awareness";
import { loadTokensFromDisk, getCachedAccounts, getTokenFromCache } from "./auth/token-store";
import { getConfigDir } from "./config";
import { APP_VERSION } from "./version";

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export interface ShortcutDrift {
  path: string;
  hasFlag: boolean;
}

export interface DoctorReport {
  generatedAt: string;
  port: number;
  cdpHost: string;
  platform: NodeJS.Platform;
  serverVersion: string;
  pid: number;
  /** CDP reachability probe. null = probe failed. */
  cdp: { reachable: boolean | null; error?: string };
  /** OS-level Superhuman process probe. null = probe failed. */
  process: { running: boolean | null; error?: string };
  /** One-line combination of the two probes above. */
  diagnosis: string;
  lock: {
    present: boolean;
    pid: number | null;
    startedAt: string | null;
    version: string | null;
    /** Age of the lockfile heartbeat (mtime). */
    mtimeAgeMs: number | null;
    stale: boolean | null;
    ownedByThisProcess: boolean;
    error?: string;
  };
  update: {
    pending: PendingUpdateInfo | null;
    updaterRunning: boolean | null;
    error?: string;
  };
  app: {
    path: string | null;
    exists: boolean | null;
    error?: string;
  };
  tokens: {
    /** Whether tokens.json was loaded from disk. null = probe failed. */
    loaded: boolean | null;
    accounts: { email: string; expiresAt: string | null; status: string }[];
    error?: string;
  };
  config: {
    dir: string | null;
    logFile: string | null;
    /** null when the log file does not exist (or the probe failed). */
    logFileSizeBytes: number | null;
    error?: string;
  };
  /** Windows shortcut drift. Always [] on non-win32 platforms. */
  shortcuts: { entries: ShortcutDrift[]; error?: string };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Human-readable duration, e.g. "42s", "5m 3s", "2h 15m", "3d 4h". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function diagnose(cdp: boolean | null, proc: boolean | null, port: number): string {
  if (cdp === true) return `ready — Superhuman is running with CDP reachable on port ${port}`;
  if (cdp === false && proc === true) {
    return (
      `Superhuman is running WITHOUT --remote-debugging-port=${port} — it cannot be controlled. ` +
      `Run 'superhuman doctor --fix-port' to restart it gracefully with the debug port.`
    );
  }
  if (cdp === false && proc === false) {
    return `Superhuman is not running. Run 'superhuman doctor --fix-port' to launch it with the debug port.`;
  }
  return "unknown — one or more probes failed (see Connection section)";
}

// ---------------------------------------------------------------------------
// Report collection — every probe independently try/caught
// ---------------------------------------------------------------------------

export async function collectDoctorReport(port: number): Promise<DoctorReport> {
  const now = Date.now();

  const report: DoctorReport = {
    generatedAt: new Date(now).toISOString(),
    port,
    cdpHost: "localhost",
    platform: process.platform,
    serverVersion: APP_VERSION,
    pid: process.pid,
    cdp: { reachable: null },
    process: { running: null },
    diagnosis: "",
    lock: {
      present: false,
      pid: null,
      startedAt: null,
      version: null,
      mtimeAgeMs: null,
      stale: null,
      ownedByThisProcess: false,
    },
    update: { pending: null, updaterRunning: null },
    app: { path: null, exists: null },
    tokens: { loaded: null, accounts: [] },
    config: { dir: null, logFile: null, logFileSizeBytes: null },
    shortcuts: { entries: [] },
  };

  try {
    report.cdpHost = getCDPHost();
  } catch {
    /* keep default */
  }

  // CDP reachability
  try {
    report.cdp.reachable = await isSuperhumanRunning(port);
  } catch (e) {
    report.cdp.error = errMsg(e);
  }

  // OS process presence
  try {
    report.process.running = await isSuperhumanProcessRunning();
  } catch (e) {
    report.process.error = errMsg(e);
  }

  report.diagnosis = diagnose(report.cdp.reachable, report.process.running, port);

  // Lifecycle lock
  try {
    const lockDeps = defaultLockDeps();
    const read = readLock(lockDeps);
    if (read) {
      report.lock.present = true;
      report.lock.pid = read.info?.pid ?? null;
      report.lock.startedAt = read.info?.startedAt || null;
      report.lock.version = read.info?.version || null;
      report.lock.mtimeAgeMs = Math.max(0, Date.now() - read.mtimeMs);
      report.lock.stale = isLockStale(read, lockDeps);
      report.lock.ownedByThisProcess = read.info?.pid === process.pid;
    }
  } catch (e) {
    report.lock.error = errMsg(e);
  }

  // Pending update + updater process
  try {
    report.update.pending = await getPendingUpdateInfo();
  } catch (e) {
    report.update.error = errMsg(e);
  }
  try {
    report.update.updaterRunning = await isUpdaterRunning();
  } catch (e) {
    report.update.error = report.update.error || errMsg(e);
  }

  // App install path
  try {
    const appPath = getSuperhumanPath();
    report.app.path = appPath;
    report.app.exists = await Bun.file(appPath).exists();
  } catch (e) {
    report.app.error = errMsg(e);
  }

  // Token cache — raw cache reads only (no refresh attempts, no network)
  try {
    report.tokens.loaded = await loadTokensFromDisk();
    for (const email of getCachedAccounts()) {
      const token = getTokenFromCache(email);
      if (!token || !Number.isFinite(token.expires) || token.expires <= 0) {
        report.tokens.accounts.push({ email, expiresAt: null, status: "unknown expiry" });
        continue;
      }
      const status =
        token.expires > now
          ? `expires in ${formatDuration(token.expires - now)}`
          : `expired ${formatDuration(now - token.expires)} ago`;
      report.tokens.accounts.push({ email, expiresAt: new Date(token.expires).toISOString(), status });
    }
  } catch (e) {
    report.tokens.error = errMsg(e);
  }

  // Config dir + log file
  try {
    const dir = getConfigDir();
    report.config.dir = dir;
    const logFile = `${dir}/superhuman.log`;
    report.config.logFile = logFile;
    const f = Bun.file(logFile);
    if (await f.exists()) {
      report.config.logFileSizeBytes = f.size;
    }
  } catch (e) {
    report.config.error = errMsg(e);
  }

  // Windows shortcut drift
  try {
    report.shortcuts.entries = await checkShortcutDrift(port);
  } catch (e) {
    report.shortcuts.error = errMsg(e);
  }

  return report;
}

// ---------------------------------------------------------------------------
// Human-readable report
// ---------------------------------------------------------------------------

export function formatDoctorReport(r: DoctorReport): string {
  const yn = (v: boolean | null, yes = "yes", no = "no"): string =>
    v === null ? "unknown" : v ? yes : no;

  const lines: string[] = [];
  lines.push(`Superhuman doctor — ${r.generatedAt}`);
  lines.push(`superhuman-cli v${r.serverVersion} (pid ${r.pid}, ${r.platform})`);
  lines.push("");

  const pad = (label: string) => label.padEnd(Math.max(21, `CDP ${r.cdpHost}:${r.port}:`.length + 1));
  lines.push("Connection");
  lines.push(
    `  ${pad(`CDP ${r.cdpHost}:${r.port}:`)}${yn(r.cdp.reachable, "reachable", "unreachable")}` +
      (r.cdp.error ? ` (probe failed: ${r.cdp.error})` : "")
  );
  lines.push(
    `  ${pad("Superhuman process:")}${yn(r.process.running, "running", "not running")}` +
      (r.process.error ? ` (probe failed: ${r.process.error})` : "")
  );
  lines.push(`  ${pad("Diagnosis:")}${r.diagnosis}`);
  lines.push("");

  lines.push("Lifecycle lock");
  if (r.lock.error) {
    lines.push(`  unknown (probe failed: ${r.lock.error})`);
  } else if (!r.lock.present) {
    lines.push("  No lock file — no MCP server instance currently owns lifecycle duty.");
  } else {
    lines.push(
      `  Owner pid:    ${r.lock.pid ?? "unparseable"}` + (r.lock.ownedByThisProcess ? " (this process)" : "")
    );
    lines.push(`  Started:      ${r.lock.startedAt ?? "unknown"}`);
    lines.push(`  Version:      ${r.lock.version ?? "unknown"}`);
    lines.push(
      `  Heartbeat:    ${r.lock.mtimeAgeMs != null ? `${formatDuration(r.lock.mtimeAgeMs)} ago` : "unknown"}` +
        (r.lock.stale === null ? "" : r.lock.stale ? " — STALE (eligible for takeover)" : " (live)")
    );
  }
  lines.push("");

  lines.push("Updates");
  if (r.update.error) {
    lines.push(`  unknown (probe failed: ${r.update.error})`);
  } else {
    lines.push(
      `  Pending update:   ${r.update.pending ? `v${r.update.pending.version} (${r.update.pending.fileName})` : "none"}`
    );
    lines.push(`  Updater running:  ${yn(r.update.updaterRunning)}`);
  }
  lines.push("");

  lines.push("App");
  if (r.app.error) {
    lines.push(`  unknown (probe failed: ${r.app.error})`);
  } else {
    lines.push(`  Path:    ${r.app.path ?? "unknown"}`);
    lines.push(`  Exists:  ${yn(r.app.exists)}`);
  }
  lines.push("");

  lines.push("Token cache");
  if (r.tokens.error) {
    lines.push(`  unknown (probe failed: ${r.tokens.error})`);
  } else if (r.tokens.accounts.length === 0) {
    lines.push("  No cached tokens. Run 'superhuman account auth' to authenticate.");
  } else {
    lines.push(`  ${r.tokens.accounts.length} cached account(s):`);
    for (const a of r.tokens.accounts) {
      lines.push(`  - ${a.email} — ${a.status}${a.expiresAt ? ` (at ${a.expiresAt})` : ""}`);
    }
  }
  lines.push("");

  lines.push("Config");
  if (r.config.error) {
    lines.push(`  unknown (probe failed: ${r.config.error})`);
  } else {
    lines.push(`  Config dir:  ${r.config.dir ?? "unknown"}`);
    if (r.config.logFile) {
      lines.push(
        `  Log file:    ${r.config.logFile}` +
          (r.config.logFileSizeBytes != null ? ` (${formatBytes(r.config.logFileSizeBytes)})` : " (not present)")
      );
    }
  }

  if (r.platform === "win32") {
    lines.push("");
    lines.push("Shortcuts (Windows)");
    if (r.shortcuts.error) {
      lines.push(`  unknown (probe failed: ${r.shortcuts.error})`);
    } else if (r.shortcuts.entries.length === 0) {
      lines.push("  No Superhuman shortcuts found (Start Menu / Desktop).");
    } else {
      for (const s of r.shortcuts.entries) {
        lines.push(
          s.hasFlag
            ? `  OK      ${s.path} (has --remote-debugging-port=${r.port})`
            : `  DRIFT   ${s.path} — missing --remote-debugging-port=${r.port}. Run 'superhuman doctor --patch-shortcut'.`
        );
      }
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// fixPort — explicit user action: gracefully restart Superhuman with the
// debug port. NEVER force-kills; never fights the update installer.
// ---------------------------------------------------------------------------

export async function fixPort(port: number): Promise<{ ok: boolean; message: string }> {
  // Already healthy? Nothing to fix.
  try {
    if (await isSuperhumanRunning(port)) {
      return {
        ok: true,
        message: `Superhuman is already running with --remote-debugging-port=${port} — nothing to fix.`,
      };
    }
  } catch {
    /* probe failed — continue with the full flow */
  }

  // 1. Never fight the installer.
  try {
    if (await isUpdaterRunning()) {
      return {
        ok: false,
        message:
          "Superhuman update installer is currently running — refusing to restart the app mid-update. " +
          "Wait for the update to finish, then re-run 'superhuman doctor --fix-port'.",
      };
    }
  } catch {
    /* updater probe failed — launchSuperhuman re-checks before spawning */
  }

  // 2. No process at all → just launch.
  let processRunning = false;
  try {
    processRunning = await isSuperhumanProcessRunning();
  } catch {
    processRunning = false;
  }
  if (!processRunning) {
    const launched = await launchSuperhuman(port);
    return launched
      ? { ok: true, message: `Superhuman launched with --remote-debugging-port=${port} — CDP is reachable.` }
      : {
          ok: false,
          message:
            "Superhuman was not running and the launch did not become ready in time. " +
            `Check 'superhuman doctor' and the log at ${getConfigDir()}/superhuman.log.`,
        };
  }

  // 3. Graceful close (WM_CLOSE / quit AppleEvent) — never /F, never SIGKILL.
  if (process.platform === "win32") {
    const proc = Bun.spawn(["taskkill", "/IM", "Superhuman.exe"], { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
  } else if (process.platform === "darwin") {
    const proc = Bun.spawn(["osascript", "-e", 'quit app "Superhuman"'], { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
  } else {
    return {
      ok: false,
      message:
        "Automatic graceful restart is not supported on this platform. " +
        `Close Superhuman manually, then start it with --remote-debugging-port=${port}.`,
    };
  }

  // 4. Poll for the process to exit (up to 15s). DO NOT force-kill.
  let closed = false;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      if (!(await isSuperhumanProcessRunning())) {
        closed = true;
        break;
      }
    } catch {
      /* probe failure — keep polling */
    }
  }
  if (!closed) {
    return {
      ok: false,
      message:
        "Superhuman did not close within 15 seconds (it may have a dialog open or be mid-operation). " +
        "It will NOT be force-killed. Close it manually, then re-run 'superhuman doctor --fix-port'.",
    };
  }

  // 5. Relaunch with the debug port.
  const launched = await launchSuperhuman(port);
  return launched
    ? { ok: true, message: `Superhuman restarted with --remote-debugging-port=${port} — CDP is reachable.` }
    : {
        ok: false,
        message:
          "Superhuman closed but the relaunch did not become ready in time — it may still be starting " +
          "(or installing an update). Re-check with 'superhuman doctor' in a minute.",
      };
}

// ---------------------------------------------------------------------------
// Shortcut drift detection / patching (Windows .lnk files)
// ---------------------------------------------------------------------------

function shortcutCandidates(): string[] {
  if (process.platform !== "win32") return [];
  const candidates: string[] = [];
  if (process.env.APPDATA) {
    candidates.push(`${process.env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs\\Superhuman.lnk`);
  }
  if (process.env.USERPROFILE) {
    candidates.push(`${process.env.USERPROFILE}\\Desktop\\Superhuman.lnk`);
  }
  return candidates;
}

/** Single-quote a value for embedding in a PowerShell command. */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function runPowerShell(script: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() };
}

/** Read a .lnk file's Arguments string via WScript.Shell. null = unreadable. */
async function readShortcutArguments(path: string): Promise<string | null> {
  const res = await runPowerShell(
    `(New-Object -ComObject WScript.Shell).CreateShortcut(${psQuote(path)}).Arguments`
  );
  return res.ok ? res.stdout : null;
}

/**
 * Check Superhuman shortcuts for the debug-port flag.
 * win32 only — returns [] on other platforms. Never throws.
 */
export async function checkShortcutDrift(port: number): Promise<{ path: string; hasFlag: boolean }[]> {
  if (process.platform !== "win32") return [];
  const flag = `--remote-debugging-port=${port}`;
  const results: { path: string; hasFlag: boolean }[] = [];
  for (const path of shortcutCandidates()) {
    try {
      if (!(await Bun.file(path).exists())) continue;
      const args = await readShortcutArguments(path);
      if (args === null) continue; // unreadable — skip rather than report wrong data
      results.push({ path, hasFlag: args.includes(flag) });
    } catch {
      /* probe must never throw */
    }
  }
  return results;
}

/**
 * Add `--remote-debugging-port=<port>` to existing Superhuman shortcuts.
 * Explicit user action (win32 only; no-op with a message elsewhere).
 *
 * Caveat (always included in messages): Superhuman app updates recreate the
 * shortcuts and revert this change.
 */
export async function patchShortcuts(
  port: number
): Promise<{ patched: string[]; skipped: string[]; messages: string[] }> {
  const result = { patched: [] as string[], skipped: [] as string[], messages: [] as string[] };

  if (process.platform !== "win32") {
    result.messages.push("Shortcut patching is only supported on Windows — nothing to do on this platform.");
    return result;
  }

  const flag = `--remote-debugging-port=${port}`;
  const candidates = shortcutCandidates();
  if (candidates.length === 0) {
    result.messages.push("No shortcut locations could be resolved (APPDATA/USERPROFILE not set).");
    return result;
  }

  for (const path of candidates) {
    try {
      if (!(await Bun.file(path).exists())) {
        result.skipped.push(path);
        result.messages.push(`Skipped (not found): ${path}`);
        continue;
      }
      const args = await readShortcutArguments(path);
      if (args === null) {
        result.skipped.push(path);
        result.messages.push(`Skipped (could not read shortcut): ${path}`);
        continue;
      }
      if (args.includes(flag)) {
        result.skipped.push(path);
        result.messages.push(`Already patched (has ${flag}): ${path}`);
        continue;
      }
      const write = await runPowerShell(
        `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${psQuote(path)}); ` +
          `$s.Arguments = ($s.Arguments + ' ${flag}').Trim(); $s.Save()`
      );
      if (write.ok) {
        result.patched.push(path);
        result.messages.push(`Patched: ${path} (appended ${flag})`);
      } else {
        result.skipped.push(path);
        result.messages.push(`Failed to patch ${path}: ${write.stderr || "PowerShell error"}`);
      }
    } catch (e) {
      result.skipped.push(path);
      result.messages.push(`Failed to patch ${path}: ${errMsg(e)}`);
    }
  }

  result.messages.push(
    "Caveat: Superhuman app updates recreate these shortcuts and will revert this change — " +
      "re-run 'superhuman doctor --patch-shortcut' after each app update."
  );
  return result;
}
