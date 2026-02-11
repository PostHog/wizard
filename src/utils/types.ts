export type PostHogProjectData = Record<string, unknown>;

export type PreselectedProject = {
  project: PostHogProjectData;
  authToken: string;
};

export type WizardOptions = {
  /**
   * Whether to enable debug mode.
   */
  debug: boolean;

  /**
   * Whether to force install the SDK package to continue with the installation in case
   * any package manager checks are failing (e.g. peer dependency versions).
   *
   * Use with caution and only if you know what you're doing.
   *
   * Does not apply to all wizard flows (currently NPM only)
   */
  forceInstall: boolean;

  /**
   * The directory to run the wizard in.
   */
  installDir: string;

  /**
   * The cloud region to use.
   */
  cloudRegion?: CloudRegion;

  /**
   * Whether to select the default option for all questions automatically.
   */
  default: boolean;

  /**
   * Whether to create a new PostHog account during setup.
   */
  signup: boolean;

  /**
   * Whether to use the local MCP server at http://localhost:8787/mcp
   */
  localMcp: boolean;

  /**
   * CI mode - non-interactive execution
   */
  ci: boolean;

  /**
   * Personal API key (phx_xxx) - used for LLM gateway auth, skips OAuth
   */
  apiKey?: string;

  /**
   * Whether to show the menu for manual integration selection instead of auto-detecting.
   */
  menu: boolean;

  /**
   * Whether to run in benchmark mode with per-phase token tracking.
   * When enabled, the wizard runs each workflow phase as a separate agent call
   * and writes detailed usage data to /tmp/posthog-wizard-benchmark.json.
   */
  benchmark: boolean;
};

export interface Feature {
  id: string;
  prompt: string;
  enabledHint?: string;
  disabledHint?: string;
}

export type FileChange = {
  filePath: string;
  oldContent?: string;
  newContent: string;
};

export type CloudRegion = 'us' | 'eu';

export type AIModel =
  | 'gpt-5-mini'
  | 'o4-mini'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro';
