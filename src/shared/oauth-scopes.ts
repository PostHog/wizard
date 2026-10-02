/**
 * Extra scope the Connect-Slack step needs on top of `WIZARD_OAUTH_SCOPES`.
 *
 * The step polls `/api/projects/:id/integrations/` (`fetchSlackConnected`)
 * to render the already-connected variant and to flip live once the user
 * completes the Slack OAuth step in the browser. Without `integration:read`
 * the first poll 403s, the screen stops polling, and an already-connected
 * project is nagged with the connect nudge. Used by the default integration
 * run (the step ends the run) and by the standalone `wizard slack` flow
 * (the step is the whole program).
 */
export const CONNECT_SLACK_SCOPE_ADDITIONS = ['integration:read'] as const;
