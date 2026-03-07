/**
 * Re-export shim — the original 1603-line monolith has been split into:
 *
 *   tools/shared.ts       — types, helpers (successResult, errorResult, getMcpProvider)
 *   tools/email-read.ts   — search, inbox, read
 *   tools/email-write.ts  — draft, send, reply, reply-all, forward
 *   tools/email-manage.ts — archive, delete, mark read/unread, star, snooze
 *   tools/labels.ts       — list labels, get/add/remove label
 *   tools/attachments.ts  — list/download attachments
 *   tools/calendar.ts     — list/create/update/delete events, free/busy
 *   tools/accounts.ts     — list/switch accounts
 *   tools/snippets.ts     — list/use snippets
 *   tools/ai.ts           — ask AI
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
  searchHandler,
  inboxHandler,
  readHandler,

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
  DeleteSchema,
  MarkReadSchema,
  MarkUnreadSchema,
  StarSchema,
  UnstarSchema,
  StarredSchema,
  SnoozeSchema,
  UnsnoozeSchema,
  SnoozedSchema,
  archiveHandler,
  deleteHandler,
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
  AddLabelSchema,
  RemoveLabelSchema,
  labelsHandler,
  getLabelsHandler,
  addLabelHandler,
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
} from "./tools/index";
