/* WordPress wizard using posthog-agent with PostHog MCP */
import type { WizardRunOptions } from '@utils/types';
import type { FrameworkConfig } from '@lib/framework-config';
import { composerPackageManager } from '@lib/detection/package-manager';
import { Integration } from '@lib/constants';
import {
  findPluginsDir,
  getWordPressVersion,
  getWordPressVersionBucket,
  hasComposerWordPress,
  hasWordPressCore,
} from './utils';

type WordPressContext = {
  /** Classic install owns core at the root; Bedrock manages it via Composer. */
  installKind?: 'classic' | 'composer';
  pluginsDir?: string;
};

export const WORDPRESS_AGENT_CONFIG: FrameworkConfig<WordPressContext> = {
  metadata: {
    name: 'WordPress',
    integration: Integration.wordpress,
    docsUrl: 'https://posthog.com/docs/libraries/wordpress',
    unsupportedVersionDocsUrl: 'https://posthog.com/docs/libraries/php',
    gatherContext: (options: WizardRunOptions) =>
      Promise.resolve({
        installKind: hasWordPressCore(options.installDir)
          ? ('classic' as const)
          : ('composer' as const),
        pluginsDir: findPluginsDir(options.installDir),
      }),
  },

  detection: {
    packageName: 'posthog/posthog-php',
    packageDisplayName: 'WordPress',
    usesPackageJson: false,
    getVersion: () => undefined,
    getVersionBucket: getWordPressVersionBucket,
    getInstalledVersion: (options: WizardRunOptions) =>
      Promise.resolve(getWordPressVersion(options)),
    detect: (options) => {
      const { installDir } = options;

      // Only a full site is claimed: wp-config.php and friends at the root,
      // or Composer-managed core (Bedrock). A standalone plugin or theme
      // directory is deliberately not — the integration writes a plugin into
      // a site tree, so it needs one to exist.
      return Promise.resolve(
        hasWordPressCore(installDir) || hasComposerWordPress(installDir),
      );
    },
    detectPackageManager: composerPackageManager,
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
      installKind: context.installKind || 'unknown',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a WordPress site. Look for wp-config.php, wp-load.php, and the wp-includes/ directory to confirm. Composer-managed installs (Bedrock) keep core out of the root — check composer.json for johnpbloch/wordpress or roots/wordpress.',
    packageInstallation:
      'Use Composer to install packages. Run `composer require posthog/posthog-php` without pinning a specific version, from inside the plugin directory that will own the dependency — not the site root.',
    getAdditionalContextLines: (context) => {
      // Integration rules (plugin over functions.php, ABSPATH, esc_js, flush)
      // live in context-mill's wordpress commandments and reach the agent with
      // the skill. Only project-shape facts the skill cannot know belong here.
      const lines = [
        `Project type: WordPress site (${
          context.installKind ?? 'classic'
        } install)`,
        `Framework docs ID: php (use posthog://docs/frameworks/php for documentation)`,
      ];

      if (context.pluginsDir) {
        lines.push(`Plugins directory: ${context.pluginsDir}`);
      }

      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: (context) => [
      'Analyzed your WordPress site',
      'Installed the PostHog PHP package via Composer',
      `Added a PostHog plugin under ${
        context.pluginsDir ?? 'wp-content/plugins'
      }`,
      'Wired client-side autocapture on wp_head and a server-side capture on a WordPress action',
    ],
    getOutroNextSteps: () => [
      'Activate the PostHog plugin from Plugins in wp-admin',
      'Load any page on the site, then check your PostHog dashboard for incoming events',
      'Use PostHog::capture() inside WordPress actions to track server-side events',
      'Move the project token into a wp-config.php constant before deploying',
    ],
  },
};
