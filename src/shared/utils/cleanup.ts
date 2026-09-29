/** Synchronous work to run before the process exits, such as removing a temp file. */

const cleanupFns: Array<() => void> = [];

/** Register `fn` to run on exit; returns a function that unregisters it. */
export function registerCleanup(fn: () => void): () => void {
  cleanupFns.push(fn);
  return () => {
    const index = cleanupFns.indexOf(fn);
    if (index !== -1) cleanupFns.splice(index, 1);
  };
}

/** Drop every registered cleanup without running it. */
export function clearCleanups(): void {
  cleanupFns.length = 0;
}

/** Runs all registered cleanup functions and drains the list. */
export function runCleanups(): void {
  const fns = cleanupFns.splice(0);
  for (const fn of fns) {
    try {
      fn();
    } catch {
      /* cleanup should not prevent exit */
    }
  }
}
