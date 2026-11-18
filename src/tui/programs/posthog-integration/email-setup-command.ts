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

/**
 * Letters, their accents and digits in any script, a plain space, and the punctuation paths use. Anything else,
 * such as a control or bidi character, could move the cursor, reorder the line, or fake one.
 */
const PLAIN = /^[\p{L}\p{M}\p{N} ._\-/\\:@+,~'()]+$/u;

/**
 * How to set up email for the app and project this run installed into, seen from `cwd`.
 * A run pinned with `--base-url`, or a directory whose name isn't plain text, gets the
 * bare command instead: no form of those values is safe to print for every shell and terminal.
 */
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
  const bare = `npx @posthog/wizard@latest ${getCommandPath(program)}`;

  if (baseUrl) {
    return {
      lead: `${LEAD} Run this in your app, adding the --base-url this run used:`,
      command: bare,
    };
  }
  const fromCwd = relative(cwd, installDir);
  const runIn = !fromCwd ? undefined : outside(fromCwd) ? installDir : fromCwd;
  if (runIn !== undefined && !PLAIN.test(runIn)) {
    return { lead: `${LEAD} Run this in your app:`, command: bare };
  }
  return {
    lead: `${LEAD} ${runIn ? `Run this in ${runIn}:` : 'Run this:'}`,
    // `--install-dir=.` outranks an exported POSTHOG_WIZARD_INSTALL_DIR, so the command runs where it is pasted.
    command: `${bare} --project-id ${projectId} --install-dir=.`,
  };
}
