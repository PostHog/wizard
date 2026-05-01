/* Generic Python language wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../../utils/types';
import type { FrameworkConfig } from '../../lib/framework-config';
import { PYTHON_PACKAGE_INSTALLATION } from '../../lib/framework-config';
import { detectPythonPackageManagers } from '../../lib/detection/package-manager';
import { Integration } from '../../lib/constants';
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
  entryPoint?: string;
  projectLayout?: string;
  detectedPatterns?: string[];
};

export const PYTHON_AGENT_CONFIG: FrameworkConfig<PythonContext> = {
  metadata: {
    name: 'Python Language',
    integration: Integration.python,
    beta: true,
    docsUrl: 'https://posthog.com/docs/libraries/python',
    gatherContext: async (options: WizardOptions) => {
      const { installDir } = options;
      const packageManager = await detectPackageManager(options);
      const context: PythonContext = { packageManager };

      // Detect entry point
      const entryPointCandidates = [
        'main.py',
        'app.py',
        'run.py',
        'cli.py',
        'manage.py',
        'src/main.py',
        'src/app.py',
      ];
      for (const candidate of entryPointCandidates) {
        if (fs.existsSync(path.join(installDir, candidate))) {
          context.entryPoint = candidate;
          break;
        }
      }

      // Detect project layout
      if (fs.existsSync(path.join(installDir, 'src'))) {
        context.projectLayout = 'src layout';
      } else if (fs.existsSync(path.join(installDir, 'lib'))) {
        context.projectLayout = 'lib layout';
      } else {
        context.projectLayout = 'flat layout';
      }

      // Detect patterns from dependencies
      const depFiles = [
        'requirements.txt',
        'pyproject.toml',
        'Pipfile',
        'setup.cfg',
      ];
      let depContent = '';
      for (const depFile of depFiles) {
        try {
          depContent +=
            fs.readFileSync(path.join(installDir, depFile), 'utf-8') + '\n';
        } catch {
          /* skip */
        }
      }

      const patternMarkers: Record<string, string[]> = {
        CLI: ['click', 'typer', 'argparse'],
        'background worker': ['celery', 'rq', 'dramatiq'],
        'database (ORM)': ['sqlalchemy', 'peewee', 'tortoise-orm'],
        'async web framework': ['aiohttp', 'tornado', 'sanic', 'starlette'],
        'data/ML': ['pandas', 'numpy', 'scikit'],
      };

      const patterns = Object.entries(patternMarkers)
        .filter(([, pkgs]) =>
          pkgs.some((pkg) => new RegExp(`\\b${pkg}\\b`, 'i').test(depContent)),
        )
        .map(([label]) => label);

      if (fs.existsSync(path.join(installDir, 'Dockerfile'))) {
        patterns.push('containerized');
      }

      if (patterns.length > 0) {
        context.detectedPatterns = patterns;
      }

      return context;
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
    detectPackageManager: detectPythonPackageManagers,
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: (apiKey: string, host: string) => ({
      POSTHOG_PROJECT_TOKEN: apiKey,
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
    packageInstallation: PYTHON_PACKAGE_INSTALLATION,
    projectTypeDetection:
      'This is a Python project. Check the additional context lines below for detected patterns and entry points.',
    getAdditionalContextLines: (context) => {
      const packageManagerName = context.packageManager
        ? getPackageManagerName(context.packageManager)
        : 'unknown';

      const lines: string[] = [];

      lines.push(`Package manager: ${packageManagerName}`);

      if (context.entryPoint) {
        lines.push(`Entry point: ${context.entryPoint}`);
      }

      if (context.projectLayout) {
        lines.push(`Project structure: ${context.projectLayout}`);
      }

      if (context.detectedPatterns && context.detectedPatterns.length > 0) {
        lines.push(`Detected patterns: ${context.detectedPatterns.join(', ')}`);
      }

      lines.push(
        `Framework docs ID: python (use posthog://docs/frameworks/python for documentation)`,
      );
      lines.push(``);
      lines.push(
        `Integration approach: No specific web framework was detected. Explore the project's file structure to understand its architecture, then integrate the PostHog Python SDK in the way that best fits the project's existing patterns. Look for the entry point, request handlers, authentication flows, and error handling to find the right integration points.`,
      );

      return lines;
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
