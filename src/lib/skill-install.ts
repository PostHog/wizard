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

/** Numbered workflow-step file: `1-begin.md`, `basic-integration-1.0-edit.md`. */
const STEP_FILE = /(^|-)\d+(\.\d+)*-[\w-]+\.md$/;

/**
 * Strip a kept integration skill down to its docs: remove SKILL.md (the
 * agent workflow index) and the numbered step files, keep the reference docs
 * (EXAMPLE.md, COMMANDMENTS.md, framework pages). A dir with no step files is
 * not a workflow skill (e.g. one the user asked for by id) and stays whole.
 * Returns true when it pruned.
 */
export function pruneSkillToDocs(skillDir: string): boolean {
  const referencesDir = path.join(skillDir, 'references');
  if (!existsSync(referencesDir)) return false;
  const steps = readdirSync(referencesDir).filter((f) => STEP_FILE.test(f));
  if (steps.length === 0) return false;
  for (const f of steps) unlinkSync(path.join(referencesDir, f));
  rmSync(path.join(skillDir, 'SKILL.md'), { force: true });
  return true;
}
