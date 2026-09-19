/**
 * useTick — forces a re-render every `intervalMs`. Returns a monotonically
 * increasing counter, which is rarely needed — most callers just want the
 * re-render side effect.
 */

import { useEffect, useState } from 'react';

export function useTick(intervalMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}
