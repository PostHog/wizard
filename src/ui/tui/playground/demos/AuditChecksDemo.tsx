/**
 * AuditChecksDemo — renders the AuditChecksViewer against a mock ledger so
 * the scroll/expand/sort behavior can be verified in the playground without
 * running the actual audit agent.
 */

import { Box } from 'ink';
import type { AuditCheck } from '../../../../lib/programs/audit/types.js';
import { AuditChecksViewer } from '../../screens/audit/AuditChecksViewer/AuditChecksViewer.js';

const MOCK_CHECKS: AuditCheck[] = [
  {
    id: 'sdk-installed',
    area: 'Installation',
    label: 'PostHog SDK installed',
    status: 'pass',
    file: 'package.json',
    details: 'posthog-js@1.260.0 found in dependencies.',
  },
  {
    id: 'sdk-up-to-date',
    area: 'Installation',
    label: 'SDK version up to date',
    status: 'warning',
    details: 'installed 1.260.0, latest 1.372.6 — more than one minor behind.',
  },
  {
    id: 'init-correct',
    area: 'Installation',
    label: 'Initialization is correct',
    status: 'warning',
    file: 'index.js:12',
    details:
      'Init runs at module load with no singleton guard; calling posthog.init() multiple times can cause duplicate events.',
  },
  {
    id: 'identify-stable-distinct-id',
    area: 'Identification',
    label: 'Stable distinct_id (not session UUID)',
    status: 'error',
    file: 'index.js:18',
    details:
      'distinct_id is crypto.randomUUID() — a per-session ephemeral UUID that resets on every page load. Replace with an authenticated user id.',
  },
  {
    id: 'identify-not-late',
    area: 'Identification',
    label: 'identify() called before captures / flag evals',
    status: 'pass',
    file: 'index.js:18',
    details:
      'posthog.identify() is called before any posthog.capture() calls in this module.',
  },
  {
    id: 'cross-runtime-distinct-id',
    area: 'Identification',
    label: 'Same distinct_id across client and server',
    status: 'pass',
    details: 'Single runtime — no cross-runtime check needed.',
  },
  {
    id: 'identify-reset-on-logout',
    area: 'Identification',
    label: 'reset() called on logout / account switch',
    status: 'error',
    file: 'auth.ts:44',
    details:
      'signOut() clears app auth state but never calls posthog.reset(), so the next identify() on this device can merge into the prior user profile.',
  },
  {
    id: 'capture-event-names-static',
    area: 'Event Capture',
    label: 'Event names are static and consistent',
    status: 'pass',
    file: 'index.js:21',
    details:
      "All posthog.capture() calls use static string literals ('pageview', 'cta_clicked'); no template literals or dynamic variables found.",
  },
  {
    id: 'capture-uses-proxy',
    area: 'Event Capture',
    label: 'Captures route through a reverse proxy',
    status: 'warning',
    file: 'index.js:13',
    details:
      'api_host is set to the default PostHog US ingest host (https://us.i.posthog.com) rather than a first-party reverse proxy — ad/tracking blockers can silently drop these events.',
  },
  {
    id: 'capture-growth-events',
    area: 'Event Capture',
    label: 'Key activation events captured',
    status: 'pending',
  },
];

export const AuditChecksDemo = () => (
  <Box flexDirection="column" flexGrow={1}>
    <AuditChecksViewer checks={MOCK_CHECKS} />
  </Box>
);
