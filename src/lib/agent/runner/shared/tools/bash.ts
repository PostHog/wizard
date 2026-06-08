import { spawnSync } from 'child_process';
import { z } from 'zod';
import { ok, err, type ToolDefinition, type ToolResult } from './types';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_CHARS = 30_000;

const bashSchema = z.object({
  command: z.string(),
  timeout: z.number().int().positive().optional(),
  description: z.string().optional(),
});

/**
 * Run a shell command in the run's working directory and capture combined
 * stdout/stderr. No security gating here — the canUseTool allowlist + YARA
 * hooks (PR 05) decide what is permitted to run.
 */
export const bashTool: ToolDefinition = {
  name: 'Bash',
  description:
    'Execute a bash command in the workspace directory. Returns combined stdout and stderr.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      timeout: {
        type: 'number',
        description: `Timeout in ms (max ${MAX_TIMEOUT_MS})`,
      },
      description: { type: 'string' },
    },
    required: ['command'],
  },
  handler(input, ctx): Promise<ToolResult> {
    const parsed = bashSchema.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve(
        err(`Invalid input: ${parsed.error.issues[0]?.message}`),
      );
    }
    const { command, timeout } = parsed.data;
    const timeoutMs = Math.min(timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

    const result = spawnSync('bash', ['-c', command], {
      cwd: ctx.workingDirectory,
      timeout: timeoutMs,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error) {
      const isTimeout =
        (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
      return Promise.resolve(
        err(
          isTimeout
            ? `Command timed out after ${timeoutMs}ms`
            : `Failed to run command: ${result.error.message}`,
        ),
      );
    }

    const output = truncate(
      [result.stdout, result.stderr].filter(Boolean).join('').trim(),
    );
    const exitCode = result.status ?? 0;
    if (exitCode !== 0) {
      return Promise.resolve(
        err(`${output}\n\n[exited with code ${exitCode}]`.trim()),
      );
    }
    return Promise.resolve(ok(output || '(no output)'));
  },
};

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… [output truncated]`
    : text;
}
