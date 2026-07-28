/**
 * Per-command options shared by every skill-based program command
 * (`audit events`, `migrate statsig`, `revenue`, `source-maps`, …).
 *
 * Only flags that are unique to skill commands live here. Global flags
 * (`--debug`, `--local-mcp`, `--benchmark`, `--yara-report`, `--ci`) are
 * declared once in `wizard.ts::GLOBAL_OPTIONS` and apply automatically
 * across every command — no need to repeat them per subcommand.
 */
export const skillProgramOptions = {
  'install-dir': {
    describe: 'Directory to install in',
    type: 'string' as const,
  },
};
