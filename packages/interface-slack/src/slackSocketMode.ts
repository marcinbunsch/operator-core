import type { SocketModeReceiverProcessEventErrorHandlerArgs } from "@slack/bolt";
import { LogLevel, SocketModeReceiver } from "@slack/bolt";
import type { ReconnectScheduler, SocketModeClientLike } from "./slackReconnect.js";

type TransientErrorChecker = (error: unknown) => boolean;

const shouldTriggerReconnectFromMessage = (message: string): boolean => {
  return (
    message.includes("Failed to retrieve a new WSS URL for reconnection") ||
    message.includes("Expected 101 status code") ||
    message.includes("client is not ready") ||
    message.includes("socket_mode_no_reply_received_error")
  );
};

export const createSocketModeReceiverWithReconnect = (options: {
  appToken?: string;
  logLevel?: LogLevel;
  scheduleReconnect: ReconnectScheduler;
  isTransientSocketError: TransientErrorChecker;
}) => {
  const logLevel = options.logLevel ?? LogLevel.ERROR;
  const scheduleReconnect = options.scheduleReconnect;
  let clientRef: SocketModeClientLike | undefined;

  const logger = {
    setLevel: () => {},
    getLevel: () => logLevel,
    debug: () => {},
    info: () => {},
    warn: (...args: unknown[]) => {
      console.warn("[slack]", ...args);
    },
    error: (...args: unknown[]) => {
      console.error("[slack]", ...args);
      const message = args.map((arg) => String(arg)).join(" ");
      if (shouldTriggerReconnectFromMessage(message)) {
        scheduleReconnect(message, clientRef);
      }
    },
  };

  const processEventErrorHandler = async ({
    error,
    logger: handlerLogger,
  }: SocketModeReceiverProcessEventErrorHandlerArgs) => {
    if (options.isTransientSocketError(error)) {
      handlerLogger.error(`Socket Mode transient error: ${error}`);
      scheduleReconnect(String(error), clientRef);
      return true;
    }
    return false;
  };

  const receiver = new SocketModeReceiver({
    appToken: options.appToken,
    logLevel,
    logger,
    processEventErrorHandler,
  });
  clientRef = receiver.client as SocketModeClientLike;

  receiver.client.on("error", (err) => {
    scheduleReconnect(String(err), clientRef);
  });

  return { receiver, logger, processEventErrorHandler };
};
