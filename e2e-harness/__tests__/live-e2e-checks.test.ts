import { describe, expect, it } from 'vitest';
import {
  credentialFailures,
  integrationFailures,
  readPersonalApiKey,
  type CapturedFrame,
  type LiveE2eResult,
} from '../live-e2e-checks';
import { RunPhase } from '@shared/run-state';

const completed: LiveE2eResult = {
  runPhase: RunPhase.Completed,
  abort: null,
  screenPath: ['intro', 'auth', 'run', 'outro', 'mcp', 'keep-skills'],
  skillsComplete: true,
  hasPosthogDep: true,
  envFile: null,
  tasks: [{ label: 'Install PostHog', status: 'completed' }],
};

const frames: CapturedFrame[] = [
  { name: '01-intro.ans', text: 'PostHog Wizard' },
  { name: '02-run.ans', text: 'Installing PostHog' },
  { name: '03-run.ans', text: 'PostHog configured' },
  { name: '04-keep-skills.ans', text: 'Keep skills?' },
];

describe('live e2e preflight', () => {
  it('reports every missing credential before running or copying a fixture', () => {
    expect(
      credentialFailures({}, () => {
        throw new Error('missing');
      }),
    ).toEqual([
      'Set POSTHOG_PERSONAL_API_KEY or POSTHOG_KEY_FILE to a readable PostHog personal key.',
      'Set WIZARD_CI_GATEWAY_TOKEN_FILE to a readable, already-issued gateway token file.',
      'Set PROJECT_ID or POSTHOG_WIZARD_PROJECT_ID to a positive project ID.',
    ]);
  });

  it('accepts existing secret files and a positive project ID', () => {
    expect(
      credentialFailures(
        {
          POSTHOG_KEY_FILE: '/secrets/posthog',
          WIZARD_CI_GATEWAY_TOKEN_FILE: '/secrets/gateway',
          PROJECT_ID: '228144',
        },
        () => 'nonempty-secret',
      ),
    ).toEqual([]);
  });

  it('resolves a blank inline key from the same file used by the host', () => {
    const env = {
      POSTHOG_PERSONAL_API_KEY: '  ',
      POSTHOG_KEY_FILE: '/secrets/posthog',
      WIZARD_CI_GATEWAY_TOKEN_FILE: '/secrets/gateway',
      PROJECT_ID: '42',
    };
    const readFile = (file: string) =>
      file === '/secrets/posthog' ? ' phx_file \n' : 'gateway-token';

    expect(readPersonalApiKey(env, readFile)).toBe('phx_file');
    expect(credentialFailures(env, readFile)).toEqual([]);
    expect(
      readPersonalApiKey(
        { ...env, POSTHOG_PERSONAL_API_KEY: ' phx_inline ' },
        readFile,
      ),
    ).toBe('phx_inline');
  });

  it('rejects a blank or unreadable key file before the build', () => {
    const env = {
      POSTHOG_PERSONAL_API_KEY: ' ',
      POSTHOG_KEY_FILE: '/secrets/missing',
      WIZARD_CI_GATEWAY_TOKEN_FILE: '/secrets/gateway',
      PROJECT_ID: '42',
    };
    const readFile = (file: string) => {
      if (file === '/secrets/missing') throw new Error('unreadable');
      return 'gateway-token';
    };
    expect(readPersonalApiKey(env, readFile)).toBe('');
    expect(credentialFailures(env, readFile)).toEqual([
      'Set POSTHOG_PERSONAL_API_KEY or POSTHOG_KEY_FILE to a readable PostHog personal key.',
    ]);
  });
});

describe('live TUI integration result', () => {
  it('accepts a completed flow with captured changing run frames', () => {
    expect(integrationFailures(completed, frames)).toEqual([]);
  });

  const failureCases: Array<{
    change: LiveE2eResult;
    captured: CapturedFrame[];
    failure: string;
  }> = [
    {
      change: { runPhase: RunPhase.Error },
      captured: frames,
      failure: 'Agent run did not complete (phase: error).',
    },
    {
      change: { abort: 'gateway rejected token' },
      captured: frames,
      failure: 'Wizard aborted: gateway rejected token',
    },
    {
      change: { screenPath: ['intro', 'run', 'outro'] },
      captured: frames,
      failure: 'Full TUI flow did not reach keep-skills.',
    },
    {
      change: { skillsComplete: false },
      captured: frames,
      failure: 'Full TUI flow did not complete the skills decision.',
    },
    {
      change: { hasPosthogDep: false, envFile: null },
      captured: frames,
      failure:
        'Integration added neither a PostHog dependency nor an env file.',
    },
    {
      change: { tasks: [] },
      captured: frames,
      failure: 'No completed task appeared in the run ledger.',
    },
    {
      change: {},
      captured: frames.slice(0, 1),
      failure: 'No changing run frames were captured.',
    },
  ];
  it.each(failureCases)(
    'reports only $failure',
    ({ change, captured, failure }) => {
      expect(
        integrationFailures({ ...completed, ...change }, captured),
      ).toEqual([failure]);
    },
  );

  it('requires a structured result and accepts an env file as artifact evidence', () => {
    expect(integrationFailures(null, frames)).toEqual([
      'The TUI host did not write a structured result.',
    ]);
    expect(
      integrationFailures(
        { ...completed, hasPosthogDep: false, envFile: '/app/.env' },
        frames,
      ),
    ).toEqual([]);
  });
});
