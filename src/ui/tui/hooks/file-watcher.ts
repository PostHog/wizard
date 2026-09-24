import { useEffect } from 'react';
import { startFileWatcher, type FileWatcherOptions } from '@lib/file-watcher';

export { startFileWatcher } from '@lib/file-watcher';
export type { FileWatcherHandle, FileWatcherOptions } from '@lib/file-watcher';

/** React hook wrapping `startFileWatcher`. Starts on mount, stops on unmount
 *  or when `path` changes. `onUpdate` and `options` are captured at mount
 *  time — change `path` to restart with a new callback. */
export function useFileWatcher(
  path: string,
  onUpdate: (parsed: unknown) => void,
  options: FileWatcherOptions = {},
): void {
  useEffect(() => {
    const handle = startFileWatcher(path, onUpdate, options);
    return () => handle.stop();
    // `onUpdate` and `options` are intentionally omitted from deps — the
    // watcher captures them at mount time and the path drives restarts.
  }, [path]);
}
