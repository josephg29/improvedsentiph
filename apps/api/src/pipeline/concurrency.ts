/**
 * A tiny async concurrency limiter. Caps how many headless workers run at once
 * across all in-flight runs (spec §9) — a separate pool from the PTY terminals.
 */

export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

export const createLimiter = (maxConcurrent: number): Limiter => {
  const max = Math.max(1, Math.floor(maxConcurrent));
  const queue: Array<() => void> = [];
  let active = 0;

  const pump = () => {
    if (active >= max) {
      return;
    }
    const start = queue.shift();
    if (!start) {
      return;
    }
    active += 1;
    start();
  };

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            pump();
          });
      });
      pump();
    });
};
