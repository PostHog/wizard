/**
 * Shared bash-command policy helpers — the parts of the fence that both
 * harnesses agree on, kept in a dependency-free leaf module so `wizardCanUseTool`
 * (the anthropic-side allowlist) and pi's security extension apply the SAME
 * rules without importing each other.
 *
 * Right now this is the scoped file-removal predicate. The anthropic arm runs
 * bash without an allowlist (the OS sandbox + shared YARA destructive-delete
 * rules contain it), so a plain `rm <file-inside-the-project>` is permitted
 * there. pi has no sandbox and gates bash through the allowlist, which would
 * otherwise reject `rm` outright — so it consults this predicate to permit the
 * exact same deletion shape, then still runs it through the shared YARA scan.
 */

import path from 'path';

// Shell metacharacters that chain, substitute, or redirect. A command carrying
// any of these is more than one action, so we never treat it as a plain `rm`.
const SHELL_OPERATORS = /[;&|`$(){}<>\n'"\\]/;

/** True when a target resolves to a file strictly inside the project root. */
function isDeletableProjectFile(
  target: string,
  root: string,
  p: typeof path,
): boolean {
  if (target.startsWith('-')) return false; // a flag, not a file
  if (/[*?[\]~]/.test(target)) return false; // glob / home expansion
  if (p.basename(target).startsWith('.env')) return false; // secrets

  const resolved = p.resolve(root, target);
  return resolved !== root && resolved.startsWith(root + p.sep);
}

/**
 * A plain `rm [-f] <file...>` whose every target is a file inside the project
 * root — the deletion shape the anthropic arm permits (there bash isn't
 * allowlisted; the shared YARA destructive-delete rules catch the dangerous
 * forms). It refuses any shell operator so a command can't smuggle a second
 * action. Path checks run through the host's `path` (win32 on Windows, posix
 * elsewhere); pi always executes commands via a POSIX bash, so targets use
 * forward slashes.
 */
export function isScopedFileRemoval(
  command: string,
  rawRoot: string | undefined,
  p: typeof path = path,
): boolean {
  if (!rawRoot) return false; // no root to contain against → never allow
  const root = p.resolve(rawRoot);
  const trimmed = command.trim();
  if (SHELL_OPERATORS.test(trimmed)) return false;

  const [executable, ...args] = trimmed.split(/\s+/);
  if (executable !== 'rm') return false;

  if (args[0] === '-f') args.shift();
  if (args.length === 0) return false;

  return args.every((arg) => isDeletableProjectFile(arg, root, p));
}
