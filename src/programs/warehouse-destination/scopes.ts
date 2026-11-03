/**
 * Extra scopes the warehouse-destination program needs on top of
 * `WIZARD_OAUTH_SCOPES`:
 *   • external_data_source:read / :write — warehouse destinations use the
 *     `external_data_source` scope object: the connect link and its status
 *     (read), creating a destination and attaching sources (write).
 *   • batch_export:read / :write — create the events export and check it.
 *   • integration:read — read the saved integration's kind and name.
 *
 * All are unprivileged; the wizard OAuth app's scope ceiling must hold them.
 */
export const WAREHOUSE_DESTINATION_SCOPE_ADDITIONS = [
  'integration:read',
  'batch_export:read',
  'batch_export:write',
  'external_data_source:read',
  'external_data_source:write',
] as const;
