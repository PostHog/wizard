import { tmpdir } from 'node:os';
import { join } from 'node:path';

// use tmpdir for windows compatibility!
const TMP = tmpdir();

export const WIZARD_LOG_FILE = join(TMP, 'posthog-wizard.log');
export const WIZARD_BENCHMARK_FILE = join(TMP, 'posthog-wizard-benchmark.json');
export const WIZARD_YARA_REPORT_FILE = join(
  TMP,
  'posthog-wizard-yara-report.json',
);
export const WIZARD_TASK_STREAM_LOG = join(TMP, 'posthog-task-stream.log');

/** Temp path for a skill download zip. */
export function skillTmpPath(skillId: string): string {
  return join(TMP, `posthog-skill-${skillId}.zip`);
}
