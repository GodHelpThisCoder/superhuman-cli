/**
 * Mutation Audit Log — append-only JSONL log of every mutating tool call.
 *
 * Location: ~/.config/superhuman-cli/audit.jsonl
 * Fire-and-forget: logAudit() never throws into the handler.
 */

import { appendFile, rename, stat } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { getConfigDir } from "./config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEntry {
  timestamp: string;
  tool: string;
  account: string;
  action: "staged" | "confirmed" | "executed" | "rejected" | "expired" | "killed";
  args: Record<string, unknown>;
  token?: string;
  result: "success" | "error" | "dry_run";
  error?: string;
  batchSize?: number;
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const BODY_TRUNCATE_LENGTH = 200;

function auditLogPath(): string {
  return `${getConfigDir()}/audit.jsonl`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Append an audit entry to the log file. Fire-and-forget — never throws.
 */
export async function logAudit(entry: Omit<AuditEntry, "timestamp">): Promise<void> {
  try {
    const dir = getConfigDir();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const logPath = auditLogPath();

    // Rotate if file exceeds 10MB
    try {
      const stats = await stat(logPath);
      if (stats.size > MAX_LOG_SIZE) {
        await rename(logPath, `${logPath}.1`);
      }
    } catch {
      // File doesn't exist yet — that's fine
    }

    // Truncate body field in args if present
    const sanitizedArgs = { ...entry.args };
    if (typeof sanitizedArgs.body === "string" && sanitizedArgs.body.length > BODY_TRUNCATE_LENGTH) {
      sanitizedArgs.body = sanitizedArgs.body.slice(0, BODY_TRUNCATE_LENGTH) + "...";
    }

    const fullEntry: AuditEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
      args: sanitizedArgs,
    };

    await appendFile(logPath, JSON.stringify(fullEntry) + "\n");
  } catch {
    // Audit failure must never block operations — silently swallow
  }
}

/**
 * Read audit log entries with optional filtering.
 */
export async function readAuditLog(options?: {
  limit?: number;
  tool?: string;
}): Promise<AuditEntry[]> {
  const logPath = auditLogPath();

  if (!existsSync(logPath)) {
    return [];
  }

  const content = readFileSync(logPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  let entries: AuditEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as AuditEntry);
    } catch {
      // Skip malformed lines
    }
  }

  // Filter by tool if specified
  if (options?.tool) {
    entries = entries.filter((e) => e.tool === options.tool);
  }

  // Return most recent N entries
  const limit = options?.limit ?? 50;
  return entries.slice(-limit);
}
