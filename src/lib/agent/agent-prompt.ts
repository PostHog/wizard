/**
 * Agent prompt assembly.
 *
 * Three sections, always in this order:
 *   1. Default project prompt — credentials and base context (always included)
 *   2. Custom prompt — additional workflow-specific instructions (if set)
 *   3. Skill prompt — "follow SKILL.md" instructions (if a skill was installed)
 */

import type { WorkflowRun } from './agent-runner.js';

/**
 * Values available to prompt builders after OAuth completes.
 */
export interface PromptContext {
  projectId: number;
  projectApiKey: string;
  host: string;
  /** Set when skillId was provided and the skill was installed successfully. */
  skillPath?: string;
}

function defaultProjectPrompt(ctx: PromptContext): string {
  return `You have access to the PostHog MCP server.

Project context:
- PostHog Project ID: ${ctx.projectId}
- PostHog public token: ${ctx.projectApiKey}
- PostHog Host: ${ctx.host}`;
}

function skillPrompt(skillPath: string, reportFile: string): string {
  return `A PostHog skill has been installed at ${skillPath}/. Read ${skillPath}/SKILL.md and follow its instructions completely.

After completing the skill workflow, write a brief markdown report to ./${reportFile} summarizing:
- What changes were made to the project
- Which files were modified or created
- Any manual steps the user should take next

Important: You must read a file immediately before attempting to write it, even if you have previously read it; failure to do so will cause a tool failure.`;
}

/**
 * Assemble the final agent prompt from the workflow's run config.
 */
export function assemblePrompt(
  runDef: WorkflowRun,
  ctx: PromptContext,
): string {
  const parts: string[] = [];

  // Always include the default project prompt
  parts.push(defaultProjectPrompt(ctx));

  // Additional workflow-specific instructions
  if (runDef.customPrompt) {
    parts.push(runDef.customPrompt(ctx));
  }

  // Skill prompt (appended when a skill was pre-installed)
  if (ctx.skillPath) {
    parts.push(skillPrompt(ctx.skillPath, runDef.reportFile));
  }

  return parts.join('\n\n');
}
