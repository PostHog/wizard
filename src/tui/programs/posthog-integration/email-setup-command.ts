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

// Plain URLs stay bare; anything a shell could expand, such as `&` or IPv6 brackets, goes in single quotes.
const SHELL_SAFE = /^[A-Za-z0-9_@+=:,./-]+$/;

function shellArg(value: string): string {
  return SHELL_SAFE.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The run resolves every host from the full `--base-url`, path included, so the command passes it unchanged. */
function baseUrlFlag(baseUrl: string | undefined): string {
  return baseUrl ? ` --base-url ${shellArg(baseUrl)}` : '';
}

/** A directory name can hold control characters that would move the cursor or fake a line in the terminal. */
function printable(dir: string): string {
  return Array.from(dir, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? '?' : char;
  }).join('');
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
  return { command, runIn: printable(outside(fromCwd) ? installDir : fromCwd) };
}
