/**
 * CDP Connection Management
 *
 * Provides programmatic access to Superhuman via Chrome DevTools Protocol (CDP).
 * Handles both standalone Electron app and Chrome extension connection modes.
 *
 * Moved from src/superhuman-api.ts during module restructuring.
 */

import CDP from "chrome-remote-interface";

// ---------------------------------------------------------------------------
// Connection types
// ---------------------------------------------------------------------------

export interface SuperhumanConnection {
  client: CDP.Client;
  Runtime: CDP.Client["Runtime"];
  Input: CDP.Client["Input"];
  Network: CDP.Client["Network"];
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
// Electron app connection
// ---------------------------------------------------------------------------

/**
 * Check if Superhuman is running with CDP enabled.
 */
export async function isSuperhmanRunning(port = 9333): Promise<boolean> {
  try {
    const host = getCDPHost();
    const targets = await CDP.List({ host, port });
    return targets.some(t => t.url.includes("mail.superhuman.com"));
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
  if (await isSuperhmanRunning(port)) {
    return true;
  }

  const host = getCDPHost();
  if (host !== "localhost") {
    console.error(`Superhuman not reachable at ${host}:${port}. Ensure it is running on the host with --remote-debugging-port=${port}`);
    return false;
  }

  const appPath = "/Applications/Superhuman.app/Contents/MacOS/Superhuman";

  console.log("Launching Superhuman with remote debugging...");
  try {
    Bun.spawn([appPath, `--remote-debugging-port=${port}`], {
      stdout: "ignore",
      stderr: "ignore",
    });

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (await isSuperhmanRunning(port)) {
        console.log("Superhuman is ready");
        await new Promise(r => setTimeout(r, 2000));
        return true;
      }
    }
    console.error("Timeout waiting for Superhuman to start");
    return false;
  } catch (e) {
    console.error("Failed to launch Superhuman:", (e as Error).message);
    return false;
  }
}

/**
 * Ensure Superhuman is running, launching it if necessary.
 */
export async function ensureSuperhuman(port = 9333): Promise<boolean> {
  if (await isSuperhmanRunning(port)) {
    return true;
  }
  return launchSuperhuman(port);
}

/**
 * Find and connect to the Superhuman main page via CDP.
 */
export async function connectToSuperhuman(
  port = 9333,
  autoLaunch = true
): Promise<SuperhumanConnection | null> {
  const host = getCDPHost();

  if (autoLaunch && !(await isSuperhmanRunning(port))) {
    const launched = await launchSuperhuman(port);
    if (!launched) {
      return null;
    }
  }

  const targets = await CDP.List({ host, port });

  const mainPage = targets.find(
    (t) =>
      t.url.includes("mail.superhuman.com") &&
      !t.url.includes("background") &&
      !t.url.includes("serviceworker") &&
      t.type === "page"
  );

  if (!mainPage) {
    console.error("Could not find Superhuman main page");
    return null;
  }

  const client = await CDP({ target: mainPage.id, host, port });
  await client.Page.enable();

  return {
    client,
    Runtime: client.Runtime,
    Input: client.Input,
    Network: client.Network,
    Page: client.Page,
  };
}

/**
 * Disconnect from Superhuman.
 */
export async function disconnect(conn: SuperhumanConnection): Promise<void> {
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

    const swClient = await CDP({ target: sw.id, host, port });
    const mainClient = await CDP({ target: mainPage.id, host, port });
    await mainClient.Page.enable();

    return { swClient, mainClient };
  } catch (error) {
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
  if (text.includes("<")) return text;

  const unescaped = unescapeString(text);
  return `<p>${unescaped.replace(/\n/g, "</p><p>")}</p>`;
}
