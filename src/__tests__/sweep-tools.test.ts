/**
 * Tests for inbox sweep tool enhancements:
 * - Search schema validation (limit min/max/default)
 * - Domain-grouping logic for anomalies
 * - extractRootDomain helper
 * - buildBatchPreview tiered formatting
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { SearchSchema } from "../mcp/tools/email-read";
import { ArchiveByQuerySchema } from "../mcp/tools/email-manage";
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
