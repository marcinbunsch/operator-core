export type SocketModeClientLike = {
  disconnect: () => Promise<void>;
  start: () => Promise<void>;
};

export type ReconnectScheduler = (reason: string, client?: SocketModeClientLike) => void;

export type ReconnectLogFn = (message: string, error?: unknown) => void;

export type SocketModeReconnector = {
  scheduleReconnect: (reason: string, client?: SocketModeClientLike, log?: ReconnectLogFn) => void;
  stop: () => void;
  getState: () => {
    consecutiveFailures: number;
    reconnectInProgress: boolean;
    isStopping: boolean;
  };
};

type ReconnectOptions = {
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  sleepFn?: (ms: number) => Promise<void>;
  maxDelayMs?: number;
  maxExponent?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const createSocketModeReconnector = (
  options: ReconnectOptions = {},
): SocketModeReconnector => {
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const sleep = options.sleepFn ?? defaultSleep;
  const maxDelayMs = options.maxDelayMs ?? 5 * 60_000;
  const maxExponent = options.maxExponent ?? 6;

  let isStopping = false;
  let reconnectInProgress = false;
  let consecutiveFailures = 0;

  const scheduleReconnect = (
    reason: string,
    client?: SocketModeClientLike,
    log: ReconnectLogFn = console.error,
  ) => {
    if (isStopping || reconnectInProgress || !client) return;
    reconnectInProgress = true;
    consecutiveFailures += 1;

    const delayMs = Math.min(maxDelayMs, 1000 * 2 ** Math.min(consecutiveFailures, maxExponent));
    log(
      `[slack] Scheduling Socket Mode reconnect in ${Math.round(delayMs / 1000)}s (reason: ${reason})`,
    );

    setTimeoutFn(async () => {
      if (isStopping) {
        reconnectInProgress = false;
        return;
      }
      try {
        await client.disconnect().catch(() => {});
        await sleep(1000);
        await client.start();
        consecutiveFailures = 0;
        log("[slack] Socket Mode reconnect successful");
      } catch (err) {
        log("[slack] Socket Mode reconnect failed:", err);
      } finally {
        reconnectInProgress = false;
        if (consecutiveFailures > 0) {
          scheduleReconnect("reconnect failed", client, log);
        }
      }
    }, delayMs);
  };

  return {
    scheduleReconnect,
    stop: () => {
      isStopping = true;
    },
    getState: () => ({
      consecutiveFailures,
      reconnectInProgress,
      isStopping,
    }),
  };
};
