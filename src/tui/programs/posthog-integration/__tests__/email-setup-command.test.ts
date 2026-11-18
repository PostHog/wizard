import { describe, expect, it } from 'vitest';
import { emailSetupCommand } from '@tui/programs/posthog-integration/email-setup-command';

const CWD = '/home/dev/monorepo';

describe('emailSetupCommand', () => {
  it('sets up email in the installed project', () => {
    expect(
      emailSetupCommand({ projectId: 42, installDir: CWD }, CWD).command,
    ).toBe('npx @posthog/wizard@latest email --project-id 42');
  });

  it.each([
    ['the install ran here', CWD, undefined],
    [
      'the install ran in a subdirectory',
      `${CWD}/apps/it's web`,
      "apps/it's web",
    ],
    ['the install ran outside this directory', '/srv/app', '/srv/app'],
  ])('names where to run it when %s', (_, installDir, runIn) => {
    expect(emailSetupCommand({ projectId: 42, installDir }, CWD).runIn).toBe(
      runIn,
    );
  });
});
