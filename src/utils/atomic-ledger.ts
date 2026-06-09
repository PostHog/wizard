/**
 * Small shared primitives for on-disk ledgers: an atomic JSON writer and a
 * single-chain async mutex. Used by the audit tools and by the orchestrator
 * queue. Lifted here so both share one implementation.
 */
import * as fs from 'fs';

/**
 * Atomically write JSON: write to a `.tmp` file then rename over the target. The
 * rename bumps the file's mtime in one step, which is what a file watcher polls.
 */
export function writeJsonAtomic(targetPath: string, data: unknown): void {
  const tmpPath = `${targetPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, targetPath);
}

/**
 * A single async mutex. Serializes read-modify-write cycles so concurrent callers
 * (parallel task agents, audit tool calls) never interleave a mutation.
 */
export function makeMutex() {
  let chain: Promise<unknown> = Promise.resolve();
  return async function run<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = chain.then(() => fn());
    chain = next.catch(() => undefined);
    return next;
  };
}
