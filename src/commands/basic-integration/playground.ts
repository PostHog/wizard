import { VERSION } from '@lib/version';

/** Launch the TUI primitives playground. */
export function runPlayground(): void {
  void (async () => {
    const { startPlayground } = await import(
      '@ui/tui/playground/start-playground'
    );
    (startPlayground as (version: string) => void)(VERSION);
  })();
}
