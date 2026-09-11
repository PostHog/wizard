/* React Router wizard using posthog-agent with PostHog MCP */
import type { WizardRunOptions } from '@utils/types';
import type { FrameworkConfig } from '@lib/framework-config';
import { detectNodePackageManagers } from '@lib/detection/package-manager';
import { Integration } from '@lib/constants';
import {
  findDeclaredPackage,
  getInstalledPackageVersion,
  type PackageJson,
} from '@utils/package-json';
import { tryGetPackageJson } from '@utils/setup-utils';
import { getUI } from '@ui';
import {
  getReactRouterMode,
  getReactRouterModeName,
  getReactRouterVersionBucket,
  ReactRouterMode,
} from './utils';

type ReactRouterContext = {
  routerMode?: ReactRouterMode;
};

const REACT_ROUTER_PACKAGE = 'react-router';

/**
 * v6 ships the router as `react-router-dom`; v7 consolidated onto
 * `react-router`. Both names have to count, or v6 projects — which declare
 * only `react-router-dom` — never match and fall through to the generic
 * JavaScript fallbacks.
 */
const REACT_ROUTER_ALTERNATE_PACKAGES = ['react-router-dom'];

/** Lookup order matches `getReactRouterMode` in ./utils. */
const REACT_ROUTER_PACKAGES = [
  ...REACT_ROUTER_ALTERNATE_PACKAGES,
  REACT_ROUTER_PACKAGE,
];

export const REACT_ROUTER_AGENT_CONFIG: FrameworkConfig<ReactRouterContext> = {
  metadata: {
    name: 'React Router',
    integration: Integration.reactRouter,
    docsUrl: 'https://posthog.com/docs/libraries/react',
    unsupportedVersionDocsUrl: 'https://posthog.com/docs/libraries/react',
    gatherContext: async (options: WizardRunOptions) => {
      const routerMode = await getReactRouterMode(options);
      if (routerMode) {
        getUI().setDetectedFramework(
          `React Router ${getReactRouterModeName(routerMode)}`,
        );
        return { routerMode };
      }
      return {};
    },
  },

  detection: {
    packageName: REACT_ROUTER_PACKAGE,
    alternatePackageNames: REACT_ROUTER_ALTERNATE_PACKAGES,
    packageDisplayName: 'React Router',
    getVersion: (packageJson: unknown) =>
      findDeclaredPackage(REACT_ROUTER_PACKAGES, packageJson as PackageJson)
        ?.version,
    getVersionBucket: getReactRouterVersionBucket,
    minimumVersion: '6.0.0',
    getInstalledVersion: (options: WizardRunOptions) =>
      Promise.resolve(
        REACT_ROUTER_PACKAGES.map((name) =>
          getInstalledPackageVersion(name, options.installDir),
        ).find((version) => version !== undefined),
      ),
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson
        ? findDeclaredPackage(REACT_ROUTER_PACKAGES, packageJson) !== undefined
        : false;
    },
    detectPackageManager: detectNodePackageManagers,
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: (apiKey: string, host: string) => ({
      REACT_APP_POSTHOG_PROJECT_TOKEN: apiKey,
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
