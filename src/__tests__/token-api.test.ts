// src/__tests__/token-api.test.ts
// Unit tests for token-api functions that don't require CDP/Superhuman
import { test, expect, describe } from "bun:test";
import { gmailFetch, msgraphFetch } from "../token-api";

describe("token-api unit tests", () => {
  test("gmailFetch returns null on 401 unauthorized", async () => {
    const result = await gmailFetch("invalid_token_12345", "/profile");
    expect(result).toBeNull();
  });

  test("msgraphFetch returns null on 401 unauthorized", async () => {
    const result = await msgraphFetch("invalid_token_12345", "/me");
    expect(result).toBeNull();
  });
});
