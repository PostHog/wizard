---
type: configure
flow: error-tracking
label: Apply build-config changes
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: []
allowedTools: [Read, Write, Edit, Glob, Grep, Bash, load_skill_menu, install_skill, check_env_keys]
disallowedTools: [enqueue_task]
dependsOn: [capture-exceptions]
---

## Goal

Make this project's production build emit and upload source maps (or, for Go
and Rust, native debug symbols). Install the skill your task input names
(`install_skill` with the `skillId`) and read it — it is the source of truth
for the per-framework build-config and the uploader wiring.

Two of the skill's steps are yours:

- **"Apply build-config changes"** — make the bundler / build-config edits the
  skill instructs for this platform, so the build produces and injects the
  chunk IDs PostHog needs and runs the uploader.
- **"Make credentials available at build time"** — do the skill's step so the
  build can read the upload credentials from the environment. If it calls for a
  loader (e.g. `dotenv`), install it SILENTLY with the project's package
  manager. Skip this step entirely when the platform already auto-loads `.env`.

Install every dependency with the project's own package manager: call
`detect_package_manager` before the first install and use its answer,
translating any `npm install` the skill or docs show (`pnpm add -D …`,
`yarn add -D …`). In a pnpm or yarn workspace, npm fails outright on
`workspace:*` dependencies (`EUNSUPPORTEDPROTOCOL`) — that error means the
wrong manager, never a flag to retry with.

When the upload step you wire runs a machine-global `posthog-cli` rather than
one from the project's own dependencies, check that it is on the `PATH`
(`command -v posthog-cli`). Do not try to install it: a global install is
blocked for you, and the wizard already tried before your task. When it is
missing, name it in your handoff as a manual follow-up — run
`npm install -g @posthog/cli@latest` before the next release build — because
without it the upload step cannot run.

When your changes make the build emit a bundle to a new directory (`dist/`,
`build/`), check that some script actually runs that output. A project whose
`build` writes `dist/index.js` while `start` still runs the original source
never executes the bundle the maps were uploaded for, so every uploaded map
goes unused. Add or fix the script that serves the built output.

That run script has its own environment to satisfy, and it is not the build's.
The uploader's credentials are handled — your build step passes them itself. The
separate question is the variables **the application reads when it starts**: the
project token and host its init looks up. Those live in the same gitignored env
file, and a compiled binary or a bare interpreter loads nothing on its own.

So open the init point and note the variables it reads. When the project
already loads the env file for them, you're done. When it doesn't, do not wire
a loader into the run script: production supplies these as real environment
variables, and a script that loads the gitignored file breaks wherever it is
missing. Never put a hard `--env-file=.env` on `start`. Leave the script as it
is and name the gap in your handoff as a manual follow-up, with the variable
names. Leave it out of the handoff and the build is green, the symbols are
uploaded, and the single command you hand the user to verify with is the one
command that cannot capture.

Put a multi-step build somewhere the tool actually runs it — a script file, a
make target, the manifest's own scripts — never an alias mechanism you are
assuming exists, borrowed from a neighbouring tool.

Match the bundle's module format to the package's type while you write the
command — you cannot run it, so it has to be right by construction. `esbuild
--platform=node` emits CommonJS unless you pass `--format=esm`, so in a package
whose `package.json` sets `"type": "module"` the bundle dies at boot with
`ReferenceError: module is not defined in ES module scope`. Read the `type`
field before writing the command.

Types are the same kind of trap. In a config the compiler checks — a `.ts`
config, or JS under `checkJs` — `process.env.ANYTHING` is `string | undefined`,
while a plugin's options usually require `string`. Where your skill's example
asserts or defaults that lookup, keep that part exactly: dropping a `!` or a
`?? ''` turns a working example into a build that fails type checking. The
upload step often runs before the type check, so the maps land and the build
still exits non-zero — a broken build that looks half-successful in the log.

## The names are a contract

An env variable only works if the name the code reads is the name in the file.
You write the code that reads them; the `credentials` task writes the file, and
you two run in parallel. So never invent a name that already exists somewhere
else — look for the other half of the contract first, and adopt it:

- **Call `check_env_keys` before you write the config.** It returns names, never
  values. If the PostHog upload variables are already there, make your config
  read exactly those names, whatever they are, even when they are not the ones
  your skill's example shows.
- **Only when they are absent yet** are you the one deciding. Use the names your
  skill documents for the mechanism you are wiring, and name them in your
  handoff in full so `credentials` and `wire-ci` can match them.

Names that merely look plausible are the failure here. A build reading
`POSTHOG_API_KEY` beside an env file holding `POSTHOG_CLI_API_KEY` throws no
error anywhere — the upload is skipped silently, the build looks clean, and
every stack trace stays minified.

Do not write any credential values and do not create env files — the
`credentials` task owns that, in parallel with you. Do not run the build.

## How you know you succeeded

The build config carries the skill's source-map / debug-symbol changes and can
read its credentials from the environment at build time. Your handoff names
every file you changed and the exact build-config keys you added, so the CI
task can wire the same variables through the pipeline.
