/**
 * Snooze Module
 *
 * Functions for snoozing and unsnoozing email threads via Superhuman's backend API.
 * Supports both Microsoft/Outlook and Gmail accounts.
 *
 * Uses direct API calls via superhumanFetch (no CDP/browser connection needed).
 */

import type { SuperhumanTokenInfo, TokenInfo } from "./token-api";
import { superhumanFetch, gmailFetch, msgraphFetch } from "./token-api";
import { escapeODataStringLiteral } from "./api/gmail-client";
import type { ConnectionProvider } from "./connection-provider";
import { randomUUID } from "node:crypto";
import { createLogger } from "./logger";

const log = createLogger("snooze");

export interface SnoozeResult {
  success: boolean;
  reminderId?: string;
  error?: string;
}

export interface SnoozedThread {
  id: string;
  snoozeUntil?: string;
  reminderId?: string;
}

/**
 * Preset snooze times
 */
export type SnoozePreset = "tomorrow" | "next-week" | "weekend" | "evening";

/**
 * Calculate snooze time from preset
 */
export function getSnoozeTimeFromPreset(preset: SnoozePreset): Date {
  const now = new Date();
  const result = new Date();

  switch (preset) {
    case "tomorrow":
      // Tomorrow at 9 AM
      result.setDate(now.getDate() + 1);
      result.setHours(9, 0, 0, 0);
      break;
    case "next-week":
      // Next Monday at 9 AM
      const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
      result.setDate(now.getDate() + daysUntilMonday);
      result.setHours(9, 0, 0, 0);
      break;
    case "weekend":
      // Saturday at 9 AM
      const daysUntilSaturday = (6 - now.getDay() + 7) % 7 || 7;
      result.setDate(now.getDate() + daysUntilSaturday);
      result.setHours(9, 0, 0, 0);
      break;
    case "evening":
      // Today at 6 PM, or tomorrow if past 6 PM
      result.setHours(18, 0, 0, 0);
      if (result <= now) {
        result.setDate(result.getDate() + 1);
      }
      break;
  }

  return result;
}

/**
 * Parse snooze time from string (preset or ISO datetime)
 */
export function parseSnoozeTime(timeStr: string): Date {
  // Check if it's a preset
  const presets: SnoozePreset[] = ["tomorrow", "next-week", "weekend", "evening"];
  if (presets.includes(timeStr as SnoozePreset)) {
    return getSnoozeTimeFromPreset(timeStr as SnoozePreset);
  }

  // Try to parse as ISO datetime
  const date = new Date(timeStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid snooze time: ${timeStr}`);
  }

  return date;
}

// ============================================================================
// Direct API Functions (using Superhuman Backend Token)
// These bypass CDP and call Superhuman's backend APIs directly.
// ============================================================================

/**
 * Generate a UUID for reminder IDs.
 */
function generateUUID(): string {
  return randomUUID();
}

/**
 * Snooze a thread using direct Superhuman backend API.
 *
 * @param token - Superhuman backend token
 * @param threadId - Thread ID to snooze
 * @param messageIds - Array of message IDs in the thread
 * @param snoozeUntil - When to unsnooze (ISO string)
 * @returns Result with success status and reminder ID
 */
export async function snoozeThreadDirect(
  token: SuperhumanTokenInfo,
  threadId: string,
  messageIds: string[],
  snoozeUntil: string
): Promise<SnoozeResult> {
  const reminderId = generateUUID();
  const now = new Date().toISOString();

  const reminderData = {
    reminderId,
    threadId,
    messageIds,
    triggerAt: snoozeUntil,
    clientCreatedAt: now,
  };

  try {
    const result = await superhumanFetch(token.token, "/reminders/create", {
      method: "POST",
      body: JSON.stringify({
        reminder: reminderData,
        markDone: false,
        moveToInbox: false,
        poll: true,
      }),
    });

    if (result === null) {
      return { success: false, error: "Authentication failed" };
    }

    return { success: true, reminderId };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/**
 * Unsnooze a thread using direct Superhuman backend API.
 *
 * @param token - Superhuman backend token
 * @param threadId - Thread ID to unsnooze
 * @param reminderId - Reminder ID to cancel
 * @returns Result with success status
 */
export async function unsnoozeThreadDirect(
  token: SuperhumanTokenInfo,
  threadId: string,
  reminderId: string
): Promise<SnoozeResult> {
  try {
    const result = await superhumanFetch(token.token, "/reminders/cancel", {
      method: "POST",
      body: JSON.stringify({
        reminderId,
        threadId,
        moveToInbox: true,
        poll: true,
      }),
    });

    if (result === null) {
      return { success: false, error: "Authentication failed" };
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/**
 * List snoozed threads using direct Superhuman backend API.
 *
 * @param token - Superhuman backend token
 * @param limit - Maximum number of threads to return
 * @returns Array of snoozed threads
 */
export async function listSnoozedDirect(
  token: SuperhumanTokenInfo,
  limit: number = 50,
  offset: number = 0
): Promise<SnoozedThread[]> {
  try {
    const result = await superhumanFetch(token.token, "/v3/userdata.getThreads", {
      method: "POST",
      body: JSON.stringify({
        filter: { type: "reminder" },
        offset,
        limit,
      }),
    });

    log.debug(`listSnoozedDirect result: ${result === null ? "null" : JSON.stringify(Object.keys(result))}`);
    if (result === null || !result.threadList) {
      return [];
    }

    for (const item of result.threadList.slice(0, 3)) {
      log.debug("raw snoozed item:", JSON.stringify(item, null, 2));
    }

    return result.threadList.map((item: any) => {
      // Try multiple paths for reminderId — API structure varies
      const reminder = item.thread?.reminder;
      const reminderId =
        reminder?.reminderId ||
        reminder?.id ||
        item.reminder?.reminderId ||
        item.reminder?.id ||
        item.reminderId ||
        item.id ||
        "";

      const threadId =
        reminder?.threadId ||
        item.thread?.id ||
        item.threadId ||
        item.id ||
        "";

      const snoozeUntil =
        reminder?.triggerAt ||
        item.reminder?.triggerAt ||
        item.snoozeUntil ||
        "";

      log.debug(`snoozed thread mapping: threadId=${threadId}, reminderId=${reminderId}, snoozeUntil=${snoozeUntil}`);

      return { id: threadId, snoozeUntil, reminderId };
    });
  } catch (_e) {
    log.debug(`listSnoozedDirect error: ${_e}`);
    return [];
  }
}

// ============================================================================
// ConnectionProvider-based Functions
// These accept a ConnectionProvider and use the direct API functions internally.
// ============================================================================

/**
 * Get message IDs for a thread using direct Gmail/MS Graph API.
 */
async function getThreadMessageIds(
  token: TokenInfo,
  threadId: string
): Promise<string[]> {
  if (token.isMicrosoft) {
    // MS Graph: search messages by conversationId (server-side filter first)
    try {
      const safeThreadId = escapeODataStringLiteral(threadId);
      const result = await msgraphFetch(token.accessToken, `/me/messages?$select=id,conversationId&$filter=conversationId eq '${safeThreadId}'`);
      if (result?.value?.length > 0) {
        return result.value.map((m: any) => m.id);
      }
    } catch {
      // InefficientFilter or other server-side filter error — fall through to client-side
    }
    // Fallback: client-side filter
    const result = await msgraphFetch(token.accessToken, `/me/messages?$top=50&$select=id,conversationId&$orderby=receivedDateTime desc`);
    if (!result?.value) return [];
    return result.value
      .filter((m: any) => m.conversationId === threadId)
      .map((m: any) => m.id);
  } else {
    // Gmail: GET /threads/{threadId} to get message list
    const result = await gmailFetch(token.accessToken, `/threads/${threadId}?format=minimal`);
    if (!result?.messages) return [];
    return result.messages.map((m: any) => m.id);
  }
}

/**
 * Snooze a thread using ConnectionProvider.
 * Gets token from the provider, resolves message IDs, then calls the direct API.
 */
export async function snoozeThreadViaProvider(
  provider: ConnectionProvider,
  threadIds: string[],
  snoozeUntil: Date | string
): Promise<SnoozeResult[]> {
  const token = await provider.getToken();

  if (!token.idToken) {
    throw new Error(
      "Superhuman backend credentials required for snooze. Run 'superhuman account auth'."
    );
  }

  const superhumanToken: SuperhumanTokenInfo = {
    token: token.idToken,
    email: token.email,
  };

  const triggerAt = typeof snoozeUntil === "string" ? snoozeUntil : snoozeUntil.toISOString();
  const results: SnoozeResult[] = [];

  for (const threadId of threadIds) {
    // Get message IDs for the thread
    const messageIds = await getThreadMessageIds(token, threadId);
    if (messageIds.length === 0) {
      results.push({ success: false, error: "No messages found in thread" });
      continue;
    }

    const result = await snoozeThreadDirect(superhumanToken, threadId, messageIds, triggerAt);
    results.push(result);
  }

  return results;
}

/**
 * Unsnooze threads using ConnectionProvider.
 * First lists snoozed threads to find reminder IDs, then cancels them.
 */
export async function unsnoozeThreadViaProvider(
  provider: ConnectionProvider,
  threadIds: string[]
): Promise<SnoozeResult[]> {
  const token = await provider.getToken();

  if (!token.idToken) {
    throw new Error(
      "Superhuman backend credentials required for unsnooze. Run 'superhuman account auth'."
    );
  }

  const superhumanToken: SuperhumanTokenInfo = {
    token: token.idToken,
    email: token.email,
  };

  // Fetch snoozed threads to find reminder IDs.
  // Superhuman backend rejects limit > ~50, so paginate in batches of 50.
  log.debug(`unsnooze token present: ${!!token.idToken}, email: ${token.email}`);
  let snoozedThreads: SnoozedThread[] = [];
  let offset = 0;
  const PAGE_SIZE = 50;
  while (true) {
    const page = await listSnoozedDirect(superhumanToken, PAGE_SIZE, offset);
    snoozedThreads = snoozedThreads.concat(page);
    // Stop if we got fewer than a full page, or if we've found all target thread IDs
    if (page.length < PAGE_SIZE) break;
    const allFound = threadIds.every(tid => snoozedThreads.some(st => st.id === tid));
    if (allFound) break;
    offset += PAGE_SIZE;
  }
  const results: SnoozeResult[] = [];

  for (const threadId of threadIds) {
    const snoozed = snoozedThreads.find((t) => t.id === threadId);
    if (!snoozed?.reminderId) {
      log.debug(`No match for threadId="${threadId}" in ${snoozedThreads.length} snoozed threads: ${snoozedThreads.map(t => t.id).join(", ")}`);
      results.push({
        success: false,
        error: `Could not find reminder ID for thread ${threadId}`,
      });
      continue;
    }

    const result = await unsnoozeThreadDirect(
      superhumanToken,
      threadId,
      snoozed.reminderId
    );
    results.push(result);
  }

  return results;
}

/**
 * List snoozed threads using ConnectionProvider.
 */
export async function listSnoozedViaProvider(
  provider: ConnectionProvider,
  limit: number = 50
): Promise<SnoozedThread[]> {
  const token = await provider.getToken();

  if (!token.idToken) {
    throw new Error(
      "Superhuman backend credentials required for listing snoozed threads. Run 'superhuman account auth'."
    );
  }

  const superhumanToken: SuperhumanTokenInfo = {
    token: token.idToken,
    email: token.email,
  };

  return listSnoozedDirect(superhumanToken, limit);
}
