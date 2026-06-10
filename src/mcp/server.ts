/**
 * MCP Server for Superhuman CLI
 *
 * Exposes Superhuman automation functions as MCP tools.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  DraftSchema, SendSchema, SearchSchema, InboxSchema, ReadSchema,
  SenderSummarySchema, CollectThreadIdsSchema,
  AccountsSchema, SwitchAccountSchema, ReplySchema, ReplyAllSchema, ForwardSchema,
  ArchiveSchema, UnarchiveSchema, DeleteSchema, ArchiveByQuerySchema,
  MarkReadSchema, MarkUnreadSchema, LabelsSchema, GetLabelsSchema, CreateLabelSchema, AddLabelSchema, AddLabelByQuerySchema, RemoveLabelSchema,
  StarSchema, UnstarSchema, StarredSchema,
  SnoozeSchema, UnsnoozeSchema, SnoozedSchema,
  AttachmentsSchema, DownloadAttachmentSchema,
  CalendarListSchema, CalendarCreateSchema, CalendarUpdateSchema, CalendarDeleteSchema, CalendarFreeBusySchema,
  draftHandler, sendHandler, searchHandler, inboxHandler, readHandler,
  senderSummaryHandler, collectThreadIdsHandler,
  accountsHandler, switchAccountHandler, replyHandler, replyAllHandler, forwardHandler,
  archiveHandler, unarchiveHandler, deleteHandler, archiveByQueryHandler,
  markReadHandler, markUnreadHandler, labelsHandler, getLabelsHandler, createLabelHandler, addLabelHandler, addLabelByQueryHandler, removeLabelHandler,
  starHandler, unstarHandler, starredHandler,
  snoozeHandler, unsnoozeHandler, snoozedHandler,
  attachmentsHandler, downloadAttachmentHandler,
  calendarListHandler, calendarCreateHandler, calendarUpdateHandler, calendarDeleteHandler, calendarFreeBusyHandler,
  SnippetsSchema, UseSnippetSchema,
  snippetsHandler, useSnippetHandler,
  AskAISchema, askAIHandler,
  AgentSessionsSchema, AgentSessionReadSchema,
  agentSessionsHandler, agentSessionReadHandler,
} from "./tools";
import { AuditLogSchema, auditLogHandler } from "./tools/audit";
import { StatusSchema, statusHandler } from "./tools/status";
import { ConfirmSchema, confirmHandler } from "./tools/confirm";
import { APP_VERSION } from "../version";

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "superhuman-cli", version: APP_VERSION },
    {
      capabilities: { tools: {} },
      instructions: `Superhuman email and calendar automation server (45 tools).

WORKFLOW: Use superhuman_accounts first to see available accounts. Use superhuman_inbox or superhuman_search to find emails — these return thread IDs needed by all action tools.

SEARCH: superhuman_search accepts limit (1–50, default 10) and returns totalResults (approximate match count) so you can gauge result coverage without fetching everything. Pass includeDone: true to search all mail (inbox + archive).

READ TOOLS (no side effects): superhuman_inbox, superhuman_search, superhuman_read, superhuman_accounts, superhuman_labels, superhuman_get_labels, superhuman_starred, superhuman_snoozed, superhuman_snippets, superhuman_attachments, superhuman_download_attachment, superhuman_calendar_list, superhuman_calendar_free_busy, superhuman_audit_log, superhuman_agent_sessions, superhuman_agent_session_read, superhuman_sender_summary, superhuman_collect_thread_ids, superhuman_status.

WRITE TOOLS (create/modify): superhuman_draft, superhuman_send, superhuman_reply, superhuman_reply_all, superhuman_forward, superhuman_snippet, superhuman_calendar_create, superhuman_calendar_update, superhuman_switch_account, superhuman_mark_read, superhuman_mark_unread, superhuman_star, superhuman_unstar, superhuman_create_label, superhuman_add_label, superhuman_add_label_by_query, superhuman_remove_label, superhuman_snooze, superhuman_unsnooze, superhuman_ask_ai, superhuman_unarchive.

DRAFTS: superhuman_draft and the default (no-send) mode of reply/reply_all/forward create drafts in Superhuman's own draft store, so they appear in the app (drafts on the original thread for replies/forwards) where the user can review, edit, and send them. Drafts do not support programmatic attachments — use send:true (full attachment support) or attach in the app. Microsoft accounts: reply/forward no-send mode falls back to provider drafts, which are NOT visible in Superhuman.

CONFIRMATION TOOL: superhuman_confirm (executes a previously staged mutation token).

DESTRUCTIVE TOOLS (irreversible): superhuman_archive, superhuman_archive_by_query, superhuman_delete, superhuman_calendar_delete.

BULK ARCHIVE: superhuman_archive_by_query runs a query, collects ALL matching threads (paginated), and stages them for archive in one confirmation step. Use dryRun:true to preview. Max 500 threads per call. Ideal for sweeping entire senders (e.g. query: "from:noreply@example.com"). Supports excludeThreadIds to protect specific threads from archiving.

BULK LABEL: superhuman_add_label_by_query runs a query, collects ALL matching threads (paginated), and applies a label. For <=50 matches, executes directly (labeling is idempotent). For >50 matches, stages for confirmation. Use dryRun:true to preview. Max 500 threads per call. Supports excludeThreadIds.

Multi-account: Most tools operate on the currently active account. Use superhuman_switch_account to change. Batch operations (archive, delete, star, etc.) accept arrays of thread IDs.`,
    }
  );

  // ---- Email read tools (read-only) ----

  server.registerTool(
    "superhuman_inbox",
    {
      description: "List recent emails from the Superhuman inbox. Returns thread summaries with from, subject, date, and snippet.",
      inputSchema: InboxSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    inboxHandler
  );

  server.registerTool(
    "superhuman_search",
    {
      description: "Search the Superhuman inbox. Returns a list of emails matching the search query.",
      inputSchema: SearchSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    searchHandler
  );

  server.registerTool(
    "superhuman_read",
    {
      description: "Read a specific email thread by ID. Returns all messages in the thread with full details.",
      inputSchema: ReadSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    readHandler
  );

  server.registerTool(
    "superhuman_sender_summary",
    {
      description: "Get a summary of unique senders matching a query, grouped by sender email with thread counts. Useful for inbox recon before bulk operations. Returns top 50 senders sorted by thread count.",
      inputSchema: SenderSummarySchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    senderSummaryHandler
  );

  server.registerTool(
    "superhuman_collect_thread_ids",
    {
      description: "Collect all thread IDs matching a query via pagination. Read-only — no mutation. Useful for building exclude lists, cross-referencing before bulk operations, or verifying post-archive state. Note: for -label: filters with nested labels, use '/' separator (e.g. '-label:Finance/Medical'), not '-' (e.g. NOT '-label:Finance-Medical').",
      inputSchema: CollectThreadIdsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    collectThreadIdsHandler
  );

  // ---- Email write tools ----

  server.registerTool(
    "superhuman_draft",
    {
      description: "Create an email draft in Superhuman's own draft store — it appears in the app's Drafts view for review before sending. No attachment support (use superhuman_send for attachments, or attach in the app).",
      inputSchema: DraftSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    draftHandler
  );

  server.registerTool(
    "superhuman_send",
    {
      description: "Send an email via Gmail/Outlook API using cached OAuth tokens. Supports file attachments (base64-encoded).",
      inputSchema: SendSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    sendHandler
  );

  server.registerTool(
    "superhuman_reply",
    {
      description: "Reply to an email thread. By default creates a draft in Superhuman's own store, visible on the thread in the app for user review/edit/send; sends immediately with send=true. The reply is addressed to the sender of the last message in the thread. Attachments require send=true.",
      inputSchema: ReplySchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    replyHandler
  );

  server.registerTool(
    "superhuman_reply_all",
    {
      description: "Reply-all to an email thread. By default creates a draft in Superhuman's own store, visible on the thread in the app for user review/edit/send; sends immediately with send=true. The reply is addressed to all recipients of the last message (excluding yourself). Attachments require send=true.",
      inputSchema: ReplyAllSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    replyAllHandler
  );

  server.registerTool(
    "superhuman_forward",
    {
      description: "Forward an email thread to a new recipient. By default creates a draft in Superhuman's own store, visible in the app for user review/edit/send; sends immediately with send=true. Includes the original message with forwarding headers. Attachments require send=true.",
      inputSchema: ForwardSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    forwardHandler
  );

  // ---- Email manage tools ----

  server.registerTool(
    "superhuman_archive",
    {
      description: "Archive one or more email threads. Removes threads from inbox without deleting them.",
      inputSchema: ArchiveSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    archiveHandler
  );

  server.registerTool(
    "superhuman_unarchive",
    {
      description: "Unarchive one or more email threads. Moves threads back to inbox by adding the INBOX label.",
      inputSchema: UnarchiveSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    unarchiveHandler
  );

  server.registerTool(
    "superhuman_archive_by_query",
    {
      description: "Archive all threads matching a search query. ALWAYS run the query through superhuman_search first to verify matches. Internally paginates to collect all matches, then stages for confirmation. Use dryRun:true to preview without staging. Requires superhuman_confirm to execute.",
      inputSchema: ArchiveByQuerySchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    archiveByQueryHandler
  );

  server.registerTool(
    "superhuman_delete",
    {
      description: "Delete (trash) one or more email threads. Moves threads to the trash folder.",
      inputSchema: DeleteSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    deleteHandler
  );

  server.registerTool(
    "superhuman_mark_read",
    {
      description: "Mark one or more email threads as read. Removes the unread indicator from threads.",
      inputSchema: MarkReadSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    markReadHandler
  );

  server.registerTool(
    "superhuman_mark_unread",
    {
      description: "Mark one or more email threads as unread. Adds the unread indicator to threads.",
      inputSchema: MarkUnreadSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    markUnreadHandler
  );

  server.registerTool(
    "superhuman_star",
    {
      description: "Star one or more email threads. Adds the STARRED label to mark threads as important.",
      inputSchema: StarSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    starHandler
  );

  server.registerTool(
    "superhuman_unstar",
    {
      description: "Unstar one or more email threads. Removes the STARRED label from threads.",
      inputSchema: UnstarSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    unstarHandler
  );

  server.registerTool(
    "superhuman_starred",
    {
      description: "List all starred email threads. Returns thread IDs of emails marked with the STARRED label.",
      inputSchema: StarredSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    starredHandler
  );

  server.registerTool(
    "superhuman_snooze",
    {
      description: "Snooze one or more email threads until a specific time. Use presets (tomorrow, next-week, weekend, evening) or ISO datetime.",
      inputSchema: SnoozeSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    snoozeHandler
  );

  server.registerTool(
    "superhuman_unsnooze",
    {
      description: "Unsnooze one or more email threads. Cancels the snooze and returns threads to inbox.",
      inputSchema: UnsnoozeSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    unsnoozeHandler
  );

  server.registerTool(
    "superhuman_snoozed",
    {
      description: "List all snoozed email threads. Returns thread IDs and snooze times.",
      inputSchema: SnoozedSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    snoozedHandler
  );

  // ---- Labels ----

  server.registerTool(
    "superhuman_labels",
    {
      description: "List all available labels/folders in the Superhuman account. Returns label IDs and names.",
      inputSchema: LabelsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    labelsHandler
  );

  server.registerTool(
    "superhuman_get_labels",
    {
      description: "Get all labels on a specific email thread. Returns label IDs and names for the thread.",
      inputSchema: GetLabelsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    getLabelsHandler
  );

  server.registerTool(
    "superhuman_create_label",
    {
      description: "Create a new email label. Use superhuman_labels first to check existing labels. Returns the label ID needed by superhuman_add_label. Supports nested labels with '/' separator (e.g. 'Finance/Taxes').",
      inputSchema: CreateLabelSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    createLabelHandler
  );

  server.registerTool(
    "superhuman_add_label",
    {
      description: "Add a label to one or more email threads. Use superhuman_labels first to get available label IDs.",
      inputSchema: AddLabelSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    addLabelHandler
  );

  server.registerTool(
    "superhuman_add_label_by_query",
    {
      description: "Add a label to all threads matching a search query. Collects matches via pagination and applies the label. Use dryRun:true to preview. For >50 matches, requires superhuman_confirm. Max 500 threads per call. Supports excludeThreadIds to protect specific threads.",
      inputSchema: AddLabelByQuerySchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    addLabelByQueryHandler
  );

  server.registerTool(
    "superhuman_remove_label",
    {
      description: "Remove a label from one or more email threads. Use superhuman_get_labels to see current labels on a thread.",
      inputSchema: RemoveLabelSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    removeLabelHandler
  );

  // ---- Attachments ----

  server.registerTool(
    "superhuman_attachments",
    {
      description: "List all attachments in an email thread. Returns attachment names, MIME types, and IDs needed for downloading.",
      inputSchema: AttachmentsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    attachmentsHandler
  );

  server.registerTool(
    "superhuman_download_attachment",
    {
      description: "Download an attachment from an email. Returns the file content as base64-encoded data along with size and MIME type. Use superhuman_attachments first to get the messageId and attachmentId.",
      inputSchema: DownloadAttachmentSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    downloadAttachmentHandler
  );

  // ---- Calendar ----

  server.registerTool(
    "superhuman_calendar_list",
    {
      description: "List calendar events from Superhuman. Returns events for a date range with details including title, time, attendees, and event ID.",
      inputSchema: CalendarListSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    calendarListHandler
  );

  server.registerTool(
    "superhuman_calendar_create",
    {
      description: "Create a new calendar event in Superhuman. Supports timed events and all-day events with optional attendees.",
      inputSchema: CalendarCreateSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    calendarCreateHandler
  );

  server.registerTool(
    "superhuman_calendar_update",
    {
      description: "Update an existing calendar event in Superhuman. Can modify title, times, description, or attendees.",
      inputSchema: CalendarUpdateSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    calendarUpdateHandler
  );

  server.registerTool(
    "superhuman_calendar_delete",
    {
      description: "Delete a calendar event from Superhuman by its event ID.",
      inputSchema: CalendarDeleteSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    calendarDeleteHandler
  );

  server.registerTool(
    "superhuman_calendar_free_busy",
    {
      description: "Check free/busy availability in the calendar. Returns busy time slots within the specified time range.",
      inputSchema: CalendarFreeBusySchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    calendarFreeBusyHandler
  );

  // ---- Accounts ----

  server.registerTool(
    "superhuman_accounts",
    {
      description: "List all linked email accounts in Superhuman. Returns accounts with current marker.",
      inputSchema: AccountsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    accountsHandler
  );

  server.registerTool(
    "superhuman_switch_account",
    {
      description: "Switch to a different linked email account in Superhuman. Accepts either an email address or a 1-based index number.",
      inputSchema: SwitchAccountSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    switchAccountHandler
  );

  // ---- Snippets ----

  server.registerTool(
    "superhuman_snippets",
    {
      description: "List all snippets (reusable email templates) in Superhuman. Returns snippet names, usage stats, and previews.",
      inputSchema: SnippetsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    snippetsHandler
  );

  server.registerTool(
    "superhuman_snippet",
    {
      description: "Use a snippet to compose or send an email. Fuzzy-matches snippet by name, applies template variables, and creates a draft or sends immediately.",
      inputSchema: UseSnippetSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    useSnippetHandler
  );

  // ---- AI ----

  server.registerTool(
    "superhuman_ask_ai",
    {
      description: "Ask Superhuman AI to search emails, answer questions, or compose drafts. Supports natural language queries like 'find emails about the project deadline' or 'what did John say about the budget?'. Optionally provide a thread ID to ask about a specific email thread. NOTE: the query is granted Superhuman's standard agent skills (filter, schedule, multiMessage, draft, displayThoughts — same set the in-app sidebar uses), so it can create drafts or schedule items, not just answer; every call is staged behind two-phase confirmation.",
      inputSchema: AskAISchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    askAIHandler
  );

  // ---- Agent Sessions ----

  server.registerTool(
    "superhuman_agent_sessions",
    {
      description: "List all AI sidebar conversations (agent sessions) in Superhuman. Returns session titles, IDs, update dates, and message counts. Use this to discover conversation history before reading a specific session with superhuman_agent_session_read.",
      inputSchema: AgentSessionsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    agentSessionsHandler
  );

  server.registerTool(
    "superhuman_agent_session_read",
    {
      description: "Read the full message history of a specific AI sidebar conversation. Returns a cleaned transcript with speaker labels (You/AI) and thinking blocks stripped. Requires a session ID from superhuman_agent_sessions.",
      inputSchema: AgentSessionReadSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    agentSessionReadHandler
  );

  // ---- Confirm (two-phase commit) ----

  server.registerTool(
    "superhuman_confirm",
    {
      description: "Confirm a staged operation. Mutating tools may return a confirmation token instead of executing immediately. Pass the token here to execute. For batches >50 items, set force: true.",
      inputSchema: ConfirmSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    confirmHandler
  );

  // ---- Audit ----

  server.registerTool(
    "superhuman_audit_log",
    {
      description: "View the mutation audit log. Returns recent entries showing all mutating tool calls with timestamps, actions, and results.",
      inputSchema: AuditLogSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    auditLogHandler
  );

  // ---- Status / diagnostics ----

  server.registerTool(
    "superhuman_status",
    {
      description: "Get MCP server and Superhuman app health/lifecycle status: server version and pid, lifecycle state (leader/follower, launch backoff detail), a live CDP probe, and pending-update info. Use this to diagnose connection issues.",
      inputSchema: StatusSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    statusHandler
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export { createMcpServer };
