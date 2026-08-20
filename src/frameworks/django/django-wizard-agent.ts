/* Django wizard using posthog-agent with PostHog MCP */
import type { WizardRunOptions } from '@utils/types';
import type { FrameworkConfig } from '@lib/framework-config';
import { PYTHON_PACKAGE_INSTALLATION } from '@lib/framework-config';
import { detectPythonPackageManagers } from '@lib/detection/package-manager';
import { Integration } from '@lib/constants';
import { boundedGlob, readProjectFile } from '@utils/bounded-fs';
import * as path from 'node:path';
import {
  getDjangoVersion,
  getDjangoProjectType,
  getDjangoProjectTypeName,
  getDjangoVersionBucket,
  DjangoProjectType,
  findDjangoSettingsFile,
} from './utils';

const EXTRA_IGNORE = ['**/env/**', '**/.env/**'];

type DjangoContext = {
  projectType?: DjangoProjectType;
  settingsFile?: string;
};

export const DJANGO_AGENT_CONFIG: FrameworkConfig<DjangoContext> = {
  metadata: {
    name: 'Django',
    integration: Integration.django,
    docsUrl: 'https://posthog.com/docs/libraries/django',
    unsupportedVersionDocsUrl: 'https://posthog.com/docs/libraries/python',
    gatherContext: async (options: WizardRunOptions) => {
      const projectType = await getDjangoProjectType(options);
      const settingsFile = await findDjangoSettingsFile(options);
      return { projectType, settingsFile };
    },
  },

  detection: {
    packageName: 'django',
    packageDisplayName: 'Django',
    usesPackageJson: false,
    getVersion: () => undefined,
    getVersionBucket: getDjangoVersionBucket,
    minimumVersion: '3.0.0',
    getInstalledVersion: (options: WizardRunOptions) =>
      getDjangoVersion(options),
    detect: async (options) => {
      const { installDir } = options;

      const managePyMatches = await boundedGlob('**/manage.py', {
        cwd: installDir,
        extraIgnore: EXTRA_IGNORE,
      });

      if (managePyMatches.length > 0) {
        for (const match of managePyMatches) {
          const content = readProjectFile(path.join(installDir, match));
          if (!content) continue;
          // Check for actual Django imports and usage
          if (
            content.includes('from django') ||
            content.includes('import django') ||
            content.includes('DJANGO_SETTINGS_MODULE') ||
            /execute_from_command_line/.test(content)
          ) {
            return true;
          }
        }
      }

      const requirementsFiles = await boundedGlob(
        ['**/requirements*.txt', '**/pyproject.toml', '**/setup.py'],
        {
          cwd: installDir,
          extraIgnore: EXTRA_IGNORE,
        },
      );

      for (const reqFile of requirementsFiles) {
        const content = readProjectFile(path.join(installDir, reqFile));
        if (!content) continue;
        // Match Django as a package requirement, not in comments or other text
        // Look for: django, django>=, django==, django~=, Django (capitalized)
        if (
          /^django([>=~!<\s]|$)/im.test(content) ||
          /["']django["']/i.test(content)
        ) {
          return true;
        }
      }

      return false;
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
    getTags: (context) => ({
      projectType: context.projectType || 'unknown',
    }),
  },

  prompts: {
    packageInstallation: PYTHON_PACKAGE_INSTALLATION,
    projectTypeDetection:
      'This is a Python/Django project. Look for requirements.txt, pyproject.toml, setup.py, Pipfile, or manage.py to confirm.',
    getAdditionalContextLines: (context) => {
      const projectTypeName = context.projectType
        ? getDjangoProjectTypeName(context.projectType)
        : 'unknown';

      // Map project type to framework ID for MCP docs resource
      const frameworkIdMap: Record<DjangoProjectType, string> = {
        [DjangoProjectType.STANDARD]: 'django',
        [DjangoProjectType.DRF]: 'django',
        [DjangoProjectType.WAGTAIL]: 'django',
        [DjangoProjectType.CHANNELS]: 'django',
      };

      const frameworkId = context.projectType
        ? frameworkIdMap[context.projectType]
        : 'django';

      const lines = [
        `Project type: ${projectTypeName}`,
        `Framework docs ID: ${frameworkId} (use posthog://docs/frameworks/${frameworkId} for documentation)`,
      ];

      if (context.settingsFile) {
        lines.push(`Settings file: ${context.settingsFile}`);
      }

      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: (context) => {
      const projectTypeName = context.projectType
        ? getDjangoProjectTypeName(context.projectType)
        : 'Django';
      return [
        `Analyzed your ${projectTypeName} project structure`,
        `Installed the PostHog Python package`,
        `Configured PostHog in your Django settings`,
        `Added PostHog middleware for automatic event tracking`,
      ];
    },
    getOutroNextSteps: () => [
      'Start your Django development server to see PostHog in action',
      'Visit your PostHog dashboard to see incoming events',
      'Use identify_context() within new_context() to associate events with users',
    ],
  },
};
