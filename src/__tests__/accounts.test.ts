// src/__tests__/accounts.test.ts
// Unit tests for account formatting functions (no CDP required)
import { test, expect, describe } from "bun:test";
import { type Account } from "../accounts";
import { formatAccountsList, formatAccountsJson } from "../cli";

describe("CLI formatting functions", () => {
  const mockAccounts: Account[] = [
    { email: "user1@example.com", isCurrent: false },
    { email: "user2@example.com", isCurrent: true },
    { email: "user3@example.com", isCurrent: false },
  ];

  describe("formatAccountsList", () => {
    test("formats accounts with 1-based index and current marker", () => {
      const output = formatAccountsList(mockAccounts);
      const lines = output.split("\n");

      expect(lines.length).toBe(3);
      expect(lines[0]).toBe("  1. user1@example.com");
      expect(lines[1]).toBe("* 2. user2@example.com (current)");
      expect(lines[2]).toBe("  3. user3@example.com");
    });

    test("handles empty accounts array", () => {
      const output = formatAccountsList([]);
      expect(output).toBe("");
    });

    test("handles single account that is current", () => {
      const output = formatAccountsList([{ email: "test@example.com", isCurrent: true }]);
      expect(output).toBe("* 1. test@example.com (current)");
    });
  });

  describe("formatAccountsJson", () => {
    test("formats accounts as valid JSON array", () => {
      const output = formatAccountsJson(mockAccounts);
      const parsed = JSON.parse(output);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(3);
      expect(parsed[0]).toEqual({ email: "user1@example.com", isCurrent: false });
      expect(parsed[1]).toEqual({ email: "user2@example.com", isCurrent: true });
      expect(parsed[2]).toEqual({ email: "user3@example.com", isCurrent: false });
    });

    test("handles empty accounts array", () => {
      const output = formatAccountsJson([]);
      expect(output).toBe("[]");
    });
  });
});
