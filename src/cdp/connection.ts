/**
 * CDP Connection Management
 *
 * Provides programmatic access to Superhuman via Chrome DevTools Protocol (CDP).
 * Handles both standalone Electron app and Chrome extension connection modes.
 *
 * Moved from src/superhuman-api.ts during module restructuring.
 */

import CDP from "chrome-remote-interface";
import { createLogger, getLogLevel } from "../logger";
import { getPendingUpdateInfo, isUpdaterRunning } from "../update-awareness";
import { isSuperhumanProcessRunning } from "../lifecycle/process-detect";

const log = createLogger("cdp");
const netLog = createLogger("cdp-network");

let launchedSuperhumanProcess: ReturnType<typeof Bun.spawn> | null = null;
let lastLaunchAttemptMs = 0;
const LAUNCH_COOLDOWN_MS = 30_000;

// ---------------------------------------------------------------------------
// Launch broker — in MCP mode, all auto-launch requests route through the
// LifecycleManager (leader-elected: followers never launch). In CLI mode no
// broker is set and launches happen directly (explicit user actions).
// Defined structurally here to avoid an import cycle with lifecycle/manager.
// ---------------------------------------------------------------------------

export interface LaunchBroker {
  requestLaunch(port: number): Promise<boolean>;
}

let _launchBroker: LaunchBroker | null = null;

export function setLaunchBroker(broker: LaunchBroker | null): void {
  _launchBroker = broker;
}

/** Route an auto-launch request through the broker when one is registered. */
async function requestLaunch(port: number): Promise<boolean> {
  if (_launchBroker) return _launchBroker.requestLaunch(port);
  return launchSuperhuman(port);
}

// ---------------------------------------------------------------------------
// Connection types
// ---------------------------------------------------------------------------

export interface SuperhumanConnection {
  client: CDP.Client;
  backgroundClient?: CDP.Client;
  Runtime: CDP.Client["Runtime"];
  Input: CDP.Client["Input"];
  Network: CDP.Client["Network"];
  BackgroundNetwork?: CDP.Client["Network"];
  Page: CDP.Client["Page"];
}

export interface ChromeExtConnection {
  swClient: CDP.Client;
  mainClient: CDP.Client;
}

// ---------------------------------------------------------------------------
// CDP host resolution
// ---------------------------------------------------------------------------

/**
 * Get CDP host from environment or default to localhost.
 */
export function getCDPHost(): string {
  return process.env.CDP_HOST || process.env.HOST_IP || "localhost";
}

// ---------------------------------------------------------------------------
// Platform-specific paths
// ---------------------------------------------------------------------------

/**
 * Get the platform-specific path to the Superhuman executable.
 */
export function getSuperhumanPath(): string {
  switch (process.platform) {
    case "win32": {
      const localAppData =
        process.env.LOCALAPPDATA ||
        `${process.env.USERPROFILE}\\AppData\\Local`;
      return `${localAppData}\\Programs\\Superhuman\\Superhuman.exe`;
    }
    case "darwin":
      return "/Applications/Superhuman.app/Contents/MacOS/Superhuman";
    default:
      return "superhuman";
  }
}

// ---------------------------------------------------------------------------
// Electron app connection
// ---------------------------------------------------------------------------

/**
 * Check if Superhuman is running with CDP enabled.
 */
export async function isSuperhumanRunning(port = 9333): Promise<boolean> {
  try {
    const host = getCDPHost();
    const targets = await CDP.List({ host, port });
    return targets.some((t: any) => t.url.includes("mail.superhuman.com"));
  } catch (error) {
    log.debug("Superhuman check failed:", error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * Launch Superhuman with remote debugging enabled.
 * Skips launch when CDP_HOST is set (remote/container environment).
 * Update-aware: defers launch if an installer is actively running,
 * and extends the wait timeout if an update is being applied mid-startup.
 */
export async function launchSuperhuman(port = 9333): Promise<boolean> {
  if (await isSuperhumanRunning(port)) {
    return true;
  }

  // Cooldown: prevent rapid-fire relaunch attempts
  const now = Date.now();
  if (now - lastLaunchAttemptMs < LAUNCH_COOLDOWN_MS) {
    log.info("Launch cooldown active, skipping (last attempt was " +
      Math.round((now - lastLaunchAttemptMs) / 1000) + "s ago)");
    return false;
  }
  lastLaunchAttemptMs = now;

  const host = getCDPHost();
  if (host !== "localhost") {
    log.warn(`Superhuman not reachable at ${host}:${port}. Ensure it is running on the host with --remote-debugging-port=${port}`);
    return false;
  }

  // Update awareness: check for pending updates and active installers
  const pendingUpdate = await getPendingUpdateInfo();
  if (pendingUpdate) {
    log.warn(`Pending update to v${pendingUpdate.version} detected`);
    if (await isUpdaterRunning()) {
      log.warn("Update installer active, deferring launch");
      return false;
    }
  }

  // Never spawn against a Superhuman that's already running without the debug
  // port — Electron's single-instance lock makes the new process defer to the
  // existing one and exit, so the launch can never succeed.
  if (await isSuperhumanProcessRunning()) {
    log.warn(
      `Superhuman is already running WITHOUT --remote-debugging-port=${port}. ` +
      `Not launching a second instance. Run 'superhuman doctor --fix-port' to ` +
      `restart it with the debug port.`
    );
    return false;
  }

  const appPath = getSuperhumanPath();

  log.info("Launching Superhuman with remote debugging...");
  try {
    launchedSuperhumanProcess = Bun.spawn([appPath, `--remote-debugging-port=${port}`], {
      stdout: "ignore",
      stderr: "ignore",
    });
    // The app must never be tied to this server's lifetime
    launchedSuperhumanProcess.unref();

    // Wait up to 30s normally, or 120s if an update is being applied
    const maxWaitSeconds = pendingUpdate ? 120 : 30;
    let wasRunning = false;

    for (let i = 0; i < maxWaitSeconds; i++) {
      await new Promise(r => setTimeout(r, 1000));

      if (await isSuperhumanRunning(port)) {
        log.info("Superhuman is ready");
        await new Promise(r => setTimeout(r, 2000));
        return true;
      }

      // Fast classification: our spawn exited almost immediately while another
      // Superhuman process exists — it deferred to an existing instance
      // (single-instance lock). Don't burn the full wait.
      if (i >= 3 && launchedSuperhumanProcess.exitCode !== null && !(await isUpdaterRunning())) {
        if (await isSuperhumanProcessRunning()) {
          log.warn(
            `Spawned process exited immediately — an existing Superhuman instance ` +
            `(without --remote-debugging-port=${port}) is running. Run 'superhuman doctor --fix-port'.`
          );
          launchedSuperhumanProcess = null;
          return false;
        }
      }

      // Detect if Superhuman started then died (likely update install)
      if (!wasRunning && i > 5) {
        // Give it a few seconds, then start checking for updater activity
        if (await isUpdaterRunning()) {
          if (!wasRunning) {
            log.info("Superhuman quit for update install, waiting for updater to finish...");
            wasRunning = true;
          }
        }
      }
    }

    // NEVER kill on timeout: the process may be mid-update and will come up,
    // or it was a single-instance stub that already exited. The caller's next
    // probe re-evaluates; killing here murdered the app mid-update (and any
    // instance the user was actively using).
    log.warn(`Timeout waiting for Superhuman to start (waited ${maxWaitSeconds}s) — leaving the process alone`);
    launchedSuperhumanProcess = null;
    return false;
  } catch (e) {
    launchedSuperhumanProcess = null;
    log.error("Failed to launch Superhuman:", (e as Error).message);
    return false;
  }
}

/**
 * Ensure Superhuman is running, launching it if necessary.
 * In MCP mode the launch is brokered through the LifecycleManager
 * (leader-only); in CLI mode it launches directly.
 */
export async function ensureSuperhuman(port = 9333): Promise<boolean> {
  if (await isSuperhumanRunning(port)) {
    return true;
  }
  return requestLaunch(port);
}

/**
 * Find and connect to both Superhuman main UI page and background page via CDP.
 */
export async function connectToSuperhuman(
  port = 9333,
  autoLaunch = true
): Promise<SuperhumanConnection | null> {
  const host = getCDPHost();

  if (autoLaunch && !(await isSuperhumanRunning(port))) {
    const launched = await requestLaunch(port);
    if (!launched) {
      return null;
    }
  }

  const targets = await CDP.List({ host, port });

  const mainPage = targets.find(
    (t: any) =>
      t.url.includes("mail.superhuman.com") &&
      !t.url.includes("background") &&
      !t.url.includes("serviceworker") &&
      t.type === "page"
  );
  const backgroundPage = targets.find(
    (t: any) =>
      t.url.includes("background_page.html") ||
      (t.url.includes("mail.superhuman.com") && t.type === "background_page")
  );

  if (!mainPage) {
    log.warn("Could not find Superhuman main page");
    return null;
  }

  const client = await CDP({ target: mainPage.id, host, port });
  try {
    await client.Page.enable();
    await client.Network.enable().catch(() => {});
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }

  let backgroundClient: CDP.Client | undefined;
  if (backgroundPage) {
    try {
      backgroundClient = await CDP({ target: backgroundPage.id, host, port });
      await backgroundClient.Network.enable();
    } catch (error) {
      log.warn("Background page connect failed:", error instanceof Error ? error.message : String(error));
    }
  }

  // Attach network listeners at debug level (zero cost otherwise)
  if (getLogLevel() === "debug") {
    const netDomain = backgroundClient?.Network ?? client.Network;
    try {
      (netDomain as any).on("requestWillBeSent", (params: any) => {
        try {
          const req = params?.request;
          if (req) {
            const isAuthUrl = req.url && (/\/token/i.test(req.url) || /\/oauth/i.test(req.url));
            const body = req.postData && !isAuthUrl ? ` ${req.postData.slice(0, 200)}` : "";
            netLog.debug(`=> ${req.method} ${req.url}${body}`);
          }
        } catch { /* listener errors must never propagate */ }
      });
      (netDomain as any).on("responseReceived", (params: any) => {
        try {
          const resp = params?.response;
          if (resp) {
            const timing = resp.timing?.receiveHeadersEnd != null ? ` ${Math.round(resp.timing.receiveHeadersEnd)}ms` : "";
            netLog.debug(`<= ${resp.status} ${resp.url}${timing}`);
          }
        } catch { /* listener errors must never propagate */ }
      });
    } catch { /* best-effort — ignore if listeners can't be attached */ }
  }

  return {
    client,
    backgroundClient,
    Runtime: client.Runtime,
    Input: client.Input,
    Network: backgroundClient?.Network ?? client.Network,
    BackgroundNetwork: backgroundClient?.Network,
    Page: client.Page,
  };
}

/**
 * Disconnect from Superhuman.
 */
export async function disconnect(conn: SuperhumanConnection): Promise<void> {
  if (conn.backgroundClient) {
    await conn.backgroundClient.close().catch(() => {});
  }
  await conn.client.close().catch(() => {});
}

// ---------------------------------------------------------------------------
// Chrome Extension Support
// ---------------------------------------------------------------------------

const SUPERHUMAN_EXTENSION_ID = "dcgcnpooblobhncpnddnhoendgbnglpn";

/**
 * Find the Superhuman Chrome extension service worker target.
 */
export async function findChromeExtension(port: number): Promise<any | null> {
  try {
    const host = getCDPHost();
    const targets = await CDP.List({ host, port });
    return (
      targets.find(
        (t: any) =>
          t.url.includes(SUPERHUMAN_EXTENSION_ID) &&
          t.type === "service_worker"
      ) ?? null
    );
  } catch (error) {
    log.debug("Find Chrome extension failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Connect to Superhuman running as a Chrome extension.
 * Requires both the service worker (for account data) and main page (for navigation).
 */
export async function connectToSuperhumanChrome(
  port: number
): Promise<ChromeExtConnection | null> {
  let swClient: CDP.Client | null = null;
  let mainClient: CDP.Client | null = null;

  try {
    const host = getCDPHost();
    const targets = await CDP.List({ host, port });

    const sw = targets.find(
      (t: any) =>
        t.url.includes(SUPERHUMAN_EXTENSION_ID) &&
        t.type === "service_worker"
    );
    const mainPage = targets.find(
      (t: any) =>
        t.url.includes("mail.superhuman.com") && t.type === "page"
    );

    if (!sw || !mainPage) return null;

    swClient = await CDP({ target: sw.id, host, port });
    mainClient = await CDP({ target: mainPage.id, host, port });
    await mainClient.Page.enable();

    return { swClient, mainClient };
  } catch (error) {
    if (mainClient) {
      await mainClient.close().catch(() => {});
    }
    if (swClient) {
      await swClient.close().catch(() => {});
    }
    log.warn("Chrome extension CDP connect failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Disconnect from Chrome extension CDP clients.
 */
export async function disconnectChrome(
  conn: ChromeExtConnection
): Promise<void> {
  await conn.swClient.close().catch(() => {});
  await conn.mainClient.close().catch(() => {});
}

// ---------------------------------------------------------------------------
// String utilities (used across modules)
// ---------------------------------------------------------------------------

/**
 * Unescape literal escape sequences (like \n, \t) in a string.
 */
export function unescapeString(text: string): string {
  if (!text) return text;
  return text.replace(/\\([ntr\\])/g, (_match, char) => {
    switch (char) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "\\":
        return "\\";
      default:
        return char;
    }
  });
}

/**
 * Convert plain text to HTML paragraphs (returns as-is if already HTML).
 */
export function textToHtml(text: string): string {
  if (!text) return "";
  if (/<[a-z][^>]*>/i.test(text)) return text;

  const escaped = unescapeString(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return `<p>${escaped.replace(/\n/g, "</p><p>")}</p>`;
}
