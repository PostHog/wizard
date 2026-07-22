import { existsSync, readdirSync, rmSync, unlinkSync } from 'fs';
import * as path from 'path';

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

/** A framework docs page (`django.md`) — not a numbered workflow step (`1-begin.md`) and not an agent artifact (`EXAMPLE.md`, `COMMANDMENTS.md`). */
export function isSkillDocFile(name: string): boolean {
  return (
    name === name.toLowerCase() && !/(^|-)\d+(\.\d+)*-[\w-]+\.md$/.test(name)
  );
}

/** Strip a kept workflow skill down to its framework docs pages; a skill with no step files stays whole. */
export function pruneSkillToDocs(skillDir: string): void {
  const refs = path.join(skillDir, 'references');
  if (!existsSync(refs)) return;
  const files = readdirSync(refs);
  if (files.every(isSkillDocFile)) return;
  for (const f of files.filter((f) => !isSkillDocFile(f))) {
    unlinkSync(path.join(refs, f));
  }
  rmSync(path.join(skillDir, 'SKILL.md'), { force: true });
}
