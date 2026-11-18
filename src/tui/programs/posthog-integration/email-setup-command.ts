import { isAbsolute, relative, sep } from 'node:path';
import { getCommandPath, getSubcommandPrograms, Program } from '@programs';
import type { EmailProviderOffer } from '@programs/posthog-integration';

/** `lead` says where to run `command` in text, so no shell has to parse the directory. */
export type EmailSetupCommand = { lead: string; command: string };

export type EmailSetup = EmailSetupCommand & { workflowsUrl: string };

function outside(fromCwd: string): boolean {
  return (
    fromCwd === '..' || fromCwd.startsWith(`..${sep}`) || isAbsolute(fromCwd)
  );
}

// A value outside this set stays out of the command: no quoting works in every shell, cmd.exe included.
const SHELL_SAFE = /^[A-Za-z0-9_@+=:,./-]+$/;

/** Host resolution trims `--base-url`, so the command uses the same value. */
function pinnedBaseUrl(baseUrl: string | undefined): string | undefined {
  return baseUrl?.trim() || undefined;
}

function hasControlCharacters(text: string): boolean {
  return Array.from(text).some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
}

/** A directory name with control characters is shown escaped, so it can neither move the cursor nor read as another name. */
function displayed(dir: string): string {
  return hasControlCharacters(dir) ? JSON.stringify(dir) : dir;
}

function lead(runIn: string | undefined, baseUrlLeftOut: boolean): string {
  const where = runIn ? `Run this in ${displayed(runIn)}` : 'Run this';
  const addBaseUrl = baseUrlLeftOut
    ? ', adding the --base-url this run used'
    : '';
  return `Let the setup agent add your first email send to your server code. ${where}${addBaseUrl}:`;
}

/** How to set up email for the app, project and instance this run installed into, seen from `cwd`. */
export function emailSetupCommand(
  offer: Pick<EmailProviderOffer, 'projectId' | 'installDir' | 'baseUrl'>,
  cwd: string = process.cwd(),
): EmailSetupCommand {
  const program = getSubcommandPrograms().find(
    (config) => config.id === Program.TransactionalEmail,
  );
  if (!program) throw new Error('The email program has no command');
  const baseUrl = pinnedBaseUrl(offer.baseUrl);
  const inCommand = baseUrl !== undefined && SHELL_SAFE.test(baseUrl);
  // `--install-dir=.` outranks an exported POSTHOG_WIZARD_INSTALL_DIR, so the command runs where it is pasted.
  const command = `npx @posthog/wizard@latest ${getCommandPath(
    program,
  )} --project-id ${offer.projectId} --install-dir=.${
    inCommand ? ` --base-url ${baseUrl}` : ''
  }`;
  const fromCwd = relative(cwd, offer.installDir);
  const runIn = !fromCwd
    ? undefined
    : outside(fromCwd)
    ? offer.installDir
    : fromCwd;
  return { command, lead: lead(runIn, baseUrl !== undefined && !inCommand) };
}
