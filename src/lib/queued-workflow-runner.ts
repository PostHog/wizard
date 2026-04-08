/**
 * NEW FLOW: Queued workflow runner.
 *
 * Used when the `wizard-queued-workflow` feature flag is ON.
 * Bootstrap → parse SKILL.md frontmatter → per-step continued queries.
 *
 * Delete the legacy/ folder once this is the only path.
 */

import fs from 'fs';
import path from 'path';
import {
  DEFAULT_PACKAGE_INSTALLATION,
  type FrameworkConfig,
} from './framework-config';
import type { WizardSession } from './wizard-session';
import type { WizardOptions } from '../utils/types';
import { getUI, type SpinnerHandle } from '../ui';
import { initializeAgent, runAgent, AgentSignals } from './agent-interface';
import { logToFile } from '../utils/debug';
import { wizardAbort, WizardError } from '../utils/wizard-abort';
import {
  createPostBootstrapQueue,
  parseWorkflowStepsFromSkillMd,
  type WizardWorkflowQueueItem,
} from './workflow-queue';

const WIZARD_SKILL_ID_SIGNAL = '[WIZARD-SKILL-ID]';

export type PromptContext = {
  frameworkVersion: string;
  typescript: boolean;
  projectApiKey: string;
  host: string;
  projectId: number;
};

export async function runQueuedWorkflow(
  agent: Awaited<ReturnType<typeof initializeAgent>>,
  config: FrameworkConfig,
  session: WizardSession,
  options: WizardOptions,
  promptContext: PromptContext,
  frameworkContext: Record<string, unknown>,
  spinner: SpinnerHandle,
  middleware?: Parameters<typeof runAgent>[5],
): Promise<Awaited<ReturnType<typeof runAgent>>> {
  // Step 1: Bootstrap — install the skill and get its ID
  let agentResult = await runAgent(
    agent,
    buildBootstrapPrompt(config, promptContext, frameworkContext),
    options,
    spinner,
    {
      estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
      spinnerMessage: 'Preparing integration...',
      successMessage: 'Integration prepared',
      errorMessage: 'Integration failed during bootstrap',
      additionalFeatureQueue: [],
      requestRemark: false,
      captureOutputText: true,
      captureSessionId: true,
      finalizeMiddleware: false,
    },
    middleware,
  );

  const queuedSessionId = agentResult.sessionId;
  const installedSkillId =
    extractInstalledSkillId(agentResult.outputText ?? '') ?? undefined;

  if (!installedSkillId) {
    await wizardAbort({
      message:
        'The wizard could not determine which integration skill was installed during bootstrap.',
      error: new WizardError('Bootstrap step did not emit installed skill id'),
    });
  }

  // Step 2: Read SKILL.md and seed the queue from its frontmatter
  if (!agentResult.error && installedSkillId) {
    const skillMdPath = path.join(
      session.installDir,
      '.claude',
      'skills',
      installedSkillId,
      'SKILL.md',
    );
    const skillMdContent = fs.readFileSync(skillMdPath, 'utf-8');
    const workflowSteps = parseWorkflowStepsFromSkillMd(skillMdContent);

    if (workflowSteps.length === 0) {
      logToFile(
        '[agent-runner] No workflow steps found in SKILL.md frontmatter, aborting',
      );
      await wizardAbort({
        message:
          'The installed skill does not contain workflow steps in its metadata.',
        error: new WizardError('No workflow steps in SKILL.md frontmatter'),
      });
    }

    logToFile(
      `[agent-runner] Seeded queue from SKILL.md: ${workflowSteps
        .map((s) => s.stepId)
        .join(', ')}`,
    );

    // Step 3: Execute workflow steps + env-vars from the queue
    const queue = createPostBootstrapQueue(workflowSteps);
    getUI().setWorkQueue(queue);

    while (queue.length > 0) {
      const queueItem = queue.dequeue()!;

      getUI().setCurrentQueueItem({ id: queueItem.id, label: queueItem.label });

      const prompt = buildQueuedPrompt(
        queueItem,
        config,
        promptContext,
        installedSkillId,
      );

      agentResult = await runAgent(
        agent,
        prompt,
        options,
        spinner,
        {
          estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
          spinnerMessage: getQueueSpinnerMessage(queueItem),
          successMessage: getQueueSuccessMessage(queueItem, config),
          errorMessage: `Integration failed during ${queueItem.id}`,
          additionalFeatureQueue:
            queueItem.id === 'env-vars' ? session.additionalFeatureQueue : [],
          resumeSessionId: queuedSessionId,
          requestRemark: queueItem.id === 'env-vars',
          captureOutputText: false,
          captureSessionId: false,
          finalizeMiddleware: queue.length === 0,
        },
        middleware,
      );

      getUI().completeQueueItem({ id: queueItem.id, label: queueItem.label });

      if (agentResult.error) {
        break;
      }
    }
    getUI().setCurrentQueueItem(null);
  }

  return agentResult;
}

export function extractInstalledSkillId(outputText: string): string | null {
  const match = outputText.match(
    new RegExp(
      `${WIZARD_SKILL_ID_SIGNAL.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
      )}\\s+([A-Za-z0-9._-]+)`,
    ),
  );
  return match?.[1] ?? null;
}

// ── Prompt builders ─────────────────────────────────────────────────

function buildQueuedPrompt(
  queueItem: WizardWorkflowQueueItem,
  config: FrameworkConfig,
  context: PromptContext,
  installedSkillId: string,
): string {
  if (queueItem.kind === 'workflow') {
    return buildWorkflowStepPrompt(
      queueItem.referenceFilename,
      installedSkillId,
    );
  }

  return buildEnvVarPrompt(config, context);
}

function buildProjectContextBlock(
  config: FrameworkConfig,
  context: PromptContext,
  frameworkContext: Record<string, unknown>,
): string {
  const additionalLines = config.prompts.getAdditionalContextLines
    ? config.prompts.getAdditionalContextLines(frameworkContext)
    : [];

  const additionalContext =
    additionalLines.length > 0
      ? '\n' + additionalLines.map((line) => `- ${line}`).join('\n')
      : '';

  return `Project context:
- PostHog Project ID: ${context.projectId}
- Framework: ${config.metadata.name} ${context.frameworkVersion}
- TypeScript: ${context.typescript ? 'Yes' : 'No'}
- PostHog public token: ${context.projectApiKey}
- PostHog Host: ${context.host}
- Project type: ${config.prompts.projectTypeDetection}
- Package installation: ${
    config.prompts.packageInstallation ?? DEFAULT_PACKAGE_INSTALLATION
  }${additionalContext}`;
}

function buildBootstrapPrompt(
  config: FrameworkConfig,
  context: PromptContext,
  frameworkContext: Record<string, unknown>,
): string {
  return `You have access to the PostHog MCP server which provides skills to integrate PostHog into this ${
    config.metadata.name
  } project.

${buildProjectContextBlock(config, context, frameworkContext)}

STEP 1: Call load_skill_menu (from the wizard-tools MCP server) to see available skills.
   If the tool fails, emit: ${
     AgentSignals.ERROR_MCP_MISSING
   } Could not load skill menu and halt.

   Choose a skill from the \`integration\` category that matches this project's framework. Do NOT pick skills from other categories (llm-analytics, error-tracking, feature-flags, omnibus, etc.) — those are handled separately.
   If no suitable integration skill is found, emit: ${
     AgentSignals.ERROR_RESOURCE_MISSING
   } Could not find a suitable skill for this project.

STEP 2: Call install_skill (from the wizard-tools MCP server) with the chosen skill ID (e.g., "integration-nextjs-app-router").
   Do NOT run any shell commands to install skills.

STEP 3: Load the installed skill's SKILL.md file to understand what references are available.

STEP 4: When preparation is complete, emit exactly one line in this format:
${WIZARD_SKILL_ID_SIGNAL} <installed-skill-id>

Important:
- Do NOT execute any of the workflow reference files yet.
- Do NOT set up environment variables yet.
- Stop after preparation is complete.
- Use the detect_package_manager tool (from the wizard-tools MCP server) to determine which package manager the project uses. Do not manually search for lockfiles or config files. Always install packages as a background task. Don't await completion; proceed with other work immediately after starting the installation. You must read a file immediately before attempting to write it, even if you have previously read it; failure to do so will cause a tool failure.

`;
}

function buildWorkflowStepPrompt(
  referenceFilename: string,
  installedSkillId: string,
): string {
  return `Continue the existing conversation.

Read and follow this workflow reference:
\`.claude/skills/${installedSkillId}/references/${referenceFilename}\`

Before starting work, use TodoWrite to create your task plan. Update it as you complete each task.

Important:
- Complete only this workflow step.
- Do NOT continue to any other workflow file.
- Do NOT set up environment variables yet.
- Stop when this step is complete.`;
}

function buildEnvVarPrompt(
  config: FrameworkConfig,
  context: PromptContext,
): string {
  return `Continue the existing conversation.

Execute the final queued environment-variable setup step for this ${
    config.metadata.name
  } project.

${buildProjectContextBlock(config, context, {})}

Set up environment variables for PostHog using the wizard-tools MCP server (this runs locally — secret values never leave the machine):
- Use check_env_keys to see which keys already exist in the project's .env file (e.g. .env.local or .env).
- Use set_env_values to create or update the PostHog public token and host, using the appropriate environment variable naming convention for ${
    config.metadata.name
  }, which you'll find in example code. The tool will also ensure .gitignore coverage. Don't assume the presence of keys means the value is up to date. Write the correct value each time.
- Reference these environment variables in the code files you create instead of hardcoding the public token and host.

Stop after the environment-variable setup step is complete.`;
}

function getQueueSpinnerMessage(queueItem: WizardWorkflowQueueItem): string {
  switch (queueItem.kind) {
    case 'bootstrap':
      return 'Preparing integration...';
    case 'workflow':
      return `Running step ${queueItem.id.replace('workflow:', '')}...`;
    case 'env-vars':
      return 'Finalizing environment variables...';
  }
}

function getQueueSuccessMessage(
  queueItem: WizardWorkflowQueueItem,
  config: FrameworkConfig,
): string {
  switch (queueItem.kind) {
    case 'bootstrap':
      return 'Integration prepared';
    case 'workflow':
      return `Step ${queueItem.id.replace('workflow:', '')} complete`;
    case 'env-vars':
      return config.ui.successMessage;
  }
}
