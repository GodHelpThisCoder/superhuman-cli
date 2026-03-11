/**
 * Re-export module that preserves the historical `token-api` import surface.
 *
 * Source implementations now live in:
 *
 *   src/auth/types.ts          — shared interfaces
 *   src/auth/token-store.ts    — encrypted disk persistence + in-memory cache
 *   src/auth/token-refresh.ts  — OAuth refresh with client_id fix + mutex
 *   src/auth/token-extract.ts  — CDP token extraction
 *   src/api/http-utils.ts      — authenticated fetch helpers
 *   src/api/gmail-client.ts    — Gmail / MS Graph email operations
 *   src/api/calendar-client.ts — Google Calendar / MS Graph calendar
 *   src/api/contacts-client.ts — People API contact search
 *   src/api/superhuman-backend.ts — Superhuman AI endpoints
 *
 * Existing consumers continue to work via these re-exports.
 */

// ---- Types ----------------------------------------------------------------

export type {
  TokenInfo,
  SuperhumanTokenInfo,
  CapturedToken,
  Label,
  AttachmentInfo,
  ThreadInfoDirect,
  DraftMessage,
  CalendarEventDirect,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
  ListCalendarEventsOptions,
  FreeBusySlot,
  MimeMessageOptions,
  SendEmailDirectOptions,
  AIChatMessage,
  FullThreadMessage,
  AIQueryOptions,
  AIQueryResult,
  PersistedTokens,
} from "./auth/types";

// ---- Token store (cache + disk persistence) --------------------------------

export {
  getToken,
  clearTokenCache,
  setTokenCacheForTest,
  hasValidCachedTokens,
  getCachedToken,
  getCachedAccounts,
  hasCachedSuperhumanCredentials,
  getTokensFilePath,
  saveTokensToDisk,
  loadTokensFromDisk,
} from "./auth/token-store";

// ---- Token extraction (CDP) ------------------------------------------------

export {
  extractToken,
  extractTokenChrome,
  selectBestToken,
  extractSuperhumanToken,
  getSuperhumanToken,
  clearSuperhumanTokenCache,
  extractUserPrefix,
} from "./auth/token-extract";

// ---- Token refresh ---------------------------------------------------------

export {
  extractClientId,
  refreshAccessToken,
  refreshWithLock,
} from "./auth/token-refresh";

// ---- HTTP utilities --------------------------------------------------------

export {
  GMAIL_API_BASE,
  MSGRAPH_API_BASE,
  GOOGLE_CALENDAR_API_BASE,
  SUPERHUMAN_BACKEND_BASE,
  authFetch,
  gmailFetch,
  msgraphFetch,
  gcalFetch,
  superhumanFetch,
} from "./api/http-utils";

// ---- Gmail / MS Graph email operations ------------------------------------
// Functions with `Direct` suffix are aliased for backward compatibility.

export {
  searchGmail as searchGmailDirect,
  listInbox as listInboxDirect,
  getThread as getThreadDirect,
  downloadAttachment as downloadAttachmentDirect,
  listLabels as listLabelsDirect,
  getThreadInfo as getThreadInfoDirect,
  createDraft as createDraftDirect,
  sendEmail as sendEmailDirect,
  createReplyDraft as createReplyDraftDirect,
  sendReply as sendReplyDirect,
  updateDraft as updateDraftDirect,
  deleteDraft as deleteDraftDirect,
  sendDraft as sendDraftDirect,
  listDrafts as listDraftsDirect,
  modifyThreadLabels,
  updateMessage,
  moveMessageToFolder,
  getWellKnownFolder,
  getConversationMessageIds,
  addAttachmentToDraft,
  addAttachmentToMsgraphDraft,
  addAttachmentToGmailDraft,
  buildMimeMessage,
  getThreadMessages,
} from "./api/gmail-client";

// ---- Calendar operations ---------------------------------------------------

export {
  listCalendarEvents as listCalendarEventsDirect,
  createCalendarEvent as createCalendarEventDirect,
  updateCalendarEvent as updateCalendarEventDirect,
  deleteCalendarEvent as deleteCalendarEventDirect,
  getFreeBusy as getFreeBusyDirect,
} from "./api/calendar-client";

// ---- Contacts --------------------------------------------------------------

export { searchContacts as searchContactsDirect } from "./api/contacts-client";

// ---- Superhuman AI ---------------------------------------------------------

export { askAI, askAISearch } from "./api/superhuman-backend";
