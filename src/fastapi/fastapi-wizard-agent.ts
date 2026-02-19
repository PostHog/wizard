/* FastAPI wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { PYTHON_PACKAGE_INSTALLATION } from '../lib/framework-config';
import { detectPythonPackageManagers } from '../lib/package-manager-detection';
import { enableDebugLogs } from '../utils/debug';
import { runAgentWizard } from '../lib/agent-runner';
import { Integration } from '../lib/constants';
import clack from '../utils/clack';
import chalk from 'chalk';
import * as semver from 'semver';
import {
  getFastAPIVersion,
  getFastAPIProjectType,
  getFastAPIProjectTypeName,
  getFastAPIVersionBucket,
  FastAPIProjectType,
  findFastAPIAppFile,
} from './utils';
import fg from 'fast-glob';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * FastAPI framework configuration for the universal agent runner
 */
const MINIMUM_FASTAPI_VERSION = '0.100.0';

export const FASTAPI_AGENT_CONFIG: FrameworkConfig = {
  metadata: {
    name: 'FastAPI',
    integration: Integration.fastapi,
    docsUrl: 'https://posthog.com/docs/libraries/python',
    unsupportedVersionDocsUrl: 'https://posthog.com/docs/libraries/python',
    gatherContext: async (options: WizardOptions) => {
      const projectType = await getFastAPIProjectType(options);
      const appFile = await findFastAPIAppFile(options);
      return { projectType, appFile };
    },
  },

  detection: {
    packageName: 'fastapi',
    packageDisplayName: 'FastAPI',
    usesPackageJson: false,
    getVersion: (_packageJson: any) => {
      // For FastAPI, we don't use package.json. Version is extracted separately
      // from requirements.txt or pyproject.toml in the wizard entry point
      return undefined;
    },
    getVersionBucket: getFastAPIVersionBucket,
    getInstalledVersion: getFastAPIVersion,
    detect: async (options) => {
      const { installDir } = options;

      // Note: Django and Flask are checked before FastAPI in INTEGRATION_ORDER,
      // so if we get here, the project is not a Django or Flask project.

      // Check for FastAPI in requirements files
      const requirementsFiles = await fg(
        [
          '**/requirements*.txt',
          '**/pyproject.toml',
          '**/setup.py',
          '**/Pipfile',
        ],
        {
          cwd: installDir,
          ignore: ['**/venv/**', '**/.venv/**', '**/env/**', '**/.env/**'],
        },
      );

      for (const reqFile of requirementsFiles) {
        try {
          const content = fs.readFileSync(
            path.join(installDir, reqFile),
            'utf-8',
          );
          // Check for fastapi package (case-insensitive)
          // Match "fastapi" as a standalone package
          if (
            /^fastapi([<>=~!]|$|\s)/im.test(content) ||
            /["']fastapi["']/i.test(content)
          ) {
            return true;
          }
        } catch {
          continue;
        }
      }

      // Check for FastAPI app patterns in Python files
      const pyFiles = await fg(
        ['**/main.py', '**/app.py', '**/application.py', '**/__init__.py'],
        {
          cwd: installDir,
          ignore: [
            '**/venv/**',
            '**/.venv/**',
            '**/env/**',
            '**/.env/**',
            '**/__pycache__/**',
          ],
        },
      );

      for (const pyFile of pyFiles) {
        try {
          const content = fs.readFileSync(
            path.join(installDir, pyFile),
            'utf-8',
          );
          if (
            content.includes('from fastapi import') ||
            content.includes('import fastapi') ||
            /FastAPI\s*\(/.test(content)
          ) {
            return true;
          }
        } catch {
          continue;
        }
      }

      return false;
    },
    detectPackageManager: detectPythonPackageManagers,
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: (apiKey: string, host: string) => ({
      POSTHOG_API_KEY: apiKey,
      POSTHOG_HOST: host,
    }),
  },

  analytics: {
    getTags: (context: any) => {
      const projectType = context.projectType as FastAPIProjectType;
      return {
        projectType: projectType || 'unknown',
      };
    },
  },

  prompts: {
    packageInstallation: PYTHON_PACKAGE_INSTALLATION,
    projectTypeDetection:
      'This is a Python/FastAPI project. Look for requirements.txt, pyproject.toml, setup.py, Pipfile, or main.py/app.py to confirm.',
    getAdditionalContextLines: (context: any) => {
      const projectType = context.projectType as FastAPIProjectType;
      const projectTypeName = projectType
        ? getFastAPIProjectTypeName(projectType)
        : 'unknown';

      // Map project type to framework ID for MCP docs resource
      const frameworkIdMap: Record<FastAPIProjectType, string> = {
        [FastAPIProjectType.STANDARD]: 'fastapi',
        [FastAPIProjectType.ROUTER]: 'fastapi',
        [FastAPIProjectType.FULLSTACK]: 'fastapi',
      };

      const frameworkId = projectType ? frameworkIdMap[projectType] : 'fastapi';

      const lines = [
        `Project type: ${projectTypeName}`,
        `Framework docs ID: ${frameworkId} (use posthog://docs/frameworks/${frameworkId} for documentation)`,
      ];

      if (context.appFile) {
        lines.push(`App file: ${context.appFile}`);
      }

      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: (context: any) => {
      const projectType = context.projectType as FastAPIProjectType;
      const projectTypeName = projectType
        ? getFastAPIProjectTypeName(projectType)
        : 'FastAPI';
      return [
        `Analyzed your ${projectTypeName} project structure`,
        `Installed the PostHog Python package`,
        `Configured PostHog in your FastAPI application`,
        `Added PostHog initialization with lifespan event handling`,
      ];
    },
    getOutroNextSteps: () => [
      'Start your FastAPI development server to see PostHog in action',
      'Visit your PostHog dashboard to see incoming events',
      'Use posthog.identify() to associate events with users',
    ],
  },
};

/**
 * FastAPI wizard powered by the universal agent runner.
 */
export async function runFastAPIWizardAgent(
  options: WizardOptions,
): Promise<void> {
  if (options.debug) {
    enableDebugLogs();
  }

  // Check FastAPI version - agent wizard requires >= 0.100.0
  const fastapiVersion = await getFastAPIVersion(options);

  if (fastapiVersion) {
    const coercedVersion = semver.coerce(fastapiVersion);
    if (coercedVersion && semver.lt(coercedVersion, MINIMUM_FASTAPI_VERSION)) {
      const docsUrl =
        FASTAPI_AGENT_CONFIG.metadata.unsupportedVersionDocsUrl ??
        FASTAPI_AGENT_CONFIG.metadata.docsUrl;

      clack.log.warn(
        `Sorry: the wizard can't help you with FastAPI ${fastapiVersion}. Upgrade to FastAPI ${MINIMUM_FASTAPI_VERSION} or later, or check out the manual setup guide.`,
      );
      clack.log.info(`Setup FastAPI manually: ${chalk.cyan(docsUrl)}`);
      clack.outro('PostHog wizard will see you next time!');
      return;
    }
  }

  await runAgentWizard(FASTAPI_AGENT_CONFIG, options);
}
