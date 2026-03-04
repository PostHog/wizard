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
    stdout.columns,
    stdout.rows,
  ]);

  useEffect(() => {
    setSize([stdout.columns, stdout.rows]);

    const stream = stdout as NodeJS.WriteStream & {
      on?(event: string, fn: () => void): void;
    };
    if (typeof stream.on !== 'function') return;

    const onResize = () => setSize([stdout.columns, stdout.rows]);
    stream.on('resize', onResize);
    return () => {
      stream.off?.('resize', onResize);
    };
  }, [stdout]);

  return size;
}
