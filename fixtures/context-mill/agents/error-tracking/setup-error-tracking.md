---
type: setup-error-tracking
flow: error-tracking
seed: true
model_pi: openai/gpt-5.6-terra
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: []
allowedTools: [Read, Glob, Grep, posthog_exec]
disallowedTools: [Write, Edit, Bash, complete_task]
dependsOn: []
---

## Goal

Plan a PostHog Error Tracking setup and seed the task queue. The end state:
errors the app does not catch reach PostHog; where the platform ships minified
bundles or stripped binaries, production builds upload the source maps or debug
symbols that make the stack traces readable; and where the platform runs its
source as is (Python, Ruby, PHP), each production deploy links its errors to a
release.

First establish three facts from the repo:

**1. Is PostHog already integrated?** Look for `posthog-js` or a server SDK in
the dependency manifests, or a `posthog.init(...)` / snippet in the source.
Check the project state for existing events if the repo is ambiguous.

Integrated means the init runs, not that the package is listed. An init point
is a pair: the call, and the key it is constructed from. A repo can carry the
call while the key it names is defined nowhere — then the client is built from
an empty string and captures nothing, however complete the manifest looks. So
when you find an init that reads a variable, look for that same name in the
repo's committed env template or its build config. Found, or the project state
shows real events arriving: integrated. Named nowhere, or you cannot tell:
**queue `init`**. It re-checks the pair itself and leaves a complete init
alone, so queuing it when you are unsure costs one cheap task, while skipping
it on a keyless init costs the whole run.

**2. Which uploader variant is this project — or none?** Read the manifests
and pick at most one, by this precedence (first match wins):

- `react-native` or `expo` in `package.json` dependencies → `react-native`.
  A React Native repo also carries `ios/Podfile`, an `.xcodeproj` and Gradle
  files for its native shells, so this rule wins over every native marker
  below. Picking `ios` or `android` for it uploads no JavaScript source maps,
  and every JavaScript stack trace stays minified.
- `pubspec.yaml` → `flutter`
- an `.xcodeproj`, `Podfile`, or `Package.swift` → `ios`
- a Gradle build file that applies `com.android.application` or
  `com.android.library`, or an `AndroidManifest.xml` → `android`. A Gradle
  project without these markers is a JVM server: keep reading.
- `go.mod` → `go`
- `Cargo.toml` → `rust`
- `astro` in `package.json` dependencies → **none**. Astro is not supported by
  the uploader: it inlines scripts below its asset limit into the HTML, so a
  build routinely emits a `.map` with no `.js` beside it, and the upload step
  then fails the whole build. This rule wins over every `package.json` match
  below — an Astro project that also depends on `vite` is still **none**.
- otherwise read `package.json` dependencies, first match wins:
  `nuxt` → `nuxt`; `next` → `nextjs`;
  `@angular/core` → `angular`; `vite` → `vite`; `webpack` → `webpack`;
  `rollup` → `rollup`; `react` → `react`; server-only Node → `node`;
  any other browser JS → `web`
- **none** for platforms whose stack traces are already readable: plain
  Python (Django, Flask, FastAPI), Ruby, PHP, Elixir, JVM servers, .NET.
  Skip the whole upload subgraph for them — a skipped upload on such a
  platform is an outcome, not a gap. Fact 3 decides what Python, Ruby, and
  PHP get instead.

When a variant matched, the uploader skill id is
`error-tracking-upload-source-maps-<variant>`. Pass it to the four upload
tasks as `inputs: { skillId: "<id>", displayName: "<human platform name>" }`
so no task re-detects.

**3. Which release-linking variant is this project — or none?** It applies
when the app itself is a server that runs Python, Ruby, or PHP source as is:

- a Python app (`requirements*.txt`, `pyproject.toml`, `Pipfile`, or
  `setup.py`; Django, Flask, FastAPI, and plain Python alike) → `python`
- a Ruby app (`Gemfile` or a `*.gemspec`; Rails, Sinatra, and plain Ruby
  alike) → `ruby`
- a PHP app (`composer.json`; Laravel and plain PHP alike) → `php`
- **none** for every other platform. A manifest that only carries tooling for
  another platform does not count: a `Gemfile` for CocoaPods or fastlane beside
  a mobile app, or a `requirements.txt` for scripts beside a Node service. The
  mobile uploader variants (`react-native`, `flutter`, `ios`, `android`) always
  mean none here. Bundled and compiled platforms get their release from the
  uploader, and Elixir, JVM servers, and .NET have no release-linking skill
  yet.

When a variant matched, the skill id is
`error-tracking-link-releases-<variant>`. Pass it to `link-releases` as
`inputs: { skillId: "<id>", displayName: "<human platform name>" }`. Fact 3
does not depend on fact 2: a Django app that also bundles a Vite frontend in
the same project gets both the upload subgraph and `link-releases`, and both
default to the same release.

The three facts are independent — settle ALL of them before you enqueue
anything. "PostHog is already integrated" answers fact 1 only; it never decides
fact 2 or fact 3, and an already-integrated project still gets the upload
subgraph or `link-releases` when a variant matches. A compiled or bundled JS
project normally has an uploader variant: a Node service built with `tsc` ships
minified/compiled output, so it is the `node` variant, not "none". Only two
kinds of project skip the upload subgraph — the readable-stack platforms listed
above, and Astro.

Then seed the graph:

- `install`, only when the SDK is missing from the manifest.
- `init`, independent of `install` — whenever fact 1 did not show a complete
  pair. Do not stop on an uninstrumented repo, integrate.
- `capture-exceptions`, after whichever of `install` and `init` you queued
  (with no dependencies when you queued neither).
- When an uploader variant matched, add the upload subgraph:
  - `credentials`, no dependencies — it stops to ask the user for a personal
    API key, so keep it a root task: the prompt reaches the user early while
    the code tasks run.
  - `configure`, after `capture-exceptions` — build-config changes; it runs
    after the code edits so the two never fight over the same files.
  - `wire-ci`, after `configure` and `credentials`.
- When a release-linking variant matched, `link-releases`, after
  `capture-exceptions` — and after `wire-ci` too when you queued the upload
  subgraph, because both edit the deploy pipeline. It changes production
  deploys only, needs nothing from the user during the run, and leaves local
  development as it is.
- `report`, after every other queued task except `test-setup`. It writes the
  handoff once the work is done, so it describes what actually shipped.
- When you queued the upload subgraph, `test-setup` last, after `report` — it
  offers the user an optional local end-to-end test. The report comes first on
  purpose: a user who walks away still gets it. Queue `report` before
  `test-setup`, because `test-setup` names `report` as its dependency.

Never plan an identify, capture, dashboard, or session-replay task — this run
sets up error tracking, not the full integration. The minimal SDK footprint
that `install` and `init` leave behind is enough for exceptions to flow.

## How you know you succeeded

Every task in the chosen graph is queued with that dependency shape, the four
upload tasks (when queued) share the same `{ skillId, displayName }` inputs,
`report` depends on every other task except `test-setup` (directly or
transitively), `test-setup` (when queued) depends on `report`, and the first
task is runnable. `link-releases` (when queued) carries its own
`{ skillId, displayName }` inputs. Your plan states all three facts explicitly:
whether PostHog was integrated — and, when you called it integrated, the name
of the key you found defined —, which uploader variant matched — or, when you
queue no upload tasks, why no variant applies: which readable-stack platform
this is, or that Astro is not supported by the uploader —, and which
release-linking variant matched, or that none applies. A plan that never
mentions fact 2 or fact 3 is an incomplete plan, not a decision. Keep labels
short — the action in a few words.
