/**
 * Graceful degrade for the audit programs' final notebook-upload step.
 *
 * Both `audit` and `events-audit` end by mirroring their markdown report into
 * a PostHog notebook (`notebooks-create` over MCP), which needs the
 * `notebook:write` scope. The grant often comes back without it — the consent
 * screen lets the user deselect it, and the OAuth app's ceiling can clamp it —
 * so the run would reach the notebook step and fail with a raw permission
 * error at the very end of an otherwise clean setup.
 *
 * The granted scope is known at login (`credentials.missingScopes`), so we
 * check it before the notebook step and steer the agent to skip the upload
 * instead of failing. The local report stays on disk; the user is told which
 * permission is missing and how to re-authorize.
 */

/** Scope the `notebooks-create` MCP tool requires to write the report. */
export const NOTEBOOK_WRITE_SCOPE = 'notebook:write';

/**
 * Prompt addendum that disables the notebook upload when the run was
 * authorized without `notebook:write`. Returns `null` when the scope is
 * present, so callers append nothing in the common case.
 */
export function notebookUploadSkipInstruction(
  missingScopes: readonly string[] | undefined,
): string | null {
  if (!missingScopes?.includes(NOTEBOOK_WRITE_SCOPE)) return null;

  return `Notebook upload is not available for this run. This instruction overrides the skill's notebook upload step.

This run was authorized without the \`${NOTEBOOK_WRITE_SCOPE}\` permission, so the PostHog notebook upload cannot work.

- Do not call the \`notebooks-create\` MCP tool.
- Skip the notebook upload step.
- Keep the local markdown report on disk. The report is the deliverable.
- Resolve the \`upload-notebook\` check with status \`warning\` and this detail: "Notebook upload skipped — the run was not granted the ${NOTEBOOK_WRITE_SCOPE} permission. Re-run the wizard and approve all permissions on the PostHog authorization screen to enable it."
- Add a short note to the report that tells the user the same.`;
}
