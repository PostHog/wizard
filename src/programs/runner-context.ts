/** Effects the non-interactive runner supplies while a program scopes its project. */
export type CiRunnerContext = {
  log: {
    info(message: string): void;
    warn(message: string): void;
  };
};

/** Live UI effects a program may need after its run definition resolves. */
export type RunnerContext = {
  getFrameworkContext(key: string): unknown;
  setFrameworkContext(key: string, value: unknown): void;
  log: {
    warn(message: string): void;
  };
};
