import { Effect, Ref, Schedule } from "effect";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { JobNotFoundError } from "../errors.js";

/**
 * Lifecycle states for a job.
 * - queued: Waiting to be picked up by the background ticker
 * - running: Currently being executed by a runner
 * - done: Completed successfully
 * - failed: Completed with an error
 */
export type JobStatus = "queued" | "running" | "done" | "failed";

/**
 * A job represents a unit of async work managed by the queue.
 *
 * Jobs are persisted to disk, so they survive server restarts.
 * The queue follows an "async by design" pattern: callers enqueue work
 * and get notified when it completes, rather than waiting synchronously.
 */
export interface Job {
  /** Unique identifier (UUID) */
  id: string;

  /** Job type - used to match with registered runners */
  type: string;

  /** Current lifecycle state */
  status: JobStatus;

  /** ISO timestamp when job was created */
  createdAt: string;

  /** ISO timestamp when job started running (set by queue) */
  startedAt?: string;

  /** ISO timestamp when job finished (done or failed) */
  endedAt?: string;

  /** Directory where the job should execute */
  workingDir: string;

  /**
   * Immutable data provided at creation time.
   * Use this for configuration, user info, or any data the runner needs.
   * This is never modified after creation.
   */
  payload: Record<string, string>;

  /**
   * Mutable runtime data updated during execution.
   * Use this for PID, log file paths, progress info, etc.
   * Runners can update this via updateMetadata().
   */
  metadata: Record<string, unknown>;

  /** Error message if job failed */
  error?: string;
}

/**
 * Function signature for job runners.
 * Receives the job and should perform the work.
 * Throwing or returning Effect.fail marks the job as failed.
 */
export type RunnerFn = (job: Job) => Effect.Effect<void, unknown>;

/**
 * Function signature for reconnecting to a running job after server restart.
 * Called when the server starts and finds jobs that were running.
 * Use this to reattach to external processes (e.g., by PID in metadata).
 */
export type ReconnectFn = (job: Job) => Effect.Effect<void, unknown>;

interface Runner {
  fn: RunnerFn;
  reconnectFn?: ReconnectFn;
  concurrencyLimit: number;
}

const LOG_PREFIX = "[queue]";
const log = (...args: unknown[]) => Effect.log(`${LOG_PREFIX} ${args.join(" ")}`);

/**
 * JobQueueService manages async background jobs with persistence.
 *
 * Key design decisions:
 * - Jobs are persisted to a JSON file for durability across restarts
 * - Each job type has its own runner with a configurable concurrency limit
 * - A background ticker polls every 2 seconds to start queued jobs
 * - Jobs can optionally provide a reconnect function to resume after restarts
 *
 * Usage:
 * 1. Call configure() with a file path to enable persistence
 * 2. Register runners for each job type with registerRunner()
 * 3. Call reconnectRunningJobs() to handle jobs from previous runs
 * 4. Enqueue jobs with enqueue() - they'll be picked up by the ticker
 */
export class JobQueueService extends Effect.Service<JobQueueService>()(
  "@operator/core/JobQueueService",
  {
    scoped: Effect.gen(function* () {
      // In-memory job list - source of truth, synced to disk
      const jobsRef = yield* Ref.make<Job[]>([]);

      // Registered runners by job type
      const runnersRef = yield* Ref.make<Map<string, Runner>>(new Map());

      // Path to jobs file (null = no persistence)
      const jobsFileRef = yield* Ref.make<string | null>(null);

      /**
       * Load jobs from the configured file path.
       * Called during configure() to restore state from disk.
       */
      const loadFromDisk = Effect.gen(function* () {
        const jobsFile = yield* Ref.get(jobsFileRef);
        if (!jobsFile) return;

        if (existsSync(jobsFile)) {
          const data = JSON.parse(readFileSync(jobsFile, "utf-8"));
          const jobs = (data.jobs || []) as Job[];

          // Migration: ensure all jobs have metadata field (older format may lack it)
          for (const job of jobs) {
            if (!job.metadata) {
              job.metadata = {};
            }
          }

          yield* Ref.set(jobsRef, jobs);
          yield* log(`Loaded ${jobs.length} jobs from disk`);
        }
      });

      /**
       * Persist current job state to disk.
       * Called after any mutation to ensure durability.
       */
      const saveToDisk = Effect.gen(function* () {
        const jobsFile = yield* Ref.get(jobsFileRef);
        if (!jobsFile) return;

        const jobs = yield* Ref.get(jobsRef);
        writeFileSync(jobsFile, JSON.stringify({ jobs }, null, 2));
      });

      /**
       * Helper to update a job in the Ref by ID.
       * This ensures we always update the current object, not an orphaned reference.
       */
      const updateJob = (
        jobId: string,
        updater: (job: Job) => Partial<Job>,
      ): Effect.Effect<void> =>
        Ref.update(jobsRef, (jobs) =>
          jobs.map((j) => (j.id === jobId ? { ...j, ...updater(j) } : j)),
        );

      /**
       * Execute a job using its runner function.
       * Updates job status and timestamps, handles success/failure.
       *
       * IMPORTANT: Uses Ref.update instead of direct mutation because runners
       * may call updateMetadata(), which creates new objects in the Ref.
       * Direct mutation would orphan the job reference and lose status updates.
       */
      const runJob = (job: Job, runnerFn: RunnerFn): Effect.Effect<void> =>
        Effect.gen(function* () {
          const jobId = job.id;
          yield* log(`Starting job ${jobId.slice(0, 8)} (${job.type})`);
          yield* updateJob(jobId, () => ({
            status: "running",
            startedAt: new Date().toISOString(),
          }));
          yield* saveToDisk;

          yield* runnerFn(job).pipe(
            Effect.tap(() =>
              Effect.gen(function* () {
                yield* updateJob(jobId, () => ({ status: "done" }));
                yield* log(`Job ${jobId.slice(0, 8)} completed successfully`);
              }),
            ),
            Effect.catchAll((err) =>
              Effect.gen(function* () {
                yield* updateJob(jobId, () => ({
                  status: "failed",
                  error: err instanceof Error ? err.message : String(err),
                }));
                yield* log(`Job ${jobId.slice(0, 8)} failed:`, err);
              }),
            ),
          );

          yield* updateJob(jobId, () => ({ endedAt: new Date().toISOString() }));
          yield* saveToDisk;
        });

      /**
       * The ticker: checks for queued jobs and starts them up to concurrency limit.
       * Runs every 2 seconds in the background.
       */
      const tick = Effect.gen(function* () {
        const runners = yield* Ref.get(runnersRef);
        const jobs = yield* Ref.get(jobsRef);

        for (const [type, runner] of runners) {
          const runningCount = jobs.filter((j) => j.type === type && j.status === "running").length;
          const availableSlots = runner.concurrencyLimit - runningCount;

          if (availableSlots <= 0) continue;

          const queuedJobs = jobs.filter((j) => j.type === type && j.status === "queued");
          const jobsToStart = queuedJobs.slice(0, availableSlots);

          for (const job of jobsToStart) {
            // forkDaemon creates a fiber that outlives its parent scope.
            // This is intentional: we want jobs to keep running even if the
            // ticker or calling code completes. The job fiber is "detached"
            // and will run until the job finishes or the entire runtime exits.
            // Using regular fork() would tie the job's lifecycle to the ticker,
            // which would cancel jobs when the ticker iteration completes.
            yield* Effect.forkDaemon(
              runJob(job, runner.fn).pipe(
                Effect.catchAllCause((cause) => {
                  return log(`Job ${job.id.slice(0, 8)} fiber died:`, cause);
                }),
              ),
            );
          }
        }
      });

      // Start the background ticker as a scoped fiber.
      // forkScoped ties the ticker's lifecycle to the service scope -
      // when the service is torn down, the ticker stops automatically.
      yield* Effect.forkScoped(
        tick.pipe(
          Effect.repeat(Schedule.fixed("2 seconds")),
          Effect.catchAll((e) => Effect.log(`Tick error: ${e}`)),
        ),
      );

      yield* log("JobQueueService initialized with background ticker");

      return {
        /**
         * Configure the jobs file path and load existing jobs.
         * Must be called before the queue will persist jobs.
         *
         * @param jobsFile - Absolute path to the jobs JSON file
         */
        configure: (jobsFile: string): Effect.Effect<void> =>
          Effect.gen(function* () {
            yield* Ref.set(jobsFileRef, jobsFile);
            yield* loadFromDisk;
          }),

        /**
         * Register a runner for a specific job type.
         *
         * @param type - Job type identifier (e.g., "claude-code", "build")
         * @param concurrencyLimit - Max concurrent jobs of this type
         * @param fn - Function to execute when a job of this type is started
         * @param reconnectFn - Optional function to reconnect to jobs running from a previous server instance
         */
        registerRunner: (
          type: string,
          concurrencyLimit: number,
          fn: RunnerFn,
          reconnectFn?: ReconnectFn,
        ): Effect.Effect<void> =>
          Ref.update(runnersRef, (runners) => {
            const runner: Runner = { fn, concurrencyLimit };
            if (reconnectFn) runner.reconnectFn = reconnectFn;
            runners.set(type, runner);
            return runners;
          }),

        /**
         * Add a new job to the queue.
         * The job will be picked up by the next ticker cycle (within 2 seconds).
         * Also triggers an immediate tick to potentially start the job right away.
         *
         * @param type - Job type (must have a registered runner)
         * @param workingDir - Directory for job execution
         * @param payload - Immutable data for the job (config, user info, etc.)
         * @returns The created job with its assigned ID
         */
        enqueue: (
          type: string,
          workingDir: string,
          payload: Record<string, string>,
        ): Effect.Effect<Job> =>
          Effect.gen(function* () {
            const job: Job = {
              id: crypto.randomUUID(),
              type,
              status: "queued",
              createdAt: new Date().toISOString(),
              workingDir,
              payload,
              metadata: {},
            };
            yield* Ref.update(jobsRef, (jobs) => [...jobs, job]);
            yield* saveToDisk;
            yield* tick; // Try to start immediately instead of waiting for next tick
            return job;
          }),

        /**
         * Get a job by its ID.
         *
         * @param jobId - The job's UUID
         * @returns The job, or fails with JobNotFoundError
         */
        getJob: (jobId: string): Effect.Effect<Job, JobNotFoundError> =>
          Effect.gen(function* () {
            const jobs = yield* Ref.get(jobsRef);
            const job = jobs.find((j) => j.id === jobId);
            if (!job) {
              return yield* Effect.fail(new JobNotFoundError({ jobId }));
            }
            return job;
          }),

        /**
         * Update a job's mutable metadata.
         * Use this during job execution to track progress, PIDs, log paths, etc.
         *
         * @param jobId - The job's UUID
         * @param metadata - Key-value pairs to merge into existing metadata
         */
        updateMetadata: (jobId: string, metadata: Record<string, unknown>): Effect.Effect<void> =>
          Effect.gen(function* () {
            yield* Ref.update(jobsRef, (jobs) =>
              jobs.map((j) =>
                j.id === jobId ? { ...j, metadata: { ...j.metadata, ...metadata } } : j,
              ),
            );
            yield* saveToDisk;
          }),

        /**
         * Mark a job as completed (done or failed).
         * Use this for external processes that report completion asynchronously.
         *
         * @param jobId - The job's UUID
         * @param status - Final status ("done" or "failed")
         * @param error - Optional error message if failed
         */
        completeJob: (
          jobId: string,
          status: "done" | "failed",
          error?: string,
        ): Effect.Effect<void> =>
          Effect.gen(function* () {
            yield* Ref.update(jobsRef, (jobs) =>
              jobs.map((j) => {
                if (j.id !== jobId) return j;
                const updated: Job = {
                  ...j,
                  status,
                  endedAt: new Date().toISOString(),
                };
                if (error) updated.error = error;
                else if (j.error) updated.error = j.error;
                return updated;
              }),
            );
            yield* saveToDisk;
            yield* log(`Job ${jobId.slice(0, 8)} ${status}${error ? ": " + error : ""}`);
          }),

        /**
         * Get all jobs in the queue (all statuses).
         * Useful for admin dashboards or debugging.
         */
        getJobs: (): Effect.Effect<readonly Job[]> => Ref.get(jobsRef),

        /**
         * Reconnect to jobs that were running when the server last shut down.
         * Call this during server startup, after registering runners.
         *
         * For each running job:
         * - If the runner has a reconnectFn, call it to reattach (e.g., to a process by PID)
         * - If no reconnectFn, reset the job to "queued" so it gets retried
         */
        reconnectRunningJobs: (): Effect.Effect<void> =>
          Effect.gen(function* () {
            const jobs = yield* Ref.get(jobsRef);
            const runners = yield* Ref.get(runnersRef);

            for (const job of jobs) {
              if (job.status === "running") {
                const runner = runners.get(job.type);
                if (runner?.reconnectFn) {
                  yield* log(`Reconnecting to running job ${job.id.slice(0, 8)} (${job.type})`);
                  yield* Effect.fork(
                    runner.reconnectFn(job).pipe(
                      Effect.catchAll((err) =>
                        Effect.gen(function* () {
                          yield* log(`Reconnect failed for job ${job.id.slice(0, 8)}:`, err);
                          yield* Ref.update(jobsRef, (jobs) =>
                            jobs.map((j) => {
                              if (j.id !== job.id) return j;
                              return {
                                ...j,
                                status: "failed" as const,
                                error: err instanceof Error ? err.message : String(err),
                                endedAt: new Date().toISOString(),
                              };
                            }),
                          );
                          yield* saveToDisk;
                        }),
                      ),
                    ),
                  );
                } else {
                  // No reconnect function - the safest thing is to retry the job.
                  // Reset to queued so the ticker picks it up again.
                  yield* log(
                    `No reconnect for job ${job.id.slice(0, 8)} (${job.type}), resetting to queued`,
                  );
                  yield* Ref.update(jobsRef, (jobs) =>
                    jobs.map((j) => {
                      if (j.id !== job.id) return j;
                      // Remove startedAt since we're resetting to queued
                      const { startedAt: _, ...rest } = j;
                      return { ...rest, status: "queued" as const };
                    }),
                  );
                  yield* saveToDisk;
                }
              }
            }
          }),

        /**
         * Manually trigger a tick cycle.
         * Normally you don't need this - the background ticker runs every 2 seconds.
         * Used internally by enqueue() to start jobs immediately.
         */
        tick: (): Effect.Effect<void> => tick,
      };
    }),
  },
) {}
