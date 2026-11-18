import { relative } from 'node:path';
import { getCommandPath, getSubcommandPrograms, Program } from '@programs';
import type { EmailProviderOffer } from '@programs/posthog-integration';

const SHELL_SAFE = /^[\w./-]+$/;

function shellQuote(arg: string): string {
  return SHELL_SAFE.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

/** The command that sets up email for the app and project this run installed into, run from `cwd`. */
export function emailSetupCommand(
  {
    projectId,
    installDir,
  }: Pick<EmailProviderOffer, 'projectId' | 'installDir'>,
  cwd: string = process.cwd(),
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
    words.push(`--install-dir ${shellQuote(target)}`);
  }
  return words.join(' ');
}
