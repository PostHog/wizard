import { tryGetPackageJson } from '../utils/clack-utils';
import { hasPackageInstalled } from '../utils/package-json';
import type { WizardOptions } from '../utils/types';
import { Integration } from './constants';
import fg from 'fast-glob';
import * as fs from 'node:fs';
import * as path from 'node:path';

type IntegrationConfig = {
  name: string;
  filterPatterns: string[];
  ignorePatterns: string[];
  detect: (options: Pick<WizardOptions, 'installDir'>) => Promise<boolean>;
  generateFilesRules: string;
  filterFilesRules: string;
  docsUrl: string;
  nextSteps: string;
  defaultChanges: string;
};

export const INTEGRATION_CONFIG = {
  [Integration.nextjs]: {
    name: 'Next.js',
    filterPatterns: ['**/*.{tsx,ts,jsx,js,mjs,cjs}'],
    ignorePatterns: [
      'node_modules',
      'dist',
      'build',
      'public',
      'static',
      'next-env.d.*',
    ],
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson ? hasPackageInstalled('next', packageJson) : false;
    },
    generateFilesRules: '',
    filterFilesRules: '',
    docsUrl: 'https://posthog.com/docs/libraries/next-js',
    defaultChanges:
      '• Installed posthog-js & posthog-node packages\n• Initialized PostHog and added pageview tracking\n• Created a PostHogClient to use PostHog server-side\n• Setup a reverse proxy to avoid ad blockers blocking analytics requests',
    nextSteps:
      '• Call posthog.identify() when a user signs into your app\n• Call posthog.capture() to capture custom events in your app',
  },
  [Integration.react]: {
    name: 'React',
    filterPatterns: ['**/*.{tsx,ts,jsx,js}'],
    ignorePatterns: [
      'node_modules',
      'dist',
      'build',
      'public',
      'static',
      'assets',
    ],
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson ? hasPackageInstalled('react', packageJson) : false;
    },
    generateFilesRules: '',
    filterFilesRules: '',
    docsUrl: 'https://posthog.com/docs/libraries/react',
    defaultChanges:
      '• Installed posthog-js package\n• Added PostHogProvider to the root of the app, to initialize PostHog and enable autocapture',
    nextSteps:
      '• Call posthog.identify() when a user signs into your app\n• Call posthog.capture() to capture custom events in your app',
  },
  [Integration.svelte]: {
    name: 'Svelte',
    filterPatterns: ['**/*.{svelte,ts,js,jsx,tsx}'],
    ignorePatterns: ['node_modules', 'dist', 'build', 'public', 'static'],
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson
        ? hasPackageInstalled('@sveltejs/kit', packageJson)
        : false;
    },
    generateFilesRules: '',
    filterFilesRules: '',
    docsUrl: 'https://posthog.com/docs/libraries/svelte',
    defaultChanges:
      '• Installed posthog-js & posthog-node packages\n• Added PostHog initialization to your Svelte app\n• Setup pageview & pageleave tracking\n• Setup event auto - capture to capture events as users interact with your app\n• Added a getPostHogClient() function to use PostHog server-side',
    nextSteps:
      '• Call posthog.identify() when a user signs into your app\n• Use getPostHogClient() to start capturing events server - side',
  },
  [Integration.reactNative]: {
    name: 'React Native',
    filterPatterns: ['**/*.{ts,js,jsx,tsx}'],
    ignorePatterns: ['node_modules', 'dist', 'build', 'public', 'static'],
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson
        ? hasPackageInstalled('react-native', packageJson)
        : false;
    },
    generateFilesRules: '',
    filterFilesRules: '',
    docsUrl: 'https://posthog.com/docs/libraries/react-native',
    defaultChanges:
      '• Installed required packages\n• Added PostHogProvider to the root of the app\n• Enabled autocapture and session replay',
    nextSteps:
      '• Call posthog.identify() when a user signs into your app\n• Call posthog.capture() to capture custom events in your app',
  },
  [Integration.astro]: {
    name: 'Astro',
    filterPatterns: ['**/*.{astro,ts,js,jsx,tsx}'],
    ignorePatterns: ['node_modules', 'dist', 'build', 'public', 'static'],
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson ? hasPackageInstalled('astro', packageJson) : false;
    },
    generateFilesRules: '',
    filterFilesRules: '',
    docsUrl: 'https://posthog.com/docs/libraries/js',
    defaultChanges:
      '• Added PostHog component with initialization script\n• Created PostHogLayout for consistent analytics tracking',
    nextSteps:
      '• Call posthog.identify() when a user signs into your app\n• Call posthog.capture() to capture custom events in your app\n• Use posthog.isFeatureEnabled() for feature flags',
  },
  [Integration.reactRouter]: {
    name: 'React Router',
    filterPatterns: ['**/*.{tsx,ts,jsx,js}'],
    ignorePatterns: [
      'node_modules',
      'dist',
      'build',
      'public',
      'static',
      'assets',
    ],
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson
        ? hasPackageInstalled('react-router', packageJson)
        : false;
    },
    generateFilesRules: '',
    filterFilesRules: '',
    docsUrl:
      'https://posthog-git-react-post-hog.vercel.app/docs/libraries/react-router',
    defaultChanges:
      '• Installed posthog-js package\n• Added PostHogProvider to the root of the app\n• Integrated PostHog with React Router for pageview tracking',
    nextSteps:
      '• Call posthog.identify() when a user signs into your app\n• Call posthog.capture() to capture custom events in your app',
  },
  [Integration.django]: {
    name: 'Django',
    filterPatterns: ['**/*.py'],
    ignorePatterns: [
      'node_modules',
      'dist',
      'build',
      'public',
      'static',
      'venv',
      '.venv',
      'env',
      '.env',
      '__pycache__',
      '*.pyc',
      'migrations',
    ],
    detect: async (options) => {
      const { installDir } = options;

      // Check for manage.py (Django project indicator)
      const managePyMatches = await fg('**/manage.py', {
        cwd: installDir,
        ignore: ['**/venv/**', '**/.venv/**', '**/env/**', '**/.env/**'],
      });

      if (managePyMatches.length > 0) {
        // Verify it's a Django manage.py by checking content
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
              return true;
            }
          } catch {
            // Skip files that can't be read
            continue;
          }
        }
      }

      // Check for Django in requirements files
      const requirementsFiles = await fg(
        ['**/requirements*.txt', '**/pyproject.toml', '**/setup.py'],
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
          // Check for Django package reference
          if (
            content.toLowerCase().includes('django') &&
            !content.toLowerCase().includes('django-') // Avoid false positives from Django plugins only
          ) {
            return true;
          }
        } catch {
          // Skip files that can't be read
          continue;
        }
      }

      return false;
    },
    generateFilesRules: '',
    filterFilesRules: '',
    docsUrl: 'https://posthog.com/docs/libraries/django',
    defaultChanges:
      '• Installed posthog Python package\n• Added PostHog middleware for automatic event tracking\n• Configured PostHog settings in Django settings file',
    nextSteps:
      '• Use identify_context() within new_context() to associate events with users\n• Call posthog.capture() to capture custom events\n• Use feature flags with posthog.feature_enabled()',
  },
  [Integration.flask]: {
    name: 'Flask',
    filterPatterns: ['**/*.py'],
    ignorePatterns: [
      'node_modules',
      'dist',
      'build',
      'public',
      'static',
      'venv',
      '.venv',
      'env',
      '.env',
      '__pycache__',
      '*.pyc',
      'migrations',
      'instance',
    ],
    detect: async (options) => {
      const { installDir } = options;

      // Note: Django is checked before Flask in the Integration enum order,
      // so if we get here, the project is not a Django project.

      // Check for Flask in requirements files
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
          // Check for flask package (case-insensitive)
          // Match "flask" as a standalone package, not just as part of plugin names
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

      // Check for Flask app patterns in Python files
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
    generateFilesRules: '',
    filterFilesRules: '',
    docsUrl: 'https://posthog.com/docs/libraries/flask',
    defaultChanges:
      '• Installed posthog Python package\n• Added PostHog initialization to your Flask app\n• Configured automatic event tracking',
    nextSteps:
      '• Use posthog.identify() to associate events with users\n• Call posthog.capture() to capture custom events\n• Use feature flags with posthog.feature_enabled()',
  },
  [Integration.laravel]: {
    name: 'Laravel',
    filterPatterns: ['**/*.php'],
    ignorePatterns: [
      'node_modules',
      'vendor',
      'storage',
      'bootstrap/cache',
      'public/build',
      'public/hot',
      '.phpunit.cache',
    ],
    detect: async (options) => {
      const { installDir } = options;

      // Primary check: artisan file (definitive Laravel indicator)
      const artisanPath = path.join(installDir, 'artisan');
      if (fs.existsSync(artisanPath)) {
        try {
          const content = fs.readFileSync(artisanPath, 'utf-8');
          if (content.includes('Laravel') || content.includes('Artisan')) {
            return true;
          }
        } catch {
          // Continue to other checks
        }
      }

      // Secondary check: composer.json with laravel/framework
      const composerPath = path.join(installDir, 'composer.json');
      if (fs.existsSync(composerPath)) {
        try {
          const content = fs.readFileSync(composerPath, 'utf-8');
          const composer = JSON.parse(content);
          if (
            composer.require?.['laravel/framework'] ||
            composer['require-dev']?.['laravel/framework']
          ) {
            return true;
          }
        } catch {
          // Continue to other checks
        }
      }

      // Tertiary check: Laravel-specific directory structure
      const hasLaravelStructure = await fg(
        ['**/bootstrap/app.php', '**/app/Http/Kernel.php'],
        { cwd: installDir, ignore: ['**/vendor/**'] },
      );

      return hasLaravelStructure.length > 0;
    },
    generateFilesRules: '',
    filterFilesRules: '',
    docsUrl: 'https://posthog.com/docs/libraries/php',
    defaultChanges:
      '• Installed posthog/posthog-php via Composer\n• Added PostHog service provider\n• Configured automatic event tracking',
    nextSteps:
      '• Use PostHog::capture() to track custom events\n• Use PostHog::identify() to associate events with users',
  },
} as const satisfies Record<Integration, IntegrationConfig>;
