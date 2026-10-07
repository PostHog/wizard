/** Fixtures for the tests that build the default integration's run definition and prompt. */

import { DETECTED_WAREHOUSE_SOURCES_KEY } from '@programs/warehouse-sources/detect';
import { testRunnerContext } from '@programs/shared/__tests__/runner-context.no-jest';
import { buildSession } from '@programs/session/wizard-session';
import type { WizardSession } from '@programs/session/wizard-session';
import type { DetectedSource } from '@programs/warehouse-sources/types';
import { config as posthogIntegration } from '../../index';

export const CREDENTIALS = {
  accessToken: 'tok',
  projectApiKey: 'phc_test',
  projectId: '1',
  host: {
    apiHost: 'https://us.i.posthog.com',
    appHost: 'https://us.posthog.com',
  },
};

export const FRAMEWORK_CONFIG = {
  metadata: { name: 'Next.js', docsUrl: 'https://posthog.com/docs' },
  environment: { getEnvVars: () => ({ POSTHOG_KEY: 'phc_test' }) },
  ui: { getOutroChanges: () => ['Added PostHog provider'] },
  detection: {
    usesPackageJson: false,
    getVersion: () => '15.0.0',
    packageName: 'next',
    packageDisplayName: 'Next.js',
  },
  analytics: { getTags: () => ({}) },
  prompts: { projectTypeDetection: 'app router' },
};

export function sessionWith(sources: DetectedSource[]): WizardSession {
  const s = buildSession({ installDir: '/tmp/app' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s.frameworkConfig = FRAMEWORK_CONFIG as any;
  if (sources.length > 0) {
    s.frameworkContext[DETECTED_WAREHOUSE_SOURCES_KEY] = sources;
  }
  return s;
}

export async function resolveRun(session: WizardSession) {
  const { run } = posthogIntegration;
  if (typeof run !== 'function') throw new Error('expected a run function');
  return run(session, testRunnerContext(session));
}

export const promptFor = async (sources: DetectedSource[]) => {
  const s = sessionWith(sources);
  const runDef = await resolveRun(s);
  return runDef.customPrompt!({
    projectId: 1,
    projectApiKey: 'phc_test',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    host: CREDENTIALS.host as any,
  });
};
