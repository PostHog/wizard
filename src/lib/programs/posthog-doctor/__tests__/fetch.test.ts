import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchHealthIssues } from '../fetch';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    isAxiosError: vi.fn(),
  },
}));

describe('fetchHealthIssues', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
  });

  it('allows enough time for a dual-stack connection fallback', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { results: [] } });

    await fetchHealthIssues('access-token', 'https://eu.i.posthog.com', 123);

    const [, requestConfig] = vi.mocked(axios.get).mock.calls[0];
    expect(requestConfig?.httpsAgent).toHaveProperty(
      'options.autoSelectFamilyAttemptTimeout',
      2_000,
    );
  });
});
