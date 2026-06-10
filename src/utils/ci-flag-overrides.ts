/**
 * CI-only feature-flag overrides.
 *
 * CI must route deterministically: a run that tests the orchestrator arm says
 * so explicitly instead of depending on a live feature flag someone can edit
 * mid-week. `WIZARD_CI_FLAG_OVERRIDES` is a JSON object of flag key →
 * value, merged over whatever PostHog returned.
 *
 * The override path exists only in CI builds (`pnpm build:ci`). Published
 * builds inline NODE_ENV as the literal "production", the guard below
 * collapses, and tsdown strips the rest from the bundle — and the smoke test
 * asserts the env var's name is physically absent from production output, so
 * this can never quietly become a production surface.
 */
import { runtimeEnv } from '@env';
import { logToFile } from './debug';

export function applyCiFlagOverrides(
  flags: Record<string, string>,
): Record<string, string> {
  // Compared inline (not via env.ts's IS_PRODUCTION_BUILD) so tsdown replaces
  // it with a literal right here and the bundler can prove the rest of this
  // function unreachable in production builds. The smoke test enforces that.
  if (process.env.NODE_ENV === 'production') return flags;

  const raw = runtimeEnv('WIZARD_CI_FLAG_OVERRIDES');
  if (!raw) return flags;

  let overrides: Record<string, unknown>;
  try {
    overrides = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // A malformed override is a CI misconfiguration. Fail the run loudly
    // rather than silently testing whatever the live flags happen to say.
    throw new Error(
      'WIZARD_CI_FLAG_OVERRIDES is not valid JSON (expected {"flag-key": value, ...}).',
    );
  }

  const merged = { ...flags };
  for (const [key, value] of Object.entries(overrides)) {
    merged[key] = String(value);
  }
  logToFile('[flags] CI overrides applied', overrides);
  return merged;
}
