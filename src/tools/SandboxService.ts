import { Context, Effect, Layer, Data } from "effect";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Error thrown when a path escapes the sandbox workspace
 */
export class SandboxViolationError extends Data.TaggedError("SandboxViolationError")<{
  readonly message: string;
  readonly path: string;
  readonly allowedWorkspaces: ReadonlyArray<string>;
}> {}

/**
 * Error thrown when an HTTP request targets a disallowed domain
 */
export class DomainNotAllowedError extends Data.TaggedError("DomainNotAllowedError")<{
  readonly message: string;
  readonly domain: string;
  readonly allowedDomains: ReadonlyArray<string>;
}> {}

/**
 * Configuration for the sandbox
 */
export interface SandboxConfig {
  /** Allowed workspace paths (at least one required) */
  readonly workspaces: ReadonlyArray<string>;
  /** Optional list of allowed domains for HTTP requests. If empty, all domains are allowed. */
  readonly allowedHttpDomains?: ReadonlyArray<string>;
}

/**
 * Service that provides sandbox validation for file and network operations
 */
export class SandboxService extends Context.Tag("SandboxService")<
  SandboxService,
  {
    /** Get all allowed workspace paths */
    readonly workspaces: ReadonlyArray<string>;

    /** Get the default workspace (first in list, used for shell cwd) */
    readonly defaultWorkspace: string;

    /** Get allowed HTTP domains (empty array = all allowed) */
    readonly allowedHttpDomains: ReadonlyArray<string>;

    /**
     * Resolve a relative path to an absolute path within an allowed workspace.
     * Uses the default workspace for relative paths.
     * Fails if the resolved path escapes all allowed workspaces.
     */
    readonly resolvePath: (
      relativePath: string,
    ) => Effect.Effect<string, SandboxViolationError>;

    /**
     * Validate that an absolute path is within an allowed workspace.
     * Fails if the path escapes all allowed workspaces.
     */
    readonly validatePath: (
      absolutePath: string,
    ) => Effect.Effect<string, SandboxViolationError>;

    /**
     * Validate that a URL targets an allowed domain.
     * Fails if the domain is not in the allowlist (when allowlist is non-empty).
     */
    readonly validateUrl: (url: string) => Effect.Effect<URL, DomainNotAllowedError>;
  }
>() {}

/**
 * Check if a path is a private/local IP address
 */
const isPrivateHost = (hostname: string): boolean => {
  // localhost
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }
  // Private IPv4 ranges
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number);
    const a = octets[0]!;
    const b = octets[1]!;
    // 10.x.x.x
    if (a === 10) return true;
    // 172.16.x.x - 172.31.x.x
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.x.x
    if (a === 192 && b === 168) return true;
    // 169.254.x.x (link-local)
    if (a === 169 && b === 254) return true;
  }
  return false;
};

/**
 * Check if a resolved path is within any of the allowed workspaces
 */
const isPathInWorkspaces = (
  resolved: string,
  workspaces: ReadonlyArray<string>,
): boolean => {
  return workspaces.some((workspace) => {
    const relative = path.relative(workspace, resolved);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  });
};

/**
 * Create a SandboxService layer from configuration
 */
export const makeSandboxLayer = (config: SandboxConfig): Layer.Layer<SandboxService> => {
  if (config.workspaces.length === 0) {
    throw new Error("At least one workspace path is required");
  }

  const workspaces = config.workspaces.map((p) => path.resolve(p));
  const defaultWorkspace = workspaces[0]!;
  const allowedHttpDomains = config.allowedHttpDomains ?? [];

  // Ensure all workspaces exist
  for (const workspace of workspaces) {
    if (!fs.existsSync(workspace)) {
      throw new Error(`Sandbox workspace does not exist: ${workspace}`);
    }
  }

  const resolvePath = (relativePath: string) =>
    Effect.gen(function* () {
      // Handle absolute paths directly, relative paths use default workspace
      const normalizedInput = relativePath.startsWith("/")
        ? relativePath
        : path.join(defaultWorkspace, relativePath);

      const resolved = path.resolve(normalizedInput);

      // Check that resolved path is within any allowed workspace
      if (!isPathInWorkspaces(resolved, workspaces)) {
        return yield* new SandboxViolationError({
          message: `Path escapes allowed workspaces`,
          path: relativePath,
          allowedWorkspaces: workspaces,
        });
      }

      return resolved;
    });

  const validatePath = (absolutePath: string) =>
    Effect.gen(function* () {
      const resolved = path.resolve(absolutePath);

      if (!isPathInWorkspaces(resolved, workspaces)) {
        return yield* new SandboxViolationError({
          message: `Path escapes allowed workspaces`,
          path: absolutePath,
          allowedWorkspaces: workspaces,
        });
      }

      return resolved;
    });

  const validateUrl = (urlString: string) =>
    Effect.gen(function* () {
      let url: URL;
      try {
        url = new URL(urlString);
      } catch {
        return yield* new DomainNotAllowedError({
          message: `Invalid URL: ${urlString}`,
          domain: urlString,
          allowedDomains: allowedHttpDomains,
        });
      }

      // Block private/local addresses (SSRF protection)
      if (isPrivateHost(url.hostname)) {
        return yield* new DomainNotAllowedError({
          message: `Private/local hosts are not allowed: ${url.hostname}`,
          domain: url.hostname,
          allowedDomains: allowedHttpDomains,
        });
      }

      // If allowlist is non-empty, check against it
      if (allowedHttpDomains.length > 0) {
        const isAllowed = allowedHttpDomains.some(
          (allowed) => url.hostname === allowed || url.hostname.endsWith(`.${allowed}`),
        );
        if (!isAllowed) {
          return yield* new DomainNotAllowedError({
            message: `Domain not in allowlist: ${url.hostname}`,
            domain: url.hostname,
            allowedDomains: allowedHttpDomains,
          });
        }
      }

      return url;
    });

  return Layer.succeed(SandboxService, {
    workspaces,
    defaultWorkspace,
    allowedHttpDomains,
    resolvePath,
    validatePath,
    validateUrl,
  });
};
