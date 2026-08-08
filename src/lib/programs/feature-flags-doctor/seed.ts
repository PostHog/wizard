import type { AuditCheck } from '@lib/programs/audit/types';

/**
 * Seed rows for the feature-flags doctor ledger. Ids and areas are the
 * contract with the `audit-feature-flags` skill (context-mill) — its
 * `audit_resolve_checks` calls reference these ids exactly, and the
 * AuditAreaPane slide deck is keyed by the area strings.
 *
 * Ordered to follow the run: static correctness → static cost → live
 * delivery probes → observability → the consented fix phase. The area
 * pane shows the slide for the first pending row, so seed order is the
 * left pane's narrative order.
 *
 * `ff-flags-delivered`, `ff-unknown-flags`, and `ff-stale-rolled-out`
 * are sweep rows: the skill appends one row per affected flag via
 * `audit_add_checks` (`delivered-`/`ghost-`/`stale-` prefixes), because
 * the seed can't enumerate a project's flags.
 */
export const FEATURE_FLAGS_DOCTOR_SEED_CHECKS: AuditCheck[] = [
  {
    id: 'ff-bootstrap-when-known-set',
    area: 'Feature Flags',
    label: 'Bootstrap set when initial flags known',
    status: 'pending',
  },
  {
    id: 'ff-await-readiness',
    area: 'Feature Flags',
    label: 'Flag evals gated on readiness',
    status: 'pending',
  },
  {
    id: 'ff-default-values',
    area: 'Feature Flags',
    label: 'Defaults handle the loading window',
    status: 'pending',
  },
  {
    id: 'ff-bootstrap-distinct-id-mismatch',
    area: 'Feature Flags',
    label: 'Bootstrapped distinct_id is stable',
    status: 'pending',
  },
  {
    id: 'ff-identified-only-pre-auth-targeting',
    area: 'Feature Flags',
    label: 'Pre-auth targeting has profiles',
    status: 'pending',
  },
  {
    id: 'ff-eval-before-identify',
    area: 'Feature Flags',
    label: 'Flag evals do not race identify()',
    status: 'pending',
  },
  {
    id: 'ff-active-but-unreferenced',
    area: 'Feature Flags — Optimize',
    label: 'Active flags are referenced in code',
    status: 'pending',
  },
  {
    id: 'ff-stale-rolled-out',
    area: 'Feature Flags — Optimize',
    label: 'No 100% flags still gated in code',
    status: 'pending',
  },
  {
    id: 'ff-local-eval-polling-interval',
    area: 'Feature Flags — Optimize',
    label: 'Local-eval polling interval tuned',
    status: 'pending',
  },
  {
    id: 'ff-local-eval-in-edge-handlers',
    area: 'Feature Flags — Optimize',
    label: 'No local eval in edge handlers',
    status: 'pending',
  },
  {
    id: 'ff-test-ci-gating',
    area: 'Feature Flags — Optimize',
    label: 'Test/CI runs do not fetch flags',
    status: 'pending',
  },
  {
    id: 'ff-presence',
    area: 'Feature Flags — Delivery',
    label: 'Flag call sites found in project',
    status: 'pending',
  },
  {
    id: 'ff-key-authenticates',
    area: 'Feature Flags — Delivery',
    label: 'Project key actually authenticates',
    status: 'pending',
  },
  {
    id: 'ff-flags-endpoint',
    area: 'Feature Flags — Delivery',
    label: "/flags works via the app's path",
    status: 'pending',
  },
  {
    id: 'ff-flags-delivered',
    area: 'Feature Flags — Delivery',
    label: 'Active flags arrive as defined',
    status: 'pending',
  },
  {
    id: 'ff-unknown-flags',
    area: 'Feature Flags — Delivery',
    label: 'Code flag keys exist in PostHog',
    status: 'pending',
  },
  {
    id: 'ff-evaluated-not-reported',
    area: 'Feature Flags — Observability',
    label: 'Evaluation events are reported',
    status: 'pending',
  },
  {
    id: 'apply-fixes',
    area: 'Workflow',
    label: 'Apply user-approved fixes',
    status: 'pending',
  },
  {
    id: 'write-report',
    area: 'Workflow',
    label: 'Write doctor report',
    status: 'pending',
  },
];
