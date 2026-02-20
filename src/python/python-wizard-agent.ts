/* Generic Python language wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { PYTHON_PACKAGE_INSTALLATION } from '../lib/framework-config';
import { detectPythonPackageManagers } from '../lib/package-manager-detection';
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
      'This is a generic Python project. Look for requirements.txt, pyproject.toml, setup.py, or Pipfile to confirm.',
    getAdditionalContextLines: (context) => {
      const packageManagerName = context.packageManager
        ? getPackageManagerName(context.packageManager)
        : 'unknown';

      const lines = [
        `Package manager: ${packageManagerName}`,
        `Framework docs ID: python (use posthog://docs/frameworks/python for documentation)`,
        `Project type: Generic Python application (CLI, script, worker, data pipeline, etc.)`,
        ``,
        `## CRITICAL: Python PostHog Best Practices`,
        ``,
        `### 1. Use Instance-Based API (REQUIRED)`,
        `Always use the Posthog() class constructor instead of module-level posthog:`,
        ``,
        `CORRECT:`,
        `from posthog import Posthog`,
        `posthog_client = Posthog(`,
        `    api_key="your_api_key",`,
        `    host="https://us.i.posthog.com",`,
        `    debug=False,`,
        `    enable_exception_autocapture=True,  # Auto-capture exceptions`,
        `)`,
        ``,
        `INCORRECT (DO NOT USE):`,
        `import posthog`,
        `posthog.api_key = "your_api_key"  # Don't use module-level config`,
        ``,
        `### 2. Enable Exception Autocapture`,
        `ALWAYS include enable_exception_autocapture=True in the Posthog() initialization to automatically track exceptions.`,
        ``,
        `### 3. NEVER Send PII (Personally Identifiable Information)`,
        `DO NOT include in event properties:`,
        `- Email addresses`,
        `- Full names`,
        `- Phone numbers`,
        `- Physical addresses`,
        `- IP addresses`,
        `- Any user-generated content (messages, comments, form submissions)`,
        ``,
        `SAFE event properties:`,
        `posthog_client.capture('contact_form_submitted', properties={`,
        `    'message_length': len(message),  # Metadata is OK`,
        `    'has_email': bool(email),  # Boolean flags are OK`,
        `    'form_type': 'contact'  # Categories are OK`,
        `})`,
        ``,
        `UNSAFE (DO NOT DO THIS):`,
        `posthog_client.capture('form_submitted', properties={`,
        `    'email': user_email,  # NEVER send actual email`,
        `    'message': message_content,  # NEVER send user content`,
        `    'name': user_name  # NEVER send names`,
        `})`,
        ``,
        `### 4. Implement Graceful Shutdown`,
        `ALWAYS call posthog_client.shutdown() when your application exits to ensure all events are flushed:`,
        ``,
        `import atexit`,
        `atexit.register(posthog_client.shutdown)  # Ensures events are sent on exit`,
        ``,
        `For Django, use AppConfig.ready() to register the shutdown handler.`,
        `For Flask, use @app.teardown_appcontext or atexit.`,
        `For scripts/workers, call shutdown() explicitly or use atexit.`,
        ``,
        `### 5. For Django Projects`,
        `Initialize PostHog in your AppConfig.ready() method:`,
        ``,
        `from django.apps import AppConfig`,
        `from posthog import Posthog`,
        ``,
        `class YourAppConfig(AppConfig):`,
        `    posthog_client = None`,
        `    `,
        `    def ready(self):`,
        `        if YourAppConfig.posthog_client is None:`,
        `            YourAppConfig.posthog_client = Posthog(`,
        `                settings.POSTHOG_API_KEY,`,
        `                host=settings.POSTHOG_HOST,`,
        `                debug=settings.DEBUG,`,
        `                enable_exception_autocapture=True,`,
        `            )`,
        `            import atexit`,
        `            atexit.register(YourAppConfig.posthog_client.shutdown)`,
        ``,
        `IMPORTANT: These best practices are MANDATORY. The implementation will fail review if they are not followed.`,
      ];

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
