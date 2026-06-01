export type WaitFeedback = {
  stop: () => void;
};

type IntervalHandle = ReturnType<typeof setInterval>;
type SetIntervalFn = (callback: () => void, intervalMs: number) => IntervalHandle;
type ClearIntervalFn = (interval: IntervalHandle) => void;

export type WaitFeedbackOptions = {
  timeoutMs: number;
  intervalMs?: number;
  output?: Pick<NodeJS.WriteStream, "write">;
  now?: () => number;
  setIntervalFn?: SetIntervalFn;
  clearIntervalFn?: ClearIntervalFn;
};

const DEFAULT_INTERVAL_MS = 30_000;

export function startWaitFeedback(options: WaitFeedbackOptions): WaitFeedback {
  const output = options.output ?? process.stderr;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const startedAt = now();

  const writeStatus = (): void => {
    output.write(
      `waiting for Claude reply... ${formatDuration(now() - startedAt)} elapsed, timeout ${formatDuration(
        options.timeoutMs,
      )}\n`,
    );
  };

  const interval = options.setIntervalFn
    ? options.setIntervalFn(writeStatus, intervalMs)
    : setInterval(writeStatus, intervalMs);

  return {
    stop: () => {
      if (options.clearIntervalFn) {
        options.clearIntervalFn(interval);
      } else {
        clearInterval(interval);
      }
    },
  };
}

export function formatDuration(ms: number): string {
  const roundedSeconds = Math.max(0, Math.round(ms / 1000));
  if (roundedSeconds < 60) return `${roundedSeconds}s`;

  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}
