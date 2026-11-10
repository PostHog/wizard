---
type: verify
flow: error-tracking
label: Build and check the setup
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: []
allowedTools: [Read, Write, Edit, Glob, Grep, Bash, check_env_keys, detect_package_manager]
disallowedTools: [enqueue_task]
dependsOn: [capture-exceptions, configure, credentials, link-releases]
---

## Goal

Every edit of this run is in. Prove the setup works by building the project
the way it builds for production. `read_handoffs` names the files each task
changed, the packages it added, and the env variable names it used.

Read the handoffs first. When the `configure` handoff reports a passing
production build that ran with the upload credentials present, and this run
has no `link-releases` task, that build already ran on the finished code: every
other code task finished before `configure` started. Do not build again. Hand
off its command, result, and uploader summary lines as your own, and say you
reused them. Otherwise:

1. Install with the project's package manager, so the build sees the manifest
   and lockfile this run left behind. In a workspace package, that is the
   manager whose lockfile sits at the workspace root above this directory.
2. Run the production build the project defines in this checkout: its package
   manager's build script, or the platform's compiler (Cargo, Go, Gradle,
   Xcode). You cannot run a Dockerfile or a CI job; when that is the only
   build, say so and finish. When the project defines no build, run its
   typecheck or lint script instead; when it defines none of them, say so and
   finish.
3. Read the exit status first, then the log. When source-map or debug-symbol
   upload is wired and the credentials are written, the log shows the uploader
   creating a release and uploading files. A green build with no upload lines
   means the upload never ran: compare the variable names the build config
   reads with the names in the env file (`check_env_keys`). When the
   `credentials` handoff reports no key, the build still has to pass, with the
   upload skipped.
4. Fix what this run's changes broke, in the files the handoffs name, and build
   again. A failure that was there before this run is not yours: say so in your
   handoff and leave it. After a few attempts, stop and hand off what still
   fails.

Build, never run. A command that installs or launches the app (`expo run:*`,
`react-native run-*`, `flutter run`, `./gradlew install*`) opens a simulator
or an emulator on the user's machine. On an Expo app whose `android/` and
`ios/` folders are generated, build the JavaScript bundle instead: `npx expo
export --source-maps --platform <platform>`.

When the upload is a separate `posthog-cli` command rather than part of the
build, or the build sits in a `make` target or a shell script, you cannot run
those: run the build command itself, and say so. Never add a package script to
get past a blocked command. Your shell gets a reduced
environment: `ANDROID_HOME` and other variables from the user's shell do not
reach it. A build that cannot find an SDK (`SDK location not found`) failed
because of this shell, not the project: do not retry it, and do not give the
user a setup step for it. A missing toolchain, or a local interpreter too old
for a version this run pinned, is the environment, not the setup: say so and
finish, and never lower a version to make a local install pass.

Finish this task `done` even when the build still fails. Your handoff gives
the command, the error, and whether this run caused it, and the report turns
it into a follow-up. A `failed` verify stops the report, and the user gets no
report at all.

A build with the credentials in place creates a release and uploads to the
user's project. That is expected: it is what every production build will do,
and it puts the first symbol set in PostHog right away.

## How you know you succeeded

The production build passes with this run's changes, and when the upload is
wired with credentials, its log shows the release and the upload. Your handoff
gives the command you ran, or that you reused `configure`'s build, its result,
the uploader's summary lines (release name and how many files it uploaded),
every fix you made with its file, and anything that still fails, so the report
can tell the user what was verified. The task ends `done` either way.
