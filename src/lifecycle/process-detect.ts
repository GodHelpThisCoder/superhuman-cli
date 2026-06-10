/**
 * Superhuman process detection — independent of CDP.
 *
 * The CDP port probe (isSuperhumanRunning) cannot distinguish "Superhuman is
 * not running" from "Superhuman is running WITHOUT --remote-debugging-port".
 * The distinction matters: spawning a second instance against Electron's
 * single-instance lock just defers to the running app and exits, so launch
 * attempts in that state loop forever. This probe supplies the missing signal:
 * process present + CDP down = running without the debug port.
 */

export async function isSuperhumanProcessRunning(): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const out = await runCommand([
        "tasklist",
        "/FI",
        "IMAGENAME eq Superhuman.exe",
        "/FO",
        "CSV",
        "/NH",
      ]);
      return out.toLowerCase().includes("superhuman.exe");
    }
    if (process.platform === "darwin") {
      const out = await runCommand(["pgrep", "-x", "Superhuman"]);
      return out !== "";
    }
    // Exact process-name match only. `-f` (full command line) would match the
    // MCP server's OWN bun process (its argv contains "superhuman-cli"),
    // permanently misclassifying the lifecycle as down_no_debug_port; `-i` is
    // a BSD flag that procps-ng pgrep on Linux doesn't support at all.
    const out = await runCommand(["pgrep", "-x", "superhuman"]);
    return out !== "";
  } catch {
    return false;
  }
}

async function runCommand(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout.trim();
}
