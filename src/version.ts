/**
 * Shared app version sourced from package.json.
 */

const packageMeta = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
  version?: string;
};

export const APP_VERSION = packageMeta.version || "0.0.0";
