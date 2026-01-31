/**
 * Snooze Module
 *
 * Functions for snoozing and unsnoozing email threads via Superhuman's internal APIs.
 * Supports both Microsoft/Outlook and Gmail accounts.
 */

import type { SuperhumanConnection } from "./superhuman-api";

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

/**
 * Snooze a thread until a specific time
 *
 * @param conn - The Superhuman connection
 * @param threadId - The thread ID to snooze
 * @param snoozeUntil - When to unsnooze (Date object or ISO string)
 * @returns Result with success status and reminder ID
 */
export async function snoozeThread(
  conn: SuperhumanConnection,
  threadId: string,
  snoozeUntil: Date | string
): Promise<SnoozeResult> {
  const { Runtime } = conn;

  const triggerAt = typeof snoozeUntil === "string" ? snoozeUntil : snoozeUntil.toISOString();

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const threadId = ${JSON.stringify(threadId)};
          const triggerAt = ${JSON.stringify(triggerAt)};
          const ga = window.GoogleAccount;
          const backend = ga?.backend;

          if (!backend) {
            return { success: false, error: "Backend not found" };
          }

          // Get the thread and its message IDs
          const thread = ga?.threads?.identityMap?.get?.(threadId);
          if (!thread) {
            return { success: false, error: "Thread not found" };
          }

          const model = thread._threadModel;
          const messageIds = model?.messageIds || [];

          if (messageIds.length === 0) {
            return { success: false, error: "No messages found in thread" };
          }

          // Generate a unique reminder ID
          function generateUUID() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
              const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
              return v.toString(16);
            });
          }

          const reminderId = generateUUID();
          const now = new Date();

          // Create a reminder object
          const reminderData = {
            attributes: {
              reminderId: reminderId,
              threadId: threadId,
              messageIds: messageIds,
              triggerAt: triggerAt,
              clientCreatedAt: now.toISOString(),
            },
            toJson: function() {
              return {
                reminderId: this.attributes.reminderId,
                threadId: this.attributes.threadId,
                messageIds: this.attributes.messageIds,
                triggerAt: this.attributes.triggerAt,
                clientCreatedAt: this.attributes.clientCreatedAt,
              };
            }
          };

          try {
            await backend.createReminder(reminderData, { markDone: false, moveToInbox: false });
            return { success: true, reminderId: reminderId };
          } catch (e) {
            return { success: false, error: e.message || "Failed to create reminder" };
          }
        } catch (e) {
          return { success: false, error: e.message || "Unknown error" };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  const value = result.result.value as SnoozeResult | null;
  return {
    success: value?.success ?? false,
    reminderId: value?.reminderId,
    error: value?.error,
  };
}

/**
 * Unsnooze a thread (cancel the reminder)
 *
 * @param conn - The Superhuman connection
 * @param threadId - The thread ID to unsnooze
 * @param reminderId - Optional reminder ID. If not provided, will try to find it.
 * @returns Result with success status
 */
export async function unsnoozeThread(
  conn: SuperhumanConnection,
  threadId: string,
  reminderId?: string
): Promise<SnoozeResult> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const threadId = ${JSON.stringify(threadId)};
          let reminderId = ${reminderId ? JSON.stringify(reminderId) : "null"};
          const ga = window.GoogleAccount;
          const backend = ga?.backend;

          if (!backend) {
            return { success: false, error: "Backend not found" };
          }

          // If no reminder ID provided, try to find it from the thread's superhumanData
          if (!reminderId) {
            const thread = ga?.threads?.identityMap?.get?.(threadId);
            if (thread) {
              const model = thread._threadModel;
              const shData = model?.superhumanData;
              reminderId = shData?.reminderId;
            }
          }

          // If still no reminder ID, try to find from snoozed list
          if (!reminderId) {
            try {
              const portal = ga?.portal;
              const snoozedResult = await portal.invoke(
                "threadInternal",
                "listAsync",
                ["SNOOZED", { limit: 100, filters: [], query: "" }]
              );

              const snoozedThread = (snoozedResult?.threads || []).find(t =>
                t.json?.id === threadId
              );

              if (snoozedThread?.superhumanData?.reminderId) {
                reminderId = snoozedThread.superhumanData.reminderId;
              }
            } catch (e) {
              // Ignore errors in finding reminder ID
            }
          }

          if (!reminderId) {
            // Generate a dummy ID and try anyway - the backend might accept it
            // This is a fallback when we can't find the reminder ID
            return { success: false, error: "Could not find reminder ID for thread" };
          }

          try {
            await backend.cancelReminder({
              reminderId: reminderId,
              threadId: threadId,
              moveToInbox: true
            });
            return { success: true };
          } catch (e) {
            return { success: false, error: e.message || "Failed to cancel reminder" };
          }
        } catch (e) {
          return { success: false, error: e.message || "Unknown error" };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  const value = result.result.value as SnoozeResult | null;
  return {
    success: value?.success ?? false,
    error: value?.error,
  };
}

/**
 * List all snoozed threads
 *
 * @param conn - The Superhuman connection
 * @param limit - Maximum number of threads to return (default: 50)
 * @returns Array of snoozed threads with their IDs
 */
export async function listSnoozed(
  conn: SuperhumanConnection,
  limit: number = 50
): Promise<SnoozedThread[]> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const portal = ga?.portal;

          if (!portal) {
            return { error: "Portal not found", threads: [] };
          }

          try {
            const snoozedResult = await portal.invoke(
              "threadInternal",
              "listAsync",
              ["SNOOZED", { limit: ${limit}, filters: [], query: "" }]
            );

            if (!snoozedResult?.threads) {
              return { threads: [] };
            }

            return {
              threads: snoozedResult.threads.map(t => {
                const json = t.json || {};
                const shData = t.superhumanData || {};
                return {
                  id: json.id || '',
                  snoozeUntil: shData.snoozeUntil || shData.triggerAt,
                  reminderId: shData.reminderId
                };
              })
            };
          } catch (e) {
            return { error: e.message, threads: [] };
          }
        } catch (e) {
          return { error: e.message || "Unknown error", threads: [] };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  const value = result.result.value as { threads: SnoozedThread[]; error?: string } | null;
  return value?.threads ?? [];
}
