/**
 * `handleApiError` builds the message the user actually reads. A certificate
 * rejection arrives with no HTTP response, so it used to fall through to a bare
 * "Failed to <operation>" — dropping the one detail the user can act on.
 */
import { AxiosError } from 'axios';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

import { handleApiError } from '../api';

describe('handleApiError', () => {
  it('explains a certificate rejection and how to fix it', () => {
    // Verbatim from error tracking issue 019f9654.
    const error = Object.assign(
      new Error(
        'self-signed certificate; if the root CA is installed locally, try running Node.js with --use-system-ca',
      ),
      { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
    );

    const result = handleApiError(error, 'fetch user data');

    expect(result.message).toContain('Could not verify the HTTPS certificate');
    expect(result.message).toContain('--use-system-ca');
    expect(result.message).toContain('NODE_EXTRA_CA_CERTS');
  });

  it.each([
    [401, 'Authentication failed'],
    [403, 'Access denied'],
    [404, 'Resource not found'],
  ])('leaves the %i message alone', (status, expected) => {
    const error = new AxiosError('Request failed');
    error.response = { status, data: {} } as AxiosError['response'];

    const result = handleApiError(error, 'fetch user data');

    expect(result.message).toContain(expected);
    expect(result.statusCode).toBe(status);
  });
});
