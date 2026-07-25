/* WordPress wizard using posthog-agent with PostHog MCP */
import type { WizardRunOptions } from '@utils/types';
import type { FrameworkConfig } from '@lib/framework-config';
import { composerPackageManager } from '@lib/detection/package-manager';
import { Integration } from '@lib/constants';
import {
  WordPressProjectType,
  findPluginHeaderFile,
  findPluginsDir,
  getWordPressProjectType,
  getWordPressProjectTypeName,
  getWordPressVersion,
  getWordPressVersionBucket,
  hasComposerWordPress,
  hasThemeHeader,
  hasWordPressCore,
} from './utils';

type WordPressContext = {
  projectType?: WordPressProjectType;
  pluginsDir?: string;
  pluginHeaderFile?: string;
};

export const WORDPRESS_AGENT_CONFIG: FrameworkConfig<WordPressContext> = {
  metadata: {
    name: 'WordPress',
    integration: Integration.wordpress,
    docsUrl: 'https://posthog.com/docs/libraries/wordpress',
    unsupportedVersionDocsUrl: 'https://posthog.com/docs/libraries/php',
    gatherContext: (options: WizardRunOptions) => {
      const projectType = getWordPressProjectType(options);

      return Promise.resolve({
        projectType,
        pluginsDir: findPluginsDir(options.installDir),
        pluginHeaderFile: findPluginHeaderFile(options.installDir),
      });
    },
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

      // A full site: wp-config.php and friends, or Composer-managed core.
      if (hasWordPressCore(installDir) || hasComposerWordPress(installDir)) {
        return Promise.resolve(true);
      }

      // A single plugin or theme directory, worked on outside a site tree.
      if (findPluginHeaderFile(installDir) || hasThemeHeader(installDir)) {
        return Promise.resolve(true);
      }

      return Promise.resolve(false);
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
      projectType: context.projectType || 'unknown',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a WordPress project. Look for wp-config.php, wp-content/, or a PHP file with a `Plugin Name:` header to confirm. Composer-managed installs (Bedrock) keep core out of the root — check composer.json for johnpbloch/wordpress or roots/wordpress.',
    packageInstallation:
      'Use Composer to install packages. Run `composer require posthog/posthog-php` without pinning a specific version, from inside the plugin directory that will own the dependency — not the site root.',
    getAdditionalContextLines: (context) => {
      const projectTypeName = context.projectType
        ? getWordPressProjectTypeName(context.projectType)
        : 'unknown';

      const lines = [
        `Project type: ${projectTypeName}`,
        `Framework docs ID: php (use posthog://docs/frameworks/php for documentation)`,
        "Ship the integration as a standalone plugin. Do NOT edit the active theme's functions.php — a theme switch or theme update silently removes the tracking.",
        "Guard every plugin entry file with `if (!defined('ABSPATH')) { exit; }` before any other code.",
        'Print the client snippet from a wp_head hook and escape the interpolated token with esc_js().',
        'Capture pageviews client-side. Reserve PostHog::capture for server-side WordPress actions such as comment_post, user_register, or woocommerce_thankyou, and call PostHog::flush() after each capture — a web request has no single exit point like a CLI script.',
      ];

      if (context.pluginsDir) {
        lines.push(`Plugins directory: ${context.pluginsDir}`);
      }

      if (context.pluginHeaderFile) {
        lines.push(
          `Existing plugin entry file: ${context.pluginHeaderFile} (add to this plugin rather than creating a new one)`,
        );
      }

      if (context.projectType === WordPressProjectType.THEME) {
        lines.push(
          'This directory is a theme. Prefer creating a companion plugin next to it so tracking survives a theme change; only fall back to the theme if the user insists.',
        );
      }

      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: (context) => {
      const projectTypeName = context.projectType
        ? getWordPressProjectTypeName(context.projectType)
        : 'WordPress project';

      const changes = [
        `Analyzed your ${projectTypeName}`,
        'Installed the PostHog PHP package via Composer',
      ];

      if (context.projectType === WordPressProjectType.SITE) {
        changes.push('Added a PostHog plugin under wp-content/plugins');
      } else {
        changes.push('Added PostHog initialization to your plugin entry file');
      }

      changes.push(
        'Wired client-side autocapture on wp_head and a server-side capture on a WordPress action',
      );

      return changes;
    },
    getOutroNextSteps: () => [
      'Activate the PostHog plugin from Plugins in wp-admin',
      'Load any page on the site, then check your PostHog dashboard for incoming events',
      'Use PostHog::capture() inside WordPress actions to track server-side events',
      'Move the project token into a wp-config.php constant before deploying',
    ],
  },
};
