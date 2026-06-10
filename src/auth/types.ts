/**
 * Shared authentication types for token management.
 */

export interface TokenInfo {
  accessToken: string;
  email: string;
  expires: number;
  isMicrosoft: boolean;
  refreshToken?: string;
  userId?: string;
  idToken?: string;
  idTokenExpires?: number;
  userPrefix?: string;
  /** Account display name (renderer `credential.user._name`) — used for draft From headers */
  displayName?: string;
  superhumanToken?: {
    token: string;
    expires: number;
  };
  /** OAuth client_id extracted from the access token JWT (aud/azp claim) */
  clientId?: string;
}

export interface PersistedTokens {
  version: 1;
  accounts: {
    [email: string]: {
      type: "google" | "microsoft";
      accessToken: string;
      expires: number;
      userId?: string;
      refreshToken?: string;
      userPrefix?: string;
      clientId?: string;
      displayName?: string;
      superhumanToken?: {
        token: string;
        expires?: number;
      };
    };
  };
  lastUpdated: number;
}

export interface SuperhumanTokenInfo {
  token: string;
  email: string;
  accountId?: string;
  expires?: number;
}

/** Minimal CDP connection interface used by token-store to call extractToken. */
export interface CDPConnection {
  Runtime: { evaluate: (params: any) => Promise<any> };
  [key: string]: any;
}

/** Captured JWT from CDP Fetch interception */
export interface CapturedToken {
  url: string;
  token: string;
  email: string;
}

/** Gmail label metadata */
export interface Label {
  id: string;
  name: string;
  type?: string;
}

/** Attachment metadata from a Gmail/Graph message */
export interface AttachmentInfo {
  id: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  messageId: string;
}

/** Threading info for composing replies */
export interface ThreadInfoDirect {
  messageId: string | null;
  references: string[];
  subject: string;
  from: string;
  to: string[];
  cc: string[];
}

/** Calendar event (normalized across Google/Microsoft) */
export interface CalendarEventDirect {
  id: string;
  calendarId: string;
  summary: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: "needsAction" | "accepted" | "declined" | "tentative";
    organizer?: boolean;
    self?: boolean;
  }>;
  recurrence?: string[];
  recurringEventId?: string;
  htmlLink?: string;
  conferenceData?: Record<string, unknown>;
  status?: "confirmed" | "tentative" | "cancelled";
  visibility?: "default" | "public" | "private";
  allDay?: boolean;
  isOrganizer?: boolean;
  provider?: "google" | "microsoft";
  location?: string;
}

/** Input for creating a calendar event */
export interface CreateCalendarEventInput {
  calendarId?: string;
  summary: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{ email: string; displayName?: string }>;
  recurrence?: string[];
  location?: string;
}

/** Input for updating a calendar event */
export interface UpdateCalendarEventInput {
  summary?: string;
  description?: string;
  start?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{ email: string; displayName?: string }>;
  recurrence?: string[];
  location?: string;
}

/** Options for listing calendar events */
export interface ListCalendarEventsOptions {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  limit?: number;
}

/** Free/busy time slot */
export interface FreeBusySlot {
  start: string;
  end: string;
}

/** Options for building a MIME message */
export interface MimeMessageOptions {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  isHtml?: boolean;
  inReplyTo?: string;
  references?: string[];
}

/** Options for sending an email directly via API */
export interface SendEmailDirectOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  isHtml?: boolean;
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
}

/** AI chat message for Superhuman AI */
export interface AIChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Full thread message with parsed headers */
export interface FullThreadMessage {
  message_id: string;
  subject: string;
  body: string;
  from: { email: string; name: string };
  to: Array<{ email: string; name: string }>;
  cc: Array<{ email: string; name: string }>;
  date: string;
  snippet: string;
}

/** Options for AI query */
export interface AIQueryOptions {
  sessionId?: string;
  chatHistory?: AIChatMessage[];
  userName?: string;
  userEmail?: string;
  userCompany?: string;
  userPosition?: string;
  userPrefix?: string;
}

/** Result from AI query */
export interface AIQueryResult {
  response: string;
  sessionId: string;
}
