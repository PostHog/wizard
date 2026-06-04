/** Flags shared by every skill-based program command (integrate, audit, …). */
export const skillProgramOptions = {
  debug: {
    default: false,
    describe: 'Enable verbose logging',
    type: 'boolean' as const,
  },
  'install-dir': {
    describe: 'Directory to install in',
    type: 'string' as const,
  },
  'local-mcp': {
    default: false,
    describe: 'Use local MCP server',
    type: 'boolean' as const,
  },
  benchmark: {
    default: false,
    describe: 'Run in benchmark mode',
    type: 'boolean' as const,
  },
  'yara-report': {
    default: false,
    describe: 'Print YARA scanner summary',
    type: 'boolean' as const,
    hidden: true,
  },
};
