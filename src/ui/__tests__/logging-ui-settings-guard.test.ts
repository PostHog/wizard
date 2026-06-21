/**
 * Regression: a `--ci` run must NOT silently proceed past a Claude Code settings
 * override that redirects the LLM gateway. `LoggingUI.showSettingsOverride` used
 * to `return Promise.resolve()` — so a settings file carrying
 * `env.ANTHROPIC_BASE_URL = https://api.code-relay.com` (or any relay) was
 * detected, ignored, and the agent launched against that host. This locks in the
 * fix: remove the writable (project) override; refuse on anything we can't remove.
 */

// Import via the @ui entry (not @ui/logging-ui directly) to avoid a pre-existing
// logging-ui → readiness → @ui/index import cycle. getUI()'s default IS a
// LoggingUI, and showSettingsOverride holds no instance state.
import { getUI } from '@ui';
import type { SettingsConflict } from '@lib/agent/claude-settings';

const ui = () => getUI();
const RELAY = 'ANTHROPIC_BASE_URL';

describe('LoggingUI — CI gateway-override guard', () => {
  it('refuses (rejects) on a non-removable ANTHROPIC_BASE_URL override — was a silent leak', async () => {
    const managed: SettingsConflict = {
      source: 'managed',
      path: '/Library/Application Support/ClaudeCode/managed-settings.json',
      keys: [RELAY],
      writable: false,
    };
    await expect(
      ui().showSettingsOverride([managed], () => false),
    ).rejects.toThrow(/redirect agent traffic off the PostHog LLM Gateway/);
  });

  it('refuses on a user-global (~/.claude) override too', async () => {
    const user: SettingsConflict = {
      source: 'user',
      path: '/home/dev/.claude/settings.json',
      keys: [RELAY],
      writable: false,
    };
    await expect(
      ui().showSettingsOverride([user], () => false),
    ).rejects.toThrow(/Refusing to launch/);
  });

  it('removes the writable project override and proceeds (no leak, no abort)', async () => {
    let removed = false;
    const project: SettingsConflict = {
      source: 'project',
      path: '/app/.claude/settings.json',
      keys: [RELAY],
      writable: true,
    };
    await expect(
      ui().showSettingsOverride([project], () => {
        removed = true;
        return true;
      }),
    ).resolves.toBeUndefined();
    expect(removed).toBe(true);
  });

  it('no conflicts → resolves', async () => {
    await expect(
      ui().showSettingsOverride([], () => false),
    ).resolves.toBeUndefined();
  });
});
