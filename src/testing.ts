/**
 * @operator/core/testing - Test utilities for mocking core services
 *
 * Import from "@operator/core/testing" in test files only.
 * These utilities are NOT included in production builds.
 */

import { Effect, Layer } from "effect";
import {
  JobQueueService,
  type Job,
  type RunnerFn,
  type ReconnectFn,
} from "./services/JobQueueService.js";

// Re-export Job type for test files
export type { Job };
import { SpawnService, type SpawnOptions } from "./services/SpawnService.js";

// ============================================================================
// Mock Job Factory
// ============================================================================

/**
 * Create a mock Job object with sensible defaults.
 * Override any field by passing it in the overrides object.
 */
export const createMockJob = (overrides: Partial<Job> & { id: string; type: string }): Job => ({
  status: "queued",
  createdAt: new Date().toISOString(),
  workingDir: "/tmp",
  payload: {} as Record<string, string>,
  metadata: {} as Record<string, unknown>,
  ...overrides,
});

// ============================================================================
// JobQueueService Mock
// ============================================================================

export interface MockJobQueueServiceOptions {
  /** Jobs to return from getJobs() */
  jobs?: Job[];
  /** Callback when updateMetadata is called */
  onUpdateMetadata?: (jobId: string, metadata: Record<string, unknown>) => void;
  /** Callback when enqueue is called */
  onEnqueue?: (type: string, workingDir: string, payload: Record<string, string>) => void;
  /** Callback when completeJob is called */
  onCompleteJob?: (jobId: string, status: "done" | "failed") => void;
  /** Callback when registerRunner is called */
  onRegisterRunner?: (type: string, concurrency: number) => void;
}

/**
 * Create a mock JobQueueService Layer for testing.
 *
 * @example
 * ```typescript
 * const layer = makeMockJobQueueService({
 *   jobs: [createMockJob({ id: "1", type: "test" })],
 *   onUpdateMetadata: (id, meta) => console.log(id, meta),
 * });
 *
 * Effect.gen(function* () {
 *   const queue = yield* JobQueueService;
 *   const jobs = yield* queue.getJobs();
 * }).pipe(Effect.provide(layer));
 * ```
 */
export const makeMockJobQueueService = (
  options: MockJobQueueServiceOptions = {},
): Layer.Layer<JobQueueService> => {
  const { jobs = [], onUpdateMetadata, onEnqueue, onCompleteJob, onRegisterRunner } = options;

  let enqueuedJobs: Job[] = [];

  return Layer.succeed(JobQueueService, {
    configure: () => Effect.void,
    registerRunner: (
      type: string,
      concurrency: number,
      _runner: RunnerFn,
      _reconnect?: ReconnectFn,
    ) => {
      onRegisterRunner?.(type, concurrency);
      return Effect.void;
    },
    enqueue: (type: string, workingDir: string, payload: Record<string, string>) => {
      const job = createMockJob({
        id: crypto.randomUUID(),
        type,
        workingDir,
        payload,
      });
      enqueuedJobs.push(job);
      onEnqueue?.(type, workingDir, payload);
      return Effect.succeed(job);
    },
    getJob: (jobId: string) => {
      const job = [...jobs, ...enqueuedJobs].find((j) => j.id === jobId);
      return Effect.succeed(job ?? null);
    },
    updateMetadata: (jobId: string, metadata: Record<string, unknown>) => {
      onUpdateMetadata?.(jobId, metadata);
      return Effect.void;
    },
    completeJob: (jobId: string, status: "done" | "failed") => {
      onCompleteJob?.(jobId, status);
      return Effect.void;
    },
    getJobs: () => Effect.succeed([...jobs, ...enqueuedJobs]),
    reconnectRunningJobs: () => Effect.void,
    tick: () => Effect.void,
  } as unknown as JobQueueService);
};

// ============================================================================
// SpawnService Mock
// ============================================================================

export interface MockSpawnServiceOptions {
  /** PID to return from spawnDetached */
  pid?: number;
  /** Whether isPidAlive returns true */
  pidAlive?: boolean;
  /** Exit code to return from getExitCodeFromLog */
  exitCode?: number | null;
  /** Function to determine exit code based on log path and call count */
  getExitCodeFromLog?: (logPath: string) => number | null;
  /** Log tail to return from readLogTail */
  logTail?: string;
  /** Env vars to return from loadEnvFile */
  envVars?: Record<string, string>;
  /** Callback when spawnDetached is called */
  onSpawn?: (args: string[], options: SpawnOptions) => void;
  /** Callback when waitForPid is called */
  onWaitForPid?: (pid: number) => void;
}

/**
 * Create a mock SpawnService Layer for testing.
 *
 * @example
 * ```typescript
 * const layer = makeMockSpawnService({
 *   pid: 12345,
 *   exitCode: 0,
 *   onSpawn: (args) => console.log("Spawned:", args),
 * });
 *
 * Effect.gen(function* () {
 *   const spawn = yield* SpawnService;
 *   const pid = yield* spawn.spawnDetached(["node", "script.js"], { cwd: "/tmp" });
 * }).pipe(Effect.provide(layer));
 * ```
 */
export const makeMockSpawnService = (
  options: MockSpawnServiceOptions = {},
): Layer.Layer<SpawnService> => {
  const {
    pid = 12345,
    pidAlive = false,
    exitCode = 0,
    getExitCodeFromLog,
    logTail = "mock log output",
    envVars = {},
    onSpawn,
    onWaitForPid,
  } = options;

  const callCounts: Record<string, number> = {};

  return Layer.succeed(SpawnService, {
    isPidAlive: (_pid: number) => Effect.succeed(pidAlive),
    spawnDetached: (args: string[], spawnOptions: SpawnOptions) => {
      onSpawn?.(args, spawnOptions);
      return Effect.succeed(pid);
    },
    waitForPid: (waitPid: number) => {
      onWaitForPid?.(waitPid);
      return Effect.void;
    },
    readLogTail: () => Effect.succeed(logTail),
    getExitCodeFromLog: (logPath: string) => {
      if (getExitCodeFromLog) {
        callCounts[logPath] = (callCounts[logPath] ?? 0) + 1;
        return Effect.succeed(getExitCodeFromLog(logPath));
      }
      return Effect.succeed(exitCode);
    },
    loadEnvFile: () => Effect.succeed(envVars),
  } as unknown as SpawnService);
};
