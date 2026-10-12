/**
 * Data warehouse source detection — typed config surface.
 *
 * A `SourceDetector` is pure data: a codebase signal mapped to a tool `kind`,
 * the PostHog source type it imports as, and the mode the wizard uses to set it
 * up. The detection loop and the program machinery don't know what any
 * individual source is — they execute against this registry. The registry is
 * generated from PostHog's tool catalog; see `registry.generated.ts`.
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

/** Schema of PostHog's tool catalog JSON (`products/wizard/tool-catalog.generated.json`). */
export type ToolCatalog = {
  schema_version: 1;
  tools: CatalogTool[];
};

export type CatalogTool = {
  kind: string;
  label: string;
  warehouse_source_type: string | null;
  /** Null for tools the wizard only detects and reports, such as competitors with no warehouse connector. */
  wizard_setup_mode: SourceCreationMode | null;
  competes_with: string[];
  superseded_by: string[];
  signals: {
    /** Anchored regex sources matched against `.env` key NAMES. */
    env_key_patterns: string[];
    /** Hostnames matched against script URLs, including subdomains. */
    script_hosts: string[];
    /** Package names keyed by ecosystem (`npm`, `pypi`, `rubygems`, ...). Unknown ecosystems match nothing. */
    packages: Record<string, string[]>;
  };
};

export interface SourceSignals {
  /** `.env` key-NAME patterns (values are never read), e.g. [/^DATABASE_URL$/]. */
  envKeys: readonly RegExp[];
  /** Third-party script hostnames, e.g. ['static.hotjar.com']. */
  scriptHosts: readonly string[];
  /**
   * Package names keyed by ecosystem, e.g. `{ npm: ['pg'], pypi: ['psycopg2'] }`.
   * Python names are normalized like the parsers in `@programs/detection/features`
   * (lowercased, `_`→`-`).
   */
  packages: Readonly<Record<string, readonly string[]>>;
}

export interface SourceDetector {
  /** Tool identifier, unique across the registry, e.g. 'Postgres' or 'Statsig'. */
  kind: string;
  /** Human-readable label for screens, e.g. 'PostgreSQL'. */
  label: string;
  /**
   * PostHog source-type name, used both for the deep-link `?kind=` param and the
   * `external-data-sources-create` `source_type` field. Null for a tool with no
   * warehouse connector.
   */
  warehouseSourceType: string | null;
  /** Null for a tool the wizard detects but never offers as a warehouse source. */
  mode: SourceCreationMode | null;
  signals: SourceSignals;
  /**
   * Kinds that reach the same data as this one through a more specific
   * connector. When any of them also matches, this detector is dropped: a
   * generic database signal and the hosted provider serving that database are
   * one database, and offering both imports it twice.
   */
  supersededBy?: readonly string[];
}

export interface DetectedSource {
  /** The PostHog source type this project can import from. */
  kind: string;
  label: string;
  mode: SourceCreationMode;
  /** Human-readable description of what triggered the match, for display. */
  matchedSignal: string;
}
