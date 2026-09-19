/**
 * Data warehouse source detection — typed config surface.
 *
 * A `SourceDetector` is pure data: a codebase signal mapped to a PostHog
 * source-type `kind` and the mode the wizard uses to set it up. The detection
 * loop and the program machinery don't know what any individual source is —
 * they execute against this registry. Adding a source is one registry entry.
 */

/**
 * How the wizard sets up a detected source.
 *
 * - `in-cli`: the agent collects credentials interactively and creates the
 *   source via the PostHog MCP (`external-data-sources-create`). Suitable for
 *   databases and API-key SaaS. Requires an interactive session.
 * - `deep-link`: the wizard opens the app's pre-filled new-source flow in the
 *   browser. Used for OAuth SaaS and anything we can't safely create from a
 *   terminal. Works for every source type.
 */
export type SourceCreationMode = 'in-cli' | 'deep-link';

export interface SourceSignals {
  /** package.json dependency names (deps + devDeps), e.g. ['pg', 'postgres']. */
  npm?: string[];
  /**
   * Python dependency names as normalized by the parsers in
   * `@lib/detection/features` (lowercased, `_`→`-`), e.g. ['psycopg', 'psycopg2'].
   */
  python?: string[];
  /** Gemfile gem names, e.g. ['pg']. */
  ruby?: string[];
  /** `.env` key-NAME patterns (values are never read), e.g. [/^DATABASE_URL$/]. */
  envKeys?: RegExp[];
}

export interface SourceDetector {
  /**
   * PostHog source-type name. MUST match the names returned by the MCP
   * `external-data-sources-wizard` tool (e.g. 'Postgres', 'MySQL', 'Stripe') —
   * this string is used both for the deep-link `?kind=` param and the
   * `external-data-sources-create` `source_type` field.
   */
  kind: string;
  /** Human-readable label for screens, e.g. 'PostgreSQL'. */
  label: string;
  mode: SourceCreationMode;
  signals: SourceSignals;
}

export interface DetectedSource {
  kind: string;
  label: string;
  mode: SourceCreationMode;
  /** Human-readable description of what triggered the match, for display. */
  matchedSignal: string;
}
