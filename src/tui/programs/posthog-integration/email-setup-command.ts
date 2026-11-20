import { isAbsolute, relative, sep } from 'node:path';
import { getCommandPath, getSubcommandPrograms, Program } from '@programs';
import type { EmailProviderOffer } from '@programs/posthog-integration';

/** `lead` says where to run `command` in text, so no shell has to parse the directory. */
export type EmailSetupCommand = { lead: string; command: string };

export type EmailSetup = EmailSetupCommand & { workflowsUrl: string };

const LEAD =
  'Let the setup agent add your first email send to your server code.';

function outside(fromCwd: string): boolean {
  return (
    fromCwd === '..' || fromCwd.startsWith(`..${sep}`) || isAbsolute(fromCwd)
  );
}

/** Letters, accents and digits in any script, a plain space, and path punctuation; anything else could move the cursor or reorder the line. */
const PLAIN = /^[\p{L}\p{M}\p{N} ._\-/\\:@+,~'()]+$/u;

/** How to set up email for the app and project this run installed into, seen from `cwd`. */
export function emailSetupCommand(
  {
    projectId,
    installDir,
    baseUrl,
  }: Pick<EmailProviderOffer, 'projectId' | 'installDir' | 'baseUrl'>,
  cwd: string = process.cwd(),
): EmailSetupCommand {
  const program = getSubcommandPrograms().find(
    (config) => config.id === Program.TransactionalEmail,
  );
  if (!program) throw new Error('The email program has no command');
  // `--install-dir=.` outranks an exported POSTHOG_WIZARD_INSTALL_DIR, so the command runs where it is pasted.
  const command = `npx @posthog/wizard@latest ${getCommandPath(
    program,
  )} --project-id ${projectId} --install-dir=.`;

  if (baseUrl) {
    return {
      lead: `${LEAD} Change into your app's directory, then run this, adding the --base-url this run used:`,
      command,
    };
  }
  const fromCwd = relative(cwd, installDir);
  const runIn = !fromCwd ? undefined : outside(fromCwd) ? installDir : fromCwd;
  if (runIn !== undefined && !PLAIN.test(runIn)) {
    return {
      lead: `${LEAD} Change into your app's directory, then run this:`,
      command,
    };
  }
  return {
    lead: `${LEAD} ${runIn ? `Run this in ${runIn}:` : 'Run this:'}`,
    command,
  };
}
