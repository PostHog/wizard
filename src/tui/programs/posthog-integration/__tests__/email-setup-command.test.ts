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
    [
      'https://example.com/posthog/',
      ' --base-url https://example.com/posthog/',
    ],
    ['https://example.com\n', ' --base-url https://example.com'],
    [undefined, ''],
  ])('keeps the instance a run pinned to %j', (baseUrl, flag) => {
    const setup = emailSetupCommand(
      { projectId: 42, installDir: CWD, baseUrl },
      CWD,
    );
    expect(setup.command).toBe(
      `npx @posthog/wizard@latest email --project-id 42 --install-dir=.${flag}`,
    );
    expect(setup.lead).not.toContain('--base-url');
  });

  it.each([
    'http://[::1]:8010',
    'http://localhost:8010/a&b',
    "https://example.com/it's",
  ])('names the base URL in text when a shell could expand %s', (baseUrl) => {
    const setup = emailSetupCommand(
      { projectId: 42, installDir: CWD, baseUrl },
      CWD,
    );
    expect(setup.command).toBe(
      'npx @posthog/wizard@latest email --project-id 42 --install-dir=.',
    );
    expect(setup.lead).toMatch(
      /Run this, adding the --base-url this run used:$/,
    );
  });

  it.each([
    ['the install ran here', CWD, 'Run this:'],
    [
      'the install ran in a subdirectory',
      path.join(CWD, 'apps', "it's web"),
      `Run this in ${path.join('apps', "it's web")}:`,
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
    [
      'the directory name holds terminal control characters',
      path.join(CWD, 'web\t'),
      'Run this in "web\\t":',
    ],
  ])('names where to run it when %s', (_, installDir, where) => {
    const { lead } = emailSetupCommand({ projectId: 42, installDir }, CWD);
    expect(lead.slice(-where.length)).toBe(where);
  });
});
