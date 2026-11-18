import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { emailSetupCommand } from '@tui/programs/posthog-integration/email-setup-command';

const CWD = path.resolve('/home/dev/monorepo');
const OUTSIDE = path.resolve('/srv/app');

describe('emailSetupCommand', () => {
  it('sets up email in the installed project', () => {
    expect(
      emailSetupCommand({ projectId: 42, installDir: CWD }, CWD).command,
    ).toBe('npx @posthog/wizard@latest email --project-id 42 --install-dir=.');
  });

  it.each([
    ['http://localhost:8010', ' --base-url http://localhost:8010'],
    ['https://posthog.example.com/', ' --base-url https://posthog.example.com'],
    [undefined, ''],
  ])('keeps the instance a run pinned to %s', (baseUrl, flag) => {
    expect(
      emailSetupCommand({ projectId: 42, installDir: CWD, baseUrl }, CWD)
        .command,
    ).toBe(
      `npx @posthog/wizard@latest email --project-id 42 --install-dir=.${flag}`,
    );
  });

  it.each([
    ['the install ran here', CWD, undefined],
    [
      'the install ran in a subdirectory',
      path.join(CWD, 'apps', "it's web"),
      path.join('apps', "it's web"),
    ],
    [
      'the install ran in a subdirectory named like a parent',
      path.join(CWD, '..web'),
      '..web',
    ],
    ['the install ran outside this directory', OUTSIDE, OUTSIDE],
  ])('names where to run it when %s', (_, installDir, runIn) => {
    expect(emailSetupCommand({ projectId: 42, installDir }, CWD).runIn).toBe(
      runIn,
    );
  });
});
