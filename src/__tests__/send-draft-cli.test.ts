// src/__tests__/send-draft-cli.test.ts
// Tests for the send-draft CLI command
import { test, expect, describe, mock, afterEach, beforeEach } from "bun:test";
import { $ } from "bun";

describe("send-draft CLI command", () => {
  describe("command registration", () => {
    test("send-draft command appears in help", async () => {
      // Run the CLI with --help and check that send-draft is listed
      const proc = Bun.spawn(["bun", "run", "src/cli.ts", "--help"], {
        cwd: "/Users/vwh7mb/projects/superhuman-cli/.worktrees/reply-forward-cached",
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      expect(stdout).toContain("send-draft");
    });

    test("send-draft command requires draft-id argument", async () => {
      // Run send-draft without a draft-id - should show usage error
      const proc = Bun.spawn(
        ["bun", "run", "src/cli.ts", "send-draft", "--account=test@example.com", "--to=recipient@example.com", "--subject=Test", "--body=Test body"],
        {
          cwd: "/Users/vwh7mb/projects/superhuman-cli/.worktrees/reply-forward-cached",
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      const output = stdout + stderr;

      // Should error because no draft-id provided
      expect(output).toMatch(/draft.*id|required/i);
    });

    test("send-draft validates draft-id format", async () => {
      // Run send-draft with an invalid draft ID
      const proc = Bun.spawn(
        ["bun", "run", "src/cli.ts", "send-draft", "invalid-id", "--account=test@example.com", "--to=recipient@example.com", "--subject=Test", "--body=Test body"],
        {
          cwd: "/Users/vwh7mb/projects/superhuman-cli/.worktrees/reply-forward-cached",
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      const output = stdout + stderr;

      // Should error about invalid draft ID format
      expect(output).toMatch(/invalid.*draft.*id|must.*start.*draft00/i);
      expect(exitCode).not.toBe(0);
    });

    test("send-draft requires --account flag", async () => {
      // Run send-draft without --account flag
      const proc = Bun.spawn(
        ["bun", "run", "src/cli.ts", "send-draft", "draft00abcdef123456", "--to=recipient@example.com", "--subject=Test", "--body=Test body"],
        {
          cwd: "/Users/vwh7mb/projects/superhuman-cli/.worktrees/reply-forward-cached",
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      const output = stdout + stderr;

      // Should error about missing --account flag
      expect(output).toMatch(/--account.*required|account.*required/i);
      expect(exitCode).not.toBe(0);
    });

    test("send-draft requires --to flag", async () => {
      // Run send-draft without --to flag
      const proc = Bun.spawn(
        ["bun", "run", "src/cli.ts", "send-draft", "draft00abcdef123456", "--account=test@example.com", "--subject=Test", "--body=Test body"],
        {
          cwd: "/Users/vwh7mb/projects/superhuman-cli/.worktrees/reply-forward-cached",
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      const output = stdout + stderr;

      // Should error about missing --to flag
      expect(output).toMatch(/--to.*required|recipient.*required/i);
      expect(exitCode).not.toBe(0);
    });

    test("send-draft requires --subject flag", async () => {
      // Run send-draft without --subject flag
      const proc = Bun.spawn(
        ["bun", "run", "src/cli.ts", "send-draft", "draft00abcdef123456", "--account=test@example.com", "--to=recipient@example.com", "--body=Test body"],
        {
          cwd: "/Users/vwh7mb/projects/superhuman-cli/.worktrees/reply-forward-cached",
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      const output = stdout + stderr;

      // Should error about missing --subject flag
      expect(output).toMatch(/--subject.*required|subject.*required/i);
      expect(exitCode).not.toBe(0);
    });

    test("send-draft requires --body flag", async () => {
      // Run send-draft without --body flag
      const proc = Bun.spawn(
        ["bun", "run", "src/cli.ts", "send-draft", "draft00abcdef123456", "--account=test@example.com", "--to=recipient@example.com", "--subject=Test"],
        {
          cwd: "/Users/vwh7mb/projects/superhuman-cli/.worktrees/reply-forward-cached",
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      const output = stdout + stderr;

      // Should error about missing --body flag
      expect(output).toMatch(/--body.*required|body.*required/i);
      expect(exitCode).not.toBe(0);
    });

    test("send-draft shows --thread option in help examples", async () => {
      // Run the CLI with --help and check that --thread is documented
      const proc = Bun.spawn(["bun", "run", "src/cli.ts", "--help"], {
        cwd: "/Users/vwh7mb/projects/superhuman-cli/.worktrees/reply-forward-cached",
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      // Check that --thread option is documented in send-draft examples
      expect(stdout).toMatch(/--thread/);
    });
  });
});
