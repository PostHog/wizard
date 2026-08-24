import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchProjectData } from '../api';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    isAxiosError: vi.fn(),
  },
}));

describe('PostHog API transport', () => {
  const project = {
    id: 123,
    uuid: '00000000-0000-0000-0000-000000000000',
    organization: '00000000-0000-0000-0000-000000000001',
    api_token: 'phc_test',
    name: 'Test project',
  };

  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
  });

  it('allows enough time for a dual-stack connection fallback', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: project });

    await fetchProjectData(
      'access-token',
      project.id,
      'https://eu.posthog.com',
    );

    const [, requestConfig] = vi.mocked(axios.get).mock.calls[0];
    expect(requestConfig?.httpsAgent).toHaveProperty(
      'options.autoSelectFamilyAttemptTimeout',
      2_000,
    );
  });
});
