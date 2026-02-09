/**
 * Superhuman Native Draft Provider
 *
 * Fetches native drafts (draft00... IDs) from Superhuman's userdata.getThreads API.
 */

import type { Draft, IDraftProvider } from "../services/draft-service";
import type { TokenInfo } from "../token-api";

const SUPERHUMAN_API = "https://mail.superhuman.com/~backend/v3";

/**
 * Superhuman API response types
 */
interface SuperhumanDraft {
  id: string;
  subject: string;
  to: string[];
  from: string;
  snippet: string;
  date: string;
}

interface SuperhumanMessage {
  draft: SuperhumanDraft;
}

interface SuperhumanThread {
  thread: {
    messages: Record<string, SuperhumanMessage>;
  };
}

interface SuperhumanGetThreadsResponse {
  threadList: SuperhumanThread[];
}

/**
 * Provider that fetches native Superhuman drafts from userdata.getThreads API
 */
export class SuperhumanDraftProvider implements IDraftProvider {
  readonly source: Draft["source"] = "native";
  private token: TokenInfo;

  constructor(token: TokenInfo) {
    this.token = token;
  }

  async listDrafts(limit: number = 50, offset: number = 0): Promise<Draft[]> {
    // Use Superhuman backend token (not OAuth accessToken)
    const authToken = this.token.superhumanToken?.token;
    if (!authToken) {
      // No Superhuman token available - can't fetch native drafts
      return [];
    }
    
    const response = await fetch(`${SUPERHUMAN_API}/userdata.getThreads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: { type: "draft" },
        offset,
        limit,
      }),
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as SuperhumanGetThreadsResponse;
    return this.parseThreadList(data.threadList || []);
  }

  private parseThreadList(threadList: SuperhumanThread[]): Draft[] {
    const drafts: Draft[] = [];

    for (const threadItem of threadList) {
      const messages = threadItem.thread?.messages || {};

      for (const [messageId, message] of Object.entries(messages)) {
        if (message.draft) {
          const draft = message.draft;
          drafts.push({
            id: draft.id,
            subject: draft.subject || "(no subject)",
            from: draft.from || "",
            to: draft.to || [],
            preview: draft.snippet || "",
            timestamp: draft.date || "",
            source: "native",
          });
        }
      }
    }

    return drafts;
  }
}
