import type { ApiPrompt } from '../../lib/api';

/**
 * Converts a PostHog prompt API response into SKILL.md file content
 * with YAML frontmatter and the prompt body.
 */
export function promptToSkillContent(
  prompt: ApiPrompt,
  teamId: number,
): string {
  const syncedAt = new Date().toISOString();
  const body = formatPromptBody(prompt.prompt);

  return `---
name: posthog-prompt/${prompt.name}
description: "PostHog prompt: ${prompt.name} (v${prompt.version})"
metadata:
  source: posthog-prompt-sync
  team_id: ${teamId}
  prompt_id: "${prompt.id}"
  version: ${prompt.version}
  synced_at: "${syncedAt}"
---

${body}
`;
}

/**
 * Converts a PostHog prompt API response into a Cursor .mdc rule file
 * with the frontmatter format Cursor expects.
 */
export function promptToCursorRule(prompt: ApiPrompt): string {
  const body = formatPromptBody(prompt.prompt);

  return `---
description: "PostHog prompt: ${prompt.name} (v${prompt.version})"
globs:
alwaysApply: true
---

${body}
`;
}

/**
 * Formats the prompt body for inclusion in skill/rule files.
 * Strings are used as-is; structured JSON is wrapped in a fenced code block.
 */
export function formatPromptBody(prompt: unknown): string {
  if (typeof prompt === 'string') {
    return prompt;
  }

  return '```json\n' + JSON.stringify(prompt, null, 2) + '\n```';
}
