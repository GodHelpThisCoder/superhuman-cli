/**
 * MCP Tools barrel — re-exports all schemas and handlers from domain files.
 *
 * The original 1603-line src/mcp/tools.ts has been split into:
 *
 *   tools/shared.ts       — types, helpers (successResult, errorResult, getMcpProvider)
 *   tools/email-read.ts   — search, inbox, read
 *   tools/email-write.ts  — draft, send, reply, reply-all, forward
 *   tools/email-manage.ts — archive/unarchive, archive-by-query, delete, mark read/unread, star/unstar, starred, snooze/unsnooze, snoozed
 *   tools/labels.ts       — list labels, get/create/add/add-by-query/remove label
 *   tools/attachments.ts  — list/download attachments
 *   tools/calendar.ts     — list/create/update/delete events, free/busy
 *   tools/accounts.ts     — list/switch accounts
 *   tools/snippets.ts     — list/use snippets
 *   tools/ai.ts           — ask AI
 *   tools/agent-sessions.ts — list/read/discard/restore agent sessions
 */

// Shared
export type { TextContent, ToolResult } from "./shared";
export { successResult, errorResult, getMcpProvider, resolveSuperhumanToken, CDP_PORT } from "./shared";

// Email — read
export { SearchSchema, InboxSchema, ReadSchema, SenderSummarySchema, CollectThreadIdsSchema } from "./email-read";
export { searchHandler, inboxHandler, readHandler, senderSummaryHandler, collectThreadIdsHandler } from "./email-read";

// Email — write
export { EmailSchema, DraftSchema, SendSchema, ReplySchema, ReplyAllSchema, ForwardSchema } from "./email-write";
export { draftHandler, sendHandler, replyHandler, replyAllHandler, forwardHandler } from "./email-write";

// Email — manage
export {
  ArchiveSchema, UnarchiveSchema, DeleteSchema, MarkReadSchema, MarkUnreadSchema,
  StarSchema, UnstarSchema, StarredSchema,
  SnoozeSchema, UnsnoozeSchema, SnoozedSchema,
  ArchiveByQuerySchema,
} from "./email-manage";
export {
  archiveHandler, unarchiveHandler, deleteHandler, markReadHandler, markUnreadHandler,
  starHandler, unstarHandler, starredHandler,
  snoozeHandler, unsnoozeHandler, snoozedHandler,
  archiveByQueryHandler,
} from "./email-manage";

// Labels
export { LabelsSchema, GetLabelsSchema, CreateLabelSchema, AddLabelSchema, AddLabelByQuerySchema, RemoveLabelSchema } from "./labels";
export { labelsHandler, getLabelsHandler, createLabelHandler, addLabelHandler, addLabelByQueryHandler, removeLabelHandler } from "./labels";

// Attachments
export { AttachmentsSchema, DownloadAttachmentSchema } from "./attachments";
export { attachmentsHandler, downloadAttachmentHandler } from "./attachments";

// Calendar
export {
  CalendarListSchema, CalendarCreateSchema, CalendarUpdateSchema,
  CalendarDeleteSchema, CalendarFreeBusySchema,
} from "./calendar";
export {
  calendarListHandler, calendarCreateHandler, calendarUpdateHandler,
  calendarDeleteHandler, calendarFreeBusyHandler,
} from "./calendar";

// Accounts
export { AccountsSchema, SwitchAccountSchema } from "./accounts";
export { accountsHandler, switchAccountHandler } from "./accounts";

// Snippets
export { SnippetsSchema, UseSnippetSchema } from "./snippets";
export { snippetsHandler, useSnippetHandler } from "./snippets";

// AI
export { AskAISchema } from "./ai";
export { askAIHandler } from "./ai";

// Agent Sessions
export {
  AgentSessionsSchema, AgentSessionReadSchema,
  AgentSessionDiscardSchema, AgentSessionRestoreSchema,
} from "./agent-sessions";
export {
  agentSessionsHandler, agentSessionReadHandler,
  agentSessionDiscardHandler, agentSessionRestoreHandler,
} from "./agent-sessions";

// Audit — re-exported directly in server.ts due to barrel resolution quirk
// export { AuditLogSchema, auditLogHandler } from "./audit";
