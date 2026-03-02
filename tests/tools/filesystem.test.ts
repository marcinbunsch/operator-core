import { it, describe } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { expect } from "vitest";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { FilesystemToolkit, FilesystemToolHandlers } from "../../src/tools/filesystem.js";
import { makeSandboxLayer } from "../../src/tools/SandboxService.js";
import { withTempDir } from "../helpers.js";

const makeTestLayer = (workspaces: string[]) =>
  FilesystemToolHandlers.pipe(Layer.provide(makeSandboxLayer({ workspaces })));

describe("FilesystemTools", () => {
  describe("file_read", () => {
    it.scoped("reads file content", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("fs-read");
        writeFileSync(tmp.path("test.txt"), "Hello, World!");

        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(FilesystemToolkit, layer);

        const result = yield* toolkit.handle("file_read", { path: "test.txt" });
        expect(result.result.content).toBe("Hello, World!");
        expect(result.result.path).toBe("test.txt");
      }),
    );

    it.scoped("reads file with absolute path in workspace", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("fs-read-abs");
        writeFileSync(tmp.path("data.json"), '{"key": "value"}');

        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(FilesystemToolkit, layer);

        const result = yield* toolkit.handle("file_read", { path: tmp.path("data.json") });
        expect(result.result.content).toBe('{"key": "value"}');
      }),
    );

    it.scoped("returns error for nonexistent file", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("fs-read-nofile");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(FilesystemToolkit, layer);

        const result = yield* toolkit.handle("file_read", { path: "nope.txt" });
        expect("error" in result.result).toBe(true);
      }),
    );

    it.scoped("returns error for path outside workspace", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("fs-read-outside");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(FilesystemToolkit, layer);

        const result = yield* toolkit.handle("file_read", { path: "/etc/passwd" });
        expect("error" in result.result).toBe(true);
      }),
    );
  });

  describe("file_write", () => {
    it.scoped("writes content to new file", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("fs-write-new");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(FilesystemToolkit, layer);

        const result = yield* toolkit.handle("file_write", {
          path: "output.txt",
          content: "New content",
        });

        expect(result.result.success).toBe(true);
        expect(result.result.path).toBe("output.txt");
        expect(result.result.bytesWritten).toBe(11);
        expect(readFileSync(tmp.path("output.txt"), "utf-8")).toBe("New content");
      }),
    );

    it.scoped("overwrites existing file", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("fs-write-overwrite");
        writeFileSync(tmp.path("existing.txt"), "Old content");

        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(FilesystemToolkit, layer);

        yield* toolkit.handle("file_write", {
          path: "existing.txt",
          content: "Updated content",
        });

        expect(readFileSync(tmp.path("existing.txt"), "utf-8")).toBe("Updated content");
      }),
    );

    it.scoped("creates parent directories", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("fs-write-mkdir");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(FilesystemToolkit, layer);

        yield* toolkit.handle("file_write", {
          path: "deep/nested/dir/file.txt",
          content: "Deep file",
        });

        expect(existsSync(tmp.path("deep/nested/dir/file.txt"))).toBe(true);
      }),
    );

    it.scoped("returns error for path outside workspace", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("fs-write-outside");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(FilesystemToolkit, layer);

        const result = yield* toolkit.handle("file_write", {
          path: "../../../tmp/evil.txt",
          content: "bad",
        });
        expect("error" in result.result).toBe(true);
      }),
    );
  });

  describe("file_edit", () => {
    it.scoped("replaces text in file", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("fs-edit-replace");
        writeFileSync(tmp.path("code.js"), "const foo = 'bar';");

        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(FilesystemToolkit, layer);

        const result = yield* toolkit.handle("file_edit", {
          path: "code.js",
          old_text: "foo",
          new_text: "baz",
        });

        expect(result.result.success).toBe(true);
        expect(result.result.replacements).toBe(1);
        expect(readFileSync(tmp.path("code.js"), "utf-8")).toBe("const baz = 'bar';");
      }),
    );

    it.scoped("replaces multiple occurrences", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("fs-edit-multi");
        writeFileSync(tmp.path("text.txt"), "foo bar foo baz foo");

        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(FilesystemToolkit, layer);

        const result = yield* toolkit.handle("file_edit", {
          path: "text.txt",
          old_text: "foo",
          new_text: "qux",
        });

        expect(result.result.replacements).toBe(3);
        expect(readFileSync(tmp.path("text.txt"), "utf-8")).toBe("qux bar qux baz qux");
      }),
    );

    it.scoped("returns error when text not found", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("fs-edit-notfound");
        writeFileSync(tmp.path("file.txt"), "some content");

        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(FilesystemToolkit, layer);

        const result = yield* toolkit.handle("file_edit", {
          path: "file.txt",
          old_text: "nonexistent",
          new_text: "replacement",
        });
        expect("error" in result.result).toBe(true);
      }),
    );

    it.scoped("returns error for nonexistent file", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("fs-edit-nofile");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(FilesystemToolkit, layer);

        const result = yield* toolkit.handle("file_edit", {
          path: "missing.txt",
          old_text: "foo",
          new_text: "bar",
        });
        expect("error" in result.result).toBe(true);
      }),
    );
  });

  describe("file_append", () => {
    it.scoped("appends to existing file", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("fs-append-existing");
        writeFileSync(tmp.path("log.txt"), "Line 1\n");

        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(FilesystemToolkit, layer);

        const result = yield* toolkit.handle("file_append", {
          path: "log.txt",
          content: "Line 2\n",
        });

        expect(result.result.success).toBe(true);
        expect(result.result.bytesAppended).toBe(7);
        expect(readFileSync(tmp.path("log.txt"), "utf-8")).toBe("Line 1\nLine 2\n");
      }),
    );

    it.scoped("creates new file if not exists", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("fs-append-new");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(FilesystemToolkit, layer);

        yield* toolkit.handle("file_append", {
          path: "new.txt",
          content: "First line",
        });

        expect(existsSync(tmp.path("new.txt"))).toBe(true);
        expect(readFileSync(tmp.path("new.txt"), "utf-8")).toBe("First line");
      }),
    );

    it.scoped("creates parent directories", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("fs-append-mkdir");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(FilesystemToolkit, layer);

        yield* toolkit.handle("file_append", {
          path: "logs/app/output.log",
          content: "Log entry",
        });

        expect(existsSync(tmp.path("logs/app/output.log"))).toBe(true);
      }),
    );
  });

  describe("multiple workspaces", () => {
    it.scoped("allows operations in any workspace", () =>
      Effect.gen(function* () {
        const tmp1 = yield* withTempDir("fs-multi-1");
        const tmp2 = yield* withTempDir("fs-multi-2");
        writeFileSync(tmp2.path("data.txt"), "From workspace 2");

        const layer = makeTestLayer([tmp1.dir, tmp2.dir]);
        const toolkit = yield* Effect.provide(FilesystemToolkit, layer);

        // Read from second workspace using absolute path
        const result = yield* toolkit.handle("file_read", { path: tmp2.path("data.txt") });
        expect(result.result.content).toBe("From workspace 2");

        // Write to second workspace
        yield* toolkit.handle("file_write", {
          path: tmp2.path("new.txt"),
          content: "Written to ws2",
        });
        expect(readFileSync(tmp2.path("new.txt"), "utf-8")).toBe("Written to ws2");
      }),
    );
  });
});
