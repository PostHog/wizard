/**
 * Data-warehouse-source suggestion in the default integration flow.
 *
 * These tests pin the properties that matter: the outro hands over a link that
 * opens the right source's form, projects with no detected source see a
 * byte-identical flow, and the suggestion never turns into an inline run.
 *
 * The links reach the user two ways, because the two sequences build the outro
 * differently: the linear one asks the program for the whole thing
 * (`buildOutroData`), while the orchestrated one composes its own message from
 * the drain and takes only the bullets (`buildOutroNextSteps`). The second is
 * the sequence that seeds the warehouse step, so it is also the one that can
 * say the run already connected the sources.
 */

import { POSTHOG_INTEGRATION_PROGRAM } from '@lib/programs/posthog-integration/steps';
import type { WizardSession } from '@lib/wizard-session';
import type { DetectedSource } from '@lib/warehouse-sources/types';
import { analytics } from '@utils/analytics';

import {
  CREDENTIALS,
  promptFor,
  resolveRun,
  sessionWith,
} from './helpers/integration-prompt.no-jest';

// The run builder reads the run's wizard flags; pin them empty so these
// tests stay hermetic (empty map = flags unreadable = shipped default).
beforeEach(() => {
  vi.spyOn(analytics, 'getAllFlagsForWizard').mockResolvedValue({});
});
afterEach(() => {
  vi.restoreAllMocks();
});

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

describe('outro suggestion', () => {
  it('gives every detected source its own pre-filled link', async () => {
    const s = sessionWith([POSTGRES, STRIPE]);
    const runDef = await resolveRun(s);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outro = runDef.buildOutroData!(s, CREDENTIALS as any)!;
    const text = outro.nextSteps!.items.join('\n');

    // The project segment and the kind are what land the user on the source's
    // own form. Drop the segment and the app renders 404; drop the kind and it
    // renders the catalog.
    expect(text).toContain(
      'https://us.posthog.com/project/1/data-warehouse/new-source?kind=postgres',
    );
    expect(text).toContain('kind=stripe');
    expect(text).toContain('npx @posthog/wizard warehouse');
  });

  it('summarizes the tail instead of listing every link', async () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((k) => ({
      ...POSTGRES,
      kind: k,
      label: k.toUpperCase(),
    }));
    const s = sessionWith(many);
    const runDef = await resolveRun(s);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outro = runDef.buildOutroData!(s, CREDENTIALS as any)!;
    const links = outro.nextSteps!.items.filter((i) =>
      i.includes('new-source'),
    );

    expect(links).toHaveLength(3);
    expect(outro.nextSteps!.items.join('\n')).toContain('And 2 more');
  });

  it('is absent when nothing was detected — outro unchanged', async () => {
    const s = sessionWith([]);
    const runDef = await resolveRun(s);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outro = runDef.buildOutroData!(s, CREDENTIALS as any)!;

    expect(outro.nextSteps).toBeUndefined();
  });

  it('never points the outro at a local report file', async () => {
    for (const sources of [[], [POSTGRES]]) {
      const s = sessionWith(sources);
      const runDef = await resolveRun(s);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outro = runDef.buildOutroData!(s, CREDENTIALS as any)!;

      // No report file — the report goes out via publish_handoff + notebook.
      expect(outro.reportFile).toBeUndefined();
    }
  });
});

describe('report instruction', () => {
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

/**
 * The default flow's STEP 5 writes the PostHog token to an env file, so what
 * it says about `check_env_keys` decides whether the agent trusts a key it
 * should not. The tool answers `{ status, foundIn }` and discounts committed
 * templates; a prompt still describing the single-file tool it used to be
 * teaches the agent to read the answer wrong.
 */
describe('env tool instruction', () => {
  it('tells the agent it can omit filePath and scan the project', async () => {
    const prompt = await promptFor([]);
    expect(prompt).toContain('Omit filePath');
    expect(prompt).not.toMatch(
      /keys already exist in the project's \.env file/,
    );
  });

  it('says a template declaration does not count as set', async () => {
    const prompt = await promptFor([]);
    expect(prompt).toMatch(/\.env\.example/);
    expect(prompt).toMatch(/documents a key rather than setting it/);
  });

  it('warns the agent off writing credentials into a template', async () => {
    const prompt = await promptFor([]);
    expect(prompt).toMatch(/never a file to write credentials into/);
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

describe('orchestrated outro suggestion', () => {
  const nextSteps = async (
    session: WizardSession,
    completedSeededTypes: readonly string[],
  ) => {
    const runDef = await resolveRun(session);
    return runDef.buildOutroNextSteps!(
      session,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      CREDENTIALS as any,
      completedSeededTypes,
    );
  };

  it('carries the same links the linear outro does', async () => {
    const s = sessionWith([POSTGRES, STRIPE]);

    const text = (await nextSteps(s, []))!.items.join('\n');

    expect(text).toContain(
      'https://us.posthog.com/project/1/data-warehouse/new-source?kind=postgres',
    );
    expect(text).toContain('kind=stripe');
    expect(text).toContain('npx @posthog/wizard warehouse');
  });

  it('still carries them when the seeded step did not connect the sources', async () => {
    const s = sessionWith([POSTGRES]);

    // A declined, skipped or failed warehouse step leaves the sources
    // unconnected, which is the case these bullets exist for.
    expect((await nextSteps(s, ['install']))!.items.join('\n')).toContain(
      'kind=postgres',
    );
  });

  it('offers nothing once the seeded warehouse step connected them', async () => {
    const s = sessionWith([POSTGRES]);

    expect(await nextSteps(s, ['warehouse'])).toBeUndefined();
  });

  it('still carries the sources the seeded step was never given', async () => {
    // The step is capped, so "it completed" means it connected the ones it was
    // handed — the tail is as unconnected as if the step had never run.
    const tail: DetectedSource = {
      kind: 'resend',
      label: 'Resend',
      mode: 'in-cli',
      matchedSignal: 'resend in package.json',
    };
    const s = sessionWith([POSTGRES, STRIPE, POSTGRES, tail]);

    const text = (await nextSteps(s, ['warehouse']))!.items.join('\n');

    expect(text).toContain('kind=resend');
    expect(text).not.toContain('kind=stripe');
  });

  it('offers nothing when nothing was detected', async () => {
    expect(await nextSteps(sessionWith([]), [])).toBeUndefined();
  });
});
