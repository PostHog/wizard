export enum EnvUploadSkipCause {
  CliMissing = 'cli-missing',
  ProjectUnlinked = 'project-unlinked',
  Unauthenticated = 'unauthenticated',
}

export type EnvUploadSkip = {
  provider: string;
  cause: EnvUploadSkipCause;
  message: string;
};

export abstract class EnvironmentProvider {
  protected options: { installDir: string };

  name: string;

  constructor(options: { installDir: string }) {
    this.options = options;
  }

  abstract detect(): Promise<boolean>;

  abstract uploadEnvVars(
    vars: Record<string, string>,
  ): Promise<Record<string, boolean>>;

  /**
   * Guidance for a project that looks like it deploys to this provider but
   * failed `detect()` — null when there's no sign the project deploys here.
   * Only meaningful after `detect()` has run.
   */
  describeSkip(_keys: string[]): EnvUploadSkip | null {
    return null;
  }
}
