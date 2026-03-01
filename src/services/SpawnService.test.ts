import { it, describe, beforeEach, afterEach } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlinkSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { SpawnService } from "./SpawnService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = join(__dirname, "..", "..", "tmp");

// Ensure tmp dir exists
beforeEach(() => {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }
});

describe("SpawnService.isPidAlive", () => {
  it.effect("returns true for current process PID", () =>
    Effect.gen(function* () {
      const spawn = yield* SpawnService;
      const result = yield* spawn.isPidAlive(process.pid);
      expect(result).toBe(true);
    }).pipe(Effect.provide(SpawnService.Default)),
  );

  it.effect("returns false for bogus PID", () =>
    Effect.gen(function* () {
      const spawn = yield* SpawnService;
      const result = yield* spawn.isPidAlive(999999999);
      expect(result).toBe(false);
    }).pipe(Effect.provide(SpawnService.Default)),
  );
});

describe("SpawnService.readLogTail", () => {
  const testLogPath = join(TMP_DIR, "test-log.txt");

  afterEach(() => {
    if (existsSync(testLogPath)) {
      unlinkSync(testLogPath);
    }
  });

  it.effect("returns '(no log file found)' for nonexistent file", () =>
    Effect.gen(function* () {
      const spawn = yield* SpawnService;
      const result = yield* spawn.readLogTail(join(TMP_DIR, "nonexistent-log.txt"));
      expect(result).toBe("(no log file found)");
    }).pipe(Effect.provide(SpawnService.Default)),
  );

  it.effect("returns last N lines of file", () =>
    Effect.gen(function* () {
      const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`);
      writeFileSync(testLogPath, lines.join("\n"));

      const spawn = yield* SpawnService;
      const result = yield* spawn.readLogTail(testLogPath, 5);

      expect(result).toContain("Line 46");
      expect(result).toContain("Line 50");
      expect(result).not.toContain("Line 1");
    }).pipe(Effect.provide(SpawnService.Default)),
  );

  it.effect("returns all content if fewer lines than requested", () =>
    Effect.gen(function* () {
      writeFileSync(testLogPath, "Line 1\nLine 2\nLine 3");

      const spawn = yield* SpawnService;
      const result = yield* spawn.readLogTail(testLogPath, 25);

      expect(result).toContain("Line 1");
      expect(result).toContain("Line 3");
    }).pipe(Effect.provide(SpawnService.Default)),
  );
});

describe("SpawnService.getExitCodeFromLog", () => {
  const testLogPath = join(TMP_DIR, "test-exit-log.txt");

  afterEach(() => {
    if (existsSync(testLogPath)) {
      unlinkSync(testLogPath);
    }
  });

  it.effect("returns null for nonexistent file", () =>
    Effect.gen(function* () {
      const spawn = yield* SpawnService;
      const result = yield* spawn.getExitCodeFromLog(join(TMP_DIR, "nonexistent.txt"));
      expect(result).toBeNull();
    }).pipe(Effect.provide(SpawnService.Default)),
  );

  it.effect("returns null for file without exit code marker", () =>
    Effect.gen(function* () {
      writeFileSync(testLogPath, "Some log output\nMore output");

      const spawn = yield* SpawnService;
      const result = yield* spawn.getExitCodeFromLog(testLogPath);
      expect(result).toBeNull();
    }).pipe(Effect.provide(SpawnService.Default)),
  );

  it.effect("returns 0 for __EXIT_CODE__=0", () =>
    Effect.gen(function* () {
      writeFileSync(testLogPath, "Log output\n__EXIT_CODE__=0\n");

      const spawn = yield* SpawnService;
      const result = yield* spawn.getExitCodeFromLog(testLogPath);
      expect(result).toBe(0);
    }).pipe(Effect.provide(SpawnService.Default)),
  );

  it.effect("returns exit code from end of file", () =>
    Effect.gen(function* () {
      writeFileSync(testLogPath, "Processing...\nDone!\n__EXIT_CODE__=42\n");

      const spawn = yield* SpawnService;
      const result = yield* spawn.getExitCodeFromLog(testLogPath);
      expect(result).toBe(42);
    }).pipe(Effect.provide(SpawnService.Default)),
  );
});

describe("SpawnService.spawnDetached", () => {
  const testLogPath = join(TMP_DIR, "spawn-test.log");

  afterEach(() => {
    if (existsSync(testLogPath)) {
      unlinkSync(testLogPath);
    }
  });

  it.effect("spawns a detached process and returns PID", () =>
    Effect.gen(function* () {
      const spawn = yield* SpawnService;
      const pid = yield* spawn.spawnDetached(["echo", "hello"], {
        cwd: TMP_DIR,
        logPath: testLogPath,
      });

      // Just verify we get a valid PID back
      expect(typeof pid).toBe("number");
      expect(pid).toBeGreaterThan(0);
    }).pipe(Effect.provide(SpawnService.Default)),
  );
});

describe("SpawnService.waitForPid", () => {
  it.effect("returns immediately for dead PID", () =>
    Effect.gen(function* () {
      const startTime = Date.now();

      const spawn = yield* SpawnService;
      yield* spawn.waitForPid(999999999);

      const elapsed = Date.now() - startTime;
      // Should return almost immediately
      expect(elapsed).toBeLessThan(100);
    }).pipe(Effect.provide(SpawnService.Default)),
  );
});

describe("SpawnService.loadEnvFile", () => {
  const testEnvPath = join(TMP_DIR, "test.env");

  afterEach(() => {
    if (existsSync(testEnvPath)) {
      unlinkSync(testEnvPath);
    }
  });

  it.effect("returns empty object for nonexistent file", () =>
    Effect.gen(function* () {
      const spawn = yield* SpawnService;
      const result = yield* spawn.loadEnvFile(join(TMP_DIR, "nonexistent.env"));
      expect(result).toEqual({});
    }).pipe(Effect.provide(SpawnService.Default)),
  );

  it.effect("parses key=value pairs", () =>
    Effect.gen(function* () {
      writeFileSync(testEnvPath, "FOO=bar\nBAZ=qux");

      const spawn = yield* SpawnService;
      const result = yield* spawn.loadEnvFile(testEnvPath);
      expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
    }).pipe(Effect.provide(SpawnService.Default)),
  );

  it.effect("skips comments", () =>
    Effect.gen(function* () {
      writeFileSync(testEnvPath, "# This is a comment\nKEY=value\n# Another comment");

      const spawn = yield* SpawnService;
      const result = yield* spawn.loadEnvFile(testEnvPath);
      expect(result).toEqual({ KEY: "value" });
    }).pipe(Effect.provide(SpawnService.Default)),
  );

  it.effect("handles values with equals signs", () =>
    Effect.gen(function* () {
      writeFileSync(testEnvPath, "URL=https://example.com?foo=bar");

      const spawn = yield* SpawnService;
      const result = yield* spawn.loadEnvFile(testEnvPath);
      expect(result).toEqual({ URL: "https://example.com?foo=bar" });
    }).pipe(Effect.provide(SpawnService.Default)),
  );
});
