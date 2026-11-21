import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { emailSetupCommand } from '@tui/programs/posthog-integration/email-setup-command';

const CWD = path.resolve('/home/dev/monorepo');
const OUTSIDE = path.resolve('/srv/app');
const FULL = 'npx @posthog/wizard@latest email --project-id 42 --install-dir=.';

const ending = (lead: string, where: string) => lead.slice(-where.length);

describe('emailSetupCommand', () => {
  it.each([
    ['the install ran here', CWD, 'Run this:'],
    [
      'the install ran in a subdirectory',
      path.join(CWD, 'apps', "it's web"),
      `Run this in ${path.join('apps', "it's web")}:`,
    ],
    [
      'the subdirectory name has decomposed accents',
      path.join(CWD, 'cafe\u0301'),
      'Run this in cafe\u0301:',
    ],
    [
      'the install ran in a subdirectory named like a parent',
      path.join(CWD, '..web'),
      'Run this in ..web:',
    ],
    [
      'the install ran outside this directory',
      OUTSIDE,
      `Run this in ${OUTSIDE}:`,
    ],
  ])(
    'gives the full command and names where to run it when %s',
    (_, installDir, where) => {
      const setup = emailSetupCommand({ projectId: 42, installDir }, CWD);
      expect(setup.command).toBe(FULL);
      expect(ending(setup.lead, where)).toBe(where);
    },
  );

  it.each([
    'http://localhost:8010',
    'https://user:secret@example.com/posthog',
    'http://[::1]:8010',
    'https://example.com\n',
  ])(
    'names neither the instance nor the directory when the run was pinned to %j',
    (baseUrl) => {
      const setup = emailSetupCommand(
        { projectId: 42, installDir: path.join(CWD, 'apps', 'web'), baseUrl },
        CWD,
      );
      expect(setup.command).toBe(FULL);
      expect(setup.lead).toMatch(
        /Change into your app's directory, then run this, adding the --base-url this run used:$/,
      );
      expect(setup.lead).not.toContain(baseUrl.trim());
      expect(setup.lead).not.toContain('apps');
    },
  );

  it.each([
    ['an escape sequence', 'web\u001b[2J'],
    ['a newline', 'web\nfake'],
    ['a C1 control', 'web\u009b2J'],
    ['DEL', 'web\u007f'],
    ['a right-to-left override', 'web\u202ebew'],
    ['a line separator', 'web\u2028fake'],
    ['a command substitution', 'web$(touch x)'],
    ['a backtick', 'web`id`'],
    ['a no-break space', 'web\u00a0app'],
    ['an emoji', 'web\u{1F680}'],
  ])('names no directory when its name holds %s', (_, name) => {
    const setup = emailSetupCommand(
      { projectId: 42, installDir: path.join(CWD, name) },
      CWD,
    );
    expect(setup.command).toBe(FULL);
    expect(setup.lead).toMatch(
      /Change into your app's directory, then run this:$/,
    );
    expect(setup.lead).not.toContain(name);
  });
});
