import { it, describe, beforeEach, afterEach } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlinkSync, existsSync, mkdirSync } from "node:fs";
import { JobQueueService } from "./JobQueueService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = join(__dirname, "..", "..", "tmp");

// Ensure tmp dir exists
beforeEach(() => {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }
});

describe("JobQueueService.enqueue", () => {
  const jobsFile = join(TMP_DIR, "test-jobs.json");

  afterEach(() => {
    if (existsSync(jobsFile)) {
      unlinkSync(jobsFile);
    }
  });

  it.effect("creates a job with queued status", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* JobQueueService;
        yield* queue.configure(jobsFile);

        const job = yield* queue.enqueue("test-type", "/tmp", { key: "value" });

        expect(job.id).toBeDefined();
        expect(job.type).toBe("test-type");
        expect(job.status).toBe("queued");
        expect(job.workingDir).toBe("/tmp");
        expect(job.payload).toEqual({ key: "value" });
        expect(job.metadata).toEqual({});
      }),
    ).pipe(Effect.provide(JobQueueService.Default)),
  );

  it.effect("assigns unique IDs to jobs", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* JobQueueService;
        yield* queue.configure(jobsFile);

        const job1 = yield* queue.enqueue("test", "/tmp", {});
        const job2 = yield* queue.enqueue("test", "/tmp", {});

        expect(job1.id).not.toBe(job2.id);
      }),
    ).pipe(Effect.provide(JobQueueService.Default)),
  );
});

describe("JobQueueService.getJob", () => {
  const jobsFile = join(TMP_DIR, "test-jobs-get.json");

  afterEach(() => {
    if (existsSync(jobsFile)) {
      unlinkSync(jobsFile);
    }
  });

  it.effect("returns job by ID", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* JobQueueService;
        yield* queue.configure(jobsFile);

        const created = yield* queue.enqueue("test", "/tmp", { foo: "bar" });
        const retrieved = yield* queue.getJob(created.id);

        expect(retrieved.id).toBe(created.id);
        expect(retrieved.payload).toEqual({ foo: "bar" });
      }),
    ).pipe(Effect.provide(JobQueueService.Default)),
  );

  it.effect("fails with JobNotFoundError for unknown ID", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* JobQueueService;
        yield* queue.configure(jobsFile);

        const result = yield* queue.getJob("nonexistent-id").pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
      }),
    ).pipe(Effect.provide(JobQueueService.Default)),
  );
});

describe("JobQueueService.updateMetadata", () => {
  const jobsFile = join(TMP_DIR, "test-jobs-meta.json");

  afterEach(() => {
    if (existsSync(jobsFile)) {
      unlinkSync(jobsFile);
    }
  });

  it.effect("updates job metadata", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* JobQueueService;
        yield* queue.configure(jobsFile);

        const job = yield* queue.enqueue("test", "/tmp", {});
        yield* queue.updateMetadata(job.id, { pid: 12345, progress: "50%" });

        const updated = yield* queue.getJob(job.id);
        expect(updated.metadata).toEqual({ pid: 12345, progress: "50%" });
      }),
    ).pipe(Effect.provide(JobQueueService.Default)),
  );

  it.effect("merges with existing metadata", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* JobQueueService;
        yield* queue.configure(jobsFile);

        const job = yield* queue.enqueue("test", "/tmp", {});
        yield* queue.updateMetadata(job.id, { a: 1 });
        yield* queue.updateMetadata(job.id, { b: 2 });

        const updated = yield* queue.getJob(job.id);
        expect(updated.metadata).toEqual({ a: 1, b: 2 });
      }),
    ).pipe(Effect.provide(JobQueueService.Default)),
  );
});

describe("JobQueueService.completeJob", () => {
  const jobsFile = join(TMP_DIR, "test-jobs-complete.json");

  afterEach(() => {
    if (existsSync(jobsFile)) {
      unlinkSync(jobsFile);
    }
  });

  it.effect("marks job as done", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* JobQueueService;
        yield* queue.configure(jobsFile);

        const job = yield* queue.enqueue("test", "/tmp", {});
        yield* queue.completeJob(job.id, "done");

        const completed = yield* queue.getJob(job.id);
        expect(completed.status).toBe("done");
        expect(completed.endedAt).toBeDefined();
      }),
    ).pipe(Effect.provide(JobQueueService.Default)),
  );

  it.effect("marks job as failed with error", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* JobQueueService;
        yield* queue.configure(jobsFile);

        const job = yield* queue.enqueue("test", "/tmp", {});
        yield* queue.completeJob(job.id, "failed", "Something went wrong");

        const completed = yield* queue.getJob(job.id);
        expect(completed.status).toBe("failed");
        expect(completed.error).toBe("Something went wrong");
      }),
    ).pipe(Effect.provide(JobQueueService.Default)),
  );
});

describe("JobQueueService.getJobs", () => {
  const jobsFile = join(TMP_DIR, "test-jobs-list.json");

  afterEach(() => {
    if (existsSync(jobsFile)) {
      unlinkSync(jobsFile);
    }
  });

  it.effect("returns all jobs", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* JobQueueService;
        yield* queue.configure(jobsFile);

        yield* queue.enqueue("type-a", "/tmp", {});
        yield* queue.enqueue("type-b", "/tmp", {});
        yield* queue.enqueue("type-a", "/tmp", {});

        const jobs = yield* queue.getJobs();
        expect(jobs.length).toBe(3);
      }),
    ).pipe(Effect.provide(JobQueueService.Default)),
  );
});

describe("JobQueueService.registerRunner", () => {
  const jobsFile = join(TMP_DIR, "test-jobs-runner.json");

  afterEach(() => {
    if (existsSync(jobsFile)) {
      unlinkSync(jobsFile);
    }
  });

  it.effect("registers runner without error", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* JobQueueService;
        yield* queue.configure(jobsFile);

        // Should not throw
        yield* queue.registerRunner("test-runner", 2, () => Effect.void);
      }),
    ).pipe(Effect.provide(JobQueueService.Default)),
  );
});
