import type { SpinnerHandle } from '@agent/types';

/** How an upload reports to the host running the program. */
export type EnvUploadReport = {
  info(message: string): void;
  spinner(): SpinnerHandle;
};

export type EnvironmentProviderOptions = {
  installDir: string;
  report: EnvUploadReport;
};

export abstract class EnvironmentProvider {
  protected options: EnvironmentProviderOptions;

  name: string;

  constructor(options: EnvironmentProviderOptions) {
    this.options = options;
  }

  abstract detect(): Promise<boolean>;

  abstract uploadEnvVars(
    vars: Record<string, string>,
  ): Promise<Record<string, boolean>>;
}
