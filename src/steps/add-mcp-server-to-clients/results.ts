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
 *
 * The plugin stages clone git repositories and read the user's own config, so
 * the text reaching here is no longer only ours: a failing clone echoes the
 * remote URL with any credentials embedded in it, and a config error can quote
 * a foreign provider's key. Each pattern below is a shape we have seen a CLI
 * print, not a guess at every possible secret.
 */
export const redactSecrets = (raw: string): string =>
  raw
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/ph[xspc]_[A-Za-z0-9_-]+/g, '[redacted]')
    // `https://user:token@github.com/...` — git prints the whole remote back.
    .replace(/(\bhttps?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[redacted]@')
    // GitHub tokens, which a clone failure quotes verbatim.
    .replace(/\bgh[pousr]_[A-Za-z0-9]{16,}/g, '[redacted]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[redacted]')
    // OpenAI keys: `OPENAI_API_KEY` is already a failure codex reports on.
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '[redacted]')
    // Google keys, which a config error quotes the same way.
    .replace(/\bAIza[A-Za-z0-9_-]{16,}/g, '[redacted]')
    // The catch-all for providers we have no shape for: a config error prints
    // the offending line, and the variable's own name says it holds a secret.
    // The name is kept — `OPENAI_API_KEY` is wording an expected-failure hint
    // matches on, and masking it would turn that hint back into an exception.
    .replace(
      /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)[A-Za-z0-9_]*)(\s*[=:]\s*)["']?[A-Za-z0-9_\-./+]{8,}["']?/gi,
      '$1$2[redacted]',
    );

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
 *
 * Silencing a failure is the expensive direction: a pattern that matches too
 * much retires a real bug of ours into a hint nobody reads. So an entry says
 * where it applies (`stages`) and what disqualifies it (`unless`), and anything
 * it cannot claim confidently goes back to being reported.
 */
export interface ExpectedFailure {
  match: RegExp;
  /**
   * Stages this hint is allowed to fire on. Omitted means any stage. Wording
   * that means one thing during `plugin install` can mean something else during
   * `mcp add`, and a hint naming the wrong command is worse than none.
   */
  stages?: string[];
  /**
   * Wording that disqualifies the match even when `match` hits — the tell that
   * the failure is ours, not the environment's.
   */
  unless?: RegExp;
  /** One short line, shown to the user as the failure detail. */
  hint: string;
}

/**
 * The first matching hint, or undefined when the failure is worth reporting.
 *
 * `stage` is the caller's name for what it was doing. Passing it lets an entry
 * narrow itself; omitting it only considers entries that claim every stage,
 * because an unscoped call cannot honour a scoped entry.
 */
export const expectedFailureHint = (
  text: string,
  table: ExpectedFailure[],
  stage?: string,
): string | undefined => {
  if (!text.trim()) return undefined;
  return table.find(
    (f) =>
      (f.stages === undefined ||
        (stage !== undefined && f.stages.includes(stage))) &&
      f.match.test(text) &&
      !f.unless?.test(text),
  )?.hint;
};

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
