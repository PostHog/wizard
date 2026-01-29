import type { Integration } from './constants';
import type { WizardOptions } from '../utils/types';

/**
 * Configuration interface for framework-specific agent integrations.
 * Each framework exports a FrameworkConfig that the universal runner uses.
 */
export interface FrameworkConfig {
  metadata: FrameworkMetadata;
  detection: FrameworkDetection;
  environment: EnvironmentConfig;
  analytics: AnalyticsConfig;
  prompts: PromptConfig;
  ui: UIConfig;
}

/**
 * Basic framework information and documentation
 */
export interface FrameworkMetadata {
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

  /**
   * Optional function to gather framework-specific context before agent runs.
   * For Next.js: detects router type
   * For React Native: detects Expo vs bare
   */
  gatherContext?: (options: WizardOptions) => Promise<Record<string, any>>;
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
  getVersion: (packageJson: any) => string | undefined;

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
export interface AnalyticsConfig {
  /** Generate tags from context (e.g., { 'nextjs-version': '15.x', 'router': 'app' }) */
  getTags: (context: any) => Record<string, any>;

  /** Optional: Additional event properties */
  getEventProperties?: (context: any) => Record<string, any>;
}

/**
 * Prompt configuration
 */
export interface PromptConfig {
  /**
   * Optional: Additional context lines to append to base prompt
   * For Next.js: "- Router: app"
   * For React Native: "- Platform: Expo"
   */
  getAdditionalContextLines?: (context: any) => string[];

  /**
   * How to detect the project type for this framework.
   * e.g., "Look for package.json and lockfiles" or "Look for requirements.txt and manage.py"
   */
  projectTypeDetection: string;

  /**
   * How to install packages for this framework.
   * e.g., "Use npm/yarn/pnpm based on lockfile" or "Use pip/poetry based on config files"
   */
  packageInstallation: string;
}

/**
 * UI messaging configuration
 */
export interface UIConfig {
  /** Success message when agent completes */
  successMessage: string;

  /** Estimated time for agent to complete (in minutes) */
  estimatedDurationMinutes: number;

  /** Generate "What the agent did" bullets from context */
  getOutroChanges: (context: any) => string[];

  /** Generate "Next steps" bullets from context */
  getOutroNextSteps: (context: any) => string[];
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
