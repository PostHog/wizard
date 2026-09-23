export const FEATURE_FLAGS_REPORT_FILE = 'posthog-feature-flags-report.md';
export const FRONTEND_FLAG_KEY = 'wizard-example-frontend-flag';
export const BACKEND_FLAG_KEY = 'wizard-example-backend-flag';

const SEED_PROMPT = `---
type: setup-feature-flags
flow: feature-flags
seed: true
model_pi: openai/gpt-5.6-terra
effort_pi: medium
skills: []
allowedTools: [Read, Glob, Grep]
disallowedTools: [Write, Edit, Bash, complete_task]
dependsOn: []
---

## Goal

Plan example PostHog feature flags for this project and seed the task queue.
The end state: one example flag per side of the app that exists, each
evaluated once in one place on its own side and reported back to PostHog, and
a report telling the user how to turn the flags on.

First establish two facts from the repo.

**1. Which sides does the app have?**

- \`backend\`: server code that handles requests, such as route handlers, API
  views, controllers, server components, or server loaders.
- \`frontend\`: code the app owns that runs in a browser or on a device, such
  as client components, a single-page app, scripts in its page templates, or
  mobile screens.

A side counts only when the app already has code there to put an evaluation
in. Never add a side to host a flag. Full-stack frameworks usually have both;
an API has only a backend; a mobile app or a static single-page app has only a
frontend.

**2. Is PostHog already integrated on each of those sides?** Look for the
PostHog SDK for that side in the dependency manifests (or, for template
scripts, the PostHog snippet) and an init call in the source. An init counts
only when the key it reads is defined in the repo's committed env template or
build config. When you cannot tell, treat it as missing: the init task
re-checks and leaves a complete init alone.

Then seed the graph. Give every task the same input: \`sides\`, the list of
sides you found (\`["backend", "frontend"]\`, \`["backend"]\`, or
\`["frontend"]\`). Pass no other inputs; each task learns the rest from the
handoffs before it.

- \`install\`, only when an SDK a side needs is missing from the manifest.
- \`init\`, whenever an init is missing or unproven on either side.
- \`create-flag\`, with no dependencies. It only talks to PostHog.
- \`evaluate\`, after \`create-flag\` and after whichever of \`install\` and
  \`init\` you queued.
- \`report\`, after every other task.

Never plan capture, dashboard, or session-replay work. This run sets up the
example flags, nothing else.

## How you know you succeeded

Every task above is queued with that dependency shape and the \`sides\` input,
\`report\` depends on every other task, and your plan states which sides the
app has, whether PostHog is integrated on each, and the files that told you.
Keep labels short.
`;

const INSTALL_PROMPT = `---
type: install
flow: feature-flags
label: Add the PostHog SDKs to the manifest
model_pi: openai/gpt-5.6-terra
effort_pi: low
skills: [integration-v2-install]
allowedTools: [Read, Edit, Glob, Grep, Bash]
disallowedTools: [enqueue_task]
dependsOn: []
---

## Goal

Make sure each side in your \`sides\` input has its PostHog SDK in the
manifest: the server library for \`backend\`, the browser or mobile library
for \`frontend\`. Leave an SDK that is already there alone and say so.
Install a missing one following your skill, which owns the package manager
and version rules.

A frontend that is only scripts in server-rendered templates has no package
to install: the init task adds the PostHog snippet there. Install nothing for
that side, and install nothing beyond these SDKs.

## How you know you succeeded

Each side's SDK is declared in the manifest at a real version, or your
handoff says plainly why the environment stopped you. Your handoff names the
manifest and package for each side.
`;

const INIT_PROMPT = `---
type: init
flow: feature-flags
label: Set up PostHog initialization
model_pi: openai/gpt-5.6-terra
effort_pi: low
skills: [integration-v2-init, posthog-best-practices]
allowedTools: [Read, Write, Edit, Glob, Grep, check_env_keys, set_env_values]
disallowedTools: [enqueue_task]
dependsOn: []
---

## Goal

Make sure PostHog is initialized on each side in your \`sides\` input. An
existing init counts only when the env variable it reads is defined: check it
with \`check_env_keys\`. When a side's init is complete, leave it alone and
say so. Otherwise create or finish it following your skill, including the
env wiring and \`.env.example\`. A template-script frontend gets the PostHog
snippet in its base template.

Initialize each SDK so a flag can be evaluated, and stop. Do not evaluate any
flag; the evaluate task owns that.

You do not install packages, run builds, linters, or tests, or start the app.
The install task owns packages, and your edits just need to be right by
reading.

## How you know you succeeded

PostHog initializes from a defined key on every side in \`sides\`. Your
handoff names, for each side, the init file, the client the evaluate task
should use, and the env variable names (never values).
`;

const CREATE_FLAG_PROMPT = `---
type: create-flag
flow: feature-flags
label: Create the example flags in PostHog
model_pi: openai/gpt-5.6-terra
effort_pi: low
skills: [integration-v2-mcp]
allowedTools: [posthog_exec]
disallowedTools: [Read, Write, Edit, Bash, enqueue_task]
dependsOn: []
---

## Goal

Make sure this PostHog project has one example flag for each side in your
\`sides\` input, and none for a side that is not listed:

| Side | Key | Name |
|---|---|---|
| \`backend\` | \`${BACKEND_FLAG_KEY}\` | Wizard example backend flag |
| \`frontend\` | \`${FRONTEND_FLAG_KEY}\` | Wizard example frontend flag |

For each flag you need:

1. Look it up by key with \`feature-flag-get-definition-by-key\`. One keyed
   lookup per flag; never list every flag in the project.
2. Found: reuse it as it is. Do not change its rollout or its active state.
3. Not found: create it with \`create-feature-flag\`, using the key and name
   above, a boolean flag with one release condition at 0% rollout, and
   \`active: false\`. New flags are active by default, so pass
   \`active: false\` explicitly. The user turns it on when they are ready.

Run \`info\` on each tool before calling it; never guess the input shape.

If a call is rejected for permissions, or the tool is hidden for a missing
scope, stop and say so in your handoff: the credentials need
\`feature_flag:read\` and \`feature_flag:write\`. Do not retry with other
tools.

## How you know you succeeded

Your handoff gives, for each flag: its side, key, id, whether you created or
reused it, whether it is active, and its URL in PostHog (the tool result's
URL, verbatim).
`;

const EVALUATE_PROMPT = `---
type: evaluate
flow: feature-flags
label: Evaluate the flags in the app
model_pi: openai/gpt-5.6-sol
effort_pi: medium
skills: [integration-v2-feature-flags-step]
allowedTools: [Read, Write, Edit, Glob, Grep]
disallowedTools: [enqueue_task]
dependsOn: []
---

## Goal

For each flag the create-flag handoff names, add one evaluation on that
flag's side of this app: the backend flag in server code through the server
SDK, the frontend flag in browser or device code through the client SDK.
Never evaluate a flag on the other side. Your skill carries the SDK flag docs
and the best-practices page; follow them for the exact calls.

The SDKs are installed and initialized, either already or by the tasks before
you. Build on that; do not re-check it.

For each flag, choose a call site where a real request or screen passes
through. On the backend, evaluate once for that request and pass the value
down; never re-evaluate deeper in the call stack. Put the keys in a constants
module the call site imports, one module per language; a template script that
cannot import it gets the key from the server's constant, never a literal.
Evaluate with the identified user's distinct id, the same id on both sides,
and report each evaluation back to PostHog the way the docs show for that SDK.
Gate something harmless on each value, such as a log line or a small label,
so the app behaves the same while the flags are off.

This is an edit-only task. Do not install dependencies, run the build, or
start the app.

## How you know you succeeded

Each flag is evaluated once, at one call site on its own side, with its key
imported from a constants module, and its evaluation is reported. Your
handoff names, for each flag, the files changed and the call site, plus how
the distinct id is chosen on each side.
`;

const REPORT_PROMPT = `---
type: report
flow: feature-flags
label: Report and verify
sink: true
model_pi: openai/gpt-5.6-sol
effort_pi: medium
skills: [integration-v2-mcp]
allowedTools: [Read, Glob, Grep, Write, Edit, posthog_exec, wizard_ask]
disallowedTools: [enqueue_task]
dependsOn: []
---

## Goal

Write the hand-off first, then offer one check that the evaluations reach
PostHog.

**1. Write the report.** From \`read_handoffs\` only, write
\`./${FEATURE_FLAGS_REPORT_FILE}\`, with one section per flag:

- The flag: its side, key, URL, and that it is off until the user enables it.
- Where the app evaluates it: files and call site, the constants module, and
  how the distinct id is chosen.

Then:

- If the run installed or initialized an SDK, say which and on which side.
- A "Verify" section, filled in by step 2.

Write the file before anything else, so a user who walks away still has it.

**2. Offer the check.** Ask once with \`wizard_ask\`:
\`{ id: "verify-flag", prompt: "The flags are wired in and the report is in ${FEATURE_FLAGS_REPORT_FILE}. Run the app and open the pages or endpoints that evaluate them, then choose Check.", kind: "single", options: [{ label: "Check", value: "check" }, { label: "Skip", value: "skip" }] }\`

- "check": query PostHog once through \`execute-sql\` for the latest
  \`$feature_flag_called\` event in the last hour for each flag key, grouped
  by \`$feature_flag\`. Write "Verified" with the event time for each flag
  seen, and "Not seen yet" with what to check next for each flag missing.
- "skip", no answer, or \`wizard_ask\` unavailable (headless runs): write
  "Verify later" with the same query in words and where to look in PostHog.

Update the Verify section with the outcome, then give the same summary in
chat.

## How you know you succeeded

\`${FEATURE_FLAGS_REPORT_FILE}\` exists, and a user who reads only it knows
which flags were created, which side evaluates each and where, how to turn
them on, and whether an evaluation has reached PostHog yet.
`;

export const FEATURE_FLAGS_PROMPTS: readonly string[] = [
  SEED_PROMPT,
  INSTALL_PROMPT,
  INIT_PROMPT,
  CREATE_FLAG_PROMPT,
  EVALUATE_PROMPT,
  REPORT_PROMPT,
];
