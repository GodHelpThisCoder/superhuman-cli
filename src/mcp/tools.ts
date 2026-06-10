/**
 * Re-export shim — the original 1603-line monolith has been split into:
 *
 *   tools/shared.ts       — types, helpers (successResult, errorResult, getMcpProvider)
 *   tools/email-read.ts   — search, inbox, read, sender-summary, collect-thread-ids
 *   tools/email-write.ts  — draft, send, reply, reply-all, forward
 *   tools/email-manage.ts — archive, unarchive, archive-by-query, delete, mark read/unread, star, snooze
 *   tools/labels.ts       — list labels, get/create/add/add-by-query/remove label
 *   tools/attachments.ts  — list/download attachments
 *   tools/calendar.ts     — list/create/update/delete events, free/busy
 *   tools/accounts.ts     — list/switch accounts
 *   tools/snippets.ts     — list/use snippets
 *   tools/ai.ts           — ask AI
 *   tools/agent-sessions.ts — list/read/discard/restore agent sessions
 *
 * Existing consumers continue to work via these re-exports.
 */

export {
  // Shared
  type TextContent,
  type ToolResult,
  successResult,
  errorResult,
  getMcpProvider,
  resolveSuperhumanToken,
  CDP_PORT,

  // Email — read
  SearchSchema,
  InboxSchema,
  ReadSchema,
  SenderSummarySchema,
  CollectThreadIdsSchema,
  searchHandler,
  inboxHandler,
  readHandler,
  senderSummaryHandler,
  collectThreadIdsHandler,

  // Email — write
  EmailSchema,
  DraftSchema,
  SendSchema,
  ReplySchema,
  ReplyAllSchema,
  ForwardSchema,
  draftHandler,
  sendHandler,
  replyHandler,
  replyAllHandler,
  forwardHandler,

  // Email — manage
  ArchiveSchema,
  UnarchiveSchema,
  DeleteSchema,
  MarkReadSchema,
  MarkUnreadSchema,
  StarSchema,
  UnstarSchema,
  StarredSchema,
  SnoozeSchema,
  UnsnoozeSchema,
  SnoozedSchema,
  ArchiveByQuerySchema,
  archiveHandler,
  unarchiveHandler,
  deleteHandler,
  archiveByQueryHandler,
  markReadHandler,
  markUnreadHandler,
  starHandler,
  unstarHandler,
  starredHandler,
  snoozeHandler,
  unsnoozeHandler,
  snoozedHandler,

  // Labels
  LabelsSchema,
  GetLabelsSchema,
  CreateLabelSchema,
  AddLabelSchema,
  AddLabelByQuerySchema,
  RemoveLabelSchema,
  labelsHandler,
  getLabelsHandler,
  createLabelHandler,
  addLabelHandler,
  addLabelByQueryHandler,
  removeLabelHandler,

  // Attachments
  AttachmentsSchema,
  DownloadAttachmentSchema,
  attachmentsHandler,
  downloadAttachmentHandler,

  // Calendar
  CalendarListSchema,
  CalendarCreateSchema,
  CalendarUpdateSchema,
  CalendarDeleteSchema,
  CalendarFreeBusySchema,
  calendarListHandler,
  calendarCreateHandler,
  calendarUpdateHandler,
  calendarDeleteHandler,
  calendarFreeBusyHandler,

  // Accounts
  AccountsSchema,
  SwitchAccountSchema,
  accountsHandler,
  switchAccountHandler,

  // Snippets
  SnippetsSchema,
  UseSnippetSchema,
  snippetsHandler,
  useSnippetHandler,

  // AI
  AskAISchema,
  askAIHandler,

  // Agent Sessions (read-only; discard/restore dropped in v0.16.0)
  AgentSessionsSchema,
  AgentSessionReadSchema,
  agentSessionsHandler,
  agentSessionReadHandler,
} from "./tools/index";
