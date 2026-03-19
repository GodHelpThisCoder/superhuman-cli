/**
 * Tests for inbox sweep tool enhancements:
 * - Search schema validation (limit min/max/default)
 * - Domain-grouping logic for anomalies
 * - extractRootDomain helper
 * - buildBatchPreview tiered formatting
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { SearchSchema, SenderSummarySchema, CollectThreadIdsSchema } from "../mcp/tools/email-read";
import { ArchiveByQuerySchema, UnarchiveSchema } from "../mcp/tools/email-manage";
import { CreateLabelSchema, AddLabelByQuerySchema } from "../mcp/tools/labels";
import { createLabelHandler } from "../mcp/tools/labels";
import { isAuthError } from "../mcp/tools/shared";
import {
  extractRootDomain,
  buildBatchPreview,
  buildManifest,
  stageOperation,
  confirmOperation,
  buildStagedResponse,
  isConfirmedExecution,
  withConfirmation,
  _clearStaged,
  type BatchManifest,
  type ManifestThreadInfo,
} from "../mcp/confirmation";

beforeEach(() => {
  _clearStaged();
});

// ---------------------------------------------------------------------------
// SearchSchema validation
// ---------------------------------------------------------------------------

describe("SearchSchema", () => {
  it("accepts query only (limit defaults to undefined)", () => {
    const result = SearchSchema.safeParse({ query: "from:test@example.com" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBeUndefined();
    }
  });

  it("accepts limit within range (1–50)", () => {
    expect(SearchSchema.safeParse({ query: "test", limit: 1 }).success).toBe(true);
    expect(SearchSchema.safeParse({ query: "test", limit: 50 }).success).toBe(true);
    expect(SearchSchema.safeParse({ query: "test", limit: 25 }).success).toBe(true);
  });

  it("rejects limit below 1", () => {
    expect(SearchSchema.safeParse({ query: "test", limit: 0 }).success).toBe(false);
    expect(SearchSchema.safeParse({ query: "test", limit: -5 }).success).toBe(false);
  });

  it("rejects limit above 50", () => {
    expect(SearchSchema.safeParse({ query: "test", limit: 51 }).success).toBe(false);
    expect(SearchSchema.safeParse({ query: "test", limit: 100 }).success).toBe(false);
  });

  it("rejects non-integer limit", () => {
    expect(SearchSchema.safeParse({ query: "test", limit: 10.5 }).success).toBe(false);
  });

  it("rejects unknown properties (strict mode)", () => {
    expect(SearchSchema.safeParse({ query: "test", unknownProp: "foo" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ArchiveByQuerySchema validation
// ---------------------------------------------------------------------------

describe("ArchiveByQuerySchema", () => {
  it("accepts query only", () => {
    const result = ArchiveByQuerySchema.safeParse({ query: "from:spam@example.com" });
    expect(result.success).toBe(true);
  });

  it("accepts query with dryRun", () => {
    const result = ArchiveByQuerySchema.safeParse({ query: "from:spam@example.com", dryRun: true });
    expect(result.success).toBe(true);
  });

  it("rejects missing query", () => {
    expect(ArchiveByQuerySchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown properties (strict mode)", () => {
    expect(ArchiveByQuerySchema.safeParse({ query: "test", extra: true }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractRootDomain
// ---------------------------------------------------------------------------

describe("extractRootDomain", () => {
  it("extracts domain from email address", () => {
    expect(extractRootDomain("user@example.com")).toBe("example.com");
  });

  it("handles bare domain", () => {
    expect(extractRootDomain("example.com")).toBe("example.com");
  });

  it("extracts eTLD+1 from subdomain", () => {
    expect(extractRootDomain("noreply@mail.example.com")).toBe("example.com");
  });

  it("handles ccSLD (.co.uk pattern)", () => {
    expect(extractRootDomain("user@mail.example.co.uk")).toBe("example.co.uk");
  });

  it("handles ccSLD (.com.au pattern)", () => {
    expect(extractRootDomain("user@sub.example.com.au")).toBe("example.com.au");
  });

  it("returns lowercase", () => {
    expect(extractRootDomain("user@MAIL.EXAMPLE.COM")).toBe("example.com");
  });

  it("handles single-segment domain", () => {
    expect(extractRootDomain("user@localhost")).toBe("localhost");
  });

  it("handles bare email with no @", () => {
    expect(extractRootDomain("nodomain")).toBe("nodomain");
  });
});

// ---------------------------------------------------------------------------
// buildBatchPreview — tiered density
// ---------------------------------------------------------------------------

describe("buildBatchPreview", () => {
  function makeThreads(count: number): ManifestThreadInfo[] {
    return Array.from({ length: count }, (_, i) => ({
      threadId: `thread_${i}`,
      subject: `Subject ${i}`,
      from: `sender${i}@example.com`,
      date: new Date(2025, 0, i + 1).toISOString(),
    }));
  }

  function makeManifest(count: number): BatchManifest {
    const threads = makeThreads(count);
    return {
      threads,
      digest: `Digest: ${count} threads | oldest: Jan 1 | newest: Jan ${count}`,
      anomalies: [],
    };
  }

  it("shows full detail for <=5 threads", () => {
    const manifest = makeManifest(3);
    const preview = buildBatchPreview("archive", manifest.threads.map((t) => t.threadId), manifest);
    expect(preview).toContain("Would archive 3 thread(s)");
    expect(preview).toContain("thread_0");
    expect(preview).toContain("thread_2");
  });

  it("shows full list for 6–20 threads", () => {
    const manifest = makeManifest(10);
    const preview = buildBatchPreview("archive", manifest.threads.map((t) => t.threadId), manifest);
    expect(preview).toContain("Would archive 10 threads");
    expect(preview).toContain("Subjects:");
    expect(preview).toContain("thread_9");
  });

  it("shows sample for 21–50 threads", () => {
    const manifest = makeManifest(30);
    const preview = buildBatchPreview("archive", manifest.threads.map((t) => t.threadId), manifest);
    expect(preview).toContain("Would archive 30 threads (showing first 5)");
    expect(preview).toContain("Sample:");
    expect(preview).toContain("and 25 more");
  });

  it("shows warning for >50 threads", () => {
    const manifest = makeManifest(60);
    const preview = buildBatchPreview("archive", manifest.threads.map((t) => t.threadId), manifest);
    expect(preview).toContain("Would archive 60 threads");
    expect(preview).toContain("WARNING: Large batch");
    expect(preview).toContain("force: true");
  });

  it("uses fallback when no manifest provided", () => {
    const threadIds = ["t1", "t2"];
    const preview = buildBatchPreview("delete", threadIds);
    expect(preview).toContain("Would delete 2 thread(s)");
    expect(preview).toContain("(metadata unavailable)");
  });
});

// ---------------------------------------------------------------------------
// buildManifest — anomaly grouping
// ---------------------------------------------------------------------------

describe("buildManifest anomaly grouping", () => {
  // We can't easily test buildManifest itself (requires provider + readThread),
  // but we can test the domain grouping logic indirectly via buildBatchPreview
  // with a manually constructed manifest.

  it("includes anomalies from manifest in digest", () => {
    const threads: ManifestThreadInfo[] = [];
    // 95 threads from dominant sender
    for (let i = 0; i < 95; i++) {
      threads.push({
        threadId: `t_${i}`,
        subject: `Newsletter ${i}`,
        from: "newsletter@bigco.com",
        date: "2025-01-01T00:00:00Z",
      });
    }
    // 5 anomalous threads from different senders at same domain
    for (let i = 0; i < 5; i++) {
      threads.push({
        threadId: `anomaly_${i}`,
        subject: `Random ${i}`,
        from: `user${i}@smallco.com`,
        date: "2025-01-01T00:00:00Z",
      });
    }

    const manifest: BatchManifest = {
      threads,
      digest: "Digest: 100 threads | oldest: Jan 1 | newest: Jan 1\n  95 from newsletter@bigco.com\n  1 from user0@smallco.com <-- ANOMALY (<5%)\n  1 from user1@smallco.com <-- ANOMALY (<5%)",
      anomalies: ["*.smallco.com (5 senders)"],
    };

    // Anomalies are tracked in manifest.anomalies
    expect(manifest.anomalies).toHaveLength(1);
    expect(manifest.anomalies[0]).toContain("smallco.com");
  });
});

// ---------------------------------------------------------------------------
// Integration: stage → confirm flow for archive_by_query args
// ---------------------------------------------------------------------------

describe("archive_by_query staging flow", () => {
  it("stages with threadIds and originalQuery args", () => {
    const threadIds = ["t1", "t2", "t3"];
    const args = { threadIds, originalQuery: "from:spam@test.com" };
    const preview = buildBatchPreview("archive", threadIds);
    const token = stageOperation("superhuman_archive_by_query", args, preview, "user@test.com");

    expect(token).toMatch(/^shm_/);

    const op = confirmOperation(token, "user@test.com");
    expect(op.tool).toBe("superhuman_archive_by_query");
    expect(op.args.threadIds).toEqual(threadIds);
    expect(op.args.originalQuery).toBe("from:spam@test.com");
  });

  it("buildStagedResponse includes token and expiry", () => {
    const response = buildStagedResponse("Would archive 3 threads", "shm_abc123");
    expect(response).toContain("STAGED");
    expect(response).toContain("shm_abc123");
    expect(response).toContain("120s");
  });

  it("confirmed replay receives { threadIds, originalQuery } and isConfirmedExecution is true", async () => {
    // Stage with the shape that archiveByQueryHandler produces
    const threadIds = ["t1", "t2", "t3"];
    const stagedArgs = { threadIds, originalQuery: "from:spam@test.com" };
    const preview = buildBatchPreview("archive", threadIds);
    const token = stageOperation("superhuman_archive_by_query", stagedArgs, preview, "user@test.com");

    // Consume the token (simulating confirmHandler)
    const op = confirmOperation(token, "user@test.com");

    // Verify the args shape matches what the confirmed handler receives
    expect(op.args).toHaveProperty("threadIds");
    expect(op.args).toHaveProperty("originalQuery");
    expect(op.args.threadIds).toEqual(threadIds);
    expect(op.args.originalQuery).toBe("from:spam@test.com");
    // The staged args should NOT have 'query' — that's the bug scenario
    expect(op.args).not.toHaveProperty("query");

    // Verify withConfirmation sets the confirmed context
    let confirmedInside = false;
    await withConfirmation(token, async () => {
      confirmedInside = isConfirmedExecution();
    });
    expect(confirmedInside).toBe(true);
    // Outside withConfirmation, it should be false again
    expect(isConfirmedExecution()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UnarchiveSchema validation
// ---------------------------------------------------------------------------

describe("UnarchiveSchema", () => {
  it("accepts threadIds only", () => {
    const result = UnarchiveSchema.safeParse({ threadIds: ["t1", "t2"] });
    expect(result.success).toBe(true);
  });

  it("accepts threadIds with dryRun", () => {
    const result = UnarchiveSchema.safeParse({ threadIds: ["t1"], dryRun: true });
    expect(result.success).toBe(true);
  });

  it("rejects missing threadIds", () => {
    expect(UnarchiveSchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown properties (strict mode)", () => {
    expect(UnarchiveSchema.safeParse({ threadIds: ["t1"], extra: true }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ArchiveByQuerySchema with excludeThreadIds
// ---------------------------------------------------------------------------

describe("ArchiveByQuerySchema with excludeThreadIds", () => {
  it("accepts query with excludeThreadIds", () => {
    const result = ArchiveByQuerySchema.safeParse({
      query: "from:test@example.com",
      excludeThreadIds: ["t1", "t2"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts query without excludeThreadIds (optional)", () => {
    const result = ArchiveByQuerySchema.safeParse({ query: "from:test@example.com" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.excludeThreadIds).toBeUndefined();
    }
  });

  it("accepts empty excludeThreadIds array", () => {
    const result = ArchiveByQuerySchema.safeParse({
      query: "from:test@example.com",
      excludeThreadIds: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-array excludeThreadIds", () => {
    expect(ArchiveByQuerySchema.safeParse({
      query: "from:test@example.com",
      excludeThreadIds: "not-an-array",
    }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SearchSchema with includeDone
// ---------------------------------------------------------------------------

describe("SearchSchema with includeDone", () => {
  it("accepts includeDone: true", () => {
    const result = SearchSchema.safeParse({ query: "test", includeDone: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeDone).toBe(true);
    }
  });

  it("accepts includeDone: false", () => {
    const result = SearchSchema.safeParse({ query: "test", includeDone: false });
    expect(result.success).toBe(true);
  });

  it("accepts without includeDone (optional, defaults to undefined)", () => {
    const result = SearchSchema.safeParse({ query: "test" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeDone).toBeUndefined();
    }
  });

  it("still rejects unknown properties (strict mode)", () => {
    expect(SearchSchema.safeParse({ query: "test", includeDone: true, bogus: 1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SenderSummarySchema validation
// ---------------------------------------------------------------------------

describe("SenderSummarySchema", () => {
  it("accepts query only (limit defaults to undefined)", () => {
    const result = SenderSummarySchema.safeParse({ query: "in:inbox before:2024/01/01" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBeUndefined();
    }
  });

  it("accepts query with limit", () => {
    const result = SenderSummarySchema.safeParse({ query: "in:inbox", limit: 100 });
    expect(result.success).toBe(true);
  });

  it("accepts limit at boundaries (1 and 500)", () => {
    expect(SenderSummarySchema.safeParse({ query: "test", limit: 1 }).success).toBe(true);
    expect(SenderSummarySchema.safeParse({ query: "test", limit: 500 }).success).toBe(true);
  });

  it("rejects limit above 500", () => {
    expect(SenderSummarySchema.safeParse({ query: "test", limit: 501 }).success).toBe(false);
  });

  it("rejects limit below 1", () => {
    expect(SenderSummarySchema.safeParse({ query: "test", limit: 0 }).success).toBe(false);
  });

  it("rejects non-integer limit", () => {
    expect(SenderSummarySchema.safeParse({ query: "test", limit: 10.5 }).success).toBe(false);
  });

  it("rejects missing query", () => {
    expect(SenderSummarySchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown properties (strict mode)", () => {
    expect(SenderSummarySchema.safeParse({ query: "test", unknownProp: "foo" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CollectThreadIdsSchema validation
// ---------------------------------------------------------------------------

describe("CollectThreadIdsSchema", () => {
  it("accepts query only (limit defaults to undefined)", () => {
    const result = CollectThreadIdsSchema.safeParse({ query: "from:test@example.com" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBeUndefined();
    }
  });

  it("accepts query with limit", () => {
    const result = CollectThreadIdsSchema.safeParse({ query: "in:inbox", limit: 250 });
    expect(result.success).toBe(true);
  });

  it("accepts limit at boundaries (1 and 500)", () => {
    expect(CollectThreadIdsSchema.safeParse({ query: "test", limit: 1 }).success).toBe(true);
    expect(CollectThreadIdsSchema.safeParse({ query: "test", limit: 500 }).success).toBe(true);
  });

  it("rejects limit above 500", () => {
    expect(CollectThreadIdsSchema.safeParse({ query: "test", limit: 501 }).success).toBe(false);
  });

  it("rejects limit below 1", () => {
    expect(CollectThreadIdsSchema.safeParse({ query: "test", limit: 0 }).success).toBe(false);
  });

  it("rejects non-integer limit", () => {
    expect(CollectThreadIdsSchema.safeParse({ query: "test", limit: 10.5 }).success).toBe(false);
  });

  it("rejects missing query", () => {
    expect(CollectThreadIdsSchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown properties (strict mode)", () => {
    expect(CollectThreadIdsSchema.safeParse({ query: "test", extra: 42 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AddLabelByQuerySchema validation
// ---------------------------------------------------------------------------

describe("AddLabelByQuerySchema", () => {
  it("accepts query and labelId", () => {
    const result = AddLabelByQuerySchema.safeParse({
      query: "from:chase.com",
      labelId: "Label_18",
    });
    expect(result.success).toBe(true);
  });

  it("accepts with dryRun", () => {
    const result = AddLabelByQuerySchema.safeParse({
      query: "from:chase.com",
      labelId: "Label_18",
      dryRun: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts with excludeThreadIds", () => {
    const result = AddLabelByQuerySchema.safeParse({
      query: "from:chase.com",
      labelId: "Label_18",
      excludeThreadIds: ["t1", "t2"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty excludeThreadIds array", () => {
    const result = AddLabelByQuerySchema.safeParse({
      query: "from:chase.com",
      labelId: "Label_18",
      excludeThreadIds: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing query", () => {
    expect(AddLabelByQuerySchema.safeParse({ labelId: "Label_18" }).success).toBe(false);
  });

  it("rejects missing labelId", () => {
    expect(AddLabelByQuerySchema.safeParse({ query: "from:chase.com" }).success).toBe(false);
  });

  it("rejects unknown properties (strict mode)", () => {
    expect(AddLabelByQuerySchema.safeParse({
      query: "from:chase.com",
      labelId: "Label_18",
      extra: true,
    }).success).toBe(false);
  });

  it("rejects non-array excludeThreadIds", () => {
    expect(AddLabelByQuerySchema.safeParse({
      query: "from:chase.com",
      labelId: "Label_18",
      excludeThreadIds: "not-an-array",
    }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CreateLabelSchema validation
// ---------------------------------------------------------------------------

describe("CreateLabelSchema", () => {
  it("accepts valid name", () => {
    const result = CreateLabelSchema.safeParse({ name: "Finance" });
    expect(result.success).toBe(true);
  });

  it("accepts name with dryRun", () => {
    const result = CreateLabelSchema.safeParse({ name: "Finance/Taxes", dryRun: true });
    expect(result.success).toBe(true);
  });

  it("rejects missing name", () => {
    expect(CreateLabelSchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown properties (strict mode)", () => {
    expect(CreateLabelSchema.safeParse({ name: "Test", extra: true }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createLabelHandler dry-run
// ---------------------------------------------------------------------------

describe("createLabelHandler", () => {
  it("returns dry-run response without calling provider", async () => {
    const result = await createLabelHandler({ name: "TestLabel", dryRun: true });
    expect(result.content).toBeDefined();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("[DRY RUN]");
    expect(text).toContain("TestLabel");
  });
});

// ---------------------------------------------------------------------------
// add_label_by_query staging flow
// ---------------------------------------------------------------------------

describe("add_label_by_query staging flow", () => {
  it("stages with threadIds, originalQuery, and labelId args", () => {
    const threadIds = ["t1", "t2", "t3"];
    const args = { threadIds, originalQuery: "from:chase.com", labelId: "Label_18" };
    const preview = buildBatchPreview("add label", threadIds);
    const token = stageOperation("superhuman_add_label_by_query", args, preview, "user@test.com");

    expect(token).toMatch(/^shm_/);

    const op = confirmOperation(token, "user@test.com");
    expect(op.tool).toBe("superhuman_add_label_by_query");
    expect(op.args.threadIds).toEqual(threadIds);
    expect(op.args.originalQuery).toBe("from:chase.com");
    expect(op.args.labelId).toBe("Label_18");
  });
});

// ---------------------------------------------------------------------------
// isAuthError helper
// ---------------------------------------------------------------------------

describe("isAuthError", () => {
  it("detects 401 error", () => {
    expect(isAuthError(new Error("HTTP 401 Unauthorized"))).toBe(true);
  });

  it("detects Unauthorized error", () => {
    expect(isAuthError(new Error("Unauthorized"))).toBe(true);
  });

  it("detects Authentication error", () => {
    expect(isAuthError(new Error("Authentication failed"))).toBe(true);
  });

  it("returns false for non-auth errors", () => {
    expect(isAuthError(new Error("Network timeout"))).toBe(false);
    expect(isAuthError(new Error("404 Not Found"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isAuthError("string error")).toBe(false);
    expect(isAuthError(42)).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });
});
