/**
 * Mutation Audit Log — append-only JSONL log of every mutating tool call.
 *
 * Location: ~/.config/superhuman-cli/audit.jsonl
 * Fire-and-forget: logAudit() never throws into the handler.
 */

import { chmod, mkdir, rename } from "node:fs/promises";
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
  durationMs?: number;
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const BODY_TRUNCATE_LENGTH = 200;

function truncate(value: string): string {
  return value.length > BODY_TRUNCATE_LENGTH
    ? value.slice(0, BODY_TRUNCATE_LENGTH) + "..."
    : value;
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sanitizedArgs: Record<string, unknown> = { ...args };

  if (typeof sanitizedArgs.body === "string") {
    sanitizedArgs.body = truncate(sanitizedArgs.body);
  }

  if (Array.isArray(sanitizedArgs.attachments)) {
    sanitizedArgs.attachments = sanitizedArgs.attachments.map((attachment) => {
      if (!attachment || typeof attachment !== "object") {
        return attachment;
      }

      const safeAttachment = { ...(attachment as Record<string, unknown>) };
      if (typeof safeAttachment.content === "string") {
        safeAttachment.content = truncate(safeAttachment.content);
      }
      return safeAttachment;
    });
  }

  return sanitizedArgs;
}

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
    await mkdir(dir, { recursive: true });

    const logPath = auditLogPath();
    // node:fs stat gives fresh size — Bun.file().size is cached at creation time
    const { stat: fsStat } = await import("node:fs/promises");
    let shouldChmod = false;
    try {
      const stats = await fsStat(logPath);
      if (stats.size > MAX_LOG_SIZE) {
        await rename(logPath, `${logPath}.1`);
        shouldChmod = true;
      }
    } catch {
      shouldChmod = true; // File doesn't exist yet
    }

    const fullEntry: AuditEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
      args: sanitizeArgs(entry.args),
    };

    const line = JSON.stringify(fullEntry) + "\n";
    // node:fs appendFile is atomic for small writes — intentional exception to Bun.file preference
    const { appendFile: fsAppend } = await import("node:fs/promises");
    await fsAppend(logPath, line);

    if (shouldChmod) {
      await chmod(logPath, 0o600).catch(() => {
        // Best-effort only (Windows may ignore mode bits)
      });
    }
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
  const file = Bun.file(logPath);

  if (!(await file.exists())) {
    return [];
  }

  const content = await file.text();
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
