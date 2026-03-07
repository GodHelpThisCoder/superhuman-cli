/**
 * HTTP utility functions for authenticated API calls.
 *
 * Provides base URL constants and typed fetch wrappers for Gmail, Microsoft Graph,
 * Google Calendar, and the Superhuman backend. All functions add a Bearer token
 * header and return `null` on authentication failure so callers can trigger a
 * token refresh without catching exceptions.
 */

// ---------------------------------------------------------------------------
// API base URL constants
// ---------------------------------------------------------------------------

export const GMAIL_API_BASE = "https://www.googleapis.com/gmail/v1/users/me";
export const MSGRAPH_API_BASE = "https://graph.microsoft.com/v1.0";
export const GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
export const SUPERHUMAN_BACKEND_BASE = "https://mail.superhuman.com/~backend";

// ---------------------------------------------------------------------------
// Generic authenticated fetch
// ---------------------------------------------------------------------------

/**
 * Perform a fetch with a Bearer authorization header.
 *
 * @param url     - Fully-qualified URL to fetch
 * @param token   - OAuth / backend access token
 * @param options - Additional {@link RequestInit} options (method, body, extra headers, etc.)
 * @returns Parsed JSON body, or `null` when the server responds with 401 (or 403
 *          for endpoints that use 403 as an auth-failure signal).
 */
export async function authFetch(
  url: string,
  token: string,
  options?: RequestInit,
): Promise<any | null> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  // Return null on auth failure so the caller can refresh the token
  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (response.status === 204) {
    // No content (success for DELETE and similar operations)
    return { success: true };
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `API error ${response.status} ${response.statusText} — ${errorText}`,
    );
  }

  // Some endpoints return an empty body on success
  const text = await response.text();
  if (!text) {
    return { success: true };
  }

  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Service-specific fetch helpers
// ---------------------------------------------------------------------------

/**
 * Fetch from the Gmail REST API.
 *
 * @param token   - Google OAuth access token
 * @param path    - Path appended to the base URL (e.g. `"/messages"`, `"/profile"`)
 * @param options - Additional fetch options
 * @returns Response JSON or `null` on 401
 */
export async function gmailFetch(
  token: string,
  path: string,
  options?: RequestInit,
): Promise<any | null> {
  return authFetch(`${GMAIL_API_BASE}${path}`, token, options);
}

/**
 * Fetch from the Microsoft Graph API.
 *
 * @param token   - Microsoft OAuth access token
 * @param path    - Path appended to the base URL (e.g. `"/me"`, `"/me/contacts"`)
 * @param options - Additional fetch options
 * @returns Response JSON or `null` on 401
 */
export async function msgraphFetch(
  token: string,
  path: string,
  options?: RequestInit,
): Promise<any | null> {
  return authFetch(`${MSGRAPH_API_BASE}${path}`, token, options);
}

/**
 * Fetch from the Google Calendar API.
 *
 * @param token   - Google OAuth access token
 * @param path    - Path appended to the base URL (e.g. `"/calendars/primary/events"`)
 * @param options - Additional fetch options
 * @returns Response JSON or `null` on 401
 */
export async function gcalFetch(
  token: string,
  path: string,
  options?: RequestInit,
): Promise<any | null> {
  return authFetch(`${GOOGLE_CALENDAR_API_BASE}${path}`, token, options);
}

/**
 * Fetch from the Superhuman backend API.
 *
 * Adds `Content-Type: application/json` in addition to the Bearer header.
 * Returns `null` on both 401 and 403 (the backend uses 403 for expired tokens).
 *
 * @param token   - Superhuman backend token (Firebase idToken)
 * @param path    - Path appended to the base URL (e.g. `"/v3/reminders/create"`)
 * @param options - Additional fetch options
 * @returns Response JSON or `null` on auth failure
 */
export async function superhumanFetch(
  token: string,
  path: string,
  options?: RequestInit,
): Promise<any | null> {
  const url = `${SUPERHUMAN_BACKEND_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `Superhuman API error: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  // Some endpoints return an empty body on success
  const text = await response.text();
  if (!text) {
    return { success: true };
  }

  return JSON.parse(text);
}
