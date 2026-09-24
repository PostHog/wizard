import type { AbortCase } from '@agent/types';
import type { ProgramRun } from '@programs/program-run';

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
}

export function skillRunDefinition(opts: SkillProgramOptions): ProgramRun {
  return {
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
  };
}
