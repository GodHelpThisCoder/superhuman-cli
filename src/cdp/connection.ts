/**
 * CDP Connection Management
 *
 * Provides programmatic access to Superhuman via Chrome DevTools Protocol (CDP).
 * Handles both standalone Electron app and Chrome extension connection modes.
 *
 * Moved from src/superhuman-api.ts during module restructuring.
 */

import CDP from "chrome-remote-interface";

let launchedSuperhumanProcess: ReturnType<typeof Bun.spawn> | null = null;

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
    console.error(`[CDP Superhuman check]: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Launch Superhuman with remote debugging enabled.
 * Skips launch when CDP_HOST is set (remote/container environment).
 */
export async function launchSuperhuman(port = 9333): Promise<boolean> {
  if (await isSuperhumanRunning(port)) {
    return true;
  }

  const host = getCDPHost();
  if (host !== "localhost") {
    console.error(`Superhuman not reachable at ${host}:${port}. Ensure it is running on the host with --remote-debugging-port=${port}`);
    return false;
  }

  const appPath = getSuperhumanPath();

  console.error("Launching Superhuman with remote debugging...");
  try {
    launchedSuperhumanProcess = Bun.spawn([appPath, `--remote-debugging-port=${port}`], {
      stdout: "ignore",
      stderr: "ignore",
    });

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (await isSuperhumanRunning(port)) {
        console.error("Superhuman is ready");
        await new Promise(r => setTimeout(r, 2000));
        return true;
      }
    }
    console.error("Timeout waiting for Superhuman to start");
    try {
      launchedSuperhumanProcess?.kill();
    } catch {
      // Process may have already exited.
    }
    launchedSuperhumanProcess = null;
    return false;
  } catch (e) {
    try {
      launchedSuperhumanProcess?.kill();
    } catch {
      // Process may have already exited.
    }
    launchedSuperhumanProcess = null;
    console.error("Failed to launch Superhuman:", (e as Error).message);
    return false;
  }
}

/**
 * Ensure Superhuman is running, launching it if necessary.
 */
export async function ensureSuperhuman(port = 9333): Promise<boolean> {
  if (await isSuperhumanRunning(port)) {
    return true;
  }
  return launchSuperhuman(port);
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
    const launched = await launchSuperhuman(port);
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
    console.error("Could not find Superhuman main page");
    return null;
  }

  const client = await CDP({ target: mainPage.id, host, port });
  await client.Page.enable();
  await client.Network.enable().catch(() => {});

  let backgroundClient: CDP.Client | undefined;
  if (backgroundPage) {
    try {
      backgroundClient = await CDP({ target: backgroundPage.id, host, port });
      await backgroundClient.Network.enable();
    } catch (error) {
      console.error(`[CDP background connect]: ${error instanceof Error ? error.message : String(error)}`);
    }
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
  await conn.client.close();
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
    console.error(`[find Chrome extension]: ${error instanceof Error ? error.message : String(error)}`);
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
    console.error(`[Chrome extension CDP connect]: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Disconnect from Chrome extension CDP clients.
 */
export async function disconnectChrome(
  conn: ChromeExtConnection
): Promise<void> {
  await conn.swClient.close();
  await conn.mainClient.close();
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
  if (/<[a-z][\s\S]*>/i.test(text)) return text;

  const escaped = unescapeString(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return `<p>${escaped.replace(/\n/g, "</p><p>")}</p>`;
}
