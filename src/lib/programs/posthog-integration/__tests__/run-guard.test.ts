import { buildSession } from '@lib/wizard-session';

// wizardAbort exits via process.exit in production (returns `never`). The mock
// throws a sentinel so we can both assert it was called and prove `run` never
// falls through to dereference `config.detection`.
const ABORT_SENTINEL = new Error('__wizard_abort__');
const { mockWizardAbort } = vi.hoisted(() => ({
  mockWizardAbort: vi.fn(() => {
    throw ABORT_SENTINEL;
  }),
}));

vi.mock('@utils/wizard-abort', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@utils/wizard-abort')>()),
  wizardAbort: mockWizardAbort,
}));

import { posthogIntegrationConfig } from '../index';

describe('posthogIntegrationConfig.run — null frameworkConfig guard', () => {
  beforeEach(() => {
    mockWizardAbort.mockClear();
  });

  it('aborts cleanly instead of crashing on config.detection when frameworkConfig is null', async () => {
    const session = buildSession({ ci: true });
    session.frameworkConfig = null;

    // Reaches wizardAbort (which throws our sentinel) rather than a TypeError
    // from reading `config.detection.usesPackageJson`.
    await expect(posthogIntegrationConfig.run(session)).rejects.toBe(
      ABORT_SENTINEL,
    );

    expect(mockWizardAbort).toHaveBeenCalledTimes(1);
    expect(mockWizardAbort).toHaveBeenCalledWith({
      message: 'Could not auto-detect your framework for this project.',
    });
  });
});
