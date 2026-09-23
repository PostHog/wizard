/**
 * Leaf-level constants for the events-audit program. The document names live
 * in `@lib/constants` so infrastructure (the scanner's allowlist) can name
 * them without importing this program.
 */

export {
  EVENTS_AUDIT_REPORT_FILE as SETUP_REPORT_FILE,
  EVENT_INVENTORY_FILE,
  EVENT_INVENTORY_PART_PATTERN,
} from '@shared/constants';
