import { withUtm } from '../links';

describe('withUtm', () => {
  it('tags a URL with the wizard UTM params and no campaign', () => {
    const url = withUtm('https://us.posthog.com/products', 'outro-continue');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('utm_source')).toBe('wizard');
    expect(parsed.searchParams.get('utm_medium')).toBe('cli');
    expect(parsed.searchParams.get('utm_content')).toBe('outro-continue');
    expect(parsed.searchParams.has('utm_campaign')).toBe(false);
  });

  it('preserves existing query params and fragments', () => {
    const url = withUtm(
      'https://app.posthog.com/integrations/slack?a=1#connect',
      'slack-connect-setup',
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get('a')).toBe('1');
    expect(parsed.searchParams.get('utm_source')).toBe('wizard');
    expect(parsed.hash).toBe('#connect');
  });

  it('does not re-tag a URL that already carries a utm_source', () => {
    const once = withUtm('https://us.posthog.com/x', 'first');
    const twice = withUtm(once, 'second');
    expect(twice).toBe(once);
  });

  it('returns unparseable input untouched', () => {
    expect(withUtm('not a url', 'x')).toBe('not a url');
  });
});
