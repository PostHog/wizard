/* Flask wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { enableDebugLogs } from '../utils/debug';
import { runAgentWizard } from '../lib/agent-runner';
import { Integration } from '../lib/constants';
import clack from '../utils/clack';
import chalk from 'chalk';
import * as semver from 'semver';
import {
  getFlaskVersion,
  getFlaskProjectType,
  getFlaskProjectTypeName,
  getFlaskVersionBucket,
  FlaskProjectType,
  findFlaskAppFile,
} from './utils';

/**
 * Flask framework configuration for the universal agent runner
 */
const MINIMUM_FLASK_VERSION = '2.0.0';

const FLASK_AGENT_CONFIG: FrameworkConfig = {
  metadata: {
    name: 'Flask',
    integration: Integration.flask,
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
    getVersion: (_packageJson: any) => {
      // For Flask, we don't use package.json. Version is extracted separately
      // from requirements.txt or pyproject.toml in the wizard entry point
      return undefined;
    },
    getVersionBucket: getFlaskVersionBucket,
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
      const projectType = context.projectType as FlaskProjectType;
      return {
        projectType: projectType || 'unknown',
      };
    },
  },

  prompts: {
    projectTypeDetection:
      'This is a Python/Flask project. Look for requirements.txt, pyproject.toml, setup.py, Pipfile, or app.py/wsgi.py to confirm.',
    packageInstallation:
      'Use pip, poetry, or pipenv based on existing config files (requirements.txt, pyproject.toml, Pipfile). Do not pin the posthog version - just add "posthog" without version constraints.',
    getAdditionalContextLines: (context: any) => {
      const projectType = context.projectType as FlaskProjectType;
      const projectTypeName = projectType
        ? getFlaskProjectTypeName(projectType)
        : 'unknown';

      // Map project type to framework ID for MCP docs resource
      const frameworkIdMap: Record<FlaskProjectType, string> = {
        [FlaskProjectType.STANDARD]: 'flask',
        [FlaskProjectType.RESTFUL]: 'flask',
        [FlaskProjectType.RESTX]: 'flask',
        [FlaskProjectType.SMOREST]: 'flask',
        [FlaskProjectType.BLUEPRINT]: 'flask',
      };

      const frameworkId = projectType ? frameworkIdMap[projectType] : 'flask';

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
      const projectType = context.projectType as FlaskProjectType;
      const projectTypeName = projectType
        ? getFlaskProjectTypeName(projectType)
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

/**
 * Flask wizard powered by the universal agent runner.
 */
export async function runFlaskWizardAgent(
  options: WizardOptions,
): Promise<void> {
  if (options.debug) {
    enableDebugLogs();
  }

  // Check Flask version - agent wizard requires >= 2.0.0
  const flaskVersion = await getFlaskVersion(options);

  if (flaskVersion) {
    const coercedVersion = semver.coerce(flaskVersion);
    if (coercedVersion && semver.lt(coercedVersion, MINIMUM_FLASK_VERSION)) {
      const docsUrl =
        FLASK_AGENT_CONFIG.metadata.unsupportedVersionDocsUrl ??
        FLASK_AGENT_CONFIG.metadata.docsUrl;

      clack.log.warn(
        `Sorry: the wizard can't help you with Flask ${flaskVersion}. Upgrade to Flask ${MINIMUM_FLASK_VERSION} or later, or check out the manual setup guide.`,
      );
      clack.log.info(`Setup Flask manually: ${chalk.cyan(docsUrl)}`);
      clack.outro('PostHog wizard will see you next time!');
      return;
    }
  }

  await runAgentWizard(FLASK_AGENT_CONFIG, options);
}
