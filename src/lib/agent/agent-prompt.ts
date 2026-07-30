/**
 * Agent prompt assembly.
 *
 * Three sections, always in this order:
 *   1. Default project prompt — credentials and base context (always included)
 *   2. Custom prompt — additional program-specific instructions (if set)
 *   3. Skill prompt — "follow SKILL.md" instructions (if a skill was installed)
 */

import type { ProgramRun } from './agent-runner.js';
import type { HostResolution } from '@lib/host-resolution';

/**
 * Values available to prompt builders after OAuth completes.
 */
export interface PromptContext {
  projectId: number;
  projectApiKey: string;
  host: HostResolution;
  /** Set when skillId was provided and the skill was installed successfully. */
  skillPath?: string;
  /**
   * Org-level AI consent (`is_ai_data_processing_approved`) read from the
   * `/api/users/@me/` payload at auth time. `null` = unknown (older orgs,
   * or the user fetch failed). Lets prompts pre-resolve consent state so
   * agents only ask the user when it is actually off or unknown.
   */
  orgAiDataProcessingApproved?: boolean | null;
  /**
   * Team product opt-ins from the `/api/projects/:id/` payload at auth
   * time. Project-level truth for "is this product enabled" — products
   * can be instrumented from other repos or the snippet, so repo-local
   * evidence must never rule them out. `null` field = unknown.
   */
  teamProductOptIns?: {
    sessionReplay?: boolean | null;
    exceptionAutocapture?: boolean | null;
    surveys?: boolean | null;
  } | null;
}

function defaultProjectPrompt(ctx: PromptContext): string {
  return `You have access to the PostHog MCP server.

Project context:
- PostHog Project ID: ${ctx.projectId}
- PostHog public token: ${ctx.projectApiKey}
- PostHog Host: ${ctx.host.apiHost}`;
}

function skillPrompt(
  skillPath: string,
  reportFile: string,
  uploadToPostHog: boolean,
): string {
  // Opted-in programs hand off through the publish_handoff tool; its
  // description carries the report contract, so the prompt only points at it
  // instead of duplicating the shape here.
  const reportInstruction = uploadToPostHog
    ? `After completing the skill workflow, publish your setup report with the \`publish_handoff\` tool — its description explains what to include. Do not write a report file.`
    : `After completing the skill workflow, write a brief markdown report to ./${reportFile} summarizing:
- What changes were made to the project
- Which files were modified or created
- Any manual steps the user should take next`;

  return `A PostHog skill has been installed at ${skillPath}/. Read ${skillPath}/SKILL.md and follow its instructions completely.

${reportInstruction}

Important: You must read a file immediately before attempting to write it, even if you have previously read it; failure to do so will cause a tool failure.`;
}

/**
 * Assemble the final agent prompt from the program's run config.
 */
export function assemblePrompt(runDef: ProgramRun, ctx: PromptContext): string {
  const parts: string[] = [];

  // Always include the default project prompt
  parts.push(defaultProjectPrompt(ctx));

  // Additional program-specific instructions
  if (runDef.customPrompt) {
    parts.push(runDef.customPrompt(ctx));
  }

  // Skill prompt (appended when a skill was pre-installed)
  if (ctx.skillPath) {
    parts.push(
      skillPrompt(
        ctx.skillPath,
        runDef.reportFile,
        runDef.uploadToPostHog ?? false,
      ),
    );
  }

  return parts.join('\n\n');
}
