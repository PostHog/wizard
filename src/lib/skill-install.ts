/**
 * Check if command is a PostHog skill installation from MCP.
 * We control the MCP server, so we only need to verify:
 * 1. It installs to .claude/skills/
 * 2. It downloads from a context-mill release origin (GitHub Releases or the
 *    AWS mirror) or localhost (dev)
 *
 * Extracted to its own module to avoid a circular dependency
 * between agent-interface.ts and yara-hooks.ts.
 */
export function isSkillInstallCommand(command: string): boolean {
  if (!command.startsWith('mkdir -p .claude/skills/')) return false;

  const urlMatch = command.match(/curl -sL ['"]([^'"]+)['"]/);
  if (!urlMatch) return false;

  // Literal prefixes rather than the constants in `@lib/constants`: an
  // allow-list is easier to audit when it reads as the URLs themselves.
  const url = urlMatch[1];
  return (
    url.startsWith('https://github.com/PostHog/context-mill/releases/') ||
    url.startsWith('https://context-mill.posthog.com/') ||
    /^http:\/\/localhost:\d+\//.test(url)
  );
}
