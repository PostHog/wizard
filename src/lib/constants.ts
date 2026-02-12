/**
 * Detection order matters: put framework-specific integrations BEFORE basic language fallbacks
 */
export enum Integration {
  // Frameworks
  nextjs = 'nextjs',
  nuxt = 'nuxt',
  vue = 'vue',
  reactRouter = 'react-router',
  tanstackStart = 'tanstack-start',
  tanstackRouter = 'tanstack-router',
  reactNative = 'react-native',
  angular = 'angular',
  astro = 'astro',
  django = 'django',
  flask = 'flask',
  fastapi = 'fastapi',
  laravel = 'laravel',
  sveltekit = 'sveltekit',
  swift = 'swift',
  android = 'android',

  // Language fallbacks
  python = 'python',
  javascript = 'javascript',
}
export interface Args {
  debug: boolean;
  integration: Integration;
}

export const IS_DEV = ['test', 'development'].includes(
  process.env.NODE_ENV ?? '',
);

export const DEBUG = false;

export const DEFAULT_URL = IS_DEV
  ? 'http://localhost:8010'
  : 'https://us.posthog.com';
export const ISSUES_URL = 'https://github.com/posthog/wizard/issues';
export const DEFAULT_HOST_URL = IS_DEV
  ? 'http://localhost:8010'
  : 'https://us.i.posthog.com';
export const ANALYTICS_POSTHOG_PUBLIC_PROJECT_WRITE_KEY = 'sTMFPsFhdP1Ssg';
export const ANALYTICS_HOST_URL = 'https://internal-j.posthog.com';
export const ANALYTICS_TEAM_TAG = 'docs-and-wizard';
export const DUMMY_PROJECT_API_KEY = '_YOUR_POSTHOG_PROJECT_API_KEY_';

export const POSTHOG_US_CLIENT_ID = 'c4Rdw8DIxgtQfA80IiSnGKlNX8QN00cFWF00QQhM';
export const POSTHOG_EU_CLIENT_ID = 'bx2C5sZRN03TkdjraCcetvQFPGH6N2Y9vRLkcKEy';
export const POSTHOG_DEV_CLIENT_ID = 'DC5uRLVbGI02YQ82grxgnK6Qn12SXWpCqdPb60oZ';
export const OAUTH_PORT = 8239;

export const WIZARD_INTERACTION_EVENT_NAME = 'wizard interaction';
export const WIZARD_REMARK_EVENT_NAME = 'wizard remark';
