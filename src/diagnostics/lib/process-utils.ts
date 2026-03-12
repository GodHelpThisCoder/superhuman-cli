/**
 * Process enumeration utilities for Windows.
 * Uses PowerShell for richer data than tasklist.
 */

import type { ProcessInfo } from "./monitor-types";

// ---------------------------------------------------------------------------
// PowerShell helpers
// ---------------------------------------------------------------------------

async function runPowershell(script: string): Promise<string> {
  const proc = Bun.spawn(["powershell", "-NoProfile", "-Command", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Process enumeration
// ---------------------------------------------------------------------------

/**
 * Get all Superhuman.exe processes with details.
 */
export async function getSuperhumanProcesses(): Promise<ProcessInfo[]> {
  try {
    const raw = await runPowershell(
      `Get-Process -Name Superhuman -ErrorAction SilentlyContinue | ` +
        `Select-Object Id,ProcessName,MainWindowTitle,Responding,StartTime | ` +
        `ConvertTo-Json -Compress`
    );
    if (!raw || raw === "") return [];
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.map((p: any) => ({
      pid: p.Id,
      name: p.ProcessName,
      windowTitle: p.MainWindowTitle || "",
      responding: p.Responding ?? true,
      startTime: p.StartTime ? new Date(extractDateTicks(p.StartTime)).toISOString() : undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Get bun.exe processes that are running the MCP server.
 */
export async function getBunMcpProcesses(): Promise<ProcessInfo[]> {
  try {
    const raw = await runPowershell(
      `Get-CimInstance Win32_Process -Filter "name='bun.exe'" -ErrorAction SilentlyContinue | ` +
        `Select-Object ProcessId,CommandLine | ` +
        `ConvertTo-Json -Compress`
    );
    if (!raw || raw === "") return [];
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items
      .filter((p: any) => p.CommandLine && p.CommandLine.includes("index.ts") && p.CommandLine.includes("--mcp"))
      .map((p: any) => ({
        pid: p.ProcessId,
        name: "bun.exe",
        commandLine: p.CommandLine,
      }));
  } catch {
    return [];
  }
}

/**
 * Check if Superhuman auto-updater processes are running.
 */
export async function getUpdaterProcesses(): Promise<ProcessInfo[]> {
  try {
    const raw = await runPowershell(
      `Get-Process -ErrorAction SilentlyContinue | ` +
        `Where-Object { $_.ProcessName -match 'Update|Squirrel|Setup' -and $_.ProcessName -match 'Superhuman|superhuman' } | ` +
        `Select-Object Id,ProcessName,MainWindowTitle | ` +
        `ConvertTo-Json -Compress`
    );
    if (!raw || raw === "") return [];
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.map((p: any) => ({
      pid: p.Id,
      name: p.ProcessName,
      windowTitle: p.MainWindowTitle || "",
    }));
  } catch {
    return [];
  }
}

/**
 * Count all Superhuman-related processes (main + renderers).
 */
export async function countSuperhumanProcesses(): Promise<number> {
  try {
    const raw = await runPowershell(
      `(Get-Process -Name Superhuman -ErrorAction SilentlyContinue | Measure-Object).Count`
    );
    return parseInt(raw, 10) || 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract epoch ms from PowerShell's /Date(...)/ format or ISO string */
function extractDateTicks(dateVal: unknown): number {
  if (typeof dateVal === "string") {
    const match = dateVal.match(/\/Date\((\d+)\)\//);
    if (match?.[1]) return parseInt(match[1], 10);
    return new Date(dateVal).getTime();
  }
  if (typeof dateVal === "number") return dateVal;
  return Date.now();
}
