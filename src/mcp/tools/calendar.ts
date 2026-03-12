/**
 * MCP tool handlers for calendar operations: list, create, update, delete, free/busy.
 */

import { z } from "zod";
import {
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent as deleteCalendarEvent,
  getFreeBusy,
  type CreateEventInput,
  type UpdateEventInput,
} from "../../calendar";
import type { ConnectionProvider } from "../../connection-provider";
import { successResult, errorResult, actionableError, getMcpProvider, guardMutation, auditMutation, auditDryRun, type ToolResult } from "./shared";
import { isConfirmedExecution, stageOperation, buildStagedResponse } from "../confirmation";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const CalendarListSchema = z.object({
  preset: z.enum(["today", "tomorrow", "this-week", "next-week"]).optional()
    .describe("Quick date preset. Takes precedence over start/end."),
  start: z.string().optional()
    .describe("Start as ISO datetime (e.g., 2026-03-05T00:00:00). Used with 'end'."),
  end: z.string().optional()
    .describe("End as ISO datetime. Defaults to end of start day."),
  range: z.number().optional()
    .describe("Number of days from start (default: 1). Ignored if end is provided."),
});

export const CalendarCreateSchema = z.object({
  title: z.string().describe("Event title/summary"),
  startTime: z.string().describe("Start time as ISO datetime (e.g., 2026-02-03T14:00:00Z)"),
  endTime: z.string().optional().describe("End time as ISO datetime (optional, defaults to 30 minutes after start)"),
  description: z.string().optional().describe("Event description"),
  attendees: z.array(z.string()).optional().describe("List of attendee email addresses"),
  allDay: z.boolean().optional().describe("Whether this is an all-day event (if true, use date format YYYY-MM-DD for startTime)"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
});

export const CalendarUpdateSchema = z.object({
  eventId: z.string().describe("The event ID to update"),
  title: z.string().optional().describe("New event title/summary"),
  startTime: z.string().optional().describe("New start time as ISO datetime"),
  endTime: z.string().optional().describe("New end time as ISO datetime"),
  description: z.string().optional().describe("New event description"),
  attendees: z.array(z.string()).optional().describe("New list of attendee email addresses"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
});

export const CalendarDeleteSchema = z.object({
  eventId: z.string().describe("The event ID to delete"),
  dryRun: z.boolean().optional().describe("Preview what would happen without executing"),
});

export const CalendarFreeBusySchema = z.object({
  timeMin: z.string().describe("Start of time range as ISO datetime"),
  timeMax: z.string().describe("End of time range as ISO datetime"),
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function calendarListHandler(args: z.infer<typeof CalendarListSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();

    let timeMin: Date;
    let timeMax: Date;

    if (args.preset) {
      // Preset takes precedence
      timeMin = new Date();
      timeMin.setHours(0, 0, 0, 0);
      let days = 1;
      switch (args.preset) {
        case "today":
          break;
        case "tomorrow":
          timeMin.setDate(timeMin.getDate() + 1);
          break;
        case "this-week": {
          const dow = timeMin.getDay();
          // Start from today, end at Sunday
          days = 7 - dow;
          break;
        }
        case "next-week": {
          const dow2 = timeMin.getDay();
          const daysUntilMonday = ((8 - dow2) % 7) || 7;
          timeMin.setDate(timeMin.getDate() + daysUntilMonday);
          days = 7;
          break;
        }
      }
      timeMax = new Date(timeMin);
      timeMax.setDate(timeMax.getDate() + days);
      timeMax.setHours(23, 59, 59, 999);
    } else if (args.start) {
      timeMin = new Date(args.start);
      if (isNaN(timeMin.getTime())) throw new Error(`Invalid start time: ${args.start}`);
      if (args.end) {
        timeMax = new Date(args.end);
        if (isNaN(timeMax.getTime())) throw new Error(`Invalid end time: ${args.end}`);
      } else {
        const range = args.range || 1;
        timeMax = new Date(timeMin);
        timeMax.setDate(timeMax.getDate() + range);
        timeMax.setHours(23, 59, 59, 999);
      }
    } else {
      // Default: today
      timeMin = new Date();
      timeMin.setHours(0, 0, 0, 0);
      const range = args.range || 1;
      timeMax = new Date(timeMin);
      timeMax.setDate(timeMax.getDate() + range);
      timeMax.setHours(23, 59, 59, 999);
    }

    const events = await listEvents(provider, { timeMin, timeMax });

    return successResult(JSON.stringify(events, null, 2));
  } catch (error) {
    return actionableError("Failed to list calendar events", error);
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function calendarCreateHandler(args: z.infer<typeof CalendarCreateSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_calendar_create", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would create calendar event "${args.title}" at ${args.startTime}`);
  }

  const killed = guardMutation("superhuman_calendar_create", args as Record<string, unknown>);
  if (killed) return killed;

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();

      // Two-phase: stage unless this is a confirmed execution
      if (!isConfirmedExecution()) {
        const preview = `Would create calendar event "${args.title}" at ${args.startTime}`;
        const token = stageOperation("superhuman_calendar_create", args as Record<string, unknown>, preview, account);
        auditMutation("superhuman_calendar_create", args as Record<string, unknown>, account, successResult(preview), { action: "staged", durationMs: Math.round(performance.now() - _t0) });
        return successResult(buildStagedResponse(preview, token));
      }

    const startTime = new Date(args.startTime);
    let endTime: Date;
    if (args.endTime) {
      endTime = new Date(args.endTime);
    } else {
      endTime = new Date(startTime.getTime() + 30 * 60 * 1000);
    }

    const eventInput: CreateEventInput = {
      summary: args.title,
      description: args.description,
      start: args.allDay
        ? { date: args.startTime.split("T")[0] }
        : { dateTime: startTime.toISOString() },
      end: args.allDay
        ? { date: endTime.toISOString().split("T")[0] }
        : { dateTime: endTime.toISOString() },
      attendees: args.attendees?.map(email => ({ email })),
    };

    const result = await createEvent(provider, eventInput);

    if (result.success) {
      const toolResult = successResult(JSON.stringify({
        success: true,
        eventId: result.eventId,
        message: "Event created successfully",
      }));
      auditMutation("superhuman_calendar_create", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else {
      const toolResult = errorResult(`Failed to create event: ${result.error}`);
      auditMutation("superhuman_calendar_create", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to create calendar event", error);
    auditMutation("superhuman_calendar_create", args as Record<string, unknown>, "unknown", toolResult, { durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function calendarUpdateHandler(args: z.infer<typeof CalendarUpdateSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_calendar_update", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would update calendar event ${args.eventId}`);
  }

  const killed = guardMutation("superhuman_calendar_update", args as Record<string, unknown>);
  if (killed) return killed;

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();

      // Two-phase: stage unless this is a confirmed execution
      if (!isConfirmedExecution()) {
        const changes = [args.title && "title", args.startTime && "time", args.description && "description", args.attendees && "attendees"].filter(Boolean).join(", ");
        const preview = `Would update calendar event ${args.eventId}${changes ? ` (${changes})` : ""}`;
        const token = stageOperation("superhuman_calendar_update", args as Record<string, unknown>, preview, account);
        auditMutation("superhuman_calendar_update", args as Record<string, unknown>, account, successResult(preview), { action: "staged", durationMs: Math.round(performance.now() - _t0) });
        return successResult(buildStagedResponse(preview, token));
      }

    const updates: UpdateEventInput = {};
    if (args.title) updates.summary = args.title;
    if (args.description) updates.description = args.description;
    if (args.startTime) updates.start = { dateTime: new Date(args.startTime).toISOString() };
    if (args.endTime) updates.end = { dateTime: new Date(args.endTime).toISOString() };
    if (args.attendees) updates.attendees = args.attendees.map(email => ({ email }));

    const result = await updateEvent(provider, args.eventId, updates);

    if (result.success) {
      const toolResult = successResult(JSON.stringify({
        success: true,
        eventId: result.eventId,
        message: "Event updated successfully",
      }));
      auditMutation("superhuman_calendar_update", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else {
      const toolResult = errorResult(`Failed to update event: ${result.error}`);
      auditMutation("superhuman_calendar_update", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to update calendar event", error);
    auditMutation("superhuman_calendar_update", args as Record<string, unknown>, "unknown", toolResult, { durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function calendarDeleteHandler(args: z.infer<typeof CalendarDeleteSchema>): Promise<ToolResult> {
  const _t0 = performance.now();
  if (args.dryRun) {
    auditDryRun("superhuman_calendar_delete", args as Record<string, unknown>, Math.round(performance.now() - _t0));
    return successResult(`[DRY RUN] Would delete calendar event ${args.eventId}`);
  }

  const killed = guardMutation("superhuman_calendar_delete", args as Record<string, unknown>);
  if (killed) return killed;

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const account = await provider.getCurrentEmail();

      // Two-phase: stage unless this is a confirmed execution
      if (!isConfirmedExecution()) {
        const preview = `Would delete calendar event ${args.eventId}`;
        const token = stageOperation("superhuman_calendar_delete", args as Record<string, unknown>, preview, account);
        auditMutation("superhuman_calendar_delete", args as Record<string, unknown>, account, successResult(preview), { action: "staged", durationMs: Math.round(performance.now() - _t0) });
        return successResult(buildStagedResponse(preview, token));
      }

    const result = await deleteCalendarEvent(provider, args.eventId);

    if (result.success) {
      const toolResult = successResult(JSON.stringify({
        success: true,
        message: `Event ${args.eventId} deleted successfully`,
      }));
      auditMutation("superhuman_calendar_delete", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    } else {
      const toolResult = errorResult(`Failed to delete event: ${result.error}`);
      auditMutation("superhuman_calendar_delete", args as Record<string, unknown>, account, toolResult, { durationMs: Math.round(performance.now() - _t0) });
      return toolResult;
    }
  } catch (error) {
    const toolResult = actionableError("Failed to delete calendar event", error);
    auditMutation("superhuman_calendar_delete", args as Record<string, unknown>, "unknown", toolResult, { durationMs: Math.round(performance.now() - _t0) });
    return toolResult;
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}

export async function calendarFreeBusyHandler(args: z.infer<typeof CalendarFreeBusySchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const result = await getFreeBusy(provider, {
      timeMin: new Date(args.timeMin),
      timeMax: new Date(args.timeMax),
    });

    return successResult(JSON.stringify(result, null, 2));
  } catch (error) {
    return actionableError("Failed to check free/busy", error);
  } finally {
    // Do NOT disconnect — provider is cached by getMcpProvider() for reuse across calls
  }
}
