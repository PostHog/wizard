const { mockResolveApiKeyProjectDoctor, mockFetchHealthIssuesDoctor } =
  vi.hoisted(() => ({
    mockResolveApiKeyProjectDoctor: vi.fn(),
    mockFetchHealthIssuesDoctor: vi.fn(),
  }));

vi.mock(import('@shared/api-key-login'), () => ({
  resolveApiKeyProject: mockResolveApiKeyProjectDoctor,
}));
vi.mock(import('../fetch'), () => ({
  fetchHealthIssues: mockFetchHealthIssuesDoctor,
}));
vi.mock(import('@shared/errors'), async (importOriginal) => ({
  ...(await importOriginal()),
  emitWizardError: vi.fn(),
}));
vi.mock(import('@utils/analytics'), () => ({
  analytics: { flush: vi.fn().mockResolvedValue(undefined) } as never,
}));

import { ErrorCodes, emitWizardError } from '@shared/errors';
import { runDoctorReport } from '../report';

const log = {
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
  },
};

// `doctor --ci` is a CI gate: its code is the whole result.
describe('runDoctorReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveApiKeyProjectDoctor.mockResolvedValue({
      host: { apiHost: 'https://us.i.posthog.com' },
      project: { id: 42 },
      apiUser: null,
    });
  });

  it('resolves 0 for a healthy project', async () => {
    mockFetchHealthIssuesDoctor.mockResolvedValue([]);
    await expect(runDoctorReport({ apiKey: 'phx_key' }, { log })).resolves.toBe(
      0,
    );
    expect(mockFetchHealthIssuesDoctor).toHaveBeenCalledWith(
      'phx_key',
      'https://us.i.posthog.com',
      42,
    );
  });

  it('resolves 1 when the project has active issues', async () => {
    mockFetchHealthIssuesDoctor.mockResolvedValue([
      { kind: 'ingestion_lag', severity: 'warning' },
    ]);
    await expect(runDoctorReport({ apiKey: 'phx_key' }, { log })).resolves.toBe(
      1,
    );
  });

  it('resolves 1 and emits the missing-key error with no API key', async () => {
    await expect(runDoctorReport({}, { log })).resolves.toBe(1);
    expect(emitWizardError).toHaveBeenCalledWith(
      expect.objectContaining({ code: ErrorCodes.ArgsMissingApiKey }),
    );
    expect(mockResolveApiKeyProjectDoctor).not.toHaveBeenCalled();
  });
});
