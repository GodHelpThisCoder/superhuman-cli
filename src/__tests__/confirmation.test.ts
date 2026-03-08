/**
 * Tests for src/mcp/confirmation.ts — Two-Phase Commit
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  stageOperation,
  confirmOperation,
  isConfirmedExecution,
  withConfirmation,
  buildStagedResponse,
  buildBatchPreview,
  _clearStaged,
  _stagedCount,
} from "../mcp/confirmation";

beforeEach(() => {
  _clearStaged();
});

// ---------------------------------------------------------------------------
// stageOperation
// ---------------------------------------------------------------------------

describe("stageOperation", () => {
  it("creates a valid token starting with shm_", () => {
    const token = stageOperation("superhuman_send", { to: "a@b.com" }, "preview", "user@test.com");
    expect(token).toMatch(/^shm_[A-Za-z0-9_-]{24}$/);
  });

  it("increments staged count", () => {
    expect(_stagedCount()).toBe(0);
    stageOperation("superhuman_send", {}, "preview", "user@test.com");
    expect(_stagedCount()).toBe(1);
    stageOperation("superhuman_delete", {}, "preview", "user@test.com");
    expect(_stagedCount()).toBe(2);
  });

  it("generates unique tokens each time", () => {
    const t1 = stageOperation("superhuman_send", {}, "p1", "a@b.com");
    const t2 = stageOperation("superhuman_send", {}, "p2", "a@b.com");
    expect(t1).not.toBe(t2);
  });
});

// ---------------------------------------------------------------------------
// confirmOperation
// ---------------------------------------------------------------------------

describe("confirmOperation", () => {
  it("returns and consumes a staged operation", () => {
    const token = stageOperation("superhuman_send", { to: "a@b.com" }, "Would send", "user@test.com");
    expect(_stagedCount()).toBe(1);

    const op = confirmOperation(token, "user@test.com");
    expect(op.tool).toBe("superhuman_send");
    expect(op.args.to).toBe("a@b.com");
    expect(op.preview).toBe("Would send");
    expect(op.account).toBe("user@test.com");

    // Token is consumed — single use
    expect(_stagedCount()).toBe(0);
  });

  it("rejects invalid tokens", () => {
    expect(() => confirmOperation("shm_invalid_token_12345678", "user@test.com"))
      .toThrow(/Invalid or expired/);
  });

  it("rejects expired tokens", () => {
    const token = stageOperation("superhuman_send", {}, "preview", "user@test.com");

    // Simulate expiry by manipulating the staged operation's createdAt
    // We access internals via the confirm path — manually advance time
    const originalNow = Date.now;
    Date.now = () => originalNow() + 130_000; // 130s > 120s TTL

    try {
      expect(() => confirmOperation(token, "user@test.com"))
        .toThrow(/expired/);
    } finally {
      Date.now = originalNow;
    }
  });

  it("rejects on account mismatch", () => {
    const token = stageOperation("superhuman_send", {}, "preview", "alice@test.com");

    expect(() => confirmOperation(token, "bob@test.com"))
      .toThrow(/Account mismatch/);
  });

  it("allows unknown accounts (lenient binding)", () => {
    const token = stageOperation("superhuman_send", {}, "preview", "unknown");
    const op = confirmOperation(token, "anyone@test.com");
    expect(op.tool).toBe("superhuman_send");
  });

  it("allows confirmation when current account is unknown", () => {
    const token = stageOperation("superhuman_send", {}, "preview", "alice@test.com");
    const op = confirmOperation(token, "unknown");
    expect(op.tool).toBe("superhuman_send");
  });

  it("rejects replay (double confirm)", () => {
    const token = stageOperation("superhuman_send", {}, "preview", "user@test.com");
    confirmOperation(token, "user@test.com"); // first confirm succeeds

    expect(() => confirmOperation(token, "user@test.com"))
      .toThrow(/Invalid or expired/);
  });

  it("rejects batch >50 without force", () => {
    const threadIds = Array.from({ length: 55 }, (_, i) => `t${i}`);
    const token = stageOperation("superhuman_delete", { threadIds }, "preview", "user@test.com");

    expect(() => confirmOperation(token, "user@test.com"))
      .toThrow(/Batch exceeds 50/);

    // Token should NOT be consumed — user can retry with force
    expect(_stagedCount()).toBe(1);
  });

  it("allows batch >50 with force", () => {
    const threadIds = Array.from({ length: 55 }, (_, i) => `t${i}`);
    const token = stageOperation("superhuman_delete", { threadIds }, "preview", "user@test.com");

    const op = confirmOperation(token, "user@test.com", true);
    expect(op.tool).toBe("superhuman_delete");
    expect(_stagedCount()).toBe(0);
  });

  it("batch <=50 does not require force", () => {
    const threadIds = Array.from({ length: 50 }, (_, i) => `t${i}`);
    const token = stageOperation("superhuman_delete", { threadIds }, "preview", "user@test.com");

    const op = confirmOperation(token, "user@test.com");
    expect(op.tool).toBe("superhuman_delete");
  });
});

// ---------------------------------------------------------------------------
// isConfirmedExecution / withConfirmation
// ---------------------------------------------------------------------------

describe("isConfirmedExecution", () => {
  it("returns false by default", () => {
    expect(isConfirmedExecution()).toBe(false);
  });

  it("returns true inside withConfirmation", async () => {
    let inside = false;
    await withConfirmation("shm_test", async () => {
      inside = isConfirmedExecution();
    });
    expect(inside).toBe(true);
    expect(isConfirmedExecution()).toBe(false); // reset after
  });

  it("resets even if fn throws", async () => {
    try {
      await withConfirmation("shm_test", async () => {
        throw new Error("boom");
      });
    } catch {
      // expected
    }
    expect(isConfirmedExecution()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildStagedResponse
// ---------------------------------------------------------------------------

describe("buildStagedResponse", () => {
  it("includes preview and token", () => {
    const response = buildStagedResponse("Would send email", "shm_abc123");
    expect(response).toContain("STAGED");
    expect(response).toContain("Would send email");
    expect(response).toContain("shm_abc123");
    expect(response).toContain("120s");
  });
});

// ---------------------------------------------------------------------------
// buildBatchPreview
// ---------------------------------------------------------------------------

describe("buildBatchPreview", () => {
  it("shows full detail for 1-5 threads", () => {
    const preview = buildBatchPreview("archive", ["t1", "t2"]);
    expect(preview).toContain("2 thread(s)");
    expect(preview).toContain("t1");
    expect(preview).toContain("t2");
  });

  it("shows digest + list for 6-20 threads", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `thread_${i}`);
    const preview = buildBatchPreview("delete", ids);
    expect(preview).toContain("10 threads");
    expect(preview).toContain("thread_0");
    expect(preview).toContain("thread_9");
  });

  it("shows digest + sample for 21-50 threads", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `t${i}`);
    const preview = buildBatchPreview("archive", ids);
    expect(preview).toContain("30 threads");
    expect(preview).toContain("t0");
    expect(preview).toContain("and 25 more");
  });

  it("shows digest only + force warning for 51+ threads", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `t${i}`);
    const preview = buildBatchPreview("delete", ids);
    expect(preview).toContain("60 threads");
    expect(preview).toContain("force: true");
  });
});
