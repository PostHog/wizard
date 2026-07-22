/**
 * Check if command is a PostHog skill installation from MCP.
 * We control the MCP server, so we only need to verify:
 * 1. It installs to .claude/skills/
 * 2. It downloads from our GitHub releases or localhost (dev)
 *
 * Extracted to its own module to avoid a circular dependency
 * between agent-interface.ts and yara-hooks.ts.
 */
export function isSkillInstallCommand(command: string): boolean {
  if (!command.startsWith('mkdir -p .claude/skills/')) return false;

  const urlMatch = command.match(/curl -sL ['"]([^'"]+)['"]/);
  if (!urlMatch) return false;

  const url = urlMatch[1];
  return (
    url.startsWith('https://github.com/PostHog/context-mill/releases/') ||
    /^http:\/\/localhost:\d+\//.test(url)
  );
}
