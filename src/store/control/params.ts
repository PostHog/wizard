/** Thrown when an action lacks a required param. Maps to 400. */
export class MissingParamError extends Error {
  constructor(subject: string, param: string) {
    super(`"${subject}" requires param "${param}".`);
    this.name = 'MissingParamError';
  }
}

/** Thrown when a param is present but unusable. Maps to 400. */
export class BadParamError extends Error {
  constructor(subject: string, param: string, detail: string) {
    super(`"${subject}" param "${param}": ${detail}`);
    this.name = 'BadParamError';
  }
}

type Params = Record<string, unknown>;

export function isRecord(value: unknown): value is Params {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireString(
  subject: string,
  params: Params,
  key: string,
): string {
  const v = params[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new MissingParamError(subject, key);
  }
  return v;
}

export function optionalString(
  subject: string,
  params: Params,
  key: string,
): string | undefined {
  const v = params[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.length === 0) {
    throw new BadParamError(subject, key, 'expected a non-empty string');
  }
  return v;
}

export function optionalBoolean(
  subject: string,
  params: Params,
  key: string,
  fallback: boolean,
): boolean {
  const v = params[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'boolean') {
    throw new BadParamError(subject, key, 'expected a boolean');
  }
  return v;
}

export function optionalOneOf<T extends string>(
  subject: string,
  params: Params,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const v = params[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new BadParamError(
      subject,
      key,
      `expected one of ${allowed.join(', ')}`,
    );
  }
  return v as T;
}

export function optionalStringArray(
  subject: string,
  params: Params,
  key: string,
): string[] {
  const v = params[key];
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((item) => typeof item !== 'string')) {
    throw new BadParamError(subject, key, 'expected an array of strings');
  }
  return v as string[];
}

export function requireRecord(
  subject: string,
  params: Params,
  key: string,
): Params {
  const v = params[key];
  if (!isRecord(v)) throw new MissingParamError(subject, key);
  return v;
}

export function optionalRecord(
  subject: string,
  params: Params,
  key: string,
): Params | undefined {
  const v = params[key];
  if (v === undefined) return undefined;
  if (!isRecord(v)) throw new BadParamError(subject, key, 'expected an object');
  return v;
}
