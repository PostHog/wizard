/**
 * Data-warehouse-source suggestion in the default integration flow.
 *
 * The flow detects connectable sources and *points at* `wizard warehouse` —
 * it does not run it. These tests pin the two properties that matter:
 * projects with no detected source see a byte-identical flow, and the
 * suggestion never turns into an inline run.
 */

import { posthogIntegrationConfig } from '@lib/programs/posthog-integration/index';
import { POSTHOG_INTEGRATION_PROGRAM } from '@lib/programs/posthog-integration/steps';
import { DETECTED_WAREHOUSE_SOURCES_KEY } from '@lib/programs/warehouse-source/detect';
import { buildSession, type WizardSession } from '@lib/wizard-session';
import type { DetectedSource } from '@lib/warehouse-sources/types';

const POSTGRES: DetectedSource = {
  kind: 'postgres',
  label: 'Postgres',
  mode: 'in-cli',
  matchedSignal: 'DATABASE_URL in .env',
};

const STRIPE: DetectedSource = {
  kind: 'stripe',
  label: 'Stripe',
  mode: 'in-cli',
  matchedSignal: 'stripe in package.json',
};

const CREDENTIALS = {
  accessToken: 'tok',
  projectApiKey: 'phc_test',
  projectId: '1',
  host: {
    apiHost: 'https://us.i.posthog.com',
    appHost: 'https://us.posthog.com',
  },
};

const FRAMEWORK_CONFIG = {
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

function sessionWith(sources: DetectedSource[]): WizardSession {
  const s = buildSession({ installDir: '/tmp/app' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s.frameworkConfig = FRAMEWORK_CONFIG as any;
  if (sources.length > 0) {
    s.frameworkContext[DETECTED_WAREHOUSE_SOURCES_KEY] = sources;
  }
  return s;
}

async function resolveRun(session: WizardSession) {
  const { run } = posthogIntegrationConfig;
  if (typeof run !== 'function') throw new Error('expected a run function');
  return run(session);
}

describe('outro suggestion', () => {
  it('names the detected sources and points at the standalone command', async () => {
    const s = sessionWith([POSTGRES, STRIPE]);
    const runDef = await resolveRun(s);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outro = runDef.buildOutroData!(s, CREDENTIALS as any);

    expect(outro.nextSteps).toBeDefined();
    expect(outro.nextSteps!.items.join(' ')).toContain('Postgres, Stripe');
    expect(outro.nextSteps!.items.join(' ')).toContain(
      'npx @posthog/wizard warehouse',
    );
  });

  it('is absent when nothing was detected — outro unchanged', async () => {
    const s = sessionWith([]);
    const runDef = await resolveRun(s);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outro = runDef.buildOutroData!(s, CREDENTIALS as any);

    expect(outro.nextSteps).toBeUndefined();
  });

  it('keeps the PostHog headline and change list intact either way', async () => {
    for (const sources of [[], [POSTGRES]]) {
      const s = sessionWith(sources);
      const runDef = await resolveRun(s);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outro = runDef.buildOutroData!(s, CREDENTIALS as any);

      expect(outro.message).toBe('Successfully installed PostHog!');
      expect(outro.changes).toContain('Added PostHog provider');
      expect(outro.reportFile).toBe('posthog-setup-report.md');
    }
  });
});

describe('report instruction', () => {
  const promptFor = async (sources: DetectedSource[]) => {
    const s = sessionWith(sources);
    const runDef = await resolveRun(s);
    return runDef.customPrompt!({
      projectId: 1,
      projectApiKey: 'phc_test',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      host: CREDENTIALS.host as any,
    });
  };

  it('asks the agent to note the sources in the report checklist', async () => {
    const prompt = await promptFor([POSTGRES]);
    expect(prompt).toContain('Verify before merging');
    expect(prompt).toContain('npx @posthog/wizard warehouse');
  });

  it('tells the agent not to set them up in this run', async () => {
    const prompt = await promptFor([POSTGRES]);
    expect(prompt).toContain('Do not attempt to set them up yourself');
  });

  it('adds nothing when no sources were detected', async () => {
    const prompt = await promptFor([]);
    expect(prompt).not.toContain('warehouse');
    expect(prompt).not.toContain('data sources PostHog can import');
  });
});

describe('flow shape', () => {
  it('adds no steps — the suggestion never becomes an inline run', () => {
    const ids = POSTHOG_INTEGRATION_PROGRAM.map((s) => s.id);
    expect(ids).toEqual([
      'detect',
      'intro',
      'health-check',
      'setup',
      'auth',
      'run',
      'outro',
      'mcp',
      'slack-connect',
      'keep-skills',
    ]);
  });

  it('keeps the program single-run, so the outro stays terminal', () => {
    // A step carrying its own `run` would flip run-wizard into the composed
    // walk, where a second agent run could abort before the outro is pushed.
    expect(POSTHOG_INTEGRATION_PROGRAM.some((s) => s.run)).toBe(false);
  });
});
