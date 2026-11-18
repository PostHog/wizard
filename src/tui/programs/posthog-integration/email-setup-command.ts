import { relative } from 'node:path';
import { getCommandPath, getSubcommandPrograms, Program } from '@programs';
import type { EmailProviderOffer } from '@programs/posthog-integration';

const SHELL_SAFE = /^[\w./-]+$/;

/** cmd.exe and PowerShell both read a double-quoted path whole; POSIX shells need single quotes. */
function shellQuote(arg: string, platform: NodeJS.Platform): string {
  if (SHELL_SAFE.test(arg)) return arg;
  if (platform === 'win32') return `"${arg}"`;
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

/** The command that sets up email for the app and project this run installed into, run from `cwd`. */
export function emailSetupCommand(
  {
    projectId,
    installDir,
  }: Pick<EmailProviderOffer, 'projectId' | 'installDir'>,
  cwd: string = process.cwd(),
  platform: NodeJS.Platform = process.platform,
): string {
  const program = getSubcommandPrograms().find(
    (config) => config.id === Program.TransactionalEmail,
  );
  if (!program) throw new Error('The email program has no command');
  const words = [
    'npx @posthog/wizard@latest',
    getCommandPath(program),
    `--project-id ${projectId}`,
  ];
  const fromCwd = relative(cwd, installDir);
  if (fromCwd) {
    const target = fromCwd.startsWith('..') ? installDir : fromCwd;
    // The `=` form keeps a directory that starts with a dash from reading as a flag.
    words.push(`--install-dir=${shellQuote(target, platform)}`);
  }
  return words.join(' ');
}
