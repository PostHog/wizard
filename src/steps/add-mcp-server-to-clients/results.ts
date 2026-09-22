/**
 * Per-client outcome of an MCP server / plugin install or removal.
 *
 * "Nothing to do" is a first-class outcome rather than a silent no-op:
 * re-running `mcp add` on a machine that's already set up is the common case,
 * and collapsing it into an empty result set is what made the flow report
 * "Installation skipped." with no explanation. Failures carry a short reason
 * for the same reason — an empty list tells the user nothing.
 *
 * The names are action-neutral because both `mcp add` and `mcp remove` report
 * through them: `Changed` is "installed" or "removed" depending on the flow.
 */

export enum McpClientStatus {
  /** We made the change — wrote the config, installed or removed the server. */
  Changed = 'changed',
  /** Already in the requested state; nothing was touched. */
  Unchanged = 'unchanged',
  Failed = 'failed',
}

export interface McpClientResult {
  name: string;
  status: McpClientStatus;
  /** Short, user-facing explanation. Set for failures. */
  detail?: string;
}

/** Result shape every client's addServer/removeServer/installPlugin returns. */
export interface InstallResult {
  success: boolean;
  /** Already in the requested state — nothing was written or removed. */
  alreadyInstalled?: boolean;
  /** Raw failure text from the underlying CLI or filesystem error. */
  reason?: string;
}

/**
 * Failure text comes from CLIs we invoke with the user's personal API key on the
 * command line (`--header "Authorization: Bearer phx_..."`), so it can carry the
 * key into the log file, the TUI and exception reports. Mask it first.
 */
export const redactSecrets = (raw: string): string =>
  raw
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/ph[xspc]_[A-Za-z0-9_-]+/g, '[redacted]');

/**
 * Replace the user's home directory with `~`. Error tracking fingerprints on
 * the message, so a path that differs per user splits one root cause into one
 * issue per user — and the username itself never needs to leave the machine.
 */
export const scrubHomePaths = (raw: string): string =>
  raw
    .replace(/\/(?:Users|home)\/[^/\s'"]+/g, '~')
    .replace(/[A-Za-z]:\\Users\\[^\\\s'"]+/gi, '~');

/**
 * A failure that lives entirely in the user's environment: a CLI too old, a
 * broken install, an unreadable config. We can't fix these, so we hand back a
 * hint instead of filing an issue nobody can action.
 */
export interface ExpectedFailure {
  match: RegExp;
  /** One short line, shown to the user as the failure detail. */
  hint: string;
}

/** The first matching hint, or undefined when the failure is worth reporting. */
export const expectedFailureHint = (
  text: string,
  table: ExpectedFailure[],
): string | undefined =>
  text.trim() ? table.find((f) => f.match.test(text))?.hint : undefined;

/** First non-empty line of an error, trimmed to something a TUI line can hold. */
export const summarizeFailure = (raw?: string): string | undefined => {
  const line = redactSecrets(raw ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return undefined;
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
};

export const toClientResult = (
  name: string,
  result: InstallResult | undefined,
): McpClientResult => {
  if (!result?.success) {
    return {
      name,
      status: McpClientStatus.Failed,
      detail: summarizeFailure(result?.reason),
    };
  }
  return {
    name,
    status: result.alreadyInstalled
      ? McpClientStatus.Unchanged
      : McpClientStatus.Changed,
  };
};

export const isOk = (r: McpClientResult): boolean =>
  r.status !== McpClientStatus.Failed;

export const namesWithStatus = (
  results: McpClientResult[],
  status: McpClientStatus,
): string[] => results.filter((r) => r.status === status).map((r) => r.name);
