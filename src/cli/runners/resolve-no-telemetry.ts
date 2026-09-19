/**
 * `--no-telemetry` flips `telemetry: false` via yargs negation;
 * `POSTHOG_WIZARD_NO_TELEMETRY` is honoured separately so the env-var
 * form documented in the README keeps working.
 */
export function resolveNoTelemetry(options: Record<string, unknown>): boolean {
  if (options.telemetry === false) return true;
  const env = process.env.POSTHOG_WIZARD_NO_TELEMETRY;
  if (env == null || env === '') return false;
  const norm = env.toLowerCase();
  return norm !== '0' && norm !== 'false';
}
