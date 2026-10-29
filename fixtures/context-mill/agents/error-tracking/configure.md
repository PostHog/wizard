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

Make this project's production build emit and upload source maps or debug
symbols. Flutter Android/iOS release builds upload Dart AOT symbols separately
from platform-native symbols. Install the skill your task input names
(`install_skill` with the `skillId`) and read it — it is the source of truth
for the per-framework build-config and the uploader wiring.

Two of the skill's steps are yours:

- **"Apply build-config changes"** — make the bundler / build-config edits the
  skill instructs for this platform, so the build produces matching maps or
  debug symbols and runs the uploader. Only web source maps need chunk IDs.
- **"Make credentials available at build time"** — do the skill's step so the
  build can read the upload credentials from the environment. If it calls for a
  loader (e.g. `dotenv`), install it SILENTLY with the project's package
  manager. Skip this step entirely when the platform already auto-loads `.env`.

Install every dependency with the project's own package manager: call
`detect_package_manager` before the first install and use its answer,
translating any `npm install` the skill or docs show (`pnpm add -D …`,
`yarn add -D …`). In a pnpm or yarn workspace, npm fails outright on
`workspace:*` dependencies (`EUNSUPPORTEDPROTOCOL`) — that error means the
wrong manager, never a flag to retry with. When `detect_package_manager`
answers `No lockfile found. Default to npm`, look up the tree first: in a
workspace package, use the manager whose lockfile sits at the workspace root
above this directory, and npm only when no parent holds a lockfile.

Change only what the upload needs. Do not remove or weaken a source-map setting
the project already has (`productionBrowserSourceMaps`, Vite's
`build.sourcemap`, webpack's `devtool`): a build without the upload credentials
must still emit what it emitted before. Do not upgrade a package the project
already depends on to quiet a peer-dependency warning, because a warning is not
a failure. Upgrade one only when the install or build fails on it, or when the
skill requires a newer version for the feature you are wiring. Keep the
project's version style: an exact pin stays exact.

Wire the upload into a build the project already has, in this directory or in
a package nested below it. Code that no build compiles or bundles runs as
written, and its stack traces are already readable: do not add a bundler, a
compiler, or a new `build` or `start` script to create one. When this project
has no production build to attach an upload to, report this task as
`not needed` and say why in your handoff.

When the upload step you wire runs a machine-global `posthog-cli` rather than
one from the project's own dependencies, do not try to install it or check for
it: a global install, `posthog-cli` itself, and `command -v` are blocked for
you, and the wizard already tried the install before your task. Name it in
your handoff as a follow-up for every other machine that runs the release
build — `npm install -g @posthog/cli@latest` — because without it the upload
step cannot run.

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
already loads the env file for them, you're done: never remove an env-file
flag or loader the project's `start` already has, because that local loading
is the project's choice. When it doesn't, do not wire
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

Match the bundle's module format to the package's type. A build passes either
way, and the mismatch only shows when the bundle starts: `esbuild
--platform=node` emits CommonJS unless you pass `--format=esm`, so in a package
whose `package.json` sets `"type": "module"` the bundle dies at boot with
`ReferenceError: module is not defined in ES module scope`. Read the `type`
field before writing the command.

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
`credentials` task owns that, in parallel with you.

## Build it

Once your edits are in, run the production build and read its exit status, not
only its log: the upload often runs before the type check, so the maps can
land in a build that still fails. Fix what your changes broke and build again.
A failure that was there before your changes is not yours: note it in your
handoff and leave it. Let the build check option names and types: write from
your skill, build, and open a plugin's type declarations only to fix an error
the build reports.

Build, never run. A command that installs or launches the app (`expo run:*`,
`react-native run-*`, `flutter run`, `./gradlew install*`) opens a simulator
or an emulator on the user's machine, even where your skill names it as the
build. On an Expo app whose `android/` and `ios/` folders are generated, build
the JavaScript bundle instead: `npx expo export --source-maps --platform
<platform>`. Your shell blocks `make`, shell scripts, and a Gradle wrapper
outside the project root: when you put the build in a `make` target or a
script, run the build command inside it directly. Never add a package script
to get past a blocked command. Skip it, and say in your handoff what you could
not run.

Your shell gets a reduced environment: `ANDROID_HOME` and other variables from
the user's shell do not reach it. A build that cannot find an SDK (`SDK
location not found`) failed because of this shell, not the project. Do not
retry it, and do not give the user a setup step for it: say the build could
not run here.

The `credentials` task may not have written the upload credentials yet, so this
build may run without them. It has to pass either way. A teammate's checkout
and a pull-request build have no key either, and a config that demands one
stops their builds. When the build fails only because the upload credentials
are missing, make the upload skip itself when they are absent, with the option
your skill's plugin or CLI offers, and build again. Once the credentials are
written you cannot build without them: the build reads the env file, and a
prefix such as `VAR= npm run build` is blocked. Check the skip path by reading
the config instead.

When the credentials are in place, the build creates a release and uploads to
the user's project. That is expected; it is what every production build will
do.

## How you know you succeeded

The build config carries the skill's source-map / debug-symbol changes and can
read its credentials from the environment at build time. The production build
passes with your changes, with or without the upload credentials. Your handoff
names every file you changed, the exact build-config keys you added, and the
build command you ran with its result and whether the credentials were
present, so the CI task can wire the same variables through the pipeline.
