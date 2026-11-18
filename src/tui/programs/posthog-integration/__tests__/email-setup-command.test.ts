import { describe, expect, it } from 'vitest';
import { emailSetupCommand } from '@tui/programs/posthog-integration/email-setup-command';

const CWD = '/home/dev/monorepo';
const EMAIL = 'npx @posthog/wizard@latest email --project-id 42';

describe('emailSetupCommand', () => {
  it.each<[string, string, NodeJS.Platform, string]>([
    ['the install ran here', CWD, 'linux', EMAIL],
    [
      'the install ran in a subdirectory',
      `${CWD}/apps/web`,
      'linux',
      `${EMAIL} --install-dir=apps/web`,
    ],
    [
      'the directory starts with a dash',
      `${CWD}/-web`,
      'linux',
      `${EMAIL} --install-dir=-web`,
    ],
    [
      'a POSIX shell needs quoting',
      `${CWD}/apps/it's web`,
      'darwin',
      `${EMAIL} --install-dir='apps/it'\\''s web'`,
    ],
    [
      'a Windows shell needs quoting',
      `${CWD}/apps/it's web`,
      'win32',
      `${EMAIL} --install-dir="apps/it's web"`,
    ],
    [
      'the install ran outside this directory',
      '/srv/app',
      'linux',
      `${EMAIL} --install-dir=/srv/app`,
    ],
  ])(
    'targets the installed app and project when %s',
    (_, installDir, platform, command) => {
      expect(
        emailSetupCommand({ projectId: 42, installDir }, CWD, platform),
      ).toBe(command);
    },
  );
});
