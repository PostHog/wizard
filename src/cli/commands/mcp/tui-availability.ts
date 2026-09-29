/**
 * Ink throws "Raw mode is not supported" when stdin has no TTY (piped input,
 * CI, some IDE terminals). That is the only TUI failure the mcp commands
 * degrade to LoggingUI for — any other error from the TUI path is a real bug
 * and must surface rather than be silently swallowed.
 */
export function isTUIUnavailable(error: unknown): boolean {
  return (
    error instanceof Error && /raw mode is not supported/i.test(error.message)
  );
}
