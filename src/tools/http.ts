import { Effect, Schema, Data } from "effect";
import * as Tool from "@effect/ai/Tool";
import * as Toolkit from "@effect/ai/Toolkit";
import { SandboxService } from "./SandboxService.js";

/**
 * Error thrown when an HTTP request fails
 */
export class HttpRequestError extends Data.TaggedError("HttpRequestError")<{
  readonly message: string;
  readonly url: string;
  readonly statusCode?: number;
}> {}

// Supported HTTP methods
const HttpMethod = Schema.Literal("GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS");

// Result schema - can be success or error
const HttpResult = Schema.Union(
  Schema.Struct({
    status: Schema.Number,
    statusText: Schema.String,
    headers: Schema.Record({ key: Schema.String, value: Schema.String }),
    body: Schema.String,
  }),
  Schema.Struct({
    error: Schema.String,
    url: Schema.String,
  }),
);

// Tool definition - use JSON string for headers to avoid Schema.Record in parameters
export const HttpRequest = Tool.make("http_request", {
  description:
    "Make HTTP requests to external APIs. Supports GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS methods. Security: allowlist-only domains (if configured), no local/private hosts, SSRF protection.",
  parameters: {
    url: Schema.String.annotations({
      description: "HTTP or HTTPS URL to request",
    }),
    method: Schema.optional(HttpMethod).annotations({
      description: "HTTP method (default: GET)",
    }),
    headers: Schema.optional(Schema.String).annotations({
      description:
        "Optional HTTP headers as JSON string (e.g. '{\"Content-Type\": \"application/json\"}')",
    }),
    body: Schema.optional(Schema.String).annotations({
      description: "Optional request body",
    }),
    timeout: Schema.optional(Schema.Number).annotations({
      description: "Timeout in milliseconds (default: 30000)",
    }),
  },
  success: HttpResult,
});

// Toolkit
export const HttpToolkit = Toolkit.make(HttpRequest);

// Helper to format error response
const formatError = (error: unknown, url: string) => ({
  error: error instanceof Error ? error.message : String(error),
  url,
});

// Handler implementation - catches errors and returns them as success responses
export const HttpToolHandlers = HttpToolkit.toLayer(
  Effect.gen(function* () {
    const sandbox = yield* SandboxService;

    return {
      http_request: ({ url, method, headers, body, timeout }) =>
        Effect.gen(function* () {
          // Validate URL against allowlist and SSRF protection
          const validatedUrl = yield* sandbox.validateUrl(url);

          // Only allow http and https
          if (validatedUrl.protocol !== "http:" && validatedUrl.protocol !== "https:") {
            return {
              error: `Only HTTP and HTTPS protocols are allowed, got: ${validatedUrl.protocol}`,
              url,
            };
          }

          const httpMethod = method ?? "GET";
          // Parse headers from JSON string
          let httpHeaders: Record<string, string> = {};
          if (headers) {
            try {
              httpHeaders = JSON.parse(headers) as Record<string, string>;
            } catch {
              return { error: `Invalid headers JSON: ${headers}`, url };
            }
          }
          const timeoutMs = timeout ?? 30000;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

          // Build fetch options, conditionally adding body
          const fetchOptions: RequestInit = {
            method: httpMethod,
            headers: httpHeaders as Record<string, string>,
            signal: controller.signal,
            redirect: "follow",
          };

          // Only add body for methods that support it
          if (httpMethod !== "GET" && httpMethod !== "HEAD" && body !== undefined) {
            fetchOptions.body = body;
          }

          const response = yield* Effect.tryPromise({
            try: async () => {
              try {
                const res = await fetch(validatedUrl.toString(), fetchOptions);

                clearTimeout(timeoutId);

                // Read response body as text
                const responseBody = await res.text();

                // Convert headers to plain object
                const responseHeaders: Record<string, string> = {};
                res.headers.forEach((value, key) => {
                  responseHeaders[key] = value;
                });

                return {
                  status: res.status,
                  statusText: res.statusText,
                  headers: responseHeaders,
                  body: responseBody,
                };
              } finally {
                clearTimeout(timeoutId);
              }
            },
            catch: (error: unknown) => {
              clearTimeout(timeoutId);

              if (error instanceof Error) {
                if (error.name === "AbortError") {
                  return { error: `Request timed out after ${timeoutMs}ms`, url };
                }
                return { error: `HTTP request failed: ${error.message}`, url };
              }

              return { error: `HTTP request failed: ${String(error)}`, url };
            },
          });

          return response;
        }).pipe(Effect.catchAll((e) => Effect.succeed(formatError(e, url)))),
    };
  }),
);
