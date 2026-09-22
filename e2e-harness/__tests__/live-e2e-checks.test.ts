import { describe, expect, it } from 'vitest';
import {
  credentialFailures,
  integrationFailures,
  type CapturedFrame,
  type LiveE2eResult,
} from '../live-e2e-checks';

const completed: LiveE2eResult = {
  runPhase: 'completed',
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
    expect(credentialFailures({}, () => false)).toEqual([
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
        () => true,
      ),
    ).toEqual([]);
  });
});

describe('live TUI integration result', () => {
  it('accepts a completed flow with captured changing run frames', () => {
    expect(integrationFailures(completed, frames)).toEqual([]);
  });

  it('rejects an aborted flow and a static or absent run capture', () => {
    expect(
      integrationFailures(
        {
          ...completed,
          runPhase: 'failed',
          abort: 'gateway rejected token',
          screenPath: ['intro', 'run', 'outro'],
          skillsComplete: false,
          hasPosthogDep: false,
          tasks: [],
        },
        frames.slice(0, 1),
      ),
    ).toEqual(
      expect.arrayContaining([
        'Agent run did not complete (phase: failed).',
        'Wizard aborted: gateway rejected token',
        'Full TUI flow did not reach keep-skills.',
        'No changing run frames were captured.',
      ]),
    );
  });
});
