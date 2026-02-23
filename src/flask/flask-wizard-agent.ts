/* Flask wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { PYTHON_PACKAGE_INSTALLATION } from '../lib/framework-config';
import { detectPythonPackageManagers } from '../lib/package-manager-detection';
import { Integration } from '../lib/constants';
import fg from 'fast-glob';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getFlaskVersion,
  getFlaskProjectType,
  getFlaskProjectTypeName,
  getFlaskVersionBucket,
  FlaskProjectType,
  findFlaskAppFile,
} from './utils';

type FlaskContext = {
  projectType?: FlaskProjectType;
  appFile?: string;
};

export const FLASK_AGENT_CONFIG: FrameworkConfig<FlaskContext> = {
  metadata: {
    name: 'Flask',
    integration: Integration.flask,
    beta: true,
    docsUrl: 'https://posthog.com/docs/libraries/python',
    unsupportedVersionDocsUrl: 'https://posthog.com/docs/libraries/python',
    gatherContext: async (options: WizardOptions) => {
      const projectType = await getFlaskProjectType(options);
      const appFile = await findFlaskAppFile(options);
      return { projectType, appFile };
    },
  },

  detection: {
    packageName: 'flask',
    packageDisplayName: 'Flask',
    usesPackageJson: false,
    getVersion: () => undefined,
    getVersionBucket: getFlaskVersionBucket,
    minimumVersion: '2.0.0',
    getInstalledVersion: (options: WizardOptions) => getFlaskVersion(options),
    detect: async (options) => {
      const { installDir } = options;

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
          if (
            /^flask([<>=~!]|$|\s)/im.test(content) ||
            /["']flask["']/i.test(content)
          ) {
            return true;
          }
        } catch {
          continue;
        }
      }

      const pyFiles = await fg(
        ['**/app.py', '**/wsgi.py', '**/application.py', '**/__init__.py'],
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
            content.includes('from flask import') ||
            content.includes('import flask') ||
            /Flask\s*\(/.test(content)
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
    getTags: (context) => ({
      projectType: context.projectType || 'unknown',
    }),
  },

  prompts: {
    packageInstallation: PYTHON_PACKAGE_INSTALLATION,
    projectTypeDetection:
      'This is a Python/Flask project. Look for requirements.txt, pyproject.toml, setup.py, Pipfile, or app.py/wsgi.py to confirm.',
    getAdditionalContextLines: (context) => {
      const projectTypeName = context.projectType
        ? getFlaskProjectTypeName(context.projectType)
        : 'unknown';

      // Map project type to framework ID for MCP docs resource
      const frameworkIdMap: Record<FlaskProjectType, string> = {
        [FlaskProjectType.STANDARD]: 'flask',
        [FlaskProjectType.RESTFUL]: 'flask',
        [FlaskProjectType.RESTX]: 'flask',
        [FlaskProjectType.SMOREST]: 'flask',
        [FlaskProjectType.BLUEPRINT]: 'flask',
      };

      const frameworkId = context.projectType
        ? frameworkIdMap[context.projectType]
        : 'flask';

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
    getOutroChanges: (context) => {
      const projectTypeName = context.projectType
        ? getFlaskProjectTypeName(context.projectType)
        : 'Flask';
      return [
        `Analyzed your ${projectTypeName} project structure`,
        `Installed the PostHog Python package`,
        `Configured PostHog in your Flask application`,
        `Added PostHog initialization with automatic event tracking`,
      ];
    },
    getOutroNextSteps: () => [
      'Start your Flask development server to see PostHog in action',
      'Visit your PostHog dashboard to see incoming events',
      'Use posthog.identify() to associate events with users',
    ],
  },
};
