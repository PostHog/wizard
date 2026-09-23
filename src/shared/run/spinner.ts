/** A progress spinner a host renders: the TUI's run spinner, or log lines. */
export interface SpinnerHandle {
  start(message?: string): void;
  stop(message?: string): void;
  message(msg?: string): void;
}
