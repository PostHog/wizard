const SECRET_WORDS = new Set([
  'key',
  'keys',
  'token',
  'tokens',
  'secret',
  'secrets',
  'password',
  'passwords',
  'credential',
  'credentials',
]);
const SECRET_REF = /^secret:[0-9a-f-]{16,}$/i;

/** `upload-api-key`, `accessToken`, and `ACCESS_TOKEN` name a secret; `monkey` does not. */
export function isSecretKey(name: string): boolean {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((word) => SECRET_WORDS.has(word));
}

/** Values a parent may read; secret refs and secret-named keys never leave. */
export function redactContext(
  ctx: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (isSecretKey(key)) {
      out[key] = '[redacted]';
    } else if (typeof value === 'string' && SECRET_REF.test(value)) {
      out[key] = '[secret-ref]';
    } else {
      out[key] = value;
    }
  }
  return out;
}
