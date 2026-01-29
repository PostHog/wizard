/* Django wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { runAgentWizard } from '../lib/agent-runner';
import { Integration } from '../lib/constants';
import {
  getDjangoVersion,
  getDjangoProjectType,
  getDjangoProjectTypeName,
  getDjangoVersionBucket,
  DjangoProjectType,
  findDjangoSettingsFile,
} from './utils';

const DJANGO_AGENT_CONFIG: FrameworkConfig = {
  metadata: {
    name: 'Django',
    integration: Integration.django,
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
    getVersion: (_packageJson: any) => undefined,
    getVersionBucket: getDjangoVersionBucket,
    minimumVersion: '3.0.0',
    getInstalledVersion: (options: WizardOptions) => getDjangoVersion(options),
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
      const projectType = context.projectType as DjangoProjectType;
      return {
        projectType: projectType || 'unknown',
      };
    },
  },

  prompts: {
    projectTypeDetection:
      'This is a Python/Django project. Look for requirements.txt, pyproject.toml, setup.py, Pipfile, or manage.py to confirm.',
    packageInstallation:
      'Use pip, poetry, or pipenv based on existing config files (requirements.txt, pyproject.toml, Pipfile). Do not pin the posthog version - just add "posthog" without version constraints.',
    getAdditionalContextLines: (context: any) => {
      const projectType = context.projectType as DjangoProjectType;
      const projectTypeName = projectType
        ? getDjangoProjectTypeName(projectType)
        : 'unknown';

      // Map project type to framework ID for MCP docs resource
      const frameworkIdMap: Record<DjangoProjectType, string> = {
        [DjangoProjectType.STANDARD]: 'django',
        [DjangoProjectType.DRF]: 'django',
        [DjangoProjectType.WAGTAIL]: 'django',
        [DjangoProjectType.CHANNELS]: 'django',
      };

      const frameworkId = projectType ? frameworkIdMap[projectType] : 'django';

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
    getOutroChanges: (context: any) => {
      const projectType = context.projectType as DjangoProjectType;
      const projectTypeName = projectType
        ? getDjangoProjectTypeName(projectType)
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
