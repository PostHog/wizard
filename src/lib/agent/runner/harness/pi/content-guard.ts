/**
 * File-content guard for the pi harness's write/edit tools.
 *
 * gpt-5.x can leak its own function-call transport tokens into a string
 * argument mid-stream: run 9704a73e wrote
 * `' }#+#+#+#+.functions.complete_task (commentary …json.functions.complete_taskjson>tagger…`
 * plus a DEL byte into a customer's global-error.tsx. Once on disk the
 * garbage is nearly unremovable by exact-match edits, so the run shipped a
 * syntax-broken file. Reject the call before it reaches disk and tell the
 * model to re-emit — only NEW content is guarded; `edit.oldText` must stay
 * free to match (and remove) garbage already in a file.
 */
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';

// Transport-token shapes that never belong in written file content. Scoped to
// the wizard's own orchestrator tool names — `functions.<generic>` alone would
// false-positive on real code (e.g. Firebase's `functions.config()`).
const LEAK_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  {
    pattern: /functions\.(?:complete_task|enqueue_task|read_handoffs)/,
    label: 'leaked tool-call tokens',
  },
  {
    pattern: /<\|(?:channel|constrain|message|call|end|start|return)\|>/,
    label: 'leaked channel markers',
  },
  // C0 controls and DEL, minus tab/newline/CR — never valid in source text.
  // eslint-disable-next-line no-control-regex
  { pattern: /[\0-\x08\x0B\f\x0E-\x1F\x7F]/, label: 'control characters' },
];

/** The leak label when content is corrupted, else undefined. */
export function contentLeak(content: string): string | undefined {
  return LEAK_PATTERNS.find(({ pattern }) => pattern.test(content))?.label;
}

type GuardableTool = {
  name: string;
  execute: (...args: never[]) => Promise<unknown>;
};

/**
 * Wrap a pi write/edit tool so corrupted content is rejected with a
 * corrective error instead of reaching disk. `pick` extracts the strings
 * that will be WRITTEN (write content, edit newText) from the tool params.
 */
export function withContentGuard<T extends GuardableTool>(
  tool: T,
  pick: (params: unknown) => readonly string[],
): T {
  const execute = tool.execute.bind(tool) as (
    ...args: unknown[]
  ) => Promise<unknown>;
  tool.execute = ((...args: unknown[]) => {
    const params = args[1];
    let leak: string | undefined;
    try {
      leak = pick(params).map(contentLeak).find(Boolean);
    } catch {
      leak = undefined; // malformed params: let the tool's own validation speak
    }
    if (leak) {
      analytics.wizardCapture('file content guard tripped', {
        tool: tool.name,
        leak,
      });
      logToFile(`[content-guard] blocked ${tool.name}: ${leak}`);
      return Promise.resolve({
        content: [
          {
            type: 'text',
            text:
              `Error: the new file content contains ${leak} from the model transport — ` +
              'it was NOT written. Re-issue the call with only the intended file content.',
          },
        ],
        details: {},
        isError: true,
      });
    }
    return execute(...args);
  }) as T['execute'];
  return tool;
}

/** Strings a `write` call would put on disk. */
export function pickWriteContent(params: unknown): readonly string[] {
  const content = (params as { content?: unknown })?.content;
  return typeof content === 'string' ? [content] : [];
}

/** Strings an `edit` call would put on disk (newText only — oldText must match existing bytes). */
export function pickEditContent(params: unknown): readonly string[] {
  const edits = (params as { edits?: unknown })?.edits;
  if (!Array.isArray(edits)) return [];
  return edits
    .map((e: unknown) => (e as { newText?: unknown })?.newText)
    .filter((t): t is string => typeof t === 'string');
}
