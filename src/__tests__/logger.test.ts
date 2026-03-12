import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We need to reset module state between tests, so we re-import dynamically
let setLogLevel: typeof import("../logger").setLogLevel;
let getLogLevel: typeof import("../logger").getLogLevel;
let createLogger: typeof import("../logger").createLogger;
let initFileLogging: typeof import("../logger").initFileLogging;
let _resetForTesting: typeof import("../logger")._resetForTesting;

let testDir: string;
const origEnv = process.env.SUPERHUMAN_CLI_CONFIG_DIR;
const origLogLevel = process.env.SUPERHUMAN_LOG_LEVEL;

beforeEach(async () => {
  testDir = join(tmpdir(), `logger-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.SUPERHUMAN_CLI_CONFIG_DIR = testDir;

  // Fresh import each time
  const mod = await import("../logger");
  setLogLevel = mod.setLogLevel;
  getLogLevel = mod.getLogLevel;
  createLogger = mod.createLogger;
  initFileLogging = mod.initFileLogging;
  _resetForTesting = mod._resetForTesting;

  // Reset all logger state between tests
  _resetForTesting();
});

afterEach(() => {
  if (origEnv === undefined) delete process.env.SUPERHUMAN_CLI_CONFIG_DIR;
  else process.env.SUPERHUMAN_CLI_CONFIG_DIR = origEnv;
  if (origLogLevel === undefined) delete process.env.SUPERHUMAN_LOG_LEVEL;
  else process.env.SUPERHUMAN_LOG_LEVEL = origLogLevel;
  try { rmSync(testDir, { recursive: true, force: true }); } catch {}
});

describe("logger", () => {
  describe("setLogLevel / getLogLevel", () => {
    it("defaults to info", () => {
      setLogLevel("info");
      expect(getLogLevel()).toBe("info");
    });

    it("roundtrips all levels", () => {
      for (const level of ["debug", "info", "warn", "error"] as const) {
        setLogLevel(level);
        expect(getLogLevel()).toBe(level);
      }
    });
  });

  describe("level filtering", () => {
    it("suppresses debug at info level", () => {
      setLogLevel("info");
      const log = createLogger("test");
      const captured: string[] = [];
      const origConsoleError = console.error;
      console.error = (...args: any[]) => captured.push(args.join(" "));

      log.debug("should not appear");
      log.info("should appear");

      console.error = origConsoleError;

      expect(captured.length).toBe(1);
      expect(captured[0]).toContain("should appear");
    });

    it("shows debug at debug level", () => {
      setLogLevel("debug");
      const log = createLogger("test");
      const captured: string[] = [];
      const origConsoleError = console.error;
      console.error = (...args: any[]) => captured.push(args.join(" "));

      log.debug("debug msg");

      console.error = origConsoleError;

      expect(captured.length).toBe(1);
      expect(captured[0]).toContain("debug msg");
    });

    it("suppresses info and debug at warn level", () => {
      setLogLevel("warn");
      const log = createLogger("test");
      const captured: string[] = [];
      const origConsoleError = console.error;
      console.error = (...args: any[]) => captured.push(args.join(" "));

      log.debug("no");
      log.info("no");
      log.warn("yes");
      log.error("yes");

      console.error = origConsoleError;

      expect(captured.length).toBe(2);
    });
  });

  describe("output format", () => {
    it("includes timestamp, level, module, and message", () => {
      setLogLevel("info");
      const log = createLogger("mymod");
      const captured: string[] = [];
      const origConsoleError = console.error;
      console.error = (...args: any[]) => captured.push(args.join(" "));

      log.info("hello world");

      console.error = origConsoleError;

      expect(captured.length).toBe(1);
      // Format: [ISO] [LEVEL] [module] message
      expect(captured[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
      expect(captured[0]).toContain("[INFO ");
      expect(captured[0]).toContain("[mymod]");
      expect(captured[0]).toContain("hello world");
    });

    it("appends extra args", () => {
      setLogLevel("debug");
      const log = createLogger("test");
      const captured: string[] = [];
      const origConsoleError = console.error;
      console.error = (...args: any[]) => captured.push(args.join(" "));

      log.debug("count:", 42);

      console.error = origConsoleError;

      expect(captured[0]).toContain("count:");
      expect(captured[0]).toContain("42");
    });
  });

  describe("file logging", () => {
    it("writes to superhuman.log after initFileLogging", async () => {
      await initFileLogging();
      setLogLevel("info");
      const log = createLogger("filetest");

      log.info("file log entry");

      // Wait for async file write
      await new Promise((r) => setTimeout(r, 200));

      const logFile = Bun.file(join(testDir, "superhuman.log"));
      expect(await logFile.exists()).toBe(true);
      const content = await logFile.text();
      expect(content).toContain("file log entry");
      expect(content).toContain("[filetest]");
    });

    it("does not write when file logging is not initialized", async () => {
      // Don't call initFileLogging
      setLogLevel("info");
      const log = createLogger("nofile");

      const captured: string[] = [];
      const origConsoleError = console.error;
      console.error = (...args: any[]) => captured.push(args.join(" "));

      log.info("stderr only");

      console.error = origConsoleError;

      await new Promise((r) => setTimeout(r, 100));

      // Should have logged to stderr
      expect(captured.length).toBe(1);

      // Should NOT have created a log file
      const logFile = Bun.file(join(testDir, "superhuman.log"));
      expect(await logFile.exists()).toBe(false);
    });
  });

  describe("createLogger scoping", () => {
    it("different modules produce different tags", () => {
      setLogLevel("info");
      const logA = createLogger("alpha");
      const logB = createLogger("beta");
      const captured: string[] = [];
      const origConsoleError = console.error;
      console.error = (...args: any[]) => captured.push(args.join(" "));

      logA.info("from alpha");
      logB.info("from beta");

      console.error = origConsoleError;

      expect(captured[0]).toContain("[alpha]");
      expect(captured[1]).toContain("[beta]");
    });
  });
});
