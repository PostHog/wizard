/**
 * Canonical step keys for the Self-driving run's `wizard: step` analytics.
 *
 * The agent writes its own task labels, so the same step reaches analytics under whatever wording
 * that run's model picked — "Connect GitHub", "Connecting GitHub", "Connect GitHub (required)" and
 * "Checking GitHub connection" are all STEP 3. A funnel keyed on that label silently loses runs the
 * moment the wording drifts, which is invisible: the number just drops.
 *
 * These rules map a label back to the step it belongs to, so a funnel can key on `step_key` and stay
 * correct across rewordings. `step_name` still ships alongside it, unchanged, for anything that wants
 * the label the user actually saw.
 */

/** Canonical keys, in the order the prompt's STEPs run. Frozen: these are event property values. */
export const SELF_DRIVING_STEP_KEYS = [
  'check_access',
  'read_context',
  'connect_github',
  'enable_products',
  'enable_signal_sources',
  'connect_issue_trackers',
  'configure_scouts',
  'design_custom_scouts',
  'setup_replay_vision',
  'write_report',
] as const;

export type SelfDrivingStepKey = (typeof SELF_DRIVING_STEP_KEYS)[number];

/**
 * First match wins, so order is the rule. Entity words come before verbs: "Checking GitHub
 * connection" is the GitHub step, not the access-check step, and "Connecting issue trackers" must
 * not fall through to GitHub just because a later run words it "Connecting GitHub issues".
 */
const RULES: readonly { key: SelfDrivingStepKey; match: RegExp }[] = [
  { key: 'connect_issue_trackers', match: /issue[\s-]?track/i },
  { key: 'setup_replay_vision', match: /replay vision|vision scanner/i },
  { key: 'design_custom_scouts', match: /custom scout|designing scout/i },
  {
    key: 'configure_scouts',
    match: /scout troop|tun(e|ing) .*scout|configur\w* .*scout/i,
  },
  { key: 'enable_signal_sources', match: /signal source/i },
  { key: 'connect_github', match: /github/i },
  { key: 'enable_products', match: /product/i },
  { key: 'write_report', match: /report/i },
  { key: 'check_access', match: /access/i },
  { key: 'read_context', match: /read|context|project state/i },
];

/**
 * The canonical key for an agent-authored step label, or `undefined` when nothing matches — an
 * unmatched step is left unkeyed rather than bucketed, so a new step shows up as a gap to name
 * instead of quietly inflating whichever key it landed nearest.
 */
export function resolveSelfDrivingStepKey(
  stepName: string | undefined,
): SelfDrivingStepKey | undefined {
  if (!stepName) return undefined;
  return RULES.find((rule) => rule.match.test(stepName))?.key;
}
