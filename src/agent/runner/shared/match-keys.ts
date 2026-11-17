/** The match keys one run picks skills with. */
import { FRAMEWORK_KEY, type MatchKeys } from '@shared/skill-resolution';
import type { ResolvedRunConfig, RunInput } from './types';

/** The framework a run resolves skills for: the detected one, else the run's skill id, which a caller may set to the framework label. */
export function runFramework(
  input: Pick<RunInput, 'integration' | 'skillId'>,
): string | undefined {
  return input.integration ?? input.skillId ?? undefined;
}

/** The project's traits as match keys, with the run's framework as the `framework` key. */
export function runMatchKeys(
  config: Pick<ResolvedRunConfig, 'matchKeys'>,
  input: Pick<RunInput, 'integration' | 'skillId'>,
): MatchKeys {
  const framework = runFramework(input);
  return {
    ...config.matchKeys?.(),
    [FRAMEWORK_KEY]: framework ? [framework] : undefined,
  };
}
