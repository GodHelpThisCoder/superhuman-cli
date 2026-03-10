/**
 * Re-export shim — all exports now live in src/cdp/connection.ts.
 *
 * Existing consumers that import from "./superhuman-api" continue to work.
 */

export {
  type SuperhumanConnection,
  type ChromeExtConnection,
  getCDPHost,
  getSuperhumanPath,
  isSuperhumanRunning,
  launchSuperhuman,
  ensureSuperhuman,
  connectToSuperhuman,
  disconnect,
  findChromeExtension,
  connectToSuperhumanChrome,
  disconnectChrome,
  unescapeString,
  textToHtml,
} from "./cdp/connection";
