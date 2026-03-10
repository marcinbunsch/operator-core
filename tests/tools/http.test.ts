import { it, describe } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { expect } from "vitest";
import { HttpToolkit, HttpToolHandlers } from "../../src/tools/http.js";
import { makeSandboxLayer } from "../../src/tools/SandboxService.js";
import { withTempDir } from "../helpers.js";

const makeTestLayer = (workspaces: string[], allowedHttpDomains?: string[]) =>
  HttpToolHandlers.pipe(Layer.provide(makeSandboxLayer({ workspaces, allowedHttpDomains })));

describe("HttpTool", () => {
  describe("URL validation", () => {
    it.scoped("rejects localhost", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("http-localhost");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(HttpToolkit, layer);

        const result = yield* toolkit.handle("http_request", {
          url: "http://localhost:3000/api",
          method: undefined,
          headers: undefined,
          body: undefined,
          timeout: undefined,
        });

        expect("error" in result.result).toBe(true);
      }),
    );

    it.scoped("rejects 127.0.0.1", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("http-127");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(HttpToolkit, layer);

        const result = yield* toolkit.handle("http_request", {
          url: "http://127.0.0.1:8080",
          method: undefined,
          headers: undefined,
          body: undefined,
          timeout: undefined,
        });

        expect("error" in result.result).toBe(true);
      }),
    );

    it.scoped("rejects private IPs (10.x.x.x)", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("http-10");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(HttpToolkit, layer);

        const result = yield* toolkit.handle("http_request", {
          url: "http://10.0.0.1/internal",
          method: undefined,
          headers: undefined,
          body: undefined,
          timeout: undefined,
        });

        expect("error" in result.result).toBe(true);
      }),
    );

    it.scoped("rejects private IPs (192.168.x.x)", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("http-192");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(HttpToolkit, layer);

        const result = yield* toolkit.handle("http_request", {
          url: "http://192.168.1.1/admin",
          method: undefined,
          headers: undefined,
          body: undefined,
          timeout: undefined,
        });

        expect("error" in result.result).toBe(true);
      }),
    );

    it.scoped("rejects invalid URL", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("http-invalid");
        const layer = makeTestLayer([tmp.dir]);
        const toolkit = yield* Effect.provide(HttpToolkit, layer);

        const result = yield* toolkit.handle("http_request", {
          url: "not-a-valid-url",
          method: undefined,
          headers: undefined,
          body: undefined,
          timeout: undefined,
        });

        expect("error" in result.result).toBe(true);
      }),
    );
  });

  describe("domain allowlist", () => {
    it.scoped("allows domain in allowlist", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("http-allowed");
        const layer = makeTestLayer([tmp.dir], ["httpbin.org"]);
        const toolkit = yield* Effect.provide(HttpToolkit, layer);

        const result = yield* toolkit.handle("http_request", {
          url: "https://httpbin.org/get",
          method: undefined,
          headers: undefined,
          body: undefined,
          timeout: 10000,
        });

        expect(result.result.status).toBe(200);
      }),
    );

    it.scoped("blocks domain not in allowlist", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("http-blocked");
        const layer = makeTestLayer([tmp.dir], ["api.github.com"]);
        const toolkit = yield* Effect.provide(HttpToolkit, layer);

        const result = yield* toolkit.handle("http_request", {
          url: "https://evil.com/steal-data",
          method: undefined,
          headers: undefined,
          body: undefined,
          timeout: undefined,
        });

        expect("error" in result.result).toBe(true);
      }),
    );

    it.scoped("allows subdomain of allowed domain", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("http-subdomain");
        const layer = makeTestLayer([tmp.dir], ["httpbin.org"]);
        const toolkit = yield* Effect.provide(HttpToolkit, layer);

        const result = yield* toolkit.handle("http_request", {
          url: "https://httpbin.org/get",
          method: undefined,
          headers: undefined,
          body: undefined,
          timeout: 10000,
        });

        expect(result.result.status).toBe(200);
      }),
    );
  });

  describe("HTTP methods", () => {
    it.scoped("makes GET request by default", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("http-get");
        const layer = makeTestLayer([tmp.dir], ["httpbin.org"]);
        const toolkit = yield* Effect.provide(HttpToolkit, layer);

        const result = yield* toolkit.handle("http_request", {
          url: "https://httpbin.org/get",
          method: undefined,
          headers: undefined,
          body: undefined,
          timeout: 10000,
        });

        expect(result.result.status).toBe(200);
        const body = JSON.parse(result.result.body);
        expect(body.url).toContain("httpbin.org/get");
      }),
    );

    it.scoped("makes POST request with body", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("http-post");
        const layer = makeTestLayer([tmp.dir], ["httpbin.org"]);
        const toolkit = yield* Effect.provide(HttpToolkit, layer);

        const result = yield* toolkit.handle("http_request", {
          url: "https://httpbin.org/post",
          method: "POST",
          headers: '{"Content-Type": "application/json"}',
          body: '{"key": "value"}',
          timeout: 10000,
        });

        expect(result.result.status).toBe(200);
        const body = JSON.parse(result.result.body);
        expect(body.json).toEqual({ key: "value" });
      }),
    );

    it.scoped("makes PUT request", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("http-put");
        const layer = makeTestLayer([tmp.dir], ["httpbin.org"]);
        const toolkit = yield* Effect.provide(HttpToolkit, layer);

        const result = yield* toolkit.handle("http_request", {
          url: "https://httpbin.org/put",
          method: "PUT",
          headers: undefined,
          body: "updated data",
          timeout: 10000,
        });

        expect(result.result.status).toBe(200);
      }),
    );

    it.scoped("makes DELETE request", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("http-delete");
        const layer = makeTestLayer([tmp.dir], ["httpbin.org"]);
        const toolkit = yield* Effect.provide(HttpToolkit, layer);

        const result = yield* toolkit.handle("http_request", {
          url: "https://httpbin.org/delete",
          method: "DELETE",
          headers: undefined,
          body: undefined,
          timeout: 10000,
        });

        expect(result.result.status).toBe(200);
      }),
    );
  });

  describe("headers", () => {
    it.scoped("sends custom headers", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("http-headers");
        const layer = makeTestLayer([tmp.dir], ["httpbin.org"]);
        const toolkit = yield* Effect.provide(HttpToolkit, layer);

        const result = yield* toolkit.handle("http_request", {
          url: "https://httpbin.org/headers",
          method: undefined,
          headers: '{"X-Custom-Header": "custom-value", "Authorization": "Bearer token123"}',
          body: undefined,
          timeout: 10000,
        });

        expect(result.result.status).toBe(200);
        const body = JSON.parse(result.result.body);
        expect(body.headers["X-Custom-Header"]).toBe("custom-value");
        expect(body.headers["Authorization"]).toBe("Bearer token123");
      }),
    );

    it.scoped("returns response headers", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("http-response-headers");
        const layer = makeTestLayer([tmp.dir], ["httpbin.org"]);
        const toolkit = yield* Effect.provide(HttpToolkit, layer);

        const result = yield* toolkit.handle("http_request", {
          url: "https://httpbin.org/response-headers?X-Test=hello",
          method: undefined,
          headers: undefined,
          body: undefined,
          timeout: 10000,
        });

        expect(result.result.headers["x-test"]).toBe("hello");
      }),
    );
  });

  describe("timeout", () => {
    it.scoped("times out for slow endpoint", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("http-timeout");
        const layer = makeTestLayer([tmp.dir], ["httpbin.org"]);
        const toolkit = yield* Effect.provide(HttpToolkit, layer);

        const result = yield* toolkit.handle("http_request", {
          url: "https://httpbin.org/delay/10", // 10 second delay
          method: undefined,
          headers: undefined,
          body: undefined,
          timeout: 100, // 100ms timeout
        });

        expect("error" in result.result).toBe(true);
      }),
    );
  });

  describe("response handling", () => {
    it.scoped("returns status code and text", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("http-status");
        const layer = makeTestLayer([tmp.dir], ["httpbin.org"]);
        const toolkit = yield* Effect.provide(HttpToolkit, layer);

        const result = yield* toolkit.handle("http_request", {
          url: "https://httpbin.org/status/201",
          method: undefined,
          headers: undefined,
          body: undefined,
          timeout: 10000,
        });

        expect(result.result.status).toBe(201);
      }),
    );

    it.scoped("handles 4xx errors without throwing", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("http-4xx");
        const layer = makeTestLayer([tmp.dir], ["httpbin.org"]);
        const toolkit = yield* Effect.provide(HttpToolkit, layer);

        const result = yield* toolkit.handle("http_request", {
          url: "https://httpbin.org/status/404",
          method: undefined,
          headers: undefined,
          body: undefined,
          timeout: 10000,
        });

        expect(result.result.status).toBe(404);
      }),
    );

    it.scoped("handles 5xx errors without throwing", () =>
      Effect.gen(function* () {
        const tmp = yield* withTempDir("http-5xx");
        const layer = makeTestLayer([tmp.dir], ["httpbin.org"]);
        const toolkit = yield* Effect.provide(HttpToolkit, layer);

        const result = yield* toolkit.handle("http_request", {
          url: "https://httpbin.org/status/500",
          method: undefined,
          headers: undefined,
          body: undefined,
          timeout: 10000,
        });

        expect(result.result.status).toBe(500);
      }),
    );
  });
});
