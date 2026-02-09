/**
 * GmailDraftProvider Tests
 *
 * Tests the Gmail draft provider that fetches drafts from Gmail API.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { GmailDraftProvider } from "../providers/gmail-draft-provider";
import type { TokenInfo } from "../token-api";

// Mock fetch globally
const originalFetch = globalThis.fetch;

describe("GmailDraftProvider", () => {
  let mockToken: TokenInfo;

  beforeEach(() => {
    mockToken = {
      accessToken: "mock-access-token",
      idToken: "mock-id-token",
      refreshToken: "mock-refresh-token",
      expiresAt: Date.now() + 3600000,
      email: "test@gmail.com",
      userId: "user123",
      isMicrosoft: false,
    };
  });

  it("should fetch drafts from Gmail API", async () => {
    // Mock the Gmail API responses
    const mockDraftsList = {
      messages: [
        { id: "draft1" },
        { id: "draft2" },
      ],
    };

    const mockDraftDetails1 = {
      message: {
        id: "draft1",
        snippet: "First draft preview",
        internalDate: "1707400000000",
        payload: {
          headers: [
            { name: "Subject", value: "Test Draft 1" },
            { name: "From", value: "Test User <test@gmail.com>" },
            { name: "To", value: "recipient@example.com" },
            { name: "Date", value: "2024-02-08T12:00:00Z" },
          ],
        },
      },
    };

    const mockDraftDetails2 = {
      message: {
        id: "draft2",
        snippet: "Second draft preview",
        internalDate: "1707401000000",
        payload: {
          headers: [
            { name: "Subject", value: "Test Draft 2" },
            { name: "From", value: "Test User <test@gmail.com>" },
            { name: "To", value: "other@example.com" },
            { name: "Date", value: "2024-02-08T12:30:00Z" },
          ],
        },
      },
    };

    let callCount = 0;
    globalThis.fetch = mock(async (url: string) => {
      callCount++;
      if (url.includes("/drafts?")) {
        return new Response(JSON.stringify(mockDraftsList));
      } else if (url.includes("/drafts/draft1")) {
        return new Response(JSON.stringify(mockDraftDetails1));
      } else if (url.includes("/drafts/draft2")) {
        return new Response(JSON.stringify(mockDraftDetails2));
      }
      return new Response("{}", { status: 404 });
    });

    const provider = new GmailDraftProvider(mockToken);
    const drafts = await provider.listDrafts();

    expect(drafts).toHaveLength(2);
    expect(drafts[0].source).toBe("gmail");
    expect(drafts[1].source).toBe("gmail");
    expect(drafts[0].id).toBe("draft1");
    expect(drafts[0].subject).toBe("Test Draft 1");
    expect(drafts[1].id).toBe("draft2");
    expect(drafts[1].subject).toBe("Test Draft 2");

    // Restore original fetch
    globalThis.fetch = originalFetch;
  });

  it("should return empty array when no drafts exist", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ messages: [] }));
    });

    const provider = new GmailDraftProvider(mockToken);
    const drafts = await provider.listDrafts();

    expect(drafts).toHaveLength(0);

    globalThis.fetch = originalFetch;
  });

  it("should have source property set to gmail", () => {
    const provider = new GmailDraftProvider(mockToken);
    expect(provider.source).toBe("gmail");
  });
});
