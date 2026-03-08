/**
 * Calendar operations for Google Calendar and Microsoft Graph APIs.
 *
 * Provides CRUD operations for calendar events plus free/busy queries,
 * normalized across both providers into a common {@link CalendarEventDirect}
 * shape.
 */

import type {
  TokenInfo,
  CalendarEventDirect,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
  ListCalendarEventsOptions,
  FreeBusySlot,
} from "../auth/types";

import { gcalFetch, msgraphFetch, MSGRAPH_API_BASE } from "./http-utils";

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Map MS Graph response status to our format.
 */
function mapMsResponseStatus(status?: string): "needsAction" | "accepted" | "declined" | "tentative" {
  switch (status) {
    case "accepted":
      return "accepted";
    case "declined":
      return "declined";
    case "tentativelyAccepted":
      return "tentative";
    default:
      return "needsAction";
  }
}

/**
 * Convert our date/time format to MS Graph format.
 * MS Graph requires dateTime even for all-day events.
 */
function toMsGraphDateTime(
  input: { dateTime?: string; date?: string; timeZone?: string },
  isEndTime: boolean = false,
): { dateTime: string | undefined; timeZone: string } {
  const dateTime = input.dateTime ||
    (input.date ? `${input.date}T${isEndTime ? "23:59:59" : "00:00:00"}` : undefined);
  return {
    dateTime,
    timeZone: input.timeZone || "UTC",
  };
}

/**
 * Convert attendees to MS Graph format.
 */
function toMsGraphAttendees(
  attendees?: Array<{ email: string; displayName?: string }>,
): Array<{ emailAddress: { address: string; name: string }; type: string }> {
  return (attendees || []).map((a) => ({
    emailAddress: { address: a.email, name: a.displayName || "" },
    type: "required",
  }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List calendar events via Google Calendar or MS Graph API.
 *
 * @param token   - Token info
 * @param options - Filtering options (time range, limit)
 * @returns Array of calendar events
 */
export async function listCalendarEvents(
  token: TokenInfo,
  options?: ListCalendarEventsOptions,
): Promise<CalendarEventDirect[]> {
  const now = new Date();
  const timeMin = options?.timeMin || now.toISOString();
  const timeMax = options?.timeMax || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const limit = options?.limit || 50;

  if (token.isMicrosoft) {
    // MS Graph: Get calendar view
    let calendarId = options?.calendarId;

    // If no calendar ID, get the default calendar
    if (!calendarId) {
      const calendarsResult = await msgraphFetch(token.accessToken, "/me/calendars?$filter=isDefaultCalendar eq true");
      if (calendarsResult?.value?.[0]?.id) {
        calendarId = calendarsResult.value[0].id;
      } else {
        // Fallback to primary calendar
        const primaryResult = await msgraphFetch(token.accessToken, "/me/calendar");
        calendarId = primaryResult?.id;
      }
    }

    if (!calendarId) {
      return [];
    }

    const path = `/me/calendars/${calendarId}/calendarView?startDateTime=${encodeURIComponent(timeMin)}&endDateTime=${encodeURIComponent(timeMax)}&$top=${limit}&$orderby=start/dateTime`;
    const result = await msgraphFetch(token.accessToken, path);

    if (!result || !result.value) {
      return [];
    }

    return result.value.map((e: any) => ({
      id: e.id,
      calendarId: calendarId,
      summary: e.subject || "",
      description: e.bodyPreview || e.body?.content || "",
      start: {
        dateTime: e.start?.dateTime,
        timeZone: e.start?.timeZone,
        date: e.isAllDay ? e.start?.dateTime?.split("T")[0] : undefined,
      },
      end: {
        dateTime: e.end?.dateTime,
        timeZone: e.end?.timeZone,
        date: e.isAllDay ? e.end?.dateTime?.split("T")[0] : undefined,
      },
      attendees: (e.attendees || []).map((a: any) => ({
        email: a.emailAddress?.address || "",
        displayName: a.emailAddress?.name || "",
        responseStatus: mapMsResponseStatus(a.status?.response),
        organizer: e.organizer?.emailAddress?.address === a.emailAddress?.address,
      })),
      recurrence: e.recurrence ? [JSON.stringify(e.recurrence)] : undefined,
      recurringEventId: e.seriesMasterId,
      htmlLink: e.webLink,
      conferenceData: e.onlineMeeting,
      status: e.isCancelled ? "cancelled" : "confirmed",
      allDay: e.isAllDay,
      isOrganizer: e.isOrganizer,
      provider: "microsoft",
      location: e.location?.displayName,
    }));
  } else {
    // Google Calendar: Get events list
    const calendarId = options?.calendarId || "primary";
    const path = `/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=${limit}&singleEvents=true&orderBy=startTime`;

    const result = await gcalFetch(token.accessToken, path);

    if (!result || !result.items) {
      return [];
    }

    return result.items.map((e: any) => ({
      id: e.id,
      calendarId: calendarId,
      summary: e.summary || "",
      description: e.description || "",
      start: {
        dateTime: e.start?.dateTime,
        date: e.start?.date,
        timeZone: e.start?.timeZone,
      },
      end: {
        dateTime: e.end?.dateTime,
        date: e.end?.date,
        timeZone: e.end?.timeZone,
      },
      attendees: (e.attendees || []).map((a: any) => ({
        email: a.email || "",
        displayName: a.displayName || "",
        responseStatus: a.responseStatus || "needsAction",
        organizer: a.organizer,
        self: a.self,
      })),
      recurrence: e.recurrence,
      recurringEventId: e.recurringEventId,
      htmlLink: e.htmlLink,
      conferenceData: e.conferenceData,
      status: e.status || "confirmed",
      visibility: e.visibility,
      allDay: !!e.start?.date,
      isOrganizer: e.organizer?.self,
      provider: "google",
      location: e.location,
    }));
  }
}

/**
 * Create a calendar event via Google Calendar or MS Graph API.
 *
 * @param token - Token info
 * @param event - Event data to create
 * @returns Created event ID or null on failure
 */
export async function createCalendarEvent(
  token: TokenInfo,
  event: CreateCalendarEventInput,
): Promise<{ eventId: string } | null> {
  if (token.isMicrosoft) {
    // MS Graph: Create event
    let calendarId = event.calendarId;

    // If no calendar ID, get the default calendar
    if (!calendarId) {
      const primaryResult = await msgraphFetch(token.accessToken, "/me/calendar");
      calendarId = primaryResult?.id;
    }

    if (!calendarId) {
      throw new Error("Could not determine calendar ID");
    }

    const msEvent = {
      subject: event.summary,
      body: event.description ? { contentType: "text", content: event.description } : undefined,
      start: toMsGraphDateTime(event.start, false),
      end: toMsGraphDateTime(event.end, true),
      attendees: toMsGraphAttendees(event.attendees),
      location: event.location ? { displayName: event.location } : undefined,
      isAllDay: !!event.start.date && !event.start.dateTime,
    };

    const path = `/me/calendars/${calendarId}/events`;
    const result = await msgraphFetch(token.accessToken, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msEvent),
    });

    if (!result || !result.id) {
      return null;
    }

    return { eventId: result.id };
  } else {
    // Google Calendar: Create event
    const calendarId = event.calendarId || "primary";

    const gcalEvent = {
      summary: event.summary,
      description: event.description,
      start: event.start,
      end: event.end,
      attendees: (event.attendees || []).map((a) => ({
        email: a.email,
        displayName: a.displayName,
      })),
      recurrence: event.recurrence,
      location: event.location,
    };

    const path = `/calendars/${encodeURIComponent(calendarId)}/events`;
    const result = await gcalFetch(token.accessToken, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gcalEvent),
    });

    if (!result || !result.id) {
      return null;
    }

    return { eventId: result.id };
  }
}

/**
 * Update a calendar event via Google Calendar or MS Graph API.
 *
 * @param token      - Token info
 * @param eventId    - The event ID to update
 * @param updates    - Fields to update
 * @param calendarId - Optional calendar ID (required for Google Calendar)
 * @returns true on success
 */
export async function updateCalendarEvent(
  token: TokenInfo,
  eventId: string,
  updates: UpdateCalendarEventInput,
  calendarId?: string,
): Promise<boolean> {
  if (token.isMicrosoft) {
    // MS Graph: Update event
    const msUpdates: Record<string, unknown> = {};

    if (updates.summary) msUpdates.subject = updates.summary;
    if (updates.description) msUpdates.body = { contentType: "text", content: updates.description };
    if (updates.start) msUpdates.start = toMsGraphDateTime(updates.start, false);
    if (updates.end) msUpdates.end = toMsGraphDateTime(updates.end, true);
    if (updates.attendees) msUpdates.attendees = toMsGraphAttendees(updates.attendees);
    if (updates.location) msUpdates.location = { displayName: updates.location };

    const path = `/me/events/${eventId}`;
    const result = await msgraphFetch(token.accessToken, path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msUpdates),
    });

    return result !== null;
  } else {
    // Google Calendar: Patch event - field names match directly
    const calId = calendarId || "primary";
    const path = `/calendars/${encodeURIComponent(calId)}/events/${eventId}`;
    const result = await gcalFetch(token.accessToken, path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    return result !== null;
  }
}

/**
 * Delete a calendar event via Google Calendar or MS Graph API.
 *
 * @param token      - Token info
 * @param eventId    - The event ID to delete
 * @param calendarId - Optional calendar ID (required for Google Calendar)
 * @returns true on success
 */
export async function deleteCalendarEvent(
  token: TokenInfo,
  eventId: string,
  calendarId?: string,
): Promise<boolean> {
  if (token.isMicrosoft) {
    // MS Graph: Delete event
    const path = `/me/events/${eventId}`;
    const response = await fetch(`${MSGRAPH_API_BASE}${path}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    });

    // 204 No Content = success
    return response.status === 204 || response.ok;
  } else {
    // Google Calendar: Delete event
    const calId = calendarId || "primary";
    const path = `/calendars/${encodeURIComponent(calId)}/events/${eventId}`;
    const result = await gcalFetch(token.accessToken, path, {
      method: "DELETE",
    });

    return result !== null;
  }
}

/**
 * Get free/busy information via Google Calendar or MS Graph API.
 *
 * @param token       - Token info
 * @param timeMin     - Start of time range (ISO string)
 * @param timeMax     - End of time range (ISO string)
 * @param calendarIds - Optional calendar IDs to check
 * @returns Array of busy time slots
 */
export async function getFreeBusy(
  token: TokenInfo,
  timeMin: string,
  timeMax: string,
  calendarIds?: string[],
): Promise<FreeBusySlot[]> {
  if (token.isMicrosoft) {
    // MS Graph: Get schedule (free/busy)
    // If specific calendars requested, use getSchedule
    // Otherwise, just query the calendar view and derive busy times
    if (calendarIds && calendarIds.length > 0) {
      const body = {
        schedules: calendarIds,
        startTime: { dateTime: timeMin, timeZone: "UTC" },
        endTime: { dateTime: timeMax, timeZone: "UTC" },
      };

      const result = await msgraphFetch(token.accessToken, "/me/calendar/getSchedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!result || !result.value) {
        return [];
      }

      const busy: FreeBusySlot[] = [];
      for (const schedule of result.value) {
        for (const item of schedule.scheduleItems || []) {
          if (item.status !== "free") {
            busy.push({
              start: item.start?.dateTime || "",
              end: item.end?.dateTime || "",
            });
          }
        }
      }
      return busy;
    } else {
      // Fall back to calendar view
      const events = await listCalendarEvents(token, { timeMin, timeMax });
      return events
        .filter((e) => e.status !== "cancelled")
        .map((e) => ({
          start: e.start.dateTime || e.start.date || "",
          end: e.end.dateTime || e.end.date || "",
        }));
    }
  } else {
    // Google Calendar: FreeBusy query
    const items = calendarIds
      ? calendarIds.map((id) => ({ id }))
      : [{ id: "primary" }];

    const body = {
      timeMin,
      timeMax,
      items,
    };

    const result = await gcalFetch(token.accessToken, "/freeBusy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!result || !result.calendars) {
      return [];
    }

    const busy: FreeBusySlot[] = [];
    for (const calId of Object.keys(result.calendars)) {
      for (const slot of result.calendars[calId].busy || []) {
        busy.push({
          start: slot.start,
          end: slot.end,
        });
      }
    }

    return busy;
  }
}
