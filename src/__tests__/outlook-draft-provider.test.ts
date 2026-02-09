/**
 * OutlookDraftProvider Tests
 *
 * Tests the Outlook draft provider that fetches drafts from MS Graph API.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { OutlookDraftProvider } from "../providers/outlook-draft-provider";
import type { TokenInfo } from "../token-api";

// Mock fetch globally
const originalFetch = globalThis.fetch;

describe("OutlookDraftProvider", () => {
  let mockToken: TokenInfo;

  beforeEach(() => {
    mockToken = {
      accessToken: "mock-access-token",
      idToken: "mock-id-token",
      refreshToken: "mock-refresh-token",
      expiresAt: Date.now() + 3600000,
      email: "test@outlook.com",
      userId: "user123",
      isMicrosoft: true,
    };
  });

  it("should fetch drafts from MS Graph API", async () => {
    const mockDraftsResponse = {
      value: [
        {
          id: "outlook-draft-1",
          subject: "Outlook Draft 1",
          from: { emailAddress: { address: "test@outlook.com" } },
          toRecipients: [{ emailAddress: { address: "recipient@example.com" } }],
          bodyPreview: "First outlook draft preview",
          receivedDateTime: "2024-02-08T12:00:00Z",
        },
      ],
    };

    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/mailFolders('Drafts')")) {
        return new Response(JSON.stringify(mockDraftsResponse));
      }
      return new Response("{}", { status: 404 });
    });

    const provider = new OutlookDraftProvider(mockToken);
    const drafts = await provider.listDrafts();

    expect(drafts).toHaveLength(1);
    expect(drafts[0].source).toBe("outlook");
    expect(drafts[0].id).toBe("outlook-draft-1");
    expect(drafts[0].subject).toBe("Outlook Draft 1");
    expect(drafts[0].from).toBe("test@outlook.com");
    expect(drafts[0].to).toEqual(["recipient@example.com"]);

    globalThis.fetch = originalFetch;
  });

  it("should return empty array when no drafts exist", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ value: [] }));
    });

    const provider = new OutlookDraftProvider(mockToken);
    const drafts = await provider.listDrafts();

    expect(drafts).toHaveLength(0);

    globalThis.fetch = originalFetch;
  });

  it("should have source property set to outlook", () => {
    const provider = new OutlookDraftProvider(mockToken);
    expect(provider.source).toBe("outlook");
  });
});
