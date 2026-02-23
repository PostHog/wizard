import type { Integration } from './constants';
import type { WizardOptions } from '../utils/types';
import type { PackageManagerDetector } from './package-manager-detection';

/**
 * Configuration interface for framework-specific agent integrations.
 * Each framework exports a FrameworkConfig that the universal runner uses.
 *
 * The TContext generic represents the framework-specific context gathered
 * before the agent runs (e.g., router type for Next.js, project type for Django).
 * The runner threads this opaquely — all framework-specific logic stays inside the config.
 */
export interface FrameworkConfig<
  TContext extends Record<string, unknown> = Record<string, unknown>,
> {
  metadata: FrameworkMetadata<TContext>;
  detection: FrameworkDetection;
  environment: EnvironmentConfig;
  analytics: AnalyticsConfig<TContext>;
  prompts: PromptConfig<TContext>;
  ui: UIConfig<TContext>;
}

/**
 * Basic framework information and documentation
 */
export interface FrameworkMetadata<
  TContext extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Display name (e.g., "Next.js", "React") */
  name: string;

  /** Integration type from constants */
  integration: Integration;

  /** URL to framework-specific PostHog docs */
  docsUrl: string;

  /**
   * Optional URL to docs for users with unsupported framework versions.
   * If not provided, defaults to docsUrl.
   */
  unsupportedVersionDocsUrl?: string;

  /** If true, shows a beta notice before running the wizard. */
  beta?: boolean;

  /** Optional notice shown before the agent runs (e.g., "Close Xcode before proceeding"). */
  preRunNotice?: string;

  /**
   * Optional function to gather framework-specific context before agent runs.
   * For Next.js: detects router type
   * For React Native: detects Expo vs bare
   */
  gatherContext?: (options: WizardOptions) => Promise<TContext>;

  /** Optional additional MCP servers for this framework (e.g., Svelte MCP). */
  additionalMcpServers?: Record<string, { url: string }>;
}

/**
 * Framework detection and version handling
 */
export interface FrameworkDetection {
  /** Package name to check in package.json (e.g., "next", "react") */
  packageName: string;

  /** Human-readable name for error messages (e.g., "Next.js") */
  packageDisplayName: string;

  /** Extract version from package.json */
  getVersion: (packageJson: unknown) => string | undefined;

  /** Optional: Convert version to analytics bucket (e.g., "15.x") */
  getVersionBucket?: (version: string) => string;

  /**
   * Whether this framework uses package.json (Node.js/JavaScript).
   * If false, skips package.json checks (for Python, Go, etc.)
   * Defaults to true if not specified.
   */
  usesPackageJson?: boolean;

  /** Minimum supported version. If set, runner checks before proceeding. */
  minimumVersion?: string;

  /** Get the currently installed version. Called by runner for version check. */
  getInstalledVersion?: (options: WizardOptions) => Promise<string | undefined>;

  /** Detect whether this framework is present in the project. */
  detect: (options: Pick<WizardOptions, 'installDir'>) => Promise<boolean>;

  /** Detect the project's package manager(s). Used by the in-process MCP tool. */
  detectPackageManager: PackageManagerDetector;
}

/**
 * Environment variable configuration
 */
export interface EnvironmentConfig {
  /** Whether to upload env vars to hosting providers post-agent */
  uploadToHosting: boolean;

  /**
   * Build the environment variables object for this framework.
   * Returns the exact variable names and values to upload to hosting providers.
   */
  getEnvVars: (apiKey: string, host: string) => Record<string, string>;
}

/**
 * Analytics configuration
 */
export interface AnalyticsConfig<
  TContext extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Generate tags from context (e.g., { 'nextjs-version': '15.x', 'router': 'app' }) */
  getTags: (context: TContext) => Record<string, string>;

  /** Optional: Additional event properties */
  getEventProperties?: (context: TContext) => Record<string, string>;
}

/**
 * Default package installation instruction used when frameworks don't
 * provide their own. Frameworks with specific needs (e.g., Swift SPM,
 * Composer) override this in their config.
 */
export const DEFAULT_PACKAGE_INSTALLATION =
  'Use the detect_package_manager tool to determine the package manager. Do not manually edit package.json; the package manager handles it automatically.';

export const PYTHON_PACKAGE_INSTALLATION =
  'Use the detect_package_manager tool to determine the package manager. If the detected tool manages dependencies directly (e.g. uv add, poetry add), use it — it will update the manifest automatically. If using pip, you must also add the dependency to requirements.txt or the appropriate manifest file.';

/**
 * Prompt configuration
 */
export interface PromptConfig<
  TContext extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * Optional: Additional context lines to append to base prompt
   * For Next.js: "- Router: app"
   * For React Native: "- Platform: Expo"
   */
  getAdditionalContextLines?: (context: TContext) => string[];

  /**
   * How to detect the project type for this framework.
   * Included in the agent prompt as project context.
   * e.g., "Look for package.json and lockfiles" or "Look for requirements.txt and manage.py"
   */
  projectTypeDetection: string;

  /**
   * How to install packages for this framework.
   * Included in the agent prompt as project context.
   * Defaults to DEFAULT_PACKAGE_INSTALLATION. Only override if the framework
   * has specific installation guidance (e.g., Swift SPM, Composer).
   */
  packageInstallation?: string;
}

/**
 * UI messaging configuration
 */
export interface UIConfig<
  TContext extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Success message when agent completes */
  successMessage: string;

  /** Estimated time for agent to complete (in minutes) */
  estimatedDurationMinutes: number;

  /** Generate "What the agent did" bullets from context */
  getOutroChanges: (context: TContext) => string[];

  /** Generate "Next steps" bullets from context */
  getOutroNextSteps: (context: TContext) => string[];
}

/**
 * Generate welcome message from framework name
 */
export function getWelcomeMessage(frameworkName: string): string {
  return `PostHog ${frameworkName} wizard (agent-powered)`;
}

/**
 * Shared spinner message for all frameworks
 */
export const SPINNER_MESSAGE =
  'Writing your PostHog setup with events, error capture and more...';
