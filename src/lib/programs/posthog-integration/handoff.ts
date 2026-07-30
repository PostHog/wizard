/**
 * The coding-agent handoff prompt.
 *
 * The wizard finishes a successful run by publishing the setup report — which
 * ends with a "Verify before merging" checklist the agent fills in from the
 * context-mill skill — to the wizard session (`publish_handoff`) and mirroring
 * it into a PostHog notebook. This is the one-line prompt the operator pastes
 * into their own coding agent to close the gap between "wizard finished" and
 * "PostHog merged": open the report notebook, work the checklist, open a PR.
 * No report file is written to the project, so the prompt only exists when the
 * run captured a notebook URL.
 *
 * Kept as a pure helper so the exact wording is easy to review and test in
 * isolation. It is surfaced through `OutroData.handoffPrompt`, which the wizard
 * prints to the terminal's main buffer on exit (where it survives in scrollback
 * and stays triple-click-selectable); it is NOT written into any file — the
 * verification content itself lives in the report.
 *
 * The wording asks the agent to investigate each checklist item and get the
 * operator's explicit consent before making any changes — so actions with real
 * implications (e.g. uploading source maps, editing CI) are surfaced and
 * approved, not applied silently. It deliberately stops there: no PR mandate or
 * edit-style rules, since the operator pastes this into their own agent and
 * governs how changes ultimately land.
 *
 * Background: https://github.com/PostHog/wizard/issues/447
 */
export function buildCodingAgentPrompt(notebookUrl: string): string {
  return `Open ${notebookUrl} (the PostHog setup report) and work through its "Verify before merging" checklist: investigate each item, then list the changes you'd make and get my approval before applying any of them.`;
}
