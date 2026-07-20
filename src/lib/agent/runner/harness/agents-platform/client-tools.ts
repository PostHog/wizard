/**
 * The local "hands" a hosted audit agent operates.
 *
 * In the cloud audit the model runs server-side and has no filesystem, so the
 * agent's spec declares these as `kind: "client"` tools: the runner emits a
 * `client_tool_call` over SSE, we execute it here against the real project, and
 * POST the result back. The remote tool call blocks until we do.
 *
 * The file tools delegate to pi's own built-in tool implementations
 * (`@earendil-works/pi-coding-agent`) — the same engine the platform runs — so
 * we reuse pi's read/grep/list/write logic, argument schemas, and truncation
 * rather than maintaining our own. We keep only two things: the path jail (the
 * remote model is untrusted input, so it never escapes the project root) and the
 * one audit-specific tool, `read_ledger`.
 */
import * as path from 'path';

import {
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from '@earendil-works/pi-coding-agent';

import { readLedger } from '@lib/programs/audit/ledger';
import { AUDIT_CHECKS_FILE, type AuditCheck } from '@lib/programs/audit/types';

/** Tool ids this client advertises to the platform on session start. */
export const CLOUD_AUDIT_CLIENT_TOOLS = [
  'grep_files',
  'read_file',
  'list_files',
  'write_file',
  'read_ledger',
] as const;

/**
 * Resolve a model-supplied path strictly inside the project root.
 *
 * The path comes from a remote model, so it is untrusted input: this is what
 * stands between `../../.ssh/id_rsa` and a read. Compare against the resolved
 * root with a separator suffix so `/proj-evil` can't pass as `/proj`. pi's tools
 * accept an absolute path, so we jail first and hand them the resolved one.
 *
 * The check is lexical — it does not resolve symlinks, so a symlink already
 * inside the project can still point out of it. That's a deliberate floor rather
 * than a ceiling: the local audit arm runs an agent with unrestricted filesystem
 * access, so this is strictly the more contained of the two. Tighten it (realpath
 * the target) before this is ever pointed at a repo the user doesn't trust.
 */
export function resolveInWorkdir(
  workdir: string,
  p: string | undefined,
): string {
  const root = path.resolve(workdir);
  const full = path.resolve(root, p ?? '.');
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`path escapes the project directory: ${p}`);
  }
  return full;
}

/**
 * Read back the run's authoritative ledger — the checklist the wizard accumulates
 * on disk from the agent's `resolve_checks` calls (see ledger-bridge). This is the
 * agent's re-grounding path: rather than trust its own context to remember what it
 * has resolved across a long run, it reads its resolved state back from here and
 * builds the report's per-check results from what this returns. Empty until the
 * first resolution lands. Not scoped through `resolveInWorkdir` — the path is ours,
 * not model-supplied.
 */
function readLedgerTool(workdir: string): { checks: AuditCheck[] } {
  return { checks: readLedger(path.join(workdir, AUDIT_CHECKS_FILE)) };
}

/**
 * Execute one client tool call against the project on disk. The file ops run
 * through pi's built-in tools (jailed first); `read_ledger` is ours. Throws on
 * an unknown tool id or a path that escapes the project root; the caller turns a
 * throw into a `client_tool_result` error so the agent can react.
 */
export async function execClientTool(
  workdir: string,
  toolId: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  switch (toolId) {
    case 'grep_files': {
      const dir =
        args.dir !== undefined
          ? resolveInWorkdir(workdir, String(args.dir))
          : undefined;
      return createGrepTool(workdir).execute(toolId, {
        pattern: String(args.pattern ?? ''),
        path: dir,
      });
    }
    case 'read_file': {
      const fp = resolveInWorkdir(workdir, args.path as string | undefined);
      return createReadTool(workdir).execute(toolId, { path: fp });
    }
    case 'list_files': {
      const dir =
        args.dir !== undefined
          ? resolveInWorkdir(workdir, String(args.dir))
          : undefined;
      return createLsTool(workdir).execute(toolId, { path: dir });
    }
    case 'write_file': {
      const fp = resolveInWorkdir(workdir, args.path as string | undefined);
      return createWriteTool(workdir).execute(toolId, {
        path: fp,
        content: String(args.content ?? ''),
      });
    }
    case 'read_ledger':
      return readLedgerTool(workdir);
    default:
      throw new Error(`unknown client tool: ${toolId}`);
  }
}
