/** Effects the non-interactive host supplies while a program scopes its project. */
export type ProgramCiHost = {
  log: {
    info(message: string): void;
    warn(message: string): void;
  };
};

/** Live UI effects a program may need after its run definition resolves. */
export type ProgramRunHost = {
  getFrameworkContext(key: string): unknown;
  setFrameworkContext(key: string, value: unknown): void;
  warn(message: string): void;
};
