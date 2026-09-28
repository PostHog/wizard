import { describe, expect, it } from 'vitest';
import { sanitizeErrorDetail } from '../sanitize';

describe('sanitizeErrorDetail', () => {
  it('keeps allowlisted fields', () => {
    expect(
      sanitizeErrorDetail({
        reason: 'missing',
        detected: 'node',
        platform: 'web',
      }),
    ).toEqual({ reason: 'missing', detected: 'node', platform: 'web' });
  });

  it('strips path-like fields', () => {
    expect(
      sanitizeErrorDetail({
        path: '/Users/dev/secret-project',
        reason: 'unreadable',
      }),
    ).toEqual({ reason: 'unreadable' });
  });

  it('returns undefined for undefined input', () => {
    expect(sanitizeErrorDetail(undefined)).toBeUndefined();
  });

  it('returns undefined when nothing survives the allowlist', () => {
    expect(
      sanitizeErrorDetail({ path: '/tmp/x', installDir: '/tmp/x' }),
    ).toBeUndefined();
  });
});
