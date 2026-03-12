/**
 * Contacts API client.
 *
 * Searches contacts via the Google People API (Google accounts) or
 * MS Graph People API (Microsoft/Outlook accounts).
 */

import type { TokenInfo } from "../auth/types";
import type { Contact } from "../contacts";
import { msgraphFetch } from "./http-utils";
import { createLogger } from "../logger";

const log = createLogger("contacts-api");

/**
 * Search contacts using direct API (Gmail or MS Graph).
 *
 * @param token - Token info with accessToken and isMicrosoft flag
 * @param query - Search query
 * @param limit - Maximum results (default 20)
 * @returns Array of Contact objects
 */
export async function searchContacts(
  token: TokenInfo,
  query: string,
  limit: number = 20,
): Promise<Contact[]> {
  if (token.isMicrosoft) {
    // MS Graph People API search
    const result = await msgraphFetch(
      token.accessToken,
      `/me/people?$search="${encodeURIComponent(query)}"&$top=${limit}`,
    );

    if (!result || !result.value) {
      return [];
    }

    return result.value
      .map((p: any) => ({
        email:
          p.scoredEmailAddresses?.[0]?.address || p.userPrincipalName || "",
        name: p.displayName || "",
      }))
      .filter((c: Contact) => c.email);
  } else {
    // Gmail People API (Google Contacts)
    // Note: Gmail API doesn't have direct contact search, use Google People API
    const response = await fetch(
      `https://people.googleapis.com/v1/people:searchContacts?query=${encodeURIComponent(query)}&readMask=names,emailAddresses&pageSize=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
        },
      },
    );

    if (response.status === 401) {
      return [];
    }

    if (!response.ok) {
      // Fall back to empty array on error
      log.warn(`Google People API error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as { results?: any[] };

    if (!data.results) {
      return [];
    }

    return data.results
      .map((r: any) => ({
        email: r.person?.emailAddresses?.[0]?.value || "",
        name: r.person?.names?.[0]?.displayName || "",
      }))
      .filter((c: Contact) => c.email);
  }
}
