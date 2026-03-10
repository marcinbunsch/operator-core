import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "../../ai/index.js";
import { SchedulerService } from "../../services/SchedulerService.js";

// Schema definitions
const ScheduleResult = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.Literal("once", "recurring"),
  status: Schema.Literal("active", "paused", "completed", "failed"),
  cronExpression: Schema.String,
  prompt: Schema.String,
  channelId: Schema.String,
  nextRunAt: Schema.optional(Schema.String),
  lastRunAt: Schema.optional(Schema.String),
  scheduledFor: Schema.optional(Schema.String),
});

const ScheduleListResult = Schema.Struct({
  schedules: Schema.Array(ScheduleResult),
  count: Schema.Number,
});

const OperationResult = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
});

// Tools
export const ScheduleTask = Tool.make("schedule_task", {
  description: `Schedule a task to run at a specific time or on a recurring basis.
The cron_expression uses standard cron format: minute hour day month weekday.
Examples:
- "0 9 * * *" = every day at 9:00 AM
- "0 14 * * 1" = every Monday at 2:00 PM
- "30 8 * * 1-5" = weekdays at 8:30 AM
- "0 */2 * * *" = every 2 hours
- "0 0 1 * *" = first day of every month at midnight

For one-time schedules, set type to "once" and provide scheduled_for as an ISO8601 timestamp.`,
  parameters: {
    name: Schema.String.annotations({
      description: "Human-readable name for this schedule",
    }),
    type: Schema.Literal("once", "recurring").annotations({
      description: "Whether this runs once or repeats",
    }),
    cron_expression: Schema.String.annotations({
      description:
        "Cron expression (minute hour day month weekday). For one-time schedules, use '* * * * *' as placeholder.",
    }),
    prompt: Schema.String.annotations({
      description:
        "The prompt/task to execute when the schedule fires. Include instructions for what to do, including whether to send a message.",
    }),
    channel_id: Schema.String.annotations({
      description: "The channel/room ID where the scheduled task should send messages",
    }),
    scheduled_for: Schema.optional(Schema.String).annotations({
      description: "ISO8601 timestamp for one-time schedules (required if type=once)",
    }),
  },
  success: ScheduleResult,
});

export const ListSchedules = Tool.make("list_schedules", {
  description: "List all scheduled tasks",
  parameters: {},
  success: ScheduleListResult,
});

export const DeleteSchedule = Tool.make("delete_schedule", {
  description: "Delete a scheduled task by its ID",
  parameters: {
    schedule_id: Schema.String.annotations({
      description: "The ID of the schedule to delete (use full ID or first 8 characters)",
    }),
  },
  success: OperationResult,
});

export const PauseSchedule = Tool.make("pause_schedule", {
  description: "Pause a scheduled task (it won't run until resumed)",
  parameters: {
    schedule_id: Schema.String.annotations({
      description: "The ID of the schedule to pause",
    }),
  },
  success: OperationResult,
});

export const ResumeSchedule = Tool.make("resume_schedule", {
  description: "Resume a paused scheduled task",
  parameters: {
    schedule_id: Schema.String.annotations({
      description: "The ID of the schedule to resume",
    }),
  },
  success: OperationResult,
});

// Combined toolkit
export const SchedulerToolkit = Toolkit.make(
  ScheduleTask,
  ListSchedules,
  DeleteSchedule,
  PauseSchedule,
  ResumeSchedule,
);

// Helper to find schedule by full ID or prefix
const findScheduleId = (idOrPrefix: string, schedules: readonly { id: string }[]) => {
  // Try exact match first
  const exact = schedules.find((s) => s.id === idOrPrefix);
  if (exact) return exact.id;
  // Try prefix match
  const prefix = schedules.find((s) => s.id.startsWith(idOrPrefix));
  return prefix?.id;
};

// Static handler layer - no room context needed
export const SchedulerToolHandlers = SchedulerToolkit.toLayer(
  Effect.gen(function* () {
    const scheduler = yield* SchedulerService;

    return {
      schedule_task: ({ name, type, cron_expression, prompt, channel_id, scheduled_for }) =>
        Effect.gen(function* () {
          const schedule = yield* scheduler.createSchedule({
            name,
            type,
            cronExpression: cron_expression,
            prompt,
            channelId: channel_id,
            scheduledFor: scheduled_for,
          });
          return {
            id: schedule.id,
            name: schedule.name,
            type: schedule.type,
            status: schedule.status,
            cronExpression: schedule.cronExpression,
            prompt: schedule.prompt,
            channelId: schedule.channelId,
            nextRunAt: schedule.nextRunAt,
            lastRunAt: schedule.lastRunAt,
            scheduledFor: schedule.scheduledFor,
          };
        }),

      list_schedules: () =>
        Effect.gen(function* () {
          const schedules = yield* scheduler.listSchedules();
          return {
            schedules: schedules.map((s) => ({
              id: s.id,
              name: s.name,
              type: s.type,
              status: s.status,
              cronExpression: s.cronExpression,
              prompt: s.prompt,
              channelId: s.channelId,
              nextRunAt: s.nextRunAt,
              lastRunAt: s.lastRunAt,
              scheduledFor: s.scheduledFor,
            })),
            count: schedules.length,
          };
        }),

      delete_schedule: ({ schedule_id }) =>
        Effect.gen(function* () {
          const schedules = yield* scheduler.listSchedules();
          const fullId = findScheduleId(schedule_id, schedules);
          if (!fullId) {
            return {
              success: false,
              message: `Schedule ${schedule_id} not found`,
            };
          }
          const deleted = yield* scheduler.deleteSchedule(fullId);
          return {
            success: deleted,
            message: deleted
              ? `Schedule ${fullId.slice(0, 8)} deleted`
              : `Schedule ${schedule_id} not found`,
          };
        }),

      pause_schedule: ({ schedule_id }) =>
        Effect.gen(function* () {
          const schedules = yield* scheduler.listSchedules();
          const fullId = findScheduleId(schedule_id, schedules);
          if (!fullId) {
            return {
              success: false,
              message: `Schedule ${schedule_id} not found`,
            };
          }
          yield* scheduler.pauseSchedule(fullId);
          return { success: true, message: `Schedule ${fullId.slice(0, 8)} paused` };
        }),

      resume_schedule: ({ schedule_id }) =>
        Effect.gen(function* () {
          const schedules = yield* scheduler.listSchedules();
          const fullId = findScheduleId(schedule_id, schedules);
          if (!fullId) {
            return {
              success: false,
              message: `Schedule ${schedule_id} not found`,
            };
          }
          yield* scheduler.resumeSchedule(fullId);
          return { success: true, message: `Schedule ${fullId.slice(0, 8)} resumed` };
        }),
    };
  }),
);
