/**
 * Gmail Draft Provider
 *
 * Fetches drafts from Gmail API and returns them in the unified Draft format.
 */

import type { Draft, IDraftProvider } from "../services/draft-service";
import type { TokenInfo } from "../token-api";

const GMAIL_API = "https://www.googleapis.com/gmail/v1/users/me";

/**
 * Gmail API draft list response
 */
interface GmailDraftsListResponse {
  messages?: { id: string }[];
  nextPageToken?: string;
}

/**
 * Gmail API draft detail response
 */
interface GmailDraftDetailResponse {
  message?: {
    id: string;
    snippet?: string;
    internalDate?: string;
    payload?: {
      headers?: Array<{ name: string; value: string }>;
      body?: { data?: string };
      parts?: any[];
    };
  };
}

/**
 * Provider that fetches drafts from Gmail API
 */
export class GmailDraftProvider implements IDraftProvider {
  readonly source: Draft["source"] = "gmail";
  private token: TokenInfo;

  constructor(token: TokenInfo) {
    this.token = token;
  }

  async listDrafts(limit: number = 50, offset: number = 0): Promise<Draft[]> {
    const pageToken = offset > 0 ? `&pageToken=${offset}` : "";
    const path = `/drafts?maxResults=${limit}${pageToken}`;

    const listResponse = await this.gmailFetch(path);
    const listResult = listResponse as GmailDraftsListResponse | null;

    if (!listResult || !listResult.messages || listResult.messages.length === 0) {
      return [];
    }

    const drafts: Draft[] = [];

    for (const draft of listResult.messages) {
      try {
        const detailPath = `/drafts/${draft.id}?format=full`;
        const detailResult = (await this.gmailFetch(detailPath)) as GmailDraftDetailResponse | null;

        if (!detailResult || !detailResult.message) {
          continue;
        }

        const message = detailResult.message;
        const payload = message.payload || {};
        const headers = payload.headers || [];

        const getHeader = (name: string): string => {
          const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
          return header?.value || "";
        };

        // Parse From header
        const fromHeader = getHeader("From");
        const fromMatch = fromHeader.match(/<([^>]+)>/) || [null, fromHeader];
        const from = fromMatch[1] || fromHeader;

        // Parse To header
        const parseRecipients = (header: string): string[] => {
          if (!header) return [];
          return header
            .split(",")
            .map((r) => {
              const match = r.match(/<([^>]+)>/) || [null, r.trim()];
              return match[1] || r.trim();
            })
            .filter(Boolean);
        };

        const to = parseRecipients(getHeader("To"));

        // Extract preview
        let preview = "";
        const extractPreview = (part: any): void => {
          if (part.body?.data) {
            const content = Buffer.from(part.body.data, "base64url").toString("utf-8");
            preview = content.substring(0, 200);
          } else if (part.parts) {
            for (const p of part.parts) {
              if (!preview) {
                extractPreview(p);
              }
            }
          }
        };
        extractPreview(payload);

        if (!preview && message.snippet) {
          preview = message.snippet;
        }

        // Get timestamp
        const dateHeader = getHeader("Date");
        const timestamp = dateHeader || new Date(parseInt(message.internalDate || "0")).toISOString();

        drafts.push({
          id: message.id,
          subject: getHeader("Subject") || "(no subject)",
          from,
          to,
          preview,
          timestamp,
          source: "gmail",
        });
      } catch (error) {
        console.error(`Error fetching draft ${draft.id}:`, error);
        continue;
      }
    }

    return drafts;
  }

  private async gmailFetch(path: string): Promise<unknown> {
    const url = `${GMAIL_API}${path}`;
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
