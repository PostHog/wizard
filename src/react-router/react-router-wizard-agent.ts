/* React Router wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { enableDebugLogs } from '../utils/debug';
import { runAgentWizard } from '../lib/agent-runner';
import { Integration } from '../lib/constants';
import { getPackageVersion } from '../utils/package-json';
import { getPackageDotJson } from '../utils/clack-utils';
import clack from '../utils/clack';
import chalk from 'chalk';
import * as semver from 'semver';
import {
  getReactRouterMode,
  getReactRouterModeName,
  getReactRouterVersionBucket,
  ReactRouterMode,
} from './utils';

/**
 * React Router framework configuration for the universal agent runner.
 */
const MINIMUM_REACT_ROUTER_VERSION = '6.0.0';

const REACT_ROUTER_AGENT_CONFIG: FrameworkConfig = {
  metadata: {
    name: 'React Router',
    integration: Integration.reactRouter,
    docsUrl: 'https://posthog.com/docs/libraries/react',
    unsupportedVersionDocsUrl: 'https://posthog.com/docs/libraries/react',
    gatherContext: async (options: WizardOptions) => {
      const routerMode = await getReactRouterMode(options);
      return { routerMode };
    },
  },

  detection: {
    packageName: 'react-router',
    packageDisplayName: 'React Router',
    getVersion: (packageJson: any) =>
      getPackageVersion('react-router', packageJson),
    getVersionBucket: getReactRouterVersionBucket,
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: (apiKey: string, host: string) => ({
      REACT_APP_POSTHOG_KEY: apiKey,
      REACT_APP_POSTHOG_HOST: host,
    }),
  },

  analytics: {
    getTags: (context: any) => {
      const routerMode = context.routerMode as ReactRouterMode;
      return {
        routerMode: routerMode || 'unknown',
      };
    },
  },

  prompts: {
    projectTypeDetection:
      'This is a JavaScript/TypeScript project. Look for package.json and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.',
    packageInstallation:
      'Look for lockfiles to determine the package manager (npm, yarn, pnpm, bun). Do not manually edit package.json.',
    getAdditionalContextLines: (context: any) => {
      const routerMode = context.routerMode as ReactRouterMode;
      const modeName = routerMode
        ? getReactRouterModeName(routerMode)
        : 'unknown';

      // Map router mode to framework ID for MCP docs resource
      const frameworkIdMap: Record<ReactRouterMode, string> = {
        [ReactRouterMode.V6]: 'react-react-router-6',
        [ReactRouterMode.V7_FRAMEWORK]: 'react-react-router-7-framework',
        [ReactRouterMode.V7_DATA]: 'react-react-router-7-data',
        [ReactRouterMode.V7_DECLARATIVE]: 'react-react-router-7-declarative',
      };

      const frameworkId = routerMode
        ? frameworkIdMap[routerMode]
        : ReactRouterMode.V7_FRAMEWORK;

      return [
        `Router mode: ${modeName}`,
        `Framework docs ID: ${frameworkId} (use posthog://docs/frameworks/${frameworkId} for documentation)`,
      ];
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 8,
    getOutroChanges: (context: any) => {
      const routerMode = context.routerMode as ReactRouterMode;
      const modeName = routerMode
        ? getReactRouterModeName(routerMode)
        : 'React Router';
      return [
        `Analyzed your React Router project structure (${modeName})`,
        `Created and configured PostHog initializers`,
        `Integrated PostHog into your application`,
      ];
    },
    getOutroNextSteps: () => [
      'Start your development server to see PostHog in action',
      'Visit your PostHog dashboard to see incoming events',
    ],
  },
};

/**
 * React Router wizard powered by the universal agent runner.
 */
export async function runReactRouterWizardAgent(
  options: WizardOptions,
): Promise<void> {
  if (options.debug) {
    enableDebugLogs();
  }

  // Check React Router version - agent wizard requires >= 6.0.0
  const packageJson = await getPackageDotJson(options);
  const reactRouterVersion = getPackageVersion('react-router', packageJson);

  if (reactRouterVersion) {
    const coercedVersion = semver.coerce(reactRouterVersion);
    if (
      coercedVersion &&
      semver.lt(coercedVersion, MINIMUM_REACT_ROUTER_VERSION)
    ) {
      const docsUrl =
        REACT_ROUTER_AGENT_CONFIG.metadata.unsupportedVersionDocsUrl ??
        REACT_ROUTER_AGENT_CONFIG.metadata.docsUrl;

      clack.log.warn(
        `Sorry: the wizard can't help you with React Router ${reactRouterVersion}. Upgrade to React Router ${MINIMUM_REACT_ROUTER_VERSION} or later, or check out the manual setup guide.`,
      );
      clack.log.info(`Setup React Router manually: ${chalk.cyan(docsUrl)}`);
      clack.outro('PostHog wizard will see you next time!');
      return;
    }
  }

  await runAgentWizard(REACT_ROUTER_AGENT_CONFIG, options);
}
