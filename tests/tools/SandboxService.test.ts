import { it, describe } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { expect } from "vitest";
import {
  SandboxService,
  makeSandboxLayer,
  SandboxViolationError,
  DomainNotAllowedError,
} from "../../src/tools/SandboxService.js";
import { withTempDir } from "../helpers.js";

describe("SandboxService", () => {
  describe("makeSandboxLayer", () => {
    it.scoped("creates layer with single workspace", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("sandbox-single");
        const layer = makeSandboxLayer({ workspaces: [tmp.dir] });

        const sandbox = yield* Effect.provide(SandboxService, layer);
        expect(sandbox.workspaces).toHaveLength(1);
        expect(sandbox.defaultWorkspace).toBe(tmp.dir);
      }),
    );

    it.scoped("creates layer with multiple workspaces", () =>
      Effect.gen(function* () {
        const tmp1 = yield* withTempDir("sandbox-multi-1");
        const tmp2 = yield* withTempDir("sandbox-multi-2");
        const layer = makeSandboxLayer({ workspaces: [tmp1.dir, tmp2.dir] });

        const sandbox = yield* Effect.provide(SandboxService, layer);
        expect(sandbox.workspaces).toHaveLength(2);
        expect(sandbox.defaultWorkspace).toBe(tmp1.dir);
      }),
    );

    it("throws when workspace does not exist", () => {
      expect(() =>
        makeSandboxLayer({ workspaces: ["/nonexistent/path/12345"] }),
      ).toThrow("does not exist");
    });

    it("throws when no workspaces provided", () => {
      expect(() => makeSandboxLayer({ workspaces: [] })).toThrow(
        "At least one workspace",
      );
    });
  });

  describe("resolvePath", () => {
    it.scoped("resolves relative path within workspace", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("resolve-relative");
        const layer = makeSandboxLayer({ workspaces: [tmp.dir] });
        const sandbox = yield* Effect.provide(SandboxService, layer);

        const resolved = yield* sandbox.resolvePath("subdir/file.txt");
        expect(resolved).toBe(`${tmp.dir}/subdir/file.txt`);
      }),
    );

    it.scoped("resolves absolute path within workspace", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("resolve-absolute");
        const layer = makeSandboxLayer({ workspaces: [tmp.dir] });
        const sandbox = yield* Effect.provide(SandboxService, layer);

        const resolved = yield* sandbox.resolvePath(`${tmp.dir}/file.txt`);
        expect(resolved).toBe(`${tmp.dir}/file.txt`);
      }),
    );

    it.scoped("rejects path traversal attempts", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("resolve-traversal");
        const layer = makeSandboxLayer({ workspaces: [tmp.dir] });
        const sandbox = yield* Effect.provide(SandboxService, layer);

        const result = yield* Effect.exit(sandbox.resolvePath("../../../etc/passwd"));
        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const error = result.cause;
          expect(error._tag).toBe("Fail");
        }
      }),
    );

    it.scoped("rejects absolute path outside workspace", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("resolve-outside");
        const layer = makeSandboxLayer({ workspaces: [tmp.dir] });
        const sandbox = yield* Effect.provide(SandboxService, layer);

        const result = yield* Effect.exit(sandbox.resolvePath("/etc/passwd"));
        expect(Exit.isFailure(result)).toBe(true);
      }),
    );

    it.scoped("allows path in any of multiple workspaces", () =>
      Effect.gen(function* () {
        const tmp1 = yield* withTempDir("resolve-multi-1");
        const tmp2 = yield* withTempDir("resolve-multi-2");
        const layer = makeSandboxLayer({ workspaces: [tmp1.dir, tmp2.dir] });
        const sandbox = yield* Effect.provide(SandboxService, layer);

        // Path in second workspace should work
        const resolved = yield* sandbox.resolvePath(`${tmp2.dir}/file.txt`);
        expect(resolved).toBe(`${tmp2.dir}/file.txt`);
      }),
    );
  });

  describe("validatePath", () => {
    it.scoped("validates path within workspace", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("validate-inside");
        const layer = makeSandboxLayer({ workspaces: [tmp.dir] });
        const sandbox = yield* Effect.provide(SandboxService, layer);

        const validated = yield* sandbox.validatePath(`${tmp.dir}/subdir/file.txt`);
        expect(validated).toBe(`${tmp.dir}/subdir/file.txt`);
      }),
    );

    it.scoped("rejects path outside workspace", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("validate-outside");
        const layer = makeSandboxLayer({ workspaces: [tmp.dir] });
        const sandbox = yield* Effect.provide(SandboxService, layer);

        const result = yield* Effect.exit(sandbox.validatePath("/tmp/other/file.txt"));
        expect(Exit.isFailure(result)).toBe(true);
      }),
    );
  });

  describe("validateUrl", () => {
    it.scoped("allows valid external URL with no allowlist", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("url-nolist");
        const layer = makeSandboxLayer({ workspaces: [tmp.dir] });
        const sandbox = yield* Effect.provide(SandboxService, layer);

        const url = yield* sandbox.validateUrl("https://api.github.com/repos");
        expect(url.hostname).toBe("api.github.com");
      }),
    );

    it.scoped("blocks localhost", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("url-localhost");
        const layer = makeSandboxLayer({ workspaces: [tmp.dir] });
        const sandbox = yield* Effect.provide(SandboxService, layer);

        const result = yield* Effect.exit(sandbox.validateUrl("http://localhost:3000"));
        expect(Exit.isFailure(result)).toBe(true);
      }),
    );

    it.scoped("blocks 127.0.0.1", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("url-127");
        const layer = makeSandboxLayer({ workspaces: [tmp.dir] });
        const sandbox = yield* Effect.provide(SandboxService, layer);

        const result = yield* Effect.exit(sandbox.validateUrl("http://127.0.0.1:8080"));
        expect(Exit.isFailure(result)).toBe(true);
      }),
    );

    it.scoped("blocks private IP ranges (10.x.x.x)", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("url-10");
        const layer = makeSandboxLayer({ workspaces: [tmp.dir] });
        const sandbox = yield* Effect.provide(SandboxService, layer);

        const result = yield* Effect.exit(sandbox.validateUrl("http://10.0.0.1"));
        expect(Exit.isFailure(result)).toBe(true);
      }),
    );

    it.scoped("blocks private IP ranges (192.168.x.x)", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("url-192");
        const layer = makeSandboxLayer({ workspaces: [tmp.dir] });
        const sandbox = yield* Effect.provide(SandboxService, layer);

        const result = yield* Effect.exit(sandbox.validateUrl("http://192.168.1.1"));
        expect(Exit.isFailure(result)).toBe(true);
      }),
    );

    it.scoped("blocks private IP ranges (172.16-31.x.x)", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("url-172");
        const layer = makeSandboxLayer({ workspaces: [tmp.dir] });
        const sandbox = yield* Effect.provide(SandboxService, layer);

        const result = yield* Effect.exit(sandbox.validateUrl("http://172.16.0.1"));
        expect(Exit.isFailure(result)).toBe(true);
      }),
    );

    it.scoped("allows domain in allowlist", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("url-allowlist");
        const layer = makeSandboxLayer({
          workspaces: [tmp.dir],
          allowedHttpDomains: ["api.github.com"],
        });
        const sandbox = yield* Effect.provide(SandboxService, layer);

        const url = yield* sandbox.validateUrl("https://api.github.com/repos");
        expect(url.hostname).toBe("api.github.com");
      }),
    );

    it.scoped("allows subdomain of allowed domain", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("url-subdomain");
        const layer = makeSandboxLayer({
          workspaces: [tmp.dir],
          allowedHttpDomains: ["github.com"],
        });
        const sandbox = yield* Effect.provide(SandboxService, layer);

        const url = yield* sandbox.validateUrl("https://api.github.com/repos");
        expect(url.hostname).toBe("api.github.com");
      }),
    );

    it.scoped("blocks domain not in allowlist", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("url-notallowed");
        const layer = makeSandboxLayer({
          workspaces: [tmp.dir],
          allowedHttpDomains: ["api.github.com"],
        });
        const sandbox = yield* Effect.provide(SandboxService, layer);

        const result = yield* Effect.exit(sandbox.validateUrl("https://evil.com"));
        expect(Exit.isFailure(result)).toBe(true);
      }),
    );

    it.scoped("rejects invalid URL", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("url-invalid");
        const layer = makeSandboxLayer({ workspaces: [tmp.dir] });
        const sandbox = yield* Effect.provide(SandboxService, layer);

        const result = yield* Effect.exit(sandbox.validateUrl("not-a-url"));
        expect(Exit.isFailure(result)).toBe(true);
      }),
    );
  });
});
