/**
 * Renders the settings-conflict / auth-error screens with real Ink (via
 * ink-testing-library) and asserts each one names the offending file and key.
 *
 * Jest globally mocks `ink` to no-op stubs, so it can't verify what these
 * screens actually draw. This harness renders them for real and fails on a
 * regression. Run with `pnpm screens:check`.
 */

import React from 'react';
import { render } from 'ink-testing-library';
import { Box } from 'ink';
import { AuthErrorScreen } from '@ui/tui/screens/AuthErrorScreen';
import { ProgressList } from '@ui/tui/primitives/ProgressList';
import { ManagedSettingsScreen } from '@ui/tui/screens/ManagedSettingsScreen';
import { SettingsOverrideScreen } from '@ui/tui/screens/SettingsOverrideScreen';
import type { SettingsConflict } from '@lib/agent/agent-interface';

function fakeStore(session: Record<string, unknown>): any {
  return {
    session,
    subscribe: () => () => undefined,
    getSnapshot: () => session,
    backupAndFixSettingsOverride: () => true,
  };
}

const userConflict: SettingsConflict = {
  source: 'user',
  path: '/home/dev/.claude/settings.json',
  keys: ['apiKeyHelper'],
  writable: false,
};
const projectConflict: SettingsConflict = {
  source: 'project',
  path: '/home/dev/app/.claude/settings.json',
  keys: ['ANTHROPIC_BASE_URL'],
  writable: true,
};
const managedConflict: SettingsConflict = {
  source: 'managed',
  path: '/Library/Application Support/ClaudeCode/managed-settings.json',
  keys: ['ANTHROPIC_AUTH_TOKEN'],
  writable: false,
};

let failures = 0;

function check(
  label: string,
  el: React.ReactElement,
  expected: string[],
  forbidden: string[] = [],
): void {
  const { lastFrame } = render(el);
  const frame = lastFrame() ?? '';
  const missing = expected.filter((s) => !frame.includes(s));
  const present = forbidden.filter((s) => frame.includes(s));
  const ok = missing.length === 0 && present.length === 0;
  console.log(`\n===== ${label} ${ok ? 'OK' : 'FAILED'} =====`);
  console.log(frame);
  if (missing.length) console.log(`  MISSING: ${missing.join(' | ')}`);
  if (present.length)
    console.log(`  SHOULD NOT CONTAIN: ${present.join(' | ')}`);
  if (!ok) failures++;
}

check(
  'AuthErrorScreen — global conflict names file + key + fix',
  <AuthErrorScreen
    store={fakeStore({
      authErrorDetail: {
        hasSettingsConflict: true,
        conflicts: [userConflict],
        logFilePath: '/tmp/posthog-wizard.log',
      },
    })}
  />,
  ['/home/dev/.claude/settings.json', 'apiKeyHelper', 'claude auth logout'],
);

check(
  'AuthErrorScreen — managed login names conflicting credentials + places',
  <AuthErrorScreen
    store={fakeStore({
      authErrorDetail: {
        hasSettingsConflict: false,
        usingManagedLogin: true,
        credentialPlaces: [
          'A logged-in Claude session: /home/dev/.claude/.credentials.json',
          'A logged-in Claude session: macOS keychain item "Claude Code-credentials"',
        ],
        logFilePath: '/tmp/posthog-wizard.log',
      },
    })}
  />,
  [
    'Conflicting Anthropic credentials',
    '/home/dev/.claude/.credentials.json',
    'Claude Code-credentials',
    'claude auth logout',
  ],
  // Must not fall through to the generic key-guidance copy.
  ['Region mismatch'],
);

check(
  'AuthErrorScreen — no conflict falls back to key guidance',
  <AuthErrorScreen
    store={fakeStore({
      authErrorDetail: {
        hasSettingsConflict: false,
        conflicts: [],
        logFilePath: '/tmp/posthog-wizard.log',
      },
    })}
  />,
  ['llm_gateway:read', 'Region mismatch'],
);

check(
  'ManagedSettingsScreen — user/global gets self-fix copy, not IT',
  <ManagedSettingsScreen
    store={fakeStore({ settingsConflicts: [userConflict] })}
  />,
  ['Your global Claude Code settings', userConflict.path, 'Remove these keys'],
  ['IT administrator'],
);

check(
  'ManagedSettingsScreen — managed points at IT',
  <ManagedSettingsScreen
    store={fakeStore({ settingsConflicts: [managedConflict] })}
  />,
  ['Organization-managed settings', managedConflict.path, 'IT administrator'],
);

check(
  'SettingsOverrideScreen — writable project offers backup with full path',
  <SettingsOverrideScreen
    store={fakeStore({ settingsConflicts: [projectConflict] })}
  />,
  [projectConflict.path, 'ANTHROPIC_BASE_URL', 'Backup & continue'],
);

check(
  'ProgressList — not-needed tasks leave the list, long rows truncate',
  <Box width={34}>
    <ProgressList
      items={[
        {
          label: 'Install the PostHog SDK and configure the environment keys',
          status: 'completed',
        },
        { label: 'Add user identification', status: 'skipped' },
        { label: 'Write the setup report', status: 'pending' },
      ]}
    />
  </Box>,
  ['Install the PostHog SDK', '…', 'Progress: 1/2 completed'],
  // The not-needed task is gone and counts against nothing.
  ['Add user identification', 'not needed', '1/3'],
);

if (failures > 0) {
  console.error(`\n${failures} screen check(s) failed`);
  process.exit(1);
}
console.log('\nAll screen checks passed');
process.exit(0);
