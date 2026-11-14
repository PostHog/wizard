type SentEvent = { event: string; properties?: Record<string, unknown> };

const sent = vi.hoisted(() => [] as SentEvent[]);

vi.mock('posthog-node', () => ({
  PostHog: class {
    capture(event: SentEvent) {
      sent.push(event);
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
  const { SessionStore } = await import('../session-store');
  const { buildSession } = await import('../wizard-session');
  const store = new SessionStore(buildSession({}));
  for (const skillId of skillIds) store.setSkillId(skillId);
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
