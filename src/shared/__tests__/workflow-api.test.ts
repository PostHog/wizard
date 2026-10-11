/**
 * The draft create tags each workflow with the wizard as its origin. A PostHog
 * that does not know that origin yet must still get the draft, not a failure.
 */
import axios from 'axios';
import type { Mocked } from 'vitest';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    default: {
      ...actual.default,
      post: vi.fn(),
      isAxiosError: actual.isAxiosError,
    },
  };
});
vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

import { createDraftWorkflow } from '@shared/api';

const mockedAxios = axios as Mocked<typeof axios>;

function rejection(status: number, data: unknown) {
  return Object.assign(new Error('Request failed'), {
    isAxiosError: true,
    response: { status, data },
    config: {},
  });
}

describe('createDraftWorkflow', () => {
  beforeEach(() => mockedAxios.post.mockReset());

  it('sends the origin and forces draft status', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { id: 'abc' } });

    await createDraftWorkflow(
      't',
      2,
      'https://x',
      { status: 'active' },
      'wizard',
    );

    expect(mockedAxios.post.mock.calls[0][1]).toEqual({
      status: 'draft',
      origin_product: 'wizard',
    });
  });

  it('retries without the origin when the server rejects only that field', async () => {
    mockedAxios.post
      .mockRejectedValueOnce(rejection(400, { attr: 'origin_product' }))
      .mockResolvedValueOnce({ data: { id: 'abc' } });

    await expect(
      createDraftWorkflow('t', 2, 'https://x', {}, 'wizard'),
    ).resolves.toEqual({ id: 'abc' });
    expect(mockedAxios.post.mock.calls[1][1]).toEqual({ status: 'draft' });
  });

  it('does not retry any other validation error', async () => {
    mockedAxios.post.mockRejectedValueOnce(
      rejection(400, { attr: 'actions', detail: 'Invalid email step' }),
    );

    await expect(
      createDraftWorkflow('t', 2, 'https://x', {}, 'wizard'),
    ).rejects.toThrow('Invalid email step');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });
});
