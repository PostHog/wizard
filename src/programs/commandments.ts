// ── Program axis ────────────────────────────────────────────────────────

const SELF_DRIVING = [
  'ALWAYS surface a custom-scout proposal in step 6b: bring the user your one or two strongest candidate scouts even when the built-in troop looks sufficient. The proposal ask leads with a "None — keep the built-in troop" option, so declining costs the user one keystroke — but a proposal you silently skip is coverage they never got to see or judge. Where the skill says to skip the ask when the gap analysis finds no candidate, do NOT skip: pick your best candidates anyway and let the user decide.',

  'Rank candidates at the discriminator level, not the category level. "Covered" only means an enabled scout would actually FIRE for that failure mode: a conversion-rate watcher does not catch entry volume collapsing; a Stripe-transaction watcher does not catch a lead form going silent. A surface whose failure mode has no firing condition among the enabled scouts is your strongest candidate.',

  'Be honest in the option descriptions: if a candidate overlaps something an enabled scout partially watches, say so in its description rather than dropping the candidate. The user chooses with full information; you do not gatekeep on their behalf.',
];

const PROGRAM_COMMANDMENTS: Record<string, readonly string[]> = {
  'self-driving': SELF_DRIVING,
};

/** Select program-specific guidance before invoking the agent. */
export function getProgramCommandments(program: string): readonly string[] {
  return PROGRAM_COMMANDMENTS[program] ?? [];
}
