// OAuth scope sets shared by programs and tools: a base set widened by additions.

/**
 * Extra scope the Connect-Slack step needs on top of `WIZARD_OAUTH_SCOPES`.
 *
 * The step polls `/api/projects/:id/integrations/` (`fetchSlackConnected`)
 * to render the already-connected variant and to flip live once the user
 * completes the Slack OAuth step in the browser. Without `integration:read`
 * the first poll 403s, the screen stops polling, and an already-connected
 * project is nagged with the connect nudge. Used by the default integration
 * run (the step ends the run) and by the `wizard slack` tool (the step is
 * the whole flow).
 */
export const CONNECT_SLACK_SCOPE_ADDITIONS = ['integration:read'] as const;

/** `base` then `additions`, deduped, base first. */
export function withScopeAdditions(
  base: readonly string[],
  additions: readonly string[] | undefined,
): readonly string[] {
  if (!additions || additions.length === 0) {
    return base;
  }
  return [...new Set([...base, ...additions])];
}
