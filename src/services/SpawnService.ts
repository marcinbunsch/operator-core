import { Effect } from "effect";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { SpawnError } from "../errors.js";

/** How often to check if a PID is still alive (in milliseconds) */
const POLL_INTERVAL_MS = 3000;

/**
 * Options for spawning a detached process.
 */
export interface SpawnOptions {
  /** Working directory for the process */
  cwd: string;

  /** Environment variables to set (merged with process.env) */
  env?: Record<string, string>;

  /** Path to the log file for stdout/stderr capture */
  logPath: string;
}

/**
 * Check if a process with the given PID is still running.
 * Uses the "kill 0" trick: sending signal 0 doesn't kill the process,
 * but throws ESRCH if the process doesn't exist.
 */
const checkPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * SpawnService handles spawning and monitoring detached processes.
 *
 * This is designed for long-running external processes like Claude Code.
 * Processes are spawned "detached" (using nohup) so they survive if the
 * parent Node process exits. Output is captured to a log file.
 *
 * Key features:
 * - Spawn detached processes that survive parent exit
 * - Poll for process completion by PID
 * - Read log file tail for progress/status
 * - Extract exit code from log (appended by wrapper script)
 * - Load environment files (.env format)
 */
export class SpawnService extends Effect.Service<SpawnService>()("@operator/core/SpawnService", {
  effect: Effect.succeed({
    /**
     * Check if a process is still running.
     *
     * @param pid - Process ID to check
     * @returns true if process exists, false if terminated
     */
    isPidAlive: (pid: number): Effect.Effect<boolean> => {
      return Effect.sync(() => checkPidAlive(pid));
    },

    /**
     * Spawn a detached process that survives parent exit.
     *
     * The process is wrapped with nohup and runs in the background.
     * stdout/stderr are redirected to the log file.
     * When the process exits, its exit code is appended to the log
     * as "__EXIT_CODE__=N" for later retrieval.
     *
     * @param args - Command and arguments to run (e.g., ["claude", "--print"])
     * @param opts - Spawn options (cwd, env, logPath)
     * @returns The PID of the spawned process
     */
    spawnDetached: (args: string[], opts: SpawnOptions): Effect.Effect<number, SpawnError> => {
      return Effect.tryPromise({
        try: async () => {
          // Escape single quotes in arguments for shell safety
          const cmd = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");

          // Build environment variable prefix if env vars provided
          const envPrefix = opts.env
            ? Object.entries(opts.env)
                .map(([k, v]) => `${k}='${v.replace(/'/g, "'\\''")}'`)
                .join(" ")
            : "";

          // The actual command: cd to workdir, run command, append exit code to log
          const wrappedCmd = envPrefix
            ? `cd '${opts.cwd}' && ${envPrefix} ${cmd}; echo "__EXIT_CODE__=$?" >> '${opts.logPath}'`
            : `cd '${opts.cwd}' && ${cmd}; echo "__EXIT_CODE__=$?" >> '${opts.logPath}'`;

          // Wrap with nohup to survive parent exit, redirect output to log, run in background
          const fullCmd = `nohup sh -c '${wrappedCmd.replace(/'/g, "'\\''")}' >> '${opts.logPath}' 2>&1 & echo $!`;

          // Spawn sh to execute our wrapped command
          // The 'echo $!' at the end prints the PID which we capture from stdout
          return new Promise<number>((resolve, reject) => {
            const proc = spawn("sh", ["-c", fullCmd], {
              stdio: ["ignore", "pipe", "pipe"],
            });

            let stdout = "";
            proc.stdout.on("data", (data) => {
              stdout += data.toString();
            });

            proc.on("close", () => {
              const pid = parseInt(stdout.trim(), 10);
              if (isNaN(pid)) {
                reject(new Error(`Failed to get PID from spawn. stdout: ${stdout}`));
              } else {
                resolve(pid);
              }
            });

            proc.on("error", reject);
          });
        },
        catch: (e) => new SpawnError({ command: args.join(" "), cause: e }),
      });
    },

    /**
     * Wait for a process to terminate by polling its PID.
     * Polls every 3 seconds until the process no longer exists.
     *
     * @param pid - Process ID to wait for
     */
    waitForPid: (pid: number): Effect.Effect<void> => {
      const poll = (): Effect.Effect<void> => {
        return Effect.gen(function* () {
          const isAlive = checkPidAlive(pid);
          if (!isAlive) return;
          yield* Effect.sleep(POLL_INTERVAL_MS);
          yield* poll();
        });
      };
      return poll();
    },

    /**
     * Read the last N lines from a log file.
     * Useful for showing recent output or progress.
     *
     * @param logPath - Path to the log file
     * @param lines - Number of lines to read (default: 25)
     * @returns The last N lines, or an error message if file can't be read
     */
    readLogTail: (logPath: string, lines: number = 25): Effect.Effect<string> => {
      return Effect.try({
        try: () => {
          if (!existsSync(logPath)) return "(no log file found)";
          const content = readFileSync(logPath, "utf-8");
          return content.split("\n").slice(-lines).join("\n");
        },
        catch: () => "(could not read log file)",
      }).pipe(Effect.catchAll(() => Effect.succeed("(could not read log file)")));
    },

    /**
     * Extract the exit code from a log file.
     * Looks for "__EXIT_CODE__=N" at the end of the file,
     * which is appended by our wrapper script when the process exits.
     *
     * @param logPath - Path to the log file
     * @returns The exit code, or null if not found/readable
     */
    getExitCodeFromLog: (logPath: string): Effect.Effect<number | null> => {
      return Effect.try({
        try: () => {
          if (!existsSync(logPath)) return null;
          const content = readFileSync(logPath, "utf-8");
          const match = content.match(/\n__EXIT_CODE__=(\d+)\n?$/);
          return match && match[1] ? parseInt(match[1], 10) : null;
        },
        catch: () => null,
      }).pipe(Effect.catchAll(() => Effect.succeed(null)));
    },

    /**
     * Load environment variables from a .env file.
     * Parses KEY=VALUE format, ignoring comments (#) and blank lines.
     *
     * @param filePath - Path to the .env file
     * @returns Object with key-value pairs, or empty object if file missing/invalid
     */
    loadEnvFile: (filePath: string): Effect.Effect<Record<string, string>> => {
      return Effect.try({
        try: () => {
          const env: Record<string, string> = {};
          if (!existsSync(filePath)) return env;

          const content = readFileSync(filePath, "utf-8");
          for (const line of content.split("\n")) {
            const trimmed = line.trim();
            // Skip empty lines and comments
            if (trimmed && !trimmed.startsWith("#")) {
              const eqIndex = trimmed.indexOf("=");
              if (eqIndex > 0) {
                const key = trimmed.slice(0, eqIndex);
                const value = trimmed.slice(eqIndex + 1);
                env[key] = value;
              }
            }
          }
          return env;
        },
        catch: () => ({}),
      }).pipe(Effect.catchAll(() => Effect.succeed({})));
    },
  }),
}) {}
