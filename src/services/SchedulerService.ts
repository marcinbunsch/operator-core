import { Effect, Ref, Schedule as EffectSchedule } from "effect";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import cronParser from "cron-parser";

export type ScheduleType = "once" | "recurring";
export type ScheduleStatus = "active" | "paused" | "completed" | "failed";

export interface Schedule {
  /** Unique identifier (UUID) */
  id: string;

  /** Human-readable name for the schedule */
  name: string;

  /** Schedule type: one-time or recurring */
  type: ScheduleType;

  /** Current status */
  status: ScheduleStatus;

  /** Cron expression (e.g., "0 9 * * *" for 9am daily) */
  cronExpression: string;

  /** The prompt to execute when the schedule fires */
  prompt: string;

  /** Target channel/room ID for context (platform-agnostic) */
  channelId: string;

  /** ISO timestamp when schedule was created */
  createdAt: string;

  /** ISO timestamp of last execution */
  lastRunAt: string | undefined;

  /** ISO timestamp of next scheduled run (computed from cron) */
  nextRunAt: string | undefined;

  /** For one-time schedules: ISO timestamp when it should fire */
  scheduledFor: string | undefined;

  /** Error message from last failed execution */
  lastError: string | undefined;
}

const LOG_PREFIX = "[scheduler]";
const log = (...args: unknown[]) => Effect.log(`${LOG_PREFIX} ${args.join(" ")}`);

/** Compute next run time from cron expression */
const computeNextRun = (cronExpression: string): string | undefined => {
  try {
    const interval = cronParser.parseExpression(cronExpression);
    return interval.next().toISOString();
  } catch {
    return undefined;
  }
};

export class SchedulerService extends Effect.Service<SchedulerService>()(
  "@operator/core/SchedulerService",
  {
    scoped: Effect.gen(function* () {
      // In-memory schedule list - source of truth, synced to disk
      const schedulesRef = yield* Ref.make<Schedule[]>([]);

      // Path to schedules file
      const schedulesFileRef = yield* Ref.make<string | null>(null);

      // Callback to execute scheduled tasks (injected during configure)
      // This is a sync callback - the caller should use runtime.runFork internally
      const executeCallbackRef = yield* Ref.make<((schedule: Schedule) => void) | null>(null);

      const loadFromDisk = Effect.gen(function* () {
        const schedulesFile = yield* Ref.get(schedulesFileRef);
        if (!schedulesFile) return;

        if (existsSync(schedulesFile)) {
          const data = JSON.parse(readFileSync(schedulesFile, "utf-8"));
          const schedules = (data.schedules || []) as Schedule[];
          yield* Ref.set(schedulesRef, schedules);
          yield* log(`Loaded ${schedules.length} schedules from disk`);
        }
      });

      const saveToDisk = Effect.gen(function* () {
        const schedulesFile = yield* Ref.get(schedulesFileRef);
        if (!schedulesFile) return;

        // Ensure directory exists
        const dir = dirname(schedulesFile);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        const schedules = yield* Ref.get(schedulesRef);
        writeFileSync(schedulesFile, JSON.stringify({ schedules }, null, 2));
      });

      // The ticker: checks for schedules due to run
      const tick = Effect.gen(function* () {
        const schedules = yield* Ref.get(schedulesRef);
        const executeCallback = yield* Ref.get(executeCallbackRef);
        if (!executeCallback) return;

        const now = new Date();

        for (const schedule of schedules) {
          if (schedule.status !== "active") continue;

          const shouldRun =
            (schedule.type === "once" &&
              schedule.scheduledFor &&
              new Date(schedule.scheduledFor) <= now) ||
            (schedule.type === "recurring" &&
              schedule.nextRunAt &&
              new Date(schedule.nextRunAt) <= now);

          if (shouldRun) {
            yield* log(`Triggering schedule ${schedule.id.slice(0, 8)} (${schedule.name})`);

            // Call the callback synchronously (it should use runtime.runFork internally)
            executeCallback(schedule);

            // Update schedule status
            yield* Ref.update(schedulesRef, (schedules) =>
              schedules.map((s) => {
                if (s.id !== schedule.id) return s;
                if (s.type === "once") {
                  return {
                    ...s,
                    status: "completed" as const,
                    lastRunAt: now.toISOString(),
                  };
                }
                return {
                  ...s,
                  lastRunAt: now.toISOString(),
                  nextRunAt: computeNextRun(s.cronExpression),
                };
              }),
            );
            yield* saveToDisk;
          }
        }
      });

      // Start background ticker (every 30 seconds)
      yield* Effect.forkScoped(
        tick.pipe(
          Effect.repeat(EffectSchedule.fixed("30 seconds")),
          Effect.catchAll((e) => Effect.log(`Tick error: ${e}`)),
        ),
      );

      yield* log("SchedulerService initialized with background ticker");

      return {
        configure: (
          schedulesFile: string,
          executeCallback: (schedule: Schedule) => void,
        ): Effect.Effect<void> =>
          Effect.gen(function* () {
            yield* Ref.set(schedulesFileRef, schedulesFile);
            yield* Ref.set(executeCallbackRef, executeCallback);
            yield* loadFromDisk;
          }),

        createSchedule: (params: {
          name: string;
          type: ScheduleType;
          cronExpression: string;
          prompt: string;
          channelId: string;
          scheduledFor: string | undefined;
        }): Effect.Effect<Schedule> =>
          Effect.gen(function* () {
            const schedule: Schedule = {
              id: crypto.randomUUID(),
              name: params.name,
              type: params.type,
              status: "active",
              cronExpression: params.cronExpression,
              prompt: params.prompt,
              channelId: params.channelId,
              createdAt: new Date().toISOString(),
              lastRunAt: undefined,
              nextRunAt:
                params.type === "recurring" ? computeNextRun(params.cronExpression) : undefined,
              scheduledFor: params.scheduledFor,
              lastError: undefined,
            };
            yield* Ref.update(schedulesRef, (schedules) => [...schedules, schedule]);
            yield* saveToDisk;
            yield* log(`Created schedule ${schedule.id.slice(0, 8)} (${schedule.name})`);
            return schedule;
          }),

        listSchedules: (channelId?: string): Effect.Effect<readonly Schedule[]> =>
          Effect.gen(function* () {
            const schedules = yield* Ref.get(schedulesRef);
            return channelId ? schedules.filter((s) => s.channelId === channelId) : schedules;
          }),

        getSchedule: (scheduleId: string): Effect.Effect<Schedule | undefined> =>
          Effect.gen(function* () {
            const schedules = yield* Ref.get(schedulesRef);
            return schedules.find((s) => s.id === scheduleId);
          }),

        deleteSchedule: (scheduleId: string): Effect.Effect<boolean> =>
          Effect.gen(function* () {
            const schedules = yield* Ref.get(schedulesRef);
            const exists = schedules.some((s) => s.id === scheduleId);
            if (exists) {
              yield* Ref.update(schedulesRef, (schedules) =>
                schedules.filter((s) => s.id !== scheduleId),
              );
              yield* saveToDisk;
              yield* log(`Deleted schedule ${scheduleId.slice(0, 8)}`);
            }
            return exists;
          }),

        pauseSchedule: (scheduleId: string): Effect.Effect<boolean> =>
          Effect.gen(function* () {
            const schedules = yield* Ref.get(schedulesRef);
            const exists = schedules.some((s) => s.id === scheduleId);
            if (exists) {
              yield* Ref.update(schedulesRef, (schedules) =>
                schedules.map((s) =>
                  s.id === scheduleId ? { ...s, status: "paused" as const } : s,
                ),
              );
              yield* saveToDisk;
            }
            return exists;
          }),

        resumeSchedule: (scheduleId: string): Effect.Effect<boolean> =>
          Effect.gen(function* () {
            const schedules = yield* Ref.get(schedulesRef);
            const exists = schedules.some((s) => s.id === scheduleId);
            if (exists) {
              yield* Ref.update(schedulesRef, (schedules) =>
                schedules.map((s) => {
                  if (s.id !== scheduleId) return s;
                  return {
                    ...s,
                    status: "active" as const,
                    nextRunAt:
                      s.type === "recurring" ? computeNextRun(s.cronExpression) : undefined,
                  };
                }),
              );
              yield* saveToDisk;
            }
            return exists;
          }),

        // Force trigger for testing
        triggerNow: (scheduleId: string): Effect.Effect<void> =>
          Effect.gen(function* () {
            const executeCallback = yield* Ref.get(executeCallbackRef);
            const schedules = yield* Ref.get(schedulesRef);
            const schedule = schedules.find((s) => s.id === scheduleId);
            if (schedule && executeCallback) {
              executeCallback(schedule);
            }
          }),
      };
    }),
  },
) {}
