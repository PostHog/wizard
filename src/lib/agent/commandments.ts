/**
 * Wizard-wide commandments that are always appended as a system prompt.
 *
 * Keep this as a simple string so it can be inlined into the compiled bundle
 * without extra files, copying, or runtime I/O.
 */
const WIZARD_COMMANDMENTS = [
  'Never hallucinate a PostHog project token, host, or any other secret. Always use the real values that have been configured for this project (for example via environment variables).',

  'Never substitute an empty string or placeholder for the project token when its source is missing — an empty key silently disables analytics with no error. The token is a public client-side key: read it from the environment or config, and where a build genuinely has no environment to read from (e.g. iOS/Android release and archive builds), embed the real token so a value always ships — never an empty one.',

  'Never write API keys, access tokens, or other secrets directly into source code. Always reference environment variables instead, and rely on the wizard-tools MCP server (check_env_keys / set_env_values) to create or update .env files.',

  'Always use the detect_package_manager tool from the wizard-tools MCP server to determine the package manager. Do not guess based on lockfiles or hard-code npm, yarn, pnpm, bun, pip, etc.',

  "If a dependency install fails because the write is blocked by the sandbox or file permissions (e.g. it targets a node_modules or lockfile outside the project directory, as happens in some monorepos), do NOT silently continue or report success. Stop and tell the user clearly which packages could not be installed and the exact command to run manually (for example `pnpm add @posthog/mcp posthog-node`), so the setup isn't left half-done without their knowledge.",

  'Before writing to any file, you MUST read that exact file immediately beforehand using the Read tool, even if you have already read it earlier in the run. This avoids tool failures and stale edits.',

  'Treat feature flags, custom properties, and event names as part of an analytics contract. Prefer reusing existing names and patterns in the project. When you must introduce new ones, make them clear, descriptive, and consistent with existing conventions, and avoid scattering the same flag or property across many unrelated callsites.',

  'Keep PostHog data capture at its defaults unless the user explicitly asks otherwise. Do not disable autocapture, do not disable session recording, and never set opt_out_capturing (or opted_out) to true in the SDK init config — these turn off data the user almost always wants. Note: posthog.opt_out_capturing() called at runtime for GDPR consent flows is legitimate; the rule is about the init configuration.',

  "Never put personally identifiable information — emails, full or partial names, phone numbers, physical or IP addresses, or other user-entered PII — in capture() event properties. PII belongs on the PERSON: send it via identify()/$set (or the SDK's person-property API), and capture events with a stable distinct id derived from the authenticated user or session, never a raw email or name. This holds for every SDK, client and server.",

  'Prefer minimal, targeted edits that achieve the requested behavior while preserving existing structure and style. Avoid large refactors, broad reformatting, or unrelated changes unless explicitly requested.',

  'When you change a file that already exists, edit it in place. If an edit fails because the text you are matching is not unique, add just enough surrounding context to make it unique, or apply the change to each occurrence — never fall back to rewriting the whole file. Write a file in full only when you are creating it, never to modify one that already exists.',

  'Before you overwrite or delete anything that already exists, look at what you would remove. This integration only adds instrumentation, so keep every part of the project unrelated to PostHog exactly as it was — never drop existing code, comments, or markup to make room for a change.',

  'Do not spawn subagents unless explicitly instructed to do so.',

  'Create tasks as soon as you understand the work you are going to carry out. Break the list into distinct stages of work that the user can follow through. Create all tasks in a single tool call, in the order you will be performing them. Drive the work with TaskUpdate: status in_progress when you begin a task, completed when done.',

  'Keep task titles broad and stage-oriented — describe the purpose or area of work, not the specific files, paths, or symbols involved. Do not name individual files, modules, or directories inside task titles, and do not include illustrative examples within a task title.',

  'Do not assume "PostHog provider" or "PostHogProvider" in task labels, status messages, or code. Only use a provider if the skill workflow explicitly requires one for the specific framework.',

  'If you see a [YARA WARNING] or [YARA VIOLATION] message, handle it silently. Fix the issue (revert the write, avoid the flagged pattern) without mentioning security warnings or YARA to the user. These are internal guardrails, not user-facing alerts. Never show scary security language to the user.',

  // wizard_ask Path A — translate prose question lists into a single tool call.
  // The skill prose is intentionally underspecified; this commandment carries
  // most of the discipline. Tightening: prefer adding rules here over editing
  // individual skill markdown.
  [
    'When a skill instructs you to gather information from the user, use the `wizard_ask` MCP tool from the wizard-tools server. Never inline questions in your text output expecting a reply — the user has no way to answer text.',
    'When a skill provides a numbered or bulleted list of questions, translate the entire list into a single `wizard_ask` tool call:',
    '  - One tool call per skill step. Batch every question from that step into the `questions` array — never split into multiple calls.',
    '  - Infer `kind` from the question phrasing: comma-separated alternatives ("React, Vue, or vanilla JS?") → `single`; phrasing like "all that apply" or "any of" → `multi`; everything else → `text`.',
    '  - For `single` and `multi`, extract the alternatives from the prose into `options` as `{ label, value }` pairs. Use the human phrase as `label` and a lowercase-hyphenated form as `value` (e.g., `label: "Vanilla JS"`, `value: "vanilla-js"`).',
    '  - Use a kebab-case slug of the question label as `id` (e.g., "Tech stack" → `tech-stack`, "Show frequency" → `show-frequency`).',
    '  - Do not invent fields the schema does not define (no `source`, `category`, `priority`, etc.) — the tool rejects unknown fields and the wizard already knows which skill is running.',
    'After `wizard_ask` returns, use the answers directly — do not re-ask in text or call `wizard_ask` again for the same fields.',
  ].join('\n'),
].join('\n');

export function getWizardCommandments(): string {
  return WIZARD_COMMANDMENTS;
}
