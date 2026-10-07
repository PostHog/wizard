/**
 * Extra scopes the MCP tutorial needs on top of `WIZARD_OAUTH_SCOPES`.
 *
 * Every scope requested here must stay within the wizard OAuth app's
 * ceiling on the PostHog side (`OAuthApplication.scopes`) — the full
 * list lives in the README under "OAuth app scope ceiling". The
 * tutorial's prompts and follow-ups touch most of the read surface,
 * plus annotation write for the "PostHog wizard install" verify-prompt.
 *
 * Already in the base `WIZARD_OAUTH_SCOPES` (and therefore not
 * repeated here):
 *   • user:read, project:read, llm_gateway:read   — auth + gateway
 *   • query:read                                  — HogQL
 *   • dashboard:write, insight:write, notebook:write  — Phase-5 persist
 *
 * Deliberately omitted (writes on read-only product surfaces):
 *   • feature_flag:write, experiment:write, survey:write,
 *     cohort:write, session_recording:write, error_tracking:write,
 *     alert:write, subscription:write
 */
export const MCP_TUTORIAL_SCOPE_ADDITIONS = [
  // Explicit reads on the persistence surfaces. `*:write` usually
  // implies read on PostHog, but the consent flow grants exactly the
  // strings requested — explicit reads avoid a 403 when the agent
  // lists existing dashboards/insights/notebooks before saving.
  'dashboard:read',
  'insight:read',
  'notebook:read',

  // Read on every product surface the tutorial demos.
  'feature_flag:read',
  'experiment:read',
  'experiment_saved_metric:read',
  'survey:read',
  'session_recording:read',
  'error_tracking:read',
  'web_analytics:read',
  'llm_analytics:read',
  'cohort:read',
  'person:read',

  // Annotation read + write — the verify prompt's "annotate today"
  // is the only mutation the tutorial performs outside the
  // dashboard/insight/notebook persistence triplet.
  'annotation:read',
  'annotation:write',

  // Metadata / exploration reads — for "break down by user property",
  // "did that change land alongside a deploy", autocapture actions,
  // etc. Otherwise the agent 403s on the supporting catalog calls
  // even though the parent query has `query:read`.
  'activity_log:read',
  'property_definition:read',
  'event_definition:read',
  'action:read',

  // Data warehouse reads — for the data-role cross-sells that join
  // event data with Stripe / Salesforce / S3.
  'warehouse_table:read',
  'warehouse_view:read',

  // Inspection-only — we don't write alerts or subscriptions, but the
  // model might want to read existing ones (e.g. "is there already an
  // alert on this metric?").
  'alert:read',
  'subscription:read',
  'integration:read',
] as const;
