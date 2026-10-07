import { getSlackAppCard } from '../slack-app-card';

describe('getSlackAppCard', () => {
  it('returns a populated, role-independent card', () => {
    const card = getSlackAppCard();
    expect(card.headline).toBeTruthy();
    expect(card.pitch).toBeTruthy();
    expect(card.capabilities).toHaveLength(2);
    for (const capability of card.capabilities) {
      expect(capability).toBeTruthy();
    }
  });

  it('exposes the documented learn-more and setup URLs', () => {
    const card = getSlackAppCard();
    expect(card.learnMoreUrl).toBe('https://posthog.com/slack');
    expect(card.setupUrl).toBe('https://app.posthog.com/integrations/slack');
  });

  it('describes both Slack agent capabilities — code/PR and data', () => {
    const [code, data] = getSlackAppCard().capabilities;
    expect(code).toMatch(/PR/i);
    expect(data).toMatch(/data question|SQL/i);
  });
});
