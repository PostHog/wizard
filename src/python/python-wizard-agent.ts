/* Generic Python language wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { Integration } from '../lib/constants';
import fg from 'fast-glob';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getPythonVersion,
  getPythonVersionBucket,
  detectPackageManager,
  getPackageManagerName,
  PythonPackageManager,
} from './utils';

type PythonContext = {
  packageManager?: PythonPackageManager;
};

export const PYTHON_AGENT_CONFIG: FrameworkConfig<PythonContext> = {
  metadata: {
    name: 'Python Language',
    integration: Integration.python,
    beta: true,
    docsUrl: 'https://posthog.com/docs/libraries/python',
    gatherContext: async (options: WizardOptions) => {
      const packageManager = await detectPackageManager(options);
      return { packageManager };
    },
  },

  detection: {
    packageName: 'python',
    packageDisplayName: 'Python',
    usesPackageJson: false,
    getVersion: () => undefined,
    getVersionBucket: getPythonVersionBucket,
    minimumVersion: '3.8.0',
    getInstalledVersion: (options: WizardOptions) =>
      Promise.resolve(getPythonVersion(options)),
    detect: async (options) => {
      const { installDir } = options;

      // Look for Python package management files
      const pythonConfigFiles = await fg(
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

      if (pythonConfigFiles.length === 0) {
        return false;
      }

      // Make sure this isn't Django or Flask (those should be detected first)
      // Check for Django
      const managePyMatches = await fg('**/manage.py', {
        cwd: installDir,
        ignore: ['**/venv/**', '**/.venv/**', '**/env/**', '**/.env/**'],
      });

      for (const match of managePyMatches) {
        try {
          const content = fs.readFileSync(
            path.join(installDir, match),
            'utf-8',
          );
          if (
            content.includes('django') ||
            content.includes('DJANGO_SETTINGS_MODULE')
          ) {
            return false; // Django detected, use django agent instead
          }
        } catch {
          continue;
        }
      }

      // Check for Flask
      for (const configFile of pythonConfigFiles) {
        try {
          const content = fs.readFileSync(
            path.join(installDir, configFile),
            'utf-8',
          );
          if (
            /^flask([<>=~!]|$|\s)/im.test(content) ||
            /["']flask["']/i.test(content)
          ) {
            return false; // Flask detected, use flask agent instead
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
            return false; // Flask detected, use flask agent instead
          }
        } catch {
          continue;
        }
      }

      // If we have Python config files but it's not Django or Flask, it's a generic Python project
      return true;
    },
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: (apiKey: string, host: string) => ({
      POSTHOG_API_KEY: apiKey,
      POSTHOG_HOST: host,
    }),
  },

  analytics: {
    getTags: (context) => {
      const packageManagerName = context.packageManager
        ? getPackageManagerName(context.packageManager)
        : 'unknown';
      return {
        packageManager: packageManagerName,
      };
    },
  },

  prompts: {
    projectTypeDetection:
      'This is a generic Python project. Look for requirements.txt, pyproject.toml, setup.py, or Pipfile to confirm.',
    packageInstallation:
      'Use pip, poetry, or pipenv based on existing config files (requirements.txt, pyproject.toml, Pipfile). Do not pin the posthog version - just add "posthog" without version constraints.',
    getAdditionalContextLines: (context) => {
      const packageManagerName = context.packageManager
        ? getPackageManagerName(context.packageManager)
        : 'unknown';

      return [
        `Package manager: ${packageManagerName}`,
        `Framework docs ID: python (use posthog://docs/frameworks/python for documentation)`,
        `Project type: Generic Python application (CLI, script, worker, data pipeline, etc.)`,
      ];
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: (context) => {
      const packageManagerName = context.packageManager
        ? getPackageManagerName(context.packageManager)
        : 'package manager';
      return [
        `Analyzed your Python project structure`,
        `Installed the PostHog Python package using ${packageManagerName}`,
        `Created PostHog initialization using instance-based API (Posthog class)`,
        `Configured exception autocapture and graceful shutdown`,
        `Added example code for events, feature flags, and error capture (without PII)`,
      ];
    },
    getOutroNextSteps: () => [
      'Use Posthog() class (not module-level posthog) with enable_exception_autocapture=True',
      'Call posthog_client.shutdown() on application exit (use atexit.register)',
      'NEVER send PII in event properties (no emails, names, or user content)',
      'Use posthog_client.capture() for events and posthog_client.identify() for users',
      'Visit your PostHog dashboard to see incoming events',
    ],
  },
};
