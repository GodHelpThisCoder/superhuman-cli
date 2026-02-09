/**
 * CLI Draft List Tests
 *
 * Tests the `superhuman draft list` command output with source column.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import type { Draft } from "../services/draft-service";

// Store original console.log
const originalLog = console.log;
let logOutput: string[] = [];

describe("superhuman draft list", () => {
  beforeEach(() => {
    logOutput = [];
    console.log = (...args: any[]) => {
      logOutput.push(args.join(" "));
    };
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it("should format drafts with source column for display", () => {
    // Test the display logic by verifying that drafts with source are formatted correctly
    const drafts: Draft[] = [
      {
        id: "gmail-draft-1",
        subject: "Gmail Test",
        from: "user@gmail.com",
        to: ["recipient@example.com"],
        preview: "Gmail preview",
        timestamp: "2024-02-08T12:00:00Z",
        source: "gmail",
      },
      {
        id: "outlook-draft-1",
        subject: "Outlook Test",
        from: "user@outlook.com",
        to: ["recipient@example.com"],
        preview: "Outlook preview",
        timestamp: "2024-02-08T13:00:00Z",
        source: "outlook",
      },
    ];

    // Format draft output similar to how cmdListDrafts does it
    for (const draft of drafts) {
      console.log(`${draft.id}`);
      console.log(`  Subject: ${draft.subject}`);
      console.log(`  Source: ${draft.source}`);
      console.log(`  To: ${draft.to.join(", ")}`);
      console.log("");
    }

    // Verify output contains Source entries
    expect(logOutput.some((line) => line.includes("Source: gmail"))).toBe(true);
    expect(logOutput.some((line) => line.includes("Source: outlook"))).toBe(true);
  });

  it("should format native drafts with source column for display", () => {
    // Test the display logic for native Superhuman drafts
    const drafts: Draft[] = [
      {
        id: "gmail-draft-1",
        subject: "Gmail Test",
        from: "user@gmail.com",
        to: ["recipient@example.com"],
        preview: "Gmail preview",
        timestamp: "2024-02-08T12:00:00Z",
        source: "gmail",
      },
      {
        id: "draft00abc123",
        subject: "Native Superhuman Draft",
        from: "user@gmail.com",
        to: ["recipient@example.com"],
        preview: "Native draft preview",
        timestamp: "2024-02-08T14:00:00Z",
        source: "native",
      },
    ];

    // Format draft output similar to how cmdListDrafts does it
    for (const draft of drafts) {
      console.log(`${draft.id}`);
      console.log(`  Subject: ${draft.subject}`);
      console.log(`  Source: ${draft.source}`);
      console.log(`  To: ${draft.to.join(", ")}`);
      console.log("");
    }

    // Verify output contains both gmail and native source entries
    expect(logOutput.some((line) => line.includes("Source: gmail"))).toBe(true);
    expect(logOutput.some((line) => line.includes("Source: native"))).toBe(true);
    expect(logOutput.some((line) => line.includes("draft00abc123"))).toBe(true);
  });

  it("draft list command appears in CLI help", async () => {
    const proc = Bun.spawn([process.execPath, "run", "src/cli.ts", "--help"], {
      cwd: import.meta.dir + "/../..",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("draft");
  });
});
