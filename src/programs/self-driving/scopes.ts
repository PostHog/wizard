/**
 * Extra scopes the self-driving program needs on top of
 * `WIZARD_OAUTH_SCOPES`. All consumed by the PostHog MCP tools the
 * agent drives during the run:
 *   • task:read / task:write — the signal source config API
 *     (`inbox-source-configs-*`) is permissioned under the generic
 *     `task` scope object, NOT a signals-specific one. Unrelated to
 *     the Tasks product.
 *   • integration:read — `integrations-list`, to check whether the
 *     team already has a GitHub integration and to verify the connect
 *     flow completed.
 *   • signal_scout:read / signal_scout:write — list, sync, and tune
 *     the Signals scout troop (`signals-scout-config-*`).
 *   • session_recording:read / survey:read / error_tracking:read —
 *     server-side product-usage probes (`query-session-recordings-list`,
 *     `survey-list`, `error-issue-list`). Product usage is a
 *     project-level fact (often instrumented in another repo or via
 *     the snippet), so the agent asks the server instead of inferring
 *     only from the local setup report. All three are read-only and
 *     already in the wizard OAuth app's production scope ceiling (the
 *     mcp-tutorial program requests them).
 *   • external_data_source:read / external_data_source:write — the
 *     connected-tools step creates the GitHub Issues / Linear warehouse
 *     sources directly (`external-data-sources-create`) and verifies
 *     what's actually connected (`external-data-sources-list`) instead
 *     of taking the user's word for it.
 *   • llm_skill:read / llm_skill:write — the custom-scouts step
 *     (skill step 6b): read the seeded `authoring-signals-scouts`
 *     guide and canonical scout bodies (`llma-skill-get` /
 *     `llma-skill-file-get`) and author the user-approved custom
 *     `signals-scout-*` skills (`llma-skill-create`). Canonical scout
 *     bodies are never edited.
 *   • product_enablement:write — the "Enable products" step turns on
 *     Session Replay / Error Tracking / Support so their sources have
 *     data to read (`products-enable`). A purpose-built scope: the
 *     server owns each enable recipe, so this can flip the product
 *     toggles without the far broader `project:write`.
 *   • replay_scanner:read / replay_scanner:write — the Replay Vision
 *     scanners step (skill step 6c) lists the team's existing scanners
 *     and creates the `emits_signals` ones whose findings land in the
 *     inbox (`vision-scanners-list` / `-create` / `-update`, and the
 *     advisory `vision-scanners-estimate-create` / `vision-quota-retrieve`).
 *     The scope OBJECT is `replay_scanner` — the `vision-scanners-*`
 *     names are MCP tool names, not scopes. Configuring a scanner also
 *     requires `session_recording:read` (the API pairs the two, since a
 *     scanner's config indirectly exposes recording contents); that one
 *     is already in this list for the step-2 usage probes.
 *
 * No OAuth-ceiling edit is needed for any scope here: they are all normal
 * public (unprivileged, non-internal, non-hidden) scope objects, and the
 * live wizard apps' ceiling is the `@default` sentinel, which resolves to
 * every such scope (`UNPRIVILEGED_SCOPES`) and auto-tracks new ones. Only a
 * privileged/internal/hidden object (e.g. `llm_gateway:*`) would need a
 * manual per-app edit. See README → "OAuth app scope ceiling".
 */
export const SELF_DRIVING_SCOPE_ADDITIONS = [
  'task:read',
  'task:write',
  'integration:read',
  'signal_scout:read',
  'signal_scout:write',
  'session_recording:read',
  'survey:read',
  'error_tracking:read',
  'external_data_source:read',
  'external_data_source:write',
  'llm_skill:read',
  'llm_skill:write',
  'product_enablement:write',
  'replay_scanner:read',
  'replay_scanner:write',
] as const;
