import { IS_PRODUCTION_BUILD } from '@env';

/**
 * `--no-telemetry` flips `telemetry: false` via yargs negation; the
 * `WIZARD_NO_TELEMETRY` env var is honoured separately as a dev/CI-only form.
 * The env var is ignored in published builds (`IS_PRODUCTION_BUILD`) — in the
 * shipped CLI, `--no-telemetry` is the way to opt out.
 */
export function resolveNoTelemetry(options: Record<string, unknown>): boolean {
  if (options.telemetry === false) return true;
  if (IS_PRODUCTION_BUILD) return false;
  const env = process.env.WIZARD_NO_TELEMETRY;
  if (env == null || env === '') return false;
  const norm = env.toLowerCase();
  return norm !== '0' && norm !== 'false';
}
