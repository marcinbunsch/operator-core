import { Effect, Schema, Data } from "effect";
import * as Tool from "@effect/ai/Tool";
import * as Toolkit from "@effect/ai/Toolkit";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { SandboxService } from "./SandboxService.js";

const execAsync = promisify(exec);

/**
 * Error thrown when a shell command fails
 */
export class ShellError extends Data.TaggedError("ShellError")<{
  readonly message: string;
  readonly command: string;
  readonly exitCode: number | null;
  readonly stderr: string;
}> {}

// Result schema - always returns stdout/stderr/exitCode (-1 on timeout/failure)
const ShellResult = Schema.Struct({
  stdout: Schema.String,
  stderr: Schema.String,
  exitCode: Schema.Number,
});

// Tool definition
export const Shell = Tool.make("shell", {
  description:
    "Execute a shell command in the workspace directory. Commands are executed with bash.",
  parameters: {
    command: Schema.String.annotations({
      description: "The shell command to execute",
    }),
    cwd: Schema.optional(Schema.String).annotations({
      description:
        "Working directory (relative to workspace or absolute within workspace). Defaults to workspace root.",
    }),
    timeout: Schema.optional(Schema.Number).annotations({
      description: "Timeout in milliseconds (default: 30000)",
    }),
  },
  success: ShellResult,
});

// Toolkit
export const ShellToolkit = Toolkit.make(Shell);

// Handler implementation - catches errors and returns them as success responses
export const ShellToolHandlers = ShellToolkit.toLayer(
  Effect.gen(function* () {
    const sandbox = yield* SandboxService;

    return {
      shell: ({ command, cwd, timeout }) =>
        Effect.gen(function* () {
          // Resolve working directory
          const workingDir =
            cwd !== undefined ? yield* sandbox.resolvePath(cwd) : sandbox.defaultWorkspace;

          // Validate cwd is a directory (if specified)
          if (cwd !== undefined) {
            yield* sandbox.validatePath(workingDir);
          }

          const timeoutMs = timeout ?? 30000;

          const result = yield* Effect.tryPromise({
            try: async () => {
              try {
                const { stdout, stderr } = await execAsync(command, {
                  cwd: workingDir,
                  timeout: timeoutMs,
                  shell: "/bin/bash",
                  env: {
                    ...process.env,
                    // Restrict PATH to common safe locations
                    PATH: "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
                  },
                });
                return { stdout, stderr, exitCode: 0 };
              } catch (error: unknown) {
                const execError = error as {
                  stdout?: string;
                  stderr?: string;
                  code?: number;
                  killed?: boolean;
                  signal?: string;
                };

                // Command executed but returned non-zero exit code
                if (typeof execError.code === "number") {
                  return {
                    stdout: execError.stdout ?? "",
                    stderr: execError.stderr ?? "",
                    exitCode: execError.code,
                  };
                }

                // Timeout or other execution error
                throw error;
              }
            },
            catch: (error: unknown) => {
              const execError = error as {
                message?: string;
                killed?: boolean;
                signal?: string;
                stderr?: string;
              };

              // Return error as stdout/stderr with -1 exit code
              if (execError.killed || execError.signal === "SIGTERM") {
                return {
                  stdout: "",
                  stderr: execError.stderr ?? `Command timed out after ${timeoutMs}ms`,
                  exitCode: -1,
                };
              }

              return {
                stdout: "",
                stderr:
                  execError.stderr ??
                  `Failed to execute command: ${execError.message ?? String(error)}`,
                exitCode: -1,
              };
            },
          });

          return result;
        }).pipe(
          Effect.catchAll((e) =>
            Effect.succeed({
              stdout: "",
              stderr: e instanceof Error ? e.message : String(e),
              exitCode: -1,
            }),
          ),
        ),
    };
  }),
);
