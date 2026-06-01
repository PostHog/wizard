import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

// /tmp is stable and discoverable on macOS/Linux; Windows needs os.tmpdir()
const TMP = process.platform === 'win32' ? tmpdir() : '/tmp';

export const WIZARD_LOG_FILE = join(TMP, 'posthog-wizard.log');
export const WIZARD_BENCHMARK_FILE = join(TMP, 'posthog-wizard-benchmark.json');
export const WIZARD_YARA_REPORT_FILE = join(
  TMP,
  'posthog-wizard-yara-report.json',
);
/** Temp path for a skill download zip. */
export function skillTmpPath(skillId: string): string {
  return join(TMP, `posthog-skill-${skillId}.zip`);
}

/**
 * Strip an absolute installDir prefix off a project file path so the UI
 * renders `index.js:12` instead of `/Users/.../index.js:12`. Defends
 * against false matches like `/Users/foo` ⊂ `/Users/foobar/x.js` by
 * normalizing to a trailing path separator before the prefix check.
 */
export function relativeToInstallDir(file: string, installDir: string): string {
  const prefix = installDir.endsWith(sep) ? installDir : installDir + sep;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}
