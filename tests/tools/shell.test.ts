import { it, describe } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { ShellToolkit, ShellToolHandlers } from "../../src/tools/shell.js";
import { makeSandboxLayer } from "../../src/tools/SandboxService.js";
import { withTempDir } from "../helpers.js";

const makeTestLayer = (workspaces: string[]) =>
  ShellToolHandlers.pipe(Layer.provide(makeSandboxLayer({ workspaces })));

describe("ShellTool", () => {
  describe("basic execution", () => {
    it.scoped("executes simple command", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("shell-simple");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(ShellToolkit, layer);

        const result = yield* toolkit.handle("shell", {
          command: "echo hello",
          cwd: undefined,
          timeout: undefined,
        });

        expect(result.result.exitCode).toBe(0);
        expect(result.result.stdout.trim()).toBe("hello");
        expect(result.result.stderr).toBe("");
      }),
    );

    it.scoped("captures stdout", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("shell-stdout");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(ShellToolkit, layer);

        const result = yield* toolkit.handle("shell", {
          command: "echo -n 'line1'; echo -n 'line2'",
          cwd: undefined,
          timeout: undefined,
        });

        expect(result.result.stdout).toBe("line1line2");
      }),
    );

    it.scoped("captures stderr", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("shell-stderr");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(ShellToolkit, layer);

        const result = yield* toolkit.handle("shell", {
          command: "echo error >&2",
          cwd: undefined,
          timeout: undefined,
        });

        expect(result.result.stderr.trim()).toBe("error");
      }),
    );

    it.scoped("returns non-zero exit code", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("shell-exitcode");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(ShellToolkit, layer);

        const result = yield* toolkit.handle("shell", {
          command: "exit 42",
          cwd: undefined,
          timeout: undefined,
        });

        expect(result.result.exitCode).toBe(42);
      }),
    );
  });

  describe("working directory", () => {
    it.scoped("runs in default workspace", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("shell-defaultcwd");
        writeFileSync(tmp.path("marker.txt"), "found");

        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(ShellToolkit, layer);

        const result = yield* toolkit.handle("shell", {
          command: "cat marker.txt",
          cwd: undefined,
          timeout: undefined,
        });

        expect(result.result.stdout.trim()).toBe("found");
      }),
    );

    it.scoped("runs in specified subdirectory", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("shell-subdir");
        mkdirSync(tmp.path("subdir"));
        writeFileSync(tmp.path("subdir/file.txt"), "in subdir");

        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(ShellToolkit, layer);

        const result = yield* toolkit.handle("shell", {
          command: "cat file.txt",
          cwd: "subdir",
          timeout: undefined,
        });

        expect(result.result.stdout.trim()).toBe("in subdir");
      }),
    );

    it.scoped("rejects cwd outside workspace", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("shell-badcwd");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(ShellToolkit, layer);

        const result = yield* toolkit.handle("shell", {
          command: "ls",
          cwd: "/tmp",
          timeout: undefined,
        });

        expect(result.result.exitCode).toBe(-1);
      }),
    );
  });

  describe("timeout", () => {
    it.scoped("completes before timeout", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("shell-timeout-ok");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(ShellToolkit, layer);

        const result = yield* toolkit.handle("shell", {
          command: "echo fast",
          cwd: undefined,
          timeout: 5000,
        });

        expect(result.result.exitCode).toBe(0);
      }),
    );

    it.scoped("times out for long-running command", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("shell-timeout-fail");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(ShellToolkit, layer);

        const result = yield* toolkit.handle("shell", {
          command: "sleep 10",
          cwd: undefined,
          timeout: 100, // 100ms timeout
        });

        expect(result.result.exitCode).toBe(-1);
      }),
    );
  });

  describe("multiple workspaces", () => {
    it.scoped("can run in any allowed workspace", () =>
      Effect.gen(function* () {
        const tmp1 = yield* withTempDir("shell-multi-1");
        const tmp2 = yield* withTempDir("shell-multi-2");
        writeFileSync(tmp2.path("data.txt"), "from ws2");

        const layer = makeTestLayer([tmp1.dir, tmp2.dir]);
        const toolkit = yield* Effect.provide(ShellToolkit, layer);

        // Run command in second workspace
        const result = yield* toolkit.handle("shell", {
          command: "cat data.txt",
          cwd: tmp2.dir,
          timeout: undefined,
        });

        expect(result.result.stdout.trim()).toBe("from ws2");
      }),
    );
  });

  describe("command execution", () => {
    it.scoped("executes piped commands", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("shell-pipe");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(ShellToolkit, layer);

        const result = yield* toolkit.handle("shell", {
          command: "echo 'hello world' | wc -w",
          cwd: undefined,
          timeout: undefined,
        });

        expect(result.result.stdout.trim()).toBe("2");
      }),
    );

    it.scoped("handles special characters in output", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("shell-special");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(ShellToolkit, layer);

        const result = yield* toolkit.handle("shell", {
          command: "echo 'line1\nline2\tcolumn'",
          cwd: undefined,
          timeout: undefined,
        });

        expect(result.result.stdout).toContain("line1");
        expect(result.result.stdout).toContain("line2");
      }),
    );
  });
});
