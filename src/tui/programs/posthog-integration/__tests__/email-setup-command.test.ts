import { describe, expect, it } from 'vitest';
import { emailSetupCommand } from '@tui/programs/posthog-integration/email-setup-command';

const CWD = '/home/dev/monorepo';

describe('emailSetupCommand', () => {
  it.each([
    [
      'the install ran here',
      CWD,
      'npx @posthog/wizard@latest email --project-id 42',
    ],
    [
      'the install ran in a subdirectory',
      `${CWD}/apps/web`,
      'npx @posthog/wizard@latest email --project-id 42 --install-dir apps/web',
    ],
    [
      'the directory needs quoting',
      `${CWD}/apps/it's web`,
      "npx @posthog/wizard@latest email --project-id 42 --install-dir 'apps/it'\\''s web'",
    ],
    [
      'the install ran outside this directory',
      '/srv/app',
      'npx @posthog/wizard@latest email --project-id 42 --install-dir /srv/app',
    ],
  ])(
    'targets the installed app and project when %s',
    (_, installDir, command) => {
      expect(emailSetupCommand({ projectId: 42, installDir }, CWD)).toBe(
        command,
      );
    },
  );
});
