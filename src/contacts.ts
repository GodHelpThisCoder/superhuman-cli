/**
 * Contacts Module
 *
 * Functions for searching contacts via direct Gmail/MS Graph API.
 * Works with both Google and Microsoft/Outlook accounts.
 */

import type { ConnectionProvider } from "./connection-provider";
import { searchContactsDirect } from "./token-api";

/**
 * Represents a contact returned from contact search.
 *
 * @property email - The contact's email address
 * @property name - The contact's display name (optional)
 * @property score - Relevance score from the search (optional, higher is more relevant)
 */
export interface Contact {
  email: string;
  name?: string;
  score?: number;
}

/**
 * Options for searching contacts.
 *
 * @property limit - Maximum number of contacts to return (default: 20)
 * @property includeTeamMembers - Whether to include team members in results (default: true)
 *                                Note: This option is not supported by direct API, kept for compatibility.
 */
export interface SearchContactsOptions {
  limit?: number;
  includeTeamMembers?: boolean;
}

/**
 * Search contacts by name or email prefix.
 *
 * Uses direct Google People API or MS Graph People API for contact search.
 *
 * @param provider - The connection provider
 * @param query - The search query (name or email prefix)
 * @param options - Optional search options
 * @returns Array of matching contacts sorted by relevance
 */
export async function searchContacts(
  provider: ConnectionProvider,
  query: string,
  options?: SearchContactsOptions
): Promise<Contact[]> {
  const limit = options?.limit ?? 20;
  const token = await provider.getToken();
  return searchContactsDirect(token, query, limit);
}

/**
 * Resolve a recipient string to an email address.
 *
 * If the input is already an email address (contains @), returns it unchanged.
 * Otherwise, searches contacts and returns the email of the best match.
 * If no match is found, returns the original input unchanged.
 *
 * @param provider - The connection provider
 * @param recipient - Email address or name to resolve
 * @returns The resolved email address, or original input if not resolved
 */
export async function resolveRecipient(
  provider: ConnectionProvider,
  recipient: string
): Promise<string> {
  // If already an email, return as-is
  if (recipient.includes("@")) {
    return recipient;
  }

  // Search contacts
  const contacts = await searchContacts(provider, recipient, { limit: 1 });

  // Return best match's email, or original if no matches
  const first = contacts[0];
  if (first && first.email) {
    return first.email;
  }

  return recipient;
}
