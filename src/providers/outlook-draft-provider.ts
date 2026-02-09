/**
 * Outlook Draft Provider
 *
 * Fetches drafts from Microsoft Graph API and returns them in the unified Draft format.
 */

import type { Draft, IDraftProvider } from "../services/draft-service";
import type { TokenInfo } from "../token-api";

const GRAPH_API = "https://graph.microsoft.com/v1.0";

/**
 * MS Graph API draft message structure
 */
interface MSGraphDraftMessage {
  id: string;
  subject?: string;
  from?: { emailAddress?: { address?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
  bodyPreview?: string;
  receivedDateTime?: string;
}

/**
 * MS Graph API drafts response
 */
interface MSGraphDraftsResponse {
  value?: MSGraphDraftMessage[];
}

/**
 * Provider that fetches drafts from Microsoft Graph API
 */
export class OutlookDraftProvider implements IDraftProvider {
  readonly source: Draft["source"] = "outlook";
  private token: TokenInfo;

  constructor(token: TokenInfo) {
    this.token = token;
  }

  async listDrafts(limit: number = 50, offset: number = 0): Promise<Draft[]> {
    const path = `/me/mailFolders('Drafts')/messages?$top=${limit}&$skip=${offset}&$select=id,subject,from,toRecipients,bodyPreview,receivedDateTime&$orderby=receivedDateTime desc`;

    const response = await this.msgraphFetch(path);
    const result = response as MSGraphDraftsResponse | null;

    if (!result || !result.value) {
      return [];
    }

    return result.value.map((message) => ({
      id: message.id,
      subject: message.subject || "(no subject)",
      from: message.from?.emailAddress?.address || "",
      to: (message.toRecipients || [])
        .map((r) => r.emailAddress?.address || "")
        .filter(Boolean),
      preview: message.bodyPreview || "",
      timestamp: message.receivedDateTime || new Date().toISOString(),
      source: "outlook" as const,
    }));
  }

  private async msgraphFetch(path: string): Promise<unknown> {
    const url = `${GRAPH_API}${path}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token.accessToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    return response.json();
  }
}
