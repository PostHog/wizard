import type { AbortCase } from '@agent/types';
import type { ProgramRun } from '../run/program-run';

export interface SkillProgramOptions {
  skillId: string;
  command: string;
  id: string;
  description: string;
  integrationLabel: string;
  customPrompt?: string;
  successMessage: string;
  reportFile: string;
  docsUrl: string;
  spinnerMessage: string;
  estimatedDurationMinutes: number;
  requires?: string[];
  buildOutroData?: ProgramRun['buildOutroData'];
  abortCases?: AbortCase[];
}

export function skillRunDefinition(opts: SkillProgramOptions): ProgramRun {
  const customPrompt = opts.customPrompt;
  return {
    skillId: opts.skillId,
    integrationLabel: opts.integrationLabel,
    customPrompt: customPrompt ? () => customPrompt : undefined,
    successMessage: opts.successMessage,
    reportFile: opts.reportFile,
    docsUrl: opts.docsUrl,
    spinnerMessage: opts.spinnerMessage,
    estimatedDurationMinutes: opts.estimatedDurationMinutes,
    buildOutroData: opts.buildOutroData,
    abortCases: opts.abortCases,
  };
}
