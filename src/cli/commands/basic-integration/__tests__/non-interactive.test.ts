import { nonInteractiveMessage } from '../non-interactive';

describe('nonInteractiveMessage', () => {
  test('a published build does not recommend the rejected --ci flag', () => {
    const message = nonInteractiveMessage(true);
    expect(message).not.toMatch(/--ci/);
    expect(message).toMatch(/interactive terminal/);
    expect(message).toMatch(/not available in published builds/);
  });

  test('a dev/test build recommends --ci', () => {
    expect(nonInteractiveMessage(false)).toMatch(
      /npx @posthog\/wizard --ci --region us --api-key phx_xxx/,
    );
  });
});
