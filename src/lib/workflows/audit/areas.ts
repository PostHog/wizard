/**
 * Audit areas — the canonical, wizard-side enum of areas the audit runner
 * may produce.
 *
 * The wizard exposes the user-supplied subset to the agent at runtime via
 * the `audit_get_areas` MCP tool, so the agent (and its discovery subagent)
 * can constrain dispatch to those areas only. An empty list means no
 * constraint — the agent runs everything.
 *
 * Adding a new area: append it here AND add a row to context-mill's
 * audit description.md "Discoverable specialists" table whose specialist
 * produces findings under that area.
 */

export const AUDIT_AREAS = [
  'Installation',
  'Identification',
  'Event Capture',
  'Web Analytics',
  'Feature Flags',
  'Experiments',
  'LLM Analytics',
  'Error Tracking',
] as const;

export type AuditArea = (typeof AUDIT_AREAS)[number];

export const ALL_AUDIT_AREAS: ReadonlyArray<AuditArea> = AUDIT_AREAS;

/** Case-insensitive lookup. Returns the canonical capitalization on hit. */
export function normalizeAuditArea(value: string): AuditArea | null {
  const folded = value.trim().toLowerCase();
  return AUDIT_AREAS.find((a) => a.toLowerCase() === folded) ?? null;
}

export function isAuditArea(value: string): value is AuditArea {
  return AUDIT_AREAS.includes(value as AuditArea);
}

export interface ParsedAreas {
  areas: AuditArea[];
  unknown: string[];
}

/**
 * Parse a comma-separated `--areas` value. Tokens are matched
 * case-insensitively against the canonical enum. Duplicates are dropped.
 * Unknown tokens are returned separately so callers can surface a hint
 * to the user.
 */
export function parseAuditAreas(input: string | undefined): ParsedAreas {
  if (!input) return { areas: [], unknown: [] };
  const tokens = input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const areas: AuditArea[] = [];
  const unknown: string[] = [];
  for (const token of tokens) {
    const canonical = normalizeAuditArea(token);
    if (canonical) {
      if (!areas.includes(canonical)) areas.push(canonical);
    } else {
      unknown.push(token);
    }
  }
  return { areas, unknown };
}

/** Human-readable hint listing every allowed area, comma-separated. */
export function formatAreasHint(): string {
  return AUDIT_AREAS.join(', ');
}
