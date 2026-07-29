/**
 * Workaround, not a feature: rejects pi write/edit content carrying leaked
 * model transport tokens before it reaches disk. gpt-5.x streaming with tools
 * leaks its function-call grammar into string values — run 9704a73e wrote
 * `' }#+#+#+#+.functions.complete_task (commentary …json>tagger…` plus a DEL
 * byte into a customer's global-error.tsx, and exact-match edits could not
 * remove it. Unfixed upstream; delete this module when the stack stops leaking:
 * - litellm#14260 ("gpt5 with streaming and tool calls randomly produces
 *   garbage in response": `functions.name_of_some_function <garbage bytes>`
 *   in content — closed stale, not planned)
 *   https://github.com/BerriAI/litellm/issues/14260
 * - OpenAI community 1386422 (gpt-5.6-luna, Responses API: "garbage tokens
 *   (foreign scripts / leaked reasoning) inside string values right before
 *   the closing quote"; identical Chat Completions request is clean)
 *   https://community.openai.com/t/1386422
 */
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';

// Scoped to the wizard's own tool names — a generic `functions.*` match would false-positive on real code like Firebase's `functions.config()`.
const LEAK_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  {
    // The litellm#14260 signature: `functions.<tool name>` emitted as text.
    pattern: /functions\.(?:complete_task|enqueue_task|read_handoffs)/,
    label: 'leaked tool-call tokens',
  },
  {
    // Harmony channel markers (openai/harmony#27-class leaks).
    pattern: /<\|(?:channel|constrain|message|call|end|start|return)\|>/,
    label: 'leaked channel markers',
  },
  // C0 controls and DEL minus tab/newline/CR — never valid in source text.
  // eslint-disable-next-line no-control-regex
  { pattern: /[\0-\x08\x0B\f\x0E-\x1F\x7F]/, label: 'control characters' },
];

/** What the guard reports about a leak — the pattern's evidence, never the surrounding file content. */
export interface LeakFinding {
  label: string;
  /** The leaked token itself (JSON-escaped, capped) — transport grammar, not customer code. */
  token: string;
  /** Offset of the match within the content, and the content's length — locates the leak (end-of-string is the upstream signature) without carrying the string. */
  offset: number;
  contentLength: number;
}

/** The leak finding when content is corrupted, else undefined. */
export function contentLeak(content: string): LeakFinding | undefined {
  for (const { pattern, label } of LEAK_PATTERNS) {
    const match = pattern.exec(content);
    if (!match) continue;
    // JSON.stringify escapes C0 but not DEL — force \uXXXX for every control char.
    const token = JSON.stringify(match[0].slice(0, 40)).replace(
      // eslint-disable-next-line no-control-regex
      /[\x7F]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
    return { label, token, offset: match.index, contentLength: content.length };
  }
  return undefined;
}

type GuardableTool = {
  name: string;
  execute: (...args: never[]) => Promise<unknown>;
};

/** Wraps a pi write/edit tool; `pick` extracts the strings that would be WRITTEN, and a leak returns a corrective error instead of executing. */
export function withContentGuard<T extends GuardableTool>(
  tool: T,
  pick: (params: unknown) => readonly string[],
): T {
  const execute = tool.execute.bind(tool) as (
    ...args: unknown[]
  ) => Promise<unknown>;
  tool.execute = ((...args: unknown[]) => {
    const params = args[1];
    let leak: LeakFinding | undefined;
    try {
      leak = pick(params).map(contentLeak).find(Boolean);
    } catch {
      leak = undefined; // malformed params: let the tool's own validation speak
    }
    if (leak) {
      analytics.wizardCapture('file content guard tripped', {
        tool: tool.name,
        leak: leak.label,
        leak_token: leak.token,
        leak_offset: leak.offset,
        content_length: leak.contentLength,
        // End-of-string leaks are the upstream decoder signature (see header).
        at_end: leak.contentLength - leak.offset < 80,
      });
      logToFile(
        `[content-guard] blocked ${tool.name}: ${leak.label} token=${leak.token} at ${leak.offset}/${leak.contentLength}`,
      );
      return Promise.resolve({
        content: [
          {
            type: 'text',
            text:
              `Error: the new file content contains ${leak.label} from the model transport — ` +
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

/** Strings an `edit` call would put on disk — newText only, oldText must stay free to match existing garbage. */
export function pickEditContent(params: unknown): readonly string[] {
  const edits = (params as { edits?: unknown })?.edits;
  if (!Array.isArray(edits)) return [];
  return edits
    .map((e: unknown) => (e as { newText?: unknown })?.newText)
    .filter((t): t is string => typeof t === 'string');
}
