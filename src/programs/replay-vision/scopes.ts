/**
 * Extra scopes the replay-vision program needs on top of `WIZARD_OAUTH_SCOPES`.
 * The same set self-driving's step 6c uses, narrowed to just this flow:
 *   • replay_scanner:read / replay_scanner:write — the scanner tasks list the
 *     team's existing scanners and create the ones scoped to the product's key
 *     flows (`vision-scanners-list` / `-create`, plus the advisory
 *     `vision-scanners-estimate-create` / `vision-quota-retrieve`). The scope
 *     OBJECT is `replay_scanner`; `vision-scanners-*` are MCP tool names.
 *   • session_recording:read — the scanner API pairs it with
 *     `replay_scanner:*`, since a scanner's config indirectly exposes
 *     recording contents. Configuring a scanner fails without it.
 *   • product_enablement:write — the enable-replay task's server half turns on
 *     Session Replay (`products-enable`) so there are recordings to scan.
 *
 * Without these the PostHog MCP omits the tools from the catalog it serves
 * this token, every scanner task takes its "tool unknown" skip path, and the
 * run reports success having created nothing (run 69afc6f8).
 *
 * No OAuth-ceiling edit needed — all are unprivileged public scope objects
 * covered by the apps' `@default` sentinel, and self-driving already requests
 * every one of them.
 */
export const REPLAY_VISION_SCOPE_ADDITIONS = [
  'session_recording:read',
  'product_enablement:write',
  'replay_scanner:read',
  'replay_scanner:write',
] as const;
