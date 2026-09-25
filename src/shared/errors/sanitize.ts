const DETAIL_ALLOWLIST = ['reason', 'detected', 'platform'] as const;

export function sanitizeErrorDetail(
  detail: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!detail) return undefined;
  const safe: Record<string, unknown> = {};
  for (const key of DETAIL_ALLOWLIST) {
    if (detail[key] !== undefined) safe[key] = detail[key];
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}
