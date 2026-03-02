/**
 * WizardSession — single source of truth for every decision the wizard needs.
 *
 * Populated in layers:
 *   CLI args / env vars  →  populate fields directly
 *   Auto-detection       →  framework, typescript, package manager
 *   TUI screens          →  region, framework disambiguation, etc.
 *   OAuth                →  credentials
 *
 * Business logic reads from the session. Never calls a prompt.
 */

import type { Integration } from './constants';
import type { FrameworkConfig } from './framework-config';

export type CloudRegion = 'us' | 'eu';

export interface OutroData {
  kind: 'success' | 'error' | 'cancel';
  message?: string;
  changes?: string[];
  nextSteps?: string[];
  docsUrl?: string;
  continueUrl?: string;
}

export interface WizardSession {
  // From CLI args
  debug: boolean;
  forceInstall: boolean;
  installDir: string;
  ci: boolean;
  signup: boolean;
  localMcp: boolean;
  apiKey?: string;
  menu: boolean;

  // From detection + screens
  cloudRegion: CloudRegion | null;
  integration: Integration | null;
  frameworkContext: Record<string, unknown>;
  typescript: boolean;

  // From OAuth
  credentials: {
    accessToken: string;
    projectApiKey: string;
    host: string;
    projectId: number;
  } | null;

  // Runtime
  serviceStatus: { description: string; statusPageUrl: string } | null;
  outroData: OutroData | null;

  // Resolved framework config (set after integration is known)
  frameworkConfig: FrameworkConfig | null;
}

/**
 * Build a WizardSession from CLI args, pre-populating whatever is known.
 */
export function buildSession(args: {
  debug?: boolean;
  forceInstall?: boolean;
  installDir?: string;
  ci?: boolean;
  signup?: boolean;
  localMcp?: boolean;
  apiKey?: string;
  menu?: boolean;
  region?: CloudRegion;
  integration?: Integration;
}): WizardSession {
  return {
    debug: args.debug ?? false,
    forceInstall: args.forceInstall ?? false,
    installDir: args.installDir ?? process.cwd(),
    ci: args.ci ?? false,
    signup: args.signup ?? false,
    localMcp: args.localMcp ?? false,
    apiKey: args.apiKey,
    menu: args.menu ?? false,

    cloudRegion: args.region ?? null,
    integration: args.integration ?? null,
    frameworkContext: {},
    typescript: false,

    credentials: null,
    serviceStatus: null,
    outroData: null,
    frameworkConfig: null,
  };
}
