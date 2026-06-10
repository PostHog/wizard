import { AgentSignals } from '@lib/agent/agent-interface';
import type { SkillVariant } from './detect.js';

export type SourceMapsUploadPromptParams = {
  displayName: string | undefined;
  variant: SkillVariant;
  skillId: string;
  projectId: number;
  host: string;
  settingsUrl: string;
  uiHost: string;
};

export const SOURCE_MAPS_DETECTION_FAILED_PROMPT = `Detection did not pick a source maps skill variant for this project.
Emit: ${AgentSignals.ABORT} unsupported-platform
Then halt.`;

export function buildSourceMapsUploadPrompt(
  params: SourceMapsUploadPromptParams,
): string {
  const {
    displayName,
    variant,
    skillId,
    projectId,
    host,
    settingsUrl,
    uiHost,
  } = params;
  const platformLabel = displayName ?? variant;

  return `You are wiring up PostHog Error Tracking source map upload for this ${platformLabel} project.

Project context:
- PostHog Project ID: ${projectId}
- PostHog Host: ${host}
- Detected platform: ${platformLabel}
- Skill to use: ${skillId}
- Personal API keys settings page: ${settingsUrl}

The skill you install in STEP 2 is the source of truth for the HOW of every
step: its "## Steps" section has an overview, tips and per-technology
examples for each named step, and its reference files carry the exact
per-framework API. The STEPS below give the order, the conditionals, and the
wizard-specific mechanics (which MCP tool to call, signals to emit) — read
the matching skill step (named in parentheses) before doing the work, and do
not invent steps the skill doesn't describe.

Follow these steps IN ORDER. Do not skip or reorder.

Before doing any work, create your FULL task list in a single TaskCreate
call so the user can follow your progress in the TUI. Use exactly these
tasks, in this order — do not collapse, rename, or omit any of them:
  1. Get personal API key
  2. Install source maps skill
  3. Apply build-config changes (per skill)
  4. Make credentials readable at build time
  5. Write keys to .env
  6. Identify build & run commands
  7. Test the local setup
  8. Set up CI for auto-upload
  9. Summarise & hand off
Drive the list with TaskUpdate — mark a task in_progress when you start it
and completed when done. ALWAYS keep task 7 ("Test the local setup") and task
8 ("Set up CI for auto-upload") in the list even if the user declines either
in STEP 7 / STEP 8: mark them completed rather than deleting them, so the user
can see each was offered.

STEP 1 — Get a personal API key from the user. (skill: "Get a personal API key")
   The wizard cannot mint keys — never call the PostHog API or any tool to
   create one. Ask the user with the wizard_ask MCP tool; you receive the
   answer as a vaulted secretRef (never the raw value), which you reuse in
   STEP 5:
     {
       id: "api-key",
       prompt: "Paste your PostHog personal API key below.\\n\\nDon't have one yet? Create one here:\\n${settingsUrl}\\n\\nWhen creating the key, choose the 'Source map upload' preset, then come back and paste it here.",
       kind: "text",
       sensitive: true
     }
   Keep the \\n line breaks exactly as written — Ink's <Text> renders them
   as separate lines. The answer is { secretRef: "secret:..." }.
   If wizard_ask is unavailable (CI / non-interactive), emit
   ${AgentSignals.ABORT} requires-interactive-mode and halt.

STEP 2 — Install the skill.
   Call install_skill (wizard-tools MCP server) with skillId "${skillId}".
   Do NOT run shell commands to install skills. Then read the installed
   SKILL.md and its reference files — they drive STEPS 3-9.
   If install fails, emit ${AgentSignals.ERROR_RESOURCE_MISSING} skill ${skillId} could not be installed.

STEP 3 — Apply build-config changes. (skill: "Apply build-config changes")
   Make the bundler / build-config changes the skill's step instructs. The
   skill and its reference are the source of truth for this platform.

STEP 4 — Make the credentials readable at build time. (skill: "Make credentials available at build time")
   Follow the skill's step. Wizard-specific: if it calls for a loader (e.g.
   \`dotenv\`), install it SILENTLY — do NOT ask the user or call wizard_ask.
   Skip this step entirely if the platform already auto-loads .env.

STEP 5 — Write the credentials to the env file. (skill: "Write credentials to the env file")
   Use the wizard-tools MCP server. Reuse the env file the skill tells you to
   pick — the prerequisite PostHog integration usually already wrote
   POSTHOG_* vars to one, so seed your keys alongside them.
   - First call check_env_keys on that file (returns present/absent, never
     values — don't read the file directly).
   - Then call set_env_values, passing the STEP 1 secretRef as a value
     object, not a literal string:
       values: {
         "POSTHOG_CLI_API_KEY": { secretRef: "<the ref from STEP 1>" },
         "POSTHOG_CLI_PROJECT_ID": "${projectId}",
         "POSTHOG_CLI_HOST": "${host}"
       }
   Variable names follow the skill's per-uploader conventions. The wizard
   resolves the ref locally before writing, so you never see the key value.

STEP 6 — Identify the build AND run commands. (skill: "Identify the build and run commands")
   Per the skill, resolve the production BUILD command and the RUN command
   for THIS project (use detect_package_manager for the package manager). Do
   NOT run either yourself — the user runs them. If you cannot identify a
   build command, emit ${AgentSignals.ABORT} build command not found.

STEP 7 — Offer to test the local setup. (skill: "Test the local setup")
   Call wizard_ask:
     {
       id: "test-affordance",
       prompt: "Want me to help you test your local setup? I'll add a temporary test button (or route) to your app so you can confirm errors show up in Error Tracking with readable stack traces after your next build. I'll remove it once you've confirmed it works.",
       kind: "single",
       options: [
         { label: "Yes, help me test it", value: "yes" },
         { label: "No, I'll test on my own later",  value: "no"  }
       ]
     }

   If "no", skip to STEP 8.

   If "yes", follow the skill's "Test the local setup" step for the
   platform-appropriate affordance, the captureException shape, the
   placement, and the read-before-edit / always-revert rules. Then pause for
   the user with wizard_ask, baking the EXACT build and run commands from
   STEP 6 (and the exact button label / route) into the prompt as literal,
   copy-pasteable steps. Separate each numbered step with \\n\\n so the TUI
   renders them as distinct lines:
        {
          id: "test-done",
          prompt: "1) Run \`<your detected build command>\` to upload source maps and build the app with the test affordance.\\n\\n2) Start the app with \`<your detected run command>\`, then click the \\"<your test button label>\\" button (or hit \`<your test route>\`).\\n\\n3) Open Error Tracking in PostHog (${uiHost}/project/${projectId}/error_tracking) and confirm the test error appears with a source-resolved stack trace pointing at real source files (not minified bundle paths).\\n\\nWhen you're done, select Continue and I'll revert the test code.",
          kind: "single",
          options: [{ label: "Continue (revert test code)", value: "continue" }]
        }
   After the user continues, revert the test code per the skill's rules and
   surface any failure in STEP 9.

STEP 8 — Offer to set up CI for automatic uploads. (skill: "Set up CI for automatic uploads")
   Source maps only upload when the production build runs, so the build's CI/CD
   must carry the same upload credentials you wrote in STEP 5. Ask the user with
   wizard_ask whether to wire this up now:
     {
       id: "ci-affordance",
       prompt: "Want me to set up CI so source maps upload automatically on every deploy?\\n\\nI'll wire your upload credentials into your build pipeline (Dockerfile / GitHub Actions) wherever I recognise it.",
       kind: "single",
       options: [
         { label: "Yes, set up CI", value: "yes" },
         { label: "No, I'll handle CI myself", value: "no" }
       ]
     }
   Keep the \\n line breaks exactly as written.

   If "no", skip to STEP 9.

   If "yes", follow the skill's "Set up CI for automatic uploads" step. It
   tells you how to trace where the production build actually runs and how to
   wire the credentials through every layer for each setup it covers
   (Dockerfile, GitHub Actions, composite actions, builds over SSH). The
   skill is the source of truth for that wiring; wizard-specific rules on top:
   - Trace the deploy path by reading the project's files — do NOT ask the
     user, and do NOT invent config that isn't there.
   - Reuse the EXACT credential variable names you wrote in STEP 5.
   - If you can't trace the build to a setup the skill covers, make NO CI
     file changes — instead tell the user which env vars their build
     environment must provide, or maps won't upload on deploy.
   - NEVER write a secret VALUE into a Dockerfile, workflow, or any other
     committed file — only variable names / \`secrets.*\` references.
   - You CANNOT create CI secrets. Tell the user each secret to add under
     their repo's Settings → Secrets and variables → Actions before the
     next deploy.
   - Carry every manual follow-up (secrets to add, the unrecognised-setup
     note) into STEP 9.

STEP 9 — Summarise and hand off. (skill: "Verify and hand off")
   Follow the skill's "Verify and hand off" step. The Symbol sets page for
   this project — where the user confirms the upload landed — is:
   ${uiHost}/project/${projectId}/error_tracking/configuration
`;
}
