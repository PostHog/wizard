import type { RunnerContext } from '../../runner-context';

export type EnvironmentProviderOptions = {
  installDir: string;
  /** Where the upload reports progress: the running program's runner. */
  runner: Pick<RunnerContext, 'log' | 'spinner'>;
};

export abstract class EnvironmentProvider {
  protected options: EnvironmentProviderOptions;

  abstract name: string;

  constructor(options: EnvironmentProviderOptions) {
    this.options = options;
  }

  abstract detect(): Promise<boolean>;

  abstract uploadEnvVars(
    vars: Record<string, string>,
  ): Promise<Record<string, boolean>>;
}
