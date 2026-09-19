/** Thrown when an action lacks a required param. Maps to 400. */
export class MissingParamError extends Error {
  constructor(action: string, param: string) {
    super(`Action "${action}" requires param "${param}".`);
    this.name = 'MissingParamError';
  }
}

/** Thrown when a param is present but unusable. Maps to 400. */
export class BadParamError extends Error {
  constructor(action: string, param: string, detail: string) {
    super(`Action "${action}" param "${param}": ${detail}`);
    this.name = 'BadParamError';
  }
}

export function requireString(
  action: string,
  params: Record<string, unknown>,
  key: string,
): string {
  const v = params[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new MissingParamError(action, key);
  }
  return v;
}
