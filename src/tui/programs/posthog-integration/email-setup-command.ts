import { relative } from 'node:path';
import { getCommandPath, getSubcommandPrograms, Program } from '@programs';
import type { EmailProviderOffer } from '@programs/posthog-integration';

export type EmailSetupCommand = {
  command: string;
  /** Where to run it, as text rather than a flag, so no shell has to parse the path. Unset when that is `cwd`. */
  runIn?: string;
};

/** How to set up email for the app and project this run installed into, seen from `cwd`. */
export function emailSetupCommand(
  {
    projectId,
    installDir,
  }: Pick<EmailProviderOffer, 'projectId' | 'installDir'>,
  cwd: string = process.cwd(),
): EmailSetupCommand {
  const program = getSubcommandPrograms().find(
    (config) => config.id === Program.TransactionalEmail,
  );
  if (!program) throw new Error('The email program has no command');
  const command = `npx @posthog/wizard@latest ${getCommandPath(
    program,
  )} --project-id ${projectId}`;
  const fromCwd = relative(cwd, installDir);
  if (!fromCwd) return { command };
  return { command, runIn: fromCwd.startsWith('..') ? installDir : fromCwd };
}
