import { resolveBaseUrl } from '@utils/urls';

describe('resolveBaseUrl', () => {
  it('drops trailing slashes so every SDK joins the ingestion path cleanly', () => {
    expect(resolveBaseUrl('https://posthog.example.com/')).toBe(
      'https://posthog.example.com',
    );
    expect(resolveBaseUrl('https://posthog.example.com//')).toBe(
      'https://posthog.example.com',
    );
    expect(resolveBaseUrl('  https://posthog.example.com  ')).toBe(
      'https://posthog.example.com',
    );
  });
});
