export enum Integration {
  nextjs = 'nextjs',
  react = 'react',
}

export function getIntegrationDescription(type: string): string {
  switch (type) {
    case Integration.nextjs:
      return 'Next.js';
    case Integration.react:
      return 'React';
    default:
      throw new Error(`Unknown integration ${type}`);
  }
}

type IntegrationChoice = {
  name: string;
  value: string;
};

export function getIntegrationChoices(): IntegrationChoice[] {
  return Object.keys(Integration).map((type: string) => ({
    name: getIntegrationDescription(type),
    value: type,
  }));
}

export interface Args {
  debug: boolean;
  integration: Integration;
}

export const IS_DEV = false;

export const DEFAULT_URL = IS_DEV
  ? 'http://localhost:8010'
  : 'https://us.posthog.com';
export const ISSUES_URL = 'https://github.com/posthog/wizard/issues';
export const DEFAULT_HOST_URL = IS_DEV
  ? 'http://localhost:8010'
  : 'https://us.i.posthog.com';
export const ANALYTICS_POSTHOG_PUBLIC_PROJECT_WRITE_KEY = 'sTMFPsFhdP1Ssg';
export const ANALYTICS_HOST_URL = IS_DEV
  ? 'http://localhost:8010'
  : 'https://internal-t.posthog.com';
export const DUMMY_PROJECT_API_KEY = '_YOUR_POSTHOG_PROJECT_API_KEY_';
