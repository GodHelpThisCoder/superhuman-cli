// src/__tests__/read-context.test.ts
// Tests for the read command's --account requirement and --context flag (TDD RED phase)
import { test, expect, describe } from "bun:test";

describe("read command with --context", () => {
  test("read command fails gracefully without cached tokens or --account", async () => {
    // Run: read <fake-thread-id> without --account and no cached tokens
    // Expect: non-zero exit, output mentions tokens/auth or API error
    const proc = Bun.spawn(
      [process.execPath, "run", "src/cli.ts", "read", "thread-fake-12345"],
      {
        cwd: import.meta.dir + "/../..",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, SUPERHUMAN_CLI_CONFIG_DIR: "/tmp/nonexistent-test-dir" },
      }
    );
    const stderr = await new Response(proc.stderr).text();
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    const output = stdout + stderr;

    // Without cached tokens, should either error about tokens/auth
    // or attempt to launch Superhuman (which will fail or timeout)
    expect(output).toMatch(/cached|token|auth|connect|failed|launching superhuman/i);
  });

  test("read command shows --context in help", async () => {
    // Run: --help
    // Expect: output contains "--context"
    const proc = Bun.spawn(
      [process.execPath, "run", "src/cli.ts", "--help"],
      {
        cwd: import.meta.dir + "/../..",
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("--context");
  });

  test("read help example shows --account usage", async () => {
    // Run: --help
    // Expect: The read example line specifically includes --account
    // Currently the examples section shows:
    //   superhuman read <thread-id>
    //   superhuman read <thread-id> --json
    // After changes, at least one read example should show --account
    const proc = Bun.spawn(
      [process.execPath, "run", "src/cli.ts", "--help"],
      {
        cwd: import.meta.dir + "/../..",
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    // Check that in the examples section, a "read" example line also has --account
    // e.g. "superhuman read <thread-id> --account <email>"
    expect(stdout).toMatch(/superhuman read .+--account/);
  });

  test("read command requires thread-id argument", async () => {
    // Run: read --account test@example.com (no thread id)
    // Expect: non-zero exit, usage line mentions --account
    const proc = Bun.spawn(
      [process.execPath, "run", "src/cli.ts", "read", "--account=test@example.com"],
      {
        cwd: import.meta.dir + "/../..",
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const stderr = await new Response(proc.stderr).text();
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    const output = stdout + stderr;

    // Should error about missing thread-id and the usage line should show --account
    expect(output).toMatch(/thread.*id/i);
    expect(output).toMatch(/--account/);
    expect(exitCode).not.toBe(0);
  });
});
