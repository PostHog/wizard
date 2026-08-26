/**
 * Ring the terminal bell (BEL, U+0007).
 *
 * The orchestrator takes consent for the warehouse step at the top of the run
 * and asks for the credentials at the end of it, several autonomous minutes
 * later. The person who agreed is often looking at something else by then. A
 * bell is the one attention signal a terminal in a background tab can still
 * deliver, and it costs a user who is watching nothing.
 *
 * Written to stderr, not stdout: Ink owns stdout and repaints whole frames, so
 * a byte written there can land inside one. Silent when stderr is not a TTY —
 * a pipe or a CI log cannot ring, and the byte would only pollute the capture.
 */
export function ringTerminalBell(): void {
  if (!process.stderr.isTTY) return;
  try {
    process.stderr.write('\u0007');
  } catch {
    // A bell is a nicety. It must never be the thing that ends a run.
  }
}
