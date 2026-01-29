/* React Router wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { runAgentWizard } from '../lib/agent-runner';
import { Integration } from '../lib/constants';
import {
  getPackageVersion,
  hasPackageInstalled,
  type PackageDotJson,
} from '../utils/package-json';
import { getPackageDotJson, tryGetPackageJson } from '../utils/clack-utils';
import {
  getReactRouterMode,
  getReactRouterModeName,
  getReactRouterVersionBucket,
  ReactRouterMode,
} from './utils';

type ReactRouterContext = {
  routerMode?: ReactRouterMode;
};

export const REACT_ROUTER_AGENT_CONFIG: FrameworkConfig<ReactRouterContext> = {
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
    getVersion: (packageJson: unknown) =>
      getPackageVersion('react-router', packageJson as PackageDotJson),
    getVersionBucket: getReactRouterVersionBucket,
    minimumVersion: '6.0.0',
    getInstalledVersion: async (options: WizardOptions) => {
      const packageJson = await getPackageDotJson(options);
      return getPackageVersion('react-router', packageJson);
    },
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson
        ? hasPackageInstalled('react-router', packageJson)
        : false;
    },
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: (apiKey: string, host: string) => ({
      REACT_APP_POSTHOG_KEY: apiKey,
      REACT_APP_POSTHOG_HOST: host,
    }),
  },

  analytics: {
    getTags: (context) => ({
      routerMode: context.routerMode || 'unknown',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a JavaScript/TypeScript project. Look for package.json and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.',
    packageInstallation:
      'Look for lockfiles to determine the package manager (npm, yarn, pnpm, bun). Do not manually edit package.json.',
    getAdditionalContextLines: (context) => {
      const routerMode = context.routerMode;
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
    getOutroChanges: (context) => {
      const modeName = context.routerMode
        ? getReactRouterModeName(context.routerMode)
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
  await runAgentWizard(REACT_ROUTER_AGENT_CONFIG, options);
}
