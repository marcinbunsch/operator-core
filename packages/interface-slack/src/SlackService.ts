import { Effect, Schedule } from "effect";
import { App, LogLevel } from "@slack/bolt";
import { ConfigError, SlackError } from "./errors.js";
import type { SocketModeClientLike } from "./slackReconnect.js";
import { createSocketModeReconnector } from "./slackReconnect.js";
import { createSocketModeReceiverWithReconnect } from "./slackSocketMode.js";

// Check if error is a transient Socket Mode connection error that should be retried
const isTransientSocketError = (e: unknown): boolean => {
  const message = String(e);
  return (
    message.includes("client is not ready") ||
    message.includes("Failed to send a WebSocket message") ||
    message.includes("socket_mode_no_reply_received_error") ||
    message.includes("Expected 101 status code") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ENOTFOUND") ||
    message.includes("ETIMEDOUT")
  );
};

/**
 * SlackService provides a scoped connection to the Slack API.
 *
 * Uses Socket Mode for real-time events without a public endpoint.
 * The connection is automatically closed when the scope ends.
 *
 * Required environment variables:
 * - SLACK_BOT_TOKEN: Bot user OAuth token (xoxb-...)
 * - SLACK_APP_TOKEN: App-level token for Socket Mode (xapp-...)
 */
export class SlackService extends Effect.Service<SlackService>()(
  "@operator/interface-slack/SlackService",
  {
    scoped: Effect.gen(function* () {
      const token = process.env["SLACK_BOT_TOKEN"];
      const appToken = process.env["SLACK_APP_TOKEN"];

      if (!token || !appToken) {
        return yield* Effect.fail(
          new ConfigError({
            message: "Missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN environment variables",
          }),
        );
      }

      // Set up reconnect handling
      const reconnector = createSocketModeReconnector();
      const scheduleReconnect = (reason: string, client?: SocketModeClientLike) => {
        return reconnector.scheduleReconnect(reason, client, (message, error) => {
          if (error !== undefined) {
            console.error(message, error);
            return;
          }
          console.error(message);
        });
      };

      const { receiver } = createSocketModeReceiverWithReconnect({
        appToken,
        logLevel: LogLevel.ERROR,
        scheduleReconnect,
        isTransientSocketError,
      });

      // Retry schedule for transient errors
      const retrySchedule = Schedule.exponential("100 millis").pipe(
        Schedule.jittered,
        Schedule.compose(Schedule.recurs(3)),
      );

      const transientRetry = Effect.retry({
        schedule: retrySchedule,
        while: (err: SlackError) => isTransientSocketError(err.cause),
      });

      const app = new App({
        token,
        socketMode: true,
        logLevel: LogLevel.ERROR,
        receiver,
      });

      // Global error handler for unhandled Slack errors
      app.error(async (error) => {
        console.error("[slack] Error:", error);
        if (isTransientSocketError(error)) {
          scheduleReconnect(String(error), receiver.client as SocketModeClientLike);
        }
      });

      yield* Effect.log("[slack] App instance created");

      // Add finalizer to stop the app when scope closes
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          reconnector.stop();
          yield* Effect.log("[slack] Stopping Slack connection...");
          yield* Effect.tryPromise({
            try: () => app.stop(),
            catch: (e) => new SlackError({ operation: "stop", cause: e }),
          }).pipe(Effect.catchAll(() => Effect.void));
          yield* Effect.log("[slack] Slack connection closed");
        }),
      );

      return {
        /** The underlying Bolt app instance for registering event handlers */
        app,

        /**
         * Start the Slack Socket Mode connection.
         * Call this after registering all event handlers.
         */
        start: (): Effect.Effect<void, SlackError> =>
          Effect.tryPromise({
            try: () => app.start(),
            catch: (e) => new SlackError({ operation: "start", cause: e }),
          }),

        /**
         * Send a direct message to a user.
         * Opens a DM channel if needed.
         */
        sendDm: (userId: string, text: string): Effect.Effect<void, SlackError> => {
          const dmEffect = Effect.tryPromise({
            try: async () => {
              const dmResult = await app.client.conversations.open({ users: userId });
              const dmChannelId = dmResult.channel?.id;
              if (dmChannelId) {
                await app.client.chat.postMessage({ channel: dmChannelId, text });
              }
            },
            catch: (e) => new SlackError({ operation: "sendDm", cause: e }),
          });
          return dmEffect.pipe(transientRetry, Effect.asVoid);
        },

        /**
         * Post a message to a channel or thread.
         */
        postMessage: (
          channel: string,
          text: string,
          options?: { thread_ts?: string },
        ): Effect.Effect<void, SlackError> => {
          const postEffect = Effect.tryPromise({
            try: () => {
              const args: { channel: string; text: string; thread_ts?: string } = { channel, text };
              if (options?.thread_ts) {
                args.thread_ts = options.thread_ts;
              }
              return app.client.chat.postMessage(args);
            },
            catch: (e) => new SlackError({ operation: "postMessage", cause: e }),
          });
          return postEffect.pipe(
            transientRetry,
            Effect.tapError((err) => Effect.log(`[slack] postMessage failed after retries: ${err.operation}`)),
            Effect.asVoid,
          );
        },

        /**
         * Get the bot's own user ID.
         * Useful for detecting @mentions.
         */
        getBotUserId: (): Effect.Effect<string, SlackError> =>
          Effect.tryPromise({
            try: async () => {
              const authResult = await app.client.auth.test();
              if (!authResult.user_id) {
                throw new Error("No user_id in auth response");
              }
              return authResult.user_id;
            },
            catch: (e) => new SlackError({ operation: "getBotUserId", cause: e }),
          }),

        /**
         * Open a DM channel with a user.
         * Returns the channel ID.
         */
        openDm: (userId: string): Effect.Effect<string, SlackError> => {
          const openEffect = Effect.tryPromise({
            try: async () => {
              const result = await app.client.conversations.open({ users: userId });
              if (!result.channel?.id) {
                throw new Error("Could not open DM channel");
              }
              return result.channel.id;
            },
            catch: (e) => new SlackError({ operation: "openDm", cause: e }),
          });
          return openEffect.pipe(transientRetry);
        },

        /**
         * Upload a file to a channel.
         */
        uploadFile: (
          channelId: string,
          filename: string,
          file: Buffer,
          initialComment?: string,
          threadTs?: string,
        ): Effect.Effect<void, SlackError> => {
          const uploadEffect = Effect.tryPromise({
            try: () => {
              // Build args object, only including optional fields if provided
              // Cast needed due to Slack types not supporting exactOptionalPropertyTypes
              const args = {
                channels: channelId,
                filename,
                file,
                ...(initialComment && { initial_comment: initialComment }),
                ...(threadTs && { thread_ts: threadTs }),
              } as Parameters<typeof app.client.filesUploadV2>[0];
              return app.client.filesUploadV2(args);
            },
            catch: (e) => new SlackError({ operation: "uploadFile", cause: e }),
          });
          return uploadEffect.pipe(transientRetry, Effect.asVoid);
        },
      };
    }),
  },
) {}
