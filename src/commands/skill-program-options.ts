/**
 * Per-command options shared by every skill-based program command
 * (`audit events`, `migrate statsig`, `revenue`, `source-maps`, …).
 *
 * Only flags unique to skill commands live here. Global flags are declared
 * once in `wizard.ts` — both in `GLOBAL_OPTIONS` and, for the dev-only ones,
 * the `Wizard` constructor — and apply to every command automatically.
 */
export const skillProgramOptions = {
  'install-dir': {
    describe: 'Directory to install in',
    type: 'string' as const,
  },
};
