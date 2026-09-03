const handlerInstalled = Symbol.for(
  'posthog-wizard.uncaught-exception-handler-installed',
);

type ExceptionHandlerRuntime = {
  on(event: 'uncaughtException', listener: (error: Error) => void): unknown;
  exit(code: number): unknown;
  [handlerInstalled]?: true;
};

type ExceptionHandlerOptions = {
  runtime: ExceptionHandlerRuntime;
  flush: (timeoutMs: number) => Promise<void>;
  log: (...args: unknown[]) => void;
  print: (error: Error) => void;
};

export function installWizardUncaughtExceptionHandler(
  options: ExceptionHandlerOptions,
): void {
  if (options.runtime[handlerInstalled]) return;
  options.runtime[handlerInstalled] = true;

  let exiting = false;

  options.runtime.on('uncaughtException', (error) => {
    if (
      error.name === 'InformationalError' &&
      error.message === 'socket idle timeout'
    ) {
      options.log(
        '[uncaught-exception] ignored Node HTTP/2 idle timeout',
        error,
      );
      return;
    }

    if (exiting) return;
    exiting = true;
    options.print(error);
    void options.flush(2_000).then(
      () => options.runtime.exit(1),
      () => options.runtime.exit(1),
    );
  });
}
