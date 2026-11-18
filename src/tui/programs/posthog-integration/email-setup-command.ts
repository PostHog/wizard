import { isAbsolute, relative, sep } from 'node:path';
import { getCommandPath, getSubcommandPrograms, Program } from '@programs';
import type { EmailProviderOffer } from '@programs/posthog-integration';

/** `runIn` names the directory in text, so no shell has to parse the path; unset when that is `cwd`. */
export type EmailSetupCommand = { command: string; runIn?: string };

export type EmailSetup = EmailSetupCommand & { workflowsUrl: string };

function outside(fromCwd: string): boolean {
  return (
    fromCwd === '..' || fromCwd.startsWith(`..${sep}`) || isAbsolute(fromCwd)
  );
}

/** An origin is only scheme, host and port, so it needs no quoting in any shell. */
function baseUrlFlag(baseUrl: string | undefined): string {
  if (!baseUrl) return '';
  try {
    return ` --base-url ${new URL(baseUrl).origin}`;
  } catch {
    return '';
  }
}

/** How to set up email for the app, project and instance this run installed into, seen from `cwd`. */
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
  )} --project-id ${projectId} --install-dir=.${baseUrlFlag(baseUrl)}`;
  const fromCwd = relative(cwd, installDir);
  if (!fromCwd) return { command };
  return { command, runIn: outside(fromCwd) ? installDir : fromCwd };
}
