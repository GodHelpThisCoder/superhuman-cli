/**
 * Calendar Module
 *
 * Functions for calendar operations via direct Google Calendar/MS Graph API.
 * Supports both Google Calendar and Microsoft Graph accounts.
 */

import type { SuperhumanConnection } from "./superhuman-api";
import {
  type TokenInfo,
  type CalendarEventDirect as CalendarEvent,
  type CreateCalendarEventInput as CreateEventInput,
  type UpdateCalendarEventInput as UpdateEventInput,
  type FreeBusySlot,
  getToken,
  listCalendarEventsDirect,
  createCalendarEventDirect,
  updateCalendarEventDirect,
  deleteCalendarEventDirect,
  getFreeBusyDirect,
} from "./token-api";
import { listAccounts } from "./accounts";

// Re-export the calendar event type for external use
export type { CalendarEvent };

/**
 * Result of a calendar operation (create, update, delete)
 */
export interface CalendarResult {
  success: boolean;
  eventId?: string;
  error?: string;
}

// Re-export types for external use
export type { FreeBusySlot, CreateEventInput, UpdateEventInput };

/**
 * Result of a free/busy query
 */
export interface FreeBusyResult {
  busy: FreeBusySlot[];
  free: FreeBusySlot[];
}

/**
 * Options for listing events
 */
export interface ListEventsOptions {
  calendarId?: string;
  timeMin?: Date | string;
  timeMax?: Date | string;
  limit?: number;
}

/**
 * Get token for the current account.
 */
async function getCurrentToken(conn: SuperhumanConnection): Promise<TokenInfo> {
  const accounts = await listAccounts(conn);
  const currentAccount = accounts.find((a) => a.isCurrent);

  if (!currentAccount) {
    throw new Error("No current account found");
  }

  return getToken(conn, currentAccount.email);
}

/**
 * List calendar events within a time range
 *
 * @param conn - The Superhuman connection
 * @param options - Optional filters for time range and limit
 * @returns Array of calendar events
 */
export async function listEvents(
  conn: SuperhumanConnection,
  options?: ListEventsOptions
): Promise<CalendarEvent[]> {
  try {
    const token = await getCurrentToken(conn);

    const toISOString = (v: Date | string): string =>
      typeof v === "string" ? v : v.toISOString();

    return await listCalendarEventsDirect(token, {
      calendarId: options?.calendarId,
      timeMin: options?.timeMin ? toISOString(options.timeMin) : undefined,
      timeMax: options?.timeMax ? toISOString(options.timeMax) : undefined,
      limit: options?.limit,
    });
  } catch (e: any) {
    console.error("listEvents error:", e.message);
    return [];
  }
}

/**
 * Create a new calendar event
 *
 * @param conn - The Superhuman connection
 * @param event - The event data to create
 * @returns Result with success status and eventId if successful
 */
export async function createEvent(
  conn: SuperhumanConnection,
  event: CreateEventInput
): Promise<CalendarResult> {
  try {
    const token = await getCurrentToken(conn);
    const result = await createCalendarEventDirect(token, event);

    if (!result) {
      return { success: false, error: "Failed to create event" };
    }

    return { success: true, eventId: result.eventId };
  } catch (e: any) {
    return { success: false, error: e.message || "Unknown error" };
  }
}

/**
 * Delete a calendar event
 *
 * @param conn - The Superhuman connection
 * @param eventId - The ID of the event to delete
 * @param calendarId - Optional calendar ID (required for Google Calendar)
 * @returns Result with success status
 */
export async function deleteEvent(
  conn: SuperhumanConnection,
  eventId: string,
  calendarId?: string
): Promise<CalendarResult> {
  try {
    const token = await getCurrentToken(conn);

    const success = await deleteCalendarEventDirect(token, eventId, calendarId);

    if (!success) {
      return { success: false, error: "Failed to delete event" };
    }

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || "Unknown error" };
  }
}

/**
 * Update an existing calendar event
 *
 * @param conn - The Superhuman connection
 * @param eventId - The ID of the event to update
 * @param updates - The fields to update (partial update)
 * @param calendarId - Optional calendar ID (required for Google Calendar)
 * @returns Result with success status
 */
export async function updateEvent(
  conn: SuperhumanConnection,
  eventId: string,
  updates: UpdateEventInput,
  calendarId?: string
): Promise<CalendarResult> {
  try {
    const token = await getCurrentToken(conn);
    const success = await updateCalendarEventDirect(token, eventId, updates, calendarId);

    if (!success) {
      return { success: false, error: "Failed to update event" };
    }

    return { success: true, eventId };
  } catch (e: any) {
    return { success: false, error: e.message || "Unknown error" };
  }
}

/**
 * Options for checking free/busy availability
 */
export interface FreeBusyOptions {
  timeMin: Date | string;
  timeMax: Date | string;
  calendarIds?: string[]; // Optional: specific calendars to check
}

/**
 * Check free/busy availability for a time range
 *
 * @param conn - The Superhuman connection
 * @param options - Time range and optional calendar IDs
 * @returns Free/busy slots
 */
export async function getFreeBusy(
  conn: SuperhumanConnection,
  options: FreeBusyOptions
): Promise<FreeBusyResult> {
  try {
    const token = await getCurrentToken(conn);

    const toISOString = (v: Date | string): string =>
      typeof v === "string" ? v : v.toISOString();

    const busy = await getFreeBusyDirect(
      token,
      toISOString(options.timeMin),
      toISOString(options.timeMax),
      options.calendarIds
    );

    return { busy, free: [] };
  } catch (e: any) {
    console.error("getFreeBusy error:", e.message);
    return { busy: [], free: [] };
  }
}
