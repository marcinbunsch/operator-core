/**
 * @operator/interface-slack/testing - Test utilities for mocking SlackService
 *
 * Import from "@operator/interface-slack/testing" in test files only.
 * These utilities are NOT included in production builds.
 */

import { Effect, Layer } from "effect";
import { SlackService } from "./SlackService.js";

// ============================================================================
// SlackService Mock
// ============================================================================

export interface MockSlackServiceOptions {
  /** Bot user ID to return from getBotUserId */
  botUserId?: string;
  /** DM channel ID to return from openDm */
  dmChannelId?: string;
  /** Callback when postMessage is called */
  onPostMessage?: (channel: string, text: string, options?: { thread_ts?: string }) => void;
  /** Callback when sendDm is called */
  onSendDm?: (userId: string, text: string) => void;
  /** Callback when uploadFile is called */
  onUploadFile?: (channelId: string, filename: string, file: Buffer) => void;
  /** Callback when a slash command is registered */
  onCommand?: (name: string, handler: unknown) => void;
  /** Callback when a view handler is registered */
  onView?: (callbackId: string, handler: unknown) => void;
  /** Callback when an event handler is registered */
  onEvent?: (eventType: string, handler: unknown) => void;
  /** Callback when start is called */
  onStart?: () => void;
}

/**
 * Create a mock SlackService Layer for testing.
 *
 * @example
 * ```typescript
 * const messages: Array<{ channel: string; text: string }> = [];
 * const layer = makeMockSlackService({
 *   onPostMessage: (channel, text) => messages.push({ channel, text }),
 * });
 *
 * Effect.gen(function* () {
 *   const slack = yield* SlackService;
 *   yield* slack.postMessage("C123", "Hello!");
 * }).pipe(Effect.provide(layer));
 *
 * expect(messages[0].text).toBe("Hello!");
 * ```
 */
export const makeMockSlackService = (
  options: MockSlackServiceOptions = {},
): Layer.Layer<SlackService> => {
  const {
    botUserId = "U_BOT_MOCK",
    dmChannelId = "D_DM_MOCK",
    onPostMessage,
    onSendDm,
    onUploadFile,
    onCommand,
    onView,
    onEvent,
    onStart,
  } = options;

  return Layer.succeed(SlackService, {
    app: {
      command: (name: string, handler: unknown) => {
        onCommand?.(name, handler);
      },
      view: (callbackId: string, handler: unknown) => {
        onView?.(callbackId, handler);
      },
      event: (eventType: string, handler: unknown) => {
        onEvent?.(eventType, handler);
      },
    },
    start: () => {
      onStart?.();
      return Effect.void;
    },
    sendDm: (userId: string, text: string) => {
      onSendDm?.(userId, text);
      return Effect.void;
    },
    postMessage: (channel: string, text: string, messageOptions?: { thread_ts?: string }) => {
      onPostMessage?.(channel, text, messageOptions);
      return Effect.void;
    },
    getBotUserId: () => Effect.succeed(botUserId),
    openDm: () => Effect.succeed(dmChannelId),
    uploadFile: (channelId: string, filename: string, file: Buffer) => {
      onUploadFile?.(channelId, filename, file);
      return Effect.void;
    },
  } as unknown as SlackService);
};
