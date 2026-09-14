import { ErrorCodes, type ErrorCode } from './codes';
import type { InstallSkillResult } from '@lib/wizard-tools';

const SKILL_CODES: Record<
  Exclude<InstallSkillResult['kind'], 'ok'>,
  ErrorCode
> = {
  'menu-fetch-failed': ErrorCodes.SkillMenuFetchFailed,
  'skill-not-found': ErrorCodes.SkillNotFound,
  'download-failed': ErrorCodes.SkillDownloadFailed,
};

export function skillErrorCode(result: InstallSkillResult): ErrorCode | null {
  if (result.kind === 'ok') return null;
  return SKILL_CODES[result.kind];
}
