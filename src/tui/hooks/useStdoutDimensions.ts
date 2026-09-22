/**
 * useStdoutDimensions — Returns [columns, rows] and re-renders on terminal resize.
 *
 * Ink's useStdout() does not subscribe to resize events, so layout only updates
 * when something else causes a re-render. This hook listens to the stream's
 * 'resize' event (Node TTY) and updates state so the component re-renders
 * with the new dimensions.
 */

import { useStdout } from 'ink';
import { useState, useEffect } from 'react';

export function useStdoutDimensions(): [number, number] {
  const { stdout } = useStdout();
  const [size, setSize] = useState<[number, number]>(() => [
    stdout.columns || 80,
    stdout.rows || 24,
  ]);

  useEffect(() => {
    const cols = stdout.columns || 80;
    const rows = stdout.rows || 24;
    setSize([cols, rows]);

    const stream = stdout as NodeJS.WriteStream & {
      on?(event: string, fn: () => void): void;
    };
    if (typeof stream.on !== 'function') return;

    const onResize = () => {
      const c = stdout.columns || 80;
      const r = stdout.rows || 24;
      if (c > 0 && r > 0) setSize([c, r]);
    };
    stream.on('resize', onResize);
    return () => {
      stream.off?.('resize', onResize);
    };
  }, [stdout]);

  return size;
}
