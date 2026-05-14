import type { WorkflowConfig } from '../workflow-step.js';
import type { Credentials, WizardSession } from '../../wizard-session.js';
import { logToFile } from '../../../utils/debug.js';
import { CONCIERGE_STEPS } from './steps.js';

const REPORT_FILE = 'posthog-concierge-report.md';
const WEBHOOK_URL =
  'https://webhooks.us.posthog.com/public/webhooks/019e22eb-2fcc-0000-f88b-127184bd249e';

function buildCustomPrompt(notificationId: string | null): () => string {
  if (!notificationId) {
    return () =>
      `Call the write_report tool with filePath="${REPORT_FILE}" and content="# Hello world\n\nConcierge placeholder report.\n". Then stop.`;
  }
  // The wizard fetched the notification + wrote the embedded skill to disk
  // during the download-skill step that runs between auth and run. SKILL.md
  // is already on disk when the agent boots.
  const skillPath = `.claude/skills/concierge-${notificationId}/SKILL.md`;
  return () =>
    `You are running the PostHog concierge workflow.

A custom skill was downloaded for this run at ${skillPath}. Read it first — it is the canonical source of truth for what to do.

Operating guidelines:

- **Plan first with TodoWrite.** After reading SKILL.md, enumerate its steps as a todo list using the TodoWrite tool. Mark exactly one item as \`in_progress\` at a time; move it to \`completed\` immediately when finished. This drives the live task list on the right of the run screen — keep it accurate.

- **Use the posthog-wizard MCP tools** for every PostHog read or write (insights, queries, dashboards, session replays, notebooks, etc.). Do not fabricate data, do not assume IDs. If a tool returns an error, surface it and adjust — never silently skip a step.

- **Installing referenced skills.** SKILL.md may reference other skills by id (e.g. \`roast-my-funnel\`). These are NOT pre-installed and the built-in \`Skill\` tool will fail with "Unknown skill" if you try to invoke them directly. To use a referenced skill:
  1. Call the wizard-tools \`load_skill_menu\` tool once to discover available skills (skip this if you've already called it during this run).
  2. Call the wizard-tools \`install_skill\` tool with the referenced \`skillId\`. This downloads it to \`.claude/skills/<skillId>/\`.
  3. Read \`.claude/skills/<skillId>/SKILL.md\` and follow it inline as part of your current workflow.
  If the menu does not contain the referenced id, log it as an open question in the LLM handoff and continue with the rest of the parent skill — never fabricate the missing skill's output.

- **Stay scoped to the active project.** The init banner names the project id; do not call \`switch-project\` unless SKILL.md tells you to.

- **Read-only run.** The wizard is in read-only mode for local files. You may read files, query PostHog, and create notebooks/dashboards/insights via MCP, but you must not modify the user's local source files.

- **Two outputs, two audiences:**

  1. **Human report → PostHog notebook (\`notebooks-create\` MCP tool, note the trailing \`s\`).** Write the full narrative findings here — methodology, what you queried, charts/insights referenced, plus the 2–3 concrete action items in their full prose form. This is what the human operator (e.g. the customer or AE) will read and discuss on the next call.

     **Content format is ProseMirror JSON, NOT markdown.** Pass the \`content\` argument as a JSON object with shape \`{"type": "doc", "content": [ ...nodes ]}\`. Markdown strings render as plain text and tables won't work.

     Node types you'll use:
     - Heading: \`{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Findings"}]}\`
     - Paragraph: \`{"type":"paragraph","content":[{"type":"text","text":"…"}]}\`
     - Bullet list: \`{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"item"}]}]}]}\`
     - Table (the part that was broken before):
       \`\`\`
       {"type":"table","content":[
         {"type":"tableRow","content":[
           {"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"Step"}]}]},
           {"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"Users"}]}]}
         ]},
         {"type":"tableRow","content":[
           {"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"Visit login"}]}]},
           {"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"42"}]}]}
         ]}
       ]}
       \`\`\`
     Every cell must wrap its text inside a paragraph node. Headers go in the first row using \`tableHeader\`; data cells use \`tableCell\`. Do NOT use markdown pipe tables — they'll render as raw text.

     Also pass a short \`title\` and \`text_content\` (a plain-text version of the body, used for search).

  2. **LLM handoff → local \`${REPORT_FILE}\` (\`write_report\` wizard-tools tool).** A concise, structured handoff for a downstream LLM run. Tight, no preamble, no narrative. Sections:
     - \`## Notebook\` — one line: title and the notebook URL/short_id you just created.
     - \`## Context\` — 3–6 bullets capturing the project id, the funnel/event under scrutiny, the key cohort signals you found, and any IDs (insight/dashboard/cohort) the next agent will need to look up.
     - \`## Action items\` — the 2–3 items as a numbered list, each one sentence, phrased so a downstream agent can act on them directly.
     - \`## Open questions\` — anything the data couldn't answer, that the next session should follow up on.
     Skip everything else. No hedging. No "the user might want to consider…".

- **Report the notebook back to the wizard.** After the notebook is created AND the local report is written, call the wizard-tools \`set_concierge_summary\` tool once with the notebook's \`posthog_url\` (or full URL) and \`short_id\`. This triggers the post-run summary screen that opens the notebook in the user's browser. Skip this call only if notebook creation failed.

Sequence: create notebook → write local report → call \`set_concierge_summary\` → stop.

Important: read a file immediately before writing it; the SDK rejects writes against stale reads.

Begin by reading ${skillPath}, then build the todo list.`;
}

async function fireConciergeWebhook(
  session: WizardSession,
  credentials: Credentials,
): Promise<void> {
  const payload = {
    event: 'concierge_completed',
    distinct_id: credentials.distinctId ?? String(credentials.projectId),
    email: session.email,
    status: 'success',
  };
  try {
    const resp = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    logToFile(`[concierge] webhook status=${resp.status}`);
  } catch (err) {
    logToFile(`[concierge] webhook error: ${(err as Error).message}`);
  }
}

export const conciergeConfig: WorkflowConfig = {
  command: 'concierge',
  description: 'TODO(concierge): description',
  flowKey: 'concierge',
  steps: CONCIERGE_STEPS,
  run: (session) =>
    Promise.resolve({
      integrationLabel: 'concierge',
      readOnly: true,
      customPrompt: buildCustomPrompt(session.notificationId),
      successMessage: 'TODO(concierge): successMessage',
      reportFile: REPORT_FILE,
      docsUrl: 'https://posthog.com/docs',
      spinnerMessage: 'TODO(concierge): spinnerMessage',
      estimatedDurationMinutes: 5,
      postRun: fireConciergeWebhook,
    }),
};

export { CONCIERGE_STEPS } from './steps.js';
