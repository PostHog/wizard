import type { RunnerContext } from '@programs/program-contract';

type SentEvent = { event: string; properties?: Record<string, unknown> };

const sent = vi.hoisted(() => [] as SentEvent[]);

vi.mock('posthog-node', () => ({
  PostHog: class {
    capture(event: SentEvent) {
      sent.push(event);
    }
    on() {
      return () => undefined;
    }
    shutdown() {
      return Promise.resolve();
    }
  },
}));

async function finishedEventAfter(...skillIds: (string | null)[]) {
  vi.resetModules();
  sent.length = 0;
  const { analytics } = await import('@utils/analytics');
  const { config } = await import('@programs/agent-skill');
  const { buildSession } = await import('@services/session');
  const resolve = config.run;
  if (typeof resolve !== 'function') throw new Error('Expected a run recipe');
  const runner: RunnerContext = {
    getFrameworkContext: vi.fn(),
    setFrameworkContext: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn() },
    spinner: vi.fn(),
  };
  for (const skillId of skillIds) {
    const session = { ...buildSession({}), skillId };
    const run = await resolve(session, runner);
    analytics.setProgramTags(run.analyticsTags);
  }
  await analytics.shutdown('success');
  return sent.find((e) => e.event === 'setup wizard finished')?.properties;
}

describe('migrated_from on setup wizard finished', () => {
  it('names the provider an email migration skill moves from', async () => {
    const finished = await finishedEventAfter('migrate-email-resend');

    expect(finished).toMatchObject({ migrated_from: 'resend' });
  });

  it('is absent from a run of any other skill', async () => {
    const finished = await finishedEventAfter('migrate-statsig');

    expect(finished).toBeDefined();
    expect(finished?.migrated_from).toBeUndefined();
  });

  it.each([['migrate-statsig'], [null]])(
    'is absent when the run moves on from an email migration to %s',
    async (nextSkillId) => {
      const finished = await finishedEventAfter(
        'migrate-email-resend',
        nextSkillId,
      );

      expect(finished).toBeDefined();
      expect(finished?.migrated_from).toBeUndefined();
    },
  );
});
