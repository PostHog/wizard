/** The SDK message observer behind `collectTranscript`: a capped text tail plus one `activity` line per step. */

import type { ProgressEmitter } from '@agent/progress';
import type { RunMiddleware } from '../harness/types';

/** Only the tail is kept: a caller's report is the run's last output. */
export const TRANSCRIPT_TAIL_CHARS = 256 * 1024;
const ACTIVITY_LINE_CHARS = 100;

export interface TranscriptTail extends RunMiddleware {
  /** The kept assistant text, one block per line, then the final result. */
  text(): string;
}

export function createTranscriptTail(emit: ProgressEmitter): TranscriptTail {
  const collected: string[] = [];
  let collectedChars = 0;
  let resultText = '';

  const collect = (text: string): void => {
    collected.push(text);
    collectedChars += text.length;
    while (collectedChars > TRANSCRIPT_TAIL_CHARS && collected.length > 1) {
      collectedChars -= collected.shift()?.length ?? 0;
    }
  };
  const activity = (line: string): void => emit({ kind: 'activity', line });

  return {
    onMessage(message: any): void {
      if (message?.type === 'assistant') {
        const content = message.message?.content;
        if (!Array.isArray(content)) return;
        for (const block of content) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            collect(block.text);
            const line = block.text.trim();
            if (line) {
              activity(
                line.length > ACTIVITY_LINE_CHARS
                  ? `${line.slice(0, ACTIVITY_LINE_CHARS)}…`
                  : line,
              );
            }
          } else if (block?.type === 'tool_use') {
            activity(formatToolUse(block));
          }
        }
      } else if (
        message?.type === 'result' &&
        typeof message.result === 'string'
      ) {
        resultText = message.result;
      }
    },
    finalize: () => undefined,
    text: () => `${collected.join('\n')}\n${resultText}`,
  };
}

/** Put the tail in front of any other middleware, so both see every message. */
export function withTranscript(
  middleware: RunMiddleware | undefined,
  transcript: TranscriptTail | undefined,
): RunMiddleware | undefined {
  if (!transcript) return middleware;
  if (!middleware) return transcript;
  return {
    onMessage(message) {
      transcript.onMessage(message);
      middleware.onMessage(message);
    },
    finalize(resultMessage, totalDurationMs) {
      transcript.finalize(resultMessage, totalDurationMs);
      return middleware.finalize(resultMessage, totalDurationMs);
    },
  };
}

function formatToolUse(block: any): string {
  const name = typeof block?.name === 'string' ? block.name : 'tool';
  const input = (block?.input ?? {}) as Record<string, unknown>;
  const detail =
    (input.file_path as string) ||
    (input.pattern as string) ||
    (input.path as string) ||
    '';
  return detail ? `${name} ${detail}` : name;
}
