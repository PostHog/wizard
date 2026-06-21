/**
 * Regression: a managed (org/MDM) Claude Code settings override that redirects
 * the gateway must be detected on EVERY platform. Detection used to hardcode the
 * macOS managed path, so a managed `env.ANTHROPIC_BASE_URL` on Linux/Windows
 * (e.g. a corporate relay) went undetected — the wizard launched the agent and
 * every model call was redirected off the PostHog gateway, even interactively.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  checkAllSettingsConflicts,
  MANAGED_SETTINGS_PATHS,
} from '../claude-settings';

const MACOS_ONLY = [
  '/Library/Application Support/ClaudeCode/managed-settings.json',
];

describe('managed settings detection — cross-platform gateway-override guard', () => {
  it('default managed paths cover Linux and Windows, not just macOS', () => {
    expect(MANAGED_SETTINGS_PATHS).toEqual(
      expect.arrayContaining([
        '/etc/claude-code/managed-settings.json',
        'C:\\ProgramData\\ClaudeCode\\managed-settings.json',
      ]),
    );
  });

  it('detects a managed ANTHROPIC_BASE_URL at a non-macOS path (was a silent leak)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'managed-'));
    const managed = join(dir, 'managed-settings.json');
    writeFileSync(
      managed,
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://api.code-relay.com' } }),
    );
    try {
      // BEFORE: checking only the macOS path misses the file → no conflict →
      // the wizard would proceed and the agent would use code-relay.
      const before = checkAllSettingsConflicts(dir, '/no/home', MACOS_ONLY);
      expect(before.find((c) => c.source === 'managed')).toBeUndefined();

      // AFTER: the platform's managed path is checked → detected, non-writable
      // → the wizard refuses (ManagedSettingsScreen / CI abort).
      const after = checkAllSettingsConflicts(dir, '/no/home', [managed]);
      const conflict = after.find((c) => c.source === 'managed');
      expect(conflict).toBeDefined();
      expect(conflict?.keys).toContain('ANTHROPIC_BASE_URL');
      expect(conflict?.writable).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
