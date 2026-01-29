/* Django wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { runAgentWizard } from '../lib/agent-runner';
import { Integration } from '../lib/constants';
import fg from 'fast-glob';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getDjangoVersion,
  getDjangoProjectType,
  getDjangoProjectTypeName,
  getDjangoVersionBucket,
  DjangoProjectType,
  findDjangoSettingsFile,
} from './utils';

type DjangoContext = {
  projectType?: DjangoProjectType;
  settingsFile?: string;
};

export const DJANGO_AGENT_CONFIG: FrameworkConfig<DjangoContext> = {
  metadata: {
    name: 'Django',
    integration: Integration.django,
    beta: true,
    docsUrl: 'https://posthog.com/docs/libraries/django',
    unsupportedVersionDocsUrl: 'https://posthog.com/docs/libraries/python',
    gatherContext: async (options: WizardOptions) => {
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
    getInstalledVersion: (options: WizardOptions) => getDjangoVersion(options),
    detect: async (options) => {
      const { installDir } = options;

      const managePyMatches = await fg('**/manage.py', {
        cwd: installDir,
        ignore: ['**/venv/**', '**/.venv/**', '**/env/**', '**/.env/**'],
      });

      if (managePyMatches.length > 0) {
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
            continue;
          }
        }
      }

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
          if (
            content.toLowerCase().includes('django') &&
            !content.toLowerCase().includes('django-')
          ) {
            return true;
          }
        } catch {
          continue;
        }
      }

      return false;
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
    getTags: (context) => ({
      projectType: context.projectType || 'unknown',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a Python/Django project. Look for requirements.txt, pyproject.toml, setup.py, Pipfile, or manage.py to confirm.',
    packageInstallation:
      'Use pip, poetry, or pipenv based on existing config files (requirements.txt, pyproject.toml, Pipfile). Do not pin the posthog version - just add "posthog" without version constraints.',
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

/**
 * Django wizard powered by the universal agent runner.
 */
export async function runDjangoWizardAgent(
  options: WizardOptions,
): Promise<void> {
  await runAgentWizard(DJANGO_AGENT_CONFIG, options);
}
