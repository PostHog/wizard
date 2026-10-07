/**
 * The auth-error and managed-settings branches the frame snapshots do not
 * render, and ProgressList's skipped rows, with real Ink.
 */
import type { ReactElement } from 'react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { Box } from 'ink';
import type { SettingsConflict } from '@shared/claude-settings';
import { AuthErrorScreen } from '../screens/AuthErrorScreen';
import { ManagedSettingsScreen } from '../screens/ManagedSettingsScreen';
import { ProgressList } from '../primitives/ProgressList';

vi.mock(import('ink'), () =>
  vi.importActual<typeof import('ink')>('ink-actual'),
);

/** A store whose session and TUI state are both `state`: each screen reads the half it owns. */
function fakeStore(state: Record<string, unknown>): never {
  return {
    ...state,
    session: state,
    subscribe: () => () => undefined,
    getSnapshot: () => state,
  } as never;
}

const userConflict: SettingsConflict = {
  source: 'user',
  path: '/home/dev/.claude/settings.json',
  keys: ['apiKeyHelper'],
  writable: false,
};

/** The frame `el` renders: every `expected` string in it, no `forbidden` one. */
function expectFrame(
  el: ReactElement,
  expected: string[],
  forbidden: string[] = [],
): void {
  const frame = render(el).lastFrame() ?? '';
  expect(expected.filter((s) => !frame.includes(s))).toEqual([]);
  expect(forbidden.filter((s) => frame.includes(s))).toEqual([]);
}

describe('conflict and auth screens name what to fix', () => {
  afterEach(() => cleanup());

  it('AuthErrorScreen: a managed login names the conflicting credentials and places', () => {
    expectFrame(
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
  });

  it('AuthErrorScreen: no conflict falls back to key guidance', () => {
    expectFrame(
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
  });

  it('ManagedSettingsScreen: user settings get self-fix copy, not IT', () => {
    expectFrame(
      <ManagedSettingsScreen
        store={fakeStore({ settingsConflicts: [userConflict] })}
      />,
      [
        'Your global Claude Code settings',
        userConflict.path,
        'Remove these keys',
      ],
      ['IT administrator'],
    );
  });

  it('ProgressList: not-needed tasks leave the list and long rows truncate', () => {
    expectFrame(
      <Box width={34}>
        <ProgressList
          items={[
            {
              label:
                'Install the PostHog SDK and configure the environment keys',
              status: 'completed',
            },
            { label: 'Add user identification', status: 'skipped' },
            { label: 'Write the setup report', status: 'pending' },
          ]}
        />
      </Box>,
      [
        'Install the PostHog SDK',
        '…',
        'Progress: 1/2 completed',
        '(1 skipped as not required)',
      ],
      // The not-needed task is gone and counts against nothing.
      ['Add user identification', 'not needed', '1/3'],
    );
  });
});
