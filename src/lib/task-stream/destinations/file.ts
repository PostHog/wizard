/**
 * Dumps every *attempted* sync to a local JSONL file, one line per push. A line
 * means the run published that payload, not that a backend accepted it — `--ci`
 * swaps the PostHog destination for this one, so a synthetic run never creates a
 * session row in a real project.
 *
 * Dev builds only: the payload holds the run's handoff report.
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { IS_PRODUCTION_BUILD } from '@env';
import { WIZARD_TASK_STREAM_FILE } from '@utils/paths';
import { logToFile } from '@utils/debug';
import type {
  StreamEvent,
  TaskStreamDestination,
  TaskStreamUpdate,
} from '@lib/task-stream/types';

export interface FileDestinationOptions {
  path: string;
  /** Override for tests. */
  now?: () => string;
}

export class FileDestination implements TaskStreamDestination {
  readonly name = 'file';
  readonly path: string;

  private readonly now: () => string;
  private disabled = false;

  constructor(opts: FileDestinationOptions) {
    this.path = opts.path;
    this.now = opts.now ?? (() => new Date().toISOString());
    // Truncate up front: one run, one file.
    this.write(() => writeFileSync(this.path, '', { mode: 0o600 }));
  }

  send(event: StreamEvent, payload: TaskStreamUpdate): Promise<void> {
    if (!this.disabled) {
      const line = `${JSON.stringify({ at: this.now(), event, payload })}\n`;
      this.write(() => appendFileSync(this.path, line, { mode: 0o600 }));
    }
    return Promise.resolve();
  }

  /** Never throws, never writes to stdio; the first failure ends the dump. */
  private write(op: () => void): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      op();
    } catch (err) {
      this.disabled = true;
      logToFile(
        `[task-stream] file destination disabled (${
          err instanceof Error ? err.message : String(err)
        }): ${this.path}`,
      );
    }
  }
}

/**
 * Resolve a `--task-stream-log` value, or null when the run did not ask for a
 * dump. `''` and `true` mean the default path — how `--ci` asks for one.
 */
export function createFileDestination(
  value: unknown,
  opts: { productionBuild?: boolean; cwd?: string } = {},
): FileDestination | null {
  if (opts.productionBuild ?? IS_PRODUCTION_BUILD) return null;
  if (value === undefined || value === null || value === false) return null;

  const raw = typeof value === 'string' ? value.trim() : '';
  const path =
    raw === ''
      ? WIZARD_TASK_STREAM_FILE
      : isAbsolute(raw)
      ? raw
      : resolve(opts.cwd ?? process.cwd(), raw);

  logToFile(`[task-stream] file destination enabled: ${path}`);
  return new FileDestination({ path });
}
