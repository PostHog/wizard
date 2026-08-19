/**
 * Generic agent skill program factory.
 *
 * Creates a ProgramConfig for any context-mill skill. Provide a
 * skill ID and basic UI config — the factory handles the rest.
 *
 * Usage:
 *   createSkillProgram({
 *     skillId: 'error-tracking-setup',
 *     command: 'errors',
 *     id: 'error-tracking',
 *     description: 'Set up PostHog error tracking',
 *     integrationLabel: 'error-tracking',
 *     successMessage: 'Error tracking configured!',
 *     reportFile: 'posthog-error-tracking-report.md',
 *     docsUrl: 'https://posthog.com/docs/error-tracking',
 *     spinnerMessage: 'Setting up error tracking...',
 *     estimatedDurationMinutes: 5,
 *   })
 */

import type { ProgramConfig, ProgramStep } from '@lib/programs/program-step';
import type { ProgramRun, AbortCase } from '@lib/agent/agent-runner';
import { AGENT_SKILL_STEPS } from './steps.js';
import { getContentBlocks } from './content/index.js';

export interface SkillProgramOptions {
  /** Context-mill skill ID to install */
  skillId: string;
  /** CLI subcommand name */
  command: string;
  /** Unique flow key — must match a Program enum entry */
  id: string;
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
  /** Other program ids that must be satisfied first */
  requires?: string[];
  /** Override the default outro. Receives the same args as ProgramRun.buildOutroData. */
  buildOutroData?: ProgramRun['buildOutroData'];
  /** Known `[ABORT] <reason>` cases the skill can emit. */
  abortCases?: AbortCase[];
  /**
   * Session-dependent pre-program work, run once before any gate is awaited —
   * e.g. probing the install dir so later events carry what was found. Attached
   * to the first step; omit it and the shared step list is used as-is.
   */
  onReady?: ProgramStep['onReady'];
}

export function createSkillProgram(opts: SkillProgramOptions): ProgramConfig {
  // Copy rather than mutate: AGENT_SKILL_STEPS is shared by every skill
  // program, so an in-place `onReady` would fire for all of them.
  const steps = opts.onReady
    ? [
        { ...AGENT_SKILL_STEPS[0], onReady: opts.onReady },
        ...AGENT_SKILL_STEPS.slice(1),
      ]
    : AGENT_SKILL_STEPS;

  return {
    command: opts.command,
    description: opts.description,
    id: opts.id,
    skillId: opts.skillId,
    steps,
    reportFile: opts.reportFile,
    getContentBlocks,
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
