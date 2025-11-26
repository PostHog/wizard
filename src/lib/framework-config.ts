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

  /** Message shown when user declines AI consent */
  abortMessage: string;

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
}

/**
 * Environment variable configuration
 */
export interface EnvironmentConfig {
  /** Whether to upload env vars to hosting providers post-agent */
  uploadToHosting: boolean;

  /**
   * Base names to search for when uploading (e.g., ['POSTHOG_KEY', 'POSTHOG_HOST'])
   * Wizard will scan .env for vars ending with these names
   */
  expectedEnvVarSuffixes: string[];
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
}

/**
 * UI messaging configuration
 */
export interface UIConfig {
  /** Welcome message for wizard start */
  welcomeMessage: string;

  /** Spinner message while agent runs */
  spinnerMessage: string;

  /** Success message when agent completes */
  successMessage: string;

  /** Estimated time for agent to complete (in minutes) */
  estimatedDurationMinutes: number;

  /** Generate "What the agent did" bullets from context */
  getOutroChanges: (context: any) => string[];

  /** Generate "Next steps" bullets from context */
  getOutroNextSteps: (context: any) => string[];
}
