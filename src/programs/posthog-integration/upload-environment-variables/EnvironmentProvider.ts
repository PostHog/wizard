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
}
