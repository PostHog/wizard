/**
 * Generic agent skill workflow factory.
 *
 * Creates a WorkflowConfig for any context-mill skill. Provide a
 * skill ID and basic UI config — the factory handles the rest.
 *
 * Usage:
 *   createSkillWorkflow({
 *     skillId: 'error-tracking-setup',
 *     command: 'errors',
 *     flowKey: 'error-tracking',
 *     description: 'Set up PostHog error tracking',
 *     integrationLabel: 'error-tracking',
 *     successMessage: 'Error tracking configured!',
 *     reportFile: 'posthog-error-tracking-report.md',
 *     docsUrl: 'https://posthog.com/docs/error-tracking',
 *     spinnerMessage: 'Setting up error tracking...',
 *     estimatedDurationMinutes: 5,
 *   })
 */

import type { WorkflowConfig } from '../workflow-step.js';
import type { WorkflowRun, AbortCase } from '../../agent/agent-runner.js';
import { AGENT_SKILL_STEPS } from './steps.js';

export interface SkillWorkflowOptions {
  /** Context-mill skill ID to install */
  skillId: string;
  /** CLI subcommand name */
  command: string;
  /** Unique flow key — must match a Flow enum entry */
  flowKey: string;
  /** CLI description shown in --help */
  description: string;
  /** Analytics integration label */
  integrationLabel: string;
  /** Custom prompt instruction. Appended after default project prompt. */
  customPrompt?: string;
  successMessage: string;
  reportFile: string;
  docsUrl: string;
  spinnerMessage: string;
  estimatedDurationMinutes: number;
  /** Other workflow flowKeys that must be satisfied first */
  requires?: string[];
  /** Override the default outro. Receives the same args as WorkflowRun.buildOutroData. */
  buildOutroData?: WorkflowRun['buildOutroData'];
  /** Known `[ABORT] <reason>` cases the skill can emit. */
  abortCases?: AbortCase[];
}

export function createSkillWorkflow(
  opts: SkillWorkflowOptions,
): WorkflowConfig {
  return {
    command: opts.command,
    description: opts.description,
    flowKey: opts.flowKey,
    steps: AGENT_SKILL_STEPS,
    run: {
      skillId: opts.skillId,
      integrationLabel: opts.integrationLabel,
      customPrompt: opts.customPrompt ? () => opts.customPrompt! : undefined,
      successMessage: opts.successMessage,
      reportFile: opts.reportFile,
      docsUrl: opts.docsUrl,
      spinnerMessage: opts.spinnerMessage,
      estimatedDurationMinutes: opts.estimatedDurationMinutes,
      buildOutroData: opts.buildOutroData,
      abortCases: opts.abortCases,
    },
    requires: opts.requires,
  };
}

export { AGENT_SKILL_STEPS } from './steps.js';
